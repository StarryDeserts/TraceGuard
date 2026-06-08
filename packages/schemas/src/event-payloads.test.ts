import { describe, it, expect } from "vitest";
import {
  DecisionProposedPayload,
  DecisionValidatedPayload,
  DecisionRejectedPayload,
  PolicyEvaluationStartedPayload,
  PolicyEvaluatedPayload,
} from "./event-payloads.js";

describe("event payloads", () => {
  it("DecisionProposedPayload requires decisionHash and a canonical action", () => {
    const p = DecisionProposedPayload.parse({
      decisionId: "dec_1",
      runId: "run_1",
      envelopeVersion: 1,
      instrument: "BTCUSDT",
      marketType: "futures",
      action: "open_long",
      thesis: "x",
      evidenceRefs: [],
      decisionHash: "sha",
    });
    expect(p.decisionHash).toBe("sha");
  });

  it("DecisionValidatedPayload pins validationResult to 'valid'", () => {
    expect(() =>
      DecisionValidatedPayload.parse({
        decisionId: "dec_1",
        runId: "run_1",
        validationResult: "invalid",
        normalizedDecisionRef: "ref",
        normalizedDecisionHash: "h",
      }),
    ).toThrow();
  });

  it("DecisionRejectedPayload constrains reasonCode", () => {
    const p = DecisionRejectedPayload.parse({
      runId: "run_1",
      reasonCode: "schema_invalid",
      validationErrors: [{ path: "action", message: "bad" }],
    });
    expect(p.reasonCode).toBe("schema_invalid");
    expect(() => DecisionRejectedPayload.parse({ runId: "run_1", reasonCode: "nope", validationErrors: [] })).toThrow();
  });

  it("PolicyEvaluationStartedPayload requires evaluationInputHash", () => {
    const p = PolicyEvaluationStartedPayload.parse({
      evaluationId: "eval_1",
      runId: "run_1",
      decisionId: "dec_1",
      policyVersionId: "pv_1",
      evaluatorVersion: "1.0.0",
      evaluationInputHash: "h",
    });
    expect(p.evaluatorVersion).toBe("1.0.0");
  });

  it("PolicyEvaluatedPayload carries outcome + matchedRules", () => {
    const p = PolicyEvaluatedPayload.parse({
      evaluationId: "eval_1",
      runId: "run_1",
      decisionId: "dec_1",
      policyVersionId: "pv_1",
      evaluatorVersion: "1.0.0",
      outcome: "require_approval",
      matchedRules: [{ ruleId: "r1", outcome: "require_approval", explanation: "notional>200" }],
      evaluationOutputHash: "h",
    });
    expect(p.outcome).toBe("require_approval");
  });
});
