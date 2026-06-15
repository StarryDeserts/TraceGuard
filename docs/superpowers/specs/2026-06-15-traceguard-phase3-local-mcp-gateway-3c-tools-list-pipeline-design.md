# TraceGuard Phase 3 — Sub-project 3C: tools/list Response Pipeline & Minimal Downstream Server

**Document status:** Design v1.0 (approved for planning)
**Date:** 2026-06-15
**Package:** `@traceguard/mcp-gateway` (extends merged 1A + 1B + 2 + 3A + 3B on `main`)
**Builds on:** 3A (pure classification / normalize / manifest-hash / reconcile / projection), 3B (stdio upstream client + one-shot import orchestration)

---

## 1. Scope & Position in Phase 3

### 1.1 What 3C delivers

3C turns the store-free 3B import path into a **running, governed downstream MCP server** that an AI client (Claude Code / Cursor / a local agent) can connect to over stdio and call `tools/list` against, receiving only the **governed-visible** subset of upstream tools.

Concretely, 3C adds four capabilities on top of 3B:

1. **Persistence wiring** — persist the 3B-produced manifest events through the existing `LedgerStore` (the `InMemoryLedgerStore` already built in Phase 1/2).
2. **Governed inventory** — re-derive the §7.4 visibility view from the persisted events via the existing `toolManifestProjection`.
3. **tools/list response assembly** — join the governed `visible` name-set against the live normalized tool definitions to produce the `tools/list` response body (each tool's `inputSchema`/`description`).
4. **Minimal downstream MCP Server** — a stdio MCP `Server` that answers `initialize` + `tools/list`, plus a **fail-closed `tools/call` stub** (real call routing is 3D).

### 1.2 What 3C does NOT build (deferred)

- **`tools/call` routing** into the decision/execution core — 3D. 3C returns a structured deny for every call.
- **Run context, decision envelopes, policy evaluation, approval, execution** — later sub-projects.
- **OTel spans, response redaction** — 3E.
- **Persistent (file/sqlite) ledger** — 3C wires the in-memory store; durable persistence stays behind the unchanged `LedgerStore` interface.
- **Hosted HTTP transport** and the `mcp-core` / `mcp-gateway-runtime` / `apps/*` package split from contract §3.3 — deliberately premature; everything stays in `@traceguard/mcp-gateway`.
- **Approval flow / `ToolManifestApproved`** — initial visibility (32 visible) needs no approval baseline per 3A §8; 3C imports with no `approved` baseline (reconcile Case 1).

### 1.3 Locked decisions (from brainstorming, 2026-06-15)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Deliverable boundary | **Build a minimal downstream stdio MCP Server** handling `initialize` + `tools/list`; `tools/call` is a fail-closed stub for 3D. |
| D2 | Import timing & upstream connection lifecycle | **Startup import + long-lived upstream connection.** Import once at boot; `tools/list` serves from the persisted projection + cached normalized tools (no per-request upstream hit). The upstream connection stays open for the session so 3D can reuse it. |
| D3 | Persistence tier | **In-process `InMemoryLedgerStore`.** Events persist across `tools/list` calls within one gateway run; each process restart re-imports from empty (the projection is deterministic from the events). Durable on-disk persistence deferred behind the `LedgerStore` interface. |

---

## 2. Architecture

3C keeps the house **functional-core / imperative-shell** split. The visible-set selection and response-body assembly are **pure** and unit-tested without the MCP SDK; the SDK `Server` wiring and the upstream/store I/O are thin shells.

### 2.1 Module map (all under `packages/mcp-gateway/src/`)

```text
gateway-state.ts     PURE   types GatewayState / ServedTool; selectServedTools(), buildGatewayState(), degradedState()
gateway-server.ts    SHELL  createGatewayServer(state) → SDK Server with tools/list + tools/call(stub) handlers; denyToolCall()
boot-gateway.ts      SHELL  bootGateway(args, client, store, deps) → { state, server, client }: open→list→reconcile→append→read→project→buildState
bin/gateway-local.ts ENTRY  composition root: real deps + StdioUpstreamClient + InMemoryLedgerStore → bootGateway → server.connect(StdioServerTransport)
index.ts             MOD    barrel: add gateway-state / gateway-server / boot-gateway (NOT bin)
```

### 2.2 Rejected alternative

A single `gateway-server.ts` doing boot + handlers inline (less indirection, faster to type). Rejected: it fuses the pure visible-set join with SDK wiring, so the 32-visible selection can't be unit-tested in isolation, and it breaks the repo's functional-core/imperative-shell convention. The chosen split costs one extra small file but keeps the governed-selection logic pure and golden-testable.

### 2.3 Why `bootGateway` does NOT reuse `importManifest`

3B's `importManifest` is a one-shot orchestrator that **closes the upstream client in a `finally` block**:

```ts
// packages/mcp-gateway/src/import-manifest.ts (3B, unchanged)
await client.open();
try { const observed = await client.listTools(); return reconcileManifest({ ...args, observed }, deps); }
finally { await client.close(); }   // ← closes the connection
```

That conflicts with D2 (long-lived connection). So `bootGateway` does **not** call `importManifest`; it opens the client, calls `listTools()`, and reuses the **pure** `reconcileManifest` directly, leaving the connection open. `importManifest` stays untouched and continues to back `bin/gateway-import.ts` (3B's one-shot report CLI). This reuses the real reconcile logic and only re-expresses the trivial open/list glue (~3 lines).

---

## 3. Data Flow

### 3.1 Startup (once, imperative shell — `bootGateway`)

```text
1. deps   = { clock: SystemClock, newId: SystemIdGen, hash: sha256hex }
2. client.open()                         // long-lived; NOT closed on success
3. observed = client.listTools()          // RawUpstreamTool[]
4. head   = store.head(workspaceId)       // null on a fresh InMemoryLedgerStore
5. result = reconcileManifest({ ...args, observed, previousEventHash: head }, deps)
6. store.append(head, result.events)      // optimistic-concurrency persist
7. events = store.read(workspaceId)       // read back from the store
8. view   = toolManifestProjection(events)// governed inventory with `visible` flags
9. state  = buildGatewayState({ normalized: result.normalized, view,
                                manifestHash: result.manifestHash, toolCount: observed.length })
10. server = createGatewayServer(state)
→ return { state, server, client }        // client stays open for 3D / shutdown
```

**Response-body source (critical):** the ledger stores only fingerprints (`name`/`riskClass`/`schemaHash` per `ToolManifestEntry`), never `inputSchema`/`description`. So the `tools/list` body comes from **`result.normalized`** (the live `NormalizedToolDefinition[]` from this boot's `listTools`), filtered to the names the projection marks `visible`. The projection decides *which names*; `result.normalized` supplies *the bodies*.

### 3.2 Serve time (per request — downstream `Server` handlers)

```text
tools/list  → { tools: state.servedTools }              // pure read from cached state; no upstream hit
tools/call  → denyToolCall(name)                         // fail-closed §15 envelope; no upstream hit
```

---

## 4. Public Types & Signatures

### 4.1 `gateway-state.ts` (pure)

```ts
import type { NormalizedToolDefinition } from "@traceguard/schemas";
import type { ToolInventoryView } from "@traceguard/event-ledger";

// A faithful pass-through of the MCP Tool fields, for the governed-visible subset.
export interface ServedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

export interface GatewayState {
  servedTools: ServedTool[];
  manifestHash: string | null;   // null only in degraded mode
  toolCount: number;             // upstream tool count this boot (0 when degraded)
  degraded: boolean;             // true when startup import failed (provider degraded)
}

// Join the projection's visible name-set against the normalized definitions.
export function selectServedTools(
  normalized: NormalizedToolDefinition[],
  view: ToolInventoryView,
): ServedTool[];

export function buildGatewayState(args: {
  normalized: NormalizedToolDefinition[];
  view: ToolInventoryView;
  manifestHash: string;
  toolCount: number;
}): GatewayState;

export function degradedState(): GatewayState; // { servedTools: [], manifestHash: null, toolCount: 0, degraded: true }
```

`selectServedTools` reference implementation:

```ts
const byName = (a: { name: string }, b: { name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

export function selectServedTools(normalized, view) {
  const visible = new Set(view.tools.filter((t) => t.visible).map((t) => t.name));
  return normalized
    .filter((n) => visible.has(n.name))
    .sort(byName)
    .map((n) => {
      const tool: ServedTool = { name: n.name, inputSchema: n.inputSchema };
      if (n.title !== undefined) tool.title = n.title;
      if (n.description !== undefined) tool.description = n.description;
      if (n.outputSchema !== undefined) tool.outputSchema = n.outputSchema;
      if (n.annotations !== undefined) tool.annotations = n.annotations;
      return tool;
    });
}
```

`buildGatewayState` / `degradedState` reference implementations (trivial, included to remove ambiguity):

```ts
export function buildGatewayState(args) {
  return {
    servedTools: selectServedTools(args.normalized, args.view),
    manifestHash: args.manifestHash,
    toolCount: args.toolCount,
    degraded: false,
  };
}

export function degradedState() {
  return { servedTools: [], manifestHash: null, toolCount: 0, degraded: true };
}
```

House convention: optional fields are **omitted when undefined**, never written as explicit `undefined`.

### 4.2 `gateway-server.ts` (shell)

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { GatewayState } from "./gateway-state.js";

export const GATEWAY_SERVER_INFO = { name: "traceguard-gateway", version: "0.2.0" } as const;

export interface ToolCallDenial {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  traceguard: { errorCode: "TOOL_CALL_NOT_AVAILABLE"; toolName: string };
}

export function denyToolCall(toolName: string): ToolCallDenial {
  return {
    isError: true,
    content: [{
      type: "text",
      text: "Tool execution is not enabled in this gateway build. Governed execution arrives in a later TraceGuard milestone.",
    }],
    traceguard: { errorCode: "TOOL_CALL_NOT_AVAILABLE", toolName },
  };
}

export function createGatewayServer(state: GatewayState): Server {
  const server = new Server(GATEWAY_SERVER_INFO, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: state.servedTools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => denyToolCall(req.params.name));
  return server;
}
```

Notes:
- `capabilities: { tools: {} }` and `serverInfo` match contract §6.1.
- `CallToolResultSchema` is `.passthrough()` in SDK 1.29.0 (verified), so the top-level `traceguard` field is preserved at runtime and typechecks against the inferred result type.
- 3C denies **every** `tools/call` uniformly with `TOOL_CALL_NOT_AVAILABLE`; 3D will differentiate (`TOOL_BLOCKED` / `DECISION_ENVELOPE_REQUIRED` / route).

### 4.3 `boot-gateway.ts` (shell)

```ts
import { reconcileManifest, type ReconcileDeps } from "@traceguard/tool-manifest";
import { toolManifestProjection, type LedgerStore } from "@traceguard/event-ledger";
import type { ProviderType } from "@traceguard/schemas";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  type UpstreamManifestClient,
  UpstreamUnavailableError,
  UpstreamListToolsError,
} from "./upstream-client.js";
import { buildGatewayState, degradedState, type GatewayState } from "./gateway-state.js";
import { createGatewayServer } from "./gateway-server.js";

export interface BootGatewayArgs {
  workspaceId: string;
  providerConnectionId: string;
  providerType: ProviderType;
  toolManifestVersionId: string;
}

export interface GatewayHandle {
  state: GatewayState;
  server: Server;
  client: UpstreamManifestClient; // long-lived on success; caller owns shutdown
}

export async function bootGateway(
  args: BootGatewayArgs,
  client: UpstreamManifestClient,
  store: LedgerStore,
  deps: ReconcileDeps,
): Promise<GatewayHandle> {
  let state: GatewayState;
  try {
    await client.open();
    const observed = await client.listTools();
    const head = await store.head(args.workspaceId);
    const result = reconcileManifest({ ...args, observed, previousEventHash: head }, deps);
    await store.append(head, result.events);
    const events = await store.read(args.workspaceId);
    const view = toolManifestProjection(events);
    state = buildGatewayState({
      normalized: result.normalized,
      view,
      manifestHash: result.manifestHash,
      toolCount: observed.length,
    });
  } catch (err) {
    if (err instanceof UpstreamUnavailableError || err instanceof UpstreamListToolsError) {
      await safeClose(client);     // degraded: nothing to keep alive
      state = degradedState();
    } else {
      await safeClose(client);     // unexpected (e.g. LedgerConflictError, bug): surface it
      throw err;
    }
  }
  const server = createGatewayServer(state);
  return { state, server, client };
}

async function safeClose(client: UpstreamManifestClient): Promise<void> {
  try { await client.close(); } catch { /* teardown is best-effort */ }
}
```

`ReconcileDeps = { clock: Clock; newId: IdGen; hash: (input: string) => string }` (re-exported from `@traceguard/tool-manifest`). `ReconcileManifestArgs.previousEventHash?: string | null` already exists, so threading `head` is correct-by-construction (and future-proofs a durable store where `head` is non-null on the second boot).

### 4.4 `bin/gateway-local.ts` (entry / composition root)

Mirrors 3B's `bin/gateway-import.ts`, with one hard difference: **stdout is reserved for downstream JSON-RPC**, so every diagnostic uses `console.error` (stderr) per contract §19.1.

```ts
#!/usr/bin/env node
import { createRequire } from "node:module";
import { SystemClock, SystemIdGen, sha256hex, InMemoryLedgerStore } from "@traceguard/event-ledger";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StdioUpstreamClient } from "../stdio-upstream-client.js";
import { bootGateway } from "../boot-gateway.js";

async function main(): Promise<void> {
  const newId = new SystemIdGen();
  const deps = { clock: new SystemClock(), newId, hash: sha256hex };
  const serverEntry = createRequire(import.meta.url).resolve("bitget-mcp-server");
  const client = new StdioUpstreamClient({ command: process.execPath, args: [serverEntry, "--paper-trading"] });
  const store = new InMemoryLedgerStore();

  const { server, state, client: live } = await bootGateway(
    {
      workspaceId: "ws_demo",
      providerConnectionId: "pc_bitget_demo",
      providerType: "bitget_agent_hub",
      toolManifestVersionId: newId.next("tmv"),
    },
    client, store, deps,
  );

  console.error(`[gateway-local] served tools: ${state.servedTools.length}${state.degraded ? " (DEGRADED)" : ""}`);
  console.error(`[gateway-local] manifestHash: ${state.manifestHash ?? "—"}`);

  await server.connect(new StdioServerTransport());

  const shutdown = (): void => {
    void server.close().catch(() => {});
    void live.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error("[gateway-local] fail-closed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
```

stdout-hygiene note: `StdioUpstreamClient` already spawns the upstream child with `stderr: "inherit"` and reads its JSON-RPC from the child's **stdout pipe** (not our stdout), so the upstream child never pollutes our downstream stdout channel.

---

## 5. Downstream MCP Server Behaviour

| Aspect | 3C behaviour | Contract ref |
|--------|--------------|--------------|
| `initialize` | SDK default handshake; `serverInfo = { name: "traceguard-gateway", version: "0.2.0" }`, `capabilities = { tools: {} }` | §6.1 |
| `tools/list` | Returns `state.servedTools` (governed-visible subset; 32 of 36 at the locked baseline) | §7.1, §7.4, §8.3 |
| `tools/call` | Always returns `denyToolCall(name)` — `isError: true`, `traceguard.errorCode = "TOOL_CALL_NOT_AVAILABLE"` | §15 |
| Degraded | If startup import failed, `servedTools = []`; the server still answers (empty list) rather than refusing to connect | §6.2 (“tools/list fails → no tool exposure”) |

---

## 6. Persistence Wiring

- 3C wires the **existing** `InMemoryLedgerStore` (`@traceguard/event-ledger`) — no new store implementation.
- Boot sequence exercises the full optimistic-concurrency path: `head()` → `append(head, events)` → `read()`.
- On a fresh `InMemoryLedgerStore`, `head` is `null`; events chain from genesis (`previousEventHash: null`). `verifyChain` inside `append` validates the chain.
- The projection is rebuilt from the **stored** events (not directly from `result.events`), so the persistence round-trip is genuinely on the critical path.
- Durable (file/sqlite) persistence is a future drop-in behind the unchanged `LedgerStore` interface; out of scope for 3C.

---

## 7. Fail-Closed & Error Semantics

| Condition | Behaviour |
|-----------|-----------|
| `client.open()` → `UpstreamUnavailableError` | Degraded: close client, `servedTools = []`, server still serves empty `tools/list`. |
| `client.listTools()` → `UpstreamListToolsError` | Degraded (same as above); the open client is closed in the catch. |
| `store.append` → `LedgerConflictError` (unexpected in single-process boot) | Re-thrown — indicates a bug (e.g. a shared store across concurrent boots), not a provider condition. |
| `tools/call` (any tool, any args) | Structured deny (`TOOL_CALL_NOT_AVAILABLE`). Nothing is routed upstream. |
| stdout hygiene | Downstream `StdioServerTransport` owns stdout for JSON-RPC; all diagnostics go to stderr. |

Default-deny holds end-to-end: a degraded gateway exposes **zero** tools rather than an ungoverned upstream list, and no `tools/call` ever reaches upstream in 3C.

---

## 8. Testing Strategy (TDD)

All tests run in the default vitest suite except the gated live test. `bin/gateway-local.ts` is excluded from the suite (entry point), matching `bin/gateway-import.ts`.

### 8.1 `gateway-state.test.ts` — pure, golden

Drive `reconcileManifest` over the frozen `bitget36RawTools` fixture with fixed deps, project, then assert selection:

- `selectServedTools(result.normalized, view).length === 32`.
- The 4 blocked names are **excluded**: `transfer`, `withdraw`, `cancel_withdrawal` (asset_movement), `manage_subaccounts` (administrative).
- A sample visible tool (`spot_get_ticker`) is present **with** its `inputSchema`.
- `result.manifestHash === bitgetManifestHashV1` (fixture-intact sanity).
- `buildGatewayState(...)` ⇒ `servedTools.length === 32`, `toolCount === 36`, `degraded === false`, `manifestHash === bitgetManifestHashV1`.
- `degradedState()` ⇒ `{ servedTools: [], manifestHash: null, toolCount: 0, degraded: true }`.

### 8.2 `gateway-server.test.ts` — SDK round-trip via in-memory transport

```ts
const state: GatewayState = {
  servedTools: [{ name: "spot_get_ticker", inputSchema: { type: "object", properties: {} } }],
  manifestHash: "h", toolCount: 1, degraded: false,
};
const server = createGatewayServer(state);
const [clientT, serverT] = InMemoryTransport.createLinkedPair();
await server.connect(serverT);
const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
await client.connect(clientT);

const { tools } = await client.listTools();
expect(tools.map((t) => t.name)).toEqual(["spot_get_ticker"]);

const res = await client.callTool({ name: "spot_get_ticker", arguments: {} });
expect(res.isError).toBe(true);
expect((res as { traceguard?: { errorCode?: string } }).traceguard?.errorCode).toBe("TOOL_CALL_NOT_AVAILABLE");
```

`Client` and `InMemoryTransport` import paths: `@modelcontextprotocol/sdk/client/index.js`, `@modelcontextprotocol/sdk/inMemory.js`.

### 8.3 `boot-gateway.test.ts` — pipeline with FakeUpstreamClient + InMemoryLedgerStore

A local `FakeUpstreamClient implements UpstreamManifestClient` with `opened`/`closed` flags, a configurable `throwOnList`/`throwOnOpen`, and `listTools()` returning `bitget36RawTools`.

- **Happy path:** `bootGateway` ⇒ `state.servedTools.length === 32`, `state.manifestHash === bitgetManifestHashV1`, `state.degraded === false`; `store.head(ws)` is non-null; `store.read(ws)` non-empty; **`fake.closed === false`** (connection kept alive per D2).
- **Degraded (listTools throws):** `state.degraded === true`, `state.servedTools.length === 0`, `failing.closed === true`, and `store.read(ws)` is empty (no events appended).
- **Degraded (open throws):** same degraded state; `listTools` never called.

### 8.4 `gateway-local.integration.test.ts` — optional, gated by `TRACEGUARD_LIVE_MCP`

Mirrors 3B's `stdio-upstream-client.integration.test.ts` (`describe.skipIf(!live)`). Boot against the real `bitget-mcp-server --paper-trading`, then:

- `handle.state.servedTools.length > 0` and `handle.state.degraded === false`.
- None of the blocked names (`withdraw`, `transfer`, `cancel_withdrawal`, `manage_subaccounts`) appear in `servedTools`.
- Close `handle.client` in a `finally`.

Per the frozen-fixture decision, the live visible count (31) differs from the golden (32) by design; the live assertion stays a loose lower-bound + blocklist-exclusion, not an exact count. The golden exact-count assertion lives only in the fixture-based tests.

---

## 9. File & Module Inventory

| Path | Action | Responsibility |
|------|--------|----------------|
| `packages/mcp-gateway/src/gateway-state.ts` | **create** | Pure types + `selectServedTools` / `buildGatewayState` / `degradedState`. |
| `packages/mcp-gateway/src/gateway-server.ts` | **create** | `createGatewayServer(state)` + `denyToolCall`; SDK `Server` factory. |
| `packages/mcp-gateway/src/boot-gateway.ts` | **create** | `bootGateway` startup pipeline (open→list→reconcile→append→read→project→buildState). |
| `packages/mcp-gateway/src/bin/gateway-local.ts` | **create** | Composition root / stdio entry point (excluded from test suite). |
| `packages/mcp-gateway/src/index.ts` | **modify** | Add barrel exports for `gateway-state` / `gateway-server` / `boot-gateway`. |
| `packages/mcp-gateway/src/gateway-state.test.ts` | **create** | Pure golden selection tests. |
| `packages/mcp-gateway/src/gateway-server.test.ts` | **create** | In-memory transport round-trip (tools/list + tools/call deny). |
| `packages/mcp-gateway/src/boot-gateway.test.ts` | **create** | Pipeline + persistence + degraded paths with a fake client. |
| `packages/mcp-gateway/src/gateway-local.integration.test.ts` | **create (optional)** | Gated live boot against real bitget. |

No changes to other packages. `import-manifest.ts` and `bin/gateway-import.ts` (3B) are untouched.

---

## 10. Documentation Alignment

3C should, in its plan, land two small doc notes (consistent with the user's full-coherence preference):

1. **`mcp-gateway-contract.md` §6.2 vs §7.1 reconciliation.** §6.2 describes a startup import; §7.1 describes a per-`tools/list` upstream fetch. TraceGuard implements the **startup-import** path (D2) and serves `tools/list` from the governed cache. Add a one-line note to §7.1 clarifying that the pipeline runs **at startup** and `tools/list` is answered from the governed cache (not a fresh per-request upstream fetch in the local stdio gateway).
2. **New structured error code.** Add `TOOL_CALL_NOT_AVAILABLE` to the §14 error-code table: "Gateway build does not yet route tool execution (pre-3D)." Fail-closed; superseded by 3D's call-time codes.

3A/3B specs already scope Persistence / LedgerStore wiring / the tools/list response & visibility filter to 3C; no edits needed there.

---

## 11. Acceptance Criteria

- [ ] A local agent can connect to `gateway-local` over stdio, `initialize`, and `tools/list`, receiving exactly the governed-visible tool set (32 at the locked Bitget baseline), each with a usable `inputSchema`.
- [ ] The 4 blocked tools (`withdraw`, `transfer`, `cancel_withdrawal`, `manage_subaccounts`) never appear in `tools/list`.
- [ ] Any `tools/call` returns a structured `TOOL_CALL_NOT_AVAILABLE` deny; nothing is sent upstream.
- [ ] Manifest events are persisted through `InMemoryLedgerStore` and the served view is rebuilt from the stored events.
- [ ] Upstream-import failure degrades to an empty `tools/list` (server still responds), never an ungoverned passthrough.
- [ ] The upstream connection remains open after a successful boot (ready for 3D); the entry point closes it on SIGINT/SIGTERM.
- [ ] All default-suite tests pass; the live test is gated behind `TRACEGUARD_LIVE_MCP`.
- [ ] stdout carries only JSON-RPC; all diagnostics go to stderr.

---

## 12. Out-of-Scope Boundary (hand-off to 3D)

3D picks up the **same long-lived `client`** from the `GatewayHandle`, replaces `denyToolCall` with real `tools/call` routing (existence/approved-manifest check → argument validation → risk classification → decision/policy path), and adds the run-context + tool-call events. 3C deliberately leaves the `tools/call` handler as the single seam 3D rewrites.
