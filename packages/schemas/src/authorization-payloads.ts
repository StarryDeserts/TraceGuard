import { z } from "zod";
import { IsoTimestamp } from "./scalars.js";

export const AuthorizationRejectionReason = z.enum([
  "missing_authorization",
  "expired_authorization",
  "already_consumed",
  "action_digest_mismatch",
  "workspace_locked",
  "manifest_changed",
  "policy_changed",
]);
export type AuthorizationRejectionReason = z.infer<typeof AuthorizationRejectionReason>;

export const AuthorizationIssuedPayload = z
  .object({
    authorizationId: z.string().min(1),
    approvalId: z.string().min(1).optional(),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    actionDigest: z.string().min(1),
    expiresAt: IsoTimestamp,
    scope: z.literal("single_action"),
  })
  .strict();
export type AuthorizationIssuedPayload = z.infer<typeof AuthorizationIssuedPayload>;

export const AuthorizationConsumedPayload = z
  .object({
    authorizationId: z.string().min(1),
    approvalId: z.string().min(1).optional(),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    actionDigest: z.string().min(1),
    consumedAt: IsoTimestamp,
    executionId: z.string().min(1),
  })
  .strict();
export type AuthorizationConsumedPayload = z.infer<typeof AuthorizationConsumedPayload>;

export const AuthorizationRejectedPayload = z
  .object({
    authorizationId: z.string().min(1).optional(),
    approvalId: z.string().min(1).optional(),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    attemptedActionDigest: z.string().min(1),
    expectedActionDigest: z.string().min(1).optional(),
    reasonCode: AuthorizationRejectionReason,
  })
  .strict();
export type AuthorizationRejectedPayload = z.infer<typeof AuthorizationRejectedPayload>;
