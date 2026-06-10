# TraceGuard — Phase 2: Execution & Consumption Design

- **Status:** Approved (design), ready for implementation planning
- **Date:** 2026-06-10
- **Scope:** Phase 2 — the execution / consumption path deferred from Phase 1B. Wire the pure
  single-use guard (`evaluateAuthorizationUse`) into a real execution flow that **burns** a
  single-use authorization (`AuthorizationConsumed`) before performing the effect, records the
  execution result (`ExecutionRequested` / `ExecutionCompleted` / `ExecutionRejected` /
  `ExecutionUnknown`), supports operator revocation (`ApprovalRevoked`), closes the run
  (`RunCompleted` / `RunFailed`), and ships a production `Clock` / `IdGen` (reviewer finding M3).
- **Source of truth:** `docs/architecture.md`, `docs/event-model.md`, `docs/policy-semantics.md`.
  Where this spec restates a canonical type or rule, the canonical doc wins; section
  references (e.g. event-model §6.26) are given so drift can be detected.
- **Builds on:** Spec 1A + 1B (merged). Phase 2 reuses the functional-core / imperative-shell
  split, injected `clock` / `newId` / `hash` dependencies, hash-chained `makeEvent`, the
  `LedgerStore` port, `evaluateAuthorizationUse`, and the `approvalProjection` —
  all unchanged.

---

## 1. Context and goal

TraceGuard's central invariant is `Proposal ≠ Authorization ≠ Execution`: an agent's output is
**evidence, not authority**; the system is **fail-closed / default-deny**. Spec 1A classified a
proposed action (allow / require_approval / block). Spec 1B turned that outcome into a
**single-use execution authorization** (`AuthorizationIssued`) and shipped the **pure guard**
`evaluateAuthorizationUse` that decides whether a grant may be consumed — but 1B deliberately
stopped before *consuming* it. The guard today has **zero callers**: it is a correct, tested,
pure island.

Phase 2 delivers the final link: **consuming** that authorization exactly once to drive a real
(initially simulated) execution, recorded as immutable events. Its defining safety property is
**burn-before-execute** — the single-use authorization is marked `AuthorizationConsumed` in the
ledger **before** the effectful adapter call is awaited, so that a crash, timeout, or thrown
error mid-execution can never replay the order: on any retry the guard sees `consumed` and
refuses.

### 1.1 Exit criterion

> A valid single-use authorization is consumed exactly once to drive an execution: the
> consumption is persisted **before** the effect is attempted; a completed effect closes the
> run; an uncertain live effect parks the run in a held / reconciliation-required state without
> replay; a denied or pre-flight-vetoed attempt records a refusal without burning the grant; an
> operator may revoke an authorization before it is consumed; and the whole sequence is an
> immutable, hash-chained, byte-reproducible event stream driven by a production clock.

Phase 2 is "done" when an executable acceptance test demonstrates the simulator golden path
end-to-end, a **crash-after-burn** test proves no replay, plus the denied / rejected / unknown /
revoked paths — all with a verified hash chain and byte snapshot.

### 1.2 Reviewer findings addressed

| # | Finding | Phase 2 |
|---|---------|---------|
| M3 | No production `Clock` / `IdGen`; only test doubles implement the ports | ✅ `SystemClock` + `SystemIdGen` (§9), wired only in the orchestrator composition root |

---

## 2. Scope

### 2.1 In scope (Phase 2)

- `schemas`: the four execution payloads (`ExecutionRequested`, `ExecutionCompleted`,
  `ExecutionRejected`, `ExecutionUnknown`) per event-model §6.26–6.29; the two run-lifecycle
  payloads (`RunCompleted`, `RunFailed`) whose **event types** are canonical (event-model §line
  299, §8.1) but whose **payload interfaces** the doc never defined; and `ApprovalRevokedPayload`
  (referenced by §8.2 + the approval-projection but undefined in §6). All `.strict()` Zod with
  inferred types.
- `domain`: the **two pure functions that bracket the one effectful await** —
  `authorizeExecution` (pre-flight: compose the guard → emit refusal *or* the burn bundle) and
  `settleExecution` (post-result: map the adapter result → completion / held events). Plus the
  pure `ExecutionAdapter` **port** types (`ExecutionRequest`, `ExecutionResult`).
- `runtime` (**new package**): `executionOrchestrator` — the async imperative shell that reads
  projections, appends the burn bundle, awaits the adapter, and appends the settlement; and the
  deterministic `SimulatorAdapter`.
- `event-ledger`: the new `authorizationProjection` fold (feeds the guard), the
  `runStatusProjection` extension (execution + run-lifecycle + revocation cases), and the
  production `SystemClock` / `SystemIdGen` (co-located with the `Clock` / `IdGen` ports).
- `testing-fixtures`: deterministic execution fixtures (fixed execution ids, receipt refs,
  completion timestamps) plus a **fake-live adapter** (`adapterType: "bitget_live"`) that returns
  `ExecutionUnknown`, and a **crash adapter** that throws after the burn.
- `docs/event-model.md`: a coherence sync — add the three net-new payload interfaces and the
  `ApprovalRevoked` run-projection rule (§14.I; full list there).

### 2.2 Out of scope (YAGNI / later phases)

- **Real Bitget live adapter** and venue I/O: Phase 2 ships only the `SimulatorAdapter`; the
  `bitget_live` path is exercised solely by a test fake.
- **Reconciliation worker:** resolving an `ExecutionUnknown` back to completed/failed is a
  Phase 3 operational concern. Phase 2 only *parks* the run (held, `retryBlocked: true`).
- **Real execution-precondition wiring** (snapshot staleness, capability availability): the
  `ExecutionRejected` machinery is built and unit-tested, but its precondition inputs default
  clear under the simulator (§14.C).
- **`ReplayRequested` / `ReplayCompleted`, `IncidentCreated`, notifications:** unchanged from 1B.
- **Persistence / network / MCP transport:** still the `InMemoryLedgerStore`; no new I/O beyond
  the adapter port.

---

## 3. Architecture and package layout

Phase 2 keeps the functional-core / imperative-shell shape and adds exactly **one** new package
(`runtime`) for the orchestrator — the first place TraceGuard performs a real side effect, so it
is isolated from the pure core.

| Package             | Phase 2 addition                                                                 | Prior parallel             |
|---------------------|----------------------------------------------------------------------------------|----------------------------|
| `schemas`           | `execution-payloads.ts` (4), `run-payloads.ts` (2), `ApprovalRevokedPayload`     | `authorization-payloads.ts`|
| `domain`            | `execution-transitions.ts` (`authorizeExecution`, `settleExecution`), `execution-adapter.ts` (port types) | `approval-transitions.ts`  |
| `runtime` (**new**) | `execution-orchestrator.ts`, `simulator-adapter.ts`                               | — (new shell layer)        |
| `event-ledger`      | `authorization-projection.ts`, `runStatusProjection` extension, `system-clock.ts`| `approval-projection.ts`   |
| `testing-fixtures`  | execution fixtures + fake-live adapter + crash adapter                            | approval fixtures          |

Dependency direction stays acyclic: `schemas` ← (`event-ledger`, `policy-engine`, `domain`,
`runtime`); `domain` may use `policy-engine` + `event-ledger`; **`runtime` is the only package
that depends on `domain` + `event-ledger` together and is depended on by nothing** (it is the
composition root / entry point).

### 3.1 The two-functions-bracketing-one-await shape

The execution path is exactly one side effect (`adapter.call()`) wrapped by two pure functions:

```text
  pure authorizeExecution ──▶ [shell appends BURN] ──▶ await adapter.call() ──▶ pure settleExecution ──▶ [shell appends result]
        (decide + burn)                                   (the only effect)            (interpret result)
```

The shell owns sequencing and the `await`; the two pure functions own all event construction and
all branching. This keeps every business rule unit-testable without a running adapter and makes
the burn ordering a property of the *shell* that an integration test pins down.

---

## 4. Schemas

All payloads are `.strict()` Zod objects with inferred TS types, matching existing conventions
(decimal-as-string via `DecimalString`, ISO-8601 via `IsoTimestamp`). A shared
`ExecutionAdapterType = z.enum(["simulator","bitget_live","replay"])` is reused across the
execution payloads (it already exists as `executionAdapter` on `ActionDigestInput`; Phase 2
re-exports one shared enum to avoid drift).

### 4.1 Execution payloads (event-model §6.26–6.29) — `execution-payloads.ts` (new)

```text
ExecutionRequestedPayload  { executionId, runId, decisionId, authorizationId?,
                             adapterType: ExecutionAdapterType, actionDigest,
                             idempotencyKey, requestRef, requestHash }
ExecutionCompletedPayload  { executionId, runId, adapterType: ExecutionAdapterType,
                             finalStatus: "simulated"|"submitted"|"filled"
                                        |"partially_filled"|"cancelled",
                             receiptRef, receiptHash, upstreamRef?, completedAt }
ExecutionRejectedPayload   { executionId?, runId, decisionId,
                             reasonCode: "policy_blocked"|"approval_required"
                                       |"authorization_missing"|"authorization_invalid"
                                       |"capability_unavailable"|"snapshot_stale"
                                       |"manifest_unapproved"|"workspace_locked",
                             executionSent: z.literal(false) }
ExecutionUnknownPayload    { executionId, runId, adapterType: z.literal("bitget_live"),
                             reasonCode: "timeout_after_submit"|"connection_lost_after_submit"
                                       |"provider_status_unavailable"|"receipt_lookup_failed",
                             upstreamRequestId?,
                             reconciliationRequired: z.literal(true),
                             retryBlocked: z.literal(true) }
```

`ExecutionUnknownPayload.adapterType` is the **literal** `"bitget_live"` (canon-lock): the
simulator can never produce an unknown (§14.D).

### 4.2 Run-lifecycle payloads — `run-payloads.ts` (new)

The event types `RunCompleted` / `RunFailed` are canonical (event-model line 299; §8.1 reducer)
but have **no §6 payload interface**. Phase 2 defines minimal ones:

```text
RunCompletedPayload  { runId, completedAt, executionId? }
RunFailedPayload     { runId, failedAt, reasonCode: z.enum(["orchestrator_error"]) }
```

`reasonCode` is a single-member enum (not a bare literal) so later phases can widen the failure
vocabulary without a breaking change. These interfaces are synced into event-model §6 (§14.A/I).

### 4.3 `ApprovalRevokedPayload` — `approval-payloads.ts` (modify)

`ApprovalRevoked` is referenced by event-model §8.2 and already folded by `approvalProjection`,
but §6 defines no payload (the gap 1B deviation F flagged). Phase 2 defines it, modeled on
`ApprovalRejectedPayload`, with the actor recorded on the **envelope** (`actorType` /
`actorId`) per existing convention rather than duplicated into the payload (§14.B):

```text
ApprovalRevokedPayload { approvalId, revokedBy?, revokedAt, reason? }
```

`revokedBy` is optional so a `system` actor can revoke (envelope `actorType: "system"`); an
operator revocation sets envelope `actorType: "user"`, `actorId = revokedBy`.

### 4.4 Barrel exports — `index.ts` (modify)

Add `export * from "./execution-payloads.js"` and `export * from "./run-payloads.js"`.

---

## 5. Pure domain functions (`domain`)

Both follow the established shape `(args, deps) → { events, outcome }` with
`deps = { clock, newId, hash }`, chaining events via the same `previousEventHash` `emit` helper
as `approveApproval`. The caller (shell) supplies `previousEventHash` (the current ledger head)
and all timestamps/refs that are not derivable; the pure functions own id/hash derivation and
all branching.

### 5.1 `authorizeExecution(args, deps)` — pre-flight: decide + burn

Args: `workspaceId`, `runId`, `decisionId`, `authorization?` (the guard's authorization shape,
from §8.1 projection), `attemptedActionDigest`, `gates: { workspaceLocked, manifestChanged,
policyChanged }`, `executionGates: { capabilityUnavailable, snapshotStale, manifestUnapproved }`,
`adapterType`, `previousEventHash`.

```text
ExecutionAuthorizeResult = { events: LedgerEvent[];
                             outcome: "executing" | "rejected" | "denied";
                             request?: ExecutionRequest }   // present iff outcome === "executing"
```

1. **Derive execution identity** (deterministic under doubles):
   `executionId = deps.newId.next("exec")`;
   `idempotencyKey = "execution:" + workspaceId + ":" + runId + ":" + decisionId + ":" + attemptedActionDigest`
   (event-model §11); `requestHash = deps.hash(canonicalRequestPreimage)`;
   `requestRef = idempotencyKey` (a stable, secret-free reference — no blob store in Phase 2).
2. **Guard** via `evaluateAuthorizationUse({ authorization, attemptedActionDigest,
   now: deps.clock.now(), gates })`. If `!ok` → emit **`AuthorizationRejected`**
   (`reasonCode` from the guard, `attemptedActionDigest`, `expectedActionDigest =
   authorization?.actionDigest`); **no burn**; `outcome: "denied"`.
3. **Execution preconditions** (only reached when the guard says `ok`): if
   `executionGates.capabilityUnavailable` → `capability_unavailable`; else
   `executionGates.snapshotStale` → `snapshot_stale`; else
   `executionGates.manifestUnapproved` → `manifest_unapproved`. On any hit → emit
   **`ExecutionRejected`** (`executionSent: false`); **no burn**; `outcome: "rejected"`.
4. **Authorize + burn** (both gates clear) → emit the ordered **burn bundle**
   `[ExecutionRequested, AuthorizationConsumed]`:
   - `ExecutionRequested` (`actorType: "system"`) with the derived identity fields and
     `authorizationId` from the grant;
   - `AuthorizationConsumed` (`actorType: "system"`) with `authorizationId`, `approvalId?`,
     `runId`, `decisionId`, `actionDigest`, `consumedAt = deps.clock.now()`, `executionId`.
   `outcome: "executing"`; `request` is the `ExecutionRequest` handed to the adapter (same
   identity the bundle committed — single-sourced).

### 5.2 `settleExecution(args, adapterResult, deps)` — post-result: interpret

Args: `workspaceId`, `runId`, `decisionId`, `executionId`, `adapterType`, `previousEventHash`.
`adapterResult: ExecutionResult` (§6).

```text
ExecutionSettleResult = { events: LedgerEvent[]; outcome: "completed" | "unknown" }
```

- `adapterResult.kind === "completed"` → emit `[ExecutionCompleted, RunCompleted]`
  (`ExecutionCompleted` `actorType: "system"`, carrying `finalStatus`, `receiptRef`,
  `receiptHash`, `upstreamRef?`, `completedAt = deps.clock.now()`; `RunCompleted` with
  `completedAt`, `executionId`). `outcome: "completed"`.
- `adapterResult.kind === "unknown"` → emit `[ExecutionUnknown]` only
  (`adapterType: "bitget_live"`, `reasonCode`, `upstreamRequestId?`,
  `reconciliationRequired: true`, `retryBlocked: true`). The run is **held**: no `RunCompleted`,
  no `RunFailed`. `outcome: "unknown"`.

Note the adapter returns only `completed` or `unknown`; **`ExecutionRejected` is never an adapter
result** — it is a pre-flight veto emitted by `authorizeExecution` (the two-rejection split,
§14.G). A thrown adapter error is handled by the shell as `RunFailed` (§6, §14.H), not here.

---

## 6. The `ExecutionAdapter` port and `SimulatorAdapter`

The port is pure type-only (in `domain/execution-adapter.ts`):

```text
interface ExecutionRequest  { executionId, runId, decisionId, authorizationId, actionDigest,
                              idempotencyKey, requestRef, requestHash }
type ExecutionResult =
    | { kind: "completed"; finalStatus: "simulated"|"submitted"|"filled"
                                       |"partially_filled"|"cancelled";
        receiptRef: string; receiptHash: string; upstreamRef?: string }
    | { kind: "unknown"; reasonCode: "timeout_after_submit"|"connection_lost_after_submit"
                                    |"provider_status_unavailable"|"receipt_lookup_failed";
        upstreamRequestId?: string }
interface ExecutionAdapter  { readonly adapterType: "simulator"|"bitget_live"|"replay";
                              call(request: ExecutionRequest): Promise<ExecutionResult> }
```

`ExecutionRequest` carries identity + idempotency + `requestHash` (which already commits to the
order content); concrete order params are deferred to the Phase 3 live adapter (YAGNI).

**`SimulatorAdapter`** (`runtime/simulator-adapter.ts`): `adapterType: "simulator"`; constructed
with the injected `hash` dep; `call()` is deterministic and never throws, always returning
`{ kind: "completed", finalStatus: "simulated", receiptRef: "receipt:" + executionId,
receiptHash: hash(receiptPreimage) }`. Because it can only return `completed`, it structurally
cannot drive the `unknown` branch — that path is covered by the fake-live test adapter (§10).

---

## 7. The orchestrator (`runtime`, imperative shell)

`executionOrchestrator(args, deps)` with `deps = { store, adapter, clock, newId, hash }` is the
**only** async, effectful function. It performs the burn-before-execute sequence:

```text
1. events  = await store.read(workspaceId, runId)
   head     = await store.head(workspaceId)               // optimistic-concurrency token
   authzView= authorizationProjection(events)             // → { authorizationId?, actionDigest?,
                                                           //     expiresAt?, status }
2. auth = authorizeExecution({ ...identity, authorization: authzView-as-guard-input,
                               attemptedActionDigest, gates, executionGates,
                               adapterType: adapter.adapterType, previousEventHash: head }, deps)
   if auth.outcome === "denied"  : await store.append(head, auth.events)   // AuthorizationRejected
                                   return { outcome: "denied" }
   if auth.outcome === "rejected": await store.append(head, auth.events)   // ExecutionRejected
                                   return { outcome: "rejected" }
3. // outcome === "executing": auth.events = [ExecutionRequested, AuthorizationConsumed]
   await store.append(head, auth.events)                  // ◀── BURN PERSISTED BEFORE THE EFFECT
   burnHead = lastHash(auth.events)
4. try   { result = await adapter.call(auth.request) }    // ◀── the single effect
   catch { await store.append(burnHead, [ makeEvent(RunFailed, reasonCode:"orchestrator_error") ])  // hard failure
           return { outcome: "failed" } }
5. settle = settleExecution({ ...identity, executionId, adapterType, previousEventHash: burnHead },
                            result, deps)
   await store.append(burnHead, settle.events)            // [ExecutionCompleted, RunCompleted] | [ExecutionUnknown]
   return { outcome: settle.outcome }                     // "completed" | "unknown"
```

Step 3 is the safety crux: `AuthorizationConsumed` is durable **before** step 4's await. If the
process dies anywhere in step 4–5, the grant is already burned; a re-drive re-reads the ledger,
`authorizationProjection` reports `consumed`, and the guard returns `already_consumed` — the
order is never re-sent. The `RunFailed` branch (step 4 catch) is the **hard-failure** path
(adapter threw / bug); a *known* uncertain live outcome must instead be returned as
`{ kind: "unknown" }` and flows through `settleExecution` to `ExecutionUnknown` (§14.H).

---

## 8. Projections (`event-ledger`)

### 8.1 `authorizationProjection` (new) — feeds the guard

A pure fold producing exactly the guard's `authorization` input shape:

```text
AuthorizationView = { authorizationId?, actionDigest?, expiresAt?,
                      status: "issued" | "consumed" | "revoked",
                      approvalId? }
```

Reducer:

```text
AuthorizationIssued                 -> issued    (record authorizationId, approvalId?, actionDigest, expiresAt)
AuthorizationConsumed               -> consumed
ApprovalRevoked (matching approvalId) -> revoked  // cross-aggregate: revoke the authz issued for that approval
```

Time-based expiry is **not** folded here: there is no `AuthorizationExpired` payload in event-model
§6, and the guard already derives expiry from `now ≥ expiresAt`. The projection therefore yields
`issued | consumed | revoked`; the guard supplies the `expired` decision (§14.E). The
cross-aggregate `ApprovalRevoked → revoked` link matches `ApprovalRevoked.approvalId` against the
`approvalId` recorded from `AuthorizationIssued`.

### 8.2 `runStatusProjection` extension (event-model §8.1)

Add the canonical execution + run-lifecycle cases plus revocation:

```text
ExecutionRequested -> executing
ExecutionCompleted -> completed
ExecutionRejected  -> blocked                 // §8.1 "blocked or completed"; fail-closed reading (§14.G)
ExecutionUnknown   -> executing               // held for reconciliation; retryBlocked; no terminal transition
RunCompleted       -> completed
RunFailed          -> failed
ApprovalRevoked    -> blocked                 // canon §8.1 silent; revocation is an explicit kill (§14.F)
```

The existing `approvalProjection` already folds `AuthorizationConsumed → consumed` and
`ApprovalRevoked → revoked` (1B shipped it forward-compatibly) — **no change**.

---

## 9. Production `Clock` / `IdGen` (reviewer M3) — `event-ledger/system-clock.ts` (new)

The `Clock` / `IdGen` ports have only ever had test doubles. Phase 2 adds the production
implementations, co-located with the port definitions:

```text
class SystemClock implements Clock { now() { return new Date().toISOString(); } }
class SystemIdGen implements IdGen { next(prefix) { return prefix + "_" + randomUUID(); } }   // node:crypto
```

These are wired **only** in the orchestrator composition root; every domain / pure function still
takes injected `deps`, so tests keep using the fixed doubles and byte reproducibility is
preserved. This closes reviewer finding M3.

---

## 10. Data flow (end-to-end)

```text
Golden path (simulator), from a 1B-issued authorization:
  AuthorizationIssued (allow or approved)        authz: issued | run: allowed/approval_required
    -> executionOrchestrator
         append [ExecutionRequested,                           run: executing
                 AuthorizationConsumed]          authz: consumed   ◀── BURN before adapter.call()
         await SimulatorAdapter.call() => completed/simulated
         append [ExecutionCompleted, RunCompleted]             run: completed

Denied (revoked / missing / digest-mismatch / gate):
  ApprovalRevoked (operator)                      authz: revoked
    -> executionOrchestrator -> guard refuses
         append AuthorizationRejected             (no burn, adapter never called)   run: blocked

Pre-flight rejected (execution precondition):
  -> executionOrchestrator -> guard ok, precondition set
         append ExecutionRejected(executionSent:false)         run: blocked   (no burn)

Uncertain live (fake-live adapter, adapterType bitget_live):
  -> executionOrchestrator
         append [ExecutionRequested, AuthorizationConsumed]    authz: consumed   ◀── BURN
         await adapter.call() => unknown
         append [ExecutionUnknown]                run: executing (HELD; retryBlocked; reconcile)

Crash after burn:
  -> append [ExecutionRequested, AuthorizationConsumed]        authz: consumed   ◀── BURN
     adapter throws -> append RunFailed(orchestrator_error)    run: failed
     re-drive -> guard sees consumed -> AuthorizationRejected(already_consumed)   (NO replay)
```

---

## 11. Error handling and invariants (fail-closed)

1. **I1 — burn-before-execute:** `AuthorizationConsumed` is appended *before* `await
   adapter.call()`. The defining Phase 2 property.
2. **I2 — single-use:** after the burn, `authorizationProjection` reports `consumed`; the guard
   returns `already_consumed`; no second `ExecutionRequested` is ever emitted for the grant.
3. **I3 — default-deny:** missing / revoked / mismatched / gated authorization → guard refuses →
   `AuthorizationRejected`, **no burn**, adapter never called.
4. **I4 — two-rejection split:** `AuthorizationRejected` (authorization-validity refusal) and
   `ExecutionRejected` (`executionSent: false`, execution-precondition veto) are distinct events
   with distinct reason vocabularies; **both are pre-burn** and consume nothing.
5. **I5 — unknown is held, not closed:** a returned `unknown` → `ExecutionUnknown`
   (`reconciliationRequired`, `retryBlocked`); the run stays `executing` (held); no
   `RunCompleted` / `RunFailed`; the grant is already burned so no replay.
6. **I6 — hard failure is fail-closed:** a thrown adapter/orchestrator error → `RunFailed`
   (`orchestrator_error`); the grant is already burned; the run rests at `failed` with no replay.
7. **I7 — adapter contract:** a live adapter MUST encode "submitted-but-uncertain" as a returned
   `{ kind: "unknown" }` (→ held/reconcile), **not** a throw (→ `failed`). Both rest fail-closed.
8. **I8 — hash chain continues cross-aggregate:** execution / authorization / run events link via
   `previousEventHash` onto the ledger head; `eventHash` covers the same canonical preimage as 1A/1B.
9. **I9 — byte reproducibility:** with injected `clock` / `newId` / `hash`, identical inputs
   produce identical events and hashes; `SystemClock` / `SystemIdGen` are the only
   non-deterministic implementations and are confined to the composition root.
10. **I10 — `ExecutionUnknown` is `bitget_live`-locked:** the payload literal makes the simulator
    structurally unable to emit it; the path is built and tested via the fake-live adapter.
11. **Values vs. exceptions:** refusals / results are carried in events and `outcome` values; only
    genuine infrastructure failures (append conflict, hash-chain integrity, adapter throw) cause a
    throw or a `RunFailed`.

---

## 12. Testing strategy (Vitest + fast-check)

- **Unit — `authorizeExecution`:** `denied` for each guard `reasonCode` (→ `AuthorizationRejected`
  with `expectedActionDigest`); `rejected` for each execution precondition (→ `ExecutionRejected`,
  `executionSent: false`); `executing` → ordered burn bundle `[ExecutionRequested,
  AuthorizationConsumed]`, `request` returned, `executionId` / `idempotencyKey` single-sourced and
  matching event-model §11.
- **Unit — `settleExecution`:** `completed` → `[ExecutionCompleted, RunCompleted]`; `unknown` →
  `[ExecutionUnknown]` only (assert `reconciliationRequired` / `retryBlocked` literals, no run
  close).
- **Unit — `authorizationProjection`:** `issued` / `consumed`; cross-aggregate `ApprovalRevoked →
  revoked`; output feeds the guard unchanged.
- **Unit — `runStatusProjection`:** the seven new cases; assert `ExecutionUnknown` stays
  `executing` (held) and `ApprovalRevoked → blocked`.
- **Unit — `SimulatorAdapter`:** deterministic `completed` / `simulated` receipt under the hash
  double.
- **Integration — `executionOrchestrator` (the crux):**
  - **golden path** (simulator): ledger ends `[ExecutionRequested, AuthorizationConsumed,
    ExecutionCompleted, RunCompleted]`; `run = completed`, `authz = consumed`; verified chain +
    byte snapshot.
  - **crash-after-burn** (throwing adapter): assert `AuthorizationConsumed` **is** in the ledger
    and `RunFailed` appended; **re-drive** → guard `already_consumed` → `AuthorizationRejected`,
    **no second `ExecutionRequested`**.
  - **denied** (revoked/missing): `AuthorizationRejected`, no burn, adapter never invoked.
  - **rejected** (precondition set): `ExecutionRejected` (`executionSent: false`), no burn.
  - **unknown** (fake-live, `bitget_live`): `ExecutionUnknown`, run held; assert **no**
    `RunCompleted` / `RunFailed`, authz burned.
  - **revocation race**: `ApprovalRevoked` appended between issue and orchestration → guard
    `missing_authorization` → `AuthorizationRejected`, no burn.
- **Property tests (fast-check):** `settleExecution` total over arbitrary `ExecutionResult`;
  `authorizeExecution` never emits `AuthorizationConsumed` without a preceding `ExecutionRequested`
  in the same bundle; the burn bundle is always exactly `[ExecutionRequested,
  AuthorizationConsumed]` in that order; identical inputs ⇒ identical events/hashes.

---

## 13. Canonical source mapping

| Phase 2 artifact                         | Canonical source                                   |
|------------------------------------------|----------------------------------------------------|
| Execution payloads (4)                   | event-model §6.26–6.29                              |
| `AuthorizationConsumed` (now emitted)    | event-model §6.24 (defined in 1B, emitted here)    |
| `AuthorizationRejected` (now emitted)    | event-model §6.25 (defined in 1B, emitted here)    |
| `RunCompleted` / `RunFailed` payloads    | event-model line 299 + §8.1 (types canonical; payloads net-new §14.A) |
| `ApprovalRevokedPayload`                 | event-model §8.2 ref (net-new payload §14.B)       |
| Burn-before-execute / single-use         | architecture §13.2; policy-semantics §10           |
| Run projection (fold)                    | event-model §8.1                                   |
| Approval projection (fold, unchanged)    | event-model §8.2                                   |
| Idempotency key template                 | event-model §11                                    |
| Single-use guard (`evaluateAuthorizationUse`) | 1B artifact; architecture §13.2               |
| Hash chain / `eventHash` preimage        | event-model §10.1–10.3 (1A artifact)               |

---

## 14. Deviations and coherence notes (disclosed)

- **A. `RunCompleted` / `RunFailed` payloads are net-new for canonical event types.** The event
  *types* appear in the ledger-type catalog (event-model line 299) and the §8.1 reducer, but §6
  never gave them payload interfaces. Phase 2 supplies `RunCompletedPayload` /
  `RunFailedPayload` (§4.2) and syncs them into event-model §6. `RunFailed.reasonCode` is a net-new
  single-member vocabulary (`orchestrator_error`).
- **B. `ApprovalRevokedPayload` is net-new and envelope-actored.** §8.2 + the approval-projection
  reference `ApprovalRevoked`, but §6 defined no payload (1B deviation F). Phase 2 defines it
  modeled on `ApprovalRejectedPayload`, **without** an in-payload `actorType` — the actor lives on
  the `makeEvent` envelope (`actorType` / `actorId`), matching `ApprovalExpired` / `ApprovalRejected`
  conventions. This refines the pre-design draft shape (which had an in-payload `actorType`).
- **C. `ExecutionRejected` is built and tested but precondition-gated off under the simulator.**
  The `executionGates` (capability / snapshot / manifest) default clear in Phase 2 (no real
  snapshot/capability wiring yet), so the `rejected` branch is unit-tested but not on the golden
  path — analogous to `ExecutionUnknown` being adapter-gated.
- **D. `ExecutionUnknown.adapterType` is literal-locked to `"bitget_live"`.** Faithful to
  event-model §6.29; the simulator cannot emit it; the path is exercised by a fake-live adapter.
- **E. `authorizationProjection` yields `issued | consumed | revoked`; the guard derives `expired`.**
  No `AuthorizationExpired` payload exists in §6, and the guard already takes `now` and compares
  `expiresAt`. Folding a non-existent event was rejected in favor of letting the guard own
  time-based expiry — consistent with 1B's stance.
- **F. `ApprovalRevoked → blocked` in `runStatusProjection` (canon §8.1 silent).** §8.1 lists no
  run rule for `ApprovalRevoked`. Phase 2 maps it to `blocked` because revocation is an **explicit
  operator kill**, deliberately diverging from 1B deviation B (which left passive reject/expire
  lapses to run-lifecycle closure). Disclosed for the spec-review decision; synced to §8.1 (§14.I).
- **G. `ExecutionRejected → blocked` (canon §8.1 says "blocked or completed").** Phase 2 picks the
  fail-closed `blocked` reading; the "completed" reading (a rejection that still closes a no-op run)
  is not needed in Phase 2.
- **H. Thrown adapter error → `RunFailed`, not `ExecutionUnknown`.** `settleExecution` only
  interprets *returned* results. A throw is a hard failure (`orchestrator_error`); a *known*
  uncertain live outcome must be a returned `{ kind: "unknown" }`. The adapter contract (I7) makes
  this the live adapter's responsibility. Both states rest fail-closed because the burn precedes
  the await.
- **I. event-model.md coherence sync (full list).** Phase 2 edits the canonical doc to: (1) add
  `RunCompletedPayload` + `RunFailedPayload` §6 interfaces; (2) add `ApprovalRevokedPayload` §6
  interface; (3) add the `ApprovalRevoked -> blocked` rule to the §8.1 reducer. Listed here so the
  full doc-edit scope is visible at spec review.

---

## 15. Acceptance criteria (Phase 2)

1. The pnpm workspace builds under TS `strict` + ESM with the new `runtime` package and no new
   dependency cycles.
2. `authorizeExecution` returns `denied` → `AuthorizationRejected` (correct guard `reasonCode`),
   `rejected` → `ExecutionRejected` (`executionSent: false`), or `executing` → the ordered burn
   bundle `[ExecutionRequested, AuthorizationConsumed]` with single-sourced `executionId` /
   `idempotencyKey` (§11) and a returned `request`; byte-deterministic under doubles.
3. `settleExecution` maps `completed` → `[ExecutionCompleted, RunCompleted]` and `unknown` →
   `[ExecutionUnknown]` (held), total under property tests.
4. `executionOrchestrator` appends `AuthorizationConsumed` **before** awaiting the adapter; the
   crash-after-burn test proves the grant is consumed and a re-drive yields `already_consumed`
   (no second `ExecutionRequested`) plus `RunFailed`.
5. `authorizationProjection` + the `runStatusProjection` extension match event-model §8.1/§8.2,
   including cross-aggregate `ApprovalRevoked → revoked` (authz) and `ApprovalRevoked → blocked`
   (run), and the execution + run-lifecycle transitions.
6. `SystemClock` / `SystemIdGen` exist and are wired only in the orchestrator composition root;
   all pure code still takes injected `deps` (reviewer M3 closed).
7. The simulator golden path is demonstrated end-to-end with a verified hash chain and byte
   snapshot; the `ExecutionUnknown` path is demonstrated via the fake-live adapter.
8. `docs/event-model.md` is synced per §14.I (`RunCompleted` / `RunFailed` / `ApprovalRevoked`
   payloads + the `ApprovalRevoked` run-projection rule).
```

