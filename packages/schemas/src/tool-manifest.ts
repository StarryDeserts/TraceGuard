import { z } from "zod";

export const RiskClass = z.enum([
  "public_read",
  "account_read",
  "trade_like",
  "asset_movement",
  "administrative",
  "unknown",
]);
export type RiskClass = z.infer<typeof RiskClass>;

export const ProviderType = z.enum(["bitget_agent_hub", "custom_mcp", "generic_rest"]);
export type ProviderType = z.infer<typeof ProviderType>;

export interface RawUpstreamTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

export const NormalizedToolDefinition = z
  .object({
    providerConnectionId: z.string().min(1),
    providerType: ProviderType,
    name: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    inputSchema: z.unknown(),
    outputSchema: z.unknown().optional(),
    annotations: z.record(z.unknown()).optional(),
    normalizedJson: z.string().min(1),
    schemaHash: z.string().min(1),
    riskClass: RiskClass,
  })
  .strict();
export type NormalizedToolDefinition = z.infer<typeof NormalizedToolDefinition>;
