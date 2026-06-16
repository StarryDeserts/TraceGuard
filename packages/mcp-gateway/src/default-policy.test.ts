import { describe, it, expect } from "vitest";
import { evaluate } from "@traceguard/policy-engine";
import type { DecisionEnvelope, EvaluationContext } from "@traceguard/schemas";
import { DEFAULT_POLICY, NOTIONAL_APPROVAL_THRESHOLD_USDT } from "./default-policy.js";

function ctx(): EvaluationContext {
  return {
    runId: "run_1",
    policyVersionId: "1",
    evaluatorVersion: "traceguard-3e1",
    workspaceMode: "safe_demo",
    manifestStatus: "approved",
    snapshotAgeSeconds: 0,
    toolRiskClass: "trade_like",
    instrumentAllowlist: [],
  };
}

function envelope(over: Partial<DecisionEnvelope>): DecisionEnvelope {
  return {
    id: "dec_1",
    instrument: "BTCUSDT",
    marketType: "futures",
    action: "open_long",
    thesis: "t",
    evidenceRefs: ["ev:1"],
    ...over,
  } as DecisionEnvelope;
}

describe("DEFAULT_POLICY", () => {
  it("blocks leverage > 3", () => {
    const d = evaluate(envelope({ requestedLeverage: "5", requestedNotionalUsdt: "100" }), DEFAULT_POLICY, ctx());
    expect(d.outcome).toBe("block");
  });

  it("requires approval for notional > threshold at safe leverage", () => {
    const d = evaluate(envelope({ requestedLeverage: "2", requestedNotionalUsdt: "5000" }), DEFAULT_POLICY, ctx());
    expect(d.outcome).toBe("require_approval");
  });

  it("allows a small trade_like decision at safe leverage", () => {
    const d = evaluate(envelope({ requestedLeverage: "2", requestedNotionalUsdt: "100" }), DEFAULT_POLICY, ctx());
    expect(d.outcome).toBe("allow");
  });

  it("exposes the notional threshold constant", () => {
    expect(NOTIONAL_APPROVAL_THRESHOLD_USDT).toBe("1000");
  });
});
