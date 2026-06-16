import { describe, it, expect } from "vitest";
import type { CachedDecision } from "./decision-cache.js";
import { createDecisionCache } from "./decision-cache.js";

function sample(): CachedDecision {
  return {
    decisionId: "dec_1",
    outcome: "allow",
    matchedRules: ["allow-trade-like"],
    policyEvaluationId: "eval_1",
    decisionHash: "f".repeat(64),
    summary: { instrument: "BTCUSDT", action: "open_long", notionalUsdt: "100" },
    digestBase: {
      workspaceId: "ws_demo",
      runId: "run_1",
      decisionId: "dec_1",
      providerConnectionId: "pc_bitget",
      toolName: "futures_place_order",
      toolManifestHash: "a".repeat(64),
      policyVersionId: "1",
      workspaceMode: "safe_demo",
      instrument: "BTCUSDT",
      marketType: "futures",
      action: "open_long",
      requestedNotionalUsdt: "100",
    },
  };
}

describe("createDecisionCache", () => {
  it("starts with empty maps", () => {
    const cache = createDecisionCache();
    expect(cache.decisions.size).toBe(0);
    expect(cache.approvalIndex.size).toBe(0);
  });

  it("round-trips a CachedDecision", () => {
    const cache = createDecisionCache();
    const d = sample();
    cache.decisions.set(d.decisionId, d);
    expect(cache.decisions.get("dec_1")?.outcome).toBe("allow");
    expect(cache.decisions.get("dec_1")?.digestBase.toolName).toBe("futures_place_order");
  });

  it("round-trips an approval correlation", () => {
    const cache = createDecisionCache();
    cache.approvalIndex.set("appr_1", { runId: "run_1", decisionId: "dec_1" });
    expect(cache.approvalIndex.get("appr_1")).toEqual({ runId: "run_1", decisionId: "dec_1" });
  });
});
