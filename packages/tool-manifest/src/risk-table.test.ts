import { describe, expect, it } from "vitest";
import { BITGET_RISK_TABLE, lookupBaseClass, type BaseClass } from "./risk-table.js";

describe("BITGET_RISK_TABLE", () => {
  it("maps exactly 36 tools", () => {
    expect(Object.keys(BITGET_RISK_TABLE)).toHaveLength(36);
  });

  it("has the locked class distribution 13/10/9/3/1", () => {
    const counts: Record<BaseClass, number> = {
      public_read: 0,
      account_read: 0,
      trade_like: 0,
      asset_movement: 0,
      administrative: 0,
    };
    for (const c of Object.values(BITGET_RISK_TABLE)) counts[c] += 1;
    expect(counts).toEqual({
      public_read: 13,
      account_read: 10,
      trade_like: 9,
      asset_movement: 3,
      administrative: 1,
    });
  });

  it("classifies representative tools correctly", () => {
    expect(BITGET_RISK_TABLE.spot_get_ticker).toBe("public_read");
    expect(BITGET_RISK_TABLE.get_account_assets).toBe("account_read");
    expect(BITGET_RISK_TABLE.futures_place_order).toBe("trade_like");
    expect(BITGET_RISK_TABLE.withdraw).toBe("asset_movement");
    expect(BITGET_RISK_TABLE.manage_subaccounts).toBe("administrative");
  });
});

describe("lookupBaseClass", () => {
  it("returns the base class for a known bitget tool", () => {
    expect(lookupBaseClass("bitget_agent_hub", "withdraw")).toBe("asset_movement");
  });

  it("returns undefined for an unknown tool name", () => {
    expect(lookupBaseClass("bitget_agent_hub", "mystery")).toBeUndefined();
  });

  it("returns undefined for a provider with no table", () => {
    expect(lookupBaseClass("custom_mcp", "withdraw")).toBeUndefined();
  });
});
