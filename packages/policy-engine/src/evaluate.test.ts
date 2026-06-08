import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { evaluate } from "./evaluate.js";
import type { DecisionEnvelope, EvaluationContext, Policy } from "@traceguard/schemas";

const envelope: DecisionEnvelope = {
  id: "dec_1",
  instrument: "BTCUSDT",
  marketType: "futures",
  action: "open_long",
  thesis: "Momentum positive.",
  evidenceRefs: ["ev_1"],
  requestedNotionalUsdt: "300",
  requestedLeverage: "2",
};

const context: EvaluationContext = {
  runId: "run_1",
  policyVersionId: "pv_1",
  evaluatorVersion: "policy-engine@1.0.0",
  workspaceMode: "approval_mode",
  manifestStatus: "active",
  snapshotAgeSeconds: 10,
  toolRiskClass: "trade",
  instrumentAllowlist: ["BTCUSDT"],
};

function policy(rules: Policy["rules"]): Policy {
  return { version: 1, defaultEffect: "block", rules };
}

describe("evaluate", () => {
  it("defaults to block when no rule matches", () => {
    expect(evaluate(envelope, policy([]), context)).toEqual({ outcome: "block", matchedRules: [] });
  });

  it("allows when only an allow rule matches", () => {
    const result = evaluate(
      envelope,
      policy([{ id: "allow-btc", effect: "allow", conditions: [{ kind: "instrument_in", values: ["BTCUSDT"] }] }]),
      context,
    );
    expect(result.outcome).toBe("allow");
    expect(result.matchedRules[0]).toMatchObject({ ruleId: "allow-btc", outcome: "allow" });
  });

  it("applies precedence block > require_approval > allow", () => {
    const result = evaluate(
      envelope,
      policy([
        { id: "allow-small", effect: "allow", conditions: [{ kind: "notional_lte", value: "500" }] },
        { id: "approval-large", effect: "require_approval", conditions: [{ kind: "notional_gt", value: "200" }] },
        { id: "block-stale", effect: "block", conditions: [{ kind: "snapshot_age_gt", seconds: 5 }] },
      ]),
      context,
    );
    expect(result.outcome).toBe("block");
    expect(result.matchedRules.map((r) => r.ruleId)).toEqual(["allow-small", "approval-large", "block-stale"]);
  });

  it("requires approval when require_approval and allow match but no block rule matches", () => {
    const result = evaluate(
      envelope,
      policy([
        { id: "allow-btc", effect: "allow", conditions: [{ kind: "instrument_in", values: ["BTCUSDT"] }] },
        { id: "approval-large", effect: "require_approval", conditions: [{ kind: "notional_gt", value: "200" }] },
      ]),
      context,
    );
    expect(result.outcome).toBe("require_approval");
  });

  it("property: any matched block rule forces block", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("allow" as const, "require_approval" as const), { maxLength: 8 }), (effects) => {
        const rules: Policy["rules"] = effects.map((effect, index) => ({
          id: `r${index}`,
          effect,
          conditions: [{ kind: "action_in", values: ["open_long"] }],
        }));
        rules.push({ id: "block-any-open-long", effect: "block", conditions: [{ kind: "action_in", values: ["open_long"] }] });
        expect(evaluate(envelope, policy(rules), context).outcome).toBe("block");
      }),
    );
  });

  it("property: no matching rules remains default-deny block", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("allow" as const, "require_approval" as const, "block" as const), { maxLength: 8 }), (effects) => {
        const rules: Policy["rules"] = effects.map((effect, index) => ({
          id: `miss${index}`,
          effect,
          conditions: [{ kind: "action_in", values: ["close"] }],
        }));
        expect(evaluate(envelope, policy(rules), context)).toEqual({ outcome: "block", matchedRules: [] });
      }),
    );
  });
});
