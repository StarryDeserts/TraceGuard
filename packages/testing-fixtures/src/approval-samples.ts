import type { ActionDigestInput, ApprovalChannel } from "@traceguard/schemas";
import { sampleRunId, sampleWorkspaceId } from "./samples.js";

export const sampleDecisionId = "dec_approval";
export const samplePolicyEvaluationId = "eval_000001";
export const sampleApprovedBy = "user_1";
export const sampleRejectedBy = "user_1";
export const sampleApprovalChannel: ApprovalChannel = "web";
export const sampleApprovalExpiresAt = "2026-06-08T00:05:00.000Z";
export const sampleAuthorizationExpiresAt = "2026-06-08T00:05:00.000Z";
export const sampleChannelOptions: ApprovalChannel[] = ["web", "telegram"];

export const sampleActionDigestInput: ActionDigestInput = {
  workspaceId: sampleWorkspaceId,
  runId: sampleRunId,
  decisionId: sampleDecisionId,
  providerConnectionId: "pc_1",
  toolName: "place_order",
  toolManifestHash: "tmh_1",
  policyVersionId: "pv_1",
  workspaceMode: "approval_mode",
  instrument: "BTCUSDT",
  marketType: "futures",
  action: "open_long",
  requestedNotionalUsdt: "300",
  requestedLeverage: "2",
  executionAdapter: "simulator",
};
