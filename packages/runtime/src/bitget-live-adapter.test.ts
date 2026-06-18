import { describe, it, expect } from "vitest";
import { buildSpotOrderArgs, parseOrderId } from "./bitget-live-adapter.js";
import type { DecisionProposedPayload } from "@traceguard/schemas";

function decision(over: Partial<DecisionProposedPayload> = {}): DecisionProposedPayload {
  return {
    decisionId: "dec_1",
    runId: "run_1",
    envelopeVersion: 1,
    instrument: "BTCUSDT",
    marketType: "spot",
    action: "buy",
    thesis: "t",
    evidenceRefs: [],
    decisionHash: "h".repeat(64),
    ...over,
  };
}

describe("buildSpotOrderArgs", () => {
  it("maps a buy market order: instrument->symbol, side buy, market, size from quantity", () => {
    expect(buildSpotOrderArgs(decision({ action: "buy", requestedQuantity: "0.5" }))).toEqual({
      symbol: "BTCUSDT",
      side: "buy",
      orderType: "market",
      size: "0.5",
    });
  });

  it("maps open_long to side buy", () => {
    expect(buildSpotOrderArgs(decision({ action: "open_long", requestedQuantity: "1" })).side).toBe("buy");
  });

  it("maps sell-family actions (sell/open_short/reduce/close) to side sell", () => {
    for (const action of ["sell", "open_short", "reduce", "close"] as const) {
      expect(buildSpotOrderArgs(decision({ action, requestedQuantity: "1" })).side).toBe("sell");
    }
  });

  it("falls back to requestedNotionalUsdt when quantity is absent", () => {
    expect(buildSpotOrderArgs(decision({ requestedNotionalUsdt: "100" })).size).toBe("100");
  });

  it("prefers requestedQuantity over requestedNotionalUsdt", () => {
    const args = buildSpotOrderArgs(decision({ requestedQuantity: "0.5", requestedNotionalUsdt: "100" }));
    expect(args.size).toBe("0.5");
  });

  it("includes price only for limit orders", () => {
    const limit = buildSpotOrderArgs(decision({ orderType: "limit", limitPrice: "65000", requestedQuantity: "0.5" }));
    expect(limit).toEqual({ symbol: "BTCUSDT", side: "buy", orderType: "limit", size: "0.5", price: "65000" });
    const market = buildSpotOrderArgs(decision({ requestedQuantity: "0.5" }));
    expect(market.price).toBeUndefined();
  });

  it("throws on an unmappable action", () => {
    expect(() => buildSpotOrderArgs(decision({ action: "hold", requestedQuantity: "1" }))).toThrow("unmappable_action:hold");
  });

  it("throws when no order size is present", () => {
    expect(() => buildSpotOrderArgs(decision({}))).toThrow("missing_order_size");
  });
});

describe("parseOrderId", () => {
  it("extracts orderId / order_id / orderID string variants", () => {
    expect(parseOrderId({ structuredContent: { orderId: "OID-1" } })).toBe("OID-1");
    expect(parseOrderId({ structuredContent: { order_id: "OID-2" } })).toBe("OID-2");
    expect(parseOrderId({ structuredContent: { orderID: "OID-3" } })).toBe("OID-3");
  });

  it("coerces a numeric order id to string", () => {
    expect(parseOrderId({ structuredContent: { orderId: 12345 } })).toBe("12345");
  });

  it("returns undefined when no order id is present", () => {
    expect(parseOrderId({ structuredContent: {} })).toBeUndefined();
    expect(parseOrderId({})).toBeUndefined();
  });
});
