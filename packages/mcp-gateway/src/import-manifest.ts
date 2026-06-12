import type { ProviderType, RawUpstreamTool } from "@traceguard/schemas";
import {
  reconcileManifest,
  type ApprovedManifest,
  type ReconcileDeps,
  type ReconcileResult,
} from "@traceguard/tool-manifest";
import type { UpstreamManifestClient } from "./upstream-client.js";

export interface ImportManifestArgs {
  workspaceId: string;
  providerConnectionId: string;
  providerType: ProviderType;
  toolManifestVersionId: string;
  approved?: ApprovedManifest;
  previousEventHash?: string | null;
}

export interface ImportManifestResult extends ReconcileResult {
  toolCount: number;
}

export async function importManifest(
  args: ImportManifestArgs,
  client: UpstreamManifestClient,
  deps: ReconcileDeps,
): Promise<ImportManifestResult> {
  await client.open();
  try {
    const observed: RawUpstreamTool[] = await client.listTools();
    const result = reconcileManifest({ ...args, observed }, deps);
    return { ...result, toolCount: observed.length };
  } finally {
    await client.close();
  }
}
