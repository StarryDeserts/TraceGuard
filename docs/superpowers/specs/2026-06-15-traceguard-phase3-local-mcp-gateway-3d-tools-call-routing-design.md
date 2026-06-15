# TraceGuard Phase 3 — Sub-project 3D: Governed `tools/call` Routing Pipeline

**Document status:** Design v1.0 (approved for planning)
**Date:** 2026-06-15
**Package:** `@traceguard/mcp-gateway` (extends merged 1A + 1B + 2 + 3A + 3B + 3C on `main`), plus small additive payload schemas in `@traceguard/schemas`
**Builds on:** 3C (running stdio downstream `Server` answering `initialize` + `tools/list`, with a long-lived upstream connection and a fail-closed `tools/call` stub)

---

## 1. Scope & Position in Phase 3

### 1.1 What 3D delivers

3D replaces 3C's blanket `TOOL_CALL_NOT_AVAILABLE` stub with **real governed `tools/call` routing** that reuses the long-lived upstream connection from the `GatewayHandle`. A connected agent can now actually *invoke* the read tools it sees in `tools/list`; everything dangerous fails closed with a precise, audited reason.

Concretely, 3D adds five capabilities on top of 3C:

1. **Pure call router** — `routeCall(state, name)` classifies every requested tool against the governed route table (all tools, not just the visible ones) into a forward-or-deny outcome. Table-driven and golden-testable without the SDK.
2. **Governed forwarding** — read-class calls (`public_read`, `account_read`) are forwarded to the real upstream server via a new `client.callTool(...)` seam, and the **raw upstream result is returned to the agent**.
3. **Fail-closed call denials** — `trade_like` → `DECISION_ENVELOPE_REQUIRED`; a direct call to a hidden dangerous tool (`asset_movement` / `administrative`, status `blocked`) → `TOOL_BLOCKED` **plus an `IncidentOpened`**; a `frozen` tool → `TOOL_FROZEN`; an unknown name → `UNKNOWN_TOOL`.
4. **Tool-call audit trail** — every governed call appends ledger events on the run aggregate: forwards record `ToolCallRequested` → (`ToolCallCompleted` | `ToolCallFailed`); denials record one `ToolCallDenied` (+ `IncidentOpened` for `TOOL_BLOCKED`). The ledger stores **digests only** — `argumentsDigest` / `resultDigest` — never raw arguments or response bodies.
5. **Run anchor** — `bootGateway` emits exactly one `RunCreated` event after the manifest events on a successful boot and threads the new `runId` onto the `GatewayHandle` and into the call context.

### 1.2 What 3D does NOT build (deferred to 3E)

- **Decision Envelope creation/validation, policy evaluation, approval gating, authorization, execution adapters.** `trade_like` dead-ends at a fail-closed `DECISION_ENVELOPE_REQUIRED` deny; 3E replaces that single branch with the envelope → policy → approval → execution flow, reusing the primitives already built in Phases 1B/2 (`approvalProjection`, `authorizationProjection`, `runStatusProjection`, `propose-decision`).
- **`traceguard_*` internal tools** (`traceguard_start_run`, propose/approve/execute surface) and the **full run lifecycle** (`RunStarted` / `RunCompleted` / `RunFailed`). 3D emits only the `RunCreated` anchor.
- **JSON-Schema argument validation** (no `ajv`) and **response redaction** (contract §9.3 / §20). Arguments are forwarded as received; results are returned verbatim. Only digests are persisted.
- **OTel spans** (§3E), **idempotency** (§17, N/A for read forwards), **persistent (file/sqlite) ledger** (stays behind the unchanged `LedgerStore` interface), **hosted HTTP transport** and the `mcp-core` / `apps/*` package split — everything stays in `@traceguard/mcp-gateway`.

### 1.3 Locked decisions (from brainstorming, 2026-06-15)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Call-routing scope | **Option A — read-pass-through + danger-fail-closed.** `public_read` / `account_read` truly forward and return real upstream results; `trade_like` → `DECISION_ENVELOPE_REQUIRED`; `blocked` → `TOOL_BLOCKED` (+`IncidentOpened`); `frozen` → `TOOL_FROZEN`; unknown → `UNKNOWN_TOOL`. Full envelope/policy/approval/execution path deferred to 3E. |
| D2 | Run anchor | **One `RunCreated` at boot** (happy path, after the manifest events). `GatewayHandle` gains `runId`. Degraded boot emits no run; `tools/call` then short-circuits to `TOOL_CALL_NOT_AVAILABLE`. |
| D3 | Direct-danger incident | **A direct call to a `blocked` tool additionally appends `IncidentOpened`** (`aggregateType: "incident"`, `actorType: "system"`). A `frozen` deny does not (safety hold, not an attack). |
| D4 | Ledger payload privacy | **Digests only.** `argumentsDigest = hash(canonicalJson(arguments))`, `resultDigest = hash(canonicalJson(result))`. Raw arguments/bodies never enter the ledger (the raw body is still returned to the agent). |
| D5 | Validation / redaction | **Deferred.** No JSON-Schema arg validation, no response redaction in 3D. |

### 1.4 Disclosure — refinement of the Section-1 framing

During brainstorming this work was framed as "almost entirely inside `mcp-gateway`, zero `@traceguard/schemas` changes." Grounding the event model against the house convention (every emitted event validates its payload through a Zod schema) shows 3D **must add small additive payload schemas** to `@traceguard/schemas`: `RunCreatedPayload`, `ToolCallRequestedPayload`, `ToolCallCompletedPayload`, `ToolCallFailedPayload`, `ToolCallDeniedPayload`, `IncidentOpenedPayload`. These are **purely additive** new exports following the existing `ToolBlockedPayload` / `ToolFrozenPayload` pattern. The ledger **envelope and enums are unchanged**: `eventType` is an open `z.string().min(1)`, and `aggregateType` already contains `run` and `incident`. No existing schema is modified except the `run-payloads.ts` file gaining one new export and the barrel gaining one new line.

---

## 2. Architecture

3D preserves the functional-core / imperative-shell split. Routing (`routeCall`) and event construction (`tool-call-events.ts`) are **pure / dependency-injected** and unit-tested without the SDK or a live server. The call orchestration (`handleToolCall`) and the upstream `callTool` seam are thin shells.

### 2.1 Module map

**Under `packages/mcp-gateway/src/`:**

```text
call-router.ts        PURE   routeCall(state, name) → RouteOutcome; types RouteOutcome / CallDenyCode
tool-call-events.ts   PURE*  CallAudit + record{RunCreated,ToolCallRequested,ToolCallCompleted,
                             ToolCallFailed,ToolCallDenied,IncidentOpened}() event builders (deps-injected)
call-handler.ts       SHELL  handleToolCall(state, ctx, name, args); denyCall(); GatewayCallContext;
                             CallErrorCode / ToolCallDenial — the route→emit→forward orchestration
gateway-state.ts      MOD    GatewayState gains route: Map<name, RouteEntry>; built from view.tools (ALL)
gateway-server.ts     MOD    createGatewayServer(state, callCtx?) → CallTool handler delegates to handleToolCall
upstream-client.ts    MOD    UpstreamManifestClient gains callTool(name, args); new UpstreamCallError
stdio-upstream-client.ts MOD implements callTool over SDK Client.callTool (10s timeout)
boot-gateway.ts       MOD    happy path emits RunCreated; GatewayHandle gains runId; builds GatewayCallContext
index.ts              MOD    barrel: add call-router / tool-call-events / call-handler
```

`PURE*` = pure given injected `deps = { clock, newId, hash }`; no ambient I/O, fully deterministic in tests with a fake clock/id/hash.

**Under `packages/schemas/src/`:**

```text
tool-call-payloads.ts CREATE ToolCallRequested/Completed/Failed/Denied + IncidentOpened payload schemas
run-payloads.ts       MOD    add RunCreatedPayload
index.ts              MOD    barrel: add ./tool-call-payloads.js
```

### 2.2 Rejected alternative

Fold routing + orchestration directly into `gateway-server.ts`'s `CallTool` handler (no `call-router.ts` / `call-handler.ts`). Rejected: it fuses the pure routing table with SDK wiring and store I/O, so the six-way risk-class decision can't be golden-tested in isolation, and the handler balloons past single-responsibility. The chosen split adds two small files but keeps the security-critical routing decision pure and exhaustively table-testable — exactly the 3C `gateway-state.ts` precedent.

### 2.3 Why the route table carries ALL tools, not just the visible set

`routeCall` keys off `state.route`, built from the projection's **entire** `view.tools` (active + blocked + frozen) — not `state.servedTools` (visible only). An agent can fabricate a `tools/call` for a name it never saw in `tools/list` (a hidden `withdraw`). If the router only knew the visible set, such a call would fall through to `UNKNOWN_TOOL` and lose the `TOOL_BLOCKED` + incident signal. Sourcing the table from all governed entries means a direct hit on a hidden dangerous tool is correctly classified, denied as `TOOL_BLOCKED`, and raises an `IncidentOpened`.

---

## 3. Data Flow

### 3.1 Startup delta (once, `bootGateway` happy path)

3C's boot pipeline (open → list → reconcile → append → read → project → buildState) is unchanged through `buildGatewayState`. 3D appends a run anchor and builds the call context:

```text
... (3C steps 1–9 unchanged: produces `state` with servedTools + route) ...
10. runId = deps.newId.next("run")
11. head  = store.head(workspaceId)                       // head after the manifest events
12. runEv = recordRunCreated({ workspaceId, runId, providerConnectionId }, deps, head)
13. store.append(head, [runEv])                           // RunCreated chains after the manifest
14. callCtx = { client, store, deps, audit: { workspaceId, runId, providerConnectionId } }
15. server  = createGatewayServer(state, callCtx)
→ return { state, server, client, runId }                 // client stays open for routing
```

Degraded boot (upstream unavailable / listTools failed): unchanged from 3C — `state = degradedState()`, **no** `RunCreated`, `server = createGatewayServer(state)` (no call context), `GatewayHandle.runId` omitted.

### 3.2 Serve time — `tools/call` (per request, `handleToolCall`)

```text
ctx === undefined (degraded / no run)  → denyCall("TOOL_CALL_NOT_AVAILABLE", name)      [no events]

outcome = routeCall(state, name):
  ├─ deny  → append ToolCallDenied{denyCode}                                            [1 event]
  │          if outcome.incident (TOOL_BLOCKED): append IncidentOpened                  [+1 event]
  │          return denyCall(outcome.code, name)
  └─ forward (public_read | account_read):
            append ToolCallRequested{riskClass, argumentsDigest}                        [event 1]
            try   result = client.callTool(name, args)        // reuse long-lived conn
                  append ToolCallCompleted{resultDigest, isError}                       [event 2]
                  return result                                // RAW upstream result
            catch append ToolCallFailed{reasonCode:"upstream_call_failed"}              [event 2']
                  return denyCall("UPSTREAM_CALL_FAILED", name, err.message)
```

**Ledger invariant:** `ToolCallRequested` is appended **only** when a call is actually forwarded upstream, and always **before** the upstream `callTool`. A dangling `ToolCallRequested` (no matching `Completed`/`Failed`) therefore means a crash mid-flight — honest in-flight visibility. Denials never emit `ToolCallRequested`; they emit a single terminal `ToolCallDenied`. Because the stdio transport is strictly sequential, the ledger head is re-read fresh before each append (`store.head` → `store.append(head, [...])`) with no concurrency contention; the optimistic-concurrency check still guards against a programming error.

---

## 4. Public Types & Signatures

### 4.1 `@traceguard/schemas` — additive payload schemas

`run-payloads.ts` gains one export (alongside the existing `RunCompletedPayload` / `RunFailedPayload`):

```ts
export const RunCreatedPayload = z
  .object({
    runId: z.string().min(1),
    providerConnectionId: z.string().min(1),
    createdAt: IsoTimestamp,
  })
  .strict();
export type RunCreatedPayload = z.infer<typeof RunCreatedPayload>;
```

New file `tool-call-payloads.ts` (mirrors the `.strict()` convention of `tool-manifest-payloads.ts`):

```ts
import { z } from "zod";
import { RiskClass } from "./tool-manifest.js";

export const CallDenyCode = z.enum([
  "UNKNOWN_TOOL",
  "TOOL_FROZEN",
  "TOOL_BLOCKED",
  "DECISION_ENVELOPE_REQUIRED",
]);
export type CallDenyCode = z.infer<typeof CallDenyCode>;

export const ToolCallRequestedPayload = z
  .object({
    runId: z.string().min(1),
    toolName: z.string().min(1),
    riskClass: RiskClass,
    argumentsDigest: z.string().length(64), // sha256 hex of canonicalJson(arguments)
  })
  .strict();
export type ToolCallRequestedPayload = z.infer<typeof ToolCallRequestedPayload>;

export const ToolCallCompletedPayload = z
  .object({
    runId: z.string().min(1),
    toolName: z.string().min(1),
    resultDigest: z.string().length(64),    // sha256 hex of canonicalJson(result)
    isError: z.boolean(),                    // upstream tool returned isError:true (still a completed round-trip)
  })
  .strict();
export type ToolCallCompletedPayload = z.infer<typeof ToolCallCompletedPayload>;

export const ToolCallFailureReason = z.enum(["upstream_call_failed"]);
export type ToolCallFailureReason = z.infer<typeof ToolCallFailureReason>;

export const ToolCallFailedPayload = z
  .object({
    runId: z.string().min(1),
    toolName: z.string().min(1),
    reasonCode: ToolCallFailureReason,
  })
  .strict();
export type ToolCallFailedPayload = z.infer<typeof ToolCallFailedPayload>;

export const ToolCallDeniedPayload = z
  .object({
    runId: z.string().min(1),
    toolName: z.string().min(1),
    denyCode: CallDenyCode,
    riskClass: RiskClass.optional(),         // omitted for UNKNOWN_TOOL (no governed entry)
  })
  .strict();
export type ToolCallDeniedPayload = z.infer<typeof ToolCallDeniedPayload>;

export const IncidentReason = z.enum(["blocked_tool_call_attempt"]);
export type IncidentReason = z.infer<typeof IncidentReason>;

export const IncidentOpenedPayload = z
  .object({
    incidentId: z.string().min(1),
    runId: z.string().min(1),
    toolName: z.string().min(1),
    riskClass: RiskClass,
    reasonCode: IncidentReason,
  })
  .strict();
export type IncidentOpenedPayload = z.infer<typeof IncidentOpenedPayload>;
```

`index.ts` adds `export * from "./tool-call-payloads.js";`. House convention: optional fields (`riskClass` on `ToolCallDeniedPayload`) are **omitted when absent**, never written as explicit `undefined`.

### 4.2 `call-router.ts` (pure)

```ts
import type { RiskClass } from "@traceguard/schemas";
import type { GatewayState } from "./gateway-state.js";

export type CallDenyCode =
  | "UNKNOWN_TOOL"
  | "TOOL_FROZEN"
  | "TOOL_BLOCKED"
  | "DECISION_ENVELOPE_REQUIRED";

export type RouteOutcome =
  | { kind: "forward"; riskClass: RiskClass }
  | { kind: "deny"; code: CallDenyCode; incident: boolean; riskClass?: RiskClass };

export function routeCall(state: GatewayState, name: string): RouteOutcome {
  const entry = state.route.get(name);
  if (entry === undefined) return { kind: "deny", code: "UNKNOWN_TOOL", incident: false };
  if (entry.status === "frozen")
    return { kind: "deny", code: "TOOL_FROZEN", incident: false, riskClass: entry.riskClass };
  if (entry.status === "blocked")
    return { kind: "deny", code: "TOOL_BLOCKED", incident: true, riskClass: entry.riskClass };
  // status === "active":
  if (entry.riskClass === "public_read" || entry.riskClass === "account_read")
    return { kind: "forward", riskClass: entry.riskClass };
  // active + trade_like (or any non-read active class) → fail closed, awaits 3E envelope path
  return { kind: "deny", code: "DECISION_ENVELOPE_REQUIRED", incident: false, riskClass: entry.riskClass };
}
```

The decision is **status-first, then risk-class within `active`**, so an explicit `ToolBlocked`/`ToolFrozen` on any tool overrides its class. The `active` fall-through denies (never forwards) any non-read class — defence in depth even though `classDefault` makes `asset_movement`/`administrative` `blocked` and `unknown` `frozen`.

`call-router.ts` declares `CallDenyCode` as a plain TS union (the pure module stays free of a runtime Zod dependency for its own surface); `tool-call-payloads.ts` declares the structurally identical `CallDenyCode` Zod enum. The two share the same four members by construction, and the enforcing boundary is `ToolCallDeniedPayload.parse(...)` inside `recordToolCallDenied` — a drift would throw at event-build time, caught immediately by `tool-call-events.test.ts`.

### 4.3 `gateway-state.ts` (modify)

```ts
import type { ToolInventoryView, ToolStatus } from "@traceguard/event-ledger";
import type { RiskClass } from "@traceguard/schemas";

export interface RouteEntry { status: ToolStatus; riskClass: RiskClass; }

export interface GatewayState {
  servedTools: ServedTool[];
  route: Map<string, RouteEntry>; // ALL governed tools (active+blocked+frozen), keyed by name
  manifestHash: string | null;
  toolCount: number;
  degraded: boolean;
}
```

`buildGatewayState` gains the route map (built from the **whole** `view.tools`); `degradedState` gets an empty map:

```ts
export function buildGatewayState(args): GatewayState {
  return {
    servedTools: selectServedTools(args.normalized, args.view),
    route: new Map(args.view.tools.map((t) => [t.name, { status: t.status, riskClass: t.riskClass }])),
    manifestHash: args.manifestHash,
    toolCount: args.toolCount,
    degraded: false,
  };
}

export function degradedState(): GatewayState {
  return { servedTools: [], route: new Map(), manifestHash: null, toolCount: 0, degraded: true };
}
```

`selectServedTools` and `ServedTool` are unchanged from 3C.

### 4.4 `upstream-client.ts` (modify) + `stdio-upstream-client.ts` (modify)

```ts
// upstream-client.ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface UpstreamManifestClient {
  open(): Promise<void>;
  listTools(): Promise<RawUpstreamTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>; // NEW
  close(): Promise<void>;
}

export class UpstreamCallError extends Error { readonly name = "UpstreamCallError"; } // NEW
```

```ts
// stdio-upstream-client.ts — new method, mirrors the listTools 10s-timeout pattern
async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (this.client === undefined) throw new UpstreamCallError("callTool before open");
  try {
    return await this.client.callTool({ name, arguments: args }, undefined, { timeout: 10_000 });
  } catch (err) {
    throw new UpstreamCallError(`upstream callTool failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

`this.client.callTool(params, resultSchema?, options?)` uses the SDK default `CallToolResultSchema` (pass `undefined` for `resultSchema`) and the 10 s `RequestOptions.timeout`, matching the existing `listTools(undefined, { timeout: 10_000 })`.

### 4.5 `tool-call-events.ts` (deps-injected builders)

```ts
import { makeEvent, canonicalJson } from "@traceguard/event-ledger";
import {
  RunCreatedPayload, ToolCallRequestedPayload, ToolCallCompletedPayload,
  ToolCallFailedPayload, ToolCallDeniedPayload, IncidentOpenedPayload,
  type RiskClass, type LedgerEvent,
} from "@traceguard/schemas";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ReconcileDeps } from "@traceguard/tool-manifest"; // { clock, newId, hash }
import type { CallDenyCode } from "./call-router.js";

export interface CallAudit {
  workspaceId: string;
  runId: string;
  providerConnectionId: string;
}

export function recordRunCreated(audit: CallAudit, deps: ReconcileDeps, prev: string | null): LedgerEvent;
export function recordToolCallRequested(
  audit: CallAudit, deps: ReconcileDeps, prev: string | null,
  input: { toolName: string; riskClass: RiskClass; arguments: Record<string, unknown> },
): LedgerEvent;
export function recordToolCallCompleted(
  audit: CallAudit, deps: ReconcileDeps, prev: string | null,
  input: { toolName: string; result: CallToolResult },
): LedgerEvent;
export function recordToolCallFailed(
  audit: CallAudit, deps: ReconcileDeps, prev: string | null,
  input: { toolName: string; reasonCode: "upstream_call_failed" },
): LedgerEvent;
export function recordToolCallDenied(
  audit: CallAudit, deps: ReconcileDeps, prev: string | null,
  input: { toolName: string; denyCode: CallDenyCode; riskClass?: RiskClass },
): LedgerEvent;
export function recordIncidentOpened(
  audit: CallAudit, deps: ReconcileDeps, prev: string | null,
  input: { toolName: string; riskClass: RiskClass },
): LedgerEvent;
```

Each builder: (1) computes any digest via `deps.hash(canonicalJson(x))`; (2) validates its payload with the Zod schema's `.parse(...)` (house convention — fail fast on a malformed payload); (3) calls `makeEvent({...}, deps)` with `eventVersion: 1, schemaVersion: 1`. `recordToolCallCompleted` derives `isError: input.result.isError ?? false` and `resultDigest: deps.hash(canonicalJson(input.result))`. Aggregate/actor wiring:

| Builder | aggregateType | aggregateId | actorType | eventType |
|---------|---------------|-------------|-----------|-----------|
| `recordRunCreated` | `run` | `runId` | `agent` | `RunCreated` |
| `recordToolCallRequested` | `run` | `runId` | `agent` | `ToolCallRequested` |
| `recordToolCallCompleted` | `run` | `runId` | `agent` | `ToolCallCompleted` |
| `recordToolCallFailed` | `run` | `runId` | `agent` | `ToolCallFailed` |
| `recordToolCallDenied` | `run` | `runId` | `agent` | `ToolCallDenied` |
| `recordIncidentOpened` | `incident` | `incidentId` (`deps.newId.next("inc")`) | `system` | `IncidentOpened` |

All `run`-aggregate builders set the envelope `runId: audit.runId`. Reference implementation of one builder (the rest follow identically):

```ts
export function recordToolCallRequested(audit, deps, prev, input) {
  const payload = ToolCallRequestedPayload.parse({
    runId: audit.runId,
    toolName: input.toolName,
    riskClass: input.riskClass,
    argumentsDigest: deps.hash(canonicalJson(input.arguments)),
  });
  return makeEvent({
    workspaceId: audit.workspaceId,
    aggregateType: "run",
    aggregateId: audit.runId,
    eventType: "ToolCallRequested",
    eventVersion: 1,
    schemaVersion: 1,
    actorType: "agent",
    runId: audit.runId,
    payload,
    previousEventHash: prev,
  }, deps);
}
```

`recordIncidentOpened` mints `incidentId = deps.newId.next("inc")`, sets `aggregateType: "incident"`, `aggregateId: incidentId`, `actorType: "system"`, but still records `runId: audit.runId` on the envelope and in the payload for correlation.

### 4.6 `call-handler.ts` (shell)

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { LedgerStore } from "@traceguard/event-ledger";
import type { ReconcileDeps } from "@traceguard/tool-manifest";
import type { UpstreamManifestClient } from "./upstream-client.js";
import type { GatewayState } from "./gateway-state.js";
import { routeCall, type CallDenyCode } from "./call-router.js";
import { CallAudit, recordToolCallRequested, recordToolCallCompleted,
         recordToolCallFailed, recordToolCallDenied, recordIncidentOpened } from "./tool-call-events.js";

export interface GatewayCallContext {
  client: UpstreamManifestClient; // long-lived; has callTool
  store: LedgerStore;
  deps: ReconcileDeps;            // { clock, newId, hash }
  audit: CallAudit;              // { workspaceId, runId, providerConnectionId }
}

export type CallErrorCode = CallDenyCode | "TOOL_CALL_NOT_AVAILABLE" | "UPSTREAM_CALL_FAILED";

export interface ToolCallDenial {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  traceguard: { errorCode: CallErrorCode; toolName: string };
}

export function denyCall(code: CallErrorCode, toolName: string, message?: string): CallToolResult;

export async function handleToolCall(
  state: GatewayState,
  ctx: GatewayCallContext | undefined,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult>;
```

`denyCall` builds a `ToolCallDenial` with a per-code human message (default text per code, overridable by `message`) and returns `denial as unknown as CallToolResult` — the same passthrough cast 3C used (the SDK `CallToolResultSchema` is a loose object, so the top-level `traceguard` field survives the client-side parse). `handleToolCall` reference implementation:

```ts
export async function handleToolCall(state, ctx, name, args) {
  if (ctx === undefined) return denyCall("TOOL_CALL_NOT_AVAILABLE", name);
  const { store, deps, audit } = ctx;
  const outcome = routeCall(state, name);

  if (outcome.kind === "deny") {
    let head = await store.head(audit.workspaceId);
    const denied = recordToolCallDenied(audit, deps, head, {
      toolName: name, denyCode: outcome.code,
      ...(outcome.riskClass !== undefined ? { riskClass: outcome.riskClass } : {}),
    });
    await store.append(head, [denied]);
    if (outcome.incident) {
      head = denied.eventHash;
      const incident = recordIncidentOpened(audit, deps, head, {
        toolName: name, riskClass: outcome.riskClass ?? "unknown",
      });
      await store.append(head, [incident]);
    }
    return denyCall(outcome.code, name);
  }

  let head = await store.head(audit.workspaceId);
  const requested = recordToolCallRequested(audit, deps, head, {
    toolName: name, riskClass: outcome.riskClass, arguments: args,
  });
  await store.append(head, [requested]);
  head = requested.eventHash;
  try {
    const result = await ctx.client.callTool(name, args);
    const completed = recordToolCallCompleted(audit, deps, head, { toolName: name, result });
    await store.append(head, [completed]);
    return result; // RAW upstream result passes through to the agent
  } catch (err) {
    const failed = recordToolCallFailed(audit, deps, head, {
      toolName: name, reasonCode: "upstream_call_failed",
    });
    await store.append(head, [failed]);
    return denyCall("UPSTREAM_CALL_FAILED", name, err instanceof Error ? err.message : String(err));
  }
}
```

### 4.7 `gateway-server.ts` (modify)

```ts
import { handleToolCall, type GatewayCallContext } from "./call-handler.js";

export function createGatewayServer(state: GatewayState, callCtx?: GatewayCallContext): Server {
  const server = new Server(GATEWAY_SERVER_INFO, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: state.servedTools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    handleToolCall(state, callCtx, req.params.name, req.params.arguments ?? {}),
  );
  return server;
}
```

3C's `denyToolCall` / `ToolCallDenial` move to `call-handler.ts` and generalise into `denyCall`. `GATEWAY_SERVER_INFO` is unchanged (`version: "0.2.0"`).

### 4.8 `boot-gateway.ts` (modify)

```ts
export interface GatewayHandle {
  state: GatewayState;
  server: Server;
  client: UpstreamManifestClient;
  runId?: string; // present only on a successful (non-degraded) boot
}
```

After `buildGatewayState`, on the happy path only, mint `runId`, append `recordRunCreated`, build the `GatewayCallContext`, and pass it to `createGatewayServer` (see §3.1 steps 10–15). The degraded `catch` is unchanged and returns a handle with no `runId` and a server with no call context.

---

## 5. Downstream MCP Server Behaviour

`initialize` and `tools/list` are unchanged from 3C. The whole 3D delta is in `tools/call`:

| Requested tool (status / risk class) | Outcome | Upstream hit? | Events appended | Returned to agent |
|--------------------------------------|---------|---------------|-----------------|-------------------|
| active / `public_read` or `account_read` | **forward** | yes | `ToolCallRequested` → `ToolCallCompleted` | raw upstream `CallToolResult` |
| active / `public_read`\|`account_read`, upstream throws | forward then fail | yes | `ToolCallRequested` → `ToolCallFailed` | `denyCall("UPSTREAM_CALL_FAILED")` |
| active / `trade_like` | **deny** | no | `ToolCallDenied{DECISION_ENVELOPE_REQUIRED}` | `denyCall("DECISION_ENVELOPE_REQUIRED")` |
| `blocked` (`asset_movement` / `administrative`) | **deny + incident** | no | `ToolCallDenied{TOOL_BLOCKED}` + `IncidentOpened` | `denyCall("TOOL_BLOCKED")` |
| `frozen` (`unknown` class / awaiting approval) | **deny** | no | `ToolCallDenied{TOOL_FROZEN}` | `denyCall("TOOL_FROZEN")` |
| name not in route table | **deny** | no | `ToolCallDenied{UNKNOWN_TOOL}` | `denyCall("UNKNOWN_TOOL")` |
| any tool, gateway booted degraded (no run) | **deny** | no | none | `denyCall("TOOL_CALL_NOT_AVAILABLE")` |

Every deny is a well-formed `CallToolResult` with `isError: true` and `traceguard.errorCode` set — the agent receives a precise, machine-readable reason, never a silent failure or an ungoverned passthrough.

---

## 6. Persistence Wiring

- 3D reuses the **same** `InMemoryLedgerStore` instance that 3C wired through `bootGateway`; no new store.
- **Boot:** one extra `append` (the `RunCreated` anchor) chains after the manifest events on the workspace aggregate.
- **Per call:** every `tools/call` re-reads `store.head(workspaceId)` and appends 1–2 events through the existing optimistic-concurrency path (`head` → `append(head, events)` → next op re-reads head). Sequential stdio ⇒ no contention.
- **Digests only:** `argumentsDigest` / `resultDigest` are `sha256hex(canonicalJson(...))` via the injected `deps.hash` + `canonicalJson` (same helpers the manifest path uses), so a fake hash in tests yields deterministic, inspectable digests and no raw payload ever lands in the ledger.
- The whole tool-call history is replayable/inspectable from the in-memory event log within a gateway run; durable persistence remains a future drop-in behind the unchanged `LedgerStore` interface.

---

## 7. Fail-Closed & Error Semantics

| Condition | Behaviour |
|-----------|-----------|
| Gateway booted degraded (`ctx === undefined`) | `tools/call` → `TOOL_CALL_NOT_AVAILABLE`, **no events**, nothing upstream. |
| Unknown / frozen / blocked / trade_like | Fail closed with the precise code; **no upstream hit**; `blocked` additionally opens an incident. |
| `client.callTool` throws (`UpstreamCallError` or any error) | `ToolCallFailed` appended, return `UPSTREAM_CALL_FAILED` with the error message; the long-lived connection is **not** torn down (one bad call ≠ provider death). |
| Upstream returns `isError: true` (tool-level error, e.g. bad args) | Treated as a **completed** round-trip: `ToolCallCompleted{isError:true}`, raw error result passed through to the agent (the agent owns its own argument mistakes; 3D adds no JSON-Schema validation). |
| `store.append` → `LedgerConflictError` | Propagates — indicates a programming error (concurrent head mutation), not a provider condition. |
| Malformed event payload (`*.parse` throws) | Propagates — a builder bug; fail fast rather than persist a malformed event. |
| stdout hygiene | Downstream `StdioServerTransport` owns stdout; all diagnostics stay on stderr (unchanged from 3C). |

Default-deny holds end-to-end: only `public_read` / `account_read` on a non-degraded boot ever reach upstream; every other path denies with an audited reason, and a direct attempt on a hidden dangerous tool is both denied **and** flagged as an incident.

---

## 8. Testing Strategy (TDD)

All tests run in the default vitest suite except the gated live test. `bin/gateway-local.ts` stays excluded (entry point).

### 8.1 `call-router.test.ts` — pure, exhaustive table (NEW)

Build a tiny `GatewayState` with a hand-rolled `route` map covering every branch, then assert `routeCall`:

- `public_read` active → `{ kind: "forward", riskClass: "public_read" }`; `account_read` active → forward.
- `trade_like` active → `{ kind: "deny", code: "DECISION_ENVELOPE_REQUIRED", incident: false, riskClass: "trade_like" }`.
- status `blocked` (`asset_movement`) → `{ kind: "deny", code: "TOOL_BLOCKED", incident: true, riskClass: "asset_movement" }`.
- status `frozen` (`unknown`) → `{ kind: "deny", code: "TOOL_FROZEN", incident: false, riskClass: "unknown" }`.
- name absent from the map → `{ kind: "deny", code: "UNKNOWN_TOOL", incident: false }` (no `riskClass`).
- defence-in-depth: status `active` + `administrative` → `DECISION_ENVELOPE_REQUIRED` (never forwards a non-read active class).

### 8.2 `tool-call-events.test.ts` — pure builders with fake deps (NEW)

Fixed `deps = { clock: fixedClock, newId: countingIdGen, hash: fakeHash }` (e.g. `hash = (s) => sha256hex(s)` for real digests, or a stub for inspection). For each builder assert: exact `eventType`, `aggregateType`, `aggregateId`, `actorType`, `eventVersion: 1`, `schemaVersion: 1`, envelope `runId`, and the parsed payload (including `argumentsDigest === hash(canonicalJson(args))` and `resultDigest === hash(canonicalJson(result))`). Assert `recordIncidentOpened` uses `aggregateType: "incident"`, an `inc`-prefixed `aggregateId`, `actorType: "system"`, and still carries `runId`. Assert chaining: passing `prev = eventA.eventHash` sets `eventB.previousEventHash === eventA.eventHash`.

### 8.3 `call-handler.test.ts` — orchestration with FakeUpstreamClient + InMemoryLedgerStore (NEW)

A `FakeUpstreamClient implements UpstreamManifestClient` with a configurable `callTool` (returns a canned `CallToolResult`, or throws). Seed a `GatewayState` whose `route` map has one tool per class, build a `GatewayCallContext` with a real `InMemoryLedgerStore` pre-seeded with a `RunCreated`, then drive `handleToolCall` and assert the **event sequence read back from the store** plus the returned result:

- **forward success** (`public_read`): returns the canned result unchanged; store gains `ToolCallRequested` then `ToolCallCompleted`; `argumentsDigest`/`resultDigest` match `hash(canonicalJson(...))`; `fake.callTool` called once with `(name, args)`.
- **forward upstream-throw**: returns `isError:true` + `traceguard.errorCode === "UPSTREAM_CALL_FAILED"`; store gains `ToolCallRequested` then `ToolCallFailed{reasonCode:"upstream_call_failed"}`; **no** `ToolCallCompleted`.
- **trade_like**: returns `DECISION_ENVELOPE_REQUIRED`; store gains exactly one `ToolCallDenied`; `fake.callTool` **never called**.
- **blocked**: returns `TOOL_BLOCKED`; store gains `ToolCallDenied{TOOL_BLOCKED}` **and** `IncidentOpened` (aggregateType `incident`); `fake.callTool` never called.
- **frozen** → `TOOL_FROZEN`, one `ToolCallDenied`, no incident. **unknown name** → `UNKNOWN_TOOL`, one `ToolCallDenied` with no `riskClass`.
- **no context** (`ctx === undefined`): returns `TOOL_CALL_NOT_AVAILABLE`; store unchanged (no events appended).

### 8.4 `gateway-state.test.ts` — extend (MODIFY)

Add to the existing golden test: over the frozen `bitget36RawTools` projection, assert `state.route.size === 36`; the 4 blocked names (`transfer`, `withdraw`, `cancel_withdrawal`, `manage_subaccounts`) are present in `route` with `status: "blocked"` **and absent from `servedTools`**; a `public_read` sample (`spot_get_ticker`) is in `route` with `status: "active"`. `degradedState().route.size === 0`.

### 8.5 `gateway-server.test.ts` — extend (MODIFY)

Keep the 3C in-memory-transport round-trip. Add a `GatewayCallContext` (fake client + in-memory store + seeded run) and assert via a real SDK `Client.callTool`:

- a `public_read` tool round-trips the fake's canned result (`isError` falsy, real content);
- a `trade_like` tool returns `isError:true` with `traceguard.errorCode === "DECISION_ENVELOPE_REQUIRED"`;
- with **no** call context (degraded server), any call still returns `TOOL_CALL_NOT_AVAILABLE`.

### 8.6 `boot-gateway.test.ts` — extend (MODIFY)

- **Happy path:** `handle.runId` is a non-empty `run`-prefixed string; `store.read(ws)` contains exactly one `RunCreated` whose `previousEventHash` chains onto the last manifest event; `fake.closed === false`.
- **Degraded:** `handle.runId === undefined`; `store.read(ws)` contains **no** `RunCreated`.

### 8.7 `gateway-local.integration.test.ts` — extend, gated by `TRACEGUARD_LIVE_MCP` (MODIFY)

After booting against the real `bitget-mcp-server --paper-trading`:

- call a `public_read` tool (e.g. `spot_get_ticker` with a `{ symbol }` argument) and assert a **non-error** `CallToolResult` with real content (the read genuinely reaches upstream);
- call a `trade_like` tool (e.g. `place_order`) and assert `traceguard.errorCode === "DECISION_ENVELOPE_REQUIRED"` with no upstream hit;
- (optional) a direct call to a hidden `blocked` name (`withdraw`) returns `TOOL_BLOCKED`;
- close `handle.client` in a `finally`.

Per the frozen-fixture decision, live assertions stay behavioural (error-code / non-error), never exact counts.

---

## 9. File & Module Inventory

| Path | Action | Responsibility |
|------|--------|----------------|
| `packages/schemas/src/tool-call-payloads.ts` | **create** | `ToolCallRequested/Completed/Failed/Denied` + `IncidentOpened` payload schemas; `CallDenyCode` enum. |
| `packages/schemas/src/run-payloads.ts` | **modify** | Add `RunCreatedPayload`. |
| `packages/schemas/src/index.ts` | **modify** | Barrel: add `./tool-call-payloads.js`. |
| `packages/mcp-gateway/src/call-router.ts` | **create** | Pure `routeCall(state, name)` + `RouteOutcome` / `CallDenyCode`. |
| `packages/mcp-gateway/src/tool-call-events.ts` | **create** | `CallAudit` + the six deps-injected `record*` event builders. |
| `packages/mcp-gateway/src/call-handler.ts` | **create** | `handleToolCall`, `denyCall`, `GatewayCallContext`, `CallErrorCode`, `ToolCallDenial`. |
| `packages/mcp-gateway/src/gateway-state.ts` | **modify** | `GatewayState.route` + `RouteEntry`; build map in `buildGatewayState`; empty map in `degradedState`. |
| `packages/mcp-gateway/src/gateway-server.ts` | **modify** | `createGatewayServer(state, callCtx?)` → `CallTool` handler delegates to `handleToolCall`; drop local `denyToolCall`. |
| `packages/mcp-gateway/src/upstream-client.ts` | **modify** | Add `callTool` to the interface + `UpstreamCallError`. |
| `packages/mcp-gateway/src/stdio-upstream-client.ts` | **modify** | Implement `callTool` over SDK `Client.callTool` (10 s timeout). |
| `packages/mcp-gateway/src/boot-gateway.ts` | **modify** | Emit `RunCreated`; `GatewayHandle.runId`; build `GatewayCallContext`. |
| `packages/mcp-gateway/src/index.ts` | **modify** | Barrel: add `call-router` / `tool-call-events` / `call-handler`. |
| `packages/mcp-gateway/src/call-router.test.ts` | **create** | Exhaustive routing table. |
| `packages/mcp-gateway/src/tool-call-events.test.ts` | **create** | Builder payloads / digests / chaining / aggregate wiring. |
| `packages/mcp-gateway/src/call-handler.test.ts` | **create** | Orchestration: event sequences + returned results per class. |
| `packages/mcp-gateway/src/gateway-state.test.ts` | **modify** | Route-map assertions. |
| `packages/mcp-gateway/src/gateway-server.test.ts` | **modify** | Forward + envelope-deny + no-ctx round-trips. |
| `packages/mcp-gateway/src/boot-gateway.test.ts` | **modify** | `RunCreated` + `runId` (happy) / none (degraded). |
| `packages/mcp-gateway/src/gateway-local.integration.test.ts` | **modify** | Live forward + envelope-deny. |
| `packages/mcp-gateway/src/bin/gateway-local.ts` | **unchanged** | Composition root already destructures the handle; `runId` is additive. |

`import-manifest.ts`, `bin/gateway-import.ts`, and the 3A/3B pure cores are untouched.

---

## 10. Documentation Alignment

Land these `mcp-gateway-contract.md` notes in the 3D plan (full-coherence preference):

1. **§14 error table — add `UPSTREAM_CALL_FAILED`:** "Upstream `tools/call` threw after a governed forward; fail-closed, connection retained." It is the one call-time code 3C/3D had not yet listed (`TOOL_BLOCKED`, `TOOL_FROZEN`, `UNKNOWN_TOOL`, `DECISION_ENVELOPE_REQUIRED`, `TOOL_CALL_NOT_AVAILABLE` already present).
2. **§14 — revise the `TOOL_CALL_NOT_AVAILABLE` row:** it no longer fires for *all* calls; in 3D it fires only when the gateway booted **degraded** (no run anchor). Update the description from "pre-3D" to "degraded boot / no active run."
3. **§9 handling paths — note the 3D-implemented subset:** existence/risk classification + governed read-forward + audit events are live; argument JSON-Schema validation (§9.2-ish), decision-envelope/policy/approval/execution (§9.x), and response redaction (§9.3) remain deferred to 3E.
4. **§7.1 blockquote (added in 3C):** its closing sentence already says the long-lived upstream connection "is reused by the call-routing milestone (3D)." Append a half-sentence confirming 3D now routes `tools/call` over that same connection.

No 3A/3B spec edits needed.

---

## 11. Acceptance Criteria

- [ ] A connected agent can `tools/call` a `public_read` / `account_read` tool and receive the **real upstream result**; the call reaches the live `bitget-mcp-server` over the reused connection.
- [ ] A `tools/call` on a `trade_like` tool returns `isError:true` / `DECISION_ENVELOPE_REQUIRED` and **never** reaches upstream.
- [ ] A direct `tools/call` on a hidden `blocked` tool (`withdraw`, `transfer`, `cancel_withdrawal`, `manage_subaccounts`) returns `TOOL_BLOCKED` **and** appends an `IncidentOpened`.
- [ ] A `frozen` tool → `TOOL_FROZEN`; an unknown name → `UNKNOWN_TOOL`; both with no upstream hit.
- [ ] Every forwarded call appends `ToolCallRequested` (before the upstream hit) then `ToolCallCompleted` (success) or `ToolCallFailed` (upstream throw, returned as `UPSTREAM_CALL_FAILED`).
- [ ] The ledger persists **only** digests of arguments and results — no raw arguments or response bodies — while the raw result is still returned to the agent.
- [ ] A successful boot emits exactly one `RunCreated` (chained after the manifest events) and exposes `runId` on the handle; a degraded boot emits no run and answers `tools/call` with `TOOL_CALL_NOT_AVAILABLE`.
- [ ] The new payload schemas (`RunCreatedPayload`, `ToolCall*Payload`, `IncidentOpenedPayload`) are additive; the ledger envelope and `aggregateType`/`actorType` enums are unchanged.
- [ ] All default-suite tests pass; the live test stays gated behind `TRACEGUARD_LIVE_MCP`; stdout carries only JSON-RPC.

---

## 12. Out-of-Scope Boundary (hand-off to 3E)

3E replaces the **single** `DECISION_ENVELOPE_REQUIRED` deny branch in `routeCall`/`handleToolCall` with the real governed-execution path for `trade_like` (and any future approval-gated class), reusing the primitives already merged in Phases 1B/2:

- **Decision Envelope** creation + validation (`@traceguard/schemas` `decision-envelope.ts`, `propose-decision`), **policy** evaluation, **approval** gating (`approvalProjection`), **authorization** (`authorizationProjection`), and **execution** adapters — turning a `trade_like` call into propose → evaluate → approve → execute rather than a flat deny.
- **`traceguard_*` internal tools** (`traceguard_start_run`, propose/approve/execute surface) and the **full run lifecycle** (`RunStarted` / `RunCompleted` / `RunFailed` via `runStatusProjection`); 3D's lone `RunCreated` anchor is the seam they extend.
- **JSON-Schema argument validation** (`ajv`) at §9.2 and **response redaction** at §9.3 / §20.
- **OTel spans**, **idempotency** (§17), and **durable persistence**.

3D deliberately leaves exactly one rewrite seam — the `trade_like` → `DECISION_ENVELOPE_REQUIRED` branch — plus the `RunCreated` anchor, so 3E is an additive extension of a working, audited, fail-closed routing pipeline rather than a rewrite.
