import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { GatewayState } from "./gateway-state.js";

export const GATEWAY_SERVER_INFO = { name: "traceguard-gateway", version: "0.2.0" } as const;

export interface ToolCallDenial {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  traceguard: { errorCode: "TOOL_CALL_NOT_AVAILABLE"; toolName: string };
}

export function denyToolCall(toolName: string): CallToolResult {
  const denial: ToolCallDenial = {
    isError: true,
    content: [
      {
        type: "text",
        text: "Tool execution is not enabled in this gateway build. Governed execution arrives in a later TraceGuard milestone.",
      },
    ],
    traceguard: { errorCode: "TOOL_CALL_NOT_AVAILABLE", toolName },
  };
  // The SDK request-handler return type is the loose `ServerResult` union; the bespoke
  // `traceguard` field is not in `CallToolResult`'s static type but survives at runtime
  // (CallToolResultSchema extends a z.looseObject, so the client-side parse keeps it).
  return denial as unknown as CallToolResult;
}

export function createGatewayServer(state: GatewayState): Server {
  const server = new Server(GATEWAY_SERVER_INFO, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: state.servedTools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => denyToolCall(req.params.name));
  return server;
}
