import { ActionDigestInput as ActionDigestInputSchema, type ActionDigestInput as ActionDigestInputValue } from "@traceguard/schemas";

function canonicalize(value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("Canonical JSON does not support non-finite numbers");
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  const canonicalObject: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) {
    const propertyValue = (value as Record<string, unknown>)[key];
    if (propertyValue === undefined) {
      continue;
    }

    Object.defineProperty(canonicalObject, key, {
      value: canonicalize(propertyValue),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return canonicalObject;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function computeActionDigest(input: ActionDigestInputValue, hash: (s: string) => string): string {
  return hash(canonicalJson(ActionDigestInputSchema.parse(input)));
}
