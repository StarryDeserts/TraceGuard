import { describe, it, expect } from "vitest";
import type { GatewayState } from "./gateway-state.js";
import type { RunContext } from "./internal-tool-context.js";
import { DEFAULT_POLICY } from "./default-policy.js";
import {
  EVALUATOR_VERSION,
  buildEvaluationContext,
  intendedUpstreamTool,
  isoPlusSeconds,
  policyVersionId,
} from "./evaluation-context.js";

function state(degraded = false): GatewayState {
  return {
    servedTools: [],
    route: new Map(),
    manifestHash: degraded ? null : "a".repeat(64),
    toolCount: 0,
    degraded,
  };
}

const run: RunContext = { runId: "run_1", mode: "safe_demo" };

describe("evaluation-context helpers", () => {
  it("policyVersionId stringifies the policy version", () => {
    expect(policyVersionId({ version: 1, defaultEffect: "block", rules: [] })).toBe("1");
  });

  it("intendedUpstreamTool maps market types", () => {
    expect(intendedUpstreamTool("spot")).toBe("spot_place_order");
    expect(intendedUpstreamTool("futures")).toBe("futures_place_order");
    expect(intendedUpstreamTool("tokenized_stock")).toBe("tstock_place_order");
  });

  it("isoPlusSeconds adds seconds and returns ISO", () => {
    expect(isoPlusSeconds("2026-06-16T00:00:00.000Z", 900)).toBe("2026-06-16T00:15:00.000Z");
  });

  it("buildEvaluationContext derives a non-degraded context", () => {
    const c = buildEvaluationContext(state(), run, "trade_like", DEFAULT_POLICY);
    expect(c.manifestStatus).toBe("approved");
    expect(c.snapshotAgeSeconds).toBe(0);
    expect(c.evaluatorVersion).toBe(EVALUATOR_VERSION);
    expect(c.workspaceMode).toBe("safe_demo");
    expect(c.toolRiskClass).toBe("trade_like");
    expect(c.instrumentAllowlist).toEqual([]);
  });

  it("buildEvaluationContext reports needs_review when degraded", () => {
    const c = buildEvaluationContext(state(true), run, "trade_like", DEFAULT_POLICY);
    expect(c.manifestStatus).toBe("needs_review");
  });
});
