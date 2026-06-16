import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { GatewayState } from "./gateway-state.js";
import { handleToolCall, type GatewayCallContext } from "./call-handler.js";

export type { GatewayCallContext } from "./call-handler.js";

export function createGatewayServer(
  state: GatewayState,
  callCtx?: GatewayCallContext,
): Server {
  const server = new Server(
    { name: "traceguard-gateway", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: state.servedTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    handleToolCall(state, callCtx, req.params.name, req.params.arguments ?? {}),
  );

  return server;
}
