import {
  ApprovalApprovedPayload,
  ApprovalExpiredPayload,
  ApprovalRejectedPayload,
  AuthorizationIssuedPayload,
  type ActorType,
  type ApprovalChannel,
  type LedgerEvent,
} from "@traceguard/schemas";
import { makeEvent, type ApprovalProjection } from "@traceguard/event-ledger";
import type { ApprovalTransitionDeps, ApprovalTransitionResult } from "./authorization-gateway.js";

function createEmitter(workspaceId: string, runId: string, deps: ApprovalTransitionDeps, startHash: string | null) {
  const events: LedgerEvent[] = [];
  let previousEventHash = startHash;
  function emit<TPayload>(
    aggregateType: "approval" | "authorization",
    aggregateId: string,
    eventType: string,
    actorType: ActorType,
    actorId: string | undefined,
    payload: TPayload,
  ): void {
    const event = makeEvent(
      {
        workspaceId,
        aggregateType,
        aggregateId,
        eventType,
        eventVersion: 1,
        schemaVersion: 1,
        actorType,
        actorId,
        runId,
        payload,
        previousEventHash,
      },
      deps,
    );
    events.push(event);
    previousEventHash = event.eventHash;
  }
  return { events, emit };
}

export interface ApproveApprovalArgs {
  workspaceId: string;
  approvalState: ApprovalProjection;
  approvedBy: string;
  approvalChannel: ApprovalChannel;
  authorizationExpiresAt: string;
  previousEventHash?: string | null;
}

export function approveApproval(args: ApproveApprovalArgs, deps: ApprovalTransitionDeps): ApprovalTransitionResult {
  const state = args.approvalState;
  if (state.status !== "pending") {
    return { events: [], outcome: "illegal_transition" };
  }
  const { approvalId, runId, decisionId, actionDigest, expiresAt } = state;
  if (
    approvalId === undefined ||
    runId === undefined ||
    decisionId === undefined ||
    actionDigest === undefined ||
    expiresAt === undefined
  ) {
    return { events: [], outcome: "illegal_transition" };
  }

  const now = deps.clock.now();
  const { events, emit } = createEmitter(args.workspaceId, runId, deps, args.previousEventHash ?? null);

  if (now >= expiresAt) {
    emit(
      "approval",
      approvalId,
      "ApprovalExpired",
      "system",
      undefined,
      ApprovalExpiredPayload.parse({ approvalId, expiredAt: now, actionDigest }),
    );
    return { events, outcome: "expired" };
  }

  emit(
    "approval",
    approvalId,
    "ApprovalApproved",
    "user",
    args.approvedBy,
    ApprovalApprovedPayload.parse({
      approvalId,
      runId,
      decisionId,
      actionDigest,
      approvedBy: args.approvedBy,
      approvalChannel: args.approvalChannel,
      approvedAt: now,
      expiresAt: args.authorizationExpiresAt,
    }),
  );

  const authorizationId = deps.newId.next("authz");
  emit(
    "authorization",
    authorizationId,
    "AuthorizationIssued",
    "system",
    undefined,
    AuthorizationIssuedPayload.parse({
      authorizationId,
      approvalId,
      runId,
      decisionId,
      actionDigest,
      expiresAt: args.authorizationExpiresAt,
      scope: "single_action",
    }),
  );

  return { events, outcome: "approved" };
}

export interface RejectApprovalArgs {
  workspaceId: string;
  approvalState: ApprovalProjection;
  rejectedBy: string;
  rejectionChannel: ApprovalChannel;
  reason?: string;
  previousEventHash?: string | null;
}

export function rejectApproval(args: RejectApprovalArgs, deps: ApprovalTransitionDeps): ApprovalTransitionResult {
  const state = args.approvalState;
  if (state.status !== "pending") {
    return { events: [], outcome: "illegal_transition" };
  }
  const { approvalId, runId, actionDigest, expiresAt } = state;
  if (approvalId === undefined || runId === undefined || actionDigest === undefined || expiresAt === undefined) {
    return { events: [], outcome: "illegal_transition" };
  }

  const now = deps.clock.now();
  const { events, emit } = createEmitter(args.workspaceId, runId, deps, args.previousEventHash ?? null);

  // Unified expiry rule (spec §5.2, Invariant I2): a lapse is never overridden by a rejection.
  if (now >= expiresAt) {
    emit(
      "approval",
      approvalId,
      "ApprovalExpired",
      "system",
      undefined,
      ApprovalExpiredPayload.parse({ approvalId, expiredAt: now, actionDigest }),
    );
    return { events, outcome: "expired" };
  }

  emit(
    "approval",
    approvalId,
    "ApprovalRejected",
    "user",
    args.rejectedBy,
    ApprovalRejectedPayload.parse({
      approvalId,
      rejectedBy: args.rejectedBy,
      rejectionChannel: args.rejectionChannel,
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
    }),
  );
  return { events, outcome: "rejected" };
}

export interface ExpireApprovalArgs {
  workspaceId: string;
  approvalState: ApprovalProjection;
  previousEventHash?: string | null;
}

export function expireApproval(args: ExpireApprovalArgs, deps: ApprovalTransitionDeps): ApprovalTransitionResult {
  const state = args.approvalState;
  if (state.status !== "pending") {
    return { events: [], outcome: "illegal_transition" };
  }
  const { approvalId, runId, actionDigest, expiresAt } = state;
  if (approvalId === undefined || runId === undefined || actionDigest === undefined || expiresAt === undefined) {
    return { events: [], outcome: "illegal_transition" };
  }

  const now = deps.clock.now();
  if (now < expiresAt) {
    return { events: [], outcome: "not_yet_expired" };
  }

  const { events, emit } = createEmitter(args.workspaceId, runId, deps, args.previousEventHash ?? null);
  emit(
    "approval",
    approvalId,
    "ApprovalExpired",
    "system",
    undefined,
    ApprovalExpiredPayload.parse({ approvalId, expiredAt: now, actionDigest }),
  );
  return { events, outcome: "expired" };
}
