import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { GatewayState } from "./gateway-state.js";
import { handleToolCall, type GatewayCallContext } from "./call-handler.js";
import { dispatchInternalTool, type InternalToolContext } from "./internal-tool-handlers.js";
import { INTERNAL_TOOL_DEFS, INTERNAL_TOOL_NAMES } from "./internal-tools.js";

export type { GatewayCallContext } from "./call-handler.js";

export function createGatewayServer(
  state: GatewayState,
  callCtx?: GatewayCallContext,
  internalCtx?: InternalToolContext,
): Server {
  const server = new Server(
    { name: "traceguard-gateway", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      ...(internalCtx !== undefined
        ? INTERNAL_TOOL_DEFS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          }))
        : []),
      ...state.servedTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments ?? {};
    if (internalCtx !== undefined && INTERNAL_TOOL_NAMES.has(name)) {
      return dispatchInternalTool(internalCtx, state, name, args);
    }
    return handleToolCall(state, callCtx, name, args);
  });

  return server;
}
