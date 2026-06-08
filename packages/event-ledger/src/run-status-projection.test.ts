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
  it("defaults to created and ignores DecisionProposed", () => {
    expect(runStatusProjection([ev("DecisionProposed")])).toBe("created");
  });
  it("folds a full allow flow to allowed", () => {
    expect(
      runStatusProjection([
        ev("DecisionProposed"),
        ev("DecisionValidated"),
        ev("PolicyEvaluationStarted"),
        ev("PolicyEvaluated", { outcome: "allow" }),
      ]),
    ).toBe("allowed");
  });
  it("maps require_approval and block outcomes", () => {
    expect(runStatusProjection([ev("PolicyEvaluated", { outcome: "require_approval" })])).toBe("approval_required");
    expect(runStatusProjection([ev("PolicyEvaluated", { outcome: "block" })])).toBe("blocked");
  });
  it("leaves a rejected decision at created (never advances)", () => {
    expect(runStatusProjection([ev("DecisionProposed"), ev("DecisionRejected")])).toBe("created");
  });
});
