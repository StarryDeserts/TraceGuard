import type { EvaluationContext, Policy, ToolRiskClass } from "@traceguard/schemas";
import type { GatewayState } from "./gateway-state.js";
import type { RunContext } from "./internal-tool-context.js";

export const EVALUATOR_VERSION = "traceguard-3e1";

export function policyVersionId(policy: Policy): string {
  return String(policy.version);
}

export function intendedUpstreamTool(marketType: string): string {
  switch (marketType) {
    case "spot":
      return "spot_place_order";
    case "futures":
      return "futures_place_order";
    case "tokenized_stock":
      return "tstock_place_order";
    default:
      return "spot_place_order";
  }
}

export function isoPlusSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

export function buildEvaluationContext(
  state: GatewayState,
  run: RunContext,
  toolRiskClass: ToolRiskClass,
  policy: Policy,
): EvaluationContext {
  return {
    runId: run.runId,
    policyVersionId: policyVersionId(policy),
    evaluatorVersion: EVALUATOR_VERSION,
    workspaceMode: run.mode as EvaluationContext["workspaceMode"],
    manifestStatus: state.degraded ? "needs_review" : "approved",
    snapshotAgeSeconds: 0,
    toolRiskClass,
    instrumentAllowlist: [],
  };
}
