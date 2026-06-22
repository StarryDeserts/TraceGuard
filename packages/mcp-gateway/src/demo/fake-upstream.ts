import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { RawUpstreamTool } from "@traceguard/schemas";
import type { UpstreamManifestClient } from "../upstream-client.js";

const FAKE_TOOLS: readonly RawUpstreamTool[] = [
  {
    name: "spot_place_order",
    description: "Place a spot order on the venue.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        side: { type: "string", enum: ["buy", "sell"] },
        orderType: { type: "string", enum: ["market", "limit"] },
        size: { type: "string" },
        price: { type: "string" },
      },
      required: ["symbol", "side", "orderType", "size"],
    },
  },
  {
    name: "withdraw",
    description: "Withdraw assets to an external wallet.",
    inputSchema: {
      type: "object",
      properties: {
        coin: { type: "string" },
        amount: { type: "string" },
      },
      required: ["coin", "amount"],
    },
  },
  {
    name: "mystery_capability",
    description: "Undocumented upstream capability.",
    inputSchema: {
      type: "object",
      properties: { payload: { type: "string" } },
    },
  },
];

export function createFakeUpstream(): UpstreamManifestClient {
  return {
    async open(): Promise<void> {
      /* no-op: nothing to spawn */
    },
    async listTools(): Promise<RawUpstreamTool[]> {
      return FAKE_TOOLS.map((t) => ({ ...t }));
    },
    async callTool(_name: string, _args: Record<string, unknown>): Promise<CallToolResult> {
      return {
        content: [{ type: "text", text: "paper order placed" }],
        structuredContent: { orderId: "PAPER-OID-1" },
      } as unknown as CallToolResult;
    },
    async close(): Promise<void> {
      /* no-op */
    },
  };
}
