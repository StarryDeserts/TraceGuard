import {
  canonicalJson,
  type NormalizedToolDefinition,
  type ToolManifestEntry,
} from "@traceguard/schemas";
import { NORMALIZATION_VERSION } from "./normalization-version.js";

export function manifestFingerprint(def: NormalizedToolDefinition): ToolManifestEntry {
  return { name: def.name, riskClass: def.riskClass, schemaHash: def.schemaHash };
}

function byName(a: ToolManifestEntry, b: ToolManifestEntry): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function computeManifestHash(
  defs: NormalizedToolDefinition[],
  deps: { hash: (input: string) => string },
): string {
  const tools = defs.map(manifestFingerprint).sort(byName);
  return deps.hash(canonicalJson({ normalizationVersion: NORMALIZATION_VERSION, tools }));
}
