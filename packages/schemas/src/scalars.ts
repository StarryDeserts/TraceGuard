import { z } from "zod";

export const DecimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "must be a decimal string (no exponent, no float)");
export type DecimalString = z.infer<typeof DecimalString>;

const ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function normalizeIsoTimestamp(value: string) {
  return value.replace(/(\.\d{1,3})?Z$/, (_match, fraction: string | undefined) => {
    const milliseconds = (fraction ?? ".").slice(1).padEnd(3, "0");
    return `.${milliseconds}Z`;
  });
}

function isRealUtcInstant(value: string) {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === normalizeIsoTimestamp(value);
}

export const IsoTimestamp = z
  .string()
  .regex(ISO_TIMESTAMP_REGEX, "must be an ISO-8601 UTC instant ending in Z")
  .refine(isRealUtcInstant, "must be a real ISO-8601 UTC instant ending in Z");
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function PrefixedId(prefix: string) {
  return z.string().regex(new RegExp(`^${escapeRegExp(prefix)}_.+`), `must start with "${prefix}_"`);
}
