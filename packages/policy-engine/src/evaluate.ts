import type { DecisionEnvelope, Effect, EvaluationContext, MatchedRule, Policy } from "@traceguard/schemas";
import { evaluateCondition } from "./predicates.js";

export interface PolicyDecision {
  outcome: Effect;
  matchedRules: MatchedRule[];
}

function chooseOutcome(matchedRules: MatchedRule[], defaultEffect: Policy["defaultEffect"]): Effect {
  if (matchedRules.some((rule) => rule.outcome === "block")) return "block";
  if (matchedRules.some((rule) => rule.outcome === "require_approval")) return "require_approval";
  if (matchedRules.some((rule) => rule.outcome === "allow")) return "allow";
  return defaultEffect;
}

export function evaluate(envelope: DecisionEnvelope, policy: Policy, context: EvaluationContext): PolicyDecision {
  const matchedRules: MatchedRule[] = [];

  for (const rule of policy.rules) {
    const predicateResults = rule.conditions.map((condition) => evaluateCondition(condition, envelope, context));
    const matched = predicateResults.every((result) => result.matched);

    if (matched) {
      matchedRules.push({
        ruleId: rule.id,
        outcome: rule.effect,
        explanation:
          predicateResults.length === 0 ? "always" : predicateResults.map((result) => result.explanation).join(" AND "),
        expected: predicateResults.map((result) => result.expected ?? null),
        actual: predicateResults.map((result) => result.actual ?? null),
      });
    }
  }

  return {
    outcome: chooseOutcome(matchedRules, policy.defaultEffect),
    matchedRules,
  };
}
