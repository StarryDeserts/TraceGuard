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

// Structure-preserving, pure (never mutates input). Generic so callers keep their type.
export function redactResult<T>(value: T, profile: RedactionProfile): T {
  return walk(value, profile) as T;
}

function walk(value: unknown, profile: RedactionProfile): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, profile));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = profile.sensitiveKeys.has(normalizeKey(k)) ? profile.placeholder : walk(v, profile);
    }
    return out;
  }
  return value; // primitives, null, undefined pass through unchanged
}
