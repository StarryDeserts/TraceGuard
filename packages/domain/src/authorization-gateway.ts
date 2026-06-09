import {
  ApprovalRequestedPayload,
  AuthorizationIssuedPayload,
  type ActionDigestInput,
  type ActorType,
  type ApprovalChannel,
  type DecisionAction,
  type Effect,
  type LedgerEvent,
} from "@traceguard/schemas";
import { makeEvent, type Clock, type IdGen } from "@traceguard/event-ledger";
import { computeActionDigest } from "@traceguard/policy-engine";

export interface ApprovalTransitionDeps {
  clock: Clock;
  newId: IdGen;
  hash: (s: string) => string;
}

export type ApprovalOutcome =
  | "issued"
  | "requested"
  | "blocked"
  | "approved"
  | "rejected"
  | "expired"
  | "not_yet_expired"
  | "illegal_transition";

export interface ApprovalTransitionResult {
  events: LedgerEvent[];
  outcome: ApprovalOutcome;
}

export interface AuthorizationSummary {
  instrument: string;
  action: DecisionAction;
  notionalUsdt?: string;
  leverage?: string;
}

export interface ResolveAuthorizationGatewayArgs {
  workspaceId: string;
  runId: string;
  decisionId: string;
  policyEvaluationId: string;
  outcome: Effect;
  actionDigestInput: ActionDigestInput;
  channelOptions: ApprovalChannel[];
  summary: AuthorizationSummary;
  approvalExpiresAt: string;
  authorizationExpiresAt: string;
  previousEventHash?: string | null;
}

export function resolveAuthorizationGateway(
  args: ResolveAuthorizationGatewayArgs,
  deps: ApprovalTransitionDeps,
): ApprovalTransitionResult {
  const events: LedgerEvent[] = [];
  let previousEventHash = args.previousEventHash ?? null;
  const actionDigest = computeActionDigest(args.actionDigestInput, deps.hash);

  function emit<TPayload>(
    aggregateType: "approval" | "authorization",
    aggregateId: string,
    eventType: string,
    actorType: ActorType,
    payload: TPayload,
  ): LedgerEvent<TPayload> {
    const event = makeEvent(
      {
        workspaceId: args.workspaceId,
        aggregateType,
        aggregateId,
        eventType,
        eventVersion: 1,
        schemaVersion: 1,
        actorType,
        runId: args.runId,
        payload,
        previousEventHash,
      },
      deps,
    );
    events.push(event);
    previousEventHash = event.eventHash;
    return event;
  }

  if (args.outcome === "allow") {
    const authorizationId = deps.newId.next("authz");
    emit(
      "authorization",
      authorizationId,
      "AuthorizationIssued",
      "system",
      AuthorizationIssuedPayload.parse({
        authorizationId,
        runId: args.runId,
        decisionId: args.decisionId,
        actionDigest,
        expiresAt: args.authorizationExpiresAt,
        scope: "single_action",
      }),
    );
    return { events, outcome: "issued" };
  }

  if (args.outcome === "require_approval") {
    const approvalId = deps.newId.next("appr");
    emit(
      "approval",
      approvalId,
      "ApprovalRequested",
      "system",
      ApprovalRequestedPayload.parse({
        approvalId,
        runId: args.runId,
        decisionId: args.decisionId,
        policyEvaluationId: args.policyEvaluationId,
        actionDigest,
        channelOptions: args.channelOptions,
        expiresAt: args.approvalExpiresAt,
        summary: {
          instrument: args.summary.instrument,
          action: args.summary.action,
          ...(args.summary.notionalUsdt !== undefined ? { notionalUsdt: args.summary.notionalUsdt } : {}),
          ...(args.summary.leverage !== undefined ? { leverage: args.summary.leverage } : {}),
          policyOutcome: "require_approval",
        },
      }),
    );
    return { events, outcome: "requested" };
  }

  return { events, outcome: "blocked" };
}
