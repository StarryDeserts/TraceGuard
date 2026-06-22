import type { ReconcileDeps } from "@traceguard/tool-manifest";
import type { LedgerStore } from "@traceguard/event-ledger";
import type { ApprovalChannel, Policy, ProviderType } from "@traceguard/schemas";
import type { ApprovalOutcome } from "@traceguard/domain";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  type UpstreamManifestClient,
  UpstreamUnavailableError,
  UpstreamListToolsError,
} from "./upstream-client.js";
import { degradedState, type GatewayState } from "./gateway-state.js";
import { createGatewayServer } from "./gateway-server.js";
import { buildGatewayRuntime, type GatewayRuntime } from "./gateway-runtime.js";

export interface BootGatewayArgs {
  workspaceId: string;
  providerConnectionId: string;
  providerType: ProviderType;
  toolManifestVersionId: string;
  policy?: Policy; // defaults to DEFAULT_POLICY
}

export interface GatewayHandle {
  state: GatewayState;
  server: Server;
  client: UpstreamManifestClient; // long-lived on success; caller owns shutdown
  runId?: string;
  approve?: (approvalId: string, by: { approvedBy: string; channel: ApprovalChannel }) => Promise<ApprovalOutcome>;
  reject?: (
    approvalId: string,
    by: { rejectedBy: string; channel: ApprovalChannel; reason?: string },
  ) => Promise<ApprovalOutcome>;
}

export async function bootGateway(
  args: BootGatewayArgs,
  client: UpstreamManifestClient,
  store: LedgerStore,
  deps: ReconcileDeps,
): Promise<GatewayHandle> {
  let runtime: GatewayRuntime;
  try {
    runtime = await buildGatewayRuntime(args, client, store, deps);
  } catch (err) {
    if (err instanceof UpstreamUnavailableError || err instanceof UpstreamListToolsError) {
      await safeClose(client); // degraded: nothing to keep alive
      const degraded = degradedState();
      return { state: degraded, server: createGatewayServer(degraded), client };
    }
    await safeClose(client); // unexpected (e.g. LedgerConflictError, bug): surface it
    throw err;
  }

  const server = createGatewayServer(runtime.state, runtime.callCtx, runtime.internalCtx);
  return {
    state: runtime.state,
    server,
    client,
    runId: runtime.runId,
    approve: runtime.approve,
    reject: runtime.reject,
  };
}

async function safeClose(client: UpstreamManifestClient): Promise<void> {
  try {
    await client.close();
  } catch {
    /* teardown is best-effort */
  }
}
