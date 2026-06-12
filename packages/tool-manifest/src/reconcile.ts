import {
  ToolBlockedPayload,
  ToolFrozenPayload,
  ToolManifestChangedPayload,
  ToolManifestImportedPayload,
  type ActorType,
  type AggregateType,
  type LedgerEvent,
  type NormalizedToolDefinition,
  type ProviderType,
  type RawUpstreamTool,
  type ToolManifestEntry,
} from "@traceguard/schemas";
import { makeEvent, type Clock, type IdGen } from "@traceguard/event-ledger";
import { NORMALIZATION_VERSION } from "./normalization-version.js";
import { normalizeToolDefinition } from "./normalize.js";
import { computeManifestHash, manifestFingerprint } from "./manifest-hash.js";
import { diffManifest } from "./diff.js";

export interface ReconcileDeps {
  clock: Clock;
  newId: IdGen;
  hash: (input: string) => string;
}

export interface ApprovedManifest {
  manifestHash: string;
  tools: ToolManifestEntry[];
}

export interface ReconcileManifestArgs {
  workspaceId: string;
  providerConnectionId: string;
  providerType: ProviderType;
  toolManifestVersionId: string;
  observed: RawUpstreamTool[];
  approved?: ApprovedManifest;
  previousEventHash?: string | null;
}

export interface ReconcileResult {
  events: LedgerEvent[];
  manifestHash: string;
  normalized: NormalizedToolDefinition[];
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function reconcileManifest(
  args: ReconcileManifestArgs,
  deps: ReconcileDeps,
): ReconcileResult {
  const identity = {
    providerConnectionId: args.providerConnectionId,
    providerType: args.providerType,
  };
  const normalized = args.observed.map((t) =>
    normalizeToolDefinition(t, identity, { hash: deps.hash }),
  );
  const manifestHash = computeManifestHash(normalized, { hash: deps.hash });
  const sorted = [...normalized].sort(byName);

  const events: LedgerEvent[] = [];
  let previousEventHash: string | null = args.previousEventHash ?? null;

  function emit<TPayload>(
    aggregateType: AggregateType,
    aggregateId: string,
    eventType: string,
    actorType: ActorType,
    payload: TPayload,
  ): void {
    const event = makeEvent(
      {
        workspaceId: args.workspaceId,
        aggregateType,
        aggregateId,
        eventType,
        eventVersion: 1,
        schemaVersion: 1,
        actorType,
        payload,
        previousEventHash,
      },
      deps,
    );
    events.push(event);
    previousEventHash = event.eventHash;
  }

  const toolAggregateId = (name: string): string =>
    `${args.providerConnectionId}:${name}`;

  function fanOutClassDefaults(def: NormalizedToolDefinition): void {
    if (def.riskClass === "unknown") {
      emit(
        "tool_definition",
        toolAggregateId(def.name),
        "ToolFrozen",
        "system",
        ToolFrozenPayload.parse({
          providerConnectionId: args.providerConnectionId,
          toolName: def.name,
          manifestHash,
          reasonCode: "unknown_risk",
        }),
      );
      return;
    }
    if (def.riskClass === "asset_movement" || def.riskClass === "administrative") {
      emit(
        "tool_definition",
        toolAggregateId(def.name),
        "ToolBlocked",
        "system",
        ToolBlockedPayload.parse({
          providerConnectionId: args.providerConnectionId,
          toolName: def.name,
          riskClass: def.riskClass,
          manifestHash,
          reasonCode: "risk_class_default",
        }),
      );
    }
  }

  // Case 2: no-op — observed manifest matches the approved baseline.
  if (args.approved !== undefined && args.approved.manifestHash === manifestHash) {
    return { events, manifestHash, normalized };
  }

  // Case 1: first import — no approved baseline yet.
  if (args.approved === undefined) {
    emit(
      "tool_manifest",
      args.toolManifestVersionId,
      "ToolManifestImported",
      "system",
      ToolManifestImportedPayload.parse({
        toolManifestVersionId: args.toolManifestVersionId,
        providerConnectionId: args.providerConnectionId,
        manifestHash,
        normalizationVersion: NORMALIZATION_VERSION,
        tools: sorted.map(manifestFingerprint),
      }),
    );
    sorted.forEach(fanOutClassDefaults);
    return { events, manifestHash, normalized };
  }

  // Case 3: drift — observed differs from the approved baseline.
  const diff = diffManifest(args.approved.tools, normalized);
  emit(
    "tool_manifest",
    args.toolManifestVersionId,
    "ToolManifestChanged",
    "system",
    ToolManifestChangedPayload.parse({
      toolManifestVersionId: args.toolManifestVersionId,
      providerConnectionId: args.providerConnectionId,
      previousManifestHash: args.approved.manifestHash,
      manifestHash,
      added: diff.added,
      removed: diff.removed,
      changed: diff.changed,
    }),
  );

  const byNameMap = new Map(sorted.map((d) => [d.name, d]));

  for (const change of diff.changed) {
    if (change.sensitive) {
      emit(
        "tool_definition",
        toolAggregateId(change.name),
        "ToolFrozen",
        "system",
        ToolFrozenPayload.parse({
          providerConnectionId: args.providerConnectionId,
          toolName: change.name,
          manifestHash,
          reasonCode: "changed_sensitive",
        }),
      );
    }
  }

  for (const added of diff.added) {
    const def = byNameMap.get(added.name);
    if (def !== undefined) fanOutClassDefaults(def);
  }

  return { events, manifestHash, normalized };
}
