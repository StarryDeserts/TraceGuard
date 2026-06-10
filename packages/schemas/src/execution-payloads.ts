import { z } from "zod";
import { IsoTimestamp } from "./scalars.js";

export const ExecutionAdapterType = z.enum(["simulator", "bitget_live", "replay"]);
export type ExecutionAdapterType = z.infer<typeof ExecutionAdapterType>;

export const ExecutionFinalStatus = z.enum([
  "simulated",
  "submitted",
  "filled",
  "partially_filled",
  "cancelled",
]);
export type ExecutionFinalStatus = z.infer<typeof ExecutionFinalStatus>;

export const ExecutionRejectionReason = z.enum([
  "policy_blocked",
  "approval_required",
  "authorization_missing",
  "authorization_invalid",
  "capability_unavailable",
  "snapshot_stale",
  "manifest_unapproved",
  "workspace_locked",
]);
export type ExecutionRejectionReason = z.infer<typeof ExecutionRejectionReason>;

export const ExecutionUnknownReason = z.enum([
  "timeout_after_submit",
  "connection_lost_after_submit",
  "provider_status_unavailable",
  "receipt_lookup_failed",
]);
export type ExecutionUnknownReason = z.infer<typeof ExecutionUnknownReason>;

export const ExecutionRequestedPayload = z
  .object({
    executionId: z.string().min(1),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    authorizationId: z.string().min(1).optional(),
    adapterType: ExecutionAdapterType,
    actionDigest: z.string().min(1),
    idempotencyKey: z.string().min(1),
    requestRef: z.string().min(1),
    requestHash: z.string().min(1),
  })
  .strict();
export type ExecutionRequestedPayload = z.infer<typeof ExecutionRequestedPayload>;

export const ExecutionCompletedPayload = z
  .object({
    executionId: z.string().min(1),
    runId: z.string().min(1),
    adapterType: ExecutionAdapterType,
    finalStatus: ExecutionFinalStatus,
    receiptRef: z.string().min(1),
    receiptHash: z.string().min(1),
    upstreamRef: z.string().min(1).optional(),
    completedAt: IsoTimestamp,
  })
  .strict();
export type ExecutionCompletedPayload = z.infer<typeof ExecutionCompletedPayload>;

export const ExecutionRejectedPayload = z
  .object({
    executionId: z.string().min(1).optional(),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    reasonCode: ExecutionRejectionReason,
    executionSent: z.literal(false),
  })
  .strict();
export type ExecutionRejectedPayload = z.infer<typeof ExecutionRejectedPayload>;

export const ExecutionUnknownPayload = z
  .object({
    executionId: z.string().min(1),
    runId: z.string().min(1),
    adapterType: z.literal("bitget_live"),
    reasonCode: ExecutionUnknownReason,
    upstreamRequestId: z.string().min(1).optional(),
    reconciliationRequired: z.literal(true),
    retryBlocked: z.literal(true),
  })
  .strict();
export type ExecutionUnknownPayload = z.infer<typeof ExecutionUnknownPayload>;
