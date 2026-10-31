import { resolve, join } from "node:path";

const [source, model, assets, cache = "24576"] = Bun.argv.slice(2);
if (!source || !model || !assets || ![5, 6].includes(Bun.argv.length) || !/^\d+$/.test(cache) || Number(cache) < 1) {
  console.error("Usage: bun benchmarks/strata-config.ts <strata-dir> <gguf-dir> <assets-dir> [expert-cache-budget]");
  process.exit(1);
}
const s = resolve(source), m = resolve(model), p = resolve(assets);
console.log(JSON.stringify({
  backend: "hip", exe: join(s, "build-halo/strata"), cwd: s,
  log: join(p, "engine.log"), tokenizer: join(p, "pack/tokenizer"),
  model_name: "strata", drafting: "mtp", sampling: { temperature: 0, seed: 1234 },
  args: [
    "--pack", join(p, "pack"), "--native", join(m, "UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf"),
    "--expert-profile", join(s, "data/expert-profile.bin"), "--expert-cache", cache,
    "--prefill", "16384", "--spec", "4", "--spec-min-p", "0.5",
    "--mtp", join(p, "mtp-rt"), "--mtp-q4", "all", "--lookup-chain", "0", "--suffix-draft", "0",
    "--max-context", "32768", "--kv", "int8", "--prompt-cache", "0", "--conversation-cache-mib", "0",
  ],
  env: {
    STRATA_HIPBLASLT_TUNING: join(s, "tools/hip/gfx1151-hipblaslt-100401.txt"),
    STRATA_PF_FUSED: "1", STRATA_PF_GEMM: "1", STRATA_HC_UPMIX: "1", STRATA_PA_FAST: "1",
    STRATA_HIP_WMMA: "1", STRATA_SELECT_WMMA: "1", STRATA_PF_SWITCH_MIN_T: "4096", STRATA_PREFILL_STREAM_MIN: "128",
  },
}, null, 2));
