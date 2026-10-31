const help = [
  "Usage: bun benchmark.ts <base-url> [baseline|taranis]",
  "HTTP(S) numeric loopback only (127.0.0.0/8 or [::1]); no credentials, paths, queries or fragments.",
  "One warmup, then three synthetic measured native /completion requests, sequentially.",
  "Fixed: temperature=0, seed=42, n_predict=256, ignore_eos=true, cache_prompt=false, stream=false.",
  "JSON reports counts, server milliseconds, aggregate tokens/s and SHA-256 text hashes.",
  "Run servers separately if needed; use identical model/server settings, verified by the caller.",
  "No speedup or model/settings equivalence is claimed. Use --help for this text.",
].join("\n");

const settings = {
  temperature: 0,
  seed: 42,
  n_predict: 256,
  ignore_eos: true,
  cache_prompt: false,
  stream: false,
};
const prompts = [16, 48, 96].map((length) =>
  "Continue these synthetic numbered entries in the same format.\n" +
  Array.from({ length }, (_, i) => "Entry " + (i + 1) + ": alpha beta gamma delta.\n").join("") +
  "Entry " + (length + 1) + ":"
);

class BenchmarkError extends Error {}

function endpoint(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new BenchmarkError("Invalid base URL. Use --help.");
  }
  // Literal addresses avoid DNS; URL parsing canonicalizes IPv4 spellings.
  const local = url.hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  if (!local || !["http:", "https:"].includes(url.protocol) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new BenchmarkError("Use an HTTP(S) numeric loopback base without credentials, paths, queries or fragments.");
  }
  url.pathname = "/completion";
  return url;
}

async function measure(url: URL, prompt: string, phase: string) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...settings, prompt }),
      redirect: "error",
      proxy: false,
      signal: AbortSignal.timeout(600_000),
    });
  } catch {
    throw new BenchmarkError(phase + ": request failed, timed out or redirected; no report produced.");
  }
  if (!response.ok) {
    throw new BenchmarkError(phase + ": HTTP " + response.status + "; no report produced.");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new BenchmarkError(phase + ": invalid JSON response; no report produced.");
  }
  if (!data || typeof data.content !== "string") {
    throw new BenchmarkError(phase + ": missing generated text; no report produced.");
  }
  const t = data.timings;
  if (!t || ![t.prompt_n, t.predicted_n].every((n) => Number.isSafeInteger(n) && n > 0) ||
      ![t.prompt_ms, t.predicted_ms].every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) {
    throw new BenchmarkError(phase + ": missing or invalid server timings/counts; no report produced.");
  }
  if ((t.cache_n ?? 0) !== 0) {
    throw new BenchmarkError(phase + ": prompt-cache reuse; no report produced.");
  }
  if (t.predicted_n !== settings.n_predict || data.truncated === true || data.stop === false ||
      data.stopped_eos === true || data.stopped_word === true ||
      (data.stop_type !== undefined && data.stop_type !== "limit") ||
      (data.tokens_predicted !== undefined && data.tokens_predicted !== t.predicted_n)) {
    throw new BenchmarkError(phase + ": partial, truncated or inconsistent generation (expected 256 tokens); no report produced.");
  }
  return {
    prompt_tokens: t.prompt_n as number,
    decode_tokens: t.predicted_n as number,
    prompt_ms: t.prompt_ms as number,
    decode_ms: t.predicted_ms as number,
    text_sha256: new Bun.CryptoHasher("sha256").update(data.content).digest("hex"),
  };
}

async function main() {
  const args = Bun.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(help);
    return;
  }
  if (args.length < 1 || args.length > 2 ||
      (args.length === 2 && !["baseline", "taranis"].includes(args[1]))) {
    throw new BenchmarkError("Expected one base URL and optional label baseline or taranis. Use --help.");
  }
  const url = endpoint(args[0]);
  const label = args[1] ?? "taranis";
  await measure(url, prompts[0], "warmup");
  const samples = [];
  for (const [i, prompt] of prompts.entries()) {
    samples.push({ sample: i + 1, ...await measure(url, prompt, "sample " + (i + 1)) });
  }
  const totals = { prompt_tokens: 0, decode_tokens: 0, prompt_ms: 0, decode_ms: 0 };
  for (const sample of samples) {
    totals.prompt_tokens += sample.prompt_tokens;
    totals.decode_tokens += sample.decode_tokens;
    totals.prompt_ms += sample.prompt_ms;
    totals.decode_ms += sample.decode_ms;
  }
  const aggregate = {
    ...totals,
    prompt_tokens_per_second: totals.prompt_tokens / totals.prompt_ms * 1000,
    decode_tokens_per_second: totals.decode_tokens / totals.decode_ms * 1000,
  };
  if (!Object.values(aggregate).every(Number.isFinite)) {
    throw new BenchmarkError("Invalid aggregate timings; no report produced.");
  }
  console.log(JSON.stringify({
    profile: "synthetic-v1",
    label,
    settings,
    warmup_requests: 1,
    measured_requests: prompts.length,
    comparison: "Not established: identical model and server settings must be verified by the caller.",
    samples,
    aggregate,
  }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof BenchmarkError ? error.message : "Benchmark failed; no report produced.");
  process.exitCode = 1;
}
