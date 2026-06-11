import {
  NormalizedToolDefinition,
  canonicalJson,
  type ProviderType,
  type RawUpstreamTool,
} from "@traceguard/schemas";
import { classifyRisk } from "./classify.js";

export interface ProviderIdentity {
  providerConnectionId: string;
  providerType: ProviderType;
}

export function computeSchemaHash(
  inputSchema: unknown,
  deps: { hash: (input: string) => string },
): string {
  return deps.hash(canonicalJson(inputSchema ?? {}));
}

export function normalizeToolDefinition(
  raw: RawUpstreamTool,
  identity: ProviderIdentity,
  deps: { hash: (input: string) => string },
): NormalizedToolDefinition {
  const riskClass = classifyRisk(raw, identity.providerType);
  const fingerprint = {
    providerType: identity.providerType,
    providerConnectionId: identity.providerConnectionId,
    name: raw.name,
    title: raw.title,
    description: raw.description,
    inputSchema: raw.inputSchema,
    outputSchema: raw.outputSchema,
    annotations: raw.annotations,
    riskClass,
  };
  const normalizedJson = canonicalJson(fingerprint);
  const schemaHash = computeSchemaHash(raw.inputSchema, deps);
  return NormalizedToolDefinition.parse({
    providerConnectionId: identity.providerConnectionId,
    providerType: identity.providerType,
    name: raw.name,
    title: raw.title,
    description: raw.description,
    inputSchema: raw.inputSchema,
    outputSchema: raw.outputSchema,
    annotations: raw.annotations,
    normalizedJson,
    schemaHash,
    riskClass,
  });
}
