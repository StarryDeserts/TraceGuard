# TraceGuard — Phase 1, Spec 1B: Approval & Authorization Design

- **Status:** Approved (design), ready for implementation planning
- **Date:** 2026-06-09
- **Scope:** Phase 1 "Domain core", second slice (1B). The approval state machine and
  single-use execution authorization — the two domain-core items (#5, #6) deferred from 1A.
- **Source of truth:** `docs/architecture.md`, `docs/event-model.md`, `docs/policy-semantics.md`.
  Where this spec restates a canonical type or rule, the canonical doc wins; section
  references (e.g. event-model §6.23) are given so drift can be detected.
- **Builds on:** Spec 1A (merged). 1B picks up immediately after `PolicyEvaluated` and
  reuses 1A's functional-core / imperative-shell split, injected `clock`/`newId`/`hash`
  dependencies, hash-chained `makeEvent`, and the `LedgerStore` port unchanged.

---

## 1. Context and goal

TraceGuard's central invariant is `Proposal ≠ Authorization ≠ Execution`: an agent's output
is **evidence, not authority**, the system is **fail-closed / default-deny**, and the LLM
never makes the final authorization decision. Spec 1A delivered the part of the kernel that
deterministically classifies a proposed action as **allow**, **require_approval**, or
**block**, recorded as a hash-chained event sequence ending at `PolicyEvaluated`.

Spec **1B** delivers the next link in that chain: turning a policy *outcome* into a
**human-approved or auto-issued, single-use execution authorization**, recorded as immutable
events. After 1B, an `allow` outcome auto-issues a single-use authorization, a
`require_approval` outcome drives an approval lifecycle (requested → approved / rejected /
expired) that issues an authorization only on approval, and a `block` outcome terminates.
1B also ships the pure guard that a future execution step will use to consume that
authorization exactly once.

### 1.1 Exit criterion

> A policy outcome is turned into a single-use execution authorization — directly for
> `allow`, via human approval for `require_approval`, and not at all for `block` — recorded
> as an immutable, hash-chained event sequence; and a reused, expired, mismatched, or
> missing authorization is deterministically refused.

1B is "done" when an executable acceptance test demonstrates the `allow`, `require_approval`
(approved), rejected, and expired paths end-to-end with a verified hash chain, plus a guard
test covering every refusal reason.

### 1.2 Phase 1 domain-core items completed by 1B

| # | Phase 1 domain-core item   | 1B | Notes                                                          |
|---|-----------------------------|----|----------------------------------------------------------------|
| 5 | Approval state machine      | ✅ | pending → approved / rejected / expired (event-model §6.19–6.22, §8.2) |
| 6 | Execution authorization     | ✅ | `AuthorizationIssued` + single-use guard (event-model §6.23, §6.25; arch §13.2) |

Items #1–4, #7, #8 were delivered in 1A. 1B adds no new package and changes no 1A schema
enum (`AggregateType` already has `approval` / `authorization`; `ActorType` already has
`user` / `system`).

---

## 2. Scope

### 2.1 In scope (1B)

- `schemas`: the four approval payloads (`ApprovalRequested`, `ApprovalApproved`,
  `ApprovalRejected`, `ApprovalExpired`) and the three authorization payloads
  (`AuthorizationIssued`, `AuthorizationConsumed`, `AuthorizationRejected`) as `.strict()`
  Zod schemas with inferred types; the `ApprovalStatus` and `AuthorizationRejectionReason`
  enums. (Consumed/Rejected are **defined** here for full canonical coverage but **not
  emitted** in 1B — see §12.C.)
- `policy-engine`: `evaluateAuthorizationUse`, the standalone, pure, dependency-free
  single-use guard (the §6 item #6 counterpart to 1A's standalone `computeActionDigest`).
- `domain`: `resolveAuthorizationGateway` (the post-policy fork) and the human/clock-driven
  transitions `approveApproval` / `rejectApproval` / `expireApproval`. These compose 1A's
  `makeEvent` + `computeActionDigest` into the canonical approval/authorization sequences.
- `event-ledger`: extend `runStatusProjection` (event-model §8.1) and add the
  `approvalProjection` fold (event-model §8.2), which doubles as the state source the domain
  transitions consume.
- `testing-fixtures`: deterministic approval/authorization fixtures (fixed approval ids,
  authorization ids, expiry timestamps) on top of 1A's fixed clock / id doubles.

### 2.2 Out of scope (YAGNI / later phases)

- **`AuthorizationConsumed` emission and `ExecutionRequested` / `ExecutionCompleted` /
  `ExecutionRejected`** (event-model §6.24, §6.26–6.29): `AuthorizationConsumed` requires an
  `executionId` and is emitted at execution time; all execution events are **Phase 2**
  (adapters, receipts, reconciliation). 1B ships the *decision* (`evaluateAuthorizationUse`)
  that Phase 2 will turn into Consumed/Rejected emissions.
- **`ApprovalRevoked`** (event-model §8.2 lists `revoked`, but §6 defines **no**
  `ApprovalRevokedPayload`): operator-driven revocation has no canonical envelope yet and is
  out of scope. The `approvalProjection` still folds it forward-compatibly (§12.F).
- **Run-lifecycle events** (`RunCreated` / `RunStarted` / `RunCompleted` / `RunFailed`): as
  in 1A, 1B operates on an existing `runId` and never opens or closes a run (§12.B).
- **Notification / channel delivery** (`TelegramNotificationSent`, web/MCP-app push): 1B
  records `channelOptions` and `approvalChannel` as data but performs no I/O.
- **Persistence, network, MCP transport, policy YAML/NL front-ends:** unchanged from 1A.

---

## 3. Architecture and package layout

1B follows 1A's functional-core / imperative-shell shape exactly. Every domain function is
pure: it takes plain args plus injected `deps = { clock, newId, hash }` and **returns**
`{ events, outcome }`; the imperative shell appends the events to the `LedgerStore`. No new
package is introduced.

| Package             | 1B addition                                                         | 1A parallel                |
|---------------------|---------------------------------------------------------------------|----------------------------|
| `schemas`           | 7 payloads + `ApprovalStatus` + `AuthorizationRejectionReason`      | `event-payloads.ts`        |
| `policy-engine`     | `evaluateAuthorizationUse` (standalone pure guard)                  | `action-digest.ts`         |
| `domain`            | `resolveAuthorizationGateway`, `approveApproval`, `rejectApproval`, `expireApproval` | `propose-decision.ts` |
| `event-ledger`      | `runStatusProjection` extension + `approvalProjection`              | `run-status-projection.ts` |
| `testing-fixtures`  | approval / authorization fixtures                                  | existing doubles           |

Dependency direction is unchanged and acyclic: `schemas` ← (`event-ledger`, `policy-engine`,
`domain`); `domain` may use `policy-engine` and `event-ledger` (as `propose-decision.ts`
already does).

---

## 4. Schemas (event-model §6.19–6.25, §8.2)

All payloads are `.strict()` Zod objects with inferred TS types, matching `event-payloads.ts`
conventions (decimal-as-string via the `DecimalString` scalar, ISO-8601 via `IsoTimestamp`).

**Emitted in 1B:**

```text
ApprovalRequestedPayload   { approvalId, runId, decisionId, policyEvaluationId,
                             actionDigest, channelOptions: Array<"web"|"telegram"|"mcp_app">,
                             expiresAt, summary { instrument, action, notionalUsdt?,
                                                  leverage?, policyOutcome:"require_approval" } }
ApprovalApprovedPayload    { approvalId, runId, decisionId, actionDigest,
                             approvedBy, approvalChannel:"web"|"telegram"|"mcp_app",
                             approvedAt, expiresAt }
ApprovalRejectedPayload    { approvalId, rejectedBy, rejectionChannel:"web"|"telegram"|"mcp_app",
                             reason? }
ApprovalExpiredPayload     { approvalId, expiredAt, actionDigest }
AuthorizationIssuedPayload { authorizationId, approvalId?, runId, decisionId,
                             actionDigest, expiresAt, scope:"single_action" }
```

**Defined for canonical coverage, not emitted in 1B (§12.C):**

```text
AuthorizationConsumedPayload { authorizationId, approvalId?, runId, decisionId,
                               actionDigest, consumedAt, executionId }   // executionId ⇒ Phase 2
AuthorizationRejectedPayload { authorizationId?, approvalId?, runId, decisionId,
                               attemptedActionDigest, expectedActionDigest?,
                               reasonCode: AuthorizationRejectionReason }
```

**Enums:**

```text
ApprovalStatus               = pending | approved | consumed | rejected | expired | revoked   // §8.2
AuthorizationRejectionReason = missing_authorization | expired_authorization | already_consumed
                             | action_digest_mismatch | workspace_locked | manifest_changed
                             | policy_changed                                                  // §6.25
```

`channelOptions` / `approvalChannel` / `rejectionChannel` reuse one shared
`ApprovalChannel = z.enum(["web","telegram","mcp_app"])`.

---

## 5. Domain transition functions (`domain`)

Signature shape mirrors `proposeDecision`: `(args, deps) → ApprovalTransitionResult`, where

```text
ApprovalTransitionResult = { events: LedgerEvent[];
                             outcome: "issued" | "requested" | "blocked"
                                    | "approved" | "rejected" | "expired"
                                    | "illegal_transition" | "not_yet_expired" }
```

`expiresAt` values are **provided by the caller** (shell computes `now + policy TTL`) and
recorded verbatim; domain functions perform no date arithmetic (§12.D). Events are chained
via the same `emit` helper pattern as `proposeDecision` (threads `previousEventHash`).

### 5.1 `resolveAuthorizationGateway(args, deps)` — the post-policy fork

Args include `workspaceId`, `runId`, `decisionId`, `policyEvaluationId`, `outcome: Effect`,
`actionDigestInput: ActionDigestInput`, `channelOptions`, `summary` fields,
`approvalExpiresAt`, `authorizationExpiresAt`, `previousEventHash`.

1. Compute `actionDigest = computeActionDigest(args.actionDigestInput, deps.hash)` — the
   first wiring of 1A's standalone digest (§12.E).
2. Branch on `outcome`:
   - `allow` → emit `AuthorizationIssued` (`actorType:"system"`, **no** `approvalId`,
     `scope:"single_action"`, `expiresAt = authorizationExpiresAt`); `outcome:"issued"`.
   - `require_approval` → emit `ApprovalRequested` (`actorType:"system"`,
     `expiresAt = approvalExpiresAt`, with `summary` and `channelOptions`);
     `outcome:"requested"`.
   - `block` → emit nothing; `outcome:"blocked"` (the run is already `blocked` from
     `PolicyEvaluated`).

### 5.2 `approveApproval` / `rejectApproval` / `expireApproval` — human / clock driven

Each takes `approvalState: ApprovalProjection` (from §7.2), plus its own args and `deps`.

**Unified expiry rule (applies to all three, fail-closed):** before any pending-state
transition, if `deps.clock.now() ≥ approvalState.expiresAt`, the **only** legal emission is
`ApprovalExpired` (`actorType:"system"`); the intended approve/reject does **not** proceed.
Expiry is inclusive of the deadline instant — at `now == expiresAt` the approval is already
lapsed (fail-closed). The guard (§6) and `expireApproval` use the same `≥` convention.

- `approveApproval({ approvalState, approvedBy, approvalChannel, authorizationExpiresAt, previousEventHash }, deps)`
  - status ≠ `pending` → no events, `outcome:"illegal_transition"`.
  - lapsed → emit `ApprovalExpired`, `outcome:"expired"`.
  - else → emit `ApprovalApproved` (`actorType:"user"`, `actorId = approvedBy`) **then**
    `AuthorizationIssued` (`actorType:"system"`, `approvalId` set, `actionDigest` from
    `approvalState`, `expiresAt = authorizationExpiresAt`); `outcome:"approved"`.
- `rejectApproval({ approvalState, rejectedBy, rejectionChannel, reason?, previousEventHash }, deps)`
  - status ≠ `pending` → `illegal_transition`; lapsed → `ApprovalExpired`;
  - else → emit `ApprovalRejected` (`actorType:"user"`, `actorId = rejectedBy`);
    `outcome:"rejected"`.
- `expireApproval({ approvalState, previousEventHash }, deps)`
  - status ≠ `pending` → `illegal_transition`.
  - `now ≥ expiresAt` → emit `ApprovalExpired`, `outcome:"expired"`; else no events,
    `outcome:"not_yet_expired"`.

---

## 6. The single-use guard (`policy-engine`)

`evaluateAuthorizationUse(input)` is **pure, total, and dependency-free** — `now` is an
input, exactly as `computeActionDigest` takes `hash` as an input. It returns a *decision
value*; it never emits events. Phase 2's execution step turns its result into
`AuthorizationConsumed` (ok) or `AuthorizationRejected` (refused).

```text
input  = { authorization?: { authorizationId, actionDigest, expiresAt,
                             status: "issued"|"consumed"|"expired"|"revoked" },
           attemptedActionDigest, now,
           gates: { workspaceLocked, manifestChanged, policyChanged } }
result = { ok: true,  authorizationId }
       | { ok: false, reasonCode: AuthorizationRejectionReason }
```

**Refusal precedence (first match wins, fail-closed):**

1. no `authorization` **or** `status === "revoked"` → `missing_authorization` (§12.A)
2. `status === "expired"` **or** `now ≥ authorization.expiresAt` → `expired_authorization`
3. `status === "consumed"` → `already_consumed`
4. `attemptedActionDigest !== authorization.actionDigest` → `action_digest_mismatch`
5. `gates.workspaceLocked` → `workspace_locked`
6. `gates.manifestChanged` → `manifest_changed`
7. `gates.policyChanged` → `policy_changed`
8. otherwise → `ok`

The three `gates` are the contextual reason codes (workspace lock, manifest drift, policy
change) supplied by the shell; the guard stays pure by taking them as booleans rather than
re-deriving them.

---

## 7. Projections (`event-ledger`, event-model §8.1–8.2)

### 7.1 `runStatusProjection` extension (§8.1)

Add two cases: `ApprovalRequested → approval_required`, `ApprovalApproved → approval_required`.
Faithful to §8.1, `AuthorizationIssued`, `ApprovalRejected`, and `ApprovalExpired` do **not**
change run status — the run stays `approval_required` until a run-lifecycle event closes it
(§12.B). For the `allow` path the run stays `allowed` after `AuthorizationIssued`.

### 7.2 `approvalProjection` (new, §8.2)

A pure fold over the approval/authorization stream producing the read-model and the state
source for §5:

```text
ApprovalProjection = { approvalId?, runId, decisionId, actionDigest?, expiresAt?,
                       status: ApprovalStatus, authorizationId?, authorizationExpiresAt? }
```

Reducer (event-model §8.2), forward-compatible — it handles `AuthorizationConsumed` and
`ApprovalRevoked` even though 1B never emits them:

```text
ApprovalRequested    -> pending     (record approvalId, actionDigest, expiresAt)
ApprovalApproved     -> approved
AuthorizationIssued  -> approved     (record authorizationId, authorizationExpiresAt)
AuthorizationConsumed-> consumed
ApprovalRejected     -> rejected
ApprovalExpired      -> expired
ApprovalRevoked      -> revoked
```

---

## 8. Data flow (end-to-end)

```text
Path A — allow (auto-issue):
  PolicyEvaluated(allow)
    -> resolveAuthorizationGateway
         -> AuthorizationIssued (no approvalId, actor=system)
  run: allowed                              (AuthorizationIssued does not change run status)
  ...Phase 2: ExecutionRequested -> evaluateAuthorizationUse -> AuthorizationConsumed

Path B — require_approval:
  PolicyEvaluated(require_approval)
    -> resolveAuthorizationGateway
         -> ApprovalRequested (actor=system)     run: approval_required | appr: pending
    -> approveApproval (human)
         -> ApprovalApproved (actor=user)                                 appr: approved
         -> AuthorizationIssued (approvalId set)                          appr: approved
  ...Phase 2: ExecutionRequested -> evaluateAuthorizationUse -> AuthorizationConsumed  appr: consumed
  branch reject -> ApprovalRejected                                       appr: rejected
  branch lapse  -> ApprovalExpired                                        appr: expired

Path C — block:
  PolicyEvaluated(block) -> resolveAuthorizationGateway -> (no events)    run: blocked  (terminal)
```

---

## 9. Error handling and invariants (fail-closed)

1. **I1 — default deny:** absent authorization (or revoked) ⇒ guard returns
   `missing_authorization`. No execution proceeds without a valid single-use grant.
2. **I2 — expiry precedence:** any pending-state transition meeting `now ≥ expiresAt` emits
   only `ApprovalExpired`; approve/reject never override a lapse.
3. **I3 — illegal transitions are values, not throws:** approve/reject on a non-`pending`
   approval emits zero events and returns `outcome:"illegal_transition"`; the shell decides
   remediation (an `IncidentCreated` is a Phase 2 concern).
4. **I4 — digest is single-sourced:** `ApprovalRequested`, `ApprovalApproved`, and
   `AuthorizationIssued` carry the same `actionDigest` from one `computeActionDigest` call;
   the guard compares `attemptedActionDigest` against the issued digest.
5. **I5 — no allow bypass:** an `allow` outcome still emits a single-use `AuthorizationIssued`
   (event-model §6.23); there is no "allow means execute directly" path.
6. **I6 — hash chain continues:** 1B events link via `previousEventHash` onto the
   `PolicyEvaluated` head (cross-aggregate linking, as in 1A); `eventHash` covers the same
   canonical 12-field preimage.
7. **I7 — byte reproducibility:** with injected `clock` / `newId` / `hash`, identical inputs
   produce identical events and hashes.
8. **Values vs. exceptions:** approval/authorization *results* are carried in events and
   `outcome` values; only genuine infrastructure failures (append conflict, hash-chain
   integrity violation — both 1A behaviors) throw.
9. **Decimals & timestamps:** financial fields stay decimal strings; expiry comparison
   relies on canonical UTC ISO-8601 (`IsoTimestamp`) so lexical compare equals chronological
   compare (§12.D).

---

## 10. Testing strategy (Vitest + fast-check, mirroring 1A)

- **Unit — domain:** `resolveAuthorizationGateway` for all three outcomes;
  `approveApproval` / `rejectApproval` / `expireApproval` for success, lapsed-expiry, and
  illegal-transition; verify actor types (`system` vs `user`) and that approve emits the
  ordered pair `[ApprovalApproved, AuthorizationIssued]`.
- **Unit — guard:** one case per `AuthorizationRejectionReason`, the `revoked →
  missing_authorization` mapping, the `ok` path, and a **precedence** test (several refusal
  conditions true at once ⇒ the highest-precedence code).
- **Property tests (fast-check):** the guard is total (never throws on arbitrary input);
  expiry is monotone (once `now > expiresAt`, no input yields `ok`); a mismatched digest is
  always refused; identical inputs ⇒ identical results.
- **Projections:** `approvalProjection` over each §8.2 transition plus the forward-compatible
  `AuthorizationConsumed` / `ApprovalRevoked`; `runStatusProjection` for the two new cases
  and the "unchanged by reject/expire/issue" assertion.
- **Acceptance / golden (1B exit criterion):** drive `allow`, `require_approval`→approve,
  reject, and expire end-to-end; append to the ledger; assert the immutable hash-chained
  sequences, the projected `RunStatus` and `ApprovalStatus`, and a byte-snapshot under fixed
  clock/id doubles.

---

## 11. Canonical source mapping

| 1B artifact                         | Canonical source                          |
|-------------------------------------|-------------------------------------------|
| Approval payloads                   | event-model §6.19–6.22                     |
| `AuthorizationIssued` + issue rule  | event-model §6.23                          |
| `AuthorizationConsumed` payload     | event-model §6.24 (defined, not emitted)   |
| `AuthorizationRejected` + reasons   | event-model §6.25                          |
| Single-use authorization concept    | architecture §13.2; policy-semantics §10   |
| Run projection (fold)               | event-model §8.1                           |
| Approval projection (fold)          | event-model §8.2                           |
| `actionDigest` formula / input      | policy-semantics §9.1–9.3 (1A artifact)    |
| Hash chain / `eventHash` preimage   | event-model §10.1–10.3 (1A artifact)       |
| Phase 1 items #5/#6 + exit          | architecture.md (Phase 1)                  |

---

## 12. Deviations and coherence notes (disclosed)

- **A. `revoked` authorization → `missing_authorization`.** event-model §6.25 defines seven
  `AuthorizationRejectionReason` codes with **no** `revoked` variant, yet architecture §13.2
  gives an authorization a `revoked` status. The guard maps a `revoked` grant to
  `missing_authorization` (a revoked grant is effectively absent) rather than inventing a new
  code. Confirmed choice; flagged so §6.25 can add `revoked_authorization` later if desired.
- **B. Run status is unchanged by `ApprovalRejected` / `ApprovalExpired` / `AuthorizationIssued`.**
  Faithful to the §8.1 reducer, which lists no run-status rule for these. The run stays
  `approval_required` (or `allowed`) until a run-lifecycle event (`RunFailed` /
  `RunCompleted`) closes it — and run-lifecycle is out of 1B scope, exactly as in 1A.
- **C. `AuthorizationConsumed` and `AuthorizationRejected` are defined but not emitted.**
  `AuthorizationConsumed` requires an `executionId` (event-model §6.24) and is emitted at
  execution time; `AuthorizationRejected` is emitted when an execution attempt is refused.
  Both belong to Phase 2. 1B defines their payloads for full canonical coverage of
  event-model §6 (chosen for cross-doc consistency) and ships `evaluateAuthorizationUse` as
  the pure decision Phase 2 will emit from.
- **D. `expiresAt` is a caller-provided input.** Domain functions record expiry verbatim and
  do no date math; the shell computes `now + policy TTL` (policy-semantics §10: 5 minutes for
  a simulated action). Expiry comparison assumes canonical UTC ISO-8601 (`IsoTimestamp`), so
  lexical and chronological order coincide.
- **E. `computeActionDigest` is wired in 1B.** This closes 1A deviation note C:
  `resolveAuthorizationGateway` (and the issuance inside `approveApproval`) bind the digest
  into `ApprovalRequested` / `AuthorizationIssued`, now that provider/tool/adapter context
  (`ActionDigestInput`) is supplied by the shell.
- **F. `ApprovalRevoked` event is out of scope.** event-model §8.2 has a `revoked` projection
  state but §6 defines no `ApprovalRevokedPayload`. 1B emits no revocation event; the
  `approvalProjection` folds `ApprovalRevoked → revoked` forward-compatibly so a later
  operator-revocation slice needs no projection change.

---

## 13. Acceptance criteria (Spec 1B)

1. pnpm workspace builds under TS `strict` + ESM; all packages compile with no new cycles.
2. `resolveAuthorizationGateway` emits the canonical `AuthorizationIssued` (allow) or
   `ApprovalRequested` (require_approval) or nothing (block), with a valid hash chain
   continuing from `PolicyEvaluated`, byte-deterministic under fixed clock/id doubles.
3. `approveApproval` emits `[ApprovalApproved, AuthorizationIssued]` with a single-sourced
   `actionDigest`; `rejectApproval` and `expireApproval` emit the correct terminal event; the
   unified expiry rule and illegal-transition handling hold under unit tests.
4. `evaluateAuthorizationUse` returns the correct `reasonCode` for every refusal (including
   `revoked → missing_authorization`) and `ok` only when all checks pass, with precedence and
   totality verified by property tests.
5. `approvalProjection` reconstructs `ApprovalStatus` per event-model §8.2 (incl.
   forward-compatible Consumed/Revoked); the extended `runStatusProjection` matches §8.1.
6. The acceptance test demonstrates allow / require_approval→approved / rejected / expired
   end-to-end with verified immutable, hash-chained event sequences and the projected
   `RunStatus` + `ApprovalStatus` — satisfying the 1B exit criterion.
