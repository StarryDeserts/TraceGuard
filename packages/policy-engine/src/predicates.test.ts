import { describe, it, expect } from "vitest";
import { compareDecimalStrings, evaluateCondition } from "./predicates.js";
import type { Condition, DecisionEnvelope, EvaluationContext } from "@traceguard/schemas";

const envelope: DecisionEnvelope = {
  id: "dec_1",
  instrument: "BTCUSDT",
  marketType: "futures",
  action: "open_long",
  thesis: "Momentum positive.",
  confidence: 0.7,
  evidenceRefs: ["ev_1"],
  requestedNotionalUsdt: "200.50",
  requestedQuantity: "0.10",
  requestedLeverage: "2",
};

const context: EvaluationContext = {
  runId: "run_1",
  policyVersionId: "pv_1",
  evaluatorVersion: "policy-engine@1.0.0",
  workspaceMode: "approval_mode",
  manifestStatus: "active",
  snapshotAgeSeconds: 30,
  toolRiskClass: "trade",
  instrumentAllowlist: ["BTCUSDT"],
};

describe("compareDecimalStrings", () => {
  it("compares decimal strings without floats", () => {
    expect(compareDecimalStrings("200.50", "200.5")).toBe(0);
    expect(compareDecimalStrings("200.5001", "200.5")).toBe(1);
    expect(compareDecimalStrings("-1.25", "0")).toBe(-1);
  });
});

describe("evaluateCondition", () => {
  it("matches action, instrument, and market conditions", () => {
    expect(evaluateCondition({ kind: "action_in", values: ["open_long"] }, envelope, context).matched).toBe(true);
    expect(evaluateCondition({ kind: "instrument_in", values: ["BTCUSDT"] }, envelope, context).matched).toBe(true);
    expect(evaluateCondition({ kind: "market_type_in", values: ["futures"] }, envelope, context).matched).toBe(true);
  });

  it("requires instrument to be present in both policy values and context allowlist", () => {
    const blockedContext = { ...context, instrumentAllowlist: [] };
    expect(evaluateCondition({ kind: "instrument_in", values: ["BTCUSDT"] }, envelope, blockedContext).matched).toBe(false);
  });

  it("matches all financial comparator variants", () => {
    const cases: Array<[Condition, boolean]> = [
      [{ kind: "notional_lt", value: "201" }, true],
      [{ kind: "notional_lte", value: "200.50" }, true],
      [{ kind: "notional_eq", value: "200.500" }, true],
      [{ kind: "notional_gte", value: "200.5" }, true],
      [{ kind: "notional_gt", value: "200.499" }, true],
      [{ kind: "quantity_lt", value: "0.11" }, true],
      [{ kind: "quantity_lte", value: "0.10" }, true],
      [{ kind: "quantity_eq", value: "0.100" }, true],
      [{ kind: "quantity_gte", value: "0.1" }, true],
      [{ kind: "quantity_gt", value: "0.09" }, true],
      [{ kind: "leverage_lt", value: "3" }, true],
      [{ kind: "leverage_lte", value: "2.0" }, true],
      [{ kind: "leverage_eq", value: "2.00" }, true],
      [{ kind: "leverage_gte", value: "2" }, true],
      [{ kind: "leverage_gt", value: "1.5" }, true],
      [{ kind: "notional_lt", value: "200.50" }, false],
      [{ kind: "quantity_eq", value: "0.11" }, false],
      [{ kind: "leverage_gt", value: "2" }, false],
    ];
    for (const [condition, expected] of cases) {
      expect(evaluateCondition(condition, envelope, context).matched).toBe(expected);
    }
  });

  it("does not match financial conditions when the envelope value is absent", () => {
    const { requestedNotionalUsdt, ...withoutNotional } = envelope;
    expect(evaluateCondition({ kind: "notional_gt", value: "1" }, withoutNotional, context).matched).toBe(false);
    expect(requestedNotionalUsdt).toBe("200.50");
  });

  it("matches context predicates", () => {
    expect(evaluateCondition({ kind: "workspace_mode_eq", value: "approval_mode" }, envelope, context).matched).toBe(true);
    expect(evaluateCondition({ kind: "manifest_status_eq", value: "active" }, envelope, context).matched).toBe(true);
    expect(evaluateCondition({ kind: "snapshot_age_gt", seconds: 10 }, envelope, context).matched).toBe(true);
    expect(evaluateCondition({ kind: "tool_risk_class_eq", value: "trade" }, envelope, context).matched).toBe(true);
  });
});
