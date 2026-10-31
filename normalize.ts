const args = Bun.argv.slice(2);
const settings = { model: "qwen3.8-flash-next", temperature: 0, seed: 1234, max_tokens: 256,
  chat_template_kwargs: { enable_thinking: false }, cache_prompt: false,
  stream: true, stream_options: { include_usage: true } };
const ids = ["short-code", "short-prose", "short-json", "long-code", "long-reasoning"];
const timingKeys = ["cache_n", "prompt_n", "prompt_ms", "predicted_n", "predicted_ms"];
const usageKeys = ["prompt_tokens", "completion_tokens", "total_tokens"];
function check(ok: boolean) { if (!ok) throw new Error("Invalid benchmark data."); }
function numeric(value: any, keys: string[]) {
  const result: Record<string, number> = {};
  for (const k of keys) { check(typeof value?.[k] === "number" && Number.isFinite(value[k]) && value[k] >= 0); result[k] = value[k]; }
  return result;
}
async function main() {
  if (args.length < 2) throw new Error("Usage: bun normalize.ts <loopback-tokenizer-base> <report.json>...");
  const url = new URL(args[0]);
  check((/^127\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname === "[::1]") &&
    ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash);
  url.pathname = "/tokenize";
  async function count(content: string) {
    check(typeof content === "string");
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Connection: "close" },
      body: JSON.stringify({ content, add_special: false, parse_special: false }), redirect: "error", proxy: false });
    check(response.ok);
    const data = await response.json(); check(Array.isArray(data.tokens)); return data.tokens.length;
  }
  const reports = [];
  let promptReference: string | undefined;
  let nativeCounts: string | undefined;
  for (const filename of args.slice(1)) {
    const r = await Bun.file(filename).json();
    check(r.profile === "synthetic-chat-v1" && ["taranis", "halogen", "strata", "llamacpp", "strixllama"].includes(r.label) &&
      JSON.stringify(r.settings) === JSON.stringify(settings) && r.warmup_requests === 5 && r.measured_requests === 15 &&
      r.prompts.length === 5 && r.samples.length === 15);
    const promptContents = JSON.stringify(r.prompts.map((p: any) => p.content));
    promptReference ??= promptContents; check(promptContents === promptReference);
    const prompts = [];
    for (const [i, p] of r.prompts.entries()) { check(p.prompt_id === ids[i]); prompts.push({ prompt_id: ids[i], content_tokens: await count(p.content) }); }
    const samples = [];
    for (const [i, s] of r.samples.entries()) {
      check(s.prompt_id === ids[i % 5] && s.repetition === 1 + Math.floor(i / 5) && s.finish_reason === "length");
      check((s.usage?.prompt_tokens_details?.cached_tokens ?? 0) === 0 &&
        (s.usage?.completion_tokens_details?.reasoning_tokens ?? 0) === 0);
      const timings = numeric(s.timings, timingKeys), usage = numeric(s.usage, usageKeys);
      check(usageKeys.every(k => Number.isSafeInteger(usage[k])) && usage.total_tokens === usage.prompt_tokens + usage.completion_tokens);
      check(timings.cache_n === 0 && timings.predicted_n === 256 && usage.completion_tokens === 256 && timings.prompt_n === usage.prompt_tokens);
      const times = numeric(s, ["TTFT_ms", "final_content_ms", "wall_ms", "decode_wall_ms"]);
      check(times.wall_ms >= times.final_content_ms && times.final_content_ms >= times.TTFT_ms && times.decode_wall_ms > 0 &&
        Math.abs(times.decode_wall_ms - (times.final_content_ms - times.TTFT_ms)) <= 0.001);
      check(typeof s.content === "string" && typeof s.first_content === "string" && s.content.startsWith(s.first_content));
      const output_tokens = await count(s.content), first_chunk_tokens = await count(s.first_content);
      check(output_tokens > first_chunk_tokens && first_chunk_tokens > 0);
      const hash = new Bun.CryptoHasher("sha256").update(s.content).digest("hex"); check(hash === s.output_sha256);
      samples.push({ prompt_id: ids[i % 5], repetition: 1 + Math.floor(i / 5), finish_reason: "length",
        output_sha256: hash, ...times, timings, usage, output_tokens, first_chunk_tokens });
    }
    const counts = JSON.stringify(samples.map(s => s.timings.prompt_n)); nativeCounts ??= counts; check(counts === nativeCounts);
    const sum = (k: string) => samples.reduce((n, s: any) => n + s[k], 0);
    const totals = { output_tokens: sum("output_tokens"), first_chunk_tokens: sum("first_chunk_tokens"),
      wall_ms: sum("wall_ms"), decode_wall_ms: sum("decode_wall_ms") };
    const native_totals = { prompt_tokens: samples.reduce((n, s) => n + s.timings.prompt_n, 0),
      decode_tokens: samples.reduce((n, s) => n + s.timings.predicted_n, 0),
      prompt_ms: samples.reduce((n, s) => n + s.timings.prompt_ms, 0), decode_ms: samples.reduce((n, s) => n + s.timings.predicted_ms, 0) };
    reports.push({ profile: "synthetic-chat-v1", label: r.label, settings, warmup_requests: 5, measured_requests: 15, prompts, samples,
      aggregate: { ...totals, end_to_end_tokens_per_second: totals.output_tokens / totals.wall_ms * 1000,
        streamed_decode_tokens_per_second: (totals.output_tokens - totals.first_chunk_tokens) / totals.decode_wall_ms * 1000 }, native_totals });
  }
  console.log(JSON.stringify({ tokenizer: "common llama.cpp GGUF vocabulary; no special tokens added", reports }, null, 2));
}
try { await main(); } catch { console.error("Normalization failed; use a loopback tokenizer and complete matching synthetic-chat-v1 reports."); process.exitCode = 1; }
