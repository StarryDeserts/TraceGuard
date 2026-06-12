import type { LedgerEvent, RiskClass } from "@traceguard/schemas";

export type ToolStatus = "active" | "blocked" | "frozen";

export interface ToolInventoryEntry {
  name: string;
  riskClass: RiskClass;
  schemaHash: string;
  status: ToolStatus;
  visible: boolean;
  freezeReason?: string;
}

export interface ToolInventoryView {
  providerConnectionId?: string;
  manifestHash?: string;
  approvedManifestHash?: string;
  normalizationVersion?: number;
  tools: ToolInventoryEntry[];
}

interface RawEntry {
  name: string;
  riskClass: RiskClass;
  schemaHash: string;
}

interface RawChanged {
  name: string;
  schemaHash?: string;
  riskClass?: RiskClass;
}

function asRecord(payload: unknown): Record<string, unknown> | undefined {
  return payload !== null && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : undefined;
}

function asString(payload: unknown, key: string): string | undefined {
  const value = asRecord(payload)?.[key];
  return typeof value === "string" ? value : undefined;
}

function asNumber(payload: unknown, key: string): number | undefined {
  const value = asRecord(payload)?.[key];
  return typeof value === "number" ? value : undefined;
}

function readToolEntries(payload: unknown, key: string): RawEntry[] {
  const value = asRecord(payload)?.[key];
  if (!Array.isArray(value)) return [];
  const out: RawEntry[] = [];
  for (const item of value) {
    const name = asString(item, "name");
    const riskClass = asString(item, "riskClass");
    const schemaHash = asString(item, "schemaHash");
    if (name !== undefined && riskClass !== undefined && schemaHash !== undefined) {
      out.push({ name, riskClass: riskClass as RiskClass, schemaHash });
    }
  }
  return out;
}

function readStringArray(payload: unknown, key: string): string[] {
  const value = asRecord(payload)?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

function readChangedEntries(payload: unknown, key: string): RawChanged[] {
  const value = asRecord(payload)?.[key];
  if (!Array.isArray(value)) return [];
  const out: RawChanged[] = [];
  for (const item of value) {
    const name = asString(item, "name");
    if (name === undefined) continue;
    const riskClass = asString(item, "riskClass");
    out.push({
      name,
      schemaHash: asString(item, "schemaHash"),
      riskClass: riskClass as RiskClass | undefined,
    });
  }
  return out;
}

function classDefault(riskClass: RiskClass): ToolStatus {
  if (riskClass === "asset_movement" || riskClass === "administrative") return "blocked";
  if (riskClass === "unknown") return "frozen";
  return "active";
}

function toEntry(name: string, riskClass: RiskClass, schemaHash: string): ToolInventoryEntry {
  const status = classDefault(riskClass);
  return { name, riskClass, schemaHash, status, visible: status === "active" };
}

export function toolManifestProjection(events: LedgerEvent[]): ToolInventoryView {
  const tools = new Map<string, ToolInventoryEntry>();
  const view: ToolInventoryView = { tools: [] };

  for (const e of events) {
    switch (e.eventType) {
      case "ToolManifestImported": {
        tools.clear();
        view.providerConnectionId =
          asString(e.payload, "providerConnectionId") ?? view.providerConnectionId;
        view.manifestHash = asString(e.payload, "manifestHash") ?? view.manifestHash;
        view.normalizationVersion =
          asNumber(e.payload, "normalizationVersion") ?? view.normalizationVersion;
        for (const t of readToolEntries(e.payload, "tools")) {
          tools.set(t.name, toEntry(t.name, t.riskClass, t.schemaHash));
        }
        break;
      }
      case "ToolBlocked": {
        const name = asString(e.payload, "toolName");
        if (name === undefined) break;
        const entry = tools.get(name);
        if (entry !== undefined) {
          entry.status = "blocked";
          entry.visible = false;
        }
        break;
      }
      case "ToolFrozen": {
        const name = asString(e.payload, "toolName");
        if (name === undefined) break;
        const entry = tools.get(name);
        if (entry !== undefined) {
          entry.status = "frozen";
          entry.visible = false;
          entry.freezeReason = asString(e.payload, "reasonCode");
        }
        break;
      }
      case "ToolManifestChanged": {
        view.manifestHash = asString(e.payload, "manifestHash") ?? view.manifestHash;
        view.normalizationVersion =
          asNumber(e.payload, "normalizationVersion") ?? view.normalizationVersion;
        for (const name of readStringArray(e.payload, "removed")) {
          tools.delete(name);
        }
        for (const t of readToolEntries(e.payload, "added")) {
          tools.set(t.name, toEntry(t.name, t.riskClass, t.schemaHash));
        }
        for (const c of readChangedEntries(e.payload, "changed")) {
          const entry = tools.get(c.name);
          if (entry === undefined) continue;
          if (c.schemaHash !== undefined) entry.schemaHash = c.schemaHash;
          if (c.riskClass !== undefined) entry.riskClass = c.riskClass;
          entry.status = classDefault(entry.riskClass);
          entry.visible = entry.status === "active";
          delete entry.freezeReason;
        }
        break;
      }
      case "ToolManifestApproved": {
        view.approvedManifestHash =
          asString(e.payload, "manifestHash") ?? view.approvedManifestHash;
        for (const entry of tools.values()) {
          if (entry.status === "frozen" && entry.freezeReason === "changed_sensitive") {
            entry.status = classDefault(entry.riskClass);
            entry.visible = entry.status === "active";
            delete entry.freezeReason;
          }
        }
        break;
      }
      default:
        break;
    }
  }

  view.tools = [...tools.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  return view;
}
