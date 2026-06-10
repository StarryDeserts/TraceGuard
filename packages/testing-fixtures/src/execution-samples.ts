import type { ExecutionUnknownReason } from "@traceguard/schemas";

export const sampleExecutionId = "exec_000001";
export const sampleReceiptRef = "receipt:exec_000001";
export const sampleReceiptHash = "rh_000001";
export const sampleCompletedAt = "2026-06-08T00:00:00.000Z";
export const sampleActionDigest = "digest_exec";

export function fakeLiveAdapter(reasonCode: ExecutionUnknownReason = "provider_status_unavailable") {
  return {
    adapterType: "bitget_live" as const,
    call: async (): Promise<{ kind: "unknown"; reasonCode: ExecutionUnknownReason }> => ({
      kind: "unknown",
      reasonCode,
    }),
  };
}

export function crashAdapter(message = "adapter crashed after burn") {
  return {
    adapterType: "simulator" as const,
    call: async (): Promise<never> => {
      throw new Error(message);
    },
  };
}
