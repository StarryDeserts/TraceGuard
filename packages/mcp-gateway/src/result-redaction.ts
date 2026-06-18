export interface RedactionProfile {
  sensitiveKeys: ReadonlySet<string>; // normalized keys
  placeholder: string;
}

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

export const AGENT_CREDENTIAL_PROFILE: RedactionProfile = {
  // Keys are pre-normalized (lowercased, `_`/`-` stripped) — see normalizeKey.
  sensitiveKeys: new Set([
    "apikey",
    "secretkey",
    "secret",
    "apisecret",
    "passphrase",
    "authorization",
    "privatekey",
    "privkey",
    "credential",
    "credentialref",
    "signature",
    "sign",
    "mnemonic",
    "seed",
    "seedphrase",
    "wstoken",
    "listenkey",
  ]),
  placeholder: "[REDACTED]",
};

const MAX_REDACTION_DEPTH = 100;

export class RedactionDepthExceededError extends Error {
  constructor(public readonly maxDepth: number) {
    super(`redaction exceeded the maximum nesting depth of ${maxDepth}`);
    this.name = "RedactionDepthExceededError";
  }
}

// Structure-preserving, pure (never mutates input). Generic so callers keep their type.
// Throws RedactionDepthExceededError on pathologically deep input so the caller can
// fail closed instead of recursing without bound (DoS guard against hostile upstreams).
export function redactResult<T>(value: T, profile: RedactionProfile): T {
  return walk(value, profile, 0) as T;
}

function walk(value: unknown, profile: RedactionProfile, depth: number): unknown {
  if (Array.isArray(value)) {
    if (depth >= MAX_REDACTION_DEPTH) throw new RedactionDepthExceededError(MAX_REDACTION_DEPTH);
    return value.map((v) => walk(v, profile, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    if (depth >= MAX_REDACTION_DEPTH) throw new RedactionDepthExceededError(MAX_REDACTION_DEPTH);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = profile.sensitiveKeys.has(normalizeKey(k)) ? profile.placeholder : walk(v, profile, depth + 1);
    }
    return out;
  }
  return value; // primitives, null, undefined pass through unchanged
}
