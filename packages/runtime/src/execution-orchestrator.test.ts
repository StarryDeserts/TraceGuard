import { describe, it, expect } from "vitest";
import {
  InMemoryLedgerStore,
  makeEvent,
  runStatusProjection,
  authorizationProjection,
  verifyChain,
  sha256hex,
  type LedgerStore,
} from "@traceguard/event-ledger";
import { AuthorizationIssuedPayload, type LedgerEvent } from "@traceguard/schemas";
import { ApprovalRevokedPayload } from "@traceguard/schemas";
import type { ExecutionAdapter, ExecutionRequest, ExecutionResult } from "@traceguard/domain";
import {
  fixedClock,
  sequentialIdGen,
  sampleWorkspaceId,
  sampleRunId,
  sampleDecisionId,
  sampleActionDigest,
  crashAdapter,
  fakeLiveAdapter,
} from "@traceguard/testing-fixtures";
import { createSimulatorAdapter } from "./simulator-adapter.js";
import { executionOrchestrator } from "./execution-orchestrator.js";

function makeDeps(store: LedgerStore, adapter = createSimulatorAdapter({ hash: sha256hex })) {
  return { store, adapter, clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

async function seedIssuedAuthorization(store: LedgerStore, options: { approvalId?: string } = {}): Promise<void> {
  const issued = makeEvent(
    {
      workspaceId: sampleWorkspaceId,
      aggregateType: "authorization",
      aggregateId: "authz_seed",
      eventType: "AuthorizationIssued",
      eventVersion: 1,
      schemaVersion: 1,
      actorType: "system",
      runId: sampleRunId,
      payload: AuthorizationIssuedPayload.parse({
        authorizationId: "authz_seed",
        ...(options.approvalId ? { approvalId: options.approvalId } : {}),
        runId: sampleRunId,
        decisionId: sampleDecisionId,
        actionDigest: sampleActionDigest,
        expiresAt: "2026-06-08T01:00:00.000Z",
        scope: "single_action",
      }),
      previousEventHash: null,
    },
    { clock: fixedClock(), newId: sequentialIdGen() },
  );
  await store.append(null, [issued]);
}

function orchestratorArgs(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: sampleWorkspaceId,
    runId: sampleRunId,
    decisionId: sampleDecisionId,
    attemptedActionDigest: sampleActionDigest,
    adapterType: "simulator" as const,
    gates: { workspaceLocked: false, manifestChanged: false, policyChanged: false },
    executionGates: { capabilityUnavailable: false, snapshotStale: false, manifestUnapproved: false },
    ...overrides,
  };
}

describe("executionOrchestrator — golden path", () => {
  it("burns then completes: full event sequence, completed run, consumed authorization", async () => {
    const store = new InMemoryLedgerStore();
    await seedIssuedAuthorization(store);

    const out = await executionOrchestrator(orchestratorArgs(), makeDeps(store));
    expect(out.outcome).toBe("completed");

    const events = await store.read(sampleWorkspaceId, sampleRunId);
    expect(events.map((e) => e.eventType)).toEqual([
      "AuthorizationIssued",
      "ExecutionRequested",
      "AuthorizationConsumed",
      "ExecutionCompleted",
      "RunCompleted",
    ]);
    expect(runStatusProjection(events)).toBe("completed");
    expect(authorizationProjection(events).status).toBe("consumed");
    verifyChain(events, null);
  });

  it("is byte-reproducible across two independent runs", async () => {
    async function run(): Promise<LedgerEvent[]> {
      const store = new InMemoryLedgerStore();
      await seedIssuedAuthorization(store);
      await executionOrchestrator(orchestratorArgs(), makeDeps(store));
      return store.read(sampleWorkspaceId, sampleRunId);
    }
    const first = await run();
    const second = await run();
    expect(second).toEqual(first);
  });
});

function countingSimulator(): ExecutionAdapter & { calls: number } {
  const adapter = {
    adapterType: "simulator" as const,
    calls: 0,
    async call(_request: ExecutionRequest): Promise<ExecutionResult> {
      adapter.calls += 1;
      return { kind: "completed", finalStatus: "simulated", receiptRef: "receipt:x", receiptHash: "rh" };
    },
  };
  return adapter;
}

describe("executionOrchestrator — burn-before-execute crash safety (CRUX)", () => {
  it("persists the burn before the adapter call; a crash leaves AuthorizationConsumed durable", async () => {
    const store = new InMemoryLedgerStore();
    await seedIssuedAuthorization(store);

    const out = await executionOrchestrator(
      orchestratorArgs(),
      { store, adapter: crashAdapter(), clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex },
    );
    expect(out.outcome).toBe("failed");

    const events = await store.read(sampleWorkspaceId, sampleRunId);
    expect(events.map((e) => e.eventType)).toEqual([
      "AuthorizationIssued",
      "ExecutionRequested",
      "AuthorizationConsumed",
      "RunFailed",
    ]);
    expect(authorizationProjection(events).status).toBe("consumed");
    verifyChain(events, null);
  });

  it("re-drive after a crash yields already_consumed and never re-calls the adapter (no replay)", async () => {
    const store = new InMemoryLedgerStore();
    await seedIssuedAuthorization(store);

    // First drive crashes after the burn.
    await executionOrchestrator(
      orchestratorArgs(),
      { store, adapter: crashAdapter(), clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex },
    );

    // Re-drive with a counting adapter — the burn is already durable.
    const adapter = countingSimulator();
    const out = await executionOrchestrator(
      orchestratorArgs(),
      { store, adapter, clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex },
    );

    expect(out.outcome).toBe("denied");
    expect(adapter.calls).toBe(0);
    const events = await store.read(sampleWorkspaceId, sampleRunId);
    const rejected = events.filter((e) => e.eventType === "AuthorizationRejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0]!.payload as { reasonCode: string }).reasonCode).toBe("already_consumed");
    verifyChain(events, null);
  });
});

describe("executionOrchestrator — rejection branches", () => {
  it("denies when there is no authorization to consume", async () => {
    const store = new InMemoryLedgerStore();
    const out = await executionOrchestrator(orchestratorArgs(), makeDeps(store));
    expect(out.outcome).toBe("denied");
    const events = await store.read(sampleWorkspaceId, sampleRunId);
    expect(events.map((e) => e.eventType)).toEqual(["AuthorizationRejected"]);
    expect((events[0]!.payload as { reasonCode: string }).reasonCode).toBe("missing_authorization");
  });

  it("rejects (no burn) when an execution precondition fails", async () => {
    const store = new InMemoryLedgerStore();
    await seedIssuedAuthorization(store);
    const adapter = countingSimulator();
    const out = await executionOrchestrator(
      orchestratorArgs({ executionGates: { capabilityUnavailable: true, snapshotStale: false, manifestUnapproved: false } }),
      { store, adapter, clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex },
    );
    expect(out.outcome).toBe("rejected");
    expect(adapter.calls).toBe(0);
    const events = await store.read(sampleWorkspaceId, sampleRunId);
    expect(events.map((e) => e.eventType)).toEqual(["AuthorizationIssued", "ExecutionRejected"]);
    expect(runStatusProjection(events)).toBe("blocked");
    expect(authorizationProjection(events).status).toBe("issued");
  });
});

describe("executionOrchestrator — live unknown", () => {
  it("burns then records ExecutionUnknown with no run closure", async () => {
    const store = new InMemoryLedgerStore();
    await seedIssuedAuthorization(store);
    const out = await executionOrchestrator(
      orchestratorArgs({ adapterType: "bitget_live" as const }),
      { store, adapter: fakeLiveAdapter(), clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex },
    );
    expect(out.outcome).toBe("unknown");
    const events = await store.read(sampleWorkspaceId, sampleRunId);
    expect(events.map((e) => e.eventType)).toEqual([
      "AuthorizationIssued",
      "ExecutionRequested",
      "AuthorizationConsumed",
      "ExecutionUnknown",
    ]);
    expect(authorizationProjection(events).status).toBe("consumed");
    expect(runStatusProjection(events)).toBe("executing");
  });
});

describe("executionOrchestrator — revocation race", () => {
  it("denies execution once the backing approval is revoked", async () => {
    const store = new InMemoryLedgerStore();
    await seedIssuedAuthorization(store, { approvalId: "appr_1" });

    // Append an ApprovalRevoked for the backing approval.
    const head = await store.head(sampleWorkspaceId);
    const revoked = makeEvent(
      {
        workspaceId: sampleWorkspaceId,
        aggregateType: "approval",
        aggregateId: "appr_1",
        eventType: "ApprovalRevoked",
        eventVersion: 1,
        schemaVersion: 1,
        actorType: "user",
        runId: sampleRunId,
        payload: ApprovalRevokedPayload.parse({ approvalId: "appr_1", revokedAt: "2026-06-08T00:30:00.000Z" }),
        previousEventHash: head,
      },
      { clock: fixedClock(), newId: sequentialIdGen() },
    );
    await store.append(head, [revoked]);

    const adapter = countingSimulator();
    const out = await executionOrchestrator(
      orchestratorArgs(),
      { store, adapter, clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex },
    );
    expect(out.outcome).toBe("denied");
    expect(adapter.calls).toBe(0);
    const events = await store.read(sampleWorkspaceId, sampleRunId);
    const rejected = events.filter((e) => e.eventType === "AuthorizationRejected");
    expect((rejected[0]!.payload as { reasonCode: string }).reasonCode).toBe("missing_authorization");
  });
});
