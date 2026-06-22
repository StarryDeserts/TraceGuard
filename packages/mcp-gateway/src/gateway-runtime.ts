import { reconcileManifest, type ReconcileDeps } from "@traceguard/tool-manifest";
import {
  toolManifestProjection,
  approvalProjection,
  type LedgerStore,
} from "@traceguard/event-ledger";
import type { ApprovalChannel } from "@traceguard/schemas";
import { approveApproval, rejectApproval, type ApprovalOutcome } from "@traceguard/domain";
import { createSimulatorAdapter, createBitgetLiveAdapter } from "@traceguard/runtime";
import type { UpstreamManifestClient } from "./upstream-client.js";
import { buildGatewayState, type GatewayState } from "./gateway-state.js";
import { recordRunCreated, type CallAudit } from "./tool-call-events.js";
import type { GatewayCallContext } from "./call-handler.js";
import { DEFAULT_POLICY } from "./default-policy.js";
import { createDecisionCache } from "./decision-cache.js";
import { isoPlusSeconds } from "./evaluation-context.js";
import { eventsForApproval } from "./internal-tool-handlers.js";
import type { ApprovalTtls, InternalToolContext, RunContext } from "./internal-tool-context.js";
import { createArgValidator } from "./arg-validation.js";
import type { BootGatewayArgs } from "./boot-gateway.js";

export interface GatewayRuntime {
  state: GatewayState;
  callCtx: GatewayCallContext;
  internalCtx: InternalToolContext;
  approve: (approvalId: string, by: { approvedBy: string; channel: ApprovalChannel }) => Promise<ApprovalOutcome>;
  reject: (
    approvalId: string,
    by: { rejectedBy: string; channel: ApprovalChannel; reason?: string },
  ) => Promise<ApprovalOutcome>;
  runId: string;
}

export async function buildGatewayRuntime(
  args: BootGatewayArgs,
  client: UpstreamManifestClient,
  store: LedgerStore,
  deps: ReconcileDeps,
): Promise<GatewayRuntime> {
  await client.open();
  const observed = await client.listTools();
  const head = await store.head(args.workspaceId);
  const result = reconcileManifest({ ...args, observed, previousEventHash: head }, deps);
  await store.append(head, result.events);
  const events = await store.read(args.workspaceId);
  const view = toolManifestProjection(events);
  const state = buildGatewayState({
    normalized: result.normalized,
    view,
    manifestHash: result.manifestHash,
    toolCount: observed.length,
  });

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
    adapters: {
      simulator: createSimulatorAdapter({ hash: deps.hash }),
      bitget_live: createBitgetLiveAdapter({
        store,
        client,
        workspaceId: args.workspaceId,
        hash: deps.hash,
        timeoutMs: 10_000,
      }),
    },
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

  return { state, callCtx, internalCtx, approve, reject, runId };
}
