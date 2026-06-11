import {
  ActionDigestInput as ActionDigestInputSchema,
  canonicalJson,
  type ActionDigestInput as ActionDigestInputValue,
} from "@traceguard/schemas";

export function computeActionDigest(input: ActionDigestInputValue, hash: (s: string) => string): string {
  return hash(canonicalJson(ActionDigestInputSchema.parse(input)));
}
