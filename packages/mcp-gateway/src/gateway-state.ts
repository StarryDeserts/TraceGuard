import type { NormalizedToolDefinition, RiskClass } from "@traceguard/schemas";
import type { ToolInventoryView, ToolStatus } from "@traceguard/event-ledger";

// A faithful pass-through of the MCP Tool fields, for the governed-visible subset.
export interface ServedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

export interface RouteEntry {
  status: ToolStatus;
  riskClass: RiskClass;
}

export interface GatewayState {
  servedTools: ServedTool[];
  route: Map<string, RouteEntry>;
  manifestHash: string | null; // null only in degraded mode
  toolCount: number; // upstream tool count this boot (0 when degraded)
  degraded: boolean; // true when startup import failed (provider degraded)
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

// Join the projection's visible name-set against the normalized definitions.
export function selectServedTools(
  normalized: NormalizedToolDefinition[],
  view: ToolInventoryView,
): ServedTool[] {
  const visible = new Set(view.tools.filter((t) => t.visible).map((t) => t.name));
  return normalized
    .filter((n) => visible.has(n.name))
    .sort(byName)
    .map((n) => {
      const tool: ServedTool = { name: n.name, inputSchema: n.inputSchema };
      if (n.title !== undefined) tool.title = n.title;
      if (n.description !== undefined) tool.description = n.description;
      if (n.outputSchema !== undefined) tool.outputSchema = n.outputSchema;
      if (n.annotations !== undefined) tool.annotations = n.annotations;
      return tool;
    });
}

export function buildGatewayState(args: {
  normalized: NormalizedToolDefinition[];
  view: ToolInventoryView;
  manifestHash: string;
  toolCount: number;
}): GatewayState {
  return {
    servedTools: selectServedTools(args.normalized, args.view),
    route: new Map(
      args.view.tools.map((t) => [t.name, { status: t.status, riskClass: t.riskClass }]),
    ),
    manifestHash: args.manifestHash,
    toolCount: args.toolCount,
    degraded: false,
  };
}

export function degradedState(): GatewayState {
  return {
    servedTools: [],
    route: new Map(),
    manifestHash: null,
    toolCount: 0,
    degraded: true,
  };
}
