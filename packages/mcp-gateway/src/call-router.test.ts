import { describe, it, expect } from "vitest";
import type { RiskClass } from "@traceguard/schemas";
import type { ToolStatus } from "@traceguard/event-ledger";
import type { GatewayState } from "./gateway-state.js";
import { routeCall } from "./call-router.js";

function stateWith(rows: Array<[string, ToolStatus, RiskClass]>): GatewayState {
  return {
    servedTools: [],
    route: new Map(rows.map(([name, status, riskClass]) => [name, { status, riskClass }])),
    manifestHash: null,
    toolCount: rows.length,
    degraded: false,
  };
}

describe("routeCall", () => {
  it("forwards public_read", () => {
    const out = routeCall(stateWith([["spot_get_ticker", "active", "public_read"]]), "spot_get_ticker");
    expect(out).toEqual({ kind: "forward", riskClass: "public_read" });
  });

  it("forwards account_read", () => {
    const out = routeCall(stateWith([["get_account_assets", "active", "account_read"]]), "get_account_assets");
    expect(out).toEqual({ kind: "forward", riskClass: "account_read" });
  });

  it("denies trade_like with DECISION_ENVELOPE_REQUIRED (no incident)", () => {
    const out = routeCall(stateWith([["spot_place_order", "active", "trade_like"]]), "spot_place_order");
    expect(out).toEqual({
      kind: "deny",
      code: "DECISION_ENVELOPE_REQUIRED",
      incident: false,
      riskClass: "trade_like",
    });
  });

  it("denies blocked tools with TOOL_BLOCKED and opens an incident", () => {
    const out = routeCall(stateWith([["withdraw", "blocked", "asset_movement"]]), "withdraw");
    expect(out).toEqual({
      kind: "deny",
      code: "TOOL_BLOCKED",
      incident: true,
      riskClass: "asset_movement",
    });
  });

  it("status beats risk class: a frozen public_read tool is TOOL_FROZEN", () => {
    const out = routeCall(stateWith([["spot_get_ticker", "frozen", "public_read"]]), "spot_get_ticker");
    expect(out).toEqual({
      kind: "deny",
      code: "TOOL_FROZEN",
      incident: false,
      riskClass: "public_read",
    });
  });

  it("status beats risk class: a blocked trade_like tool is TOOL_BLOCKED with incident", () => {
    const out = routeCall(stateWith([["spot_place_order", "blocked", "trade_like"]]), "spot_place_order");
    expect(out).toEqual({
      kind: "deny",
      code: "TOOL_BLOCKED",
      incident: true,
      riskClass: "trade_like",
    });
  });

  it("denies an unknown tool with UNKNOWN_TOOL and no riskClass", () => {
    const out = routeCall(stateWith([]), "no_such_tool");
    expect(out).toEqual({ kind: "deny", code: "UNKNOWN_TOOL", incident: false });
  });
});
