import { describe, it, expect } from "vitest";
import {
  InMemoryLedgerStore,
  approvalProjection,
  runStatusProjection,
  sha256hex,
  verifyChain,
} from "@traceguard/event-ledger";
import type { DecisionEnvelope, Policy, PolicyEvaluatedPayload, RunStatus } from "@traceguard/schemas";
import {
  allowDecisionEnvelope,
  allowPolicy,
  approvalDecisionEnvelope,
  approvalPolicy,
  fixedClock,
  sampleActionDigestInput,
  sampleActorId,
  sampleApprovalChannel,
  sampleApprovalExpiresAt,
  sampleApprovedBy,
  sampleAuthorizationExpiresAt,
  sampleChannelOptions,
  sampleEvaluationContext,
  sampleRejectedBy,
  sampleRunId,
  sampleWorkspaceId,
  sequentialIdGen,
} from "@traceguard/testing-fixtures";
import { proposeDecision } from "./propose-decision.js";
import { resolveAuthorizationGateway, type ApprovalTransitionDeps } from "./authorization-gateway.js";
import { approveApproval, expireApproval, rejectApproval } from "./approval-transitions.js";

function sharedDeps(): ApprovalTransitionDeps {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

function proposeAndResolve(
  envelope: DecisionEnvelope,
  policy: Policy,
  deps: ApprovalTransitionDeps,
  previousEventHash: string | null,
) {
  const proposed = proposeDecision(
    {
      workspaceId: sampleWorkspaceId,
      actorId: sampleActorId,
      envelope,
      policy,
      context: sampleEvaluationContext,
      previousEventHash,
    },
    deps,
  );
  const last = proposed.events.at(-1)!;
  const policyEvaluationId = (last.payload as PolicyEvaluatedPayload).evaluationId;
  const gateway = resolveAuthorizationGateway(
    {
      workspaceId: sampleWorkspaceId,
      runId: sampleRunId,
      decisionId: envelope.id,
      policyEvaluationId,
      outcome: proposed.decision.outcome,
      actionDigestInput: { ...sampleActionDigestInput, decisionId: envelope.id },
      channelOptions: sampleChannelOptions,
      summary: {
        instrument: envelope.instrument,
        action: envelope.action,
        ...(envelope.requestedNotionalUsdt !== undefined ? { notionalUsdt: envelope.requestedNotionalUsdt } : {}),
        ...(envelope.requestedLeverage !== undefined ? { leverage: envelope.requestedLeverage } : {}),
      },
      approvalExpiresAt: sampleApprovalExpiresAt,
      authorizationExpiresAt: sampleAuthorizationExpiresAt,
      previousEventHash: last.eventHash,
    },
    deps,
  );
  return { proposed, gateway, events: [...proposed.events, ...gateway.events] };
}

describe("Phase 1B acceptance", () => {
  it("allow → issues a single-use authorization directly", async () => {
    const store = new InMemoryLedgerStore();
    const expectedHead = await store.head(sampleWorkspaceId);
    const deps = sharedDeps();
    const { proposed, gateway, events } = proposeAndResolve(allowDecisionEnvelope, allowPolicy, deps, expectedHead);
    expect(proposed.decision.outcome).toBe("allow");
    expect(gateway.outcome).toBe("issued");

    await store.append(expectedHead, events);
    const stored = await store.read(sampleWorkspaceId, sampleRunId);
    verifyChain(stored);
    expect(stored.map((e) => e.eventType)).toEqual([
      "DecisionProposed",
      "DecisionValidated",
      "PolicyEvaluationStarted",
      "PolicyEvaluated",
      "AuthorizationIssued",
    ]);
    expect(runStatusProjection(stored) satisfies RunStatus).toBe("allowed");
    const approval = approvalProjection(stored);
    expect(approval.status).toBe("approved");
    expect(approval.authorizationId).toBeDefined();
  });

  it("require_approval → user approves → authorization issued", async () => {
    const store = new InMemoryLedgerStore();
    const expectedHead = await store.head(sampleWorkspaceId);
    const deps = sharedDeps();
    const { proposed, gateway, events: pre } = proposeAndResolve(
      approvalDecisionEnvelope,
      approvalPolicy,
      deps,
      expectedHead,
    );
    expect(proposed.decision.outcome).toBe("require_approval");
    expect(gateway.outcome).toBe("requested");

    const approved = approveApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: approvalProjection(pre),
        approvedBy: sampleApprovedBy,
        approvalChannel: sampleApprovalChannel,
        authorizationExpiresAt: sampleAuthorizationExpiresAt,
        previousEventHash: gateway.events.at(-1)!.eventHash,
      },
      deps,
    );
    expect(approved.outcome).toBe("approved");

    await store.append(expectedHead, [...pre, ...approved.events]);
    const stored = await store.read(sampleWorkspaceId, sampleRunId);
    verifyChain(stored);
    expect(stored.map((e) => e.eventType)).toEqual([
      "DecisionProposed",
      "DecisionValidated",
      "PolicyEvaluationStarted",
      "PolicyEvaluated",
      "ApprovalRequested",
      "ApprovalApproved",
      "AuthorizationIssued",
    ]);
    expect(runStatusProjection(stored) satisfies RunStatus).toBe("approval_required");
    const approval = approvalProjection(stored);
    expect(approval.status).toBe("approved");
    expect(approval.authorizationId).toBeDefined();
    expect(approval.authorizationExpiresAt).toBe(sampleAuthorizationExpiresAt);
  });

  it("require_approval → user rejects → no authorization", async () => {
    const store = new InMemoryLedgerStore();
    const expectedHead = await store.head(sampleWorkspaceId);
    const deps = sharedDeps();
    const { gateway, events: pre } = proposeAndResolve(approvalDecisionEnvelope, approvalPolicy, deps, expectedHead);

    const rejected = rejectApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: approvalProjection(pre),
        rejectedBy: sampleRejectedBy,
        rejectionChannel: sampleApprovalChannel,
        reason: "manual override",
        previousEventHash: gateway.events.at(-1)!.eventHash,
      },
      deps,
    );
    expect(rejected.outcome).toBe("rejected");

    await store.append(expectedHead, [...pre, ...rejected.events]);
    const stored = await store.read(sampleWorkspaceId, sampleRunId);
    verifyChain(stored);
    expect(stored.map((e) => e.eventType)).toEqual([
      "DecisionProposed",
      "DecisionValidated",
      "PolicyEvaluationStarted",
      "PolicyEvaluated",
      "ApprovalRequested",
      "ApprovalRejected",
    ]);
    // 1B does not close the run; a run-lifecycle event (Phase 2) would. Status stays put.
    expect(runStatusProjection(stored) satisfies RunStatus).toBe("approval_required");
    expect(approvalProjection(stored).status).toBe("rejected");
  });

  it("require_approval → deadline lapses → worker expires it", async () => {
    const store = new InMemoryLedgerStore();
    const expectedHead = await store.head(sampleWorkspaceId);
    const deps = sharedDeps();
    const { gateway, events: pre } = proposeAndResolve(approvalDecisionEnvelope, approvalPolicy, deps, expectedHead);

    // Reuse the same id generator + hash, but advance the clock past expiresAt.
    const expireDeps: ApprovalTransitionDeps = {
      clock: fixedClock("2026-06-08T00:10:00.000Z"),
      newId: deps.newId,
      hash: deps.hash,
    };
    const expired = expireApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: approvalProjection(pre),
        previousEventHash: gateway.events.at(-1)!.eventHash,
      },
      expireDeps,
    );
    expect(expired.outcome).toBe("expired");
    expect(expired.events[0]?.payload).toMatchObject({ expiredAt: "2026-06-08T00:10:00.000Z" });

    await store.append(expectedHead, [...pre, ...expired.events]);
    const stored = await store.read(sampleWorkspaceId, sampleRunId);
    verifyChain(stored);
    expect(stored.map((e) => e.eventType)).toEqual([
      "DecisionProposed",
      "DecisionValidated",
      "PolicyEvaluationStarted",
      "PolicyEvaluated",
      "ApprovalRequested",
      "ApprovalExpired",
    ]);
    expect(approvalProjection(stored).status).toBe("expired");
  });
});
