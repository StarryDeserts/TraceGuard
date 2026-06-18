# TraceGuard Phase 3E-2c — `bitget_live` Live Execution Adapter Design

**Date:** 2026-06-18
**Status:** Approved design — ready for implementation plan
**Increment:** Phase 3 / Local MCP Gateway / 3E Engine Hardening / 3E-2c (live execution adapter)
**Predecessors:** 3E-1 (governed execution path), 3E-2a (durable `FileLedgerStore`), 3E-2b (arg validation + result redaction)

---

## 1. Overview & Goal

**Goal:** Replace the simulator-only execution boundary with a real `bitget_live` adapter that submits a governed spot order to the upstream Bitget MCP server and maps the provider response back into the existing `ExecutionResult` contract — without changing the ledger's digest-centric shape or the domain/schema layer.

Today every governed execution runs through `createSimulatorAdapter`, and both `requestExecution` and `executeAuthorizedAction` hard-deny any `executionAdapter !== "simulator"` with `CAPABILITY_UNAVAILABLE`. 3E-2c lifts that gate for `bitget_live` and wires a second adapter that performs a real upstream round-trip for **spot** orders, while preserving the fail-closed safety boundary (pre-submit failure ⇒ `failed`; post-submit ambiguity ⇒ `unknown` with reconciliation required).

This is the runnable vertical slice for the hackathon demo: an agent records a spot decision, requests execution with `executionAdapter: "bitget_live"`, and TraceGuard submits the order to `bitget-mcp-server --paper-trading` under full governance.

---

## 2. Settled Decisions

These three open questions from the 3E-2 design §4 were settled with the user during brainstorming:

1. **Scope — full round-trip.** The adapter performs a real upstream call and maps the concrete provider response into `ExecutionResult`, not a thin seam-fill that fakes a receipt. Order intent is recovered from the ledger (Option A, §4).
2. **Market coverage — spot only.** Only `marketType === "spot"` executes live. `futures` and `tokenized_stock` resolve to `capability_unavailable` (the latter because Bitget's manifest has no `tstock_place_order` tool). This keeps the first live slice to a single, well-understood order shape.
3. **Timeout & gates.**
   - Default upstream timeout `timeoutMs = 10000` (configurable factory param), enforced via `Promise.race`.
   - Only the `capabilityUnavailable` execution gate is wired live in this increment. `snapshotStale`, `manifestUnapproved`, `workspaceLocked`, `manifestChanged`, and `policyChanged` remain hardcoded `false` and are explicitly deferred (§9).

---

## 3. Safety Boundary (the load-bearing contract)

The mapping from adapter behaviour to `ExecutionResult.kind` is the safety contract. It is derived from the schema, where `ExecutionUnknownReason` is **exclusively** post-submit ambiguity and `ExecutionUnknownPayload` hardcodes `reconciliationRequired: true, retryBlocked: true`.

| Situation | adapter behaviour | `ExecutionResult` | downstream effect |
|---|---|---|---|
| Decision intent not found / unmappable to a spot order | `throw` (before any upstream call) | orchestrator catch ⇒ `RunFailed` | `EXECUTION_FAILED` |
| Upstream call exceeds `timeoutMs` | return `unknown("timeout_after_submit")` | `ExecutionUnknown` | `EXECUTION_UNKNOWN`, reconciliation required |
| Upstream call throws / connection drops mid-flight | return `unknown("connection_lost_after_submit")` | `ExecutionUnknown` | `EXECUTION_UNKNOWN`, reconciliation required |
| Upstream returns `isError: true` (definitive rejection) | `throw` | orchestrator catch ⇒ `RunFailed` | `EXECUTION_FAILED` |
| Upstream returns success but no parseable order id | return `unknown("receipt_lookup_failed")` | `ExecutionUnknown` | `EXECUTION_UNKNOWN`, reconciliation required |
| Upstream returns success with order id | return `completed(...)` | `ExecutionCompleted` + `RunCompleted` | `EXECUTED` / `ALLOWED` ok |

**Rule of thumb:** anything that *might* have reached the exchange ⇒ `unknown` (never silently retried). Anything that provably did *not* reach the exchange, or is a definitive provider rejection ⇒ `throw` ⇒ `failed`. There is no path that returns `completed` without a concrete upstream order id.

`BURN BEFORE EXECUTE` is unchanged: the orchestrator persists `ExecutionRequested` + `AuthorizationConsumed` before calling `adapter.call`, so even a process crash during the upstream call leaves a durable record that an execution was attempted.

---

## 4. Architecture — Option A (adapter recovers intent from the ledger)

`ExecutionRequest` deliberately carries **no order payload** — only `{ executionId, runId, decisionId, authorizationId, actionDigest, idempotencyKey, requestRef, requestHash }`. The ledger stays digest-centric ("no order bodies in the ledger"). But the `DecisionProposed` event emitted by `proposeDecision` **is** rich: it carries `instrument`, `marketType`, `action`, `requestedNotionalUsdt?`, `requestedQuantity?`, `requestedLeverage?`, `orderType?`, `limitPrice?` (recorded intentionally for governance audit).

So the `bitget_live` adapter recovers concrete order intent by reading the ledger:

```
ExecutionRequest{runId, decisionId}
  → store.read(workspaceId, runId)
  → find e where e.eventType === "DecisionProposed" && e.aggregateId === decisionId
  → e.payload as DecisionProposedPayload      (instrument, marketType, action, qty, price, …)
  → buildSpotOrderArgs(payload)                (→ spot_place_order args)
  → client.callTool("spot_place_order", args)  (with timeout race)
  → map CallToolResult → ExecutionResult
```

`workspaceId` is not on `ExecutionRequest`, so it is bound at factory construction time (from `BootGatewayArgs.workspaceId`). This approach requires **zero** changes to `ExecutionRequest`, `packages/domain`, or `packages/schemas`.

### Why Option A over the alternatives

- **Not "thread the payload through `ExecutionRequest`":** that would force order fields into the domain transition layer and risk order bodies leaking into the ledger digest — against the standing constraint.
- **Not "re-derive from a cache":** the `CachedDecision` map is in-memory and process-local; the ledger is the durable source of truth and already carries the intent. Reading the ledger keeps the adapter correct across the durable `FileLedgerStore`.

---

## 5. Components

### 5.1 New: `packages/runtime/src/bitget-live-adapter.ts`

```
createBitgetLiveAdapter(deps: {
  store: LedgerStore;
  client: UpstreamManifestClient;
  workspaceId: string;
  hash: (input: string) => string;
  timeoutMs?: number;          // default 10000
}): ExecutionAdapter
```

Returns `{ adapterType: "bitget_live", async call(request): Promise<ExecutionResult> }`.

`call(request)` algorithm:

1. `const decision = await findDecisionProposed(store, workspaceId, request.runId, request.decisionId)`. If not found ⇒ `throw new Error("decision_intent_not_found")`.
2. `const args = buildSpotOrderArgs(decision)`. If unmappable (e.g. no size resolvable) ⇒ `throw`.
3. Submit with timeout race:
   ```
   let result: CallToolResult;
   try {
     result = await raceWithTimeout(client.callTool("spot_place_order", args), timeoutMs);
   } catch (err) {
     return err is TimeoutError
       ? unknown("timeout_after_submit")
       : unknown("connection_lost_after_submit");
   }
   ```
4. `if (result.isError) throw new Error("upstream_rejected")` ⇒ definitive rejection ⇒ `failed`.
5. `const orderId = parseOrderId(result)`. If absent ⇒ `return unknown("receipt_lookup_failed")`.
6. Else `return { kind: "completed", finalStatus: "submitted", receiptRef: \`receipt:bitget:${orderId}\`, receiptHash: hash(\`receipt:bitget:${orderId}:${request.requestHash}\`), upstreamRef: orderId }`.

Helper shape (all module-local, pure where possible):
- `findDecisionProposed(store, ws, runId, decisionId): Promise<DecisionProposedPayload | undefined>`
- `buildSpotOrderArgs(decision): Record<string, string>` — see §6.
- `raceWithTimeout<T>(p: Promise<T>, ms): Promise<T>` — rejects with a distinguishable `TimeoutError` when `ms` elapses first.
- `parseOrderId(result: CallToolResult): string | undefined` — reads `structuredContent.orderId` (and known fallbacks) from the provider result.

### 5.2 Modified: `packages/mcp-gateway/src/internal-tool-context.ts`

Change the singular adapter to a typed map:

```
adapters: Partial<Record<ExecutionAdapterType, ExecutionAdapter>>;   // replaces: adapter: ExecutionAdapter
```

### 5.3 Modified: `packages/mcp-gateway/src/internal-tool-handlers.ts`

- **Relax both hard gates** (`requestExecution`, `executeAuthorizedAction`):
  ```
  if (executionAdapter !== "simulator" && executionAdapter !== "bitget_live")
    return internalErr("CAPABILITY_UNAVAILABLE", name);
  ```
- **`finishExecution`** resolves the adapter by type and computes the one live gate from the decision's market type:
  ```
  const capabilityUnavailable =
    adapterType === "bitget_live" && actionDigestInput.marketType !== "spot";
  const adapter = ctx.adapters[adapterType] ?? ctx.adapters.simulator!;
  // executionGates: { capabilityUnavailable, snapshotStale: false, manifestUnapproved: false }
  // deps: { ...ctx.deps, store: ctx.store, adapter }
  ```
  When `bitget_live` is selected for a non-spot market, `capabilityUnavailable` is `true`, the orchestrator yields `rejected`, and `mapExecReason` returns `CAPABILITY_UNAVAILABLE` — fail-closed, **before** any upstream call. If a `bitget_live` adapter was not registered at boot, the fallback to `simulator` keeps the gateway functional in degraded/test configs.

### 5.4 Modified: `packages/mcp-gateway/src/boot-gateway.ts`

Build the adapter map once at boot and store it on `InternalToolContext`:

```
const hash = deps.hash;
const adapters: Partial<Record<ExecutionAdapterType, ExecutionAdapter>> = {
  simulator: createSimulatorAdapter({ hash }),
  bitget_live: createBitgetLiveAdapter({
    store, client, workspaceId: args.workspaceId, hash, timeoutMs: 10000,
  }),
};
// internalCtx.adapters = adapters   (replaces internalCtx.adapter = createSimulatorAdapter(...))
```

The same long-lived `client` already used for `callTool` on the public path is reused for live execution.

### 5.5 Modified: `packages/runtime/src/index.ts`

Add `export * from "./bitget-live-adapter.js";`.

---

## 6. Order-intent mapping (`buildSpotOrderArgs`)

Upstream `spot_place_order` args (from the fixture manifest, all string-typed): `{ symbol, side, orderType, size, price }`.

| spot_place_order field | source | rule |
|---|---|---|
| `symbol` | `decision.instrument` | passed through verbatim |
| `side` | `decision.action` | `buy`/`open_long` ⇒ `"buy"`; `sell`/`open_short`/`reduce`/`close` ⇒ `"sell"`; `hold`/`abstain` ⇒ unmappable ⇒ `throw` |
| `orderType` | `decision.orderType` | `decision.orderType ?? "market"` |
| `size` | `decision.requestedQuantity` ?? `decision.requestedNotionalUsdt` | first defined wins; if neither ⇒ unmappable ⇒ `throw` |
| `price` | `decision.limitPrice` | included only when `orderType === "limit"` and `limitPrice` is defined; omitted otherwise |

Notes:
- `hold`/`abstain` never reach execution in practice (they are non-trade actions), but mapping them defensively to `throw` keeps the boundary fail-closed if one slips through.
- Mapping is intentionally minimal for the first live slice; `stopLoss`/`takeProfit`/`leverage` are out of scope (spot, no bracket orders).

---

## 7. Data Flow (end to end)

```
agent: traceguard_record_decision        → DecisionProposed{instrument, marketType:"spot", action, qty, …}
agent: traceguard_request_execution(executionAdapter:"bitget_live")
  → requestExecution: gate relaxed (bitget_live allowed)
  → finishExecution(adapterType:"bitget_live")
     → capabilityUnavailable = (marketType !== "spot")   // false for spot
     → executionOrchestrator(deps.adapter = adapters.bitget_live)
        → BURN BEFORE EXECUTE: persist ExecutionRequested + AuthorizationConsumed
        → adapter.call(request)
           → read DecisionProposed by {runId, decisionId}
           → buildSpotOrderArgs → client.callTool("spot_place_order", args)  [race 10s]
           → map result → ExecutionResult{completed|unknown}  (or throw → failed)
        → settleExecution: ExecutionCompleted+RunCompleted | ExecutionUnknown | RunFailed
  → internalOk(EXECUTED, {executionId, receipt}) | internalErr(EXECUTION_UNKNOWN|EXECUTION_FAILED|CAPABILITY_UNAVAILABLE)
```

The `require_approval` branch is unchanged: approval flows through `checkApproval` → `executeAuthorizedAction`, which calls the same `finishExecution` with `okStatus:"EXECUTED"`.

---

## 8. Error handling summary

| Failure mode | where caught | result code |
|---|---|---|
| non-spot market + `bitget_live` | `finishExecution` gate (pre-submit) | `CAPABILITY_UNAVAILABLE` |
| decision intent missing / unmappable | adapter `throw` → orchestrator catch | `EXECUTION_FAILED` |
| upstream timeout (>10s) | adapter returns `unknown` | `EXECUTION_UNKNOWN` |
| upstream connection lost / throws | adapter returns `unknown` | `EXECUTION_UNKNOWN` |
| upstream `isError: true` | adapter `throw` → orchestrator catch | `EXECUTION_FAILED` |
| upstream ok, no order id | adapter returns `unknown` | `EXECUTION_UNKNOWN` |
| upstream ok, order id present | adapter returns `completed` | `EXECUTED` / `ALLOWED` |

The raw provider result is recorded on the ledger (`ToolCallCompleted`-style audit retained by the orchestrator's existing settle path); only the agent-facing return is redacted (3E-2b). No exchange credentials or raw order bodies enter the ledger digest.

---

## 9. Deferred / Out of scope (disclosed)

- **Other execution gates.** `snapshotStale`, `manifestUnapproved`, `workspaceLocked`, `manifestChanged`, `policyChanged` stay hardcoded `false`. Wiring them live (e.g. detecting a manifest hash drift between boot and execution) is a separate increment.
- **Futures & tokenized-stock live execution.** Both resolve to `capability_unavailable` today. Futures would additionally need `futures_set_leverage` orchestration; tokenized-stock has no upstream tool.
- **Bracket orders (stopLoss/takeProfit) and leverage on live orders.** Out of scope for the spot slice.
- **`mapGuardReason` latent mislabel.** It does not handle `workspace_locked`/`manifest_changed`/`policy_changed` (would fall through to `AUTHORIZATION_MISSING`). Irrelevant in 3E-2c because those auth-guard gates are not wired live; noted so a future gate-wiring increment fixes the mapping alongside.
- **Idempotency / dedupe on retry.** The `idempotencyKey` is computed and persisted but not yet replayed against the upstream; live de-dup is future work.

---

## 10. Testing strategy

All production code via strict TDD (red → watch fail → green). A fake `UpstreamManifestClient` and an in-memory `LedgerStore` (or the existing test store) drive the adapter; no network.

**Adapter unit tests (`packages/runtime/src/bitget-live-adapter.test.ts`):**
1. spot decision → success result with order id ⇒ `completed{finalStatus:"submitted", upstreamRef, receiptRef:"receipt:bitget:<id>"}`.
2. `receiptHash` is `hash("receipt:bitget:<id>:<requestHash>")` (deterministic).
3. upstream resolves after `timeoutMs` ⇒ `unknown("timeout_after_submit")`.
4. `client.callTool` rejects ⇒ `unknown("connection_lost_after_submit")`.
5. `result.isError === true` ⇒ throws (definitive rejection → failed upstream).
6. upstream ok but no parseable order id ⇒ `unknown("receipt_lookup_failed")`.
7. `DecisionProposed` not found for `{runId, decisionId}` ⇒ throws.
8. `buildSpotOrderArgs` mapping table: side derivation per action; `size` from quantity then notional; `price` only for limit; missing size ⇒ throws; `hold`/`abstain` ⇒ throws.
9. adapter reads run-scoped events correctly when the ledger holds multiple runs/decisions (selects the matching decisionId).

**Gateway integration tests (`packages/mcp-gateway/src/internal-tool-handlers.test.ts`):**
10. `request_execution(executionAdapter:"bitget_live")` for a spot decision routes to the `bitget_live` adapter and returns `EXECUTED`/`ALLOWED` ok (fake client).
11. `bitget_live` + futures/tokenized_stock decision ⇒ `CAPABILITY_UNAVAILABLE` with no upstream call.
12. `bitget_live` adapter returning `unknown` ⇒ `EXECUTION_UNKNOWN`.
13. unchanged simulator path still returns the simulated receipt (regression).
14. unknown adapter type (e.g. `"replay"`) still ⇒ `CAPABILITY_UNAVAILABLE`.

---

## 11. Files touched

| File | Change |
|---|---|
| `packages/runtime/src/bitget-live-adapter.ts` | **new** — `createBitgetLiveAdapter` + helpers |
| `packages/runtime/src/bitget-live-adapter.test.ts` | **new** — adapter unit tests |
| `packages/runtime/src/index.ts` | export the new adapter |
| `packages/mcp-gateway/src/internal-tool-context.ts` | `adapter` → `adapters: Partial<Record<ExecutionAdapterType, ExecutionAdapter>>` |
| `packages/mcp-gateway/src/internal-tool-handlers.ts` | relax hard gate; `finishExecution` resolves adapter by type + computes `capabilityUnavailable` |
| `packages/mcp-gateway/src/boot-gateway.ts` | build `adapters` map (simulator + bitget_live) |
| `packages/mcp-gateway/src/internal-tool-handlers.test.ts` | gateway integration tests above |
| `docs/mcp-gateway-contract.md` | document `bitget_live` execution semantics + spot-only capability + unknown/reconciliation behaviour |

---

## 12. Global Constraints (carried into the plan)

- Node ≥ 22.12, TypeScript strict ESM, `.js` import specifiers on `.ts` sources, vitest 4.
- `pnpm typecheck` = `tsc --build --pretty`; `pnpm test` = `vitest run`. A change is not done until both pass.
- Strict TDD for all production code; frequent commits; `git add` only exact named files.
- No raw exchange credentials or order bodies in the ledger digest; redact only the agent-facing return.
- Spot-only for live; non-spot is fail-closed `capability_unavailable`.
