import { makeEvent, approvalProjection, type LedgerStore } from "@traceguard/event-ledger";
import { computeActionDigest } from "@traceguard/policy-engine";
import { proposeDecision, resolveAuthorizationGateway } from "@traceguard/domain";
import { executionOrchestrator } from "@traceguard/runtime";
import {
  RunStartedPayload,
  RunCompletedPayload,
  RunFailedPayload,
  type ActionDigestInput,
  type DecisionAction,
  type ExecutionAdapterType,
  type LedgerEvent,
} from "@traceguard/schemas";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GatewayState } from "./gateway-state.js";
import type { InternalToolContext } from "./internal-tool-context.js";
import type { CachedDecision } from "./decision-cache.js";
import {
  buildEvaluationContext,
  intendedUpstreamTool,
  isoPlusSeconds,
  policyVersionId,
} from "./evaluation-context.js";

export type { InternalToolContext } from "./internal-tool-context.js";

export type InternalErrorCode =
  | "DECISION_INVALID"
  | "POLICY_BLOCKED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_EXPIRED"
  | "AUTHORIZATION_MISSING"
  | "AUTHORIZATION_CONSUMED"
  | "ACTION_DIGEST_MISMATCH"
  | "EXECUTION_UNKNOWN"
  | "EXECUTION_FAILED"
  | "CAPABILITY_UNAVAILABLE"
  | "RUN_NOT_FOUND";

export function internalOk(status: string, extra: Record<string, unknown> = {}): CallToolResult {
  return {
    isError: false,
    content: [{ type: "text", text: `traceguard:${status}` }],
    traceguard: { status, ...extra },
  } as unknown as CallToolResult;
}

export function internalErr(
  code: InternalErrorCode,
  toolName: string,
  extra: Record<string, unknown> = {},
): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `traceguard:error:${code}` }],
    traceguard: { errorCode: code, toolName, ...extra },
  } as unknown as CallToolResult;
}

const RUN_ID_TOOLS: ReadonlySet<string> = new Set([
  "traceguard_start_run",
  "traceguard_record_decision",
  "traceguard_request_execution",
  "traceguard_execute_authorized_action",
  "traceguard_finish_run",
]);

export async function dispatchInternalTool(
  ctx: InternalToolContext,
  state: GatewayState,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  if (RUN_ID_TOOLS.has(name) && args.runId !== ctx.run.runId) {
    return internalErr("RUN_NOT_FOUND", name);
  }
  switch (name) {
    case "traceguard_start_run":
      return startRun(ctx, state, args);
    case "traceguard_record_decision":
      return recordDecision(ctx, state, args);
    case "traceguard_request_execution":
      return requestExecution(ctx, args);
    case "traceguard_check_approval":
      return checkApproval(ctx, args);
    case "traceguard_execute_authorized_action":
      return executeAuthorizedAction(ctx, args);
    case "traceguard_finish_run":
      return finishRun(ctx, args);
    default:
      return internalErr("DECISION_INVALID", name);
  }
}

export function eventsForApproval(events: LedgerEvent[], approvalId: string): LedgerEvent[] {
  return events.filter((e) => {
    if (e.aggregateType === "approval" && e.aggregateId === approvalId) return true;
    const payload = e.payload as { approvalId?: string } | null;
    return payload?.approvalId === approvalId;
  });
}

async function startRun(
  ctx: InternalToolContext,
  state: GatewayState,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  if (typeof args.agentName === "string") ctx.run.agentName = args.agentName;
  if (typeof args.intent === "string") ctx.run.intent = args.intent;
  if (typeof args.mode === "string") ctx.run.mode = args.mode;

  const ws = ctx.audit.workspaceId;
  const runEvents = await ctx.store.read(ws, ctx.run.runId);
  const alreadyStarted = runEvents.some((e) => e.eventType === "RunStarted");
  if (!alreadyStarted) {
    const head = await ctx.store.head(ws);
    const started = makeEvent(
      {
        workspaceId: ws,
        aggregateType: "run",
        aggregateId: ctx.run.runId,
        eventType: "RunStarted",
        eventVersion: 1,
        schemaVersion: 1,
        actorType: "agent",
        ...(ctx.run.agentName !== undefined ? { actorId: ctx.run.agentName } : {}),
        runId: ctx.run.runId,
        payload: RunStartedPayload.parse({
          runId: ctx.run.runId,
          startedAt: ctx.deps.clock.now(),
          ...(ctx.run.agentName !== undefined ? { agentName: ctx.run.agentName } : {}),
          ...(ctx.run.intent !== undefined ? { intent: ctx.run.intent } : {}),
          mode: ctx.run.mode,
        }),
        previousEventHash: head,
      },
      ctx.deps,
    );
    await ctx.store.append(head, [started]);
  }
  return internalOk("RUN_STARTED", {
    runId: ctx.run.runId,
    policyVersionId: policyVersionId(ctx.policy),
    toolManifestHash: state.manifestHash,
  });
}

async function recordDecision(
  ctx: InternalToolContext,
  state: GatewayState,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const name = "traceguard_record_decision";
  const ws = ctx.audit.workspaceId;
  const decisionId = ctx.deps.newId.next("dec");
  const instrument = String(args.instrument ?? "");
  const marketType = String(args.marketType ?? "");
  const action = String(args.action ?? "") as DecisionAction;
  const notional = args.requestedNotionalUsdt !== undefined ? String(args.requestedNotionalUsdt) : undefined;
  const leverage = args.requestedLeverage !== undefined ? String(args.requestedLeverage) : undefined;

  const envelope: Record<string, unknown> = {
    id: decisionId,
    instrument,
    marketType,
    action,
    thesis: String(args.thesis ?? ""),
    evidenceRefs: Array.isArray(args.evidenceRefs) ? args.evidenceRefs : [],
    ...(notional !== undefined ? { requestedNotionalUsdt: notional } : {}),
    ...(leverage !== undefined ? { requestedLeverage: leverage } : {}),
    ...(args.confidence !== undefined ? { confidence: args.confidence } : {}),
  };

  const context = buildEvaluationContext(state, ctx.run, "trade_like", ctx.policy);
  const head = await ctx.store.head(ws);
  const result = proposeDecision(
    {
      workspaceId: ws,
      ...(ctx.run.agentName !== undefined ? { actorId: ctx.run.agentName } : {}),
      envelope,
      policy: ctx.policy,
      context,
      previousEventHash: head,
    },
    ctx.deps,
  );
  await ctx.store.append(head, result.events);

  const evaluated = result.events.find((e) => e.eventType === "PolicyEvaluated");
  if (!evaluated) return internalErr("DECISION_INVALID", name);
  const proposed = result.events.find((e) => e.eventType === "DecisionProposed");
  const decisionHash = (proposed?.payload as { decisionHash?: string } | undefined)?.decisionHash ?? "";
  const policyEvaluationId = (evaluated.payload as { evaluationId: string }).evaluationId;

  const digestBase: Omit<ActionDigestInput, "executionAdapter"> = {
    workspaceId: ws,
    runId: ctx.run.runId,
    decisionId,
    providerConnectionId: ctx.audit.providerConnectionId,
    toolName: intendedUpstreamTool(marketType),
    toolManifestHash: state.manifestHash ?? "",
    policyVersionId: policyVersionId(ctx.policy),
    workspaceMode: ctx.run.mode,
    instrument,
    marketType,
    action,
    ...(notional !== undefined ? { requestedNotionalUsdt: notional } : {}),
    ...(leverage !== undefined ? { requestedLeverage: leverage } : {}),
  };

  const cached: CachedDecision = {
    decisionId,
    outcome: result.decision.outcome,
    matchedRules: result.decision.matchedRules.map((r) => r.ruleId),
    policyEvaluationId,
    decisionHash,
    summary: {
      instrument,
      action: action as DecisionAction,
      ...(notional !== undefined ? { notionalUsdt: notional } : {}),
      ...(leverage !== undefined ? { leverage } : {}),
    },
    digestBase,
  };
  ctx.cache.decisions.set(decisionId, cached);
  return internalOk("validated", { decisionId, decisionHash });
}

async function requestExecution(ctx: InternalToolContext, args: Record<string, unknown>): Promise<CallToolResult> {
  const name = "traceguard_request_execution";
  const decisionId = String(args.decisionId ?? "");
  const cached = ctx.cache.decisions.get(decisionId);
  if (!cached) return internalErr("DECISION_INVALID", name);

  const executionAdapter = (args.executionAdapter ?? "simulator") as ExecutionAdapterType;
  if (executionAdapter !== "simulator") return internalErr("CAPABILITY_UNAVAILABLE", name);

  if (cached.outcome === "block") {
    return internalErr("POLICY_BLOCKED", name, { matchedRules: cached.matchedRules, executionSent: false });
  }

  const ws = ctx.audit.workspaceId;
  const actionDigestInput: ActionDigestInput = { ...cached.digestBase, executionAdapter };
  const now = ctx.deps.clock.now();
  const head = await ctx.store.head(ws);
  const gate = resolveAuthorizationGateway(
    {
      workspaceId: ws,
      runId: ctx.run.runId,
      decisionId,
      policyEvaluationId: cached.policyEvaluationId,
      outcome: cached.outcome,
      actionDigestInput,
      channelOptions: ["web"],
      summary: cached.summary,
      approvalExpiresAt: isoPlusSeconds(now, ctx.ttls.approvalSeconds),
      authorizationExpiresAt: isoPlusSeconds(now, ctx.ttls.authorizationSeconds),
      previousEventHash: head,
    },
    ctx.deps,
  );
  await ctx.store.append(head, gate.events);

  if (cached.outcome === "require_approval") {
    const requested = gate.events.find((e) => e.eventType === "ApprovalRequested");
    const approvalId = (requested?.payload as { approvalId: string }).approvalId;
    ctx.cache.approvalIndex.set(approvalId, { runId: ctx.run.runId, decisionId });
    return internalOk("APPROVAL_REQUIRED", {
      approvalId,
      runId: ctx.run.runId,
      expiresAt: isoPlusSeconds(now, ctx.ttls.approvalSeconds),
    });
  }

  return finishExecution(ctx, decisionId, actionDigestInput, executionAdapter, "ALLOWED", name);
}

async function checkApproval(ctx: InternalToolContext, args: Record<string, unknown>): Promise<CallToolResult> {
  const name = "traceguard_check_approval";
  const approvalId = String(args.approvalId ?? "");
  const all = await ctx.store.read(ctx.audit.workspaceId);
  const view = approvalProjection(eventsForApproval(all, approvalId));
  const now = ctx.deps.clock.now();

  switch (view.status) {
    case "approved":
      return internalOk("APPROVED", {
        authorizationId: view.authorizationId,
        authorizationExpiresAt: view.authorizationExpiresAt,
      });
    case "pending":
      if (view.expiresAt !== undefined && now >= view.expiresAt) return internalErr("APPROVAL_EXPIRED", name);
      return internalOk("PENDING");
    case "rejected":
      return internalOk("REJECTED");
    case "consumed":
      return internalOk("CONSUMED");
    default:
      return internalErr("APPROVAL_EXPIRED", name);
  }
}

async function executeAuthorizedAction(
  ctx: InternalToolContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const name = "traceguard_execute_authorized_action";
  const decisionId = String(args.decisionId ?? "");
  const cached = ctx.cache.decisions.get(decisionId);
  if (!cached) return internalErr("DECISION_INVALID", name);

  const executionAdapter = (args.executionAdapter ?? "simulator") as ExecutionAdapterType;
  if (executionAdapter !== "simulator") return internalErr("CAPABILITY_UNAVAILABLE", name);

  const actionDigestInput: ActionDigestInput = { ...cached.digestBase, executionAdapter };
  return finishExecution(ctx, decisionId, actionDigestInput, executionAdapter, "EXECUTED", name);
}

async function finishRun(ctx: InternalToolContext, args: Record<string, unknown>): Promise<CallToolResult> {
  const ws = ctx.audit.workspaceId;
  const outcome = String(args.outcome ?? "succeeded");
  const events = await ctx.store.read(ws, ctx.run.runId);
  const alreadyCompleted = events.some((e) => e.eventType === "RunCompleted");
  const alreadyFailed = events.some((e) => e.eventType === "RunFailed");
  if (alreadyCompleted) return internalOk("completed", { runId: ctx.run.runId });
  if (alreadyFailed) return internalOk("failed", { runId: ctx.run.runId });

  const head = await ctx.store.head(ws);
  const now = ctx.deps.clock.now();
  const event =
    outcome === "failed"
      ? makeEvent(
          {
            workspaceId: ws,
            aggregateType: "run",
            aggregateId: ctx.run.runId,
            eventType: "RunFailed",
            eventVersion: 1,
            schemaVersion: 1,
            actorType: "system",
            runId: ctx.run.runId,
            payload: RunFailedPayload.parse({ runId: ctx.run.runId, failedAt: now, reasonCode: "orchestrator_error" }),
            previousEventHash: head,
          },
          ctx.deps,
        )
      : makeEvent(
          {
            workspaceId: ws,
            aggregateType: "run",
            aggregateId: ctx.run.runId,
            eventType: "RunCompleted",
            eventVersion: 1,
            schemaVersion: 1,
            actorType: "system",
            runId: ctx.run.runId,
            payload: RunCompletedPayload.parse({ runId: ctx.run.runId, completedAt: now }),
            previousEventHash: head,
          },
          ctx.deps,
        );
  await ctx.store.append(head, [event]);
  return internalOk(outcome === "failed" ? "failed" : "completed", { runId: ctx.run.runId });
}

async function finishExecution(
  ctx: InternalToolContext,
  decisionId: string,
  actionDigestInput: ActionDigestInput,
  adapterType: ExecutionAdapterType,
  okStatus: "ALLOWED" | "EXECUTED",
  toolName: string,
): Promise<CallToolResult> {
  const ws = ctx.audit.workspaceId;
  const attemptedActionDigest = computeActionDigest(actionDigestInput, ctx.deps.hash);
  const { outcome } = await executionOrchestrator(
    {
      workspaceId: ws,
      runId: ctx.run.runId,
      decisionId,
      attemptedActionDigest,
      adapterType,
      gates: { workspaceLocked: false, manifestChanged: false, policyChanged: false },
      executionGates: { capabilityUnavailable: false, snapshotStale: false, manifestUnapproved: false },
    },
    { ...ctx.deps, store: ctx.store, adapter: ctx.adapter },
  );

  if (outcome === "completed") {
    const payload = await lastEventPayload(ctx.store, ws, ctx.run.runId, "ExecutionCompleted");
    const completed = (payload ?? {}) as { executionId?: string };
    return internalOk(okStatus, { executionId: completed.executionId, receipt: pickReceipt(payload) });
  }
  if (outcome === "denied") {
    const payload = await lastEventPayload(ctx.store, ws, ctx.run.runId, "AuthorizationRejected");
    return internalErr(mapGuardReason(reasonOf(payload)), toolName);
  }
  if (outcome === "rejected") {
    const payload = await lastEventPayload(ctx.store, ws, ctx.run.runId, "ExecutionRejected");
    return internalErr(mapExecReason(reasonOf(payload)), toolName);
  }
  if (outcome === "unknown") return internalErr("EXECUTION_UNKNOWN", toolName);
  return internalErr("EXECUTION_FAILED", toolName);
}

async function lastEventPayload(
  store: LedgerStore,
  ws: string,
  runId: string,
  eventType: string,
): Promise<unknown> {
  const events = await store.read(ws, runId);
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.eventType === eventType) return events[i]!.payload;
  }
  return undefined;
}

function reasonOf(payload: unknown): string {
  return (payload as { reasonCode?: string } | undefined)?.reasonCode ?? "";
}

function pickReceipt(payload: unknown): { receiptRef: string; receiptHash: string; finalStatus: string } {
  const p = (payload ?? {}) as { receiptRef?: string; receiptHash?: string; finalStatus?: string };
  return { receiptRef: p.receiptRef ?? "", receiptHash: p.receiptHash ?? "", finalStatus: p.finalStatus ?? "" };
}

function mapGuardReason(reasonCode: string): InternalErrorCode {
  switch (reasonCode) {
    case "missing_authorization":
      return "AUTHORIZATION_MISSING";
    case "expired_authorization":
      return "APPROVAL_EXPIRED";
    case "already_consumed":
      return "AUTHORIZATION_CONSUMED";
    case "action_digest_mismatch":
      return "ACTION_DIGEST_MISMATCH";
    default:
      return "AUTHORIZATION_MISSING";
  }
}

function mapExecReason(_reasonCode: string): InternalErrorCode {
  return "CAPABILITY_UNAVAILABLE";
}
