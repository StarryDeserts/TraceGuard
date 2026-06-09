import { describe, it, expect } from "vitest";
import { approvalProjection } from "./approval-projection.js";
import type { LedgerEvent } from "@traceguard/schemas";

function ev(eventType: string, payload: unknown = {}): LedgerEvent {
  return {
    id: "evt",
    workspaceId: "ws_1",
    aggregateType: "approval",
    aggregateId: "appr_1",
    eventType,
    eventVersion: 1,
    schemaVersion: 1,
    occurredAt: "2026-06-08T00:00:00.000Z",
    recordedAt: "2026-06-08T00:00:00.000Z",
    actorType: "system",
    payload,
    payloadHash: "ph",
    eventHash: "eh",
  };
}

const requested = ev("ApprovalRequested", {
  approvalId: "appr_1",
  runId: "run_1",
  decisionId: "dec_1",
  actionDigest: "digest_1",
  expiresAt: "2026-06-08T00:05:00.000Z",
});

describe("approvalProjection", () => {
  it("seeds an empty stream to pending with no identifiers", () => {
    expect(approvalProjection([])).toEqual({ status: "pending" });
  });

  it("records request fields and marks pending", () => {
    expect(approvalProjection([requested])).toEqual({
      status: "pending",
      approvalId: "appr_1",
      runId: "run_1",
      decisionId: "dec_1",
      actionDigest: "digest_1",
      expiresAt: "2026-06-08T00:05:00.000Z",
    });
  });

  it("folds the approve path to approved and records the authorization", () => {
    const state = approvalProjection([
      requested,
      ev("ApprovalApproved", {}),
      ev("AuthorizationIssued", {
        authorizationId: "authz_1",
        approvalId: "appr_1",
        runId: "run_1",
        decisionId: "dec_1",
        actionDigest: "digest_1",
        expiresAt: "2026-06-08T00:06:00.000Z",
      }),
    ]);
    expect(state.status).toBe("approved");
    expect(state.authorizationId).toBe("authz_1");
    expect(state.authorizationExpiresAt).toBe("2026-06-08T00:06:00.000Z");
    expect(state.approvalId).toBe("appr_1");
    expect(state.expiresAt).toBe("2026-06-08T00:05:00.000Z");
  });

  it("folds an allow-path AuthorizationIssued with no prior request", () => {
    const state = approvalProjection([
      ev("AuthorizationIssued", {
        authorizationId: "authz_1",
        runId: "run_1",
        decisionId: "dec_1",
        actionDigest: "digest_1",
        expiresAt: "2026-06-08T00:05:00.000Z",
      }),
    ]);
    expect(state.status).toBe("approved");
    expect(state.approvalId).toBeUndefined();
    expect(state.runId).toBe("run_1");
    expect(state.decisionId).toBe("dec_1");
    expect(state.actionDigest).toBe("digest_1");
    expect(state.authorizationId).toBe("authz_1");
    expect(state.authorizationExpiresAt).toBe("2026-06-08T00:05:00.000Z");
  });

  it("folds rejected, expired, consumed, and revoked transitions", () => {
    expect(approvalProjection([requested, ev("ApprovalRejected", {})]).status).toBe("rejected");
    expect(approvalProjection([requested, ev("ApprovalExpired", {})]).status).toBe("expired");
    expect(approvalProjection([requested, ev("ApprovalApproved", {}), ev("AuthorizationConsumed", {})]).status).toBe(
      "consumed",
    );
    expect(approvalProjection([requested, ev("ApprovalRevoked", {})]).status).toBe("revoked");
  });

  it("ignores unrelated decision events", () => {
    expect(approvalProjection([ev("DecisionProposed", {}), ev("PolicyEvaluated", { outcome: "allow" })])).toEqual({
      status: "pending",
    });
  });
});
