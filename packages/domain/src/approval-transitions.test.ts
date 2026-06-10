import { describe, it, expect } from "vitest";
import { sha256hex, type ApprovalProjection } from "@traceguard/event-ledger";
import type { ApprovalApprovedPayload, AuthorizationIssuedPayload, LedgerEvent } from "@traceguard/schemas";
import {
  fixedClock,
  sampleApprovalChannel,
  sampleApprovalExpiresAt,
  sampleApprovedBy,
  sampleAuthorizationExpiresAt,
  sampleDecisionId,
  sampleRejectedBy,
  sampleRunId,
  sampleWorkspaceId,
  sequentialIdGen,
} from "@traceguard/testing-fixtures";
import { approveApproval, expireApproval, rejectApproval } from "./approval-transitions.js";

function pendingState(overrides: Partial<ApprovalProjection> = {}): ApprovalProjection {
  return {
    status: "pending",
    approvalId: "appr_1",
    runId: sampleRunId,
    decisionId: sampleDecisionId,
    actionDigest: "digest_1",
    expiresAt: sampleApprovalExpiresAt,
    ...overrides,
  };
}

function deps(instant?: string) {
  return { clock: fixedClock(instant), newId: sequentialIdGen(), hash: sha256hex };
}

describe("approveApproval", () => {
  it("emits ApprovalApproved then AuthorizationIssued and returns approved", () => {
    const result = approveApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: pendingState(),
        approvedBy: sampleApprovedBy,
        approvalChannel: sampleApprovalChannel,
        authorizationExpiresAt: sampleAuthorizationExpiresAt,
        previousEventHash: null,
      },
      deps(),
    );
    expect(result.outcome).toBe("approved");
    expect(result.events.map((e) => e.eventType)).toEqual(["ApprovalApproved", "AuthorizationIssued"]);
    const approved = result.events[0] as LedgerEvent<ApprovalApprovedPayload>;
    expect(approved.actorType).toBe("user");
    expect(approved.actorId).toBe(sampleApprovedBy);
    expect(approved.payload.approvedBy).toBe(sampleApprovedBy);
    const issued = result.events[1] as LedgerEvent<AuthorizationIssuedPayload>;
    expect(issued.aggregateType).toBe("authorization");
    expect(issued.actorType).toBe("system");
    expect(issued.payload.approvalId).toBe("appr_1");
    expect(issued.payload.scope).toBe("single_action");
    expect(issued.previousEventHash).toBe(approved.eventHash);
  });

  it("expires instead of approving at or past the deadline (boundary inclusive)", () => {
    const result = approveApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: pendingState(),
        approvedBy: sampleApprovedBy,
        approvalChannel: sampleApprovalChannel,
        authorizationExpiresAt: sampleAuthorizationExpiresAt,
        previousEventHash: null,
      },
      deps(sampleApprovalExpiresAt), // now === expiresAt
    );
    expect(result.outcome).toBe("expired");
    expect(result.events.map((e) => e.eventType)).toEqual(["ApprovalExpired"]);
  });

  it("refuses to approve a non-pending approval", () => {
    const result = approveApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: pendingState({ status: "approved" }),
        approvedBy: sampleApprovedBy,
        approvalChannel: sampleApprovalChannel,
        authorizationExpiresAt: sampleAuthorizationExpiresAt,
        previousEventHash: null,
      },
      deps(),
    );
    expect(result).toEqual({ events: [], outcome: "illegal_transition" });
  });

  it("refuses when the pending state is missing required fields", () => {
    const result = approveApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: { status: "pending" },
        approvedBy: sampleApprovedBy,
        approvalChannel: sampleApprovalChannel,
        authorizationExpiresAt: sampleAuthorizationExpiresAt,
        previousEventHash: null,
      },
      deps(),
    );
    expect(result).toEqual({ events: [], outcome: "illegal_transition" });
  });
});

describe("rejectApproval", () => {
  it("emits ApprovalRejected by the user with an optional reason", () => {
    const result = rejectApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: pendingState(),
        rejectedBy: sampleRejectedBy,
        rejectionChannel: sampleApprovalChannel,
        reason: "too risky",
        previousEventHash: null,
      },
      deps(),
    );
    expect(result.outcome).toBe("rejected");
    expect(result.events.map((e) => e.eventType)).toEqual(["ApprovalRejected"]);
    expect(result.events[0]?.actorType).toBe("user");
    expect(result.events[0]?.actorId).toBe(sampleRejectedBy);
    expect(result.events[0]?.payload).toMatchObject({ reason: "too risky", rejectedBy: sampleRejectedBy });
  });

  it("expires instead of rejecting at or past the deadline (boundary inclusive)", () => {
    const result = rejectApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: pendingState(),
        rejectedBy: sampleRejectedBy,
        rejectionChannel: sampleApprovalChannel,
        previousEventHash: null,
      },
      deps(sampleApprovalExpiresAt), // now === expiresAt
    );
    expect(result.outcome).toBe("expired");
    expect(result.events.map((e) => e.eventType)).toEqual(["ApprovalExpired"]);
    expect(result.events[0]?.actorType).toBe("system");
  });

  it("refuses to reject a non-pending approval", () => {
    const result = rejectApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: pendingState({ status: "rejected" }),
        rejectedBy: sampleRejectedBy,
        rejectionChannel: sampleApprovalChannel,
        previousEventHash: null,
      },
      deps(),
    );
    expect(result).toEqual({ events: [], outcome: "illegal_transition" });
  });
});

describe("expireApproval", () => {
  it("emits ApprovalExpired once the deadline has passed", () => {
    const result = expireApproval(
      { workspaceId: sampleWorkspaceId, approvalState: pendingState(), previousEventHash: null },
      deps("2026-06-08T00:10:00.000Z"),
    );
    expect(result.outcome).toBe("expired");
    expect(result.events.map((e) => e.eventType)).toEqual(["ApprovalExpired"]);
    expect(result.events[0]?.payload).toMatchObject({ expiredAt: "2026-06-08T00:10:00.000Z" });
  });

  it("does nothing while the approval is still within its window", () => {
    const result = expireApproval(
      { workspaceId: sampleWorkspaceId, approvalState: pendingState(), previousEventHash: null },
      deps("2026-06-08T00:01:00.000Z"),
    );
    expect(result).toEqual({ events: [], outcome: "not_yet_expired" });
  });

  it("refuses to expire a non-pending approval", () => {
    const result = expireApproval(
      { workspaceId: sampleWorkspaceId, approvalState: pendingState({ status: "approved" }), previousEventHash: null },
      deps(),
    );
    expect(result).toEqual({ events: [], outcome: "illegal_transition" });
  });
});
