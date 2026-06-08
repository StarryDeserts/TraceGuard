import { describe, it, expect } from "vitest";
import { Policy, Condition, EvaluationContext, WorkspaceMode, ManifestStatus, ToolRiskClass } from "./policy.js";

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
      manifestStatus: "approved",
      snapshotAgeSeconds: 12,
      toolRiskClass: "trade_like",
      instrumentAllowlist: ["BTCUSDT"],
    });
    expect(ctx.policyVersionId).toBe("pv_1");
  });

  it("accepts only canonical context enum values", () => {
    expect(WorkspaceMode.parse("safe_demo")).toBe("safe_demo");
    expect(WorkspaceMode.parse("approval_mode")).toBe("approval_mode");
    expect(WorkspaceMode.parse("guarded_autopilot")).toBe("guarded_autopilot");
    expect(WorkspaceMode.parse("locked_investigation")).toBe("locked_investigation");

    expect(ManifestStatus.parse("approved")).toBe("approved");
    expect(ManifestStatus.parse("needs_review")).toBe("needs_review");
    expect(ManifestStatus.parse("frozen")).toBe("frozen");
    expect(ManifestStatus.parse("blocked")).toBe("blocked");

    expect(ToolRiskClass.parse("public_read")).toBe("public_read");
    expect(ToolRiskClass.parse("account_read")).toBe("account_read");
    expect(ToolRiskClass.parse("trade_like")).toBe("trade_like");
    expect(ToolRiskClass.parse("asset_movement")).toBe("asset_movement");
    expect(ToolRiskClass.parse("administrative")).toBe("administrative");
    expect(ToolRiskClass.parse("unknown")).toBe("unknown");
  });

  it("rejects non-canonical evaluation context values", () => {
    const baseContext = {
      runId: "run_1",
      policyVersionId: "pv_1",
      evaluatorVersion: "policy-engine@1.0.0",
      workspaceMode: "approval_mode",
      manifestStatus: "approved",
      snapshotAgeSeconds: 12,
      toolRiskClass: "trade_like",
      instrumentAllowlist: ["BTCUSDT"],
    };

    expect(EvaluationContext.safeParse({ ...baseContext, manifestStatus: "active" }).success).toBe(false);
    expect(EvaluationContext.safeParse({ ...baseContext, toolRiskClass: "trade" }).success).toBe(false);
  });

  it("rejects conditions with non-canonical context values", () => {
    expect(Condition.safeParse({ kind: "manifest_status_eq", value: "active" }).success).toBe(false);
    expect(Condition.safeParse({ kind: "tool_risk_class_eq", value: "trade" }).success).toBe(false);
    expect(Condition.safeParse({ kind: "workspace_mode_eq", value: "paper" }).success).toBe(false);
  });
});
