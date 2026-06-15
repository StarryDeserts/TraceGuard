import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGatewayServer } from "./gateway-server.js";
import type { GatewayState } from "./gateway-state.js";

function fixtureState(): GatewayState {
  return {
    servedTools: [{ name: "spot_get_ticker", inputSchema: { type: "object", properties: {} } }],
    manifestHash: "h",
    toolCount: 1,
    degraded: false,
  };
}

async function connectedClient(state: GatewayState): Promise<Client> {
  const server = createGatewayServer(state);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await client.connect(clientT);
  return client;
}

describe("createGatewayServer", () => {
  it("serves the governed tool list over tools/list", async () => {
    const client = await connectedClient(fixtureState());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["spot_get_ticker"]);
  });

  it("fail-closed: every tools/call returns TOOL_CALL_NOT_AVAILABLE", async () => {
    const client = await connectedClient(fixtureState());
    const res = await client.callTool({ name: "spot_get_ticker", arguments: {} });
    expect(res.isError).toBe(true);
    expect((res as { traceguard?: { errorCode?: string } }).traceguard?.errorCode).toBe(
      "TOOL_CALL_NOT_AVAILABLE",
    );
  });

  it("fail-closed even for an unknown tool name", async () => {
    const client = await connectedClient(fixtureState());
    const res = await client.callTool({ name: "definitely_not_a_tool", arguments: {} });
    expect(res.isError).toBe(true);
    expect((res as { traceguard?: { toolName?: string } }).traceguard?.toolName).toBe(
      "definitely_not_a_tool",
    );
  });
});
