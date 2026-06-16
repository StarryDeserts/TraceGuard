import type { Effect, ActionDigestInput } from "@traceguard/schemas";
import type { AuthorizationSummary } from "@traceguard/domain";

export interface CachedDecision {
  decisionId: string;
  outcome: Effect; // "allow" | "require_approval" | "block"
  matchedRules: string[];
  policyEvaluationId: string; // from the PolicyEvaluated payload
  decisionHash: string; // from the DecisionProposed payload
  summary: AuthorizationSummary; // { instrument, action, notionalUsdt?, leverage? }
  digestBase: Omit<ActionDigestInput, "executionAdapter">; // every digest field but the adapter
}

export interface DecisionCache {
  decisions: Map<string, CachedDecision>;
  approvalIndex: Map<string, { runId: string; decisionId: string }>; // approvalId → correlation
}

export function createDecisionCache(): DecisionCache {
  return { decisions: new Map(), approvalIndex: new Map() };
}
