import { reconcileManifest, type ReconcileDeps } from "@traceguard/tool-manifest";
import { toolManifestProjection, type LedgerStore } from "@traceguard/event-ledger";
import type { ProviderType } from "@traceguard/schemas";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  type UpstreamManifestClient,
  UpstreamUnavailableError,
  UpstreamListToolsError,
} from "./upstream-client.js";
import { buildGatewayState, degradedState, type GatewayState } from "./gateway-state.js";
import { createGatewayServer } from "./gateway-server.js";
import { recordRunCreated, type CallAudit } from "./tool-call-events.js";
import type { GatewayCallContext } from "./call-handler.js";

export interface BootGatewayArgs {
  workspaceId: string;
  providerConnectionId: string;
  providerType: ProviderType;
  toolManifestVersionId: string;
}

export interface GatewayHandle {
  state: GatewayState;
  server: Server;
  client: UpstreamManifestClient; // long-lived on success; caller owns shutdown
  runId?: string;
}

export async function bootGateway(
  args: BootGatewayArgs,
  client: UpstreamManifestClient,
  store: LedgerStore,
  deps: ReconcileDeps,
): Promise<GatewayHandle> {
  let state: GatewayState;
  try {
    await client.open();
    const observed = await client.listTools();
    const head = await store.head(args.workspaceId);
    const result = reconcileManifest({ ...args, observed, previousEventHash: head }, deps);
    await store.append(head, result.events);
    const events = await store.read(args.workspaceId);
    const view = toolManifestProjection(events);
    state = buildGatewayState({
      normalized: result.normalized,
      view,
      manifestHash: result.manifestHash,
      toolCount: observed.length,
    });
  } catch (err) {
    if (err instanceof UpstreamUnavailableError || err instanceof UpstreamListToolsError) {
      await safeClose(client); // degraded: nothing to keep alive
      const degraded = degradedState();
      const server = createGatewayServer(degraded);
      return { state: degraded, server, client };
    }
    await safeClose(client); // unexpected (e.g. LedgerConflictError, bug): surface it
    throw err;
  }

  const runId = deps.newId.next("run");
  const runHead = await store.head(args.workspaceId);
  const runEvent = recordRunCreated(
    {
      workspaceId: args.workspaceId,
      runId,
      providerConnectionId: args.providerConnectionId,
    },
    deps,
    runHead,
  );
  await store.append(runHead, [runEvent]);

  const audit: CallAudit = {
    workspaceId: args.workspaceId,
    runId,
    providerConnectionId: args.providerConnectionId,
  };
  const callCtx: GatewayCallContext = { client, store, deps, audit };
  const server = createGatewayServer(state, callCtx);
  return { state, server, client, runId };
}

async function safeClose(client: UpstreamManifestClient): Promise<void> {
  try {
    await client.close();
  } catch {
    /* teardown is best-effort */
  }
}
