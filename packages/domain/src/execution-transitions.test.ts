import { describe, it, expect } from "vitest";
import { sha256hex } from "@traceguard/event-ledger";
import type {
  AuthorizationConsumedPayload,
  AuthorizationRejectedPayload,
  ExecutionCompletedPayload,
  ExecutionRejectedPayload,
  ExecutionRequestedPayload,
  ExecutionUnknownPayload,
  LedgerEvent,
  RunCompletedPayload,
} from "@traceguard/schemas";
import { fixedClock, sequentialIdGen, sampleWorkspaceId, sampleRunId, sampleDecisionId } from "@traceguard/testing-fixtures";
import type { ExecutionResult } from "./execution-adapter.js";
import { authorizeExecution, settleExecution } from "./execution-transitions.js";

function deps(instant?: string) {
  return { clock: fixedClock(instant), newId: sequentialIdGen(), hash: sha256hex };
}

const validAuthorization = {
  authorizationId: "authz_1",
  actionDigest: "digest_1",
  expiresAt: "2026-06-08T01:00:00.000Z",
  status: "issued" as const,
  approvalId: "appr_1",
};

const allGatesOpen = { workspaceLocked: false, manifestChanged: false, policyChanged: false };
const allPreconditionsOk = { capabilityUnavailable: false, snapshotStale: false, manifestUnapproved: false };

function baseArgs(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: sampleWorkspaceId,
    runId: sampleRunId,
    decisionId: sampleDecisionId,
    authorization: validAuthorization,
    attemptedActionDigest: "digest_1",
    gates: allGatesOpen,
    executionGates: allPreconditionsOk,
    adapterType: "simulator" as const,
    previousEventHash: null,
    ...overrides,
  };
}

describe("authorizeExecution", () => {
  it("burns the authorization: ExecutionRequested then AuthorizationConsumed, returns executing + request", () => {
    const result = authorizeExecution(baseArgs(), deps());
    expect(result.outcome).toBe("executing");
    expect(result.events.map((e) => e.eventType)).toEqual(["ExecutionRequested", "AuthorizationConsumed"]);

    const requested = result.events[0] as LedgerEvent<ExecutionRequestedPayload>;
    expect(requested.aggregateType).toBe("execution");
    expect(requested.actorType).toBe("system");
    expect(requested.payload.authorizationId).toBe("authz_1");
    expect(requested.payload.adapterType).toBe("simulator");
    expect(requested.payload.idempotencyKey).toBe(`execution:${sampleWorkspaceId}:${sampleRunId}:${sampleDecisionId}:digest_1`);

    const consumed = result.events[1] as LedgerEvent<AuthorizationConsumedPayload>;
    expect(consumed.aggregateType).toBe("authorization");
    expect(consumed.payload.executionId).toBe(requested.payload.executionId);
    expect(consumed.payload.approvalId).toBe("appr_1");
    expect(consumed.previousEventHash).toBe(requested.eventHash);

    expect(result.request).toBeDefined();
    expect(result.request?.executionId).toBe(requested.payload.executionId);
    expect(result.request?.requestHash).toBe(requested.payload.requestHash);
  });

  it("denies when the guard fails (already consumed), emitting AuthorizationRejected only", () => {
    const result = authorizeExecution(
      baseArgs({ authorization: { ...validAuthorization, status: "consumed" as const } }),
      deps(),
    );
    expect(result.outcome).toBe("denied");
    expect(result.events.map((e) => e.eventType)).toEqual(["AuthorizationRejected"]);
    const rejected = result.events[0] as LedgerEvent<AuthorizationRejectedPayload>;
    expect(rejected.payload.reasonCode).toBe("already_consumed");
    expect(rejected.payload.expectedActionDigest).toBe("digest_1");
    expect(result.request).toBeUndefined();
  });

  it("denies a missing authorization with reason missing_authorization", () => {
    const result = authorizeExecution(baseArgs({ authorization: undefined }), deps());
    expect(result.outcome).toBe("denied");
    const rejected = result.events[0] as LedgerEvent<AuthorizationRejectedPayload>;
    expect(rejected.payload.reasonCode).toBe("missing_authorization");
  });

  it("rejects (does not burn) when an execution precondition fails", () => {
    const result = authorizeExecution(
      baseArgs({ executionGates: { ...allPreconditionsOk, capabilityUnavailable: true } }),
      deps(),
    );
    expect(result.outcome).toBe("rejected");
    expect(result.events.map((e) => e.eventType)).toEqual(["ExecutionRejected"]);
    const rejected = result.events[0] as LedgerEvent<ExecutionRejectedPayload>;
    expect(rejected.payload.reasonCode).toBe("capability_unavailable");
    expect(rejected.payload.executionSent).toBe(false);
    expect(result.request).toBeUndefined();
  });
});

function settleArgs(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: sampleWorkspaceId,
    runId: sampleRunId,
    decisionId: sampleDecisionId,
    executionId: "exec_1",
    adapterType: "simulator" as const,
    previousEventHash: null,
    ...overrides,
  };
}

describe("settleExecution", () => {
  it("emits ExecutionCompleted then RunCompleted for a completed result", () => {
    const result: ExecutionResult = {
      kind: "completed",
      finalStatus: "simulated",
      receiptRef: "receipt:exec_1",
      receiptHash: "rh_1",
    };
    const out = settleExecution(settleArgs(), result, deps());
    expect(out.outcome).toBe("completed");
    expect(out.events.map((e) => e.eventType)).toEqual(["ExecutionCompleted", "RunCompleted"]);
    const completed = out.events[0] as LedgerEvent<ExecutionCompletedPayload>;
    expect(completed.payload.finalStatus).toBe("simulated");
    expect(completed.payload.receiptRef).toBe("receipt:exec_1");
    const runCompleted = out.events[1] as LedgerEvent<RunCompletedPayload>;
    expect(runCompleted.aggregateType).toBe("run");
    expect(runCompleted.payload.executionId).toBe("exec_1");
    expect(runCompleted.previousEventHash).toBe(completed.eventHash);
  });

  it("emits ExecutionUnknown only for an unknown result (no run closure)", () => {
    const result: ExecutionResult = { kind: "unknown", reasonCode: "provider_status_unavailable" };
    const out = settleExecution(settleArgs({ adapterType: "bitget_live" as const }), result, deps());
    expect(out.outcome).toBe("unknown");
    expect(out.events.map((e) => e.eventType)).toEqual(["ExecutionUnknown"]);
    const unknown = out.events[0] as LedgerEvent<ExecutionUnknownPayload>;
    expect(unknown.payload.adapterType).toBe("bitget_live");
    expect(unknown.payload.reconciliationRequired).toBe(true);
    expect(unknown.payload.retryBlocked).toBe(true);
  });
});
