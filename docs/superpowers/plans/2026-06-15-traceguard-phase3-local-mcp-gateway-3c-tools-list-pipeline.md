# TraceGuard Phase 3 — Sub-project 3C: tools/list Response Pipeline & Minimal Downstream Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the store-free 3B import path into a running, governed downstream stdio MCP server that answers `initialize` + `tools/list` with only the governed-visible tool subset, persists manifest events through `InMemoryLedgerStore`, and fail-closes every `tools/call`.

**Architecture:** House functional-core / imperative-shell split. A **pure** `gateway-state.ts` joins the projection's visible name-set against the live normalized definitions; a thin **shell** `gateway-server.ts` wires an SDK `Server`; a thin **shell** `boot-gateway.ts` runs the startup pipeline (open → list → reconcile → append → read → project → buildState) and keeps the upstream connection open on success; `bin/gateway-local.ts` is the composition root. Builds on merged 1A+1B+2+3A+3B on `main`.

**Tech Stack:** TypeScript strict ESM (NodeNext, ES2022, `noUncheckedIndexedAccess` on), `@modelcontextprotocol/sdk` ^1.29.0, vitest, pnpm workspaces. Source-of-truth spec: `docs/superpowers/specs/2026-06-15-traceguard-phase3-local-mcp-gateway-3c-tools-list-pipeline-design.md`.

**Git constraint:** Commit locally on `main` after each task. **Do NOT push.** Stage only each task's named source files with explicit `git add <path>` (never `-A` / `.` / `-u`); never stage `dist/` or `*.tsbuildinfo`.

---

## File Structure

All new/modified files live under `packages/mcp-gateway/src/`:

```text
gateway-state.ts              PURE   create — ServedTool / GatewayState types; selectServedTools / buildGatewayState / degradedState
gateway-state.test.ts         TEST   create — pure golden selection (32 visible, 4 blocked excluded)
gateway-server.ts             SHELL  create — createGatewayServer(state) SDK Server factory; denyToolCall
gateway-server.test.ts        TEST   create — in-memory transport round-trip (tools/list + tools/call deny)
boot-gateway.ts               SHELL  create — bootGateway pipeline; GatewayHandle; safeClose
boot-gateway.test.ts          TEST   create — pipeline + persistence + degraded paths (FakeUpstreamClient + InMemoryLedgerStore)
bin/gateway-local.ts          ENTRY  create — composition root / stdio entry (excluded from test suite)
gateway-local.integration.test.ts  TEST  create — gated live boot against real bitget (TRACEGUARD_LIVE_MCP)
index.ts                      MOD    modify — barrel: add gateway-state / gateway-server / boot-gateway exports
```

Outside the package: `docs/mcp-gateway-contract.md` gets two small alignment notes (Task 7). `import-manifest.ts` and `bin/gateway-import.ts` (3B) are **untouched**.

**Dependency / build order:** state (1) → server (2) → boot (3) → barrel (4) → bin (5) → integration test (6) → docs (7). Tests import sibling modules directly via relative `./x.js` paths, not via the barrel, so the barrel ordering is independent.

### Critical deviation from the spec (bake into Task 2)

The spec §4.2 prints `denyToolCall` returning the bespoke `ToolCallDenial` interface. **That does not typecheck** — verified empirically: the SDK request-handler return type is the loose `ServerResult` union, and a concrete object carrying an extra `traceguard` key is not assignable (TS2322, "Property 'task' is missing"). The fix, also verified to produce **zero** typecheck errors, is to have `denyToolCall` return the SDK `CallToolResult` type and cast at the boundary with `as unknown as CallToolResult`. The bespoke `traceguard` field still survives at runtime because the SDK's `ResultSchema = z.looseObject(...)` (passthrough) and `CallToolResultSchema` extends it, so the client-side parse keeps the field. Task 2 below uses the corrected form.

---

## Task 1: `gateway-state.ts` — pure visible-set selection

**Files:**
- Create: `packages/mcp-gateway/src/gateway-state.ts`
- Test: `packages/mcp-gateway/src/gateway-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mcp-gateway/src/gateway-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reconcileManifest, type ReconcileManifestArgs } from "@traceguard/tool-manifest";
import { toolManifestProjection, sha256hex } from "@traceguard/event-ledger";
import {
  bitget36RawTools,
  bitgetManifestHashV1,
  fixedClock,
  sequentialIdGen,
} from "@traceguard/testing-fixtures";
import { selectServedTools, buildGatewayState, degradedState } from "./gateway-state.js";

function makeDeps() {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

const baseArgs: Omit<ReconcileManifestArgs, "observed"> = {
  workspaceId: "ws_demo",
  providerConnectionId: "pc_bitget",
  providerType: "bitget_agent_hub",
  toolManifestVersionId: "tmv_1",
};

describe("selectServedTools / buildGatewayState", () => {
  it("selects exactly the 32 governed-visible tools, excluding the 4 blocked", () => {
    const result = reconcileManifest({ ...baseArgs, observed: bitget36RawTools }, makeDeps());
    const view = toolManifestProjection(result.events);
    const served = selectServedTools(result.normalized, view);

    expect(served).toHaveLength(32);
    const names = served.map((t) => t.name);
    for (const blocked of ["transfer", "withdraw", "cancel_withdrawal", "manage_subaccounts"]) {
      expect(names).not.toContain(blocked);
    }
    const ticker = served.find((t) => t.name === "spot_get_ticker");
    expect(ticker).toBeDefined();
    expect(ticker?.inputSchema).toBeDefined();
  });

  it("is sorted by name", () => {
    const result = reconcileManifest({ ...baseArgs, observed: bitget36RawTools }, makeDeps());
    const view = toolManifestProjection(result.events);
    const names = selectServedTools(result.normalized, view).map((t) => t.name);
    expect(names).toEqual([...names].sort());
  });

  it("reproduces the golden manifest hash (fixture intact)", () => {
    const result = reconcileManifest({ ...baseArgs, observed: bitget36RawTools }, makeDeps());
    expect(result.manifestHash).toBe(bitgetManifestHashV1);
  });

  it("buildGatewayState wraps the selection with counts and degraded=false", () => {
    const result = reconcileManifest({ ...baseArgs, observed: bitget36RawTools }, makeDeps());
    const view = toolManifestProjection(result.events);
    const state = buildGatewayState({
      normalized: result.normalized,
      view,
      manifestHash: result.manifestHash,
      toolCount: bitget36RawTools.length,
    });
    expect(state.servedTools).toHaveLength(32);
    expect(state.toolCount).toBe(36);
    expect(state.degraded).toBe(false);
    expect(state.manifestHash).toBe(bitgetManifestHashV1);
  });

  it("degradedState exposes zero tools and a null manifest hash", () => {
    expect(degradedState()).toEqual({
      servedTools: [],
      manifestHash: null,
      toolCount: 0,
      degraded: true,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test gateway-state`
Expected: FAIL — vitest cannot resolve `./gateway-state.js` (module not yet created).

- [ ] **Step 3: Write the implementation**

Create `packages/mcp-gateway/src/gateway-state.ts`:

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
  manifestHash: string | null; // null only in degraded mode
  toolCount: number; // upstream tool count this boot (0 when degraded)
  degraded: boolean; // true when startup import failed (provider degraded)
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

// Join the projection's visible name-set against the normalized definitions.
export function selectServedTools(
  normalized: NormalizedToolDefinition[],
  view: ToolInventoryView,
): ServedTool[] {
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

export function buildGatewayState(args: {
  normalized: NormalizedToolDefinition[];
  view: ToolInventoryView;
  manifestHash: string;
  toolCount: number;
}): GatewayState {
  return {
    servedTools: selectServedTools(args.normalized, args.view),
    manifestHash: args.manifestHash,
    toolCount: args.toolCount,
    degraded: false,
  };
}

export function degradedState(): GatewayState {
  return { servedTools: [], manifestHash: null, toolCount: 0, degraded: true };
}
```

- [ ] **Step 4: Run the test and typecheck to verify they pass**

Run: `pnpm test gateway-state`
Expected: PASS (5 tests).

Run: `pnpm typecheck`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-gateway/src/gateway-state.ts packages/mcp-gateway/src/gateway-state.test.ts
git commit -m "feat(mcp-gateway): add pure gateway-state visible-set selection"
```

---

## Task 2: `gateway-server.ts` — minimal downstream MCP Server shell

**Files:**
- Create: `packages/mcp-gateway/src/gateway-server.ts`
- Test: `packages/mcp-gateway/src/gateway-server.test.ts`

> **Note (deviation from spec §4.2):** `denyToolCall` returns `CallToolResult` (not the bespoke `ToolCallDenial`) and casts with `as unknown as CallToolResult`. This is required for typecheck — see "Critical deviation" above. The `ToolCallDenial` interface is retained to type the denial object before the boundary cast, so the structure stays checked.

- [ ] **Step 1: Write the failing test**

Create `packages/mcp-gateway/src/gateway-server.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGatewayServer } from "./gateway-server.js";
import type { GatewayState } from "./gateway-state.js";

function fixtureState(): GatewayState {
  return {
    servedTools: [{ name: "spot_get_ticker", inputSchema: { type: "object", properties: {} } }],
    manifestHash: "h",
    toolCount: 1,
    degraded: false,
  };
}

async function connectedClient(state: GatewayState): Promise<Client> {
  const server = createGatewayServer(state);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await client.connect(clientT);
  return client;
}

describe("createGatewayServer", () => {
  it("serves the governed tool list over tools/list", async () => {
    const client = await connectedClient(fixtureState());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["spot_get_ticker"]);
  });

  it("fail-closed: every tools/call returns TOOL_CALL_NOT_AVAILABLE", async () => {
    const client = await connectedClient(fixtureState());
    const res = await client.callTool({ name: "spot_get_ticker", arguments: {} });
    expect(res.isError).toBe(true);
    expect((res as { traceguard?: { errorCode?: string } }).traceguard?.errorCode).toBe(
      "TOOL_CALL_NOT_AVAILABLE",
    );
  });

  it("fail-closed even for an unknown tool name", async () => {
    const client = await connectedClient(fixtureState());
    const res = await client.callTool({ name: "definitely_not_a_tool", arguments: {} });
    expect(res.isError).toBe(true);
    expect((res as { traceguard?: { toolName?: string } }).traceguard?.toolName).toBe(
      "definitely_not_a_tool",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test gateway-server`
Expected: FAIL — vitest cannot resolve `./gateway-server.js` (module not yet created).

- [ ] **Step 3: Write the implementation**

Create `packages/mcp-gateway/src/gateway-server.ts`:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { GatewayState } from "./gateway-state.js";

export const GATEWAY_SERVER_INFO = { name: "traceguard-gateway", version: "0.2.0" } as const;

export interface ToolCallDenial {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  traceguard: { errorCode: "TOOL_CALL_NOT_AVAILABLE"; toolName: string };
}

export function denyToolCall(toolName: string): CallToolResult {
  const denial: ToolCallDenial = {
    isError: true,
    content: [
      {
        type: "text",
        text: "Tool execution is not enabled in this gateway build. Governed execution arrives in a later TraceGuard milestone.",
      },
    ],
    traceguard: { errorCode: "TOOL_CALL_NOT_AVAILABLE", toolName },
  };
  // The SDK request-handler return type is the loose `ServerResult` union; the bespoke
  // `traceguard` field is not in `CallToolResult`'s static type but survives at runtime
  // (CallToolResultSchema extends a z.looseObject, so the client-side parse keeps it).
  return denial as unknown as CallToolResult;
}

export function createGatewayServer(state: GatewayState): Server {
  const server = new Server(GATEWAY_SERVER_INFO, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: state.servedTools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => denyToolCall(req.params.name));
  return server;
}
```

- [ ] **Step 4: Run the test and typecheck to verify they pass**

Run: `pnpm test gateway-server`
Expected: PASS (3 tests).

Run: `pnpm typecheck`
Expected: no output (success). If this errors with TS2322 on the `CallToolRequestSchema` handler, the `as unknown as CallToolResult` cast in `denyToolCall` is missing — re-add it.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-gateway/src/gateway-server.ts packages/mcp-gateway/src/gateway-server.test.ts
git commit -m "feat(mcp-gateway): add minimal downstream MCP server shell"
```

---

## Task 3: `boot-gateway.ts` — startup pipeline with ledger persistence

**Files:**
- Create: `packages/mcp-gateway/src/boot-gateway.ts`
- Test: `packages/mcp-gateway/src/boot-gateway.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mcp-gateway/src/boot-gateway.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { RawUpstreamTool } from "@traceguard/schemas";
import { InMemoryLedgerStore, sha256hex } from "@traceguard/event-ledger";
import type { ReconcileDeps } from "@traceguard/tool-manifest";
import {
  bitget36RawTools,
  bitgetManifestHashV1,
  fixedClock,
  sequentialIdGen,
} from "@traceguard/testing-fixtures";
import { bootGateway, type BootGatewayArgs } from "./boot-gateway.js";
import {
  UpstreamListToolsError,
  UpstreamUnavailableError,
  type UpstreamManifestClient,
} from "./upstream-client.js";

class FakeUpstreamClient implements UpstreamManifestClient {
  opened = 0;
  listed = 0;
  closed = 0;
  constructor(
    private readonly script:
      | { kind: "tools"; tools: RawUpstreamTool[] }
      | { kind: "openThrows" }
      | { kind: "listThrows" },
  ) {}
  async open(): Promise<void> {
    this.opened++;
    if (this.script.kind === "openThrows") throw new UpstreamUnavailableError("spawn failed");
  }
  async listTools(): Promise<RawUpstreamTool[]> {
    this.listed++;
    if (this.script.kind === "listThrows") throw new UpstreamListToolsError("transport dropped");
    if (this.script.kind === "tools") return this.script.tools;
    throw new Error("unreachable");
  }
  async close(): Promise<void> {
    this.closed++;
  }
}

function makeDeps(): ReconcileDeps {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

const baseArgs: BootGatewayArgs = {
  workspaceId: "ws_demo",
  providerConnectionId: "pc_bitget",
  providerType: "bitget_agent_hub",
  toolManifestVersionId: "tmv_1",
};

describe("bootGateway", () => {
  it("happy path: serves 32 governed tools, persists events, keeps the client open", async () => {
    const client = new FakeUpstreamClient({ kind: "tools", tools: bitget36RawTools });
    const store = new InMemoryLedgerStore();
    const handle = await bootGateway(baseArgs, client, store, makeDeps());

    expect(handle.state.degraded).toBe(false);
    expect(handle.state.servedTools).toHaveLength(32);
    expect(handle.state.manifestHash).toBe(bitgetManifestHashV1);
    expect(handle.state.toolCount).toBe(36);
    expect(handle.server).toBeDefined();

    expect(client.opened).toBe(1);
    expect(client.listed).toBe(1);
    expect(client.closed).toBe(0); // D2: connection kept alive on success

    expect(await store.head(baseArgs.workspaceId)).not.toBeNull();
    expect(await store.read(baseArgs.workspaceId)).toHaveLength(5); // 1 imported + 4 blocked
  });

  it("degraded (listTools throws): empty tool list, client closed, nothing persisted", async () => {
    const client = new FakeUpstreamClient({ kind: "listThrows" });
    const store = new InMemoryLedgerStore();
    const handle = await bootGateway(baseArgs, client, store, makeDeps());

    expect(handle.state.degraded).toBe(true);
    expect(handle.state.servedTools).toHaveLength(0);
    expect(handle.state.manifestHash).toBeNull();
    expect(handle.server).toBeDefined(); // still serves (empty list), never refuses to boot

    expect(client.opened).toBe(1);
    expect(client.listed).toBe(1);
    expect(client.closed).toBe(1); // degraded: nothing to keep alive

    expect(await store.read(baseArgs.workspaceId)).toHaveLength(0);
  });

  it("degraded (open throws): never lists, client closed, nothing persisted", async () => {
    const client = new FakeUpstreamClient({ kind: "openThrows" });
    const store = new InMemoryLedgerStore();
    const handle = await bootGateway(baseArgs, client, store, makeDeps());

    expect(handle.state.degraded).toBe(true);
    expect(handle.state.servedTools).toHaveLength(0);

    expect(client.opened).toBe(1);
    expect(client.listed).toBe(0); // open() threw before listTools
    expect(client.closed).toBe(1);

    expect(await store.read(baseArgs.workspaceId)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test boot-gateway`
Expected: FAIL — vitest cannot resolve `./boot-gateway.js` (module not yet created).

- [ ] **Step 3: Write the implementation**

Create `packages/mcp-gateway/src/boot-gateway.ts`:

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
      await safeClose(client); // degraded: nothing to keep alive
      state = degradedState();
    } else {
      await safeClose(client); // unexpected (e.g. LedgerConflictError, bug): surface it
      throw err;
    }
  }
  const server = createGatewayServer(state);
  return { state, server, client };
}

async function safeClose(client: UpstreamManifestClient): Promise<void> {
  try {
    await client.close();
  } catch {
    /* teardown is best-effort */
  }
}
```

- [ ] **Step 4: Run the test and typecheck to verify they pass**

Run: `pnpm test boot-gateway`
Expected: PASS (3 tests).

Run: `pnpm typecheck`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-gateway/src/boot-gateway.ts packages/mcp-gateway/src/boot-gateway.test.ts
git commit -m "feat(mcp-gateway): add bootGateway startup pipeline with ledger persistence"
```

---

## Task 4: `index.ts` — export the 3C modules from the barrel

**Files:**
- Modify: `packages/mcp-gateway/src/index.ts`

No unit test (a barrel re-export has no behavior to red-test). Verification is typecheck + the full package suite staying green.

- [ ] **Step 1: Modify the barrel**

Replace the entire contents of `packages/mcp-gateway/src/index.ts` with:

```ts
export * from "./upstream-client.js";
export * from "./map-tool.js";
export * from "./import-manifest.js";
export * from "./stdio-upstream-client.js";
export * from "./gateway-state.js";
export * from "./gateway-server.js";
export * from "./boot-gateway.js";
```

- [ ] **Step 2: Typecheck and run the package suite**

Run: `pnpm typecheck`
Expected: no output (success — no duplicate-export collisions).

Run: `pnpm test packages/mcp-gateway`
Expected: PASS — all mcp-gateway tests green (gateway-state, gateway-server, boot-gateway, import-manifest, map-tool, stdio-upstream-client; the gated live test self-skips).

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-gateway/src/index.ts
git commit -m "feat(mcp-gateway): export 3C gateway modules from barrel"
```

---

## Task 5: `bin/gateway-local.ts` — stdio composition root

**Files:**
- Create: `packages/mcp-gateway/src/bin/gateway-local.ts`

No unit test: `bin/*.ts` is an entry point, excluded from the vitest suite (it is not a `*.test.ts` file), matching 3B's `bin/gateway-import.ts`. It **is** typechecked by `tsc` (tsconfig `include: ["src"]`). Behavioral coverage of the boot pipeline it composes is the gated integration test in Task 6.

> **Do NOT smoke-test by running the compiled bin under plain `node`.** A known repo-wide resolution gap (every `@traceguard/*` package `exports` points at TS source) means `node dist/bin/gateway-local.js` fails to resolve workspace imports. The designed live path is Task 6's gated integration test, which runs the same `bootGateway` code through vitest's resolver.

- [ ] **Step 1: Write the entry point**

Create `packages/mcp-gateway/src/bin/gateway-local.ts`:

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
  const client = new StdioUpstreamClient({
    command: process.execPath,
    args: [serverEntry, "--paper-trading"],
  });
  const store = new InMemoryLedgerStore();

  const { server, state, client: live } = await bootGateway(
    {
      workspaceId: "ws_demo",
      providerConnectionId: "pc_bitget_demo",
      providerType: "bitget_agent_hub",
      toolManifestVersionId: newId.next("tmv"),
    },
    client,
    store,
    deps,
  );

  // stdout is reserved for downstream JSON-RPC; every diagnostic goes to stderr (contract §19.1).
  console.error(
    `[gateway-local] served tools: ${state.servedTools.length}${state.degraded ? " (DEGRADED)" : ""}`,
  );
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

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-gateway/src/bin/gateway-local.ts
git commit -m "feat(mcp-gateway): add gateway-local stdio composition root"
```

---

## Task 6: `gateway-local.integration.test.ts` — gated live boot

**Files:**
- Create: `packages/mcp-gateway/src/gateway-local.integration.test.ts`

Mirrors 3B's `stdio-upstream-client.integration.test.ts`: self-skips unless `TRACEGUARD_LIVE_MCP` is set, so it never runs in the default suite. Per the frozen-fixture decision, the live visible count (31) differs from the golden (32) by design; the assertion is a loose lower-bound + blocklist-exclusion, never an exact count.

- [ ] **Step 1: Write the gated test**

Create `packages/mcp-gateway/src/gateway-local.integration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { SystemClock, SystemIdGen, sha256hex, InMemoryLedgerStore } from "@traceguard/event-ledger";
import { StdioUpstreamClient } from "./stdio-upstream-client.js";
import { bootGateway } from "./boot-gateway.js";

const live = Boolean(process.env.TRACEGUARD_LIVE_MCP);
const BLOCKED = ["withdraw", "transfer", "cancel_withdrawal", "manage_subaccounts"];

describe.skipIf(!live)("gateway-local (live, gated by TRACEGUARD_LIVE_MCP)", () => {
  it(
    "boots a governed gateway against the real bitget-mcp-server",
    async () => {
      const serverEntry = createRequire(import.meta.url).resolve("bitget-mcp-server");
      const newId = new SystemIdGen();
      const client = new StdioUpstreamClient({
        command: process.execPath,
        args: [serverEntry, "--paper-trading"],
      });
      const store = new InMemoryLedgerStore();
      const handle = await bootGateway(
        {
          workspaceId: "ws_live",
          providerConnectionId: "pc_bitget_live",
          providerType: "bitget_agent_hub",
          toolManifestVersionId: newId.next("tmv"),
        },
        client,
        store,
        { clock: new SystemClock(), newId, hash: sha256hex },
      );
      try {
        expect(handle.state.degraded).toBe(false);
        expect(handle.state.servedTools.length).toBeGreaterThan(0);
        expect(handle.state.manifestHash).toMatch(/^[0-9a-f]{64}$/);
        const names = handle.state.servedTools.map((t) => t.name);
        for (const blocked of BLOCKED) expect(names).not.toContain(blocked);
      } finally {
        await handle.client.close();
      }
    },
    30_000,
  );
});
```

- [ ] **Step 2: Run the suite to confirm it skips by default**

Run: `pnpm test gateway-local.integration`
Expected: the `describe` block is **skipped** (e.g. `Test Files … (skipped)` / `Tests … skipped`); no live process is spawned, exit code 0.

- [ ] **Step 3 (optional): Run it live**

If verifying against the real provider (requires `bitget-mcp-server` installed; needs **no** Bitget secret — tool discovery is unauthenticated):

Run: `TRACEGUARD_LIVE_MCP=1 pnpm test gateway-local.integration --disableConsoleIntercept`
Expected: PASS — degraded=false, `servedTools.length > 0`, none of the 4 blocked names present.

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm typecheck`
Expected: no output (success).

```bash
git add packages/mcp-gateway/src/gateway-local.integration.test.ts
git commit -m "test(mcp-gateway): add gated live boot integration test"
```

---

## Task 7: Documentation alignment — `mcp-gateway-contract.md`

**Files:**
- Modify: `docs/mcp-gateway-contract.md`

Two small notes (spec §10), consistent with the full-coherence preference. No test.

- [ ] **Step 1: Add the startup-import note to §7.1**

In `docs/mcp-gateway-contract.md`, the §7.1 pipeline ends with a code block, then a `------` separator, then the `### 7.2` heading. Anchor the Edit on the **unique `### 7.2` heading** so the note lands at the end of §7.1 (after its pipeline code block) without having to match the code fence. Use the Edit tool with these exact strings (shown as indented blocks to avoid fence ambiguity):

old_string (separator + blank line + the §7.2 heading):

    ------

    ### 7.2 Normalized Tool Definition

new_string (the note, blank line, then the original three lines unchanged):

    > **TraceGuard local stdio gateway (3C):** In the local stdio gateway this pipeline runs **once at startup** (`bootGateway`). `tools/list` is then answered from the governed in-memory cache — the persisted manifest projection joined with that boot's normalized tool definitions — not a fresh per-request upstream fetch. The long-lived upstream connection is reused by the call-routing milestone (3D).

    ------

    ### 7.2 Normalized Tool Definition

Note: the indentation above is presentational only — the actual file lines (`------`, the blank line, `### 7.2 Normalized Tool Definition`, and the blockquote) are flush-left with no leading spaces.

- [ ] **Step 2: Add the `TOOL_CALL_NOT_AVAILABLE` row to the §14 error-code table**

Use Edit to insert the new row directly after the `TOOL_BLOCKED` row:

old_string:
```text
| `TOOL_BLOCKED`               | Tool is explicitly blocked                        |
| `UNKNOWN_TOOL`               | Tool is not recognized                            |
```

new_string:
```text
| `TOOL_BLOCKED`               | Tool is explicitly blocked                        |
| `TOOL_CALL_NOT_AVAILABLE`    | Gateway build does not yet route tool execution (pre-3D); fail-closed deny |
| `UNKNOWN_TOOL`               | Tool is not recognized                            |
```

- [ ] **Step 3: Commit**

```bash
git add docs/mcp-gateway-contract.md
git commit -m "docs(contract): note startup-import pipeline and TOOL_CALL_NOT_AVAILABLE"
```

---

## Final Verification (after all 7 tasks)

- [ ] Run the full suite: `pnpm test`
  Expected: all tests PASS; the `gateway-local.integration` describe is skipped (no `TRACEGUARD_LIVE_MCP`).
- [ ] Run the full typecheck: `pnpm typecheck`
  Expected: no output (success).
- [ ] Confirm `git status` shows a clean tree (every task committed) and **nothing was pushed**.
- [ ] Spot-check the acceptance criteria from spec §11: 32 governed-visible tools, 4 blocked tools never listed, every `tools/call` denied with `TOOL_CALL_NOT_AVAILABLE`, events persisted through `InMemoryLedgerStore`, degraded boot yields an empty (not ungoverned) list, the upstream connection stays open after a successful boot, stdout carries only JSON-RPC.

---

## Acceptance Criteria (from spec §11)

- [ ] A local agent can connect to `gateway-local` over stdio, `initialize`, and `tools/list`, receiving exactly the governed-visible tool set (32 at the locked Bitget baseline), each with a usable `inputSchema`.
- [ ] The 4 blocked tools (`withdraw`, `transfer`, `cancel_withdrawal`, `manage_subaccounts`) never appear in `tools/list`.
- [ ] Any `tools/call` returns a structured `TOOL_CALL_NOT_AVAILABLE` deny; nothing is sent upstream.
- [ ] Manifest events are persisted through `InMemoryLedgerStore` and the served view is rebuilt from the stored events.
- [ ] Upstream-import failure degrades to an empty `tools/list` (server still responds), never an ungoverned passthrough.
- [ ] The upstream connection remains open after a successful boot (ready for 3D); the entry point closes it on SIGINT/SIGTERM.
- [ ] All default-suite tests pass; the live test is gated behind `TRACEGUARD_LIVE_MCP`.
- [ ] stdout carries only JSON-RPC; all diagnostics go to stderr.
