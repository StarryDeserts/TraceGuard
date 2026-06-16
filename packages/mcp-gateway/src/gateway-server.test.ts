import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  InMemoryLedgerStore,
  sha256hex,
} from "@traceguard/event-ledger";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fixedClock, sequentialIdGen } from "@traceguard/testing-fixtures";
import type { GatewayState, RouteEntry } from "./gateway-state.js";
import type { UpstreamManifestClient } from "./upstream-client.js";
import { recordRunCreated, type CallAudit } from "./tool-call-events.js";
import { createGatewayServer, type GatewayCallContext } from "./gateway-server.js";
import { createSimulatorAdapter } from "@traceguard/runtime";
import { DEFAULT_POLICY } from "./default-policy.js";
import { createDecisionCache } from "./decision-cache.js";
import type { InternalToolContext } from "./internal-tool-context.js";

const AUDIT: CallAudit = {
  workspaceId: "ws_demo",
  runId: "run_1",
  providerConnectionId: "pc_bitget",
};

class FakeUpstreamClient implements UpstreamManifestClient {
  async open(): Promise<void> {}
  async listTools(): Promise<never> {
    throw new Error("listTools not used here");
  }
  async close(): Promise<void> {}
  async callTool(): Promise<CallToolResult> {
    return { content: [{ type: "text", text: "upstream-ok" }] } as unknown as CallToolResult;
  }
}

function deps() {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

function fixtureState(): GatewayState {
  const route = new Map<string, RouteEntry>([
    ["spot_get_ticker", { status: "active", riskClass: "public_read" }],
    ["spot_place_order", { status: "active", riskClass: "trade_like" }],
  ]);
  return {
    servedTools: [
      { name: "spot_get_ticker", description: "ticker", inputSchema: { type: "object" } },
    ],
    route,
    manifestHash: "f".repeat(64),
    toolCount: 2,
    degraded: false,
  };
}

async function makeCtx(d: ReturnType<typeof deps>): Promise<GatewayCallContext> {
  const store = new InMemoryLedgerStore();
  const run = recordRunCreated(AUDIT, d, null);
  await store.append(null, [run]);
  return { client: new FakeUpstreamClient(), store, deps: d, audit: AUDIT };
}

async function connectedClient(
  state: GatewayState,
  callCtx?: GatewayCallContext,
  internalCtx?: InternalToolContext,
): Promise<Client> {
  const server = createGatewayServer(state, callCtx, internalCtx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

async function makeInternalCtx(
  d: ReturnType<typeof deps>,
): Promise<{ callCtx: GatewayCallContext; internalCtx: InternalToolContext }> {
  const store = new InMemoryLedgerStore();
  const run = recordRunCreated(AUDIT, d, null);
  await store.append(null, [run]);
  const callCtx: GatewayCallContext = { client: new FakeUpstreamClient(), store, deps: d, audit: AUDIT };
  const internalCtx: InternalToolContext = {
    store,
    deps: d,
    audit: AUDIT,
    policy: DEFAULT_POLICY,
    adapter: createSimulatorAdapter({ hash: sha256hex }),
    run: { runId: AUDIT.runId, mode: "safe_demo" },
    cache: createDecisionCache(),
    ttls: { approvalSeconds: 900, authorizationSeconds: 900 },
  };
  return { callCtx, internalCtx };
}

function tgStatus(res: unknown): Record<string, unknown> {
  return ((res as { traceguard?: Record<string, unknown> }).traceguard ?? {}) as Record<string, unknown>;
}

function tg(res: unknown): { errorCode: string; toolName: string } {
  return (res as { traceguard: { errorCode: string; toolName: string } }).traceguard;
}

describe("createGatewayServer governed tools/call", () => {
  it("lists only served tools", async () => {
    const client = await connectedClient(fixtureState(), await makeCtx(deps()));
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).toEqual(["spot_get_ticker"]);
    await client.close();
  });

  it("forwards a public_read call to the upstream", async () => {
    const client = await connectedClient(fixtureState(), await makeCtx(deps()));
    const res = await client.callTool({ name: "spot_get_ticker", arguments: { symbol: "BTCUSDT" } });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    await client.close();
  });

  it("denies a trade_like call with DECISION_ENVELOPE_REQUIRED", async () => {
    const client = await connectedClient(fixtureState(), await makeCtx(deps()));
    const res = await client.callTool({ name: "spot_place_order", arguments: {} });
    expect(tg(res).errorCode).toBe("DECISION_ENVELOPE_REQUIRED");
    await client.close();
  });

  it("returns TOOL_CALL_NOT_AVAILABLE when no call context is wired", async () => {
    const client = await connectedClient(fixtureState(), undefined);
    const res = await client.callTool({ name: "spot_get_ticker", arguments: {} });
    expect(tg(res).errorCode).toBe("TOOL_CALL_NOT_AVAILABLE");
    await client.close();
  });
});

describe("createGatewayServer internal traceguard_* tools", () => {
  it("lists the six internal tools first, then the governed read tools", async () => {
    const { callCtx, internalCtx } = await makeInternalCtx(deps());
    const client = await connectedClient(fixtureState(), callCtx, internalCtx);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.slice(0, 6)).toEqual([
      "traceguard_start_run",
      "traceguard_record_decision",
      "traceguard_request_execution",
      "traceguard_check_approval",
      "traceguard_execute_authorized_action",
      "traceguard_finish_run",
    ]);
    expect(names).toContain("spot_get_ticker");
    expect(names).not.toContain("spot_place_order"); // blocked/non-served, unchanged from 3D
    await client.close();
  });

  it("drives start_run -> record_decision -> request_execution to ALLOWED through the SDK", async () => {
    const { callCtx, internalCtx } = await makeInternalCtx(deps());
    const client = await connectedClient(fixtureState(), callCtx, internalCtx);

    await client.callTool({ name: "traceguard_start_run", arguments: { runId: "run_1", agentName: "a", intent: "i" } });
    const rec = await client.callTool({
      name: "traceguard_record_decision",
      arguments: {
        runId: "run_1",
        instrument: "BTCUSDT",
        marketType: "futures",
        action: "open_long",
        thesis: "t",
        evidenceRefs: ["ev:1"],
        requestedNotionalUsdt: "100",
        requestedLeverage: "2",
      },
    });
    const decisionId = tgStatus(rec).decisionId as string;

    const exec = await client.callTool({
      name: "traceguard_request_execution",
      arguments: { runId: "run_1", decisionId, executionAdapter: "simulator" },
    });
    expect(tgStatus(exec).status).toBe("ALLOWED");
    expect(typeof tgStatus(exec).executionId).toBe("string");
    await client.close();
  });

  it("returns POLICY_BLOCKED for a high-leverage decision through the SDK", async () => {
    const { callCtx, internalCtx } = await makeInternalCtx(deps());
    const client = await connectedClient(fixtureState(), callCtx, internalCtx);

    await client.callTool({ name: "traceguard_start_run", arguments: { runId: "run_1" } });
    const rec = await client.callTool({
      name: "traceguard_record_decision",
      arguments: {
        runId: "run_1",
        instrument: "BTCUSDT",
        marketType: "futures",
        action: "open_long",
        thesis: "t",
        evidenceRefs: ["ev:1"],
        requestedNotionalUsdt: "100",
        requestedLeverage: "10",
      },
    });
    const decisionId = tgStatus(rec).decisionId as string;
    const exec = await client.callTool({
      name: "traceguard_request_execution",
      arguments: { runId: "run_1", decisionId, executionAdapter: "simulator" },
    });
    expect((exec as { isError?: boolean }).isError).toBe(true);
    expect(tgStatus(exec).errorCode).toBe("POLICY_BLOCKED");
    await client.close();
  });

  it("omits internal tools and short-circuits when no context is wired (degraded)", async () => {
    const client = await connectedClient(fixtureState(), undefined, undefined);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.some((n) => n.startsWith("traceguard_"))).toBe(false);
    const res = await client.callTool({ name: "traceguard_start_run", arguments: { runId: "run_1" } });
    expect((res as unknown as { traceguard: { errorCode: string } }).traceguard.errorCode).toBe("TOOL_CALL_NOT_AVAILABLE");
    await client.close();
  });
});
