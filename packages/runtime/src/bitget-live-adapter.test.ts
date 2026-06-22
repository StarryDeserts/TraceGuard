import { describe, it, expect } from "vitest";
import { buildSpotOrderArgs, parseOrderId, createBitgetLiveAdapter } from "./bitget-live-adapter.js";
import type { UpstreamCaller, UpstreamCallResult } from "./bitget-live-adapter.js";
import type { DecisionProposedPayload, LedgerEvent } from "@traceguard/schemas";
import type { ExecutionRequest } from "@traceguard/domain";
import type { LedgerStore } from "@traceguard/event-ledger";

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

  it("treats an empty-string order id as no receipt (fail-safe, never fabricates)", () => {
    expect(parseOrderId({ structuredContent: { orderId: "" } })).toBeUndefined();
    expect(parseOrderId({ structuredContent: { order_id: "" } })).toBeUndefined();
    expect(parseOrderId({ structuredContent: { orderID: "" } })).toBeUndefined();
  });
});

function decisionEvent(decisionId: string, runId: string, payload: DecisionProposedPayload): LedgerEvent {
  return { eventType: "DecisionProposed", aggregateId: decisionId, runId, payload } as unknown as LedgerEvent;
}

function fakeStore(events: LedgerEvent[]): LedgerStore {
  return {
    async read() {
      return events;
    },
    async head() {
      return null;
    },
    async append() {},
  };
}

function caller(impl: (name: string, args: Record<string, unknown>) => UpstreamCallResult | Promise<UpstreamCallResult>): UpstreamCaller {
  return {
    async callTool(name, args) {
      return impl(name, args);
    },
  };
}

function request(over: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    executionId: "exec_1",
    runId: "run_1",
    decisionId: "dec_1",
    authorizationId: "authz_1",
    actionDigest: "d".repeat(64),
    idempotencyKey: "idem_1",
    requestRef: "ref_1",
    requestHash: "rh_1",
    ...over,
  };
}

const hash = (s: string): string => `H:${s}`;

function adapterDeps(events: LedgerEvent[], client: UpstreamCaller, timeoutMs?: number) {
  return { store: fakeStore(events), client, workspaceId: "ws_1", hash, ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
}

describe("createBitgetLiveAdapter", () => {
  const seeded = (over: Partial<DecisionProposedPayload> = {}) => [
    decisionEvent("dec_1", "run_1", {
      decisionId: "dec_1",
      runId: "run_1",
      envelopeVersion: 1,
      instrument: "BTCUSDT",
      marketType: "spot",
      action: "buy",
      thesis: "t",
      evidenceRefs: [],
      decisionHash: "h".repeat(64),
      requestedQuantity: "0.5",
      ...over,
    }),
  ];

  it("submits the mapped spot order and returns a completed submitted receipt", async () => {
    let captured: { name: string; args: Record<string, unknown> } | undefined;
    const client = caller((name, args) => {
      captured = { name, args };
      return { structuredContent: { orderId: "OID-9" } };
    });
    const adapter = createBitgetLiveAdapter(adapterDeps(seeded(), client));

    const result = await adapter.call(request());

    expect(captured).toEqual({
      name: "spot_place_order",
      args: { symbol: "BTCUSDT", side: "buy", orderType: "market", size: "0.5" },
    });
    expect(result).toEqual({
      kind: "completed",
      finalStatus: "submitted",
      receiptRef: "receipt:bitget:OID-9",
      receiptHash: "H:receipt:bitget:OID-9:rh_1",
      upstreamRef: "OID-9",
    });
  });

  it("throws when the DecisionProposed intent cannot be found (pre-submit, fail closed)", async () => {
    const adapter = createBitgetLiveAdapter(adapterDeps([], caller(() => ({ structuredContent: { orderId: "x" } }))));
    await expect(adapter.call(request())).rejects.toThrow("decision_intent_not_found");
  });

  it("names the runId and decisionId in the decision_intent_not_found throw", async () => {
    const adapter = createBitgetLiveAdapter(adapterDeps([], caller(() => ({ structuredContent: { orderId: "x" } }))));
    await expect(adapter.call(request({ runId: "run_X", decisionId: "dec_Y" }))).rejects.toThrow(
      /decision_intent_not_found.*run_X.*dec_Y/,
    );
  });

  it("throws when the upstream returns an error result (pre-submit reject)", async () => {
    const adapter = createBitgetLiveAdapter(adapterDeps(seeded(), caller(() => ({ isError: true }))));
    await expect(adapter.call(request())).rejects.toThrow("upstream_rejected");
  });

  it("returns unknown/receipt_lookup_failed when no order id comes back", async () => {
    const adapter = createBitgetLiveAdapter(adapterDeps(seeded(), caller(() => ({ structuredContent: {} }))));
    expect(await adapter.call(request())).toEqual({ kind: "unknown", reasonCode: "receipt_lookup_failed" });
  });

  it("returns unknown/timeout_after_submit when the upstream call exceeds the timeout", async () => {
    const adapter = createBitgetLiveAdapter(
      adapterDeps(seeded(), caller(() => new Promise<UpstreamCallResult>(() => {})), 5),
    );
    expect(await adapter.call(request())).toEqual({ kind: "unknown", reasonCode: "timeout_after_submit" });
  });

  it("returns unknown/connection_lost_after_submit when the upstream call rejects", async () => {
    const adapter = createBitgetLiveAdapter(
      adapterDeps(seeded(), caller(() => Promise.reject(new Error("socket hang up")))),
    );
    expect(await adapter.call(request())).toEqual({ kind: "unknown", reasonCode: "connection_lost_after_submit" });
  });

  it("classifies a pre-connection throw conservatively as connection_lost_after_submit", async () => {
    // The MCP client can throw synchronously *before* the request reaches the
    // wire (e.g. "called before connection is open"). We deliberately do not
    // distinguish that from a genuine post-submit loss: failing toward
    // reconciliation can never fail open on an order that may already be live.
    const preConnectionClient: UpstreamCaller = {
      callTool() {
        throw new Error("called before connection is open");
      },
    };
    const adapter = createBitgetLiveAdapter(adapterDeps(seeded(), preConnectionClient));
    expect(await adapter.call(request())).toEqual({ kind: "unknown", reasonCode: "connection_lost_after_submit" });
  });

  it("selects the decision matching request.decisionId when the ledger holds several", async () => {
    // A non-matching decision is seeded FIRST, so a naive "take the first
    // DecisionProposed" lookup would submit the wrong order and fail this test.
    const events = [
      decisionEvent("dec_other", "run_1", {
        decisionId: "dec_other",
        runId: "run_1",
        envelopeVersion: 1,
        instrument: "ETHUSDT",
        marketType: "spot",
        action: "sell",
        thesis: "t",
        evidenceRefs: [],
        decisionHash: "h".repeat(64),
        requestedQuantity: "2",
      }),
      ...seeded(),
    ];
    let captured: { name: string; args: Record<string, unknown> } | undefined;
    const client = caller((name, args) => {
      captured = { name, args };
      return { structuredContent: { orderId: "OID-7" } };
    });
    const adapter = createBitgetLiveAdapter(adapterDeps(events, client));

    await adapter.call(request({ decisionId: "dec_1" }));

    expect(captured?.args.symbol).toBe("BTCUSDT");
    expect(captured?.args.side).toBe("buy");
  });
});
