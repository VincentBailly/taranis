# Benchmark server setup

Run from the Taranis repository root. Use absolute paths for `MODEL_DIR`
(the GGUF layout in the platform metadata), `ASSET_DIR` (Halogen assets),
`STRATA_DIR` (Strata source) and `PACK_DIR` (Strata assets). Verify the pinned
model files against the hashes in metadata. Start one engine at a time.

The completed **2026-10-31** five-engine runs use Halogen **0.18.21**, Strata
app **0.2.9** / engine **0.1.55**, strix-llama.cpp **b1038 / Vulkan**,
Taranis **34 patches** and stock llama.cpp **0ec4027** on both platforms.
See [Strix Halo metadata](strix-halo-metadata.json) and
[Gorgon Halo metadata](gorgon-halo-metadata.json) for pins and hashes.

## Taranis

This packages llama.cpp `da731374077f2ad9bdffd4848f782b5694b9bb68` with 34
patches and the tuned ROCm `10.0.0-4` runtimes. The server flags match the
measured configuration.

```sh
bun run build.ts

docker run --rm --device /dev/kfd --device /dev/dri --ulimit memlock=-1 \
  --group-add "$(stat -c '%g' /dev/kfd)" \
  --cap-drop ALL --security-opt no-new-privileges \
  -p 127.0.0.1:18081:8080 -v "$MODEL_DIR:/models:ro" taranis:optimized \
  -m /models/UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf \
  --host 0.0.0.0 --port 8080 -c 32768 --parallel 1 --threads 8 --threads-batch 8 \
  -b 8192 -ub 8192 -ctk f16 -ctv f16 -dev ROCm0 -ngl all -fa on -fit off \
  --load-mode none --lazy-mode on-direct --spec-type draft-mtp --spec-draft-n-max 3 \
  --spec-draft-model /models/MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf \
  --spec-draft-device ROCm0 --spec-draft-ngl all --spec-draft-mtp-vocab 65536 \
  --spec-draft-sampling probabilistic \
  --alias qwen3.8-flash-next --no-cache-prompt --cache-ram 0 --cache-reuse 0 \
  --jinja --reasoning off --chat-template-kwargs '{"enable_thinking":false}' \
  --temp 0 --seed 1234
```

## Halogen asset conversion tools

The pinned public Halogen 0.18.19 image below is an asset conversion tool, not
the measured engine. Fetch the pinned draft/tokenizer, then losslessly repack
the common main GGUF.

```sh
export CONVERT_IMAGE=ghcr.io/peonist-ai/halogen-flash-server@sha256:f4ee69cafd334f5fed1173e998550dea00505e0df2bb3cb90b60d7a7aa1332f4
export ASSET_REV=75c745de73b4a731b593ee74807e8d15f617be74
mkdir -p "$ASSET_DIR/tokenizer"
for file in qwen38-flash-next-mtp.hgn tokenizer/chat_template.jinja \
  tokenizer/generation_config.json tokenizer/merges.txt tokenizer/tokenizer.json \
  tokenizer/tokenizer_config.json tokenizer/vocab.json; do
  curl -fL "https://huggingface.co/peonist-ai/halogen-qwen3.8-flash-next/resolve/$ASSET_REV/$file" \
    -o "$ASSET_DIR/$file"
done

docker run --rm --network none --user "$(id -u):$(id -g)" \
  -e HALOGEN_MTP_HEAD=/models/qwen38-flash-next-mtp.hgn \
  -v "$MODEL_DIR/UD-IQ4_XS:/gguf:ro" -v "$ASSET_DIR:/models" "$CONVERT_IMAGE" \
  convert /gguf/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf /models/common-ud-iq4xs.hgn

docker run --rm --network none --entrypoint /usr/local/bin/halogen-tools \
  -v "$ASSET_DIR:/models:ro" "$CONVERT_IMAGE" verify /models/common-ud-iq4xs.hgn --json
```

Compare the converted checkpoint hash with the recorded Halogen checkpoint hash
in the platform metadata.

## Strata asset conversion tools

Use a ROCm SDK 10.0.0 environment and set `SDK` to its absolute path.
Use HIP 7.15.26333, hipBLASLt 1.4.1 and AMD clang 23.0.0git.
The [image build stage](../image/Dockerfile) installs the recorded AMD gfx1151
RPMs at version `10.0.0-4` from the [public feed](../image/rocm.repo).
The pinned source and pack-tool revisions below are asset conversion tools,
not measured engine versions.

```sh
git clone https://github.com/Niko1221/Strata.git "$STRATA_DIR"
git -C "$STRATA_DIR" checkout --detach 870aedd9e1ebe1c91f94da93b59af17729f6c5c0
export PACK_TOOLS_DIR="${STRATA_DIR}-pack-tools"
git -C "$STRATA_DIR" worktree add --detach "$PACK_TOOLS_DIR" 4b9e05a2a806a3fe24f7b2560d98626c37dade35
git clone https://github.com/ggml-org/llama.cpp.git "$STRATA_DIR/third_party/llama.cpp"
git -C "$STRATA_DIR/third_party/llama.cpp" checkout --detach 3cf03257f219afbe7334045ff7c6a06ac68c627d

python3 -m venv "$STRATA_DIR/.venv"
. "$STRATA_DIR/.venv/bin/activate"
python -m pip install -r "$STRATA_DIR/requirements.txt" -r "$STRATA_DIR/requirements-build.txt"
export ROCM_PATH="$SDK" HIP_PATH="$SDK" HIP_PLATFORM=amd
export PATH="$SDK/bin:$SDK/lib/llvm/bin:$PATH"
export LD_LIBRARY_PATH="$SDK/lib/rocm_sysdeps/lib:$SDK/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export STRATA_GGUF_PY="$STRATA_DIR/third_party/llama.cpp/gguf-py"
export GGUF="$MODEL_DIR/UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf"
mkdir -p "$PACK_DIR"

python "$PACK_TOOLS_DIR/tools/iq_pack.py" --gguf "$GGUF" --out "$PACK_DIR/pack" --compat-bf16
bun benchmarks/strata-mtp.ts "$MODEL_DIR/MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf" "$PACK_DIR/mtp-src"
python "$PACK_TOOLS_DIR/tools/mtp_pack.py" --src "$PACK_DIR/mtp-src" --experts q2_0 --out "$PACK_DIR/mtp.gguf"
python "$PACK_TOOLS_DIR/tools/mtp_rt.py" --gguf "$PACK_DIR/mtp.gguf" --out "$PACK_DIR/mtp-rt"
cp "$PACK_TOOLS_DIR/data/draft_vocab.bin" "$PACK_DIR/mtp-rt/draft_vocab.bin"
```

The main pack includes the tokenizer and compatibility dense tensors. The MTP
adapter reconstructs the shared GGUF as BF16; pack tools encode Q2_0 experts.
Check `sha256sum` for `pack/dense.bin`, `mtp-rt/dense.bin`, `mtp-rt/experts.bin` and
`mtp-rt/draft_vocab.bin` against the recorded Strata asset hashes in the platform
metadata.

## Stock llama.cpp

The baseline builds unmodified `ggml-org/llama.cpp` at
`0ec4027a2a0183de87c007069adddc06e665f7de` with packaged HIP/ROCr.
Use the public self-contained Q8_0 draft from the same model revision; stock
cannot load the shared draft. It uses the full 248,320-token draft vocabulary.

```sh
bun run build.ts baseline
curl -fL https://huggingface.co/unsloth/Qwen3.8-Flash-Next-GGUF/resolve/766911a6b7369840a91dbcd95f9f997acaab6cd6/MTP/mtp-Qwen3.8-Flash-Next-Q8_0.gguf \
  -o "$MODEL_DIR/MTP/mtp-Qwen3.8-Flash-Next-Q8_0.gguf"
echo "58a47d6a216307e9b97172d5bfdc3436a8994b632f5e436b9bb6edf8951da8d1  $MODEL_DIR/MTP/mtp-Qwen3.8-Flash-Next-Q8_0.gguf" | sha256sum -c -

docker run --rm --device /dev/kfd --device /dev/dri --ulimit memlock=-1 \
  --group-add "$(stat -c '%g' /dev/kfd)" \
  --cap-drop ALL --security-opt no-new-privileges \
  -p 127.0.0.1:18084:8080 -v "$MODEL_DIR:/models:ro" taranis:baseline \
  -m /models/UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf \
  --alias qwen3.8-flash-next --host 0.0.0.0 --port 8080 \
  -c 32768 --parallel 1 --threads 8 --threads-batch 8 \
  -b 8192 -ub 8192 -ctk f16 -ctv f16 -dev ROCm0 -ngl all -fa on -fit off \
  --load-mode none --lazy-mode on --no-cache-prompt --cache-ram 0 --cache-reuse 0 \
  --jinja --reasoning off --chat-template-kwargs '{"enable_thinking":false}' \
  --temp 0 --seed 1234 \
  --spec-type draft-mtp --spec-draft-n-max 3 \
  --spec-draft-model /models/MTP/mtp-Qwen3.8-Flash-Next-Q8_0.gguf \
  --spec-draft-device ROCm0 --spec-draft-ngl all \
  --spec-draft-threads 8 --spec-draft-threads-batch 8 \
  --spec-draft-type-k f16 --spec-draft-type-v f16 --spec-draft-sampling probabilistic
```

## Server releases (Strix Halo and Gorgon Halo)

Set `RENDER_NODE` to your GPU render device, such as `/dev/dri/renderD128`.
Taranis and stock llama.cpp retain the recipes above.

### Halogen 0.18.21

Use the verified assets prepared above. Leave `HALOGEN_MTP_DEPTH` unset
(adaptive).

```sh
export IMAGE=ghcr.io/peonist-ai/halogen-flash-server@sha256:21006e5347f974241fd11e7bac5fc31759a4187f8267f7b52d8b564986b69821

docker run --rm --device /dev/kfd --device /dev/dri \
  --group-add "$(stat -c %g /dev/kfd)" \
  --group-add "$(stat -c %g /dev/dri/renderD128)" --ipc=host --ulimit memlock=-1:-1 \
  -p 127.0.0.1:18082:8731 -v "$ASSET_DIR:/models:ro" \
  -e HALOGEN_CHECKPOINT=/models/common-ud-iq4xs.hgn -e HALOGEN_TOKENIZER=/models/tokenizer \
  -e HALOGEN_CTX=32768 -e HALOGEN_KV_SLOTS=1 -e HALOGEN_KV_POOL_POSITIONS=32768 \
  -e HALOGEN_MAX_TOK=32768 -e HALOGEN_PROMPT_CACHE=0 -e HALOGEN_ENABLE_THINKING=0 \
  -e HALOGEN_TEMPERATURE=0 -e HALOGEN_DRAFTER_DEFAULT=1 -e HALOGEN_RECORD_TEXT=none \
  -e HALOGEN_MTP=1 -e HALOGEN_PLD=3,3 -e HALOGEN_MTP_GATE_P=0.90 "$IMAGE"
```

BF16 KV, adaptive draft depth up to 7 and prefill chunk 32768 are pinned image defaults.
Measurement ran the verified image's extracted userspace natively with its
packaged loader/libraries; the Docker recipe uses container wrapping.

### Strata app 0.2.9 / packaged engine 0.1.55

Reuse the verified `PACK_DIR` assets above. Set `STRATA_DIR` to a separate, fresh
source directory for this wrapper and `ENGINE_ARCHIVE` to an absolute download path.
The release archive supplies the engine and bundled runtimes.

```sh
git clone https://github.com/Niko1221/Strata.git "$STRATA_DIR"
git -C "$STRATA_DIR" checkout --detach c62d5e3a15b40ea51c96aae9e8d36928965f53ab
python3 -m venv "$STRATA_DIR/.venv"
. "$STRATA_DIR/.venv/bin/activate"
python -m pip install -r "$STRATA_DIR/requirements.txt" -r "$STRATA_DIR/requirements-build.txt"
curl -fL https://github.com/Niko1221/Strata/releases/download/v0.2.9/strata-engine-0.1.55-linux-x86_64-hip-halo.tar.gz \
  -o "$ENGINE_ARCHIVE"
echo "946adfa0a60815c49202f67ece8bec78530f24ab68d4e160c314a7ff32155217  $ENGINE_ARCHIVE" | sha256sum -c -
mkdir -p "$PACK_DIR/engine-release"
tar -xzf "$ENGINE_ARCHIVE" -C "$PACK_DIR/engine-release"
```

Set `ENGINE_DIR` to the extracted directory containing `strata` and its libraries.
The host launch below uses those packaged runtimes; measurement containerized
the wrapper. Set `EXPERT_CACHE` to `4096` for 128 GiB Strix Halo or `24576` for
Gorgon Halo. This budget produces variable-size slots. The generated config
sets the measured cache, prefill, precision and GPU-kernel flags; `--mtp-q4 all`
creates the runtime Q4 draft copies.

```sh
export EXPERT_CACHE=4096 # Strix Halo; use 24576 for Gorgon Halo
echo "d950cf5923efc981f03d0ad0a04d348c5a16943767bb9b547f26a4d9283650dc  $ENGINE_DIR/strata" | sha256sum -c -
bun benchmarks/strata-config.ts "$STRATA_DIR" "$MODEL_DIR" "$PACK_DIR" "$EXPERT_CACHE" > "$PACK_DIR/server.json"
export ENGINE_DIR PACK_DIR
bun -e '
const file = Bun.file(process.env.PACK_DIR + "/server.json"), c = await file.json(), e = process.env.ENGINE_DIR;
c.exe = e + "/strata"; c.model_name = "strata";
Object.assign(c.env, {LD_LIBRARY_PATH: e, ROCBLAS_TENSILE_LIBPATH: e + "/rocblas/library",
  HIPBLASLT_TENSILE_LIBPATH: e + "/hipblaslt/library",
  STRATA_HIPBLASLT_TUNING: e + "/tuning/gfx1151-hipblaslt-100401.txt"});
for (const flag of ["--prompt-cache", "--conversation-cache-mib"])
  if (!c.args.includes(flag)) c.args.push(flag, "0");
await Bun.write(file, JSON.stringify(c));
'
export STRATA_NO_PRESET=1 PYTHONNOUSERSITE=1 HIP_PLATFORM=amd
cd "$STRATA_DIR"
python -m serve.server --engine strata --config "$PACK_DIR/server.json" \
  --host 127.0.0.1 --port 18083 --no-api-key
```

### strix-llama.cpp b1038 / Vulkan

Upstream: [strix-llama.cpp](https://github.com/halo-box/strix-llama.cpp).
Measured Mesa RADV `26.2.5` / Vulkan loader `1.4.341.0`; the Dockerfile records
RPMs in `/opt/llama/versions.txt`, which can change with live Fedora repositories.
Use the stock draft download/verification above: self-contained Q8_0, greedy
depth 2 and vocabulary flag 0 (full 248,320 tokens).

```sh
docker build -f image/strixllama.Dockerfile \
  --build-arg LLAMA_COMMIT=6c9c7573c449a9961904cf4bd3414365df14e517 \
  --build-arg BUILD_JOBS=8 -t taranis:strixllama-vulkan .

docker run --rm --device "$RENDER_NODE" --group-add "$(stat -c %g "$RENDER_NODE")" \
  --ulimit memlock=-1 --cap-drop ALL --security-opt no-new-privileges \
  -p 127.0.0.1:18085:8080 -v "$MODEL_DIR:/models:ro" taranis:strixllama-vulkan \
  -m /models/UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf \
  --alias qwen3.8-flash-next --host 0.0.0.0 --port 8080 \
  -c 32768 --parallel 1 --threads 8 --threads-batch 8 \
  -b 8192 -ub 8192 -ctk f16 -ctv f16 -dev Vulkan0 -ngl all -fa on -fit off \
  --load-mode none --lazy-mode on-direct --no-cache-prompt --cache-ram 0 --cache-reuse 0 \
  --jinja --reasoning off --chat-template-kwargs '{"enable_thinking":false}' \
  --temp 0 --seed 1234 --spec-type draft-mtp --spec-draft-n-max 2 \
  --spec-draft-model /models/MTP/mtp-Qwen3.8-Flash-Next-Q8_0.gguf \
  --spec-draft-device Vulkan0 --spec-draft-ngl all \
  --spec-draft-threads 8 --spec-draft-threads-batch 8 \
  --spec-draft-type-k f16 --spec-draft-type-v f16 \
  --spec-draft-sampling greedy --spec-draft-mtp-vocab 0
```
