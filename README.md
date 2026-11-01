# Taranis

<p align="center">
  <img src="assets/taranis-logo.png" alt="Taranis logo" width="360">
</p>

Taranis is an inference engine for Qwen3.8-Flash-Next, targeting
AMD gfx1151 GPUs in **Strix Halo and Gorgon Halo**.

The engine and tuned HIP/ROCr runtime are **fully open source**. We ship code;
you bring the weights. Choose compatible GGUF model files and, for MTP, a GGUF
draft from a source you trust. Taranis requires no private checkpoint or
publisher-only draft head.

In our synthetic MTP tests, Taranis delivered **86% faster decode than stock
llama.cpp on Strix Halo** and **73% faster decode on Gorgon Halo**.
Taranis was rerun on 2026-11-01; the other results are from 2026-10-31.

## Speed you can check

Gorgon Halo: Ryzen AI Max+ PRO 495 / Radeon 8065S, 192 GiB RAM.

| Engine | Decode (tok/s) | Prefill (tok/s) | 8K first token (s) | 15-request time (s) |
|---|---:|---:|---:|---:|
| Taranis | 63.4 | 1,511 | 4.67 | 83.1 |
| Halogen 0.18.21 | 50.7 | 1,527 | 4.62 | 97.9 |
| Strata 0.2.9 | 51.3 | 629 | 8.13 | 129.6 |
| strix-llama.cpp b1038 (Vulkan) | 36.4 | 831 | 8.76 | 146.5 |
| Stock llama.cpp | 36.6 | 543 | 14.72 | 167.8 |

Strix Halo: Ryzen AI Max+ 395 / Radeon 8060S, 128 GiB RAM.

| Engine | Decode (tok/s) | Prefill (tok/s) | 8K first token (s) | 15-request time (s) |
|---|---:|---:|---:|---:|
| Taranis | 55.4 | 1,238 | 5.72 | 96.8 |
| Halogen 0.18.21 | 45.7 | 1,278 | 5.54 | 110.6 |
| Strata 0.2.9 | 33.8 | 504 | 10.20 | 182.0 |
| strix-llama.cpp b1038 (Vulkan) | 33.9 | 698 | 10.64 | 162.0 |
| Stock llama.cpp | 29.8 | 464 | 17.05 | 202.3 |

All engines used MTP and the same verified main GGUF source files, with their
own precision and draft settings. strix-llama.cpp used its recommended Vulkan
backend; the other engines used HIP. Strata used a smaller expert cache on
Strix Halo to fit its memory.

Results use loaded models, cold prompt caches and 256-token responses. Prefill
uses each engine's reported prompt timing; timing boundaries can differ.
See [the test conditions and timing data](BENCHMARKS.md).

## An open stack behind the speed

Taranis combines 40 model-kernel and scheduling patches with a tuned
HIP/ROCr runtime. Optimization reaches from speculative verification to
GPU command submission.

You get the patches, source pins and benchmark scripts behind the numbers.
Inspect the engine, change it, and run the same test on your own machine.

## Requirements

Linux with a working AMD GPU driver and `/dev/kfd` / `/dev/dri`,
Docker with Buildx, [Bun](https://bun.sh), and enough memory for your GGUF model.
Model weights are supplied separately under their own license.

## Build and run

```sh
bun run build.ts

# Set your GGUF directory and filename.
export MODEL_DIR=/absolute/path/to/gguf
export MODEL_FILE=model.gguf

docker run --rm --device /dev/kfd --device /dev/dri \
  --group-add "$(stat -c '%g' /dev/kfd)" \
  --cap-drop ALL --security-opt no-new-privileges \
  -p 127.0.0.1:8080:8080 -v "$MODEL_DIR:/models:ro" \
  taranis:optimized \
  -m "/models/$MODEL_FILE" --host 0.0.0.0 --port 8080 \
  -c 8192 --parallel 1 -ngl all -fa on \
  --load-mode none --lazy-mode on-direct
```

For MTP speculative decoding, add a compatible GGUF draft model inside the
mounted directory and append these server arguments. Replace `mtp.gguf` with
your draft filename:

```sh
--spec-type draft-mtp --spec-draft-model /models/mtp.gguf \
--spec-draft-device ROCm0 --spec-draft-ngl all --spec-draft-n-max 3 \
--spec-draft-mtp-vocab 65536 --spec-draft-sampling probabilistic
```

The published comparison uses MTP and the full configuration in
[BENCHMARKS.md](BENCHMARKS.md). The commands above start a basic server.

Kernel math, batch sizes and speculative verification can change generated
text. Check output quality for your workload.

## Run your own comparison

[BENCHMARKS.md](BENCHMARKS.md#repeat-the-test) gives the matched-engine procedure.
`bun run build.ts baseline` builds unmodified `ggml-org/llama.cpp` with the
packaged ROCm runtime; `bun run benchmark.ts --help` explains its test.

## License

MIT for Taranis's contributions. Built on llama.cpp and community ROCm work;
see [NOTICE.md](NOTICE.md) and [LICENSES](LICENSES) for credits and upstream licenses.
