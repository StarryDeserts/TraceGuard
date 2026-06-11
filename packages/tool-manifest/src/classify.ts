import type { ProviderType, RawUpstreamTool, RiskClass } from "@traceguard/schemas";
import { lookupBaseClass } from "./risk-table.js";

export const SEVERITY = [
  "public_read",
  "account_read",
  "trade_like",
  "asset_movement",
  "administrative",
] as const;
export type Severity = (typeof SEVERITY)[number];

export function joinRisk(a: Severity, b: Severity): Severity {
  return SEVERITY.indexOf(b) > SEVERITY.indexOf(a) ? b : a;
}

const SENSITIVE_SCHEMA_FIELDS: Record<string, Severity> = {
  address: "asset_movement",
  withdrawAddress: "asset_movement",
  chain: "asset_movement",
  apiKeyPassphrase: "administrative",
  apiKeyPermissions: "administrative",
  apiKeyIp: "administrative",
};

function schemaPropertyNames(schema: unknown, acc: Set<string>): Set<string> {
  if (schema === null || typeof schema !== "object") return acc;
  const obj = schema as Record<string, unknown>;
  const properties = obj.properties;
  if (properties !== null && typeof properties === "object") {
    for (const key of Object.keys(properties as Record<string, unknown>)) {
      acc.add(key);
      schemaPropertyNames((properties as Record<string, unknown>)[key], acc);
    }
  }
  for (const branch of ["items", "allOf", "anyOf", "oneOf"]) {
    const value = obj[branch];
    if (Array.isArray(value)) {
      for (const sub of value) schemaPropertyNames(sub, acc);
    } else if (value !== undefined) {
      schemaPropertyNames(value, acc);
    }
  }
  return acc;
}

function schemaFieldRule(raw: RawUpstreamTool): Severity | undefined {
  const names = schemaPropertyNames(raw.inputSchema, new Set<string>());
  let result: Severity | undefined;
  for (const name of names) {
    const sev = SENSITIVE_SCHEMA_FIELDS[name];
    if (sev !== undefined) result = result === undefined ? sev : joinRisk(result, sev);
  }
  return result;
}

function writeAnnotationRule(raw: RawUpstreamTool): Severity | undefined {
  const annotations = raw.annotations;
  if (annotations === undefined) return undefined;
  if (annotations.destructiveHint === true || annotations.readOnlyHint === false) {
    return "trade_like";
  }
  return undefined;
}

function dangerTagRule(raw: RawUpstreamTool): Severity | undefined {
  const haystack = `${raw.title ?? ""} ${raw.description ?? ""}`;
  if (haystack.includes("[DANGER]")) return "asset_movement";
  if (haystack.includes("[CAUTION]")) return "trade_like";
  return undefined;
}

const RAISE_RULES: Array<(raw: RawUpstreamTool) => Severity | undefined> = [
  schemaFieldRule,
  writeAnnotationRule,
  dangerTagRule,
];

export function classifyRisk(raw: RawUpstreamTool, providerType: ProviderType): RiskClass {
  const base = lookupBaseClass(providerType, raw.name);
  if (base === undefined) return "unknown";
  let result: Severity = base;
  for (const rule of RAISE_RULES) {
    const raised = rule(raw);
    if (raised !== undefined) result = joinRisk(result, raised);
  }
  return result;
}
