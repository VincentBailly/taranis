# Benchmark results

Other engine results use the competitor releases checked on 2026-10-31.
Taranis was rerun on 2026-11-01 with the same 40-patch build on both GPUs.

Each GPU ran one engine at a time, with CPU work and transfers idle during
measurement. The Gorgon Halo Vulkan run followed a completed CPU build; its
first four engine suites were retained unchanged.

All engines used the same verified Unsloth Qwen3.8-Flash-Next UD-IQ4_XS main GGUF
shards, revision `766911a6b7369840a91dbcd95f9f997acaab6cd6`. Taranis used the
public shared-Q8_0 MTP draft. Stock llama.cpp and strix-llama.cpp used the public
self-contained Q8_0 variant. Halogen losslessly repacked all 1,198 main tensors;
Strata used dense compatibility copies and native expert quants.

## Protocol

`synthetic-chat-v1` in [compare.ts](compare.ts): five fabricated tasks covering
code, prose, JSON, a 2,999-token prompt and an 8,146-token prompt. Each engine
warmed all five shapes, then ran three sequential repetitions. Every measured
response reached the 256-token cap. Native prompt counts were
87, 90, 97, 2,999 and 8,146 for every engine suite.

Context 32,768; concurrency 1; temperature 0; seed 1234; thinking off.
Cross-request prompt caches and learned lookup/suffix drafts were disabled.
MTP remained enabled; Halogen retained its pinned stateless prompt lookup.
Models were already loaded. The client ran on the GPU host over numeric
loopback, using a fresh HTTP connection for each request.

## Gorgon Halo

Ryzen AI Max+ PRO 495 / Radeon 8065S, 192 GiB installed RAM, Linux 6.18.57.
75 measured requests across five engines.

| Engine | Decode (tok/s) | Prefill (tok/s) | 8K first token (s) | 15-request time (s) |
|---|---:|---:|---:|---:|
| Taranis | 63.4 | 1,511 | 4.67 | 83.1 |
| Halogen 0.18.21 | 50.7 | 1,527 | 4.62 | 97.9 |
| Strata 0.2.9 | 51.3 | 629 | 8.13 | 129.6 |
| strix-llama.cpp b1038 (Vulkan) | 36.4 | 831 | 8.76 | 146.5 |
| Stock llama.cpp | 36.6 | 543 | 14.72 | 167.8 |

## Strix Halo

Ryzen AI Max+ 395 / Radeon 8060S, 128 GiB installed RAM, Linux 7.0.0-38-generic.
75 measured requests across five engines.

| Engine | Decode (tok/s) | Prefill (tok/s) | 8K first token (s) | 15-request time (s) |
|---|---:|---:|---:|---:|
| Taranis | 55.4 | 1,238 | 5.72 | 96.8 |
| Halogen 0.18.21 | 45.7 | 1,278 | 5.54 | 110.6 |
| Strata 0.2.9 | 33.8 | 504 | 10.20 | 182.0 |
| strix-llama.cpp b1038 (Vulkan) | 33.9 | 698 | 10.64 | 162.0 |
| Stock llama.cpp | 29.8 | 464 | 17.05 | 202.3 |

Strata used `--expert-cache 4096` to fit 128 GiB; Gorgon Halo used 24,576.

## What the columns measure

Decode counts visible output with the common GGUF tokenizer and divides tokens
after the first streamed chunk by elapsed first-to-last chunk time, pooled
across all 15 responses. Retokenization at chunk boundaries is approximate.
Prefill divides total native prompt tokens by total engine-reported prompt time.
Timing boundaries can differ between engines. 8K first-token time is the median
of three requests. Suite time includes prefill, decode and HTTP overhead for
the 15 measured requests. Warmup and model loading are excluded.

Native timings, common-token rates and output hashes are in
[Strix results](benchmarks/strix-halo-results.json) and
[Gorgon results](benchmarks/results.json). Raw synthetic outputs stay local.
Model hashes, engine versions, converted-asset hashes, flags and run orders
are in [Strix metadata](benchmarks/strix-halo-metadata.json) and
[Gorgon metadata](benchmarks/gorgon-halo-metadata.json).

## Engine settings

- Taranis: 40 patches on `da731374077f2ad9bdffd4848f782b5694b9bb68`;
  retained-PM4 HIP/ROCr `5bdc7e255d1a1a8b6319df3621380722485af8ec`; ROCm RPM 10.0.0-4.
  F16 KV; batch/microbatch 8,192; 8 CPU threads; shared Q8_0 MTP, draft max 3,
  65,536-token draft vocabulary, probabilistic verification.
- Stock llama.cpp: unmodified `ggml-org/llama.cpp` at
  `0ec4027a2a0183de87c007069adddc06e665f7de`, packaged ROCm RPM 10.0.0-4.
  F16 KV; batch/microbatch 8,192; 8 CPU threads; self-contained Q8_0 MTP,
  draft max 3, full 248,320-token draft vocabulary, probabilistic verification.
- Halogen 0.18.21 on both platforms.
  Lossless main-GGUF repack; its own public MTP head; BF16 KV; adaptive draft
  up to 7, threshold 0.90; prefill chunk 32,768; pinned prompt lookup.
  Both runs used the same pinned userspace binaries and libraries.
- Strata: app 0.2.9 / engine 0.1.55 on both platforms. Native expert quants,
  mostly BF16 dense compatibility copies;
  int8 KV; Q4 MTP draft max 4, threshold 0.5; prefill 16,384.
  Optimized gfx1151 kernels enabled; lookup/suffix caches off.
  Expert-cache budget: 24,576 on Gorgon Halo; 4,096 on Strix Halo.
- strix-llama.cpp: unmodified `halo-box/strix-llama.cpp` b1038 at
  `6c9c7573c449a9961904cf4bd3414365df14e517`, its recommended Vulkan backend,
  Mesa RADV 26.2.5 and Vulkan loader 1.4.341. F16 KV; batch/microbatch 8,192;
  8 CPU threads; self-contained Q8_0 MTP, default greedy verification,
  draft max 2, full 248,320-token vocabulary.

Precision, runtime, backend and draft settings differ. These results measure
capped synthetic response speed. Output quality needs a separate check.

## Repeat the test

Use [the public model-preparation and launch commands](benchmarks/SETUP.md).
Run the client from the repository root on the GPU host with CPU/GPU work idle.
Follow the selected platform's recorded engine order in metadata.

```sh
# Start one engine at a time; wait until healthy, measure, then stop it.
bun compare.ts http://127.0.0.1:18083 strata > strata.json
bun compare.ts http://127.0.0.1:18082 halogen > halogen.json
bun compare.ts http://127.0.0.1:18084 llamacpp > llamacpp.json
bun compare.ts http://127.0.0.1:18081 taranis > taranis.json
bun compare.ts http://127.0.0.1:18085 strixllama > strixllama.json
# Restart Taranis for tokenization; reuse its measured report.
bun normalize.ts http://127.0.0.1:18081 taranis.json halogen.json strata.json llamacpp.json strixllama.json > results.json
```

The commands show the measured order for both platforms. If an engine does not
load, record the failure and omit its report from normalization. The runner
rejects cached prompts, reasoning output and incomplete generations; the
normalizer checks matching requests/counts and removes output text.
