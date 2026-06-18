import { reconcileManifest, type ReconcileDeps } from "@traceguard/tool-manifest";
import {
  toolManifestProjection,
  approvalProjection,
  type LedgerStore,
} from "@traceguard/event-ledger";
import type { ApprovalChannel, Policy, ProviderType } from "@traceguard/schemas";
import {
  approveApproval,
  rejectApproval,
  type ApprovalOutcome,
} from "@traceguard/domain";
import { createSimulatorAdapter } from "@traceguard/runtime";
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
import { DEFAULT_POLICY } from "./default-policy.js";
import { createDecisionCache } from "./decision-cache.js";
import { isoPlusSeconds } from "./evaluation-context.js";
import { eventsForApproval } from "./internal-tool-handlers.js";
import type { ApprovalTtls, InternalToolContext, RunContext } from "./internal-tool-context.js";
import { createArgValidator } from "./arg-validation.js";

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
  const callCtx: GatewayCallContext = {
    client,
    store,
    deps,
    audit,
    argValidator: createArgValidator(state.servedTools),
  };

  const ws = args.workspaceId;
  const policy = args.policy ?? DEFAULT_POLICY;
  const ttls: ApprovalTtls = { approvalSeconds: 900, authorizationSeconds: 900 };
  const run: RunContext = { runId, mode: "safe_demo" };
  const internalCtx: InternalToolContext = {
    store,
    deps,
    audit,
    policy,
    adapter: createSimulatorAdapter({ hash: deps.hash }),
    run,
    cache: createDecisionCache(),
    ttls,
  };

  async function approve(
    approvalId: string,
    by: { approvedBy: string; channel: ApprovalChannel },
  ): Promise<ApprovalOutcome> {
    const all = await store.read(ws);
    const approvalState = approvalProjection(eventsForApproval(all, approvalId));
    const head = await store.head(ws);
    const res = approveApproval(
      {
        workspaceId: ws,
        approvalState,
        approvedBy: by.approvedBy,
        approvalChannel: by.channel,
        authorizationExpiresAt: isoPlusSeconds(deps.clock.now(), ttls.authorizationSeconds),
        previousEventHash: head,
      },
      deps,
    );
    if (res.events.length > 0) await store.append(head, res.events);
    return res.outcome;
  }

  async function reject(
    approvalId: string,
    by: { rejectedBy: string; channel: ApprovalChannel; reason?: string },
  ): Promise<ApprovalOutcome> {
    const all = await store.read(ws);
    const approvalState = approvalProjection(eventsForApproval(all, approvalId));
    const head = await store.head(ws);
    const res = rejectApproval(
      {
        workspaceId: ws,
        approvalState,
        rejectedBy: by.rejectedBy,
        rejectionChannel: by.channel,
        ...(by.reason !== undefined ? { reason: by.reason } : {}),
        previousEventHash: head,
      },
      deps,
    );
    if (res.events.length > 0) await store.append(head, res.events);
    return res.outcome;
  }

  const server = createGatewayServer(state, callCtx, internalCtx);
  return { state, server, client, runId, approve, reject };
}

async function safeClose(client: UpstreamManifestClient): Promise<void> {
  try {
    await client.close();
  } catch {
    /* teardown is best-effort */
  }
}
