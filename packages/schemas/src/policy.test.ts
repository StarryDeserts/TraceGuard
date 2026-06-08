import { describe, it, expect } from "vitest";
import { Policy, Condition } from "./policy.js";

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
});
