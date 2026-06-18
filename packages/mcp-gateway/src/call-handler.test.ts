import { describe, it, expect } from "vitest";
import { InMemoryLedgerStore, sha256hex, canonicalJson } from "@traceguard/event-ledger";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { LedgerEvent, RiskClass } from "@traceguard/schemas";
import type { ToolStatus } from "@traceguard/event-ledger";
import { fixedClock, sequentialIdGen } from "@traceguard/testing-fixtures";
import type { GatewayState } from "./gateway-state.js";
import type { UpstreamManifestClient } from "./upstream-client.js";
import { recordRunCreated, type CallAudit } from "./tool-call-events.js";
import { handleToolCall, type GatewayCallContext } from "./call-handler.js";
import type { ArgValidator } from "./arg-validation.js";

const AUDIT: CallAudit = {
  workspaceId: "ws_demo",
  runId: "run_1",
  providerConnectionId: "pc_bitget",
};

type Script = { kind: "result"; result: CallToolResult } | { kind: "throw" };

class FakeUpstreamClient implements UpstreamManifestClient {
  callToolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  constructor(private readonly script: Script) {}
  async open(): Promise<void> {}
  async listTools(): Promise<never> {
    throw new Error("listTools not used here");
  }
  async close(): Promise<void> {}
  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    this.callToolCalls.push({ name, args });
    if (this.script.kind === "throw") throw new Error("upstream exploded");
    return this.script.result;
  }
}

function deps() {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

function stateWith(rows: Array<[string, ToolStatus, RiskClass]>): GatewayState {
  return {
    servedTools: [],
    route: new Map(rows.map(([name, status, riskClass]) => [name, { status, riskClass }])),
    manifestHash: null,
    toolCount: rows.length,
    degraded: false,
  };
}

async function seededCtx(
  client: UpstreamManifestClient,
  d: ReturnType<typeof deps>,
  argValidator: ArgValidator = { validate: () => ({ ok: true }) },
): Promise<{ ctx: GatewayCallContext; store: InMemoryLedgerStore }> {
  const store = new InMemoryLedgerStore();
  const run = recordRunCreated(AUDIT, d, null);
  await store.append(null, [run]);
  return { ctx: { client, store, deps: d, audit: AUDIT, argValidator }, store };
}

function types(events: ReadonlyArray<LedgerEvent<unknown>>): string[] {
  return events.map((e) => e.eventType);
}

function tg(res: CallToolResult): { errorCode: string; toolName: string } {
  return (res as unknown as { traceguard: { errorCode: string; toolName: string } }).traceguard;
}

describe("handleToolCall", () => {
  it("forwards a public_read call and records Requested + Completed", async () => {
    const d = deps();
    const result = { content: [{ type: "text", text: "ok" }] } as unknown as CallToolResult;
    const client = new FakeUpstreamClient({ kind: "result", result });
    const { ctx, store } = await seededCtx(client, d);
    const state = stateWith([["spot_get_ticker", "active", "public_read"]]);

    const res = await handleToolCall(state, ctx, "spot_get_ticker", { symbol: "BTCUSDT" });

    expect((res as unknown as { isError?: boolean }).isError).toBeFalsy();
    expect(client.callToolCalls).toEqual([{ name: "spot_get_ticker", args: { symbol: "BTCUSDT" } }]);
    const events = await store.read(AUDIT.workspaceId);
    expect(types(events)).toEqual(["RunCreated", "ToolCallRequested", "ToolCallCompleted"]);
  });

  it("denies a trade_like call with DECISION_ENVELOPE_REQUIRED and does not forward", async () => {
    const d = deps();
    const client = new FakeUpstreamClient({ kind: "throw" });
    const { ctx, store } = await seededCtx(client, d);
    const state = stateWith([["spot_place_order", "active", "trade_like"]]);

    const res = await handleToolCall(state, ctx, "spot_place_order", {});

    expect(tg(res).errorCode).toBe("DECISION_ENVELOPE_REQUIRED");
    expect(client.callToolCalls).toEqual([]);
    const events = await store.read(AUDIT.workspaceId);
    expect(types(events)).toEqual(["RunCreated", "ToolCallDenied"]);
  });

  it("denies a blocked call with TOOL_BLOCKED and opens an incident", async () => {
    const d = deps();
    const client = new FakeUpstreamClient({ kind: "throw" });
    const { ctx, store } = await seededCtx(client, d);
    const state = stateWith([["withdraw", "blocked", "asset_movement"]]);

    const res = await handleToolCall(state, ctx, "withdraw", {});

    expect(tg(res).errorCode).toBe("TOOL_BLOCKED");
    const events = await store.read(AUDIT.workspaceId);
    expect(types(events)).toEqual(["RunCreated", "ToolCallDenied", "IncidentOpened"]);
    expect(events[2]!.aggregateType).toBe("incident");
  });

  it("denies a frozen call with TOOL_FROZEN", async () => {
    const d = deps();
    const client = new FakeUpstreamClient({ kind: "throw" });
    const { ctx, store } = await seededCtx(client, d);
    const state = stateWith([["spot_get_ticker", "frozen", "public_read"]]);

    const res = await handleToolCall(state, ctx, "spot_get_ticker", {});

    expect(tg(res).errorCode).toBe("TOOL_FROZEN");
    const events = await store.read(AUDIT.workspaceId);
    expect(types(events)).toEqual(["RunCreated", "ToolCallDenied"]);
  });

  it("denies an unknown call with UNKNOWN_TOOL", async () => {
    const d = deps();
    const client = new FakeUpstreamClient({ kind: "throw" });
    const { ctx, store } = await seededCtx(client, d);
    const state = stateWith([]);

    const res = await handleToolCall(state, ctx, "no_such_tool", {});

    expect(tg(res).errorCode).toBe("UNKNOWN_TOOL");
    const events = await store.read(AUDIT.workspaceId);
    expect(types(events)).toEqual(["RunCreated", "ToolCallDenied"]);
  });

  it("fails closed when the upstream call throws: Requested + Failed, UPSTREAM_CALL_FAILED", async () => {
    const d = deps();
    const client = new FakeUpstreamClient({ kind: "throw" });
    const { ctx, store } = await seededCtx(client, d);
    const state = stateWith([["spot_get_ticker", "active", "public_read"]]);

    const res = await handleToolCall(state, ctx, "spot_get_ticker", {});

    expect(tg(res).errorCode).toBe("UPSTREAM_CALL_FAILED");
    const events = await store.read(AUDIT.workspaceId);
    expect(types(events)).toEqual(["RunCreated", "ToolCallRequested", "ToolCallFailed"]);
  });

  it("returns TOOL_CALL_NOT_AVAILABLE and records nothing when no call context is wired", async () => {
    const d = deps();
    const client = new FakeUpstreamClient({ kind: "throw" });
    const { store } = await seededCtx(client, d);
    const state = stateWith([["spot_get_ticker", "active", "public_read"]]);

    const res = await handleToolCall(state, undefined, "spot_get_ticker", {});

    expect(tg(res).errorCode).toBe("TOOL_CALL_NOT_AVAILABLE");
    const events = await store.read(AUDIT.workspaceId);
    expect(types(events)).toEqual(["RunCreated"]);
  });

  it("denies invalid args with ARGUMENTS_INVALID and does not forward", async () => {
    const d = deps();
    const client = new FakeUpstreamClient({ kind: "throw" });
    const failing: ArgValidator = {
      validate: () => ({ ok: false, errors: ["/symbol must be string"] }),
    };
    const { ctx, store } = await seededCtx(client, d, failing);
    const state = stateWith([["spot_get_ticker", "active", "public_read"]]);

    const res = await handleToolCall(state, ctx, "spot_get_ticker", { symbol: 123 });

    expect(tg(res).errorCode).toBe("ARGUMENTS_INVALID");
    expect(client.callToolCalls).toEqual([]);
    const events = await store.read(AUDIT.workspaceId);
    expect(types(events)).toEqual(["RunCreated", "ToolCallDenied"]);
  });

  it("redacts credential keys from the forwarded result", async () => {
    const d = deps();
    const result = {
      content: [{ type: "text", text: "ok" }],
      structuredContent: { apiKey: "live-secret", balance: "100" },
    } as unknown as CallToolResult;
    const client = new FakeUpstreamClient({ kind: "result", result });
    const { ctx } = await seededCtx(client, d);
    const state = stateWith([["spot_get_ticker", "active", "public_read"]]);

    const res = await handleToolCall(state, ctx, "spot_get_ticker", { symbol: "BTCUSDT" });

    const sc = (res as unknown as { structuredContent: { apiKey: string; balance: string } })
      .structuredContent;
    expect(sc.apiKey).toBe("[REDACTED]");
    expect(sc.balance).toBe("100");
  });

  it("records the ToolCallCompleted digest over the raw (unredacted) result", async () => {
    const d = deps();
    const result = {
      content: [{ type: "text", text: "ok" }],
      structuredContent: { apiKey: "live-secret" },
    } as unknown as CallToolResult;
    const client = new FakeUpstreamClient({ kind: "result", result });
    const { ctx, store } = await seededCtx(client, d);
    const state = stateWith([["spot_get_ticker", "active", "public_read"]]);

    await handleToolCall(state, ctx, "spot_get_ticker", { symbol: "BTCUSDT" });

    const events = await store.read(AUDIT.workspaceId);
    const completed = events.find((e) => e.eventType === "ToolCallCompleted") as
      | LedgerEvent<{ resultDigest: string }>
      | undefined;
    expect(completed).toBeDefined();
    expect(completed!.payload.resultDigest).toBe(sha256hex(canonicalJson(result)));
  });
});
