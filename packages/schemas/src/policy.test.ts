import { describe, it, expect } from "vitest";
import { Policy, Condition, EvaluationContext } from "./policy.js";

describe("Policy AST", () => {
  it("accepts a policy with a default-deny and one rule", () => {
    const p = Policy.parse({
      version: 1,
      defaultEffect: "block",
      rules: [
        {
          id: "r1",
          effect: "require_approval",
          conditions: [{ kind: "notional_gt", value: "200" }],
        },
      ],
    });
    expect(p.defaultEffect).toBe("block");
  });

  it("forces defaultEffect to be 'block' (default-deny)", () => {
    expect(() => Policy.parse({ version: 1, defaultEffect: "allow", rules: [] })).toThrow();
  });

  it("rejects an unknown condition kind", () => {
    expect(() => Condition.parse({ kind: "wat", value: "1" })).toThrow();
  });

  it("accepts decimal strings and rejects numbers for every financial comparator", () => {
    const financialConditionKinds = [
      "notional_lt",
      "notional_lte",
      "notional_eq",
      "notional_gte",
      "notional_gt",
      "quantity_lt",
      "quantity_lte",
      "quantity_eq",
      "quantity_gte",
      "quantity_gt",
      "leverage_lt",
      "leverage_lte",
      "leverage_eq",
      "leverage_gte",
      "leverage_gt",
    ] as const;

    for (const kind of financialConditionKinds) {
      expect(Condition.safeParse({ kind, value: "123.45" }).success).toBe(true);
      expect(Condition.safeParse({ kind, value: 123.45 }).success).toBe(false);
    }
  });

  it("accepts the evaluation context needed by predicates and event payloads", () => {
    const ctx = EvaluationContext.parse({
      runId: "run_1",
      policyVersionId: "pv_1",
      evaluatorVersion: "policy-engine@1.0.0",
      workspaceMode: "approval_mode",
      manifestStatus: "active",
      snapshotAgeSeconds: 12,
      toolRiskClass: "trade",
      instrumentAllowlist: ["BTCUSDT"],
    });
    expect(ctx.policyVersionId).toBe("pv_1");
  });
});
