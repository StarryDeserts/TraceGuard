import { describe, it, expect } from "vitest";
import { InMemoryLedgerStore, runStatusProjection, sha256hex, verifyChain } from "@traceguard/event-ledger";
import type { DecisionEnvelope, Policy, RunStatus } from "@traceguard/schemas";
import {
  allowDecisionEnvelope,
  allowPolicy,
  approvalDecisionEnvelope,
  approvalPolicy,
  blockDecisionEnvelope,
  blockPolicy,
  fixedClock,
  missingEvidenceEnvelope,
  sampleActorId,
  sampleEvaluationContext,
  sampleWorkspaceId,
  sequentialIdGen,
} from "@traceguard/testing-fixtures";
import { proposeDecision } from "./propose-decision.js";

async function runScenario(envelope: DecisionEnvelope, policy: Policy) {
  const store = new InMemoryLedgerStore();
  const expectedHead = await store.head(sampleWorkspaceId);
  const result = proposeDecision(
    {
      workspaceId: sampleWorkspaceId,
      actorId: sampleActorId,
      envelope,
      policy,
      context: sampleEvaluationContext,
      previousEventHash: expectedHead,
    },
    { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex },
  );
  await store.append(expectedHead, result.events);
  const events = await store.read(sampleWorkspaceId, sampleEvaluationContext.runId);
  verifyChain(events);
  return { result, events, status: runStatusProjection(events) };
}

describe("Phase 1A acceptance", () => {
  it("classifies allow / require_approval / block / rejected and records hash-chained events", async () => {
    const allow = await runScenario(allowDecisionEnvelope, allowPolicy);
    expect(allow.result.decision.outcome).toBe("allow");
    expect(allow.status satisfies RunStatus).toBe("allowed");
    expect(allow.events.map((e) => e.eventType)).toEqual([
      "DecisionProposed",
      "DecisionValidated",
      "PolicyEvaluationStarted",
      "PolicyEvaluated",
    ]);

    const approval = await runScenario(approvalDecisionEnvelope, approvalPolicy);
    expect(approval.result.decision.outcome).toBe("require_approval");
    expect(approval.status satisfies RunStatus).toBe("approval_required");

    const block = await runScenario(blockDecisionEnvelope, blockPolicy);
    expect(block.result.decision.outcome).toBe("block");
    expect(block.status satisfies RunStatus).toBe("blocked");

    const rejected = await runScenario(missingEvidenceEnvelope, allowPolicy);
    expect(rejected.result.decision.outcome).toBe("block");
    expect(rejected.status satisfies RunStatus).toBe("created");
    expect(rejected.events.map((e) => e.eventType)).toEqual(["DecisionProposed", "DecisionRejected"]);
  });
});
