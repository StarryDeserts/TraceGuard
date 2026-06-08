export function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonicalJson: non-finite numbers are not allowed");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v === undefined) continue;
      Object.defineProperty(out, key, {
        value: canonicalize(v),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
