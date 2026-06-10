import { describe, it, expect } from "vitest";
import { runStatusProjection } from "./run-status-projection.js";
import type { LedgerEvent } from "@traceguard/schemas";

function ev(eventType: string, payload: unknown = {}): LedgerEvent {
  return {
    id: "evt",
    workspaceId: "ws_1",
    aggregateType: "decision",
    aggregateId: "dec_1",
    eventType,
    eventVersion: 1,
    schemaVersion: 1,
    occurredAt: "2026-06-08T00:00:00.000Z",
    recordedAt: "2026-06-08T00:00:00.000Z",
    actorType: "agent",
    payload,
    payloadHash: "ph",
    eventHash: "eh",
  };
}

describe("runStatusProjection", () => {
  it("defaults empty event streams to created", () => {
    expect(runStatusProjection([])).toBe("created");
  });

  it("maps RunCreated to created", () => {
    expect(runStatusProjection([ev("RunCreated")])).toBe("created");
  });

  it("maps RunStarted to capturing", () => {
    expect(runStatusProjection([ev("RunStarted")])).toBe("capturing");
  });

  it("maps DecisionValidated to decision_ready", () => {
    expect(runStatusProjection([ev("DecisionValidated")])).toBe("decision_ready");
  });

  it("maps PolicyEvaluationStarted to policy_evaluating", () => {
    expect(runStatusProjection([ev("PolicyEvaluationStarted")])).toBe("policy_evaluating");
  });

  it("maps explicit PolicyEvaluated outcomes", () => {
    expect(runStatusProjection([ev("PolicyEvaluated", { outcome: "allow" })])).toBe("allowed");
    expect(runStatusProjection([ev("PolicyEvaluated", { outcome: "require_approval" })])).toBe("approval_required");
    expect(runStatusProjection([ev("PolicyEvaluated", { outcome: "block" })])).toBe("blocked");
  });

  it("leaves an already advanced status unchanged for DecisionRejected", () => {
    expect(runStatusProjection([ev("DecisionValidated"), ev("DecisionRejected")])).toBe("decision_ready");
  });

  it("leaves an already advanced status unchanged for invalid PolicyEvaluated outcomes", () => {
    expect(runStatusProjection([ev("DecisionValidated"), ev("PolicyEvaluated", { outcome: "deny" })])).toBe(
      "decision_ready",
    );
    expect(runStatusProjection([ev("DecisionValidated"), ev("PolicyEvaluated", {})])).toBe("decision_ready");
    expect(runStatusProjection([ev("DecisionValidated"), ev("PolicyEvaluated", { outcome: "future" })])).toBe(
      "decision_ready",
    );
  });

  it("maps ApprovalRequested and ApprovalApproved to approval_required", () => {
    expect(runStatusProjection([ev("ApprovalRequested")])).toBe("approval_required");
    expect(runStatusProjection([ev("ApprovalApproved")])).toBe("approval_required");
  });

  it("leaves run status unchanged for AuthorizationIssued / ApprovalRejected / ApprovalExpired", () => {
    expect(runStatusProjection([ev("PolicyEvaluated", { outcome: "allow" }), ev("AuthorizationIssued")])).toBe(
      "allowed",
    );
    expect(runStatusProjection([ev("ApprovalRequested"), ev("ApprovalRejected")])).toBe("approval_required");
    expect(runStatusProjection([ev("ApprovalRequested"), ev("ApprovalExpired")])).toBe("approval_required");
  });
});

describe("runStatusProjection — execution lifecycle", () => {
  it("moves to executing on ExecutionRequested", () => {
    expect(runStatusProjection([ev("ExecutionRequested")])).toBe("executing");
  });
  it("moves to completed on ExecutionCompleted then RunCompleted", () => {
    expect(runStatusProjection([ev("ExecutionRequested"), ev("ExecutionCompleted"), ev("RunCompleted")])).toBe("completed");
  });
  it("moves to blocked on ExecutionRejected", () => {
    expect(runStatusProjection([ev("ExecutionRejected")])).toBe("blocked");
  });
  it("stays executing on ExecutionUnknown", () => {
    expect(runStatusProjection([ev("ExecutionRequested"), ev("ExecutionUnknown")])).toBe("executing");
  });
  it("moves to failed on RunFailed", () => {
    expect(runStatusProjection([ev("ExecutionRequested"), ev("RunFailed")])).toBe("failed");
  });
  it("moves to blocked on ApprovalRevoked", () => {
    expect(runStatusProjection([ev("ApprovalRequested"), ev("ApprovalRevoked")])).toBe("blocked");
  });
});
