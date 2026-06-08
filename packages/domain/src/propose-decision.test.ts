import { describe, it, expect } from "vitest";
import { sha256hex, verifyChain } from "@traceguard/event-ledger";
import {
  allowDecisionEnvelope,
  allowPolicy,
  fixedClock,
  missingEvidenceEnvelope,
  sampleActorId,
  sampleEvaluationContext,
  sampleWorkspaceId,
  sequentialIdGen,
} from "@traceguard/testing-fixtures";
import { proposeDecision } from "./propose-decision.js";

function deps() {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

describe("proposeDecision", () => {
  it("emits a deterministic allow event sequence", () => {
    const args = {
      workspaceId: sampleWorkspaceId,
      actorId: sampleActorId,
      envelope: allowDecisionEnvelope,
      policy: allowPolicy,
      context: sampleEvaluationContext,
      previousEventHash: null,
    };
    const a = proposeDecision(args, deps());
    const b = proposeDecision(args, deps());

    expect(a).toEqual(b);
    expect(a.decision.outcome).toBe("allow");
    expect(a.events.map((e) => e.eventType)).toEqual([
      "DecisionProposed",
      "DecisionValidated",
      "PolicyEvaluationStarted",
      "PolicyEvaluated",
    ]);
    expect(a.events[0]!.previousEventHash).toBeUndefined();
    expect(a.events[1]!.previousEventHash).toBe(a.events[0]!.eventHash);
    expect(a.events[3]!.payload).toMatchObject({ outcome: "allow" });
    expect(() => verifyChain(a.events)).not.toThrow();
  });

  it("rejects missing evidence and stops before policy evaluation", () => {
    const result = proposeDecision(
      {
        workspaceId: sampleWorkspaceId,
        actorId: sampleActorId,
        envelope: missingEvidenceEnvelope,
        policy: allowPolicy,
        context: sampleEvaluationContext,
        previousEventHash: null,
      },
      deps(),
    );

    expect(result.decision).toEqual({ outcome: "block", matchedRules: [] });
    expect(result.events.map((e) => e.eventType)).toEqual(["DecisionProposed", "DecisionRejected"]);
    expect(result.events[1]!.payload).toMatchObject({ reasonCode: "missing_evidence" });
    expect(() => verifyChain(result.events)).not.toThrow();
  });

  it("emits only DecisionRejected when the raw input is not a canonical DecisionEnvelope", () => {
    const result = proposeDecision(
      {
        workspaceId: sampleWorkspaceId,
        actorId: sampleActorId,
        envelope: { ...allowDecisionEnvelope, requestedNotionalUsdt: 300 },
        policy: allowPolicy,
        context: sampleEvaluationContext,
        previousEventHash: null,
      },
      deps(),
    );

    expect(result.decision.outcome).toBe("block");
    expect(result.events.map((e) => e.eventType)).toEqual(["DecisionRejected"]);
    expect(result.events[0]!.payload).toMatchObject({ reasonCode: "numeric_parse_error" });
    expect(() => verifyChain(result.events)).not.toThrow();
  });
});
