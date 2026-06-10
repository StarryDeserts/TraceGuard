import {
  AuthorizationConsumedPayload,
  AuthorizationRejectedPayload,
  ExecutionRejectedPayload,
  ExecutionRequestedPayload,
  type ActorType,
  type ExecutionAdapterType,
  type ExecutionRejectionReason,
  type LedgerEvent,
} from "@traceguard/schemas";
import { canonicalJson, makeEvent, type Clock, type IdGen } from "@traceguard/event-ledger";
import { evaluateAuthorizationUse, type AuthorizationUseStatus } from "@traceguard/policy-engine";
import type { ExecutionRequest } from "./execution-adapter.js";

export interface ExecutionTransitionDeps {
  clock: Clock;
  newId: IdGen;
  hash: (s: string) => string;
}

export interface AuthorizeExecutionArgs {
  workspaceId: string;
  runId: string;
  decisionId: string;
  authorization?: {
    authorizationId: string;
    actionDigest: string;
    expiresAt: string;
    status: AuthorizationUseStatus;
    approvalId?: string;
  };
  attemptedActionDigest: string;
  gates: { workspaceLocked: boolean; manifestChanged: boolean; policyChanged: boolean };
  executionGates: { capabilityUnavailable: boolean; snapshotStale: boolean; manifestUnapproved: boolean };
  adapterType: ExecutionAdapterType;
  previousEventHash?: string | null;
}

export interface AuthorizeExecutionResult {
  events: LedgerEvent[];
  outcome: "executing" | "rejected" | "denied";
  request?: ExecutionRequest;
}

function createEmitter(
  workspaceId: string,
  runId: string,
  deps: ExecutionTransitionDeps,
  startHash: string | null,
) {
  const events: LedgerEvent[] = [];
  let previousEventHash = startHash;
  function emit<TPayload>(
    aggregateType: "execution" | "authorization" | "run",
    aggregateId: string,
    eventType: string,
    actorType: ActorType,
    payload: TPayload,
  ): LedgerEvent<TPayload> {
    const event = makeEvent(
      {
        workspaceId,
        aggregateType,
        aggregateId,
        eventType,
        eventVersion: 1,
        schemaVersion: 1,
        actorType,
        runId,
        payload,
        previousEventHash,
      },
      deps,
    );
    events.push(event);
    previousEventHash = event.eventHash;
    return event;
  }
  return { events, emit };
}

function executionPreconditionReason(gates: AuthorizeExecutionArgs["executionGates"]): ExecutionRejectionReason | undefined {
  if (gates.capabilityUnavailable) return "capability_unavailable";
  if (gates.snapshotStale) return "snapshot_stale";
  if (gates.manifestUnapproved) return "manifest_unapproved";
  return undefined;
}

export function authorizeExecution(
  args: AuthorizeExecutionArgs,
  deps: ExecutionTransitionDeps,
): AuthorizeExecutionResult {
  const startHash = args.previousEventHash ?? null;
  const executionId = deps.newId.next("exec");
  const idempotencyKey = `execution:${args.workspaceId}:${args.runId}:${args.decisionId}:${args.attemptedActionDigest}`;
  const requestRef = idempotencyKey;
  const requestHash = deps.hash(
    canonicalJson({
      workspaceId: args.workspaceId,
      runId: args.runId,
      decisionId: args.decisionId,
      actionDigest: args.attemptedActionDigest,
      adapterType: args.adapterType,
    }),
  );

  const { events, emit } = createEmitter(args.workspaceId, args.runId, deps, startHash);

  const guard = evaluateAuthorizationUse({
    ...(args.authorization
      ? {
          authorization: {
            authorizationId: args.authorization.authorizationId,
            actionDigest: args.authorization.actionDigest,
            expiresAt: args.authorization.expiresAt,
            status: args.authorization.status,
          },
        }
      : {}),
    attemptedActionDigest: args.attemptedActionDigest,
    now: deps.clock.now(),
    gates: args.gates,
  });

  if (!guard.ok) {
    emit(
      "authorization",
      args.authorization?.authorizationId ?? args.decisionId,
      "AuthorizationRejected",
      "system",
      AuthorizationRejectedPayload.parse({
        ...(args.authorization?.authorizationId ? { authorizationId: args.authorization.authorizationId } : {}),
        ...(args.authorization?.approvalId ? { approvalId: args.authorization.approvalId } : {}),
        runId: args.runId,
        decisionId: args.decisionId,
        attemptedActionDigest: args.attemptedActionDigest,
        ...(args.authorization?.actionDigest ? { expectedActionDigest: args.authorization.actionDigest } : {}),
        reasonCode: guard.reasonCode,
      }),
    );
    return { events, outcome: "denied" };
  }

  const preconditionReason = executionPreconditionReason(args.executionGates);
  if (preconditionReason !== undefined) {
    emit(
      "execution",
      executionId,
      "ExecutionRejected",
      "system",
      ExecutionRejectedPayload.parse({
        executionId,
        runId: args.runId,
        decisionId: args.decisionId,
        reasonCode: preconditionReason,
        executionSent: false,
      }),
    );
    return { events, outcome: "rejected" };
  }

  const now = deps.clock.now();
  emit(
    "execution",
    executionId,
    "ExecutionRequested",
    "system",
    ExecutionRequestedPayload.parse({
      executionId,
      runId: args.runId,
      decisionId: args.decisionId,
      authorizationId: guard.authorizationId,
      adapterType: args.adapterType,
      actionDigest: args.attemptedActionDigest,
      idempotencyKey,
      requestRef,
      requestHash,
    }),
  );
  emit(
    "authorization",
    guard.authorizationId,
    "AuthorizationConsumed",
    "system",
    AuthorizationConsumedPayload.parse({
      authorizationId: guard.authorizationId,
      ...(args.authorization?.approvalId ? { approvalId: args.authorization.approvalId } : {}),
      runId: args.runId,
      decisionId: args.decisionId,
      actionDigest: args.attemptedActionDigest,
      consumedAt: now,
      executionId,
    }),
  );

  const request: ExecutionRequest = {
    executionId,
    runId: args.runId,
    decisionId: args.decisionId,
    authorizationId: guard.authorizationId,
    actionDigest: args.attemptedActionDigest,
    idempotencyKey,
    requestRef,
    requestHash,
  };
  return { events, outcome: "executing", request };
}
