# TraceGuard Phase 3 (3B) — stdio MCP Server Shell & Upstream Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new `@traceguard/mcp-gateway` package — the imperative shell that spawns `bitget-mcp-server` over stdio, performs MCP `initialize` + `tools/list`, maps the live tools into `RawUpstreamTool[]`, and feeds them into the unchanged 3A `reconcileManifest` core, fail-closed and store-free.

**Architecture:** Functional-core / imperative-shell. One injected seam (`UpstreamManifestClient`) hides all process/stdio I/O; `importManifest` brackets `open → listTools → reconcile → close` (close in `finally`); `mapTool` is a pure SDK-tool→`RawUpstreamTool` translation. A `FakeUpstreamClient` drives the deterministic golden test; the real `StdioUpstreamClient` (over `@modelcontextprotocol/sdk`) and the `bin` composition root are excluded from the default Vitest suite.

**Tech Stack:** TypeScript strict ESM (NodeNext, ES2022), pnpm workspaces, Vitest, `@modelcontextprotocol/sdk@^1.29.0`. Reuses 3A (`@traceguard/tool-manifest`), 1A schemas (`@traceguard/schemas`), and 1A ledger primitives (`@traceguard/event-ledger`).

**Spec:** `docs/superpowers/specs/2026-06-12-traceguard-phase3-local-mcp-gateway-3b-stdio-shell-design.md` (approved).

---

## Plan notes (disclosed deviations from the spec)

These are minor, plan-level decisions beyond the spec's literal text, surfaced for review (per the project's full-coherence/disclosure preference):

1. **`upstream-client.test.ts` added (Task 2).** The spec §2.1 enumerates only `import-manifest.test.ts` + `map-tool.test.ts`. This plan adds a tiny error-class test because invariant **S3** (typed failure surface) depends on `.name` + `instanceof Error` holding for both error classes — a cheap, high-value regression guard.
2. **`index.test.ts` added (Task 7).** A barrel smoke test asserting the public surface (`importManifest`, `mapTool`, `StdioUpstreamClient`, the two error classes). 3C will consume this barrel; nothing else verifies it actually re-exports.
3. **`FakeUpstreamClient` gains a `listed` counter** (test-internal, beyond the spec §9 sketch's `opened`/`closed`) so the open-throws path can assert `listTools` was never called.
4. **Demo run uses root `pnpm build`** (not `pnpm --filter @traceguard/mcp-gateway build` from spec §7.2): packages in this repo carry no per-package `build` script; the root `tsc --build` orchestrates the graph.
5. **Root `pnpm-lock.yaml` is NOT committed (diverges from spec §11.A).** Spec §11.A envisions the SDK lockfile change being committed in its own commit, separate from source. The project's standing instruction is stronger: *never stage the root `package.json` or `pnpm-lock.yaml` at all* (they already carry unrelated `bitget-mcp-server` churn). User instructions override the spec, so the lockfile stays dirty/unstaged (see Git policy). Consequence: the committed history declares `@modelcontextprotocol/sdk` in `packages/mcp-gateway/package.json` without a matching root-lockfile commit, so `pnpm install --frozen-lockfile` would not reproduce these commits — acceptable here because this is a local-only, no-push, demo-focused branch and the user owns the lockfile separately.

## Git policy (applies to EVERY commit in this plan)

- **Commit locally; do NOT push.** Work directly on `main`.
- **Stage only the named source files** of each task with explicit `git add <path> …` — never `git add -A` / `git add .`.
- **NEVER stage `package.json` (root) or `pnpm-lock.yaml`.** They already carry unrelated `bitget-mcp-server` churn from before this work, and `pnpm install` further mixes the new SDK edge into `pnpm-lock.yaml`. Run `pnpm install` so the workspace resolves and builds, but leave both files dirty/unstaged. Do **not** `git checkout`/discard them either — leave them as-is for the user.
- **The new package's own `packages/mcp-gateway/package.json` + `tsconfig.json` ARE committed** (Task 1) — they are new-package source, distinct from the root manifest/lockfile.
- **Never stage `dist/`** (build output from `tsc --build`).
- Commit message scope is `mcp-gateway`, matching the repo's `feat(<scope>): …` style.

---

## File Structure

```text
packages/mcp-gateway/
  package.json                              # Task 1 — @traceguard/mcp-gateway; direct dep @modelcontextprotocol/sdk
  tsconfig.json                             # Task 1 — extends ../../tsconfig.base.json; references the 4 workspace deps
  src/
    index.ts                                # Task 1 (placeholder) → Task 7 (real barrel)
    upstream-client.ts                      # Task 2 — seam interface + launch config + 2 error classes (no I/O)
    upstream-client.test.ts                 # Task 2 — error-class contract (S3)
    map-tool.ts                             # Task 3 — pure SDK tool → RawUpstreamTool
    map-tool.test.ts                        # Task 3 — _meta drop, optional-field handling, missing inputSchema → {}
    import-manifest.ts                      # Task 4 — orchestration: open → listTools → reconcile → close
    import-manifest.test.ts                 # Task 4 — FakeUpstreamClient golden + fan-out + teardown + fail-closed + Case-2
    stdio-upstream-client.ts                # Task 5 — real seam impl over @modelcontextprotocol/sdk
    stdio-upstream-client.integration.test.ts  # Task 5 — live round-trip, gated by TRACEGUARD_LIVE_MCP (skipped by default)
    bin/
      gateway-import.ts                     # Task 6 — runnable composition root (real client + real deps)
    index.test.ts                           # Task 7 — barrel public-surface smoke test

tsconfig.json (root)                        # Task 1 — add { "path": "./packages/mcp-gateway" } to references
```

**Module responsibilities:**

- `upstream-client.ts` — the purity boundary. Declares the `UpstreamManifestClient` seam, `UpstreamLaunchConfig`, and the typed errors. No imports of `@modelcontextprotocol/sdk` or `node:*`.
- `map-tool.ts` — pure translation; the only field-shaping logic 3B owns. No I/O.
- `import-manifest.ts` — the orchestration; speaks only to the seam + the 3A core. No I/O, no SDK.
- `stdio-upstream-client.ts` + `bin/gateway-import.ts` — the only modules that touch the SDK and process APIs. Excluded from the default suite.

---

### Task 1: Package scaffold + workspace wiring

**Files:**
- Create: `packages/mcp-gateway/package.json`
- Create: `packages/mcp-gateway/tsconfig.json`
- Create: `packages/mcp-gateway/src/index.ts` (temporary placeholder; Task 7 fills it)
- Modify: `tsconfig.json` (root) — add the new project reference

This task has no unit test; its gate is "the whole workspace still compiles with the new package and the SDK as a direct dep" (acceptance criterion 1).

- [ ] **Step 1: Create `packages/mcp-gateway/package.json`**

```json
{
  "name": "@traceguard/mcp-gateway",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@traceguard/schemas": "workspace:*",
    "@traceguard/event-ledger": "workspace:*",
    "@traceguard/tool-manifest": "workspace:*"
  },
  "devDependencies": {
    "@traceguard/testing-fixtures": "workspace:*"
  }
}
```

- [ ] **Step 2: Create `packages/mcp-gateway/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [
    { "path": "../schemas" },
    { "path": "../event-ledger" },
    { "path": "../tool-manifest" },
    { "path": "../testing-fixtures" }
  ]
}
```

- [ ] **Step 3: Create the placeholder `packages/mcp-gateway/src/index.ts`**

A composite project's `include: ["src"]` needs at least one `.ts` file to compile. This placeholder keeps every intermediate commit green; Task 7 replaces it with the real barrel.

```typescript
export {};
```

- [ ] **Step 4: Add the project reference to the root `tsconfig.json`**

Edit the root `tsconfig.json` so its `references` array ends with the new package (append after the `tool-manifest` entry):

```json
{
  "files": [],
  "references": [
    { "path": "./packages/schemas" },
    { "path": "./packages/event-ledger" },
    { "path": "./packages/policy-engine" },
    { "path": "./packages/testing-fixtures" },
    { "path": "./packages/domain" },
    { "path": "./packages/runtime" },
    { "path": "./packages/tool-manifest" },
    { "path": "./packages/mcp-gateway" }
  ]
}
```

- [ ] **Step 5: Install so pnpm links the new package + the SDK**

Run: `pnpm install`
Expected: completes successfully; `@modelcontextprotocol/sdk@1.29.0` (already in the store as a transitive of `bitget-mcp-server`) is linked into `packages/mcp-gateway/node_modules/`, and the three `@traceguard/*` workspace deps are symlinked. This updates root `pnpm-lock.yaml` (do NOT stage it — see Git policy).

- [ ] **Step 6: Verify the whole workspace still builds**

Run: `pnpm typecheck`
Expected: PASS — `tsc --build --pretty` compiles all projects including the new (empty) `@traceguard/mcp-gateway`, with no errors. (This emits `packages/mcp-gateway/dist/`, which is build output — never stage it.)

- [ ] **Step 7: Commit (new-package manifest + root reference only)**

```bash
git add packages/mcp-gateway/package.json packages/mcp-gateway/tsconfig.json packages/mcp-gateway/src/index.ts tsconfig.json
git commit -m "feat(mcp-gateway): scaffold package with direct @modelcontextprotocol/sdk dep"
git status
```
Expected: the commit contains exactly those four files. `git status` afterward still shows `package.json` and `pnpm-lock.yaml` as modified/unstaged — that is correct and intended.

---

### Task 2: The upstream-client seam + typed errors

**Files:**
- Create: `packages/mcp-gateway/src/upstream-client.ts`
- Test: `packages/mcp-gateway/src/upstream-client.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mcp-gateway/src/upstream-client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { UpstreamUnavailableError, UpstreamListToolsError } from "./upstream-client.js";

describe("upstream error classes", () => {
  it("UpstreamUnavailableError carries name, message, and is an Error", () => {
    const err = new UpstreamUnavailableError("spawn failed");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("UpstreamUnavailableError");
    expect(err.message).toBe("spawn failed");
  });

  it("UpstreamListToolsError carries name, message, and is an Error", () => {
    const err = new UpstreamListToolsError("transport dropped");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("UpstreamListToolsError");
    expect(err.message).toBe("transport dropped");
  });

  it("preserves the error cause when provided", () => {
    const cause = new Error("root");
    const err = new UpstreamUnavailableError("wrapped", { cause });
    expect(err.cause).toBe(cause);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test upstream-client`
Expected: FAIL — cannot resolve import `./upstream-client.js` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

`packages/mcp-gateway/src/upstream-client.ts`:

```typescript
import type { RawUpstreamTool } from "@traceguard/schemas";

export interface UpstreamLaunchConfig {
  command: string; // executable to spawn (e.g. process.execPath = node)
  args?: string[]; // e.g. [<bitget-mcp-server entry>, "--paper-trading"]
  env?: Record<string, string>; // merged over getDefaultEnvironment(); omit to inherit safe defaults
  clientName?: string; // MCP client identity (initialize); default "traceguard-gateway"
  clientVersion?: string; // default "0.0.0"
}

export interface UpstreamManifestClient {
  open(): Promise<void>; // spawn + MCP initialize handshake
  listTools(): Promise<RawUpstreamTool[]>; // MCP tools/list, mapped into RawUpstreamTool
  close(): Promise<void>; // terminate the upstream; idempotent
}

export class UpstreamUnavailableError extends Error {
  readonly name = "UpstreamUnavailableError";
}
export class UpstreamListToolsError extends Error {
  readonly name = "UpstreamListToolsError";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test upstream-client`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-gateway/src/upstream-client.ts packages/mcp-gateway/src/upstream-client.test.ts
git commit -m "feat(mcp-gateway): add upstream-client seam + typed fail-closed errors"
```

---

### Task 3: Pure `mapTool` (SDK tool → `RawUpstreamTool`)

**Files:**
- Create: `packages/mcp-gateway/src/map-tool.ts`
- Test: `packages/mcp-gateway/src/map-tool.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mcp-gateway/src/map-tool.test.ts`. (Inputs carrying an extra `_meta` key are bound to a `const` first, so TypeScript's excess-property check — which only fires on inline object literals — does not reject them; this mirrors how the real SDK `Tool` object reaches `mapTool`.)

```typescript
import { describe, it, expect } from "vitest";
import { mapTool } from "./map-tool.js";

describe("mapTool", () => {
  it("copies the RawUpstreamTool fields and drops _meta", () => {
    const sdkTool = {
      name: "withdraw",
      title: "Withdraw",
      description: "move funds",
      inputSchema: { type: "object", properties: { coin: { type: "string" } } },
      outputSchema: { type: "object" },
      annotations: { destructiveHint: true },
      _meta: { progressToken: "x" },
    };
    const mapped = mapTool(sdkTool);
    expect(mapped).toEqual({
      name: "withdraw",
      title: "Withdraw",
      description: "move funds",
      inputSchema: { type: "object", properties: { coin: { type: "string" } } },
      outputSchema: { type: "object" },
      annotations: { destructiveHint: true },
    });
    expect("_meta" in mapped).toBe(false);
  });

  it("omits absent optionals (no explicit-undefined keys)", () => {
    const mapped = mapTool({ name: "spot_get_ticker", inputSchema: { type: "object" } });
    expect(mapped).toEqual({ name: "spot_get_ticker", inputSchema: { type: "object" } });
    expect("title" in mapped).toBe(false);
    expect("description" in mapped).toBe(false);
    expect("outputSchema" in mapped).toBe(false);
    expect("annotations" in mapped).toBe(false);
  });

  it("maps a missing inputSchema to {}", () => {
    const mapped = mapTool({ name: "no_schema" });
    expect(mapped.inputSchema).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test map-tool`
Expected: FAIL — cannot resolve import `./map-tool.js`.

- [ ] **Step 3: Write the minimal implementation**

`packages/mcp-gateway/src/map-tool.ts`:

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test map-tool`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-gateway/src/map-tool.ts packages/mcp-gateway/src/map-tool.test.ts
git commit -m "feat(mcp-gateway): add pure mapTool SDK to RawUpstreamTool"
```

---

### Task 4: `importManifest` orchestration (the crux)

**Files:**
- Create: `packages/mcp-gateway/src/import-manifest.ts`
- Test: `packages/mcp-gateway/src/import-manifest.test.ts`

This is the anchor task: the deterministic `FakeUpstreamClient` golden test reproduces 3A's pinned manifest hash + classification fan-out through the 3B shell, and proves fail-closed + guaranteed teardown.

- [ ] **Step 1: Write the failing test**

`packages/mcp-gateway/src/import-manifest.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { RawUpstreamTool } from "@traceguard/schemas";
import { sha256hex } from "@traceguard/event-ledger";
import { manifestFingerprint, type ReconcileDeps } from "@traceguard/tool-manifest";
import {
  bitget36RawTools,
  bitgetManifestHashV1,
  fixedClock,
  sequentialIdGen,
} from "@traceguard/testing-fixtures";
import { importManifest, type ImportManifestArgs } from "./import-manifest.js";
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

const baseArgs: ImportManifestArgs = {
  workspaceId: "ws_demo",
  providerConnectionId: "pc_bitget",
  providerType: "bitget_agent_hub",
  toolManifestVersionId: "tmv_1",
};

function countType(events: { eventType: string }[], type: string): number {
  return events.filter((e) => e.eventType === type).length;
}

describe("importManifest", () => {
  it("reproduces the golden manifest hash and observed toolCount", async () => {
    const client = new FakeUpstreamClient({ kind: "tools", tools: bitget36RawTools });
    const result = await importManifest(baseArgs, client, makeDeps());
    expect(result.manifestHash).toBe(bitgetManifestHashV1);
    expect(result.toolCount).toBe(36);
  });

  it("emits the locked fan-out (1 imported + 4 blocked + 0 frozen)", async () => {
    const client = new FakeUpstreamClient({ kind: "tools", tools: bitget36RawTools });
    const result = await importManifest(baseArgs, client, makeDeps());
    expect(result.events).toHaveLength(5);
    expect(countType(result.events, "ToolManifestImported")).toBe(1);
    expect(countType(result.events, "ToolBlocked")).toBe(4);
    expect(countType(result.events, "ToolFrozen")).toBe(0);
    const blockedNames = result.events
      .filter((e) => e.eventType === "ToolBlocked")
      .map((e) => (e.payload as { toolName: string }).toolName)
      .sort();
    expect(blockedNames).toEqual([
      "cancel_withdrawal",
      "manage_subaccounts",
      "transfer",
      "withdraw",
    ]);
  });

  it("tears down the upstream exactly once on the happy path", async () => {
    const client = new FakeUpstreamClient({ kind: "tools", tools: bitget36RawTools });
    await importManifest(baseArgs, client, makeDeps());
    expect(client.opened).toBe(1);
    expect(client.listed).toBe(1);
    expect(client.closed).toBe(1);
  });

  it("fail-closed: open() failure surfaces UpstreamUnavailableError, never reaches the core", async () => {
    const client = new FakeUpstreamClient({ kind: "openThrows" });
    await expect(importManifest(baseArgs, client, makeDeps())).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
    expect(client.opened).toBe(1);
    expect(client.listed).toBe(0); // 3A core never reached → zero events
    expect(client.closed).toBe(0); // open() awaited before try → finally did not run
  });

  it("fail-closed: listTools() failure surfaces UpstreamListToolsError, still closes", async () => {
    const client = new FakeUpstreamClient({ kind: "listThrows" });
    await expect(importManifest(baseArgs, client, makeDeps())).rejects.toBeInstanceOf(
      UpstreamListToolsError,
    );
    expect(client.opened).toBe(1);
    expect(client.listed).toBe(1);
    expect(client.closed).toBe(1); // finally ran
  });

  it("no-ops on an approved baseline matching the observed manifest (Case 2)", async () => {
    const deps = makeDeps();
    const first = await importManifest(
      baseArgs,
      new FakeUpstreamClient({ kind: "tools", tools: bitget36RawTools }),
      deps,
    );
    const approved = {
      manifestHash: first.manifestHash,
      tools: first.normalized.map(manifestFingerprint),
    };
    const second = await importManifest(
      { ...baseArgs, approved },
      new FakeUpstreamClient({ kind: "tools", tools: bitget36RawTools }),
      makeDeps(),
    );
    expect(second.events).toHaveLength(0);
    expect(second.toolCount).toBe(36);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test import-manifest`
Expected: FAIL — cannot resolve import `./import-manifest.js`.

- [ ] **Step 3: Write the minimal implementation**

`packages/mcp-gateway/src/import-manifest.ts`:

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test import-manifest`
Expected: PASS — 6 tests pass. The golden assertions (`manifestHash === bitgetManifestHashV1`, `toolCount === 36`, fan-out 1/4/0) confirm the 3A anchor reproduces through the 3B shell.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-gateway/src/import-manifest.ts packages/mcp-gateway/src/import-manifest.test.ts
git commit -m "feat(mcp-gateway): add importManifest orchestration with golden + fail-closed tests"
```

---

### Task 5: The real `StdioUpstreamClient` (over the MCP SDK)

**Files:**
- Create: `packages/mcp-gateway/src/stdio-upstream-client.ts`
- Test: `packages/mcp-gateway/src/stdio-upstream-client.integration.test.ts` (gated; skipped by default)

The real client spawns a process, so it is **out of the default deterministic suite**. Its gates are: (a) `pnpm typecheck` compiles it against the real SDK types, and (b) the optional live integration test, which self-gates on `process.env.TRACEGUARD_LIVE_MCP` (the `describe.skipIf` skips its body when the env var is unset, so no process spawns in CI; the file is still collected, which is what makes the missing-module failure in Step 2 a valid red).

- [ ] **Step 1: Write the gated integration test**

`packages/mcp-gateway/src/stdio-upstream-client.integration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { SystemClock, SystemIdGen, sha256hex } from "@traceguard/event-ledger";
import { StdioUpstreamClient } from "./stdio-upstream-client.js";
import { importManifest } from "./import-manifest.js";

const live = Boolean(process.env.TRACEGUARD_LIVE_MCP);

describe.skipIf(!live)("StdioUpstreamClient (live, gated by TRACEGUARD_LIVE_MCP)", () => {
  it(
    "discovers the live Bitget manifest end-to-end",
    async () => {
      const serverEntry = createRequire(import.meta.url).resolve("bitget-mcp-server");
      const client = new StdioUpstreamClient({
        command: process.execPath,
        args: [serverEntry, "--paper-trading"],
      });
      const newId = new SystemIdGen();
      const result = await importManifest(
        {
          workspaceId: "ws_live",
          providerConnectionId: "pc_bitget_live",
          providerType: "bitget_agent_hub",
          toolManifestVersionId: newId.next("tmv"),
        },
        client,
        { clock: new SystemClock(), newId, hash: sha256hex },
      );
      expect(result.toolCount).toBeGreaterThan(0);
      expect(result.manifestHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.events.length).toBeGreaterThan(0);
    },
    30_000,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test stdio-upstream-client`
Expected: FAIL — cannot resolve import `./stdio-upstream-client.js` (collection error; the module does not exist yet).

- [ ] **Step 3: Write the implementation**

`packages/mcp-gateway/src/stdio-upstream-client.ts`:

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
    this.#client = null; // idempotent: subsequent close() is a no-op
    if (client !== null) await safeClose(client);
  }
}

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
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
```

- [ ] **Step 4: Verify it compiles and the suite stays green (test skipped)**

Run: `pnpm typecheck`
Expected: PASS — `stdio-upstream-client.ts` compiles against the real `@modelcontextprotocol/sdk` types (`Client`, `StdioClientTransport`, `getDefaultEnvironment` all resolve; `skipLibCheck` is on per the base config).

Run: `pnpm test stdio-upstream-client`
Expected: PASS — the integration file is collected, the `describe.skipIf(!live)` body is **skipped** (no `TRACEGUARD_LIVE_MCP`), so 0 tests run and there are no failures.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-gateway/src/stdio-upstream-client.ts packages/mcp-gateway/src/stdio-upstream-client.integration.test.ts
git commit -m "feat(mcp-gateway): add real StdioUpstreamClient over MCP SDK"
```

---

### Task 6: The `bin/gateway-import.ts` composition root

**Files:**
- Create: `packages/mcp-gateway/src/bin/gateway-import.ts`

The `bin` is the single composition root and the single fail-closed boundary. It is not unit-tested (it launches a process); its gate is `pnpm typecheck`. The deterministic fail-closed behavior it relies on (`importManifest`) is already unit-tested in Task 4.

- [ ] **Step 1: Write the implementation**

`packages/mcp-gateway/src/bin/gateway-import.ts`:

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

- [ ] **Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS — the `bin` compiles; `tsc --build` emits `packages/mcp-gateway/dist/bin/gateway-import.js` (with the shebang preserved).

- [ ] **Step 3 (optional manual demo — not part of CI):**

After a root build, the demo can be run against the live paper-trading upstream:

```bash
pnpm build
node packages/mcp-gateway/dist/bin/gateway-import.js
```
Expected on success: three lines — `upstream tools: N`, `manifestHash: <64-hex>`, `governed: active=… blocked=… frozen=…`. On any failure: one `[gateway-import] fail-closed: …` line on stderr and a non-zero exit, with no manifest summary printed.

> Troubleshooting: if the run fails with `Cannot find module 'bitget-mcp-server'`, the createRequire walk-up did not reach the root-hoisted package. Add `"bitget-mcp-server": "^1.1.0"` to `packages/mcp-gateway`'s `devDependencies` and re-run `pnpm install` (do not stage the root lockfile).

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-gateway/src/bin/gateway-import.ts
git commit -m "feat(mcp-gateway): add gateway-import composition root"
```

---

### Task 7: The package barrel

**Files:**
- Modify: `packages/mcp-gateway/src/index.ts` (replace the Task 1 placeholder)
- Test: `packages/mcp-gateway/src/index.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mcp-gateway/src/index.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import * as gateway from "./index.js";

describe("@traceguard/mcp-gateway barrel", () => {
  it("re-exports the public surface", () => {
    expect(typeof gateway.importManifest).toBe("function");
    expect(typeof gateway.mapTool).toBe("function");
    expect(typeof gateway.StdioUpstreamClient).toBe("function");
    expect(typeof gateway.UpstreamUnavailableError).toBe("function");
    expect(typeof gateway.UpstreamListToolsError).toBe("function");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/mcp-gateway/src/index.test`
Expected: FAIL — the placeholder `index.ts` (`export {};`) exports none of these symbols, so each `expect(typeof …)` sees `"undefined"`.

(Use the path-qualified filter here so the run targets the barrel test and not, e.g., other `index.test.ts` files in the workspace.)

- [ ] **Step 3: Replace the placeholder with the real barrel**

`packages/mcp-gateway/src/index.ts`:

```typescript
export * from "./upstream-client.js";
export * from "./map-tool.js";
export * from "./import-manifest.js";
export * from "./stdio-upstream-client.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/mcp-gateway/src/index.test`
Expected: PASS — the barrel re-exports the full surface.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-gateway/src/index.ts packages/mcp-gateway/src/index.test.ts
git commit -m "feat(mcp-gateway): add package barrel"
```

---

## Final verification (gate, no commit)

- [ ] **Run the full deterministic suite**

Run: `pnpm test`
Expected: all packages green; the new `mcp-gateway` deterministic tests pass; the `stdio-upstream-client.integration.test.ts` shows as **skipped** (no `TRACEGUARD_LIVE_MCP`).

- [ ] **Run the full typecheck/build**

Run: `pnpm typecheck`
Expected: PASS — the whole workspace compiles under TS strict NodeNext ESM with the new package and `@modelcontextprotocol/sdk` as a direct dependency, no new dependency cycles, the 3A core unchanged.

- [ ] **Confirm git hygiene**

Run: `git status`
Expected: a clean tree **except** root `package.json` and `pnpm-lock.yaml`, which remain modified/unstaged (pre-existing `bitget-mcp-server` churn + the new SDK edge). These are intentionally not committed and not pushed.

---

## Acceptance criteria → task mapping (self-check)

| Spec §12 criterion | Covered by |
|---|---|
| 1 — workspace builds, SDK as direct dep, no cycles, 3A unchanged | Task 1 + Final verification |
| 2 — seam + launch config + error classes; `mapTool` drops `_meta`, missing schema → `{}`, no explicit-undefined | Tasks 2, 3 |
| 3 — `importManifest` open→list→reconcile→close, returns `ReconcileResult` + `toolCount`, always closes | Task 4 |
| 4 — fail-closed: open→`UpstreamUnavailableError`/zero events; list→`UpstreamListToolsError`/zero events; both tear down | Task 4 (list-path `finally` ⇒ `closed===1`) + Task 5 (open-path real-client self-clean: `safeClose` in `open()`'s catch — orchestration `closed===0`) |
| 5 — golden: `bitget36RawTools` + `{fixedClock, sequentialIdGen, sha256hex}` + `bitget_agent_hub` → `bitgetManifestHashV1`, `toolCount===36`, 1 imported + 4 blocked + 0 frozen | Task 4 |
| 6 — real client + bin excluded from default suite; live test gated by `TRACEGUARD_LIVE_MCP` | Tasks 5, 6 |
| 7 — `bin` resolves `bitget-mcp-server`, launches `node <entry> --paper-trading`, prints counts on success / one stderr diagnostic + non-zero exit on failure | Task 6 |
