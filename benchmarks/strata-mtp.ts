import { openSync, readSync, closeSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [source, out] = Bun.argv.slice(2);
if (!source || !out || Bun.argv.length !== 4) {
  console.error("Usage: bun benchmarks/strata-mtp.ts <common-mtp.gguf> <output-dir>");
  process.exit(1);
}

type Tensor = { shape: number[]; type: number; offset: number };
const fd = openSync(source, "r");
try {
  // GGUF v2/v3: little-endian header, metadata, tensor directory, aligned data.
  let position = 0;
  function readAt(offset: number, size: number) {
    const b = Buffer.allocUnsafe(size);
    let n = 0;
    while (n < size) {
      const got = readSync(fd, b, n, size - n, offset + n);
      if (!got) throw new Error("Truncated GGUF");
      n += got;
    }
    return b;
  }
  function read(size: number) {
    const b = readAt(position, size);
    position += size;
    return b;
  }
  const u32 = () => read(4).readUInt32LE();
  function u64() {
    const n = Number(read(8).readBigUInt64LE());
    if (!Number.isSafeInteger(n)) throw new Error("GGUF integer exceeds safe range");
    return n;
  }
  const string = () => read(u64()).toString("utf8");
  const metadataSizes: Record<number, number> = {
    0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8,
  };
  function skipValue(type: number, count = 1) {
    if (metadataSizes[type]) { position += metadataSizes[type] * count; return; }
    for (let i = 0; i < count; i++) {
      if (type === 8) { const length = u64(); position += length; }
      else if (type === 9) { const element = u32(); skipValue(element, u64()); }
      else throw new Error("Unknown GGUF metadata type " + type);
    }
  }
  if (read(4).toString("ascii") !== "GGUF") throw new Error("Not a GGUF file");
  const version = u32();
  if (version !== 2 && version !== 3) throw new Error("Expected GGUF v2 or v3");
  const tensorCount = u64(), metadataCount = u64();
  let alignment = 32;
  for (let i = 0; i < metadataCount; i++) {
    const key = string(), type = u32();
    if (key === "general.alignment" && type === 4) alignment = u32();
    else skipValue(type);
  }
  const tensors = new Map<string, Tensor>();
  for (let i = 0; i < tensorCount; i++) {
    const name = string(), dimensions = u32(), shape: number[] = [];
    for (let j = 0; j < dimensions; j++) shape.push(u64());
    tensors.set(name, { shape, type: u32(), offset: u64() });
  }
  const dataStart = Math.ceil(position / alignment) * alignment;
  function tensor(name: string) {
    const t = tensors.get("blk.48." + name + ".weight");
    if (!t) throw new Error("Missing MTP tensor: " + name);
    return t;
  }

  function f16Bits(h: number) {
    const sign = (h & 0x8000) << 16;
    let e = (h >>> 10) & 31, m = h & 1023;
    if (e === 31) return (sign | 0x7f800000 | (m << 13)) >>> 0;
    if (e === 0) {
      if (m === 0) return sign >>> 0;
      e = 1;
      while (!(m & 1024)) { m <<= 1; e--; }
      m &= 1023;
    }
    return (sign | ((e + 112) << 23) | (m << 13)) >>> 0;
  }
  function load(name: string, first = 0, count?: number) {
    const t = tensor(name), shape = t.shape.toReversed();
    const inner = shape.slice(1).reduce((a, b) => a * b, 1);
    count ??= shape[0];
    const n = inner * count, data = new Float32Array(n), words = new Uint32Array(data.buffer);
    const sizes: Record<number, number> = { 0: 4, 1: 2, 30: 2 };
    const size = sizes[t.type];
    if (t.type !== 8 && !size) throw new Error("Unsupported GGUF tensor type: " + t.type);
    if (t.type === 8 && (n % 32 || (first * inner) % 32)) throw new Error("Unaligned Q8_0 slice");
    const offset = dataStart + t.offset + (t.type === 8 ? first * inner / 32 * 34 : first * inner * size);
    const b = readAt(offset, t.type === 8 ? n / 32 * 34 : n * size);
    if (t.type === 8) {
      const scale = new Float32Array(1), scaleBits = new Uint32Array(scale.buffer);
      for (let block = 0; block < n / 32; block++) {
        scaleBits[0] = f16Bits(b.readUInt16LE(block * 34));
        for (let j = 0; j < 32; j++) data[block * 32 + j] = b.readInt8(block * 34 + 2 + j) * scale[0];
      }
    } else {
      for (let i = 0; i < n; i++) {
        words[i] = t.type === 0 ? b.readUInt32LE(i * 4) : t.type === 1
          ? f16Bits(b.readUInt16LE(i * 2)) : b.readUInt16LE(i * 2) << 16;
      }
    }
    return { shape: [count, ...shape.slice(1)], data };
  }
  function bf16(data: Float32Array) {
    const words = new Uint32Array(data.buffer, data.byteOffset, data.length);
    const b = Buffer.allocUnsafe(data.length * 2);
    for (let i = 0; i < data.length; i++) {
      const u = words[i];
      // Float32 -> BF16, round-to-nearest-even with uint32 wrap, as in NumPy.
      b.writeUInt16LE(((u + 0x7fff + ((u >>> 16) & 1)) >>> 0) >>> 16, i * 2);
    }
    return b;
  }
  mkdirSync(join(out, "tensors"), { recursive: true });
  const manifest: { name: string; shape: number[]; dtype: string; file: string; sha256: string }[] = [];
  function emit(name: string, shape: number[], chunks: Iterable<Float32Array>) {
    const file = "tensors/" + name + ".bin", w = openSync(join(out, file), "w"), h = new Bun.CryptoHasher("sha256");
    try {
      for (const c of chunks) { const b = bf16(c); h.update(b); writeFileSync(w, b); }
    } finally { closeSync(w); }
    manifest.push({ name, shape, dtype: "BF16", file, sha256: h.digest("hex") });
    console.log(name, shape);
  }

  const L = "mtp.layers.0.";
  const norms = {
    "mtp.pre_fc_norm_embedding.weight": "nextn.enorm",
    "mtp.pre_fc_norm_hidden.weight": "nextn.hnorm",
    "mtp.hyper_connection_mixer.hc_norm.weight": "nextn.hc_head_norm",
    [L + "attn_hyper_connection.hc_norm.weight"]: "hc_attn_norm",
    [L + "mlp_hyper_connection.hc_norm.weight"]: "hc_ffn_norm",
    [L + "self_attn.q_norm.weight"]: "attn_q_norm",
    [L + "self_attn.k_norm.weight"]: "attn_k_norm",
    [L + "self_attn.indexer.q_layernorm.weight"]: "indexer.q_norm",
    [L + "self_attn.indexer.k_layernorm.weight"]: "indexer.k_norm",
  };
  const plain: Record<string, string> = {
    "mtp.hyper_connection_mixer.input_mix_weight_down.weight": "nextn.hc_head_down",
    "mtp.hyper_connection_mixer.input_mix_weight_up.weight": "nextn.hc_head_up",
  };
  for (const [hc, g] of [["attn", "attn"], ["mlp", "ffn"]]) {
    for (const [k, v] of [["block_inject_weight", "inject"], ["input_mix_weight_down", "down"], ["input_mix_weight_up", "up"]]) {
      plain[L + hc + "_hyper_connection." + k + ".weight"] = "hc_" + g + "_" + v;
    }
  }
  Object.assign(plain, {
    [L + "mlp.gate.weight"]: "ffn_gate_inp",
    [L + "mlp.shared_expert.gate_proj.weight"]: "ffn_gate_shexp",
    [L + "mlp.shared_expert.up_proj.weight"]: "ffn_up_shexp",
    [L + "mlp.shared_expert.down_proj.weight"]: "ffn_down_shexp",
    [L + "self_attn.q_proj.weight"]: "attn_q",
    [L + "self_attn.k_proj.weight"]: "attn_k",
    [L + "self_attn.v_proj.weight"]: "attn_v",
    [L + "self_attn.o_proj.weight"]: "attn_output",
  });
  for (const [hf, g] of Object.entries(norms)) {
    const a = load(g);
    for (let i = 0; i < a.data.length; i++) a.data[i] = a.data[i] - 1.0;
    emit(hf, a.shape, [a.data]);
  }
  for (const [hf, g] of Object.entries(plain)) {
    const a = load(g);
    emit(hf, a.shape, [a.data]);
  }
  const sharedGate = load("ffn_gate_inp_shexp");
  emit(L + "mlp.shared_expert_gate.weight", [1, sharedGate.data.length], [sharedGate.data]);
  const eh = load("nextn.eh_proj"), [rows, columns] = eh.shape, k = Math.floor(columns / 2);
  function* fc(start: number, end: number) {
    for (let row = 0; row < rows; row++) yield eh.data.subarray(row * columns + start, row * columns + end);
  }
  emit("mtp.fc_embedding.weight", [rows, k], fc(0, k));
  emit("mtp.fc_hidden.weight", [rows, k], fc(k, columns));
  const q = load("indexer.q_proj"), kk = load("indexer.k_proj");
  emit(L + "self_attn.indexer.index_qk_proj.weight", [q.shape[0] + kk.shape[0], q.shape[1]], [q.data, kk.data]);
  const [nd, nff, ne] = tensor("ffn_gate_exps").shape;
  function* gateUp() {
    for (let e = 0; e < ne; e++) {
      yield load("ffn_gate_exps", e, 1).data;
      yield load("ffn_up_exps", e, 1).data;
    }
  }
  function* down() { for (let e = 0; e < ne; e++) yield load("ffn_down_exps", e, 1).data; }
  emit(L + "mlp.experts.gate_up_proj", [ne, 2 * nff, nd], gateUp());
  emit(L + "mlp.experts.down_proj", [ne, nd, nff], down());
  if (manifest.length !== 31) throw new Error("Expected 31 MTP tensors");
  writeFileSync(join(out, "mtp-manifest.json"), JSON.stringify(manifest, null, 1));
} finally { closeSync(fd); }
