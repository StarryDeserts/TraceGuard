import { ToolManifestApprovedPayload, type LedgerEvent } from "@traceguard/schemas";
import { makeEvent, type Clock, type IdGen } from "@traceguard/event-ledger";

export interface ApproveDeps {
  clock: Clock;
  newId: IdGen;
}

export interface ApproveToolManifestArgs {
  workspaceId: string;
  providerConnectionId: string;
  toolManifestVersionId: string;
  manifestHash: string;
  approvedBy: string;
  previousEventHash?: string | null;
}

export function approveToolManifest(
  args: ApproveToolManifestArgs,
  deps: ApproveDeps,
): LedgerEvent {
  return makeEvent(
    {
      workspaceId: args.workspaceId,
      aggregateType: "tool_manifest",
      aggregateId: args.toolManifestVersionId,
      eventType: "ToolManifestApproved",
      eventVersion: 1,
      schemaVersion: 1,
      actorType: "user",
      actorId: args.approvedBy,
      payload: ToolManifestApprovedPayload.parse({
        toolManifestVersionId: args.toolManifestVersionId,
        providerConnectionId: args.providerConnectionId,
        manifestHash: args.manifestHash,
        approvedBy: args.approvedBy,
        approvedAt: deps.clock.now(),
      }),
      previousEventHash: args.previousEventHash ?? null,
    },
    deps,
  );
}
