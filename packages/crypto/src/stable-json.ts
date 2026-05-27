function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalize(value: unknown): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === "string" || t === "boolean") return value;
  if (t === "number") {
    assert(Number.isFinite(value), "Cannot stable-stringify non-finite numbers");
    return value;
  }
  if (t === "bigint") {
    // Preserve numeric intent but keep JSON-safe.
    return value.toString();
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value).sort();
    for (const k of keys) out[k] = normalize(value[k]);
    return out;
  }
  assert(false, `Cannot stable-stringify type: ${Object.prototype.toString.call(value)}`);
}

/**
 * Canonical JSON stringifier for hashing/signing.
 * - Sorts object keys
 * - Rejects non-finite numbers and non-plain objects
 * - Serializes bigint as decimal strings
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}
