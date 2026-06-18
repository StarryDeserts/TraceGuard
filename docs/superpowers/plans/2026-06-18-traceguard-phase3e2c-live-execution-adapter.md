# TraceGuard Phase 3E-2c — Live Execution Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `bitget_live` execution adapter that submits real spot orders through the existing governed execution path, recovering order intent from the `DecisionProposed` ledger event and failing safe on every error boundary.

**Architecture:** A new pure adapter in `@traceguard/runtime` (`createBitgetLiveAdapter`) implements the existing `ExecutionAdapter` interface. On `call`, it reads the run-scoped `DecisionProposed` event by `{runId, decisionId}` to recover the order, maps it to `spot_place_order` upstream args, and calls a structurally-typed `UpstreamCaller` (the gateway's real `UpstreamManifestClient` is assignable). Pre-submit failures throw (orchestrator → `RunFailed` → `EXECUTION_FAILED`); post-submit ambiguity returns `{kind:"unknown"}` (→ `ExecutionUnknown`, reconciliation-required). The mcp-gateway swaps its single `adapter` field for an `adapters` map and relaxes the simulator-only hard gate to also allow `bitget_live`, enforcing spot-only **live** via the orchestrator's `capabilityUnavailable` execution gate.

**Tech Stack:** TypeScript (strict ESM, `.js` import specifiers on `.ts` sources), Node ≥22.12, vitest 4, pnpm workspaces, zod. Functional-core / imperative-shell. Event-sourced hash-chain ledger.

## Global Constraints

- **Node ≥ 22.12**, **TypeScript strict**, ESM with explicit `.js` import specifiers on `.ts` sources. `tsc` has no `noUnusedLocals` (unused vars do not fail the build).
- **`@traceguard/runtime` must NOT depend on `@modelcontextprotocol/sdk`.** The adapter defines a local structural `UpstreamCaller` / `UpstreamCallResult` instead of importing `CallToolResult`. The gateway's real `UpstreamManifestClient` is structurally assignable to `UpstreamCaller`.
- **Strict TDD**: write the failing test, watch it fail for the right reason, write minimal code, watch it pass, commit. No production code without a failing test first.
- **No new ledger schema, no domain/orchestrator changes.** `ExecutionResult` (`completed` | `unknown`), `settleExecution`, `authorizeExecution`, and the `ExecutionUnknownPayload` schema already support this slice as-is.
- **Fail-safe boundary (non-negotiable):** pre-submit error ⇒ `throw` ⇒ `EXECUTION_FAILED`. Post-submit ambiguity ⇒ `{kind:"unknown"}` ⇒ `ExecutionUnknown` (`reconciliationRequired:true`, `retryBlocked:true`). Never retry or fabricate a receipt across an unknown.
- **Spot only.** Non-spot market types under `bitget_live` resolve to `CAPABILITY_UNAVAILABLE` via the orchestrator execution gate (not the hard gate).
- **Git hygiene:** `git add` only the exact files named in each Commit step. Never `git add -A` / `.` / `-u`, never `git commit -a`.
- **Commands:** typecheck = `pnpm typecheck`; full tests = `pnpm test`; single file = `pnpm exec vitest run <path>`.

---

## File Structure

- **`packages/runtime/src/bitget-live-adapter.ts`** (CREATE) — the adapter. Owns: structural upstream types (`UpstreamCaller`, `UpstreamCallResult`), pure order-intent mappers (`buildSpotOrderArgs`, `parseOrderId`), the timeout race (`raceWithTimeout`, `TimeoutError`), the ledger lookup (`findDecisionProposed`), and the factory (`createBitgetLiveAdapter`). One responsibility: turn a governed `ExecutionRequest` into a live spot submission with safe outcomes.
- **`packages/runtime/src/bitget-live-adapter.test.ts`** (CREATE) — unit tests for the pure mappers (Task 1) and the adapter behavior (Task 2), using inline fakes (no real ledger hashing, no MCP SDK).
- **`packages/runtime/src/index.ts`** (MODIFY) — re-export the new module.
- **`packages/mcp-gateway/src/internal-tool-context.ts`** (MODIFY) — replace `adapter` with an `adapters` map.
- **`packages/mcp-gateway/src/internal-tool-handlers.ts`** (MODIFY) — relax the simulator-only hard gate; compute the live spot-only `capabilityUnavailable` gate and select the adapter in `finishExecution`.
- **`packages/mcp-gateway/src/boot-gateway.ts`** (MODIFY) — build the `adapters` map (simulator + bitget_live wired to the upstream client).
- **`packages/mcp-gateway/src/internal-tool-handlers.test.ts`** (MODIFY) — flip the test harness to the `adapters` map, add a `bitget_live` stub, add live spot integration tests.
- **`packages/mcp-gateway/src/gateway-server.test.ts`** (MODIFY) — flip its `InternalToolContext` harness to the `adapters` map (a second harness that builds the context; the type change forces it).
- **`docs/mcp-gateway-contract.md`** (MODIFY) — document the landed `bitget_live` spot execution and unknown/reconciliation semantics (§9.4, §12.3).

---

## Task 1: Runtime — pure order-intent mappers + structural upstream types

**Files:**
- Create: `packages/runtime/src/bitget-live-adapter.ts`
- Test: `packages/runtime/src/bitget-live-adapter.test.ts`

**Interfaces:**
- Consumes: `DecisionProposedPayload` from `@traceguard/schemas` (fields used: `instrument`, `action`, `requestedQuantity?`, `requestedNotionalUsdt?`, `orderType?`, `limitPrice?`).
- Produces:
  - `interface UpstreamCallResult { isError?: boolean; structuredContent?: Record<string, unknown>; content?: unknown; }`
  - `interface UpstreamCaller { callTool(name: string, args: Record<string, unknown>): Promise<UpstreamCallResult>; }`
  - `buildSpotOrderArgs(decision: DecisionProposedPayload): Record<string, string>` — throws `Error("unmappable_action:<action>")` or `Error("missing_order_size")`.
  - `parseOrderId(result: UpstreamCallResult): string | undefined`

- [ ] **Step 1: Write the failing tests for the pure mappers**

Create `packages/runtime/src/bitget-live-adapter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSpotOrderArgs, parseOrderId } from "./bitget-live-adapter.js";
import type { DecisionProposedPayload } from "@traceguard/schemas";

function decision(over: Partial<DecisionProposedPayload> = {}): DecisionProposedPayload {
  return {
    decisionId: "dec_1",
    runId: "run_1",
    envelopeVersion: 1,
    instrument: "BTCUSDT",
    marketType: "spot",
    action: "buy",
    thesis: "t",
    evidenceRefs: [],
    decisionHash: "h".repeat(64),
    ...over,
  };
}

describe("buildSpotOrderArgs", () => {
  it("maps a buy market order: instrument->symbol, side buy, market, size from quantity", () => {
    expect(buildSpotOrderArgs(decision({ action: "buy", requestedQuantity: "0.5" }))).toEqual({
      symbol: "BTCUSDT",
      side: "buy",
      orderType: "market",
      size: "0.5",
    });
  });

  it("maps open_long to side buy", () => {
    expect(buildSpotOrderArgs(decision({ action: "open_long", requestedQuantity: "1" })).side).toBe("buy");
  });

  it("maps sell-family actions (sell/open_short/reduce/close) to side sell", () => {
    for (const action of ["sell", "open_short", "reduce", "close"] as const) {
      expect(buildSpotOrderArgs(decision({ action, requestedQuantity: "1" })).side).toBe("sell");
    }
  });

  it("falls back to requestedNotionalUsdt when quantity is absent", () => {
    expect(buildSpotOrderArgs(decision({ requestedNotionalUsdt: "100" })).size).toBe("100");
  });

  it("prefers requestedQuantity over requestedNotionalUsdt", () => {
    const args = buildSpotOrderArgs(decision({ requestedQuantity: "0.5", requestedNotionalUsdt: "100" }));
    expect(args.size).toBe("0.5");
  });

  it("includes price only for limit orders", () => {
    const limit = buildSpotOrderArgs(decision({ orderType: "limit", limitPrice: "65000", requestedQuantity: "0.5" }));
    expect(limit).toEqual({ symbol: "BTCUSDT", side: "buy", orderType: "limit", size: "0.5", price: "65000" });
    const market = buildSpotOrderArgs(decision({ requestedQuantity: "0.5" }));
    expect(market.price).toBeUndefined();
  });

  it("throws on an unmappable action", () => {
    expect(() => buildSpotOrderArgs(decision({ action: "hold", requestedQuantity: "1" }))).toThrow("unmappable_action:hold");
  });

  it("throws when no order size is present", () => {
    expect(() => buildSpotOrderArgs(decision({}))).toThrow("missing_order_size");
  });
});

describe("parseOrderId", () => {
  it("extracts orderId / order_id / orderID string variants", () => {
    expect(parseOrderId({ structuredContent: { orderId: "OID-1" } })).toBe("OID-1");
    expect(parseOrderId({ structuredContent: { order_id: "OID-2" } })).toBe("OID-2");
    expect(parseOrderId({ structuredContent: { orderID: "OID-3" } })).toBe("OID-3");
  });

  it("coerces a numeric order id to string", () => {
    expect(parseOrderId({ structuredContent: { orderId: 12345 } })).toBe("12345");
  });

  it("returns undefined when no order id is present", () => {
    expect(parseOrderId({ structuredContent: {} })).toBeUndefined();
    expect(parseOrderId({})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/runtime/src/bitget-live-adapter.test.ts`
Expected: FAIL — `Failed to resolve import "./bitget-live-adapter.js"` (the module does not exist yet).

- [ ] **Step 3: Write the minimal implementation (types + pure mappers)**

Create `packages/runtime/src/bitget-live-adapter.ts`:

```ts
import type { DecisionProposedPayload } from "@traceguard/schemas";

export interface UpstreamCallResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: unknown;
}

export interface UpstreamCaller {
  callTool(name: string, args: Record<string, unknown>): Promise<UpstreamCallResult>;
}

const BUY_ACTIONS: ReadonlySet<string> = new Set(["buy", "open_long"]);
const SELL_ACTIONS: ReadonlySet<string> = new Set(["sell", "open_short", "reduce", "close"]);

export function buildSpotOrderArgs(decision: DecisionProposedPayload): Record<string, string> {
  const side = BUY_ACTIONS.has(decision.action)
    ? "buy"
    : SELL_ACTIONS.has(decision.action)
      ? "sell"
      : undefined;
  if (side === undefined) throw new Error(`unmappable_action:${decision.action}`);

  const size = decision.requestedQuantity ?? decision.requestedNotionalUsdt;
  if (size === undefined) throw new Error("missing_order_size");

  const orderType = decision.orderType ?? "market";
  const args: Record<string, string> = {
    symbol: decision.instrument,
    side,
    orderType,
    size,
  };
  if (orderType === "limit" && decision.limitPrice !== undefined) {
    args.price = decision.limitPrice;
  }
  return args;
}

export function parseOrderId(result: UpstreamCallResult): string | undefined {
  const sc = result.structuredContent;
  const candidate = sc?.orderId ?? sc?.order_id ?? sc?.orderID;
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  if (typeof candidate === "number") return String(candidate);
  return undefined;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/runtime/src/bitget-live-adapter.test.ts`
Expected: PASS — all `buildSpotOrderArgs` and `parseOrderId` tests green.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors).

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/bitget-live-adapter.ts packages/runtime/src/bitget-live-adapter.test.ts
git commit -m "feat(runtime): add bitget spot order-intent mappers and structural upstream types"
```

---

## Task 2: Runtime — `createBitgetLiveAdapter` factory + timeout/lookup + index export

**Files:**
- Modify: `packages/runtime/src/bitget-live-adapter.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/bitget-live-adapter.test.ts`

**Interfaces:**
- Consumes: `ExecutionAdapter`, `ExecutionRequest`, `ExecutionResult` from `@traceguard/domain`; `LedgerStore` from `@traceguard/event-ledger`; `LedgerEvent` from `@traceguard/schemas`; plus Task 1's `buildSpotOrderArgs` / `parseOrderId` / `UpstreamCaller`.
- Produces:
  - `interface BitgetLiveAdapterDeps { store: LedgerStore; client: UpstreamCaller; workspaceId: string; hash: (input: string) => string; timeoutMs?: number; }`
  - `createBitgetLiveAdapter(deps: BitgetLiveAdapterDeps): ExecutionAdapter` — `adapterType: "bitget_live"`. On `call`: throws on pre-submit failure (`decision_intent_not_found`, `unmappable_action:*`, `missing_order_size`, `upstream_rejected`); returns `{kind:"unknown"}` on timeout (`timeout_after_submit`), connection loss (`connection_lost_after_submit`), or missing receipt (`receipt_lookup_failed`); returns `{kind:"completed", finalStatus:"submitted", receiptRef:"receipt:bitget:<orderId>", upstreamRef:<orderId>}` on success.

- [ ] **Step 1: Write the failing adapter behavior tests**

Edit `packages/runtime/src/bitget-live-adapter.test.ts`. Replace the first two import lines:

```ts
import { describe, it, expect } from "vitest";
import { buildSpotOrderArgs, parseOrderId } from "./bitget-live-adapter.js";
import type { DecisionProposedPayload } from "@traceguard/schemas";
```

with:

```ts
import { describe, it, expect } from "vitest";
import { buildSpotOrderArgs, parseOrderId, createBitgetLiveAdapter } from "./bitget-live-adapter.js";
import type { UpstreamCaller, UpstreamCallResult } from "./bitget-live-adapter.js";
import type { DecisionProposedPayload, LedgerEvent } from "@traceguard/schemas";
import type { ExecutionRequest } from "@traceguard/domain";
import type { LedgerStore } from "@traceguard/event-ledger";
```

Then append this block to the end of the file:

```ts
function decisionEvent(decisionId: string, runId: string, payload: DecisionProposedPayload): LedgerEvent {
  return { eventType: "DecisionProposed", aggregateId: decisionId, runId, payload } as unknown as LedgerEvent;
}

function fakeStore(events: LedgerEvent[]): LedgerStore {
  return {
    async read() {
      return events;
    },
    async head() {
      return null;
    },
    async append() {},
  };
}

function caller(impl: (name: string, args: Record<string, unknown>) => UpstreamCallResult | Promise<UpstreamCallResult>): UpstreamCaller {
  return {
    async callTool(name, args) {
      return impl(name, args);
    },
  };
}

function request(over: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    executionId: "exec_1",
    runId: "run_1",
    decisionId: "dec_1",
    authorizationId: "authz_1",
    actionDigest: "d".repeat(64),
    idempotencyKey: "idem_1",
    requestRef: "ref_1",
    requestHash: "rh_1",
    ...over,
  };
}

const hash = (s: string): string => `H:${s}`;

function adapterDeps(events: LedgerEvent[], client: UpstreamCaller, timeoutMs?: number) {
  return { store: fakeStore(events), client, workspaceId: "ws_1", hash, ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
}

describe("createBitgetLiveAdapter", () => {
  const seeded = (over: Partial<DecisionProposedPayload> = {}) => [
    decisionEvent("dec_1", "run_1", {
      decisionId: "dec_1",
      runId: "run_1",
      envelopeVersion: 1,
      instrument: "BTCUSDT",
      marketType: "spot",
      action: "buy",
      thesis: "t",
      evidenceRefs: [],
      decisionHash: "h".repeat(64),
      requestedQuantity: "0.5",
      ...over,
    }),
  ];

  it("submits the mapped spot order and returns a completed submitted receipt", async () => {
    let captured: { name: string; args: Record<string, unknown> } | undefined;
    const client = caller((name, args) => {
      captured = { name, args };
      return { structuredContent: { orderId: "OID-9" } };
    });
    const adapter = createBitgetLiveAdapter(adapterDeps(seeded(), client));

    const result = await adapter.call(request());

    expect(captured).toEqual({
      name: "spot_place_order",
      args: { symbol: "BTCUSDT", side: "buy", orderType: "market", size: "0.5" },
    });
    expect(result).toEqual({
      kind: "completed",
      finalStatus: "submitted",
      receiptRef: "receipt:bitget:OID-9",
      receiptHash: "H:receipt:bitget:OID-9:rh_1",
      upstreamRef: "OID-9",
    });
  });

  it("throws when the DecisionProposed intent cannot be found (pre-submit, fail closed)", async () => {
    const adapter = createBitgetLiveAdapter(adapterDeps([], caller(() => ({ structuredContent: { orderId: "x" } }))));
    await expect(adapter.call(request())).rejects.toThrow("decision_intent_not_found");
  });

  it("throws when the upstream returns an error result (pre-submit reject)", async () => {
    const adapter = createBitgetLiveAdapter(adapterDeps(seeded(), caller(() => ({ isError: true }))));
    await expect(adapter.call(request())).rejects.toThrow("upstream_rejected");
  });

  it("returns unknown/receipt_lookup_failed when no order id comes back", async () => {
    const adapter = createBitgetLiveAdapter(adapterDeps(seeded(), caller(() => ({ structuredContent: {} }))));
    expect(await adapter.call(request())).toEqual({ kind: "unknown", reasonCode: "receipt_lookup_failed" });
  });

  it("returns unknown/timeout_after_submit when the upstream call exceeds the timeout", async () => {
    const adapter = createBitgetLiveAdapter(
      adapterDeps(seeded(), caller(() => new Promise<UpstreamCallResult>(() => {})), 5),
    );
    expect(await adapter.call(request())).toEqual({ kind: "unknown", reasonCode: "timeout_after_submit" });
  });

  it("returns unknown/connection_lost_after_submit when the upstream call rejects", async () => {
    const adapter = createBitgetLiveAdapter(
      adapterDeps(seeded(), caller(() => Promise.reject(new Error("socket hang up")))),
    );
    expect(await adapter.call(request())).toEqual({ kind: "unknown", reasonCode: "connection_lost_after_submit" });
  });

  it("selects the decision matching request.decisionId when the ledger holds several", async () => {
    // A non-matching decision is seeded FIRST, so a naive "take the first
    // DecisionProposed" lookup would submit the wrong order and fail this test.
    const events = [
      decisionEvent("dec_other", "run_1", {
        decisionId: "dec_other",
        runId: "run_1",
        envelopeVersion: 1,
        instrument: "ETHUSDT",
        marketType: "spot",
        action: "sell",
        thesis: "t",
        evidenceRefs: [],
        decisionHash: "h".repeat(64),
        requestedQuantity: "2",
      }),
      ...seeded(),
    ];
    let captured: { name: string; args: Record<string, unknown> } | undefined;
    const client = caller((name, args) => {
      captured = { name, args };
      return { structuredContent: { orderId: "OID-7" } };
    });
    const adapter = createBitgetLiveAdapter(adapterDeps(events, client));

    await adapter.call(request({ decisionId: "dec_1" }));

    expect(captured?.args.symbol).toBe("BTCUSDT");
    expect(captured?.args.side).toBe("buy");
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pnpm exec vitest run packages/runtime/src/bitget-live-adapter.test.ts`
Expected: FAIL — `createBitgetLiveAdapter` is not exported (`createBitgetLiveAdapter is not a function`). The Task 1 mapper tests still pass.

- [ ] **Step 3: Implement the factory, timeout race, and ledger lookup**

Edit `packages/runtime/src/bitget-live-adapter.ts`. Replace the first import line:

```ts
import type { DecisionProposedPayload } from "@traceguard/schemas";
```

with:

```ts
import type { ExecutionAdapter, ExecutionRequest, ExecutionResult } from "@traceguard/domain";
import type { LedgerStore } from "@traceguard/event-ledger";
import type { DecisionProposedPayload } from "@traceguard/schemas";
```

Then append to the end of the file:

```ts
const DEFAULT_TIMEOUT_MS = 10_000;

class TimeoutError extends Error {
  constructor() {
    super("upstream_timeout");
    this.name = "TimeoutError";
  }
}

function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

async function findDecisionProposed(
  store: LedgerStore,
  workspaceId: string,
  runId: string,
  decisionId: string,
): Promise<DecisionProposedPayload | undefined> {
  const events = await store.read(workspaceId, runId);
  const event = events.find((e) => e.eventType === "DecisionProposed" && e.aggregateId === decisionId);
  return event?.payload as DecisionProposedPayload | undefined;
}

export interface BitgetLiveAdapterDeps {
  store: LedgerStore;
  client: UpstreamCaller;
  workspaceId: string;
  hash: (input: string) => string;
  timeoutMs?: number;
}

export function createBitgetLiveAdapter(deps: BitgetLiveAdapterDeps): ExecutionAdapter {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    adapterType: "bitget_live",
    async call(request: ExecutionRequest): Promise<ExecutionResult> {
      // Recover the order intent from the rich DecisionProposed event (Option A):
      // the digest-centric ExecutionRequest never carries the order body.
      const decision = await findDecisionProposed(deps.store, deps.workspaceId, request.runId, request.decisionId);
      if (decision === undefined) throw new Error("decision_intent_not_found");

      // Pre-submit mapping failures throw -> orchestrator -> RunFailed -> EXECUTION_FAILED.
      const args = buildSpotOrderArgs(decision);

      let result: UpstreamCallResult;
      try {
        result = await raceWithTimeout(deps.client.callTool("spot_place_order", args), timeoutMs);
      } catch (err) {
        // The order may already be live: never retry, surface for reconciliation.
        return err instanceof TimeoutError
          ? { kind: "unknown", reasonCode: "timeout_after_submit" }
          : { kind: "unknown", reasonCode: "connection_lost_after_submit" };
      }

      // An explicit error result is a clean pre-submit reject (nothing was placed).
      if (result.isError === true) throw new Error("upstream_rejected");

      const orderId = parseOrderId(result);
      // Submitted but we cannot read the receipt: post-submit ambiguity, not a retry.
      if (orderId === undefined) return { kind: "unknown", reasonCode: "receipt_lookup_failed" };

      return {
        kind: "completed",
        finalStatus: "submitted",
        receiptRef: `receipt:bitget:${orderId}`,
        receiptHash: deps.hash(`receipt:bitget:${orderId}:${request.requestHash}`),
        upstreamRef: orderId,
      };
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/runtime/src/bitget-live-adapter.test.ts`
Expected: PASS — all mapper and adapter tests green (timeout test settles in ~5ms).

- [ ] **Step 5: Export the module from the runtime package index**

Edit `packages/runtime/src/index.ts` — append one line so the final file is:

```ts
export * from "./simulator-adapter.js";
export * from "./execution-orchestrator.js";
export * from "./bitget-live-adapter.js";
```

- [ ] **Step 6: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: PASS (no errors).

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/bitget-live-adapter.ts packages/runtime/src/bitget-live-adapter.test.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): add createBitgetLiveAdapter for governed spot execution"
```

---

## Task 3: mcp-gateway — wire the adapter map and execute bitget_live spot orders

**Files:**
- Modify: `packages/mcp-gateway/src/internal-tool-context.ts`
- Modify: `packages/mcp-gateway/src/internal-tool-handlers.ts:240-247,314-336,385-406`
- Modify: `packages/mcp-gateway/src/boot-gateway.ts:13,113-122`
- Test: `packages/mcp-gateway/src/internal-tool-handlers.test.ts`
- Test: `packages/mcp-gateway/src/gateway-server.test.ts:86-95` (second context harness — type change forces the flip)

**Interfaces:**
- Consumes: `createBitgetLiveAdapter` and `createSimulatorAdapter` from `@traceguard/runtime`; `ExecutionAdapter` from `@traceguard/domain`; `ExecutionAdapterType` from `@traceguard/schemas`.
- Produces: `InternalToolContext.adapters: Partial<Record<ExecutionAdapterType, ExecutionAdapter>>` (replaces `adapter`). `finishExecution` selects `adapters[adapterType] ?? adapters.simulator!` and computes `capabilityUnavailable = adapterType === "bitget_live" && actionDigestInput.marketType !== "spot"`.

### Cycle A — refactor the context to an adapter map (behavior-preserving)

- [ ] **Step 1: Replace the single adapter with an adapters map in the context type**

Edit `packages/mcp-gateway/src/internal-tool-context.ts`. Change the import line:

```ts
import type { Policy } from "@traceguard/schemas";
```

to:

```ts
import type { Policy, ExecutionAdapterType } from "@traceguard/schemas";
```

and change the field:

```ts
  adapter: ExecutionAdapter; // simulator in 3E-1
```

to:

```ts
  adapters: Partial<Record<ExecutionAdapterType, ExecutionAdapter>>; // simulator + bitget_live
```

- [ ] **Step 2: Select the adapter from the map in `finishExecution`**

Edit `packages/mcp-gateway/src/internal-tool-handlers.ts`. In `finishExecution`, replace the `executionOrchestrator` call (the block currently passing `executionGates: { capabilityUnavailable: false, ... }` and `adapter: ctx.adapter`):

```ts
  const { outcome } = await executionOrchestrator(
    {
      workspaceId: ws,
      runId: ctx.run.runId,
      decisionId,
      attemptedActionDigest,
      adapterType,
      gates: { workspaceLocked: false, manifestChanged: false, policyChanged: false },
      executionGates: { capabilityUnavailable: false, snapshotStale: false, manifestUnapproved: false },
    },
    { ...ctx.deps, store: ctx.store, adapter: ctx.adapter },
  );
```

with:

```ts
  const adapter = ctx.adapters[adapterType] ?? ctx.adapters.simulator!;
  const { outcome } = await executionOrchestrator(
    {
      workspaceId: ws,
      runId: ctx.run.runId,
      decisionId,
      attemptedActionDigest,
      adapterType,
      gates: { workspaceLocked: false, manifestChanged: false, policyChanged: false },
      executionGates: { capabilityUnavailable: false, snapshotStale: false, manifestUnapproved: false },
    },
    { ...ctx.deps, store: ctx.store, adapter },
  );
```

- [ ] **Step 3: Build the adapters map in boot**

Edit `packages/mcp-gateway/src/boot-gateway.ts`. Change the import line:

```ts
import { createSimulatorAdapter } from "@traceguard/runtime";
```

to:

```ts
import { createSimulatorAdapter, createBitgetLiveAdapter } from "@traceguard/runtime";
```

and in the `internalCtx` object replace:

```ts
    adapter: createSimulatorAdapter({ hash: deps.hash }),
```

with:

```ts
    adapters: {
      simulator: createSimulatorAdapter({ hash: deps.hash }),
      bitget_live: createBitgetLiveAdapter({
        store,
        client,
        workspaceId: args.workspaceId,
        hash: deps.hash,
        timeoutMs: 10_000,
      }),
    },
```

- [ ] **Step 4: Flip the test harness to the adapters map and add a bitget_live stub**

Edit `packages/mcp-gateway/src/internal-tool-handlers.test.ts`. Add an import after the existing `@traceguard/domain` import (line 4):

```ts
import type { ExecutionAdapter, ExecutionResult } from "@traceguard/domain";
```

Replace the `context` helper (currently lines 16-27) with:

```ts
function stubBitgetLive(result: ExecutionResult): ExecutionAdapter {
  return { adapterType: "bitget_live", async call() { return result; } };
}

function context(
  clock: { now: () => string } = new SystemClock(),
  bitget: ExecutionResult = {
    kind: "completed",
    finalStatus: "submitted",
    receiptRef: "receipt:bitget:OID-1",
    receiptHash: sha256hex("receipt:bitget:OID-1"),
    upstreamRef: "OID-1",
  },
): InternalToolContext {
  return {
    store: new InMemoryLedgerStore(),
    deps: { clock, newId: new SystemIdGen(), hash: sha256hex },
    audit: { workspaceId: "ws_demo", runId: "run_demo", providerConnectionId: "pc_bitget" },
    policy: DEFAULT_POLICY,
    adapters: {
      simulator: createSimulatorAdapter({ hash: sha256hex }),
      bitget_live: stubBitgetLive(bitget),
    },
    run: { runId: "run_demo", mode: "safe_demo" },
    cache: createDecisionCache(),
    ttls: { approvalSeconds: 900, authorizationSeconds: 900 },
  };
}
```

- [ ] **Step 5: Flip the second context harness in `gateway-server.test.ts`**

`gateway-server.test.ts` builds its own `InternalToolContext` (at lines 86-95), so the `adapter` → `adapters` type change forces it to update too or the workspace will not typecheck. It does not exercise live execution, so the simulator entry alone is enough (`finishExecution` falls back to `adapters.simulator!` for any other type). It already imports `createSimulatorAdapter`, so no new import is needed.

Edit `packages/mcp-gateway/src/gateway-server.test.ts`. In `makeInternalCtx`, replace:

```ts
    adapter: createSimulatorAdapter({ hash: sha256hex }),
```

with:

```ts
    adapters: { simulator: createSimulatorAdapter({ hash: sha256hex }) },
```

- [ ] **Step 6: Add a guard test pinning the relaxed gate to simulator + bitget_live only**

This guard is green now (the `!== "simulator"` hard gate rejects `replay`) and must stay green after Cycle B relaxes the gate — it proves the relaxation opens the gate for `bitget_live` only, never for an unregistered adapter type. Edit `packages/mcp-gateway/src/internal-tool-handlers.test.ts`; add this test inside the `describe("dispatchInternalTool", ...)` block, immediately after the existing "rejects non-simulator adapters with CAPABILITY_UNAVAILABLE" test (lines 159-171):

```ts
  it("rejects an unregistered adapter type (replay) with CAPABILITY_UNAVAILABLE", async () => {
    const ctx = context();
    const state = gatewayState();
    await dispatchInternalTool(ctx, state, "traceguard_start_run", { runId: "run_demo" });
    const rec = await record(ctx, state, { requestedNotionalUsdt: "100", requestedLeverage: "2" });
    const decisionId = tg(rec).decisionId as string;
    const exec = await dispatchInternalTool(ctx, state, "traceguard_request_execution", {
      runId: "run_demo",
      decisionId,
      executionAdapter: "replay",
    });
    expect(tg(exec).errorCode).toBe("CAPABILITY_UNAVAILABLE");
  });
```

- [ ] **Step 7: Run the full gateway suite and typecheck to confirm behavior is preserved**

Run: `pnpm exec vitest run packages/mcp-gateway && pnpm typecheck`
Expected: PASS — every existing test stays green (simulator allow path unchanged; `bitget_live` + futures and the new `replay` guard both return `CAPABILITY_UNAVAILABLE` via the unchanged hard gate; `gateway-server.test.ts` unaffected by the harness flip). No type errors.

- [ ] **Step 8: Commit the refactor**

```bash
git add packages/mcp-gateway/src/internal-tool-context.ts packages/mcp-gateway/src/internal-tool-handlers.ts packages/mcp-gateway/src/boot-gateway.ts packages/mcp-gateway/src/internal-tool-handlers.test.ts packages/mcp-gateway/src/gateway-server.test.ts
git commit -m "refactor(mcp-gateway): thread an execution-adapter map through the internal context"
```

### Cycle B — execute bitget_live spot orders end-to-end

- [ ] **Step 9: Write the failing live spot integration tests**

The existing "rejects non-simulator adapters with CAPABILITY_UNAVAILABLE" test records a **futures** decision (`record()` defaults to `marketType:"futures"`), so it already covers the `bitget_live` + non-spot → `CAPABILITY_UNAVAILABLE` path once the gate is relaxed — no separate futures test is needed here.

Edit `packages/mcp-gateway/src/internal-tool-handlers.test.ts`. Add these two tests inside the `describe("dispatchInternalTool", ...)` block, immediately after the `replay` guard added in Cycle A Step 6:

```ts
  it("executes a bitget_live spot decision to ALLOWED with a submitted bitget receipt", async () => {
    const ctx = context();
    const state = gatewayState();
    await dispatchInternalTool(ctx, state, "traceguard_start_run", { runId: "run_demo" });
    const rec = await record(ctx, state, { marketType: "spot", action: "buy", requestedNotionalUsdt: "100" });
    const decisionId = tg(rec).decisionId as string;

    const exec = await dispatchInternalTool(ctx, state, "traceguard_request_execution", {
      runId: "run_demo",
      decisionId,
      executionAdapter: "bitget_live",
    });
    expect(tg(exec).status).toBe("ALLOWED");
    expect((tg(exec).receipt as { receiptRef?: string }).receiptRef).toBe("receipt:bitget:OID-1");
    expect((tg(exec).receipt as { finalStatus?: string }).finalStatus).toBe("submitted");
  });

  it("surfaces a bitget_live post-submit ambiguity as EXECUTION_UNKNOWN", async () => {
    const ctx = context(new SystemClock(), { kind: "unknown", reasonCode: "timeout_after_submit" });
    const state = gatewayState();
    await dispatchInternalTool(ctx, state, "traceguard_start_run", { runId: "run_demo" });
    const rec = await record(ctx, state, { marketType: "spot", action: "buy", requestedNotionalUsdt: "100" });
    const decisionId = tg(rec).decisionId as string;

    const exec = await dispatchInternalTool(ctx, state, "traceguard_request_execution", {
      runId: "run_demo",
      decisionId,
      executionAdapter: "bitget_live",
    });
    expect((exec as { isError?: boolean }).isError).toBe(true);
    expect(tg(exec).errorCode).toBe("EXECUTION_UNKNOWN");
  });
```

- [ ] **Step 10: Run the new tests to verify they fail**

Run: `pnpm exec vitest run packages/mcp-gateway/src/internal-tool-handlers.test.ts`
Expected: FAIL — both new tests get `errorCode: "CAPABILITY_UNAVAILABLE"` (status is not `ALLOWED`, errorCode is not `EXECUTION_UNKNOWN`) because the simulator-only hard gate still rejects `bitget_live` before execution.

- [ ] **Step 11: Relax the hard gate and enforce spot-only live via the execution gate**

Edit `packages/mcp-gateway/src/internal-tool-handlers.ts`.

(a) In `requestExecution`, change:

```ts
  const executionAdapter = (args.executionAdapter ?? "simulator") as ExecutionAdapterType;
  if (executionAdapter !== "simulator") return internalErr("CAPABILITY_UNAVAILABLE", name);
```

to:

```ts
  const executionAdapter = (args.executionAdapter ?? "simulator") as ExecutionAdapterType;
  if (executionAdapter !== "simulator" && executionAdapter !== "bitget_live") {
    return internalErr("CAPABILITY_UNAVAILABLE", name);
  }
```

(b) In `executeAuthorizedAction`, change the identical pair:

```ts
  const executionAdapter = (args.executionAdapter ?? "simulator") as ExecutionAdapterType;
  if (executionAdapter !== "simulator") return internalErr("CAPABILITY_UNAVAILABLE", name);
```

to:

```ts
  const executionAdapter = (args.executionAdapter ?? "simulator") as ExecutionAdapterType;
  if (executionAdapter !== "simulator" && executionAdapter !== "bitget_live") {
    return internalErr("CAPABILITY_UNAVAILABLE", name);
  }
```

(c) In `finishExecution`, change the `capabilityUnavailable: false` literal to the computed gate. Replace:

```ts
  const adapter = ctx.adapters[adapterType] ?? ctx.adapters.simulator!;
  const { outcome } = await executionOrchestrator(
    {
      workspaceId: ws,
      runId: ctx.run.runId,
      decisionId,
      attemptedActionDigest,
      adapterType,
      gates: { workspaceLocked: false, manifestChanged: false, policyChanged: false },
      executionGates: { capabilityUnavailable: false, snapshotStale: false, manifestUnapproved: false },
    },
    { ...ctx.deps, store: ctx.store, adapter },
  );
```

with:

```ts
  // Live execution is spot-only in this slice: a non-spot bitget_live attempt is
  // rejected by the orchestrator's execution gate (capability_unavailable), never
  // hard-gated away, so it lands an auditable ExecutionRejected on the ledger.
  const capabilityUnavailable = adapterType === "bitget_live" && actionDigestInput.marketType !== "spot";
  const adapter = ctx.adapters[adapterType] ?? ctx.adapters.simulator!;
  const { outcome } = await executionOrchestrator(
    {
      workspaceId: ws,
      runId: ctx.run.runId,
      decisionId,
      attemptedActionDigest,
      adapterType,
      gates: { workspaceLocked: false, manifestChanged: false, policyChanged: false },
      executionGates: { capabilityUnavailable, snapshotStale: false, manifestUnapproved: false },
    },
    { ...ctx.deps, store: ctx.store, adapter },
  );
```

- [ ] **Step 12: Run the new tests to verify they pass**

Run: `pnpm exec vitest run packages/mcp-gateway/src/internal-tool-handlers.test.ts`
Expected: PASS — the spot decision returns `ALLOWED` with `receipt:bitget:OID-1` / `submitted`; the unknown stub returns `EXECUTION_UNKNOWN`. The existing `bitget_live` + futures test still returns `CAPABILITY_UNAVAILABLE` (now via the execution gate).

- [ ] **Step 13: Run the full workspace test suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS — all packages green, no type errors.

- [ ] **Step 14: Commit**

```bash
git add packages/mcp-gateway/src/internal-tool-handlers.ts packages/mcp-gateway/src/internal-tool-handlers.test.ts
git commit -m "feat(mcp-gateway): execute bitget_live spot orders through the governed path"
```

---

## Task 4: Docs — record the landed bitget_live spot execution semantics

**Files:**
- Modify: `docs/mcp-gateway-contract.md:654,925`

**Interfaces:**
- Consumes: nothing (documentation only). Mirrors the behavior shipped in Tasks 1-3.

- [ ] **Step 1: Document live spot execution in §9.4 (Handling Path: Trade-like)**

Edit `docs/mcp-gateway-contract.md`. Immediately after the existing `> **3E-1 (landed):** ...` blockquote at §9.4 (the line ending "...remain deferred to **3E-2**."), insert a new blockquote paragraph:

```markdown
>
> **3E-2c (landed):** `request_execution` / `execute_authorized_action` now accept `executionAdapter: "bitget_live"` in addition to `"simulator"`. The `bitget_live` adapter recovers the order intent from the run's `DecisionProposed` ledger event (the digest-centric `ExecutionRequest` carries no order body), maps it to the upstream `spot_place_order` call, and settles `ExecutionCompleted` with `finalStatus: "submitted"` and `receiptRef: "receipt:bitget:<orderId>"`. Live execution is **spot-only**: a non-spot `bitget_live` attempt is rejected by the execution gate as `CAPABILITY_UNAVAILABLE` (an auditable `ExecutionRejected`, `executionSent:false`). Pre-submit failures (intent not found, unmappable action, missing size, upstream error result) fail closed to `EXECUTION_FAILED`; post-submit ambiguity (timeout, connection loss, unreadable receipt) settles `ExecutionUnknown` (`reconciliationRequired:true`, `retryBlocked:true`) and returns `EXECUTION_UNKNOWN` — never retried. Argument JSON-Schema validation (§9.2) and result redaction (§9.3) on the forwarded path remain deferred.
```

- [ ] **Step 2: Document the adapter outcomes in §12.3 (`traceguard_request_execution`)**

Edit `docs/mcp-gateway-contract.md`. Immediately after the existing `> **3E-1 (landed):** ...` blockquote at §12.3 (the line ending "...already settled the run."), insert:

```markdown
>
> **3E-2c (landed):** On an `allow` outcome with `executionAdapter: "bitget_live"` and a **spot** decision, `request_execution` issues + burns the authorization and submits the order live, returning `ALLOWED` with `receipt.finalStatus: "submitted"` and `receipt.receiptRef: "receipt:bitget:<orderId>"`. A post-submit ambiguity returns `isError:true` with `errorCode: "EXECUTION_UNKNOWN"` (the run is left for reconciliation, not retried). A non-spot `bitget_live` decision returns `CAPABILITY_UNAVAILABLE`. The `simulator` adapter behavior is unchanged.
```

- [ ] **Step 3: Sanity-check the edited sections**

Run: `grep -n "3E-2c (landed)" docs/mcp-gateway-contract.md`
Expected: two matches (one in §9.4, one in §12.3).

- [ ] **Step 4: Commit**

```bash
git add docs/mcp-gateway-contract.md
git commit -m "docs(mcp-gateway): document landed bitget_live spot execution and unknown semantics"
```

---

## Final Review

After all four tasks are complete and committed, dispatch a final code review across the full implementation (Tasks 1-4) covering: the fail-safe boundary (pre-submit throw vs post-submit unknown), the spot-only gate, the structural `UpstreamCaller` (no MCP SDK leak into runtime), and the adapter-map wiring. Then use **superpowers:finishing-a-development-branch** to verify the suite and present completion options.
