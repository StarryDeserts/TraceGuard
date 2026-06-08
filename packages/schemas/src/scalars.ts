import { z } from "zod";

export const DecimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "must be a decimal string (no exponent, no float)");
export type DecimalString = z.infer<typeof DecimalString>;

export const IsoTimestamp = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/,
    "must be an ISO-8601 UTC instant ending in Z",
  );
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

export function PrefixedId(prefix: string) {
  return z.string().regex(new RegExp(`^${prefix}_.+`), `must start with "${prefix}_"`);
}
