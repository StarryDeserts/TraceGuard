import { describe, it, expect } from "vitest";
import type { LedgerEvent } from "@traceguard/schemas";
import { authorizationProjection } from "./authorization-projection.js";

function ev(eventType: string, payload: unknown): LedgerEvent {
  return {
    id: `evt_${eventType}`,
    workspaceId: "ws_1",
    aggregateType: "authorization",
    aggregateId: "authz_1",
    eventType,
    eventVersion: 1,
    schemaVersion: 1,
    occurredAt: "2026-06-08T00:00:00.000Z",
    recordedAt: "2026-06-08T00:00:00.000Z",
    actorType: "system",
    payload,
    payloadHash: "ph",
    eventHash: `eh_${eventType}`,
  };
}

const issued = ev("AuthorizationIssued", {
  authorizationId: "authz_1",
  approvalId: "appr_1",
  actionDigest: "digest_1",
  expiresAt: "2026-06-08T01:00:00.000Z",
});

describe("authorizationProjection", () => {
  it("defaults to issued with no fields when the stream is empty", () => {
    const view = authorizationProjection([]);
    expect(view.status).toBe("issued");
    expect(view.authorizationId).toBeUndefined();
  });

  it("records issued fields", () => {
    const view = authorizationProjection([issued]);
    expect(view).toMatchObject({
      status: "issued",
      authorizationId: "authz_1",
      actionDigest: "digest_1",
      expiresAt: "2026-06-08T01:00:00.000Z",
      approvalId: "appr_1",
    });
  });

  it("marks consumed after AuthorizationConsumed", () => {
    const consumed = ev("AuthorizationConsumed", { authorizationId: "authz_1" });
    expect(authorizationProjection([issued, consumed]).status).toBe("consumed");
  });

  it("ignores a consumed event with no prior issue", () => {
    const consumed = ev("AuthorizationConsumed", { authorizationId: "authz_1" });
    expect(authorizationProjection([consumed]).status).toBe("issued");
  });

  it("marks revoked when a matching ApprovalRevoked arrives", () => {
    const revoked = ev("ApprovalRevoked", { approvalId: "appr_1", revokedAt: "2026-06-08T00:30:00.000Z" });
    expect(authorizationProjection([issued, revoked]).status).toBe("revoked");
  });

  it("ignores a non-matching ApprovalRevoked", () => {
    const revoked = ev("ApprovalRevoked", { approvalId: "appr_other", revokedAt: "2026-06-08T00:30:00.000Z" });
    expect(authorizationProjection([issued, revoked]).status).toBe("issued");
  });
});
