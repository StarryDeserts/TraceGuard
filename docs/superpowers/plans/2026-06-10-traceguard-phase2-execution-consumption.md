# TraceGuard Phase 2 (Execution & Consumption) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the pure single-use authorization guard into a crash-safe execution flow that burns the authorization (persists `AuthorizationConsumed`) *before* calling the adapter, emits the execution result and run-lifecycle closure events, and honours revocation.

**Architecture:** Three new pure transition functions in `@traceguard/domain` (`authorizeExecution`, `settleExecution`) compose the existing `evaluateAuthorizationUse` guard with `makeEvent`. A new `@traceguard/runtime` package owns the only impure piece — `executionOrchestrator` — which reads the ledger, calls `authorizeExecution`, appends the burn batch, then awaits the adapter and calls `settleExecution`. Burn-before-execute means a crash after the burn re-drives to `already_consumed` with no replay. `@traceguard/event-ledger` gains an `authorizationProjection`, extended `runStatusProjection`, and a production `SystemClock`/`SystemIdGen` (reviewer M3).

**Tech Stack:** TypeScript (ESM, NodeNext), Zod, Vitest, pnpm workspaces, project-references tsconfig. Event-sourced append-only ledger with hash-chained events.

---

## Build Order

Schemas → domain → event-ledger → testing-fixtures → runtime → docs. Each task is TDD: write the failing test, run it red, implement minimally, run it green, commit. Run all `pnpm` commands from the repo root `/home/stardust/dev/TraceGuard`.

---

### Task 1: Execution payload schemas

**Files:**
- Create: `packages/schemas/src/execution-payloads.ts`
- Test: `packages/schemas/src/execution-payloads.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/execution-payloads.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ExecutionRequestedPayload,
  ExecutionCompletedPayload,
  ExecutionRejectedPayload,
  ExecutionUnknownPayload,
} from "./execution-payloads.js";

describe("ExecutionRequestedPayload", () => {
  it("accepts a well-formed request and rejects unknown keys", () => {
    const ok = ExecutionRequestedPayload.parse({
      executionId: "exec_1",
      runId: "run_1",
      decisionId: "dec_1",
      authorizationId: "authz_1",
      adapterType: "simulator",
      actionDigest: "digest_1",
      idempotencyKey: "execution:ws_1:run_1:dec_1:digest_1",
      requestRef: "execution:ws_1:run_1:dec_1:digest_1",
      requestHash: "hash_1",
    });
    expect(ok.adapterType).toBe("simulator");
    expect(() => ExecutionRequestedPayload.parse({ ...ok, extra: 1 })).toThrow();
  });

  it("allows authorizationId to be omitted", () => {
    expect(() =>
      ExecutionRequestedPayload.parse({
        executionId: "exec_1",
        runId: "run_1",
        decisionId: "dec_1",
        adapterType: "replay",
        actionDigest: "digest_1",
        idempotencyKey: "k",
        requestRef: "k",
        requestHash: "h",
      }),
    ).not.toThrow();
  });
});

describe("ExecutionCompletedPayload", () => {
  it("requires a final status from the allowed set and an ISO timestamp", () => {
    const ok = ExecutionCompletedPayload.parse({
      executionId: "exec_1",
      runId: "run_1",
      adapterType: "simulator",
      finalStatus: "simulated",
      receiptRef: "receipt:exec_1",
      receiptHash: "rh_1",
      completedAt: "2026-06-08T00:00:00.000Z",
    });
    expect(ok.finalStatus).toBe("simulated");
    expect(() => ExecutionCompletedPayload.parse({ ...ok, finalStatus: "bogus" })).toThrow();
    expect(() => ExecutionCompletedPayload.parse({ ...ok, completedAt: "not-a-time" })).toThrow();
  });
});

describe("ExecutionRejectedPayload", () => {
  it("pins executionSent to false and requires a rejection reason", () => {
    const ok = ExecutionRejectedPayload.parse({
      executionId: "exec_1",
      runId: "run_1",
      decisionId: "dec_1",
      reasonCode: "capability_unavailable",
      executionSent: false,
    });
    expect(ok.executionSent).toBe(false);
    expect(() => ExecutionRejectedPayload.parse({ ...ok, executionSent: true })).toThrow();
  });
});

describe("ExecutionUnknownPayload", () => {
  it("forces live-only reconciliation flags", () => {
    const ok = ExecutionUnknownPayload.parse({
      executionId: "exec_1",
      runId: "run_1",
      adapterType: "bitget_live",
      reasonCode: "timeout_after_submit",
      reconciliationRequired: true,
      retryBlocked: true,
    });
    expect(ok.reconciliationRequired).toBe(true);
    expect(() => ExecutionUnknownPayload.parse({ ...ok, adapterType: "simulator" })).toThrow();
    expect(() => ExecutionUnknownPayload.parse({ ...ok, retryBlocked: false })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test execution-payloads`
Expected: FAIL — cannot find module `./execution-payloads.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/schemas/src/execution-payloads.ts`:

```ts
import { z } from "zod";
import { IsoTimestamp } from "./scalars.js";

export const ExecutionAdapterType = z.enum(["simulator", "bitget_live", "replay"]);
export type ExecutionAdapterType = z.infer<typeof ExecutionAdapterType>;

export const ExecutionFinalStatus = z.enum([
  "simulated",
  "submitted",
  "filled",
  "partially_filled",
  "cancelled",
]);
export type ExecutionFinalStatus = z.infer<typeof ExecutionFinalStatus>;

export const ExecutionRejectionReason = z.enum([
  "policy_blocked",
  "approval_required",
  "authorization_missing",
  "authorization_invalid",
  "capability_unavailable",
  "snapshot_stale",
  "manifest_unapproved",
  "workspace_locked",
]);
export type ExecutionRejectionReason = z.infer<typeof ExecutionRejectionReason>;

export const ExecutionUnknownReason = z.enum([
  "timeout_after_submit",
  "connection_lost_after_submit",
  "provider_status_unavailable",
  "receipt_lookup_failed",
]);
export type ExecutionUnknownReason = z.infer<typeof ExecutionUnknownReason>;

export const ExecutionRequestedPayload = z
  .object({
    executionId: z.string().min(1),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    authorizationId: z.string().min(1).optional(),
    adapterType: ExecutionAdapterType,
    actionDigest: z.string().min(1),
    idempotencyKey: z.string().min(1),
    requestRef: z.string().min(1),
    requestHash: z.string().min(1),
  })
  .strict();
export type ExecutionRequestedPayload = z.infer<typeof ExecutionRequestedPayload>;

export const ExecutionCompletedPayload = z
  .object({
    executionId: z.string().min(1),
    runId: z.string().min(1),
    adapterType: ExecutionAdapterType,
    finalStatus: ExecutionFinalStatus,
    receiptRef: z.string().min(1),
    receiptHash: z.string().min(1),
    upstreamRef: z.string().min(1).optional(),
    completedAt: IsoTimestamp,
  })
  .strict();
export type ExecutionCompletedPayload = z.infer<typeof ExecutionCompletedPayload>;

export const ExecutionRejectedPayload = z
  .object({
    executionId: z.string().min(1).optional(),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    reasonCode: ExecutionRejectionReason,
    executionSent: z.literal(false),
  })
  .strict();
export type ExecutionRejectedPayload = z.infer<typeof ExecutionRejectedPayload>;

export const ExecutionUnknownPayload = z
  .object({
    executionId: z.string().min(1),
    runId: z.string().min(1),
    adapterType: z.literal("bitget_live"),
    reasonCode: ExecutionUnknownReason,
    upstreamRequestId: z.string().min(1).optional(),
    reconciliationRequired: z.literal(true),
    retryBlocked: z.literal(true),
  })
  .strict();
export type ExecutionUnknownPayload = z.infer<typeof ExecutionUnknownPayload>;
```

- [ ] **Step 4: Add the barrel export**

In `packages/schemas/src/index.ts`, add after the `authorization-payloads.js` line:

```ts
export * from "./execution-payloads.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test execution-payloads`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/execution-payloads.ts packages/schemas/src/execution-payloads.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add execution lifecycle payloads"
```

---

### Task 2: Run-lifecycle payload schemas

**Files:**
- Create: `packages/schemas/src/run-payloads.ts`
- Test: `packages/schemas/src/run-payloads.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/run-payloads.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RunCompletedPayload, RunFailedPayload } from "./run-payloads.js";

describe("RunCompletedPayload", () => {
  it("accepts an optional executionId and rejects unknown keys", () => {
    const ok = RunCompletedPayload.parse({
      runId: "run_1",
      completedAt: "2026-06-08T00:00:00.000Z",
      executionId: "exec_1",
    });
    expect(ok.executionId).toBe("exec_1");
    expect(() => RunCompletedPayload.parse({ runId: "run_1", completedAt: "2026-06-08T00:00:00.000Z" })).not.toThrow();
    expect(() => RunCompletedPayload.parse({ ...ok, extra: 1 })).toThrow();
  });
});

describe("RunFailedPayload", () => {
  it("requires a known failure reason and an ISO timestamp", () => {
    const ok = RunFailedPayload.parse({
      runId: "run_1",
      failedAt: "2026-06-08T00:00:00.000Z",
      reasonCode: "orchestrator_error",
    });
    expect(ok.reasonCode).toBe("orchestrator_error");
    expect(() => RunFailedPayload.parse({ ...ok, reasonCode: "other" })).toThrow();
    expect(() => RunFailedPayload.parse({ ...ok, failedAt: "nope" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test run-payloads`
Expected: FAIL — cannot find module `./run-payloads.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/schemas/src/run-payloads.ts`:

```ts
import { z } from "zod";
import { IsoTimestamp } from "./scalars.js";

export const RunCompletedPayload = z
  .object({
    runId: z.string().min(1),
    completedAt: IsoTimestamp,
    executionId: z.string().min(1).optional(),
  })
  .strict();
export type RunCompletedPayload = z.infer<typeof RunCompletedPayload>;

export const RunFailureReason = z.enum(["orchestrator_error"]);
export type RunFailureReason = z.infer<typeof RunFailureReason>;

export const RunFailedPayload = z
  .object({
    runId: z.string().min(1),
    failedAt: IsoTimestamp,
    reasonCode: RunFailureReason,
  })
  .strict();
export type RunFailedPayload = z.infer<typeof RunFailedPayload>;
```

- [ ] **Step 4: Add the barrel export**

In `packages/schemas/src/index.ts`, add after the `execution-payloads.js` line:

```ts
export * from "./run-payloads.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test run-payloads`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/run-payloads.ts packages/schemas/src/run-payloads.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add run completion and failure payloads"
```

---

### Task 3: ApprovalRevokedPayload schema

**Files:**
- Modify: `packages/schemas/src/approval-payloads.ts` (append after line 64, the end of `ApprovalExpiredPayload`)
- Test: `packages/schemas/src/approval-payloads.test.ts` (create if absent, else append)

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/approval-payloads.test.ts` (if it already exists, append the `describe` block):

```ts
import { describe, it, expect } from "vitest";
import { ApprovalRevokedPayload } from "./approval-payloads.js";

describe("ApprovalRevokedPayload", () => {
  it("requires approvalId and a revokedAt timestamp, optional revoker and reason", () => {
    const ok = ApprovalRevokedPayload.parse({
      approvalId: "appr_1",
      revokedBy: "user_1",
      revokedAt: "2026-06-08T00:00:00.000Z",
      reason: "manual stand-down",
    });
    expect(ok.approvalId).toBe("appr_1");
    expect(() => ApprovalRevokedPayload.parse({ approvalId: "appr_1", revokedAt: "2026-06-08T00:00:00.000Z" })).not.toThrow();
    expect(() => ApprovalRevokedPayload.parse({ revokedAt: "2026-06-08T00:00:00.000Z" })).toThrow();
    expect(() => ApprovalRevokedPayload.parse({ ...ok, extra: 1 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test approval-payloads`
Expected: FAIL — `ApprovalRevokedPayload` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/schemas/src/approval-payloads.ts` (after the closing of `ApprovalExpiredPayload`):

```ts
export const ApprovalRevokedPayload = z
  .object({
    approvalId: z.string().min(1),
    revokedBy: z.string().min(1).optional(),
    revokedAt: IsoTimestamp,
    reason: z.string().min(1).optional(),
  })
  .strict();
export type ApprovalRevokedPayload = z.infer<typeof ApprovalRevokedPayload>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test approval-payloads`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/approval-payloads.ts packages/schemas/src/approval-payloads.test.ts
git commit -m "feat(schemas): add approval revocation payload"
```

---

### Task 4: Execution adapter port types

**Files:**
- Create: `packages/domain/src/execution-adapter.ts`
- Modify: `packages/domain/src/index.ts`

These are pure type declarations (the port the orchestrator depends on and adapters implement). There is no runtime behaviour to unit-test here; correctness is enforced by `pnpm typecheck` and the consumers in later tasks.

- [ ] **Step 1: Write the port types**

Create `packages/domain/src/execution-adapter.ts`:

```ts
import type {
  ExecutionAdapterType,
  ExecutionFinalStatus,
  ExecutionUnknownReason,
} from "@traceguard/schemas";

export interface ExecutionRequest {
  executionId: string;
  runId: string;
  decisionId: string;
  authorizationId: string;
  actionDigest: string;
  idempotencyKey: string;
  requestRef: string;
  requestHash: string;
}

export type ExecutionResult =
  | {
      kind: "completed";
      finalStatus: ExecutionFinalStatus;
      receiptRef: string;
      receiptHash: string;
      upstreamRef?: string;
    }
  | {
      kind: "unknown";
      reasonCode: ExecutionUnknownReason;
      upstreamRequestId?: string;
    };

export interface ExecutionAdapter {
  readonly adapterType: ExecutionAdapterType;
  call(request: ExecutionRequest): Promise<ExecutionResult>;
}
```

- [ ] **Step 2: Add the barrel export**

In `packages/domain/src/index.ts`, add:

```ts
export * from "./execution-adapter.js";
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm typecheck` (root script = `tsc --build`; there is no per-package `typecheck` script — `pnpm --filter ... typecheck` is a silent no-op).
Expected: PASS (no type errors across the workspace).

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/execution-adapter.ts packages/domain/src/index.ts
git commit -m "feat(domain): add execution adapter port types"
```

---

### Task 5: authorizeExecution transition (burn batch)

**Files:**
- Create: `packages/domain/src/execution-transitions.ts`
- Test: `packages/domain/src/execution-transitions.test.ts`
- Modify: `packages/domain/src/index.ts`

`authorizeExecution` derives the executionId/idempotencyKey/requestHash up front, runs the pure guard, and returns one of three outcomes: `denied` (guard fails → `AuthorizationRejected`), `rejected` (guard passes but an execution precondition fails → `ExecutionRejected`, executionSent=false), or `executing` (emits `ExecutionRequested` then `AuthorizationConsumed` — the burn batch — and returns the built `ExecutionRequest`).

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/execution-transitions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sha256hex } from "@traceguard/event-ledger";
import type {
  AuthorizationConsumedPayload,
  AuthorizationRejectedPayload,
  ExecutionRejectedPayload,
  ExecutionRequestedPayload,
  LedgerEvent,
} from "@traceguard/schemas";
import { fixedClock, sequentialIdGen, sampleWorkspaceId, sampleRunId, sampleDecisionId } from "@traceguard/testing-fixtures";
import { authorizeExecution } from "./execution-transitions.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test execution-transitions`
Expected: FAIL — cannot find module `./execution-transitions.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/domain/src/execution-transitions.ts`:

```ts
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
```

- [ ] **Step 4: Add the barrel export**

In `packages/domain/src/index.ts`, add:

```ts
export * from "./execution-transitions.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test execution-transitions`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/execution-transitions.ts packages/domain/src/execution-transitions.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): add authorizeExecution burn-batch transition"
```

---

### Task 6: settleExecution transition

**Files:**
- Modify: `packages/domain/src/execution-transitions.ts` (append)
- Modify: `packages/domain/src/execution-transitions.test.ts` (append)

`settleExecution` takes the adapter's `ExecutionResult` and emits the closure events: a `completed` result emits `ExecutionCompleted` + `RunCompleted`; an `unknown` result emits `ExecutionUnknown` only (live-only, reconciliation flagged, no run closure).

- [ ] **Step 1: Write the failing test**

Append to `packages/domain/src/execution-transitions.test.ts`:

```ts
import type { ExecutionResult } from "./execution-adapter.js";
import { settleExecution } from "./execution-transitions.js";
import type { ExecutionCompletedPayload, ExecutionUnknownPayload, RunCompletedPayload } from "@traceguard/schemas";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test execution-transitions`
Expected: FAIL — `settleExecution` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/domain/src/execution-transitions.ts`. First extend the import from `@traceguard/schemas` to also bring in the settle payloads — change the existing import block's named list to include:

```ts
  ExecutionCompletedPayload,
  ExecutionUnknownPayload,
  RunCompletedPayload,
```

Then add the import of the result type alongside the existing `ExecutionRequest` import:

```ts
import type { ExecutionRequest, ExecutionResult } from "./execution-adapter.js";
```

Then append the function and its arg/result types:

```ts
export interface SettleExecutionArgs {
  workspaceId: string;
  runId: string;
  decisionId: string;
  executionId: string;
  adapterType: ExecutionAdapterType;
  previousEventHash?: string | null;
}

export interface SettleExecutionResult {
  events: LedgerEvent[];
  outcome: "completed" | "unknown";
}

export function settleExecution(
  args: SettleExecutionArgs,
  result: ExecutionResult,
  deps: ExecutionTransitionDeps,
): SettleExecutionResult {
  const startHash = args.previousEventHash ?? null;
  const { events, emit } = createEmitter(args.workspaceId, args.runId, deps, startHash);
  const now = deps.clock.now();

  if (result.kind === "completed") {
    emit(
      "execution",
      args.executionId,
      "ExecutionCompleted",
      "system",
      ExecutionCompletedPayload.parse({
        executionId: args.executionId,
        runId: args.runId,
        adapterType: args.adapterType,
        finalStatus: result.finalStatus,
        receiptRef: result.receiptRef,
        receiptHash: result.receiptHash,
        ...(result.upstreamRef ? { upstreamRef: result.upstreamRef } : {}),
        completedAt: now,
      }),
    );
    emit(
      "run",
      args.runId,
      "RunCompleted",
      "system",
      RunCompletedPayload.parse({ runId: args.runId, completedAt: now, executionId: args.executionId }),
    );
    return { events, outcome: "completed" };
  }

  emit(
    "execution",
    args.executionId,
    "ExecutionUnknown",
    "system",
    ExecutionUnknownPayload.parse({
      executionId: args.executionId,
      runId: args.runId,
      adapterType: "bitget_live",
      reasonCode: result.reasonCode,
      ...(result.upstreamRequestId ? { upstreamRequestId: result.upstreamRequestId } : {}),
      reconciliationRequired: true,
      retryBlocked: true,
    }),
  );
  return { events, outcome: "unknown" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test execution-transitions`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/execution-transitions.ts packages/domain/src/execution-transitions.test.ts
git commit -m "feat(domain): add settleExecution closure transition"
```

---

### Task 7: authorizationProjection

**Files:**
- Create: `packages/event-ledger/src/authorization-projection.ts`
- Test: `packages/event-ledger/src/authorization-projection.test.ts`
- Modify: `packages/event-ledger/src/index.ts`

Folds an event stream into the live authorization state the orchestrator feeds to the guard. `AuthorizationIssued` records the id/digest/expiry/approvalId and marks issued; `AuthorizationConsumed` (only after issued) → `consumed`; `ApprovalRevoked` whose `approvalId` matches the issued authorization → `revoked`.

- [ ] **Step 1: Write the failing test**

Create `packages/event-ledger/src/authorization-projection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { LedgerEvent } from "@traceguard/schemas";
import { authorizationProjection } from "./authorization-projection.js";

function ev(eventType: string, payload: unknown): LedgerEvent {
  return {
    id: `evt_${eventType}`,
    workspaceId: "ws_1",
    aggregateType: "authorization",
    aggregateId: "authz_1",
    eventType,
    eventVersion: 1,
    schemaVersion: 1,
    occurredAt: "2026-06-08T00:00:00.000Z",
    recordedAt: "2026-06-08T00:00:00.000Z",
    actorType: "system",
    payload,
    payloadHash: "ph",
    eventHash: `eh_${eventType}`,
  };
}

const issued = ev("AuthorizationIssued", {
  authorizationId: "authz_1",
  approvalId: "appr_1",
  actionDigest: "digest_1",
  expiresAt: "2026-06-08T01:00:00.000Z",
});

describe("authorizationProjection", () => {
  it("defaults to issued with no fields when the stream is empty", () => {
    const view = authorizationProjection([]);
    expect(view.status).toBe("issued");
    expect(view.authorizationId).toBeUndefined();
  });

  it("records issued fields", () => {
    const view = authorizationProjection([issued]);
    expect(view).toMatchObject({
      status: "issued",
      authorizationId: "authz_1",
      actionDigest: "digest_1",
      expiresAt: "2026-06-08T01:00:00.000Z",
      approvalId: "appr_1",
    });
  });

  it("marks consumed after AuthorizationConsumed", () => {
    const consumed = ev("AuthorizationConsumed", { authorizationId: "authz_1" });
    expect(authorizationProjection([issued, consumed]).status).toBe("consumed");
  });

  it("ignores a consumed event with no prior issue", () => {
    const consumed = ev("AuthorizationConsumed", { authorizationId: "authz_1" });
    expect(authorizationProjection([consumed]).status).toBe("issued");
  });

  it("marks revoked when a matching ApprovalRevoked arrives", () => {
    const revoked = ev("ApprovalRevoked", { approvalId: "appr_1", revokedAt: "2026-06-08T00:30:00.000Z" });
    expect(authorizationProjection([issued, revoked]).status).toBe("revoked");
  });

  it("ignores a non-matching ApprovalRevoked", () => {
    const revoked = ev("ApprovalRevoked", { approvalId: "appr_other", revokedAt: "2026-06-08T00:30:00.000Z" });
    expect(authorizationProjection([issued, revoked]).status).toBe("issued");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test authorization-projection`
Expected: FAIL — cannot find module `./authorization-projection.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/event-ledger/src/authorization-projection.ts`:

```ts
import type { LedgerEvent } from "@traceguard/schemas";

export interface AuthorizationView {
  authorizationId?: string;
  actionDigest?: string;
  expiresAt?: string;
  approvalId?: string;
  status: "issued" | "consumed" | "revoked";
}

function readString(payload: unknown, key: string): string | undefined {
  if (payload !== null && typeof payload === "object" && key in payload) {
    const value = (payload as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

export function authorizationProjection(events: LedgerEvent[]): AuthorizationView {
  const view: AuthorizationView = { status: "issued" };
  let issued = false;
  for (const e of events) {
    switch (e.eventType) {
      case "AuthorizationIssued": {
        issued = true;
        view.status = "issued";
        const authorizationId = readString(e.payload, "authorizationId");
        const actionDigest = readString(e.payload, "actionDigest");
        const expiresAt = readString(e.payload, "expiresAt");
        const approvalId = readString(e.payload, "approvalId");
        if (authorizationId !== undefined) view.authorizationId = authorizationId;
        if (actionDigest !== undefined) view.actionDigest = actionDigest;
        if (expiresAt !== undefined) view.expiresAt = expiresAt;
        if (approvalId !== undefined) view.approvalId = approvalId;
        break;
      }
      case "AuthorizationConsumed":
        if (issued) view.status = "consumed";
        break;
      case "ApprovalRevoked":
        if (issued && readString(e.payload, "approvalId") === view.approvalId) {
          view.status = "revoked";
        }
        break;
      default:
        break;
    }
  }
  return view;
}
```

- [ ] **Step 4: Add the barrel export**

In `packages/event-ledger/src/index.ts`, add:

```ts
export * from "./authorization-projection.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test authorization-projection`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/event-ledger/src/authorization-projection.ts packages/event-ledger/src/authorization-projection.test.ts packages/event-ledger/src/index.ts
git commit -m "feat(event-ledger): add authorization projection fold"
```

---

### Task 8: Extend runStatusProjection with execution & run-lifecycle events

**Files:**
- Modify: `packages/event-ledger/src/run-status-projection.ts` (add cases to the switch)
- Test: `packages/event-ledger/src/run-status-projection.test.ts` (append; create if absent)

New transitions: `ExecutionRequested` → `executing`, `ExecutionCompleted` → `completed`, `ExecutionRejected` → `blocked`, `ExecutionUnknown` → `executing`, `RunCompleted` → `completed`, `RunFailed` → `failed`, `ApprovalRevoked` → `blocked`.

- [ ] **Step 1: Write the failing test**

Append to `packages/event-ledger/src/run-status-projection.test.ts` (if the file does not exist, create it with this content and the import shown):

```ts
import { describe, it, expect } from "vitest";
import type { LedgerEvent } from "@traceguard/schemas";
import { runStatusProjection } from "./run-status-projection.js";

function ev(eventType: string, payload: unknown = {}): LedgerEvent {
  return {
    id: `evt_${eventType}`,
    workspaceId: "ws_1",
    aggregateType: "run",
    aggregateId: "run_1",
    eventType,
    eventVersion: 1,
    schemaVersion: 1,
    occurredAt: "2026-06-08T00:00:00.000Z",
    recordedAt: "2026-06-08T00:00:00.000Z",
    actorType: "system",
    payload,
    payloadHash: "ph",
    eventHash: `eh_${eventType}`,
  };
}

describe("runStatusProjection — execution lifecycle", () => {
  it("moves to executing on ExecutionRequested", () => {
    expect(runStatusProjection([ev("ExecutionRequested")])).toBe("executing");
  });
  it("moves to completed on ExecutionCompleted then RunCompleted", () => {
    expect(runStatusProjection([ev("ExecutionRequested"), ev("ExecutionCompleted"), ev("RunCompleted")])).toBe("completed");
  });
  it("moves to blocked on ExecutionRejected", () => {
    expect(runStatusProjection([ev("ExecutionRejected")])).toBe("blocked");
  });
  it("stays executing on ExecutionUnknown", () => {
    expect(runStatusProjection([ev("ExecutionRequested"), ev("ExecutionUnknown")])).toBe("executing");
  });
  it("moves to failed on RunFailed", () => {
    expect(runStatusProjection([ev("ExecutionRequested"), ev("RunFailed")])).toBe("failed");
  });
  it("moves to blocked on ApprovalRevoked", () => {
    expect(runStatusProjection([ev("ApprovalRequested"), ev("ApprovalRevoked")])).toBe("blocked");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test run-status-projection`
Expected: FAIL — e.g. `ExecutionRequested` falls through to the default and the status assertion fails.

- [ ] **Step 3: Write minimal implementation**

In `packages/event-ledger/src/run-status-projection.ts`, add these cases inside the `switch (e.eventType)` block, immediately before `default:`:

```ts
      case "ExecutionRequested":
        status = "executing";
        break;
      case "ExecutionUnknown":
        status = "executing";
        break;
      case "ExecutionRejected":
        status = "blocked";
        break;
      case "ExecutionCompleted":
        status = "completed";
        break;
      case "RunCompleted":
        status = "completed";
        break;
      case "RunFailed":
        status = "failed";
        break;
      case "ApprovalRevoked":
        status = "blocked";
        break;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test run-status-projection`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/event-ledger/src/run-status-projection.ts packages/event-ledger/src/run-status-projection.test.ts
git commit -m "feat(event-ledger): project execution and run-lifecycle events into run status"
```

---

### Task 9: SystemClock and SystemIdGen (reviewer M3)

**Files:**
- Create: `packages/event-ledger/src/system-clock.ts`
- Test: `packages/event-ledger/src/system-clock.test.ts`
- Modify: `packages/event-ledger/src/index.ts`

Production implementations of the `Clock`/`IdGen` ports: a UTC ISO-8601 clock and a UUID-suffixed id generator. These are the impure defaults the orchestrator uses outside tests.

- [ ] **Step 1: Write the failing test**

Create `packages/event-ledger/src/system-clock.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { IsoTimestamp } from "@traceguard/schemas";
import { SystemClock, SystemIdGen } from "./system-clock.js";

describe("SystemClock", () => {
  it("returns a valid ISO-8601 UTC instant", () => {
    const now = new SystemClock().now();
    expect(() => IsoTimestamp.parse(now)).not.toThrow();
  });
});

describe("SystemIdGen", () => {
  it("prefixes ids and never repeats", () => {
    const gen = new SystemIdGen();
    const a = gen.next("exec");
    const b = gen.next("exec");
    expect(a.startsWith("exec_")).toBe(true);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test system-clock`
Expected: FAIL — cannot find module `./system-clock.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/event-ledger/src/system-clock.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Clock, IdGen } from "./clock-id.js";

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class SystemIdGen implements IdGen {
  next(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }
}
```

- [ ] **Step 4: Add the barrel export**

In `packages/event-ledger/src/index.ts`, add:

```ts
export * from "./system-clock.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test system-clock`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/event-ledger/src/system-clock.ts packages/event-ledger/src/system-clock.test.ts packages/event-ledger/src/index.ts
git commit -m "feat(event-ledger): add production SystemClock and SystemIdGen"
```

---

### Task 10: Execution test fixtures (samples + fake-live + crash adapters)

**Files:**
- Create: `packages/testing-fixtures/src/execution-samples.ts`
- Test: `packages/testing-fixtures/src/execution-samples.test.ts`
- Modify: `packages/testing-fixtures/src/index.ts`

Provides shared sample constants plus two test-only adapters: `fakeLiveAdapter` (always returns an `unknown` result, advertising `adapterType: "bitget_live"`) and `crashAdapter` (throws — used by the burn-before-execute crux). These are plain shapes structurally compatible with the domain `ExecutionAdapter` port; testing-fixtures depends only on `@traceguard/schemas`, so we import the reason type from there and keep the adapters duck-typed.

- [ ] **Step 1: Write the failing test**

Create `packages/testing-fixtures/src/execution-samples.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fakeLiveAdapter, crashAdapter, sampleExecutionId } from "./execution-samples.js";

describe("fakeLiveAdapter", () => {
  it("advertises bitget_live and returns an unknown result", async () => {
    const adapter = fakeLiveAdapter();
    expect(adapter.adapterType).toBe("bitget_live");
    const result = await adapter.call();
    expect(result).toEqual({ kind: "unknown", reasonCode: "provider_status_unavailable" });
  });

  it("honours a custom reason code", async () => {
    const result = await fakeLiveAdapter("timeout_after_submit").call();
    expect(result).toEqual({ kind: "unknown", reasonCode: "timeout_after_submit" });
  });
});

describe("crashAdapter", () => {
  it("advertises simulator and throws on call", async () => {
    const adapter = crashAdapter();
    expect(adapter.adapterType).toBe("simulator");
    await expect(adapter.call()).rejects.toThrow("adapter crashed after burn");
  });
});

describe("samples", () => {
  it("exposes a stable execution id", () => {
    expect(sampleExecutionId).toBe("exec_000001");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test execution-samples`
Expected: FAIL — cannot find module `./execution-samples.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/testing-fixtures/src/execution-samples.ts`:

```ts
import type { ExecutionUnknownReason } from "@traceguard/schemas";

export const sampleExecutionId = "exec_000001";
export const sampleReceiptRef = "receipt:exec_000001";
export const sampleReceiptHash = "rh_000001";
export const sampleCompletedAt = "2026-06-08T00:00:00.000Z";
export const sampleActionDigest = "digest_exec";

export function fakeLiveAdapter(reasonCode: ExecutionUnknownReason = "provider_status_unavailable") {
  return {
    adapterType: "bitget_live" as const,
    call: async (): Promise<{ kind: "unknown"; reasonCode: ExecutionUnknownReason }> => ({
      kind: "unknown",
      reasonCode,
    }),
  };
}

export function crashAdapter(message = "adapter crashed after burn") {
  return {
    adapterType: "simulator" as const,
    call: async (): Promise<never> => {
      throw new Error(message);
    },
  };
}
```

- [ ] **Step 4: Add the barrel export**

In `packages/testing-fixtures/src/index.ts`, add:

```ts
export * from "./execution-samples.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test execution-samples`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/testing-fixtures/src/execution-samples.ts packages/testing-fixtures/src/execution-samples.test.ts packages/testing-fixtures/src/index.ts
git commit -m "test(testing-fixtures): add execution samples and fake-live/crash adapters"
```

---

### Task 11: Scaffold the @traceguard/runtime package

**Files:**
- Create: `packages/runtime/package.json`
- Create: `packages/runtime/tsconfig.json`
- Modify: `tsconfig.json` (root — add the project reference)

This task wires an empty package into the workspace so later tasks can add source. No tests yet; the gate is `pnpm install` succeeding and the workspace recognising the package. No per-package `vitest.config.ts` is needed: every sibling package (domain, event-ledger, testing-fixtures, policy-engine) relies on the single root `vitest.config.ts`, whose `include` glob (`packages/*/src/**/*.test.ts`) already covers `packages/runtime`.

- [ ] **Step 1: Create `packages/runtime/package.json`**

```json
{
  "name": "@traceguard/runtime",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@traceguard/domain": "workspace:*",
    "@traceguard/event-ledger": "workspace:*",
    "@traceguard/schemas": "workspace:*"
  },
  "devDependencies": { "@traceguard/testing-fixtures": "workspace:*" }
}
```

- [ ] **Step 2: Create `packages/runtime/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [
    { "path": "../schemas" },
    { "path": "../event-ledger" },
    { "path": "../domain" },
    { "path": "../testing-fixtures" }
  ]
}
```

- [ ] **Step 3: Add the root project reference**

In the root `tsconfig.json`, add to the `references` array (after the `domain` entry):

```json
    { "path": "./packages/runtime" }
```

- [ ] **Step 4: Install and verify the workspace resolves the package**

Run: `pnpm install`
Expected: completes; `@traceguard/runtime` linked into the workspace.

Run: `pnpm --filter @traceguard/runtime exec true`
Expected: exits 0 (the filter matches the new package).

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/package.json packages/runtime/tsconfig.json tsconfig.json pnpm-lock.yaml
git commit -m "chore(runtime): scaffold execution runtime package"
```

---

### Task 12: SimulatorAdapter

**Files:**
- Create: `packages/runtime/src/simulator-adapter.ts`
- Create: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/simulator-adapter.test.ts`

The simulator is the default in-process adapter: it never touches a venue, deterministically derives a receipt from the request, and always returns a `completed` result with `finalStatus: "simulated"`.

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/src/simulator-adapter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sha256hex } from "@traceguard/event-ledger";
import type { ExecutionRequest } from "@traceguard/domain";
import { createSimulatorAdapter } from "./simulator-adapter.js";

const request: ExecutionRequest = {
  executionId: "exec_1",
  runId: "run_1",
  decisionId: "dec_1",
  authorizationId: "authz_1",
  actionDigest: "digest_1",
  idempotencyKey: "k",
  requestRef: "k",
  requestHash: "rh_1",
};

describe("createSimulatorAdapter", () => {
  it("returns a deterministic simulated completion", async () => {
    const adapter = createSimulatorAdapter({ hash: sha256hex });
    expect(adapter.adapterType).toBe("simulator");
    const a = await adapter.call(request);
    const b = await adapter.call(request);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ kind: "completed", finalStatus: "simulated", receiptRef: "receipt:exec_1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test simulator-adapter`
Expected: FAIL — cannot find module `./simulator-adapter.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/runtime/src/simulator-adapter.ts`:

```ts
import type { ExecutionAdapter, ExecutionRequest, ExecutionResult } from "@traceguard/domain";

export function createSimulatorAdapter(deps: { hash: (s: string) => string }): ExecutionAdapter {
  return {
    adapterType: "simulator",
    async call(request: ExecutionRequest): Promise<ExecutionResult> {
      const receiptRef = `receipt:${request.executionId}`;
      const receiptHash = deps.hash(`receipt:${request.executionId}:${request.requestHash}`);
      return { kind: "completed", finalStatus: "simulated", receiptRef, receiptHash };
    },
  };
}
```

Create `packages/runtime/src/index.ts`:

```ts
export * from "./simulator-adapter.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test simulator-adapter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/simulator-adapter.ts packages/runtime/src/index.ts packages/runtime/src/simulator-adapter.test.ts
git commit -m "feat(runtime): add in-process simulator adapter"
```

---

### Task 13: executionOrchestrator — golden path

**Files:**
- Create: `packages/runtime/src/execution-orchestrator.ts`
- Test: `packages/runtime/src/execution-orchestrator.test.ts`
- Modify: `packages/runtime/src/index.ts`

The orchestrator is the only impure composition: read the ledger → project the authorization → `authorizeExecution` → **append the burn batch** → `await adapter.call` → `settleExecution` → append the closure. On `denied`/`rejected` it appends the single rejection event and stops. On an adapter throw it appends `RunFailed` and returns `failed`. The burn is persisted before the adapter is awaited — this is the crash-safety crux exercised in Task 14.

This task implements the orchestrator and proves the golden path (valid authorization + simulator → completed run) plus byte-reproducibility.

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/src/execution-orchestrator.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test execution-orchestrator`
Expected: FAIL — cannot find module `./execution-orchestrator.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/runtime/src/execution-orchestrator.ts`:

```ts
import {
  authorizeExecution,
  settleExecution,
  type ExecutionAdapter,
  type ExecutionResult,
  type ExecutionTransitionDeps,
} from "@traceguard/domain";
import { authorizationProjection, makeEvent, type LedgerStore } from "@traceguard/event-ledger";
import { RunFailedPayload, type ExecutionAdapterType } from "@traceguard/schemas";

export interface ExecutionOrchestratorArgs {
  workspaceId: string;
  runId: string;
  decisionId: string;
  attemptedActionDigest: string;
  adapterType: ExecutionAdapterType;
  gates: { workspaceLocked: boolean; manifestChanged: boolean; policyChanged: boolean };
  executionGates: { capabilityUnavailable: boolean; snapshotStale: boolean; manifestUnapproved: boolean };
}

export interface ExecutionOrchestratorDeps extends ExecutionTransitionDeps {
  store: LedgerStore;
  adapter: ExecutionAdapter;
}

export type ExecutionOrchestratorOutcome = "denied" | "rejected" | "completed" | "unknown" | "failed";

export async function executionOrchestrator(
  args: ExecutionOrchestratorArgs,
  deps: ExecutionOrchestratorDeps,
): Promise<{ outcome: ExecutionOrchestratorOutcome }> {
  const transitionDeps: ExecutionTransitionDeps = { clock: deps.clock, newId: deps.newId, hash: deps.hash };
  const events = await deps.store.read(args.workspaceId, args.runId);
  const head = await deps.store.head(args.workspaceId);
  const view = authorizationProjection(events);

  const authorization =
    view.authorizationId && view.actionDigest && view.expiresAt
      ? {
          authorizationId: view.authorizationId,
          actionDigest: view.actionDigest,
          expiresAt: view.expiresAt,
          status: view.status,
          ...(view.approvalId ? { approvalId: view.approvalId } : {}),
        }
      : undefined;

  const auth = authorizeExecution(
    {
      workspaceId: args.workspaceId,
      runId: args.runId,
      decisionId: args.decisionId,
      ...(authorization ? { authorization } : {}),
      attemptedActionDigest: args.attemptedActionDigest,
      gates: args.gates,
      executionGates: args.executionGates,
      adapterType: args.adapterType,
      previousEventHash: head,
    },
    transitionDeps,
  );

  if (auth.outcome === "denied" || auth.outcome === "rejected") {
    await deps.store.append(head, auth.events);
    return { outcome: auth.outcome };
  }

  // BURN BEFORE EXECUTE: persist ExecutionRequested + AuthorizationConsumed before any adapter call.
  await deps.store.append(head, auth.events);
  const burnHead = auth.events[auth.events.length - 1]!.eventHash;

  let result: ExecutionResult;
  try {
    result = await deps.adapter.call(auth.request!);
  } catch {
    const failed = makeEvent(
      {
        workspaceId: args.workspaceId,
        aggregateType: "run",
        aggregateId: args.runId,
        eventType: "RunFailed",
        eventVersion: 1,
        schemaVersion: 1,
        actorType: "system",
        runId: args.runId,
        payload: RunFailedPayload.parse({
          runId: args.runId,
          failedAt: deps.clock.now(),
          reasonCode: "orchestrator_error",
        }),
        previousEventHash: burnHead,
      },
      transitionDeps,
    );
    await deps.store.append(burnHead, [failed]);
    return { outcome: "failed" };
  }

  const settle = settleExecution(
    {
      workspaceId: args.workspaceId,
      runId: args.runId,
      decisionId: args.decisionId,
      executionId: auth.request!.executionId,
      adapterType: args.adapterType,
      previousEventHash: burnHead,
    },
    result,
    transitionDeps,
  );
  await deps.store.append(burnHead, settle.events);
  return { outcome: settle.outcome };
}
```

Add to `packages/runtime/src/index.ts`:

```ts
export * from "./execution-orchestrator.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test execution-orchestrator`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/execution-orchestrator.ts packages/runtime/src/index.ts packages/runtime/src/execution-orchestrator.test.ts
git commit -m "feat(runtime): add execution orchestrator golden path"
```

---

### Task 14: executionOrchestrator — crux & branch integration tests

**Files:**
- Modify: `packages/runtime/src/execution-orchestrator.test.ts` (append)

The crux: **burn-before-execute crash safety.** When the adapter throws after the burn, the consumed authorization is already durable; re-driving the orchestrator yields `already_consumed` with no second adapter call (no replay). This task also covers the `denied` (missing authorization), `rejected` (precondition), `unknown` (fake-live), and revocation-race branches.

- [ ] **Step 1: Write the failing tests**

Append to `packages/runtime/src/execution-orchestrator.test.ts`. First extend the existing imports at the top of the file:

- add to the `@traceguard/testing-fixtures` import list: `crashAdapter`, `fakeLiveAdapter`.
- add these new import lines:

```ts
import { ApprovalRevokedPayload } from "@traceguard/schemas";
import type { ExecutionAdapter, ExecutionRequest, ExecutionResult } from "@traceguard/domain";
```

Then append these suites:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail (then pass)**

Because the orchestrator is already implemented (Task 13), these integration tests should mostly pass on first run — but run them to confirm the crux holds:

Run: `pnpm test execution-orchestrator`
Expected: All suites PASS. If the re-drive test fails with `adapter.calls === 1`, the burn was not persisted before the adapter call — fix the ordering in `execution-orchestrator.ts` (append must `await` before `adapter.call`).

- [ ] **Step 3: Run the whole workspace test suite & typecheck**

Run: `pnpm test`
Expected: all packages green.

Run: `pnpm typecheck`
Expected: no type errors across the workspace.

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/src/execution-orchestrator.test.ts
git commit -m "test(runtime): cover burn-before-execute crash safety and rejection branches"
```

---

### Task 15: Sync docs/event-model.md

**Files:**
- Modify: `docs/event-model.md`

Bring the canonical event-model doc into coherence with the new payloads and projection transitions. This is prose/markdown — read the file directly with the Read tool (codegraph does not index markdown).

- [ ] **Step 1: Locate the payload-catalogue section and the run-status transition table**

Run: `grep -n "^### 6\." docs/event-model.md` to find the next free §6.x heading number for new payload entries.
Run: `grep -n "8.1\|run status\|RunStatus\|state machine" docs/event-model.md` to find the run-status transition table (§8.1 per the spec).

Read the surrounding lines with the Read tool to match the existing table format (column headers, field-row style) used by the Phase 1A/1B payload entries.

- [ ] **Step 2: Add payload-catalogue entries**

Under the §6 payload catalogue, append entries that match the existing table style for each new payload. Cover, at minimum, the field name / type / required / notes columns the existing entries use:

- **ExecutionRequestedPayload** — `executionId`, `runId`, `decisionId`, `authorizationId?`, `adapterType` (simulator | bitget_live | replay), `actionDigest`, `idempotencyKey`, `requestRef`, `requestHash`.
- **ExecutionCompletedPayload** — `executionId`, `runId`, `adapterType`, `finalStatus` (simulated | submitted | filled | partially_filled | cancelled), `receiptRef`, `receiptHash`, `upstreamRef?`, `completedAt`.
- **ExecutionRejectedPayload** — `executionId?`, `runId`, `decisionId`, `reasonCode` (policy_blocked | approval_required | authorization_missing | authorization_invalid | capability_unavailable | snapshot_stale | manifest_unapproved | workspace_locked), `executionSent` (always false).
- **ExecutionUnknownPayload** — `executionId`, `runId`, `adapterType` (bitget_live only), `reasonCode` (timeout_after_submit | connection_lost_after_submit | provider_status_unavailable | receipt_lookup_failed), `upstreamRequestId?`, `reconciliationRequired` (true), `retryBlocked` (true).
- **RunCompletedPayload** — `runId`, `completedAt`, `executionId?`.
- **RunFailedPayload** — `runId`, `failedAt`, `reasonCode` (orchestrator_error).
- **ApprovalRevokedPayload** — `approvalId`, `revokedBy?`, `revokedAt`, `reason?` (actor recorded on the event envelope, not the payload).

- [ ] **Step 3: Update the run-status transition table (§8.1)**

Add the rows that mirror Task 8's projection:

- `ExecutionRequested` → `executing`
- `ExecutionUnknown` → `executing`
- `ExecutionRejected` → `blocked`
- `ExecutionCompleted` → `completed`
- `RunCompleted` → `completed`
- `RunFailed` → `failed`
- `ApprovalRevoked` → `blocked`

- [ ] **Step 4: Verify coherence**

Re-read the edited sections with the Read tool. Confirm: every payload field listed matches the Zod schema in `packages/schemas/src` (names, optionality, enum members), and every transition row matches a `case` in `run-status-projection.ts`. Fix any drift.

- [ ] **Step 5: Commit**

```bash
git add docs/event-model.md
git commit -m "docs(event-model): document Phase 2 execution and run-lifecycle events"
```

---

## Final Verification

After all 15 tasks:

- [ ] Run `pnpm test` — entire workspace green.
- [ ] Run `pnpm typecheck` — no errors.
- [ ] Run `pnpm lint` (if configured) — clean.
- [ ] Confirm the crux test (`re-drive after a crash yields already_consumed and never re-calls the adapter`) passes — this is the Phase 2 acceptance gate.
- [ ] Review `git log --oneline` for the 13 expected commits (Tasks 1–15; Task 4 and Task 11 produce scaffolding commits).

**Git constraint: commit locally only. Do NOT push.**





