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
import {
  fixedClock,
  sequentialIdGen,
  sampleWorkspaceId,
  sampleRunId,
  sampleDecisionId,
  sampleActionDigest,
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
