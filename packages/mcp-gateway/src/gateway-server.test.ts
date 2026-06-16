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
): Promise<Client> {
  const server = createGatewayServer(state, callCtx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
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
