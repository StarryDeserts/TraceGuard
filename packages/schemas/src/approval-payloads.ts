import { z } from "zod";
import { DecimalString, IsoTimestamp } from "./scalars.js";
import { DecisionAction } from "./decision-envelope.js";

export const ApprovalChannel = z.enum(["web", "telegram", "mcp_app"]);
export type ApprovalChannel = z.infer<typeof ApprovalChannel>;

export const ApprovalStatus = z.enum(["pending", "approved", "consumed", "rejected", "expired", "revoked"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalRequestedPayload = z
  .object({
    approvalId: z.string().min(1),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    policyEvaluationId: z.string().min(1),
    actionDigest: z.string().min(1),
    channelOptions: z.array(ApprovalChannel),
    expiresAt: IsoTimestamp,
    summary: z
      .object({
        instrument: z.string().min(1),
        action: DecisionAction,
        notionalUsdt: DecimalString.optional(),
        leverage: DecimalString.optional(),
        policyOutcome: z.literal("require_approval"),
      })
      .strict(),
  })
  .strict();
export type ApprovalRequestedPayload = z.infer<typeof ApprovalRequestedPayload>;

export const ApprovalApprovedPayload = z
  .object({
    approvalId: z.string().min(1),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    actionDigest: z.string().min(1),
    approvedBy: z.string().min(1),
    approvalChannel: ApprovalChannel,
    approvedAt: IsoTimestamp,
    expiresAt: IsoTimestamp,
  })
  .strict();
export type ApprovalApprovedPayload = z.infer<typeof ApprovalApprovedPayload>;

export const ApprovalRejectedPayload = z
  .object({
    approvalId: z.string().min(1),
    rejectedBy: z.string().min(1),
    rejectionChannel: ApprovalChannel,
    reason: z.string().optional(),
  })
  .strict();
export type ApprovalRejectedPayload = z.infer<typeof ApprovalRejectedPayload>;

export const ApprovalExpiredPayload = z
  .object({
    approvalId: z.string().min(1),
    expiredAt: IsoTimestamp,
    actionDigest: z.string().min(1),
  })
  .strict();
export type ApprovalExpiredPayload = z.infer<typeof ApprovalExpiredPayload>;

export const ApprovalRevokedPayload = z
  .object({
    approvalId: z.string().min(1),
    revokedBy: z.string().min(1).optional(),
    revokedAt: IsoTimestamp,
    reason: z.string().min(1).optional(),
  })
  .strict();
export type ApprovalRevokedPayload = z.infer<typeof ApprovalRevokedPayload>;
