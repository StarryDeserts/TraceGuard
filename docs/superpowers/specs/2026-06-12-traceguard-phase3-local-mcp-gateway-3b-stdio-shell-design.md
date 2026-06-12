# TraceGuard — Phase 3 (3B): stdio MCP Server Shell & Upstream Client Design

- **Status:** Approved (design), ready for implementation planning
- **Date:** 2026-06-12
- **Scope:** Phase 3 sub-project **3B** — the **imperative shell** of the Local MCP Gateway's
  tool-discovery path. 3B spawns `bitget-mcp-server` over stdio (with `--paper-trading` for the
  hackathon demo), performs the MCP `initialize` handshake + `tools/list`, maps the live upstream
  tools into `RawUpstreamTool[]`, and feeds them into the already-built **3A** pure core
  (`reconcileManifest`). 3B is the I/O boundary 3A deliberately omitted: it adds **no**
  classification, fingerprinting, or event-shaping logic of its own — it sources real inputs and
  invokes the 3A core behind one injected seam. It is **store-free** (returns `LedgerEvent[]`; does
  not persist) — persistence is 3C.
- **Source of truth:** `docs/mcp-gateway-contract.md` (§7 Tool Discovery — the discovery flow this
  shell drives), the **3A spec**
  (`docs/superpowers/specs/2026-06-11-traceguard-phase3-local-mcp-gateway-3a-classification.md`, §1.1
  for the 3B definition, §5–§7 for the core 3B wraps), and the Model Context Protocol TypeScript SDK
  (`@modelcontextprotocol/sdk`). Where this spec restates a canonical type or rule, the canonical
  doc / 3A artifact wins; section references are given so drift can be detected.
- **Builds on:** Spec 1A + 1B + 2 + **3A** (all merged on `main`). 3B reuses the functional-core /
  imperative-shell split and the injected `deps = { clock, newId, hash }` discipline. The 3A pure
  core (`normalize` / `classify` / `manifest-hash` / `diff` / `reconcileManifest` /
  `toolManifestProjection`) is **unchanged and untouched** — 3B imports it as a library.

---

## 1. Context and goal

TraceGuard's central invariant is `Proposal ≠ Authorization ≠ Execution`, fail-closed /
default-deny. Phase 3 (the Local MCP Gateway) puts a real MCP client and a real upstream exchange
(`bitget-mcp-server`) in front of the Phase 1/2 decision core. 3A built the **pure gatekeeper**:
given an in-memory `RawUpstreamTool[]`, it normalizes, fingerprints, classifies, diffs, and
reconciles into hash-chained `ToolManifest*` / `Tool{Frozen,Blocked}` events plus a projection. 3A
performs **no I/O** — by design, its input is a list someone else must produce.

**3B is the someone else.** It is the thin imperative shell that actually talks to the upstream:
launch the `bitget-mcp-server` process, complete the MCP `initialize` handshake, call `tools/list`,
translate the SDK's tool objects into the `RawUpstreamTool` shape the 3A core consumes, and hand
them to `reconcileManifest`. Everything dangerous or non-deterministic — process spawning, stdio
transport, network-shaped failure, timeouts — lives here, behind a single injected seam so the
orchestration stays unit-testable with a fake and the classification core stays pure.

3B is deliberately **one-shot and store-free**: open → list → reconcile → close, returning the
events 3A produced. It does **not** persist them (3C owns `LedgerStore` wiring), does not filter a
`tools/list` *response* (3C owns the §7.4 visibility filter applied to a client reply), does not
route `tools/call` (3D), and emits no telemetry (3E). Its job is to make the 3A core run against a
**live** Bitget upstream and prove the manifest-discovery vertical slice end-to-end for the demo.

### 1.1 Phase 3 decomposition (context, not scope)

The Local MCP Gateway is built as a vertical-slice sequence; only **3B** is specified here:

- **3A (done)** — tool manifest & risk classification: the pure core + projection + events.
- **3B (this spec)** — stdio MCP server shell + upstream client: spawn `bitget-mcp-server` (with
  `--paper-trading` for the demo), perform `initialize` + `tools/list`, feed real
  `RawUpstreamTool[]` into 3A's `reconcileManifest`.
- **3C** — `tools/list` response pipeline: persist the manifest via `LedgerStore`, apply the §7.4
  visibility filter, return the governed tool list to the downstream MCP client.
- **3D** — `tools/call` routing into the existing decision/execution core.
- **3E** — OpenTelemetry spans + response redaction.

Demo-vs-live is a 3B shell concern: the `--paper-trading` flag (passed to the spawned upstream)
selects Bitget Demo Trading. The 3A core it feeds is environment-independent.

### 1.2 Exit criterion

> Given a launch configuration for `bitget-mcp-server`, 3B opens a stdio MCP session, completes
> `initialize`, retrieves the live `tools/list`, maps each tool into a `RawUpstreamTool`, and runs
> the unchanged 3A `reconcileManifest` over them — returning the resulting `LedgerEvent[]`,
> `manifestHash`, and an observed `toolCount`, and always tearing the upstream process down
> afterward. The path is **fail-closed**: if the upstream cannot be launched/initialized, or if
> `tools/list` fails, 3B surfaces a typed error, the 3A core is **never** invoked, **zero** events
> are produced, and the process is still closed. A runnable composition root (`bin/gateway-import`)
> wires the real stdio client to the real `SystemClock` / `SystemIdGen` / `sha256hex` and prints the
> discovered manifest summary — or a single fail-closed diagnostic and a non-zero exit.

3B is "done" when: `importManifest` orchestration is unit-tested against a `FakeUpstreamClient`
(golden manifest hash + classification fan-out over the deterministic 36-tool fixture; teardown;
both fail-closed paths; optional approved-baseline no-op); `mapTool` is unit-tested (drops `_meta`,
no explicit-`undefined` optionals); the real `StdioUpstreamClient` and `bin` are excluded from the
default suite (manual / env-gated live run); and the whole workspace still builds under TS strict
ESM with `@modelcontextprotocol/sdk` as a direct dependency of the new package.

---

## 2. Scope

### 2.1 In scope (3B)

- **New package `@traceguard/mcp-gateway`** — the imperative shell:
  - `upstream-client.ts` — the `UpstreamManifestClient` seam interface, the `UpstreamLaunchConfig`
    type, and the two typed error classes (`UpstreamUnavailableError`, `UpstreamListToolsError`).
  - `map-tool.ts` — pure `mapTool`: MCP SDK tool object → `RawUpstreamTool` (drops `_meta`).
  - `import-manifest.ts` — `importManifest`: the open → list → reconcile → close orchestration,
    taking the seam + `deps = { clock, newId, hash }`, returning `ReconcileResult & { toolCount }`.
  - `stdio-upstream-client.ts` — the **real** `StdioUpstreamClient` implementing the seam over
    `@modelcontextprotocol/sdk` (`Client` + `StdioClientTransport`).
  - `bin/gateway-import.ts` — the runnable composition root: resolves `bitget-mcp-server`, builds
    the real `StdioUpstreamClient` + real `deps`, runs `importManifest`, prints a manifest summary.
- **`@modelcontextprotocol/sdk` promoted to a direct dependency** of `@traceguard/mcp-gateway` (it
  is already present in the pnpm store as a transitive dependency of `bitget-mcp-server`).
- **Tests:** `import-manifest.test.ts` (against `FakeUpstreamClient`, reusing the 36-tool
  `testing-fixtures` fixture) and `map-tool.test.ts`. An optional `*.integration.test.ts` against
  the real upstream, **gated behind `process.env.TRACEGUARD_LIVE_MCP`** (off by default).

### 2.2 Out of scope (YAGNI / later sub-projects)

- **Persistence / `LedgerStore` wiring** — 3C. 3B returns `LedgerEvent[]`; it does not append them
  to a store. Tests assemble/verify in-memory exactly as 3A and the Phase 1/2 unit tests do.
- **The `tools/list` *response* + §7.4 visibility *filter*** — 3C. 3B computes a projection only in
  the `bin` for a human-readable summary; it does not return a filtered tool list to a downstream
  MCP client.
- **`tools/call` routing, decision/execution wiring** — 3D.
- **OpenTelemetry spans / response redaction** — 3E.
- **Bitget credentials.** `tools/list` is **credentials-free** on `bitget-mcp-server` (its list
  handler is not creds-gated); 3B's slice needs no `BITGET_*` secrets at all. Credentials are a
  `tools/call` (3D) concern, and even then are env-only (TraceGuard stores secret *references*,
  never secrets; nothing is ever written to a file or echoed).
- **Reconnect / mid-session crash recovery / partial-degradation / `tools/list_changed`
  subscription.** 3B is a **one-shot** fetch (open → list → close). *When* and *how often* to
  re-run discovery (polling, change notifications) is 3C+.
- **Any change to the 3A core.** `reconcileManifest`, the classifier, the risk table, the manifest
  hash, and the projection are imported unchanged.

---

## 3. Architecture and package layout

3B is a textbook imperative shell: a tiny amount of orchestration code wrapping a single I/O seam,
with all purity kept in the 3A library it calls. The new package depends on `schemas` (the
`RawUpstreamTool` / `ProviderType` types), `tool-manifest` (the 3A core: `reconcileManifest` + its
arg/result types), `event-ledger` (the `Clock` / `IdGen` types and the real `SystemClock` /
`SystemIdGen` / `sha256hex` / `toolManifestProjection` used only by the `bin`), and — new for the
workspace — `@modelcontextprotocol/sdk` for the stdio client.

| Package                    | 3B addition                                                                                                   | Prior parallel        |
|----------------------------|---------------------------------------------------------------------------------------------------------------|-----------------------|
| `mcp-gateway` (**new**)    | `upstream-client.ts`, `map-tool.ts`, `import-manifest.ts`, `stdio-upstream-client.ts`, `bin/gateway-import.ts` | imperative shell      |
| `@modelcontextprotocol/sdk`| promoted from transitive → **direct** dep of `mcp-gateway`                                                     | — (new direct dep)    |

Dependency direction stays acyclic: `mcp-gateway ← (schemas, tool-manifest, event-ledger, @modelcontextprotocol/sdk)`.
Nothing depends on `mcp-gateway` yet (3C will). No new cycles; the 3A core has no knowledge of 3B.

### 3.1 File tree

```text
packages/mcp-gateway/
  package.json                       # @traceguard/mcp-gateway; direct dep @modelcontextprotocol/sdk
  tsconfig.json                      # extends the workspace base (strict, NodeNext ESM)
  src/
    index.ts                         # barrel: upstream-client, map-tool, import-manifest, stdio-upstream-client
    upstream-client.ts               # seam interface + launch config + error classes (no I/O)
    map-tool.ts                      # pure: SDK tool → RawUpstreamTool
    import-manifest.ts               # orchestration: open → list → reconcile → close
    stdio-upstream-client.ts         # real seam impl over @modelcontextprotocol/sdk
    bin/
      gateway-import.ts              # runnable composition root (real client + real deps)
    import-manifest.test.ts          # FakeUpstreamClient: golden hash, fan-out, teardown, fail-closed
    map-tool.test.ts                 # _meta drop, optional-field handling
```

### 3.2 The seam / purity boundary (internal to `mcp-gateway`)

```text
  pure / library-facing                          I/O edge (process + stdio)
  ───────────────────────────                    ───────────────────────────────────────
  map-tool · import-manifest         ──seam──▶   stdio-upstream-client (real)
  (orchestration; no I/O of its own)             FakeUpstreamClient (tests)
                                                 bin/gateway-import (composition root)
```

`import-manifest` and `map-tool` never import `@modelcontextprotocol/sdk` or `node:child_process`;
they speak only to the `UpstreamManifestClient` interface. Only `stdio-upstream-client.ts` and the
`bin` touch the SDK and process APIs. This is the same functional-core / imperative-shell split the
rest of TraceGuard uses — here the "core" 3B contributes is the deterministic orchestration, and the
3A package is the deeper pure core underneath it.

---

## 4. The upstream-client seam (`upstream-client.ts`)

One narrow interface stands between the orchestration and the live MCP transport. The real
implementation drives `@modelcontextprotocol/sdk`; the test double is a hand-written fake. Both
implement exactly these three async methods.

```typescript
export interface UpstreamLaunchConfig {
  command: string;                 // executable to spawn (e.g. process.execPath = node)
  args?: string[];                 // e.g. [<bitget-mcp-server entry>, "--paper-trading"]
  env?: Record<string, string>;    // merged over getDefaultEnvironment(); omit to inherit safe defaults
  clientName?: string;             // MCP client identity (initialize); default "traceguard-gateway"
  clientVersion?: string;          // default "0.0.0"
}

export interface UpstreamManifestClient {
  open(): Promise<void>;                       // spawn + MCP initialize handshake
  listTools(): Promise<RawUpstreamTool[]>;     // MCP tools/list, mapped into RawUpstreamTool
  close(): Promise<void>;                      // terminate the upstream; idempotent
}

export class UpstreamUnavailableError extends Error {
  readonly name = "UpstreamUnavailableError";
}
export class UpstreamListToolsError extends Error {
  readonly name = "UpstreamListToolsError";
}
```

`RawUpstreamTool` is imported from `@traceguard/schemas` (the 3A/1A artifact). The seam returns
**already-mapped** `RawUpstreamTool[]` (not raw SDK objects), so `importManifest` never sees an SDK
type and the test fake can return fixture data directly.

### 4.1 `map-tool.ts` — SDK tool → `RawUpstreamTool` (pure)

The MCP SDK's `tools/list` yields tool objects carrying `name`, optional `title` / `description` /
`outputSchema` / `annotations`, an `inputSchema`, and an optional protocol-level `_meta`. `mapTool`
copies exactly the `RawUpstreamTool` fields and **drops `_meta`** (it is MCP plumbing, not part of
the tool's identity or risk surface — including it would pollute the fingerprint).

```typescript
import type { RawUpstreamTool } from "@traceguard/schemas";

interface UpstreamToolShape {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

export function mapTool(tool: UpstreamToolShape): RawUpstreamTool {
  const mapped: RawUpstreamTool = { name: tool.name, inputSchema: tool.inputSchema ?? {} };
  if (tool.title !== undefined) mapped.title = tool.title;
  if (tool.description !== undefined) mapped.description = tool.description;
  if (tool.outputSchema !== undefined) mapped.outputSchema = tool.outputSchema;
  if (tool.annotations !== undefined) mapped.annotations = tool.annotations;
  return mapped;
}
```

Optional fields are assigned **only when present** (never stored as explicit `undefined`), matching
the house convention and keeping the `canonicalJson(fingerprint)` 3A computes stable — "field
absent" and "field `undefined`" must not diverge. `inputSchema ?? {}` keeps the downstream
`computeSchemaHash` total even if an upstream omits the (MCP-required) schema. `annotations` is
preserved verbatim so 3A's `writeAnnotationRule` can read `destructiveHint` / `readOnlyHint`.

---

## 5. Orchestration — `import-manifest.ts`

`importManifest` is the whole of 3B's logic: bracket a `tools/list` between `open()` and `close()`,
hand the observed tools to the unchanged 3A `reconcileManifest`, and report what was seen. It is
**async** (the only async function in the path that matters for tests) but otherwise a thin
deterministic wrapper — given a fake client returning fixed tools and fixed `deps`, its output is
byte-reproducible.

```typescript
import type { ProviderType, RawUpstreamTool } from "@traceguard/schemas";
import {
  reconcileManifest,
  type ApprovedManifest,
  type ReconcileDeps,
  type ReconcileResult,
} from "@traceguard/tool-manifest";
import type { UpstreamManifestClient } from "./upstream-client.js";

export interface ImportManifestArgs {
  workspaceId: string;
  providerConnectionId: string;
  providerType: ProviderType;
  toolManifestVersionId: string;
  approved?: ApprovedManifest;
  previousEventHash?: string | null;
}

export interface ImportManifestResult extends ReconcileResult {
  toolCount: number;
}

export async function importManifest(
  args: ImportManifestArgs,
  client: UpstreamManifestClient,
  deps: ReconcileDeps,
): Promise<ImportManifestResult> {
  await client.open();
  try {
    const observed: RawUpstreamTool[] = await client.listTools();
    const result = reconcileManifest({ ...args, observed }, deps);
    return { ...result, toolCount: observed.length };
  } finally {
    await client.close();
  }
}
```

Notes:

- `ImportManifestArgs` is exactly `ReconcileManifestArgs` **minus `observed`** — 3B supplies
  `observed` from the live `listTools()`. `{ ...args, observed }` reconstructs the full
  `ReconcileManifestArgs` the 3A core expects (`workspaceId`, `providerConnectionId`, `providerType`,
  `toolManifestVersionId`, `observed`, optional `approved`, optional `previousEventHash`).
- `ImportManifestResult` **extends the real `ReconcileResult`** (`{ events, manifestHash,
  normalized }`, as implemented in 3A — note the 3A *code* returns `normalized`, which the 3A spec's
  prose sketch called `outcome`; 3B binds to the implemented type) and adds `toolCount` (the
  observed length, which may legitimately differ from `events`/inventory counts and from the
  fixture's 36 — see §11.C).
- **`approved` is accepted but optional.** The demo's first run passes none → 3A Case 1 (import).
  Carrying the baseline through keeps the shell **drift-ready** (3A Case 2 no-op / Case 3 changed
  are reachable through the same entry point) without forcing 3C to rewrite `importManifest`.
- **`close()` runs in `finally`** — the upstream child process is always torn down, whether
  `listTools()` succeeds, `reconcileManifest` throws (it should not — it is total), or anything in
  between throws. If `open()` itself throws, control never enters the `try`, so the 3A core is never
  invoked and no `close()` of a never-opened session is attempted by this function (the real client
  makes `close()` idempotent regardless — §6).

---

## 6. Error handling, edge cases, invariants (fail-closed)

3B is where real failure lives — a process that won't spawn, a transport that drops, a server that
hangs. The rule is the TraceGuard rule: **fail closed**. A discovery that does not cleanly complete
yields *no* manifest and *no* events; it never degrades into a partial or empty "success" that a
later stage might mistake for "the upstream legitimately exposes nothing."

| Failure | Behavior | Rationale |
|---------|----------|-----------|
| `open()` fails (spawn error, `initialize` rejects, init timeout) | `StdioUpstreamClient.open()` throws `UpstreamUnavailableError`; `importManifest` never enters the `try` → `listTools()` and `reconcileManifest` never run → **zero events**. The real client tears down any half-spawned transport before throwing. | Can't trust an upstream we couldn't initialize. Produce nothing. |
| `listTools()` fails (transport drop, request timeout, non-array result) | `StdioUpstreamClient.listTools()` throws `UpstreamListToolsError`; `reconcileManifest` never runs → **zero events**; `finally` still calls `close()`. | A partial/failed list must not be reconciled as if complete. |
| `reconcileManifest` (3A core) | total by construction (no throw path); still bracketed by `finally close()` defensively. | Core is pure; shell guarantees teardown regardless. |
| `close()` after a successful list | terminates the child process; **idempotent** — safe to call twice, safe to call when never opened. | One-shot lifecycle; no leaked processes. |
| empty live `tools/list` (`[]`) | a *legal* result, not a failure: `reconcileManifest` imports `ToolManifestImported{ tools: [] }`. (Distinct from `listTools()` *throwing*.) | An upstream may legitimately expose nothing; 3A already handles `[]`. |

**Timeouts.** `open()` is wrapped in a wall-clock race (default **10 s**) so a hung
`initialize` becomes an `UpstreamUnavailableError` rather than an indefinite block; on timeout the
half-open transport is closed before throwing. `listTools()` uses the SDK request `timeout` (default
**10 s**) so a hung `tools/list` becomes an `UpstreamListToolsError`.

**Minimal validation.** `listTools()` requires the SDK result's `tools` to be an array; each mapped
tool's `name` must be a non-empty string (enforced downstream by `RawUpstreamTool` /
`NormalizedToolDefinition` `.strict()` parsing inside 3A). 3B does **not** adjudicate schema validity
beyond that — 3A tolerates malformed `inputSchema` (it still fingerprints it).

**The `bin` is a single fail-closed boundary.** `bin/gateway-import.ts` wraps the entire run in one
`catch`: on any thrown error it prints a one-line diagnostic to **stderr** and sets a non-zero exit
code. It **never** prints a manifest summary on failure — success output and failure output are
mutually exclusive, so an operator can never misread a fail-closed run as a discovered manifest.

**Explicitly NOT handled here (deferred to 3C/3D):** mid-session crash recovery, automatic
reconnect, `tools/list_changed` re-discovery, and partial-degradation policies. 3B is one-shot; a
broken session is reported and closed, not repaired.

**Invariants:**

1. **S1 — fail-closed discovery.** Any failure in `open()` or `listTools()` ⇒ the 3A core is not
   invoked ⇒ zero events. There is no code path that reconciles a partially-fetched list.
2. **S2 — guaranteed teardown.** `importManifest` calls `close()` in `finally`; the real `close()`
   is idempotent and safe when never opened ⇒ no leaked upstream process on any path.
3. **S3 — typed failure surface.** Launch/initialize failures are `UpstreamUnavailableError`;
   list failures are `UpstreamListToolsError`. Callers (and the `bin`) discriminate on type.
4. **S4 — core determinism preserved.** With a `FakeUpstreamClient` returning fixed tools and fixed
   `deps = { clock, newId, hash }`, `importManifest` is byte-reproducible — it adds no nondeterminism
   over the 3A core it wraps (the only nondeterminism, process spawning, lives in the real client,
   excluded from the deterministic suite).
5. **S5 — zero-secret slice.** `tools/list` requires no credentials; 3B reads/writes no secret and
   needs none to complete its exit criterion.

---

## 7. The real stdio client + composition root

### 7.1 `stdio-upstream-client.ts` — `StdioUpstreamClient`

The real seam implementation drives `@modelcontextprotocol/sdk`: a `Client` over a
`StdioClientTransport` that spawns the upstream. `connect()` performs the MCP `initialize` handshake
automatically; `listTools()` issues `tools/list`; `close()` shuts the transport (and the child).

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { RawUpstreamTool } from "@traceguard/schemas";
import {
  type UpstreamLaunchConfig,
  type UpstreamManifestClient,
  UpstreamUnavailableError,
  UpstreamListToolsError,
} from "./upstream-client.js";
import { mapTool } from "./map-tool.js";

const DEFAULT_OPEN_TIMEOUT_MS = 10_000;
const DEFAULT_LIST_TIMEOUT_MS = 10_000;

export class StdioUpstreamClient implements UpstreamManifestClient {
  readonly #config: UpstreamLaunchConfig;
  #client: Client | null = null;

  constructor(config: UpstreamLaunchConfig) {
    this.#config = config;
  }

  async open(): Promise<void> {
    const transport = new StdioClientTransport({
      command: this.#config.command,
      args: this.#config.args ?? [],
      env: { ...getDefaultEnvironment(), ...(this.#config.env ?? {}) },
      stderr: "inherit",
    });
    const client = new Client(
      {
        name: this.#config.clientName ?? "traceguard-gateway",
        version: this.#config.clientVersion ?? "0.0.0",
      },
      { capabilities: {} },
    );
    try {
      await withTimeout(
        client.connect(transport),
        DEFAULT_OPEN_TIMEOUT_MS,
        "upstream initialize timed out",
      );
    } catch (err) {
      await safeClose(client);
      throw new UpstreamUnavailableError(messageOf(err), { cause: err });
    }
    this.#client = client;
  }

  async listTools(): Promise<RawUpstreamTool[]> {
    const client = this.#client;
    if (client === null) throw new UpstreamListToolsError("listTools called before open");
    try {
      const { tools } = await client.listTools(undefined, { timeout: DEFAULT_LIST_TIMEOUT_MS });
      if (!Array.isArray(tools)) throw new UpstreamListToolsError("tools/list returned a non-array");
      return tools.map(mapTool);
    } catch (err) {
      if (err instanceof UpstreamListToolsError) throw err;
      throw new UpstreamListToolsError(messageOf(err), { cause: err });
    }
  }

  async close(): Promise<void> {
    const client = this.#client;
    this.#client = null;            // idempotent: subsequent close() is a no-op
    if (client !== null) await safeClose(client);
  }
}
```

Three small private helpers keep the lifecycle honest (defined in the same module):

```typescript
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function safeClose(closable: { close(): Promise<void> }): Promise<void> {
  try {
    await closable.close();
  } catch {
    /* teardown is best-effort; never mask the original failure */
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
```

Design points:

- **`env: { ...getDefaultEnvironment(), ...config.env }`.** `getDefaultEnvironment()` returns only
  the SDK's safe-to-inherit variables (not the full ambient environment), so we don't leak arbitrary
  host env into the child. Explicit `config.env` overrides on top. For 3B's zero-secret slice no
  secrets are passed.
- **`stderr: "inherit"`** so the upstream's own spawn/initialize diagnostics surface to the operator
  during the demo. 3B does not parse upstream stderr.
- **`close()` idempotent** by nulling `#client` first; `importManifest`'s `finally` and the `bin`'s
  teardown can both call it safely.

### 7.2 `bin/gateway-import.ts` — runnable composition root

The composition root resolves the upstream entry, builds the real client + real `deps`, runs
`importManifest`, and prints a one-screen summary via the unchanged `toolManifestProjection`. It is
the only place `bitget-mcp-server` is located and launched.

```typescript
#!/usr/bin/env node
import { createRequire } from "node:module";
import {
  SystemClock,
  SystemIdGen,
  sha256hex,
  toolManifestProjection,
} from "@traceguard/event-ledger";
import { StdioUpstreamClient } from "../stdio-upstream-client.js";
import { importManifest } from "../import-manifest.js";

async function main(): Promise<void> {
  const newId = new SystemIdGen();
  const deps = { clock: new SystemClock(), newId, hash: sha256hex };

  // child_process.spawn searches PATH, not node_modules/.bin — resolve the entry explicitly
  // and launch it with `node <entry>`, rather than relying on a bin shim on PATH.
  const serverEntry = createRequire(import.meta.url).resolve("bitget-mcp-server");
  const client = new StdioUpstreamClient({
    command: process.execPath,
    args: [serverEntry, "--paper-trading"],
  });

  const result = await importManifest(
    {
      workspaceId: "ws_demo",
      providerConnectionId: "pc_bitget_demo",
      providerType: "bitget_agent_hub",
      toolManifestVersionId: newId.next("tmv"),
    },
    client,
    deps,
  );

  const view = toolManifestProjection(result.events);
  const n = (s: string): number => view.tools.filter((t) => t.status === s).length;
  console.log(`upstream tools: ${result.toolCount}`);
  console.log(`manifestHash:   ${result.manifestHash}`);
  console.log(`governed:       active=${n("active")} blocked=${n("blocked")} frozen=${n("frozen")}`);
}

main().catch((err: unknown) => {
  console.error("[gateway-import] fail-closed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
```

Running it (demo): `pnpm --filter @traceguard/mcp-gateway build` then
`node packages/mcp-gateway/dist/bin/gateway-import.js`, or `tsx
packages/mcp-gateway/src/bin/gateway-import.ts` for a no-build run. The exact runner is a
plan/packaging detail; the spec fixes only that the `bin` is the single composition root and the
single fail-closed boundary.

---

## 8. Data flow (end-to-end)

```text
Happy path (live, paper-trading):
  node …/bin/gateway-import.js
    → StdioUpstreamClient.open():
        spawn `node <bitget-mcp-server entry> --paper-trading`
        MCP initialize handshake (client.connect) — credentials NOT required for discovery
    → listTools(): MCP tools/list → SDK Tool[] → mapTool×N → RawUpstreamTool[]
        (live N: the visible Bitget tools + upstream's synthetic system_get_capabilities; may
         differ from the fixture's 36 by module flags / upstream version — see §11.C)
    → importManifest → reconcileManifest({ observed, approved: undefined })   [3A core, UNCHANGED]
        emit ToolManifestImported{ tools:N }
        emit ToolBlocked × {asset_movement, administrative tools}
        emit ToolFrozen  × {unknown tools, if any}
    → finally close(): terminate the child
    → toolManifestProjection(events) → print toolCount / manifestHash / active|blocked|frozen

Upstream unavailable (spawn fails / initialize times out):
  open() throws UpstreamUnavailableError
    → listTools() & reconcileManifest NEVER run → ZERO events
    → (half-open transport closed inside open() before throwing)
    → bin: single catch → stderr "[gateway-import] fail-closed: …" → exit 1
    → NO manifest summary printed

tools/list fails (transport drop / timeout / non-array):
  open() succeeded → listTools() throws UpstreamListToolsError
    → reconcileManifest NEVER runs → ZERO events
    → finally close() terminates the child
    → bin: stderr diagnostic → exit 1
```

The deterministic test path replaces `StdioUpstreamClient` with a `FakeUpstreamClient` returning the
36-tool fixture and uses fixed `deps`, so the same `importManifest` yields the golden `manifestHash`
and the locked fan-out (1 `ToolManifestImported` + 4 `ToolBlocked` + 0 `ToolFrozen`) with no process
spawned — that is where the demo's governance verdict is pinned as a CI gate, **not** against live
output.

---

## 9. Testing strategy (Vitest)

Two deterministic test files in the default suite; the real client + `bin` are out of the default
suite (manual / env-gated). TDD throughout. The fake:

```typescript
class FakeUpstreamClient implements UpstreamManifestClient {
  opened = 0; closed = 0;
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
    if (this.script.kind === "listThrows") throw new UpstreamListToolsError("transport dropped");
    if (this.script.kind === "tools") return this.script.tools;
    throw new Error("unreachable");
  }
  async close(): Promise<void> { this.closed++; }
}
```

- **`import-manifest.test.ts`:**
  - **Golden hash + classification (the anchor).** `FakeUpstreamClient({ kind:"tools", tools:
    bitget36RawTools })` + `deps = { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex }`
    + `providerType: "bitget_agent_hub"`. Assert `result.manifestHash === bitgetManifestHashV1`,
    `result.toolCount === 36`, and the event fan-out: exactly **1** `ToolManifestImported`, **4**
    `ToolBlocked` (transfer / withdraw / cancel_withdrawal / manage_subaccounts), **0** `ToolFrozen`.
    *(`providerType` must be `"bitget_agent_hub"` for the hash to reproduce — `riskClass` is a hash
    input and depends on it; `providerConnectionId` is free.)*
  - **Teardown.** On the happy path, `client.closed === 1` (exactly once) and `client.opened === 1`.
  - **Fail-closed: open throws.** `{ kind:"openThrows" }` ⇒ `importManifest` rejects with
    `UpstreamUnavailableError`; `client.opened === 1`, `listTools` is never called, and **zero**
    events are produced (the 3A core is never reached). Because `open()` is awaited *before* the
    `try`, the `finally` does not run, so `client.closed === 0` — and the real
    `StdioUpstreamClient.open()` self-cleans its half-open transport, so no upstream leaks on this
    path (§5, §7.1).
  - **Fail-closed: listTools throws.** `{ kind:"listThrows" }` ⇒ rejects with
    `UpstreamListToolsError`; `client.closed === 1` (the `finally` still ran); no events produced.
  - **Optional approved baseline (Case 2 no-op).** Run once to capture `manifestHash` +
    `normalized`; run again with the same fixture and `approved = { manifestHash, tools:
    normalized.map(toEntry) }` ⇒ `result.events` is empty (3A idempotent no-op), `toolCount === 36`.
- **`map-tool.test.ts`:**
  - `_meta` on the SDK tool is **dropped** from the `RawUpstreamTool`.
  - absent optionals (`title` / `description` / `outputSchema` / `annotations`) are **not** present
    as keys on the result (no explicit `undefined`); present ones are copied verbatim.
  - missing `inputSchema` maps to `{}`.
- **Out of the default suite:** the real `StdioUpstreamClient` and the `bin` (they spawn a process).
  An optional `stdio-upstream-client.integration.test.ts` exercises the live upstream and is **gated
  behind `process.env.TRACEGUARD_LIVE_MCP`** (skipped unless set), so CI stays hermetic and the
  hackathon machine can opt into a real round-trip.

---

## 10. Canonical source mapping

| 3B artifact | Canonical source |
|-------------|------------------|
| stdio shell: `initialize` + `tools/list` discovery flow | contract §7 (Tool Discovery); 3A spec §1.1 (3B definition) |
| `RawUpstreamTool` shape (seam output) | `schemas/tool-manifest.ts` (1A/3A artifact); MCP `tools/list` tool shape |
| `reconcileManifest` (the wrapped core) + its arg/result types | 3A spec §6 / `tool-manifest/reconcile.ts` — unchanged |
| `toolManifestProjection` (bin summary) | 3A spec §7 / `event-ledger/tool-manifest-projection.ts` — unchanged |
| `Client` / `StdioClientTransport` / `getDefaultEnvironment` | `@modelcontextprotocol/sdk` (`client/index.js`, `client/stdio.js`) |
| `SystemClock` / `SystemIdGen` / `sha256hex` (real deps) | `event-ledger` (1A artifacts) |
| `--paper-trading` selects Bitget Demo Trading | 3A spec §1.1; bitget-skill demo-trading reference |
| fail-closed / default-deny discovery | TraceGuard core invariant (`docs/architecture.md`) |
| 36-tool fixture + `bitgetManifestHashV1` | `testing-fixtures/bitget-tools.ts` (3A artifact) |

---

## 11. Deviations and coherence notes (disclosed)

- **A. `@modelcontextprotocol/sdk` promoted transitive → direct.** 3B imports the SDK directly, so
  it must be a declared dependency of `@traceguard/mcp-gateway`. The `package.json` /
  `pnpm-lock.yaml` change is committed **separately** from source (the lockfile already carries the
  unrelated `bitget-mcp-server` dev-dependency churn; each source commit stages only its named
  source files).
- **B. `importManifest` accepts an optional `approved` baseline.** The demo's first run passes none
  (3A Case 1 import). Carrying the parameter keeps the shell drift-ready (3A Case 2 no-op / Case 3
  changed reachable through one entry point) without a later 3C rewrite. *(User-approved.)*
- **C. Live `toolCount` may differ from the fixture's 36.** `bitget-mcp-server` injects a synthetic
  `system_get_capabilities` on top of its visible list, and the visible set varies with the
  `--modules` / `--read-only` flags and upstream version. Therefore the `bin` asserts **nothing**
  about count or hash against live output; the golden 36-count / `bitgetManifestHashV1` assertion
  lives **only** in the deterministic `FakeUpstreamClient` test over the fixture + fixed `hash`. This
  is precisely why 3A anchored the golden on a fixture rather than a live capture.
- **D. `stderr: "inherit"` on the child.** Upstream spawn/init diagnostics surface to the operator
  during the demo; 3B does not capture or parse them.
- **E. Zero-secret slice (verified).** `bitget-mcp-server`'s `tools/list` handler is **not**
  credentials-gated, so 3B's discovery path needs no `BITGET_*` secrets. Credentials become relevant
  only for `tools/call` private endpoints (3D), and even then are env-only — never written to a file
  or echoed (TraceGuard stores secret references, not secrets).
- **F. One-shot, no recovery.** No reconnect, mid-session recovery, partial-degradation, or
  `tools/list_changed` subscription. A broken session is reported (typed error) and closed, not
  repaired. Re-discovery cadence is 3C+.
- **G. No event-model / contract doc edit required.** 3B introduces **no** new event types, payloads,
  or projections — it only sources inputs for the 3A events already documented in §12.G of the 3A
  spec. The contract §7 discovery flow already describes this shell's behavior; no coherence sync is
  owed by 3B. (Listed so the absence is a deliberate, reviewed decision, not an oversight.)

---

## 12. Acceptance criteria (3B)

1. The pnpm workspace builds under TS `strict` + NodeNext ESM with the new `@traceguard/mcp-gateway`
   package and `@modelcontextprotocol/sdk` as a **direct** dependency, with no new dependency cycles
   and the 3A core unchanged.
2. `upstream-client.ts` defines the `UpstreamManifestClient` seam, `UpstreamLaunchConfig`, and the
   `UpstreamUnavailableError` / `UpstreamListToolsError` classes; `map-tool.ts`'s `mapTool` drops
   `_meta`, maps missing `inputSchema` to `{}`, and never stores explicit-`undefined` optionals.
3. `importManifest` performs open → `listTools` → `reconcileManifest` → close, returns the 3A
   `ReconcileResult` plus `toolCount`, and **always** calls `close()` (via `finally`) — including
   when `listTools()` throws.
4. Fail-closed holds: `open()` failure ⇒ `UpstreamUnavailableError`, the 3A core never runs, **zero**
   events; `listTools()` failure ⇒ `UpstreamListToolsError`, **zero** events; both paths still tear
   down the upstream.
5. The deterministic `FakeUpstreamClient` golden test reproduces 3A's anchor through 3B: with
   `bitget36RawTools`, `deps = { fixedClock, sequentialIdGen, sha256hex }`, and `providerType:
   "bitget_agent_hub"`, `importManifest` yields `manifestHash === bitgetManifestHashV1`,
   `toolCount === 36`, and exactly 1 `ToolManifestImported` + 4 `ToolBlocked` + 0 `ToolFrozen`.
6. The real `StdioUpstreamClient` and the `bin` are excluded from the default Vitest suite; an
   optional live integration test is gated behind `TRACEGUARD_LIVE_MCP` (skipped by default).
7. `bin/gateway-import.ts` is a single fail-closed composition root: it resolves `bitget-mcp-server`
   via `createRequire(...).resolve(...)`, launches it as `node <entry> --paper-trading`, prints
   `toolCount` / `manifestHash` / `active|blocked|frozen` counts on success, and on any failure
   prints one stderr diagnostic and sets a non-zero exit code — never printing a manifest summary on
   a failed run.
