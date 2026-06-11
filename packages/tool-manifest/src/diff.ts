import type {
  ChangedTool,
  NormalizedToolDefinition,
  RiskClass,
  ToolManifestEntry,
} from "@traceguard/schemas";

const SENSITIVE_CLASSES = new Set<RiskClass>([
  "trade_like",
  "asset_movement",
  "administrative",
]);

export interface ManifestDiff {
  added: ToolManifestEntry[];
  removed: string[];
  changed: ChangedTool[];
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function diffManifest(
  approved: ToolManifestEntry[],
  observed: NormalizedToolDefinition[],
): ManifestDiff {
  const approvedByName = new Map(approved.map((t) => [t.name, t]));
  const observedByName = new Map(observed.map((t) => [t.name, t]));

  const added: ToolManifestEntry[] = [];
  const changed: ChangedTool[] = [];
  for (const obs of observed) {
    const prev = approvedByName.get(obs.name);
    if (prev === undefined) {
      added.push({ name: obs.name, riskClass: obs.riskClass, schemaHash: obs.schemaHash });
      continue;
    }
    if (prev.schemaHash !== obs.schemaHash || prev.riskClass !== obs.riskClass) {
      const sensitive =
        SENSITIVE_CLASSES.has(prev.riskClass) || SENSITIVE_CLASSES.has(obs.riskClass);
      changed.push({
        name: obs.name,
        previousSchemaHash: prev.schemaHash,
        schemaHash: obs.schemaHash,
        previousRiskClass: prev.riskClass,
        riskClass: obs.riskClass,
        sensitive,
      });
    }
  }

  const removed: string[] = [];
  for (const prev of approved) {
    if (!observedByName.has(prev.name)) removed.push(prev.name);
  }

  added.sort(byName);
  changed.sort(byName);
  removed.sort();
  return { added, removed, changed };
}
