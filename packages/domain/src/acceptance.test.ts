import { describe, it, expect } from "vitest";
import { InMemoryLedgerStore, runStatusProjection, sha256hex, verifyChain } from "@traceguard/event-ledger";
import type { Policy, RunStatus } from "@traceguard/schemas";
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

const expectedValidSequence = ["DecisionProposed", "DecisionValidated", "PolicyEvaluationStarted", "PolicyEvaluated"];

async function runScenario(envelope: unknown, policy: Policy) {
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
    expect(allow.events.map((e) => e.eventType)).toEqual(expectedValidSequence);
    expect(allow.events.at(-1)?.payload).toMatchObject({ outcome: "allow" });

    const approval = await runScenario(approvalDecisionEnvelope, approvalPolicy);
    expect(approval.result.decision.outcome).toBe("require_approval");
    expect(approval.status satisfies RunStatus).toBe("approval_required");
    expect(approval.events.map((e) => e.eventType)).toEqual(expectedValidSequence);
    expect(approval.events.at(-1)?.payload).toMatchObject({ outcome: "require_approval" });

    const block = await runScenario(blockDecisionEnvelope, blockPolicy);
    expect(block.result.decision.outcome).toBe("block");
    expect(block.status satisfies RunStatus).toBe("blocked");
    expect(block.events.map((e) => e.eventType)).toEqual(expectedValidSequence);
    expect(block.events.at(-1)?.payload).toMatchObject({ outcome: "block" });

    const semanticRejected = await runScenario(missingEvidenceEnvelope, allowPolicy);
    expect(semanticRejected.result.decision.outcome).toBe("block");
    expect(semanticRejected.status satisfies RunStatus).toBe("created");
    expect(semanticRejected.events.map((e) => e.eventType)).toEqual(["DecisionProposed", "DecisionRejected"]);

    const schemaInvalidRejected = await runScenario({ ...allowDecisionEnvelope, requestedNotionalUsdt: 300 }, allowPolicy);
    expect(schemaInvalidRejected.result.decision.outcome).toBe("block");
    expect(schemaInvalidRejected.status satisfies RunStatus).toBe("created");
    expect(schemaInvalidRejected.events.map((e) => e.eventType)).toEqual(["DecisionRejected"]);
    expect(schemaInvalidRejected.events[0]?.payload).toMatchObject({ reasonCode: "numeric_parse_error" });
  });
});
