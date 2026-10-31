const help = "Usage: bun compare.ts <loopback-base-url> <taranis|halogen|strata|llamacpp|strixllama>";
const settings = {
  model: "qwen3.8-flash-next",
  temperature: 0,
  seed: 1234,
  max_tokens: 256,
  chat_template_kwargs: { enable_thinking: false },
  cache_prompt: false,
  stream: true,
  stream_options: { include_usage: true },
};

// Fixed fabricated inputs, not repeated output continuations. Lengths are approximate.
function records(count: number): string {
  const groups = ["amber", "cobalt", "ivory", "jade", "violet", "silver", "ochre"];
  const operations = ["cut", "polish", "inspect", "pack", "calibrate", "assemble"];
  return Array.from({ length: count }, (_, i) => {
    const id = (n: number) => "job-" + String(n + 1).padStart(3, "0");
    return [
      "id=" + id(i),
      "group=" + groups[(i * 3 + Math.floor(i / 7)) % groups.length],
      "operation=" + operations[(i * 5 + Math.floor(i / 11)) % operations.length],
      "priority=" + (1 + (i * 7) % 9),
      "units=" + (23 + (i * 83) % 877),
      "minutes=" + (11 + (i * 37) % 169),
      "rejects=" + ((i * 13 + 3) % 17),
      "lane=" + ["north", "east", "south", "west"][(i + Math.floor(i / 5)) % 4],
      "crew=" + (1 + (i * 3) % 8),
      "dependency=" + (i === 0 || i % 4 === 0 ? "none" : id((i * 7 + Math.floor(i / 3) + 5) % i)),
    ].join("; ");
  }).join("\n");
}

const prompts = [
  {
    prompt_id: "short-code",
    description: "Short coding request for a substantial TypeScript implementation.",
    content: "Write a complete TypeScript in-memory inventory ledger. Support receive, reserve, release, and ship operations with unique transaction IDs, atomic validation, idempotent retries, and per-item available quantities. Reject conflicting retries, negative amounts, and shipping more than reserved. Include types, an implementation, and a worked usage example with several different transactions. Return code only, not a sketch.",
  },
  {
    prompt_id: "short-prose",
    description: "Short explanatory request requiring at least 400 words.",
    content: "Write at least 400 words explaining how a fictional floating greenhouse could balance water recycling, heat storage, pollination, and maintenance during a five-day artificial winter. Compare two distinct designs, explain their failure modes and tradeoffs, and recommend one using concrete invented examples. Use varied explanatory prose, not a list of repeated entries. All places, quantities, and events must be fictional.",
  },
  {
    prompt_id: "short-json",
    description: "Short JSON request requiring at least 50 varied synthetic records.",
    content: "Return only a valid JSON array of at least 50 fictional workshop experiments. Each record must have a unique integer id, an invented experiment name, a material, a numeric temperature, a duration_minutes value, a boolean succeeded, and a short explanation of a distinct result. Vary materials, outcomes, and explanations; do not repeat a template sentence. Produce every record in full, with no ellipses or placeholders.",
  },
  {
    prompt_id: "long-code",
    description: "Approximately 3k-token fabricated job ledger and substantial coding task.",
    content: "The following synthetic workshop jobs use semicolon-separated key=value fields. Write a complete TypeScript parser and scheduling implementation for this ledger. Validate unique IDs, existing dependencies, nonnegative quantities, and acyclic dependencies. Schedule ready jobs by descending priority, then ascending minutes, then ID; a crew can run only one job at a time. Return the schedule, group totals for usable units (units minus rejects), and makespan. Include types, error handling, and a worked example based on three different jobs below. Return code, not a continuation of the records.\n\n" + records(56),
  },
  {
    prompt_id: "long-reasoning",
    description: "Approximately 8k-token fabricated job ledger and analytical prose task.",
    content: "Analyze this entirely fabricated workshop ledger. Usable units equal units minus rejects. Higher priority is more urgent; dependencies must finish before their dependents, and each crew can do only one job at a time. Write at least 400 words recommending a first-shift plan with a 240-minute horizon. Select six concrete jobs from different groups, explain their ordering and dependency costs, show useful arithmetic, contrast two resource-allocation strategies, and discuss bottlenecks and reject risk. Do not reproduce the ledger or continue its format. Use diverse analytical prose and a concise final recommendation.\n\n" + records(156),
  },
];

class BenchmarkError extends Error {}

function endpoint(input: string): URL {
  // Check the literal spelling too: URL normalization alone accepts nonliteral IPv4 forms.
  if (!/^https?:\/\/(127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?\/?$/.test(input)) {
    throw new BenchmarkError("Use an HTTP(S) literal numeric loopback base, without credentials, paths, queries or fragments.");
  }
  try {
    const url = new URL(input);
    if (url.hostname !== "[::1]" && !/^127\.\d+\.\d+\.\d+$/.test(url.hostname)) throw new Error();
    url.pathname = "/v1/chat/completions";
    return url;
  } catch {
    throw new BenchmarkError("Invalid numeric loopback base URL.");
  }
}

function numbers(value: any, keys: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of keys) {
    if (typeof value?.[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0) {
      result[key] = value[key];
    }
  }
  return result;
}

const timingKeys = ["cache_n", "prompt_n", "prompt_ms", "prompt_per_token_ms", "prompt_per_second",
  "predicted_n", "predicted_ms", "predicted_per_token_ms", "predicted_per_second"];
const usageKeys = ["prompt_tokens", "completion_tokens", "total_tokens"];

async function measure(url: URL, prompt: string, phase: string) {
  const start = performance.now();
  let first: number | undefined;
  let last = start;
  let content = "";
  let first_content = "";
  let finish_reason: string | null = null;
  let timings: Record<string, number> = {};
  let usage: Record<string, any> = {};
  let done = false;

  function event(frame: string) {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).replace(/^ /, "")).join("\n");
    if (!data) return;
    if (data.trim() === "[DONE]") { done = true; return; }
    const value = JSON.parse(data);
    const u = value.usage;
    if ((value.timings?.cache_n ?? 0) !== 0 || (u?.prompt_tokens_details?.cached_tokens ?? 0) !== 0 ||
        (u?.completion_tokens_details?.reasoning_tokens ?? 0) !== 0) {
      throw new BenchmarkError(phase + ": prompt-cache reuse or reasoning tokens; no report produced.");
    }
    if (usageKeys.some(key => u?.[key] !== undefined && (!Number.isSafeInteger(u[key]) || u[key] < 0)) ||
        (u?.prompt_tokens !== undefined && u?.completion_tokens !== undefined && u?.total_tokens !== undefined &&
          u.total_tokens !== u.prompt_tokens + u.completion_tokens)) {
      throw new BenchmarkError(phase + ": invalid usage counts; no report produced.");
    }
    Object.assign(timings, numbers(value.timings, timingKeys));
    Object.assign(usage, numbers(value.usage, usageKeys));
    for (const key of ["prompt_tokens_details", "completion_tokens_details"]) {
      const details = numbers(value.usage?.[key], ["cached_tokens", "reasoning_tokens", "audio_tokens",
        "accepted_prediction_tokens", "rejected_prediction_tokens"]);
      if (Object.keys(details).length) usage[key] = { ...usage[key], ...details };
    }
    const choice = value.choices?.[0];
    if (typeof choice?.finish_reason === "string") {
      finish_reason = ["stop", "length", "content_filter", "tool_calls", "function_call"].includes(choice.finish_reason)
        ? choice.finish_reason : "other";
    }
    const delta = choice?.delta;
    if (delta?.reasoning_content || delta?.reasoning) throw new BenchmarkError(phase + ": thinking-off request emitted reasoning.");
    for (const text of [delta?.content]) {
      if (typeof text !== "string" || !text.length) continue;
      const now = performance.now();
      if (first === undefined) { first = now; first_content = text; }
      last = now;
      content += text;
    }
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Connection: "close" },
      body: JSON.stringify({ ...settings, messages: [{ role: "user", content: prompt }] }),
      redirect: "error",
      proxy: false,
      signal: AbortSignal.timeout(600_000),
    });
    if (!response.ok) throw new BenchmarkError(phase + ": HTTP " + response.status + "; no report produced.");
    if (!response.body) throw new BenchmarkError(phase + ": missing stream; no report produced.");
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      if (done) continue;
      buffer += decoder.decode(chunk, { stream: true });
      let boundary: RegExpExecArray | null;
      while (!done && (boundary = /\r?\n\r?\n/.exec(buffer))) {
        event(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
    }
    if (!done) event(buffer + decoder.decode());
  } catch (error) {
    if (error instanceof BenchmarkError) throw error;
    throw new BenchmarkError(phase + ": request or SSE stream failed; no report produced.");
  }
  if (!done || finish_reason !== "length" || usage.completion_tokens !== settings.max_tokens ||
      timings.predicted_n !== settings.max_tokens || timings.cache_n !== 0) {
    throw new BenchmarkError(phase + ": incomplete generation or prompt-cache reuse; no report produced.");
  }
  if ((usage.prompt_tokens !== undefined && timings.prompt_n !== undefined && usage.prompt_tokens !== timings.prompt_n) ||
      (usage.prompt_tokens !== undefined && usage.total_tokens !== undefined &&
        usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens)) {
    throw new BenchmarkError(phase + ": inconsistent usage counts; no report produced.");
  }
  const wall_ms = performance.now() - start;
  if (first === undefined || !content.trim()) throw new BenchmarkError(phase + ": no generated text; no report produced.");
  return {
    content,
    first_content,
    output_sha256: new Bun.CryptoHasher("sha256").update(content).digest("hex"),
    finish_reason,
    TTFT_ms: first - start,
    final_content_ms: last - start,
    wall_ms,
    decode_wall_ms: last - first,
    timings,
    usage,
  };
}

async function main() {
  const args = Bun.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) { console.log(help); return; }
  if (args.length !== 2 || !["taranis", "halogen", "strata", "llamacpp", "strixllama"].includes(args[1])) {
    throw new BenchmarkError(help);
  }
  const url = endpoint(args[0]);
  for (const prompt of prompts) await measure(url, prompt.content, "warmup " + prompt.prompt_id);
  const samples = [];
  for (let repetition = 1; repetition <= 3; repetition++) {
    for (const prompt of prompts) {
      samples.push({ prompt_id: prompt.prompt_id, repetition,
        ...await measure(url, prompt.content, prompt.prompt_id + " repetition " + repetition) });
    }
  }
  // Only sum counts/durations, never rates; omit totals lacking any measured sample.
  const native_totals: Record<string, Record<string, number>> = { timings: {}, usage: {} };
  for (const [source, keys] of [["timings", ["cache_n", "prompt_n", "predicted_n", "prompt_ms", "predicted_ms"]],
    ["usage", usageKeys]] as const) {
    for (const key of keys) {
      if (samples.every(sample => typeof sample[source][key] === "number")) {
        native_totals[source][key] = samples.reduce((sum, sample) => sum + sample[source][key], 0);
      }
    }
  }
  console.log(JSON.stringify({ profile: "synthetic-chat-v1", label: args[1], settings,
    warmup_requests: prompts.length, measured_requests: samples.length, prompts, samples, native_totals }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof BenchmarkError ? error.message : "Benchmark failed; no report produced.");
  process.exitCode = 1;
}
