import { describe, it, expect } from "vitest";
import {
  ApprovalChannel,
  ApprovalStatus,
  ApprovalRequestedPayload,
  ApprovalApprovedPayload,
  ApprovalRejectedPayload,
  ApprovalExpiredPayload,
  ApprovalRevokedPayload,
} from "./approval-payloads.js";

describe("approval payloads", () => {
  it("ApprovalChannel and ApprovalStatus enumerate the canonical members", () => {
    expect(ApprovalChannel.options).toEqual(["web", "telegram", "mcp_app"]);
    expect(ApprovalStatus.options).toEqual(["pending", "approved", "consumed", "rejected", "expired", "revoked"]);
  });

  it("ApprovalRequestedPayload requires a nested summary pinned to require_approval", () => {
    const p = ApprovalRequestedPayload.parse({
      approvalId: "appr_1",
      runId: "run_1",
      decisionId: "dec_1",
      policyEvaluationId: "eval_1",
      actionDigest: "digest_1",
      channelOptions: ["web", "telegram"],
      expiresAt: "2026-06-08T00:05:00.000Z",
      summary: {
        instrument: "BTCUSDT",
        action: "open_long",
        notionalUsdt: "300",
        leverage: "2",
        policyOutcome: "require_approval",
      },
    });
    expect(p.summary.policyOutcome).toBe("require_approval");
    expect(() =>
      ApprovalRequestedPayload.parse({
        approvalId: "appr_1",
        runId: "run_1",
        decisionId: "dec_1",
        policyEvaluationId: "eval_1",
        actionDigest: "digest_1",
        channelOptions: ["web"],
        expiresAt: "2026-06-08T00:05:00.000Z",
        summary: { instrument: "BTCUSDT", action: "open_long", policyOutcome: "allow" },
      }),
    ).toThrow();
  });

  it("ApprovalRequestedPayload rejects unknown keys (strict)", () => {
    expect(() =>
      ApprovalRequestedPayload.parse({
        approvalId: "appr_1",
        runId: "run_1",
        decisionId: "dec_1",
        policyEvaluationId: "eval_1",
        actionDigest: "digest_1",
        channelOptions: ["web"],
        expiresAt: "2026-06-08T00:05:00.000Z",
        summary: { instrument: "BTCUSDT", action: "open_long", policyOutcome: "require_approval" },
        surprise: true,
      }),
    ).toThrow();
  });

  it("ApprovalApprovedPayload carries approver, channel, and both timestamps", () => {
    const p = ApprovalApprovedPayload.parse({
      approvalId: "appr_1",
      runId: "run_1",
      decisionId: "dec_1",
      actionDigest: "digest_1",
      approvedBy: "user_1",
      approvalChannel: "web",
      approvedAt: "2026-06-08T00:01:00.000Z",
      expiresAt: "2026-06-08T00:06:00.000Z",
    });
    expect(p.approvedBy).toBe("user_1");
  });

  it("ApprovalRejectedPayload keeps reason optional", () => {
    const p = ApprovalRejectedPayload.parse({
      approvalId: "appr_1",
      rejectedBy: "user_1",
      rejectionChannel: "telegram",
    });
    expect(p.reason).toBeUndefined();
  });

  it("ApprovalExpiredPayload requires expiredAt and actionDigest", () => {
    const p = ApprovalExpiredPayload.parse({
      approvalId: "appr_1",
      expiredAt: "2026-06-08T00:05:00.000Z",
      actionDigest: "digest_1",
    });
    expect(p.actionDigest).toBe("digest_1");
  });
});

describe("ApprovalRevokedPayload", () => {
  it("requires approvalId and a revokedAt timestamp, optional revoker and reason", () => {
    const ok = ApprovalRevokedPayload.parse({
      approvalId: "appr_1",
      revokedBy: "user_1",
      revokedAt: "2026-06-08T00:00:00.000Z",
      reason: "manual stand-down",
    });
    expect(ok.approvalId).toBe("appr_1");
    expect(() => ApprovalRevokedPayload.parse({ approvalId: "appr_1", revokedAt: "2026-06-08T00:00:00.000Z" })).not.toThrow();
    expect(() => ApprovalRevokedPayload.parse({ revokedAt: "2026-06-08T00:00:00.000Z" })).toThrow();
    expect(() => ApprovalRevokedPayload.parse({ ...ok, extra: 1 })).toThrow();
  });
});
