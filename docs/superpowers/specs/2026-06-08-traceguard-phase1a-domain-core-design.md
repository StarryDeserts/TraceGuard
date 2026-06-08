# TraceGuard — Phase 1, Spec 1A: Domain Core Design

- **Status:** Approved (design), ready for implementation planning
- **Date:** 2026-06-08
- **Scope:** Phase 1 "Domain core", first slice (1A). Functional core + event sourcing.
- **Source of truth:** `docs/architecture.md`, `docs/event-model.md`, `docs/policy-semantics.md`.
  Where this spec restates a canonical type or rule, the canonical doc wins; section
  references (e.g. event-model §2) are given so drift can be detected.

---

## 1. Context and goal

TraceGuard is a governed MCP gateway that sits between AI trading agents and execution
providers (Bitget-first, provider-neutral). Its central invariant is
`Proposal ≠ Authorization ≠ Execution`: an agent's output is **evidence, not authority**,
and the system is **fail-closed / default-deny**. The LLM never makes the final
authorization decision.

Phase 1 ("Domain core", `architecture.md`) builds the pure decision-and-evidence kernel
with no I/O, no network, no database. Spec **1A** delivers the part of that kernel needed
to take a *proposed* action and deterministically classify it as **allow**,
**require_approval**, or **block**, recording the outcome as an immutable, hash-chained
event sequence.

### 1.1 Exit criterion (from architecture.md, Phase 1)

> A proposed simulated action can be allowed, escalated, or blocked deterministically and
> recorded as immutable events.

Spec 1A is "done" when there is an executable acceptance test demonstrating exactly this
for all three outcomes plus a rejected (schema-invalid) decision, with a verifiable
hash-chained event sequence.

### 1.2 Phase 1 domain-core items and their 1A status

The architecture lists eight domain-core items. 1A delivers six of them; the two
state-machine items move to Spec 1B.

| # | Phase 1 domain-core item        | 1A | Notes                                                        |
|---|----------------------------------|----|-------------------------------------------------------------|
| 1 | Decision Envelope schema         | ✅ | `schemas` package, Zod + inferred type (policy-semantics §6) |
| 2 | Policy DSL + AST                 | ✅ | Typed AST only; YAML/NL front-ends deferred                 |
| 3 | Deterministic evaluator          | ✅ | precedence + default-deny (policy-semantics, event-model §8) |
| 4 | Action digest                    | ✅ | Standalone pure function + property tests (policy-sem. §9)   |
| 5 | Approval state machine           | ⛔ | → Spec 1B                                                   |
| 6 | Execution authorization          | ⛔ | → Spec 1B                                                   |
| 7 | Append-only ledger               | ✅ | `LedgerStore` port + in-memory adapter                      |
| 8 | Hash chaining                    | ✅ | payloadHash → previousEventHash → eventHash (event-model §10)|

---

## 2. Scope

### 2.1 In scope (1A)

- `schemas`: `DecisionEnvelope`, the five 1A event payloads, `LedgerEvent<T>` envelope,
  `PolicyAst` / `Policy` / `Rule` / `Condition`, `ActionDigestInput`, shared scalar types
  (decimal-string, id, ISO-8601 timestamp), all as Zod schemas with inferred TS types.
- `event-ledger`: canonical JSON, SHA-256, payload/event hashing, hash-chain linking,
  `makeEvent`, the `LedgerStore` port, an `InMemoryLedgerStore` adapter, and the
  run-status projection (pure fold, event-model §8.1).
- `policy-engine`: the typed policy AST, the deterministic `evaluate` function
  (precedence `block > require_approval > allow`, default-deny), and `computeActionDigest`.
- `domain`: the `proposeDecision` use-case composing the above into the canonical
  five-event sequence.
- `testing-fixtures`: deterministic dependency doubles (fixed clock, deterministic id
  generator) and canonical sample envelopes, policies, evaluation contexts, and run ids.

### 2.2 Out of scope (YAGNI for 1A)

- YAML / natural-language policy front-ends (1A is **typed AST only**; a parser/compiler
  is a later slice).
- PostgreSQL, Drizzle/Kysely, any real persistence (the `LedgerStore` port exists so a
  Postgres adapter can be added later without touching the core).
- Approval state machine and execution-authorization state machine (→ Spec 1B).
- Any execution, including *simulated* execution and execution receipts (→ Phase 2).
- MCP gateway, HTTP API, Web console, Telegram approvals (→ Phases 3–4).
- Turborepo (a plain pnpm workspace is enough at this size; can be layered in later).

---

## 3. Architecture and package layout

**Pattern:** functional core / imperative shell. All decision logic is pure functions over
plain data. The only "shell" in 1A is the in-memory `LedgerStore` adapter. All
nondeterminism — the clock and id generation — is injected as explicit dependencies so the
core is reproducible and replayable.

**Bootstrap:** greenfield. `git init` at the repo root; pnpm workspace; TypeScript in
`strict` mode with ESM; Vitest for tests; fast-check for property tests; Zod for schemas;
Node LTS.

**Workspace packages and dependency direction** (acyclic; arrows = "depends on"):

```
packages/
  schemas            ← depended on by all others
    ├── event-ledger     (canonical JSON, hashing, hash-chain, append-only,
    │                      LedgerStore port + in-memory adapter, projections/fold)
    ├── policy-engine    (policy AST, deterministic evaluator, action digest)
    └── domain           (proposeDecision: composes schemas + event-ledger + policy-engine)
  testing-fixtures   (depends on schemas; provides deterministic deps + sample data)
```

Rules:
- `schemas` depends on nothing internal.
- `event-ledger` and `policy-engine` depend only on `schemas`. They do **not** depend on
  each other.
- `domain` depends on `schemas`, `event-ledger`, and `policy-engine`.
- No package imports a sibling that would create a cycle. The evaluator and the ledger are
  independent and only meet inside `domain`.

---

## 4. Components and interfaces

> Field lists below mirror the canonical docs. The canonical interface is authoritative;
> 1A re-expresses them as Zod schemas and infers the TS types.

### 4.1 `schemas`

**`DecisionEnvelope`** — input schema (policy-semantics §6). Fields: `id`, `instrument`,
`marketType` (`"spot" | "futures" | "tokenized_stock"`), `action`
(`"buy" | "sell" | "open_long" | "open_short" | "reduce" | "close" | "hold" | "abstain"`),
`thesis`, `confidence?` (number), `evidenceRefs` (string[]), `requestedNotionalUsdt?`,
`requestedQuantity?`, `requestedLeverage?`, `orderType?`, `limitPrice?`, `stopLoss?`,
`takeProfit?`, `promptVersion?`, `modelProvider?`, `modelName?`.

- Financial/execution values (`requestedNotionalUsdt`, `requestedQuantity`,
  `requestedLeverage`, `limitPrice`, `stopLoss`, `takeProfit`) are **decimal strings**, not
  numbers (policy-semantics §6.2). A shared `DecimalString` schema validates them.
- `confidence` stays a JSON number and is **excluded** from both the decision hash and the
  action digest (policy-semantics §6, event-model §6.12).

**`LedgerEvent<TPayload>`** — event envelope (event-model §2). Canonical fields:
`id`, `workspaceId`, `aggregateType` (one of the 15 canonical aggregate types),
`aggregateId`, `eventType`, `eventVersion`, `schemaVersion`, `occurredAt`, `recordedAt`,
`actorType` (`"user" | "agent" | "system" | "provider" | "worker"`), `actorId?`, plus
optional correlation fields (`runId?`, `agentId?`, `providerConnectionId?`,
`policyVersionId?`, `toolManifestVersionId?`, `traceId?`, `spanId?`, `correlationId?`,
`causationId?`, `idempotencyKey?`), `payload`, `payloadHash`, `previousEventHash?`,
`eventHash`, `redactionProfile?`.

**The five 1A event payloads** (event-model §6.12–6.18), each its own Zod schema:
- `DecisionProposedPayload` — `decisionId`, `runId`, `envelopeVersion`, the decision fields
  (instrument/marketType/action/thesis/confidence?/evidenceRefs and the decimal-string
  requested/order/SL-TP fields), optional model-provenance fields, and `decisionHash`.
- `DecisionValidatedPayload` — `decisionId`, `runId`, `validationResult: "valid"`,
  `normalizedDecisionRef`, `normalizedDecisionHash`.
- `DecisionRejectedPayload` — `decisionId?`, `runId`, `reasonCode` (one of
  `schema_invalid | missing_required_field | unsupported_action | missing_evidence |
  snapshot_rejected | numeric_parse_error`), `validationErrors: {path, message}[]`.
- `PolicyEvaluationStartedPayload` — `evaluationId`, `runId`, `decisionId`,
  `policyVersionId`, `evaluatorVersion`, `evaluationInputHash`.
- `PolicyEvaluatedPayload` — `evaluationId`, `runId`, `decisionId`, `policyVersionId`,
  `evaluatorVersion`, `outcome` (`allow | require_approval | block`),
  `matchedRules: {ruleId, outcome, explanation, expected?, actual?}[]`,
  `evaluationOutputHash`.

**Policy types** — `Policy { version; rules: Rule[]; defaultEffect: "block" }`,
`Rule { id; conditions: Condition[]; effect: Effect }`,
`Effect = "allow" | "require_approval" | "block"`, and the `Condition` union (the 1A
predicate set, §4.3). `defaultEffect` is fixed to `"block"` to encode default-deny in the
type.

**`ActionDigestInput`** — policy-semantics §9.1: `workspaceId`, `runId`, `decisionId`,
`providerConnectionId`, `toolName`, `toolManifestHash`, `policyVersionId`, `workspaceMode`,
`instrument`, `marketType`, `action`, the decimal-string requested/order/SL-TP fields,
`marketSnapshotRef?`, `executionAdapter` (`"simulator" | "bitget_live" | "replay"`).

### 4.2 `event-ledger`

```ts
// Canonical JSON per event-model §10.3: sorted keys, UTF-8, no insignificant whitespace,
// decimals as strings, ISO-8601 UTC timestamps, no undefined values, arrays keep order.
canonicalJson(value: unknown): string

sha256hex(input: string): string

payloadHash(payload: unknown): string            // = sha256hex(canonicalJson(payload))  (§10.1)

// eventHash preimage is the EXACT 12-field subset from event-model §10.2:
// { id, workspaceId, aggregateType, aggregateId, eventType, eventVersion, schemaVersion,
//   occurredAt, actorType, actorId, payloadHash, previousEventHash }
eventHash(header: EventHashHeader): string

// Builds a fully-formed LedgerEvent from a payload + context, using injected clock/id,
// computing payloadHash, linking previousEventHash, and computing eventHash.
makeEvent<T>(args: {
  aggregateType; aggregateId; eventType; eventVersion; schemaVersion;
  actorType; actorId?; payload: T; previousEventHash: string | null; /* + optional corr fields */
}, deps: { clock: Clock; newId: IdGen }): LedgerEvent<T>

interface LedgerStore {
  // Atomic, append-only. Rejects if expectedHead !== current head (optimistic concurrency).
  // Verifies intra-batch chain links and the link to the existing head. Never UPDATE/DELETE.
  append(expectedHead: string | null, events: LedgerEvent[]): Promise<void>;
  read(workspaceId: string, runId?: string): Promise<LedgerEvent[]>;
  head(workspaceId: string): Promise<string | null>;   // latest eventHash, or null if empty
}
class InMemoryLedgerStore implements LedgerStore

// Pure fold over an event stream → RunStatus (event-model §8.1).
runStatusProjection(events: LedgerEvent[]): RunStatus
```

`Clock` returns an ISO-8601 UTC instant; `IdGen` returns prefixed ids (event-model §3).
Both are injected so output is byte-reproducible under fixed doubles.

### 4.3 `policy-engine`

```ts
type Effect = "allow" | "require_approval" | "block";

// Deterministic. Evaluates every rule, collects matches, applies precedence
// block > require_approval > allow; if no rule matches, returns policy.defaultEffect (block).
evaluate(envelope: DecisionEnvelope, policy: Policy, context: EvaluationContext): PolicyDecision

// PolicyDecision carries outcome + matchedRules ({ruleId, outcome, explanation, expected?,
// actual?}) shaped to feed PolicyEvaluatedPayload directly.

// policy-semantics §9.2: actionDigest = sha256(canonical_json(ActionDigestInput))
computeActionDigest(input: ActionDigestInput, hash: (s: string) => string): string
```

**1A predicate set** (the `Condition` union), all deterministic and decimal-aware where
numeric:
- `action ∈ [...]`
- `instrument ∈ allowlist`
- `marketType ∈ [...]`
- `requestedNotionalUsdt` / `requestedQuantity` / `requestedLeverage` comparators
  (`≤ ≥ < > =`) evaluated as decimals, never floats
- `workspaceMode =`
- `manifestStatus =`
- `snapshotAgeSeconds ≤`
- `toolRiskClass =`

`EvaluationContext` supplies the non-envelope inputs the predicates read (workspaceMode,
manifestStatus, snapshotAgeSeconds, toolRiskClass, instrument allowlist, policyVersionId,
evaluatorVersion).

### 4.4 `domain`

```ts
proposeDecision(
  args: { envelope: DecisionEnvelope; policy: Policy; context: EvaluationContext },
  deps: { clock: Clock; newId: IdGen; hash: (s: string) => string }
): { decision: PolicyDecision; events: LedgerEvent[] }
```

Pure: no I/O. Returns the decision plus the event sequence to append. The caller (the
imperative shell, e.g. a test or a future gateway) performs
`ledgerStore.append(expectedHead, result.events)`.

---

## 5. Data flow

`proposeDecision` is a pure pipeline emitting the canonical sequence
(event-model §6.12–6.18, §8.1):

1. **DecisionProposed** — record the agent's proposal verbatim (with `decisionHash`).
2. **Validate the envelope** (Zod + the rules in policy-semantics §6):
   - valid → **DecisionValidated**, where `normalizedDecisionHash` is the SHA-256 of the
     canonical JSON of the validated, normalized decision (`confidence` excluded, per
     policy-semantics §6) and `normalizedDecisionRef` points at that normalized form.
   - invalid → **DecisionRejected** (`reasonCode`, `validationErrors`) and **stop**
     (fail-closed; never proceed to evaluation, never allow).
3. **PolicyEvaluationStarted** — bind `policyVersionId` + `evaluatorVersion`; set
   `evaluationInputHash = sha256(canonicalJson(evaluation input))`.
4. **evaluate(envelope, policy, context)** — precedence `block > require_approval > allow`;
   no rule matches → `defaultEffect` (`block`).
5. **PolicyEvaluated** — `outcome`, `matchedRules`, and
   `evaluationOutputHash = sha256(canonicalJson(evaluation output))`.
6. Return `{ decision, events }`.

**Hash chain** (event-model §10): for each emitted event,
`payloadHash = sha256(canonicalJson(payload))`; `previousEventHash` = the prior event's
`eventHash` (events in one batch are chained in order; the first links to the ledger head,
or `null` for an empty ledger); `eventHash` is computed over the exact 12-field preimage
(§10.2). The shell appends with `append(expectedHead, events)`.

**Run context:** `proposeDecision` operates on an existing `runId` carried in
`EvaluationContext`; it does not require prior run-lifecycle events in the ledger. In 1A the
ledger may be empty before `DecisionProposed` (the first event links to `head = null`).
Run-lifecycle events (RunCreated / RunStarted) are a separate slice and out of scope here;
`testing-fixtures` supplies sample run ids, not seeded ledger events.

**Projection / replay:** `runStatusProjection` folds the stream per event-model §8.1 —
`DecisionValidated → decision_ready`, `PolicyEvaluationStarted → policy_evaluating`,
`PolicyEvaluated allow/require_approval/block → allowed/approval_required/blocked`. Replay
= re-fold the stored events and recompute the hashes to verify chain integrity.

---

## 6. Error handling (fail-closed)

1. **Envelope validation failure** → emit `DecisionRejected` and stop. Never emit
   `PolicyEvaluated`, never `allow`.
2. **No rule matches** → `defaultEffect = block` (default-deny).
3. **Missing/unavailable evaluation context** (e.g. absent manifestStatus, missing
   snapshot age) → treat as **block** (architecture §4.2 default-deny table). Context gaps
   never silently pass.
4. **Ledger append conflict** (`expectedHead` ≠ current head) → reject the append; the
   caller re-reads and rebuilds. Never `UPDATE`/`DELETE`; corrections are compensating
   events only.
5. **Hash-chain integrity violation** (recomputed hash ≠ stored, or a broken link) → throw
   an integrity error. This is the one place 1A throws on a "data" condition, because a
   broken chain means the ledger is untrustworthy.
6. **Values vs. exceptions:** policy and validation *results* are values carried in events
   (`DecisionRejected`, `PolicyEvaluated block`), not thrown exceptions. Only genuine
   infrastructure failures (append conflict, integrity violation) throw.
7. **Decimals:** all financial/execution math and comparison uses decimal strings; floats
   are never introduced (policy-semantics §6.2).

---

## 7. Testing strategy

- **Unit tests:** `canonicalJson` (key sorting, decimal-as-string, no-undefined,
  array-order, whitespace), `sha256hex`, `eventHash` preimage shape, `makeEvent`, each
  predicate, `evaluate` precedence and default-deny, envelope validation including every
  `reasonCode`.
- **Golden / determinism snapshots:** with fixed clock + id doubles, `proposeDecision`
  produces an exact byte sequence and exact hashes; snapshot them so any nondeterminism
  regresses loudly.
- **Property tests (fast-check):**
  - `proposeDecision` is deterministic — same inputs + same deps ⇒ identical events/hashes.
  - any matched `block` rule ⇒ outcome `block` (precedence holds under arbitrary rule sets).
  - empty/`no-match` ⇒ `block` (default-deny holds for arbitrary envelopes).
  - tampering with any stored payload breaks chain verification.
  - `canonicalJson` is invariant under input key reordering.
  - `computeActionDigest`: any change to a **material** `ActionDigestInput` field changes
    the digest; reordering keys does not (policy-semantics §9.3).
- **`LedgerStore` contract tests:** a shared behavioral suite asserting append-only,
  head-check/optimistic-concurrency, ordering, and chain-link validation. Run against
  `InMemoryLedgerStore` now; reused verbatim as the contract for a future Postgres adapter.
- **Acceptance test (1A exit criterion):** drive a proposed action through `proposeDecision`
  for each of `allow` / `require_approval` / `block` / `rejected`, append to the ledger, and
  assert the immutable hash-chained event sequence and the projected `RunStatus`.

---

## 8. Canonical source mapping

| 1A artifact                         | Canonical source                                  |
|-------------------------------------|---------------------------------------------------|
| `DecisionEnvelope`                  | policy-semantics §6                               |
| `LedgerEvent<T>` envelope           | event-model §2                                    |
| Decision/Policy event payloads      | event-model §6.12–6.18                            |
| `payloadHash` / `eventHash` / chain | event-model §10.1–10.3                            |
| Run-status projection (fold)        | event-model §8.1                                  |
| Policy precedence + default-deny    | policy-semantics; event-model §6.18; arch. §4.2   |
| `ActionDigestInput` + formula       | policy-semantics §9.1–9.3                          |
| Phase 1 scope + exit criterion      | architecture.md (Phase 1)                         |

---

## 9. Deviations from the conceptual sketch (disclosed)

During citation verification, three points were tightened to match the canonical docs.
None change the approved shape of the design; they make it byte-accurate.

- **A. `LedgerEvent` field names.** The canonical envelope (event-model §2) uses
  `id` / `aggregateType` / `aggregateId` / `eventType` / `eventVersion` / `schemaVersion` /
  `recordedAt` / `actorType` / `actorId` (plus optional correlation fields), not the
  shorthand `eventId` / `type` / `version` / `actor`. The spec uses the canonical names.
- **B. `eventHash` preimage is a fixed 12-field subset.** Per §10.2 the hash covers exactly
  `{ id, workspaceId, aggregateType, aggregateId, eventType, eventVersion, schemaVersion,
  occurredAt, actorType, actorId, payloadHash, previousEventHash }` — **not** the whole
  event. `recordedAt`, correlation fields, and `redactionProfile` are deliberately outside
  the hash. `makeEvent`/`eventHash` hash exactly those 12 fields.
- **C. Action digest is standalone in 1A, not emitted by `proposeDecision`.**
  `PolicyEvaluatedPayload` (§6.18) has **no** `actionDigest` field, and `ActionDigestInput`
  (§9.1) requires provider/tool/adapter context (`providerConnectionId`, `toolName`,
  `toolManifestHash`, `executionAdapter`) that 1A does not model. So `computeActionDigest`
  ships in 1A as a verified pure function (Phase 1 item #4) tested in isolation, but it is
  **not** woven into the `proposeDecision` event sequence. The digest is bound into
  `AuthorizationIssued` in Spec 1B, where the provider/tool/adapter context exists.

---

## 10. Acceptance criteria (Spec 1A)

1. pnpm workspace builds under TS `strict` + ESM; all five packages compile with no cycles.
2. `proposeDecision` emits the canonical five-event sequence with canonical payloads and a
   valid hash chain, and is byte-deterministic under fixed clock/id doubles.
3. `evaluate` honors precedence `block > require_approval > allow` and default-deny under
   property tests.
4. `InMemoryLedgerStore` passes the append-only / head-check / ordering contract suite.
5. `computeActionDigest` matches `sha256(canonical_json(ActionDigestInput))` and passes the
   material-field-change / key-reorder property tests.
6. The acceptance test demonstrates allow / require_approval / block / rejected end-to-end
   with a verified immutable, hash-chained event sequence — satisfying the Phase 1 exit
   criterion.
