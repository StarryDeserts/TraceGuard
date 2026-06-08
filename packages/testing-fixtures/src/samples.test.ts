import { describe, it, expect } from "vitest";
import { DecisionEnvelope, EvaluationContext, Policy } from "@traceguard/schemas";
import { fixedClock, sequentialIdGen } from "./deps.js";
import {
  allowDecisionEnvelope,
  allowPolicy,
  approvalPolicy,
  blockPolicy,
  missingEvidenceEnvelope,
  sampleEvaluationContext,
  sampleRunId,
  sampleWorkspaceId,
} from "./samples.js";

describe("testing fixtures", () => {
  it("provides deterministic clock and id doubles", () => {
    const clock = fixedClock();
    const ids = sequentialIdGen();
    expect(clock.now()).toBe("2026-06-08T00:00:00.000Z");
    expect(ids.next("evt")).toBe("evt_000001");
    expect(ids.next("eval")).toBe("eval_000002");
  });

  it("provides schema-valid sample envelopes and policies", () => {
    expect(DecisionEnvelope.parse(allowDecisionEnvelope).id).toBe("dec_allow");
    expect(DecisionEnvelope.parse(missingEvidenceEnvelope).evidenceRefs).toEqual([]);
    expect(Policy.parse(allowPolicy).rules[0]!.effect).toBe("allow");
    expect(Policy.parse(approvalPolicy).rules[0]!.effect).toBe("require_approval");
    expect(Policy.parse(blockPolicy).rules[0]!.effect).toBe("block");
  });

  it("provides a schema-valid evaluation context and stable ids", () => {
    expect(sampleWorkspaceId).toBe("ws_1");
    expect(sampleRunId).toBe("run_1");
    expect(EvaluationContext.parse(sampleEvaluationContext).runId).toBe(sampleRunId);
  });
});
