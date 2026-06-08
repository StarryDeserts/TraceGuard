import { z } from "zod";
import { DecimalString } from "./scalars.js";
import { DecisionAction, MarketType } from "./decision-envelope.js";

export const Effect = z.enum(["allow", "require_approval", "block"]);
export type Effect = z.infer<typeof Effect>;

export const DecisionProposedPayload = z
  .object({
    decisionId: z.string().min(1),
    runId: z.string().min(1),
    envelopeVersion: z.number().int().nonnegative(),
    instrument: z.string().min(1),
    marketType: MarketType,
    action: DecisionAction,
    thesis: z.string(),
    confidence: z.number().optional(),
    evidenceRefs: z.array(z.string()),
    requestedNotionalUsdt: DecimalString.optional(),
    requestedQuantity: DecimalString.optional(),
    requestedLeverage: DecimalString.optional(),
    orderType: z.string().optional(),
    limitPrice: DecimalString.optional(),
    stopLoss: DecimalString.optional(),
    takeProfit: DecimalString.optional(),
    promptVersion: z.string().optional(),
    modelProvider: z.string().optional(),
    modelName: z.string().optional(),
    decisionHash: z.string().min(1),
  })
  .strict();
export type DecisionProposedPayload = z.infer<typeof DecisionProposedPayload>;

export const DecisionValidatedPayload = z
  .object({
    decisionId: z.string().min(1),
    runId: z.string().min(1),
    validationResult: z.literal("valid"),
    normalizedDecisionRef: z.string().min(1),
    normalizedDecisionHash: z.string().min(1),
  })
  .strict();
export type DecisionValidatedPayload = z.infer<typeof DecisionValidatedPayload>;

export const DecisionRejectedPayload = z
  .object({
    decisionId: z.string().optional(),
    runId: z.string().min(1),
    reasonCode: z.enum([
      "schema_invalid",
      "missing_required_field",
      "unsupported_action",
      "missing_evidence",
      "snapshot_rejected",
      "numeric_parse_error",
    ]),
    validationErrors: z.array(z.object({ path: z.string(), message: z.string() }).strict()),
  })
  .strict();
export type DecisionRejectedPayload = z.infer<typeof DecisionRejectedPayload>;

export const PolicyEvaluationStartedPayload = z
  .object({
    evaluationId: z.string().min(1),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    policyVersionId: z.string().min(1),
    evaluatorVersion: z.string().min(1),
    evaluationInputHash: z.string().min(1),
  })
  .strict();
export type PolicyEvaluationStartedPayload = z.infer<typeof PolicyEvaluationStartedPayload>;

export const MatchedRule = z
  .object({
    ruleId: z.string().min(1),
    outcome: Effect,
    explanation: z.string(),
    expected: z.unknown().optional(),
    actual: z.unknown().optional(),
  })
  .strict();
export type MatchedRule = z.infer<typeof MatchedRule>;

export const PolicyEvaluatedPayload = z
  .object({
    evaluationId: z.string().min(1),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    policyVersionId: z.string().min(1),
    evaluatorVersion: z.string().min(1),
    outcome: Effect,
    matchedRules: z.array(MatchedRule),
    evaluationOutputHash: z.string().min(1),
  })
  .strict();
export type PolicyEvaluatedPayload = z.infer<typeof PolicyEvaluatedPayload>;
