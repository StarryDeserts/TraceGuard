# TraceGuard Phase 3 — 3A Local MCP Gateway: Tool Manifest & Risk Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure functional core of the gateway's tool-discovery path — normalize raw upstream MCP tools, fingerprint a manifest, classify per-tool risk, reconcile against an approved baseline, and emit a hash-chained ledger event stream with a replayable projection.

**Architecture:** Functional-core / imperative-shell. A new pure-island package `@traceguard/tool-manifest` holds normalization + classification + diffing (no I/O, deterministic given injected `deps`). An emit layer (`reconcile.ts`, `approve.ts`) turns discovery results into `LedgerEvent[]` using the same emit-closure pattern as Phase 1B's `authorization-gateway.ts`. `@traceguard/event-ledger` gains a replay projection. Input is in-memory `RawUpstreamTool[]`; there is NO transport, store, or upstream client (those are 3B/3C).

**Tech Stack:** TypeScript strict ESM (NodeNext), Zod `.strict()`, Vitest, fast-check (property tests), pnpm workspace monorepo. Byte-reproducibility via injected `deps = { clock, newId, hash }`.

---

## Disclosed Refinements to the Spec

The approved spec is the contract. While grounding it against the merged Phase 1A+1B+2 code on `main`, five concrete refinements were necessary. Each is faithful to the spec's intent; they resolve a circular dependency, match existing code conventions, and protect the locked tool distribution.

1. **`RawUpstreamTool` lives in `@traceguard/schemas`, not the island package.** Spec §5 places `RawUpstreamTool` in `@traceguard/tool-manifest`. But the 36-tool fixture in `@traceguard/testing-fixtures` needs that type, and `@traceguard/tool-manifest`'s tests depend on `testing-fixtures` — putting the type in the island would create a circular tsc project reference (`tool-manifest → testing-fixtures → tool-manifest`). `testing-fixtures` already depends on `schemas`, so relocating `RawUpstreamTool` to `schemas` adds zero new edges and keeps the graph acyclic.

2. **No `HashFn` type alias.** Spec §5 defines `HashFn = (input: string) => string`. The merged codebase uniformly inlines `hash: (s: string) => string` in `deps` (see `authorization-gateway.ts`, `action-digest.ts`, `make-event.ts`). We follow the existing convention rather than introduce a competing alias.

3. **`reconcileManifest` takes `providerType`.** Spec §6's args list omits it, but classification requires `ProviderIdentity { providerConnectionId, providerType }` (the risk table is keyed by provider type). We add `providerType: ProviderType` to `ReconcileManifestArgs`.

4. **Read-tool fixtures omit sensitive schema fields.** The schema-field raise rule maps `chain`/`address` → `asset_movement`. A *read* tool that happened to carry those fields would be wrongly raised and blocked, breaking the locked 32-visible / 4-blocked / 0-frozen distribution. The fixture's `account_read` tools (notably `get_deposit_address`) carry only non-sensitive inputs (e.g. `{ coin }`), so recognition + raise rules produce exactly the locked mapping.

5. **`canonicalJson` is promoted to `@traceguard/schemas`.** Spec §3 calls for promoting `canonicalJson` to schemas and de-duplicating the copies. `event-ledger/src/canonical-json.ts` becomes a re-export; `policy-engine/src/action-digest.ts`'s private copy is replaced by the shared import. This is the existing canonical implementation moved, not rewritten.

---

## File Structure

**`@traceguard/schemas`** (modified — add the shared, environment-independent contracts):
- Create `src/canonical-json.ts` — promoted canonical JSON serializer (the byte-reproducibility primitive).
- Create `src/canonical-json.test.ts` — moved from event-ledger.
- Create `src/tool-manifest.ts` — `RiskClass`, `ProviderType`, `RawUpstreamTool`, `NormalizedToolDefinition`.
- Create `src/tool-manifest-payloads.ts` — the 5 discovery-event payload schemas.
- Modify `src/index.ts` — export the three new modules.

**`@traceguard/event-ledger`** (modified):
- Modify `src/canonical-json.ts` — becomes a re-export from schemas.
- Delete `src/canonical-json.test.ts` — moved to schemas.
- Create `src/tool-manifest-projection.ts` — replay projection over the discovery events.
- Modify `src/index.ts` — export the projection.

**`@traceguard/policy-engine`** (modified):
- Modify `src/action-digest.ts` — use the shared `canonicalJson`, drop the private copy.

**`@traceguard/tool-manifest`** (NEW pure island + emit layer):
- Create `package.json`, `tsconfig.json`.
- Create `src/normalization-version.ts` — `NORMALIZATION_VERSION` constant.
- Create `src/risk-table.ts` — the 36-tool Bitget base-class table + lookup.
- Create `src/classify.ts` — severity lattice, `joinRisk`, recognition gate, raise rules.
- Create `src/normalize.ts` — `normalizeToolDefinition`, `computeSchemaHash`.
- Create `src/manifest-hash.ts` — `computeManifestHash`, `manifestFingerprint`.
- Create `src/diff.ts` — `diffManifest`.
- Create `src/reconcile.ts` — emit layer, 3 reconcile cases.
- Create `src/approve.ts` — emit layer, manifest approval.
- Create `src/index.ts` — barrel.

**`@traceguard/testing-fixtures`** (modified):
- Create `src/bitget-tools.ts` — 36-tool `RawUpstreamTool[]` fixture + golden manifest hash.
- Modify `src/index.ts` — export the fixture.

**Root** (modified):
- Modify `tsconfig.json` — add the new package to project references.

**Docs** (coherence sync):
- Modify `docs/event-model.md` — align §6.4–6.6 / §8.3, add ToolBlocked + ToolManifestApproved.
- Modify `docs/mcp-gateway-contract.md` — align §7–8 / §16.1 with the implemented contract.

---

## Task 1: Promote `canonicalJson` to schemas

**Files:**
- Create: `packages/schemas/src/canonical-json.ts`
- Create: `packages/schemas/src/canonical-json.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Create the canonical serializer in schemas**

Create `packages/schemas/src/canonical-json.ts`:

```ts
export function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonicalJson: non-finite numbers are not allowed");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v === undefined) continue;
      Object.defineProperty(out, key, {
        value: canonicalize(v),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
```

- [ ] **Step 2: Move the test into schemas**

Create `packages/schemas/src/canonical-json.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical-json.js";

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("is invariant to input key order", () => {
    const a = canonicalJson({ x: 1, y: 2 });
    const b = canonicalJson({ y: 2, x: 1 });
    expect(a).toBe(b);
  });

  it("drops undefined-valued keys", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("preserves a __proto__ data key", () => {
    const parsed = JSON.parse('{"__proto__":1}');
    expect(canonicalJson(parsed)).toBe('{"__proto__":1}');
  });

  it("keeps null values", () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("emits decimal strings verbatim", () => {
    expect(canonicalJson({ price: "1.50" })).toBe('{"price":"1.50"}');
  });

  it("throws on non-finite numbers", () => {
    expect(() => canonicalJson({ n: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });
});
```

- [ ] **Step 3: Export from the schemas barrel**

In `packages/schemas/src/index.ts`, add this line (keep existing exports):

```ts
export * from "./canonical-json.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test canonical-json`
Expected: PASS — the 8 cases in BOTH `packages/schemas/src/canonical-json.test.ts` AND the still-present `packages/event-ledger/src/canonical-json.test.ts` pass (event-ledger's copy is removed in Task 2).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/canonical-json.ts packages/schemas/src/canonical-json.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): promote canonicalJson to shared package"
```

---

## Task 2: De-duplicate the canonical serializer

**Files:**
- Modify: `packages/event-ledger/src/canonical-json.ts`
- Delete: `packages/event-ledger/src/canonical-json.test.ts`
- Modify: `packages/policy-engine/src/action-digest.ts:1-36`

- [ ] **Step 1: Turn event-ledger's copy into a re-export**

Replace the entire contents of `packages/event-ledger/src/canonical-json.ts` with:

```ts
export { canonicalize, canonicalJson } from "@traceguard/schemas";
```

This preserves `hashing.ts`'s `import { canonicalJson } from "./canonical-json.js"` and the barrel's `export * from "./canonical-json.js"`, so no other event-ledger file changes.

- [ ] **Step 2: Delete event-ledger's now-duplicate test**

```bash
git rm packages/event-ledger/src/canonical-json.test.ts
```

The identical coverage now lives in `packages/schemas/src/canonical-json.test.ts`.

- [ ] **Step 3: Replace policy-engine's private copy with the shared import**

`packages/policy-engine/src/action-digest.ts` currently has these exact contents:

```ts
import { ActionDigestInput as ActionDigestInputSchema, type ActionDigestInput as ActionDigestInputValue } from "@traceguard/schemas";

function canonicalize(value: unknown): unknown {
  // ... ~30 lines of the private canonical serializer (lines 3–36) ...
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function computeActionDigest(input: ActionDigestInputValue, hash: (s: string) => string): string {
  return hash(canonicalJson(ActionDigestInputSchema.parse(input)));
}
```

The schema is exported from `@traceguard/schemas` as `ActionDigestInput` (a Zod schema); this file aliases it to `ActionDigestInputSchema` (the value, used for `.parse`) and `ActionDigestInputValue` (the type, used for the `input` param). **Both aliases must be preserved** — `computeActionDigest`'s signature on the last line depends on `ActionDigestInputValue`.

Delete the private `canonicalize` and `canonicalJson` functions (lines 3–36) and pull `canonicalJson` in from schemas, keeping both existing aliases. The whole file becomes exactly:

```ts
import {
  ActionDigestInput as ActionDigestInputSchema,
  canonicalJson,
  type ActionDigestInput as ActionDigestInputValue,
} from "@traceguard/schemas";

export function computeActionDigest(input: ActionDigestInputValue, hash: (s: string) => string): string {
  return hash(canonicalJson(ActionDigestInputSchema.parse(input)));
}
```

`computeActionDigest`'s body is unchanged — only the source of `canonicalJson` (now the shared schemas copy) and the deletion of the private serializer differ.

- [ ] **Step 4: Run the affected tests**

Run: `pnpm test action-digest`
Expected: PASS — digest output is byte-identical because the serializer is the same implementation, now shared.

- [ ] **Step 5: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: PASS — no unused-symbol or missing-export errors across schemas, event-ledger, policy-engine.

- [ ] **Step 6: Commit**

```bash
git add packages/event-ledger/src/canonical-json.ts packages/policy-engine/src/action-digest.ts
git commit -m "refactor(event-ledger,policy-engine): consume shared canonicalJson"
```

---

## Task 3: Tool-manifest core schemas

**Files:**
- Create: `packages/schemas/src/tool-manifest.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/tool-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/tool-manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  NormalizedToolDefinition,
  ProviderType,
  RiskClass,
} from "./tool-manifest.js";

describe("RiskClass", () => {
  it("accepts the five severity classes plus unknown", () => {
    for (const c of [
      "public_read",
      "account_read",
      "trade_like",
      "asset_movement",
      "administrative",
      "unknown",
    ]) {
      expect(RiskClass.parse(c)).toBe(c);
    }
  });

  it("rejects an unlisted class", () => {
    expect(() => RiskClass.parse("nope")).toThrow();
  });
});

describe("ProviderType", () => {
  it("accepts the known provider types", () => {
    expect(ProviderType.parse("bitget_agent_hub")).toBe("bitget_agent_hub");
    expect(ProviderType.parse("custom_mcp")).toBe("custom_mcp");
    expect(ProviderType.parse("generic_rest")).toBe("generic_rest");
  });
});

describe("NormalizedToolDefinition", () => {
  const base = {
    providerConnectionId: "pc_1",
    providerType: "bitget_agent_hub",
    name: "spot_get_ticker",
    inputSchema: { type: "object" },
    normalizedJson: "{}",
    schemaHash: "abc",
    riskClass: "public_read",
  };

  it("parses a minimal valid definition", () => {
    expect(NormalizedToolDefinition.parse(base)).toMatchObject({ name: "spot_get_ticker" });
  });

  it("rejects unknown keys (strict)", () => {
    expect(() => NormalizedToolDefinition.parse({ ...base, extra: 1 })).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => NormalizedToolDefinition.parse({ ...base, name: "" })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tool-manifest`
Expected: FAIL — `Cannot find module './tool-manifest.js'`.

- [ ] **Step 3: Write the schemas**

Create `packages/schemas/src/tool-manifest.ts`:

```ts
import { z } from "zod";

export const RiskClass = z.enum([
  "public_read",
  "account_read",
  "trade_like",
  "asset_movement",
  "administrative",
  "unknown",
]);
export type RiskClass = z.infer<typeof RiskClass>;

export const ProviderType = z.enum(["bitget_agent_hub", "custom_mcp", "generic_rest"]);
export type ProviderType = z.infer<typeof ProviderType>;

export interface RawUpstreamTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

export const NormalizedToolDefinition = z
  .object({
    providerConnectionId: z.string().min(1),
    providerType: ProviderType,
    name: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    inputSchema: z.unknown(),
    outputSchema: z.unknown().optional(),
    annotations: z.record(z.unknown()).optional(),
    normalizedJson: z.string().min(1),
    schemaHash: z.string().min(1),
    riskClass: RiskClass,
  })
  .strict();
export type NormalizedToolDefinition = z.infer<typeof NormalizedToolDefinition>;
```

- [ ] **Step 4: Export from the barrel**

In `packages/schemas/src/index.ts`, add:

```ts
export * from "./tool-manifest.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test tool-manifest`
Expected: PASS — all RiskClass / ProviderType / NormalizedToolDefinition cases green.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/tool-manifest.ts packages/schemas/src/tool-manifest.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add tool-manifest core types"
```

---

## Task 4: Tool-manifest event payloads

**Files:**
- Create: `packages/schemas/src/tool-manifest-payloads.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/tool-manifest-payloads.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/tool-manifest-payloads.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ToolBlockedPayload,
  ToolFrozenPayload,
  ToolManifestApprovedPayload,
  ToolManifestChangedPayload,
  ToolManifestImportedPayload,
} from "./tool-manifest-payloads.js";

describe("ToolManifestImportedPayload", () => {
  it("parses a valid import payload", () => {
    expect(
      ToolManifestImportedPayload.parse({
        toolManifestVersionId: "tmv_1",
        providerConnectionId: "pc_1",
        manifestHash: "h",
        normalizationVersion: 1,
        tools: [{ name: "spot_get_ticker", riskClass: "public_read", schemaHash: "s" }],
      }),
    ).toMatchObject({ toolManifestVersionId: "tmv_1" });
  });

  it("rejects unknown keys", () => {
    expect(() =>
      ToolManifestImportedPayload.parse({
        toolManifestVersionId: "tmv_1",
        providerConnectionId: "pc_1",
        manifestHash: "h",
        normalizationVersion: 1,
        tools: [],
        extra: true,
      }),
    ).toThrow();
  });
});

describe("ToolManifestChangedPayload", () => {
  it("parses added/removed/changed", () => {
    expect(
      ToolManifestChangedPayload.parse({
        toolManifestVersionId: "tmv_2",
        providerConnectionId: "pc_1",
        previousManifestHash: "h1",
        manifestHash: "h2",
        added: [{ name: "new_tool", riskClass: "trade_like", schemaHash: "s" }],
        removed: ["old_tool"],
        changed: [
          {
            name: "spot_place_order",
            previousSchemaHash: "a",
            schemaHash: "b",
            sensitive: true,
          },
        ],
      }),
    ).toMatchObject({ manifestHash: "h2" });
  });
});

describe("ToolFrozenPayload", () => {
  it("accepts the freeze reason codes", () => {
    for (const reasonCode of ["changed_sensitive", "unknown_risk"]) {
      expect(
        ToolFrozenPayload.parse({
          providerConnectionId: "pc_1",
          toolName: "x",
          manifestHash: "h",
          reasonCode,
        }),
      ).toMatchObject({ reasonCode });
    }
  });
});

describe("ToolBlockedPayload", () => {
  it("accepts the block reason codes", () => {
    for (const reasonCode of ["risk_class_default", "operator_blocklist"]) {
      expect(
        ToolBlockedPayload.parse({
          providerConnectionId: "pc_1",
          toolName: "withdraw",
          riskClass: "asset_movement",
          manifestHash: "h",
          reasonCode,
        }),
      ).toMatchObject({ reasonCode });
    }
  });
});

describe("ToolManifestApprovedPayload", () => {
  it("parses an approval payload", () => {
    expect(
      ToolManifestApprovedPayload.parse({
        toolManifestVersionId: "tmv_1",
        providerConnectionId: "pc_1",
        manifestHash: "h",
        approvedBy: "user_1",
        approvedAt: "2026-06-11T00:00:00.000Z",
      }),
    ).toMatchObject({ approvedBy: "user_1" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tool-manifest-payloads`
Expected: FAIL — `Cannot find module './tool-manifest-payloads.js'`.

- [ ] **Step 3: Write the payload schemas**

Create `packages/schemas/src/tool-manifest-payloads.ts`:

```ts
import { z } from "zod";
import { IsoTimestamp } from "./scalars.js";
import { RiskClass } from "./tool-manifest.js";

export const ToolManifestEntry = z
  .object({
    name: z.string().min(1),
    riskClass: RiskClass,
    schemaHash: z.string().min(1),
  })
  .strict();
export type ToolManifestEntry = z.infer<typeof ToolManifestEntry>;

export const ChangedTool = z
  .object({
    name: z.string().min(1),
    previousSchemaHash: z.string().optional(),
    schemaHash: z.string().optional(),
    previousRiskClass: RiskClass.optional(),
    riskClass: RiskClass.optional(),
    sensitive: z.boolean(),
  })
  .strict();
export type ChangedTool = z.infer<typeof ChangedTool>;

export const ToolFreezeReason = z.enum(["changed_sensitive", "unknown_risk"]);
export type ToolFreezeReason = z.infer<typeof ToolFreezeReason>;

export const ToolBlockReason = z.enum(["risk_class_default", "operator_blocklist"]);
export type ToolBlockReason = z.infer<typeof ToolBlockReason>;

export const ToolManifestImportedPayload = z
  .object({
    toolManifestVersionId: z.string().min(1),
    providerConnectionId: z.string().min(1),
    manifestHash: z.string().min(1),
    normalizationVersion: z.number().int().nonnegative(),
    tools: z.array(ToolManifestEntry),
  })
  .strict();
export type ToolManifestImportedPayload = z.infer<typeof ToolManifestImportedPayload>;

export const ToolManifestChangedPayload = z
  .object({
    toolManifestVersionId: z.string().min(1),
    providerConnectionId: z.string().min(1),
    previousManifestHash: z.string().min(1),
    manifestHash: z.string().min(1),
    added: z.array(ToolManifestEntry),
    removed: z.array(z.string().min(1)),
    changed: z.array(ChangedTool),
  })
  .strict();
export type ToolManifestChangedPayload = z.infer<typeof ToolManifestChangedPayload>;

export const ToolFrozenPayload = z
  .object({
    providerConnectionId: z.string().min(1),
    toolName: z.string().min(1),
    manifestHash: z.string().min(1),
    reasonCode: ToolFreezeReason,
  })
  .strict();
export type ToolFrozenPayload = z.infer<typeof ToolFrozenPayload>;

export const ToolBlockedPayload = z
  .object({
    providerConnectionId: z.string().min(1),
    toolName: z.string().min(1),
    riskClass: RiskClass,
    manifestHash: z.string().min(1),
    reasonCode: ToolBlockReason,
  })
  .strict();
export type ToolBlockedPayload = z.infer<typeof ToolBlockedPayload>;

export const ToolManifestApprovedPayload = z
  .object({
    toolManifestVersionId: z.string().min(1),
    providerConnectionId: z.string().min(1),
    manifestHash: z.string().min(1),
    approvedBy: z.string().min(1),
    approvedAt: IsoTimestamp,
  })
  .strict();
export type ToolManifestApprovedPayload = z.infer<typeof ToolManifestApprovedPayload>;
```

- [ ] **Step 4: Export from the barrel**

In `packages/schemas/src/index.ts`, add:

```ts
export * from "./tool-manifest-payloads.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test tool-manifest-payloads`
Expected: PASS — all five payload describe-blocks green.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/tool-manifest-payloads.ts packages/schemas/src/tool-manifest-payloads.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add tool-manifest discovery-event payloads"
```

---

## Task 5: Scaffold the `@traceguard/tool-manifest` package

**Files:**
- Create: `packages/tool-manifest/package.json`
- Create: `packages/tool-manifest/tsconfig.json`
- Create: `packages/tool-manifest/src/normalization-version.ts`
- Create: `packages/tool-manifest/src/index.ts`
- Modify: `tsconfig.json` (root)
- Test: `packages/tool-manifest/src/normalization-version.test.ts`

- [ ] **Step 1: Create the package manifest**

Create `packages/tool-manifest/package.json`:

```json
{
  "name": "@traceguard/tool-manifest",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@traceguard/schemas": "workspace:*",
    "@traceguard/event-ledger": "workspace:*"
  },
  "devDependencies": {
    "@traceguard/testing-fixtures": "workspace:*"
  }
}
```

(No `scripts` field — mirrors the other packages; tests run from the repo root via `pnpm test <pattern>`.)

- [ ] **Step 2: Create the package tsconfig**

Create `packages/tool-manifest/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [
    { "path": "../schemas" },
    { "path": "../event-ledger" },
    { "path": "../testing-fixtures" }
  ]
}
```

- [ ] **Step 3: Register the package in the root tsconfig**

In the root `tsconfig.json`, add the new package to `references` (keep the existing six):

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
    { "path": "./packages/tool-manifest" }
  ]
}
```

- [ ] **Step 4: Create the normalization-version constant**

Create `packages/tool-manifest/src/normalization-version.ts`:

```ts
export const NORMALIZATION_VERSION = 1;
```

- [ ] **Step 5: Create a minimal barrel (grown in later tasks)**

Create `packages/tool-manifest/src/index.ts`:

```ts
export * from "./normalization-version.js";
```

- [ ] **Step 6: Write the failing test**

Create `packages/tool-manifest/src/normalization-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NORMALIZATION_VERSION } from "./normalization-version.js";

describe("NORMALIZATION_VERSION", () => {
  it("is a non-negative integer", () => {
    expect(Number.isInteger(NORMALIZATION_VERSION)).toBe(true);
    expect(NORMALIZATION_VERSION).toBeGreaterThanOrEqual(0);
  });

  it("is pinned to 1 for the initial normalization scheme", () => {
    expect(NORMALIZATION_VERSION).toBe(1);
  });
});
```

- [ ] **Step 7: Link the new workspace package**

Run: `pnpm install`
Expected: pnpm links `@traceguard/tool-manifest` into the workspace; `packages/tool-manifest/node_modules/@traceguard/{schemas,event-ledger,testing-fixtures}` symlinks resolve. (This regenerates `pnpm-lock.yaml`; that change is committed here with the scaffold.)

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm test normalization-version`
Expected: PASS — both cases green.

- [ ] **Step 9: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: PASS — the new project reference resolves and builds.

- [ ] **Step 10: Commit**

```bash
git add packages/tool-manifest/package.json packages/tool-manifest/tsconfig.json packages/tool-manifest/src/normalization-version.ts packages/tool-manifest/src/normalization-version.test.ts packages/tool-manifest/src/index.ts tsconfig.json pnpm-lock.yaml
git commit -m "chore(tool-manifest): scaffold pure-island package"
```

> **Note on `pnpm-lock.yaml`:** only stage it if `pnpm install` changed it as a result of adding this package. Do NOT stage `package.json` (root) — its pending `bitget-mcp-server` change belongs to Phase 3B, not this commit.

---

## Task 6: Bitget risk table (36-tool base mapping)

**Files:**
- Create: `packages/tool-manifest/src/risk-table.ts`
- Test: `packages/tool-manifest/src/risk-table.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/tool-manifest/src/risk-table.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BITGET_RISK_TABLE, lookupBaseClass, type BaseClass } from "./risk-table.js";

describe("BITGET_RISK_TABLE", () => {
  it("maps exactly 36 tools", () => {
    expect(Object.keys(BITGET_RISK_TABLE)).toHaveLength(36);
  });

  it("has the locked class distribution 13/10/9/3/1", () => {
    const counts: Record<BaseClass, number> = {
      public_read: 0,
      account_read: 0,
      trade_like: 0,
      asset_movement: 0,
      administrative: 0,
    };
    for (const c of Object.values(BITGET_RISK_TABLE)) counts[c] += 1;
    expect(counts).toEqual({
      public_read: 13,
      account_read: 10,
      trade_like: 9,
      asset_movement: 3,
      administrative: 1,
    });
  });

  it("classifies representative tools correctly", () => {
    expect(BITGET_RISK_TABLE.spot_get_ticker).toBe("public_read");
    expect(BITGET_RISK_TABLE.get_account_assets).toBe("account_read");
    expect(BITGET_RISK_TABLE.futures_place_order).toBe("trade_like");
    expect(BITGET_RISK_TABLE.withdraw).toBe("asset_movement");
    expect(BITGET_RISK_TABLE.manage_subaccounts).toBe("administrative");
  });
});

describe("lookupBaseClass", () => {
  it("returns the base class for a known bitget tool", () => {
    expect(lookupBaseClass("bitget_agent_hub", "withdraw")).toBe("asset_movement");
  });

  it("returns undefined for an unknown tool name", () => {
    expect(lookupBaseClass("bitget_agent_hub", "mystery")).toBeUndefined();
  });

  it("returns undefined for a provider with no table", () => {
    expect(lookupBaseClass("custom_mcp", "withdraw")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test risk-table`
Expected: FAIL — `Cannot find module './risk-table.js'`.

- [ ] **Step 3: Write the risk table**

Create `packages/tool-manifest/src/risk-table.ts`:

```ts
import type { ProviderType } from "@traceguard/schemas";

export type BaseClass =
  | "public_read"
  | "account_read"
  | "trade_like"
  | "asset_movement"
  | "administrative";

export const BITGET_RISK_TABLE: Record<string, BaseClass> = {
  // public_read (13)
  spot_get_ticker: "public_read",
  spot_get_depth: "public_read",
  spot_get_candles: "public_read",
  spot_get_trades: "public_read",
  spot_get_symbols: "public_read",
  futures_get_ticker: "public_read",
  futures_get_depth: "public_read",
  futures_get_candles: "public_read",
  futures_get_trades: "public_read",
  futures_get_contracts: "public_read",
  futures_get_funding_rate: "public_read",
  futures_get_open_interest: "public_read",
  system_get_capabilities: "public_read",
  // account_read (10)
  spot_get_orders: "account_read",
  spot_get_fills: "account_read",
  spot_get_plan_orders: "account_read",
  futures_get_orders: "account_read",
  futures_get_fills: "account_read",
  futures_get_positions: "account_read",
  get_account_assets: "account_read",
  get_account_bills: "account_read",
  get_transaction_records: "account_read",
  get_deposit_address: "account_read",
  // trade_like (9)
  spot_place_order: "trade_like",
  spot_cancel_orders: "trade_like",
  spot_modify_order: "trade_like",
  spot_place_plan_order: "trade_like",
  spot_cancel_plan_orders: "trade_like",
  futures_place_order: "trade_like",
  futures_cancel_orders: "trade_like",
  futures_set_leverage: "trade_like",
  futures_update_config: "trade_like",
  // asset_movement (3)
  transfer: "asset_movement",
  withdraw: "asset_movement",
  cancel_withdrawal: "asset_movement",
  // administrative (1)
  manage_subaccounts: "administrative",
};

const TABLES: Partial<Record<ProviderType, Record<string, BaseClass>>> = {
  bitget_agent_hub: BITGET_RISK_TABLE,
};

export function lookupBaseClass(
  providerType: ProviderType,
  name: string,
): BaseClass | undefined {
  return TABLES[providerType]?.[name];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test risk-table`
Expected: PASS — 36-tool count, 13/10/9/3/1 distribution, and lookups all green.

- [ ] **Step 5: Commit**

```bash
git add packages/tool-manifest/src/risk-table.ts packages/tool-manifest/src/risk-table.test.ts
git commit -m "feat(tool-manifest): add Bitget 36-tool risk base table"
```

---

## Task 7: Classifier — severity lattice, recognition gate, raise rules

**Files:**
- Create: `packages/tool-manifest/src/classify.ts`
- Test: `packages/tool-manifest/src/classify.test.ts`
- Test: `packages/tool-manifest/src/classify.property.test.ts`

- [ ] **Step 1: Write the failing property test (the crux test)**

Create `packages/tool-manifest/src/classify.property.test.ts`:

```ts
import { describe, it } from "vitest";
import fc from "fast-check";
import { SEVERITY, joinRisk, type Severity } from "./classify.js";

const severityArb = fc.constantFrom<Severity>(...SEVERITY);

describe("joinRisk (property)", () => {
  it("is raise-only: the result is never below either input", () => {
    fc.assert(
      fc.property(severityArb, severityArb, (a, b) => {
        const out = joinRisk(a, b);
        return (
          SEVERITY.indexOf(out) >= SEVERITY.indexOf(a) &&
          SEVERITY.indexOf(out) >= SEVERITY.indexOf(b)
        );
      }),
    );
  });

  it("equals the lattice max of the two inputs", () => {
    fc.assert(
      fc.property(severityArb, severityArb, (a, b) => {
        const out = joinRisk(a, b);
        const expected = SEVERITY.indexOf(a) >= SEVERITY.indexOf(b) ? a : b;
        return out === expected;
      }),
    );
  });

  it("is idempotent and commutative", () => {
    fc.assert(
      fc.property(severityArb, severityArb, (a, b) => {
        return joinRisk(a, a) === a && joinRisk(a, b) === joinRisk(b, a);
      }),
    );
  });
});
```

- [ ] **Step 2: Write the failing unit test**

Create `packages/tool-manifest/src/classify.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RawUpstreamTool } from "@traceguard/schemas";
import { classifyRisk } from "./classify.js";

const raw = (over: Partial<RawUpstreamTool> & { name: string }): RawUpstreamTool => ({
  inputSchema: { type: "object" },
  ...over,
});

describe("classifyRisk recognition gate", () => {
  it("returns unknown for an unrecognized tool", () => {
    expect(classifyRisk(raw({ name: "mystery_tool" }), "bitget_agent_hub")).toBe("unknown");
  });

  it("returns the base class for a recognized read tool", () => {
    expect(classifyRisk(raw({ name: "spot_get_ticker" }), "bitget_agent_hub")).toBe(
      "public_read",
    );
  });

  it("short-circuits raise rules for an unrecognized tool", () => {
    const tool = raw({ name: "mystery_tool", annotations: { destructiveHint: true } });
    expect(classifyRisk(tool, "bitget_agent_hub")).toBe("unknown");
  });
});

describe("classifyRisk raise rules", () => {
  it("raises to asset_movement via a sensitive schema field", () => {
    const tool = raw({
      name: "spot_get_ticker",
      inputSchema: { type: "object", properties: { withdrawAddress: { type: "string" } } },
    });
    expect(classifyRisk(tool, "bitget_agent_hub")).toBe("asset_movement");
  });

  it("raises a read tool to trade_like via a write annotation", () => {
    const tool = raw({ name: "spot_get_ticker", annotations: { readOnlyHint: false } });
    expect(classifyRisk(tool, "bitget_agent_hub")).toBe("trade_like");
  });

  it("raises via a [DANGER] tag in the description", () => {
    const tool = raw({ name: "spot_get_ticker", description: "[DANGER] do not use" });
    expect(classifyRisk(tool, "bitget_agent_hub")).toBe("asset_movement");
  });

  it("never lowers a higher base class (join is raise-only)", () => {
    const tool = raw({ name: "withdraw", description: "[CAUTION] moves funds" });
    expect(classifyRisk(tool, "bitget_agent_hub")).toBe("asset_movement");
  });

  it("finds sensitive fields nested under array items", () => {
    const tool = raw({
      name: "spot_get_ticker",
      inputSchema: {
        type: "object",
        properties: {
          batch: { type: "array", items: { type: "object", properties: { chain: {} } } },
        },
      },
    });
    expect(classifyRisk(tool, "bitget_agent_hub")).toBe("asset_movement");
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `pnpm test classify`
Expected: FAIL — `Cannot find module './classify.js'`.

- [ ] **Step 4: Write the classifier**

Create `packages/tool-manifest/src/classify.ts`:

```ts
import type { ProviderType, RawUpstreamTool, RiskClass } from "@traceguard/schemas";
import { lookupBaseClass } from "./risk-table.js";

export const SEVERITY = [
  "public_read",
  "account_read",
  "trade_like",
  "asset_movement",
  "administrative",
] as const;
export type Severity = (typeof SEVERITY)[number];

export function joinRisk(a: Severity, b: Severity): Severity {
  return SEVERITY.indexOf(b) > SEVERITY.indexOf(a) ? b : a;
}

const SENSITIVE_SCHEMA_FIELDS: Record<string, Severity> = {
  address: "asset_movement",
  withdrawAddress: "asset_movement",
  chain: "asset_movement",
  apiKeyPassphrase: "administrative",
  apiKeyPermissions: "administrative",
  apiKeyIp: "administrative",
};

function schemaPropertyNames(schema: unknown, acc: Set<string>): Set<string> {
  if (schema === null || typeof schema !== "object") return acc;
  const obj = schema as Record<string, unknown>;
  const properties = obj.properties;
  if (properties !== null && typeof properties === "object") {
    for (const key of Object.keys(properties as Record<string, unknown>)) {
      acc.add(key);
      schemaPropertyNames((properties as Record<string, unknown>)[key], acc);
    }
  }
  for (const branch of ["items", "allOf", "anyOf", "oneOf"]) {
    const value = obj[branch];
    if (Array.isArray(value)) {
      for (const sub of value) schemaPropertyNames(sub, acc);
    } else if (value !== undefined) {
      schemaPropertyNames(value, acc);
    }
  }
  return acc;
}

function schemaFieldRule(raw: RawUpstreamTool): Severity | undefined {
  const names = schemaPropertyNames(raw.inputSchema, new Set<string>());
  let result: Severity | undefined;
  for (const name of names) {
    const sev = SENSITIVE_SCHEMA_FIELDS[name];
    if (sev !== undefined) result = result === undefined ? sev : joinRisk(result, sev);
  }
  return result;
}

function writeAnnotationRule(raw: RawUpstreamTool): Severity | undefined {
  const annotations = raw.annotations;
  if (annotations === undefined) return undefined;
  if (annotations.destructiveHint === true || annotations.readOnlyHint === false) {
    return "trade_like";
  }
  return undefined;
}

function dangerTagRule(raw: RawUpstreamTool): Severity | undefined {
  const haystack = `${raw.title ?? ""} ${raw.description ?? ""}`;
  if (haystack.includes("[DANGER]")) return "asset_movement";
  if (haystack.includes("[CAUTION]")) return "trade_like";
  return undefined;
}

const RAISE_RULES: Array<(raw: RawUpstreamTool) => Severity | undefined> = [
  schemaFieldRule,
  writeAnnotationRule,
  dangerTagRule,
];

export function classifyRisk(raw: RawUpstreamTool, providerType: ProviderType): RiskClass {
  const base = lookupBaseClass(providerType, raw.name);
  if (base === undefined) return "unknown";
  let result: Severity = base;
  for (const rule of RAISE_RULES) {
    const raised = rule(raw);
    if (raised !== undefined) result = joinRisk(result, raised);
  }
  return result;
}
```

- [ ] **Step 5: Run both tests to verify they pass**

Run: `pnpm test classify`
Expected: PASS — property test (raise-only / max / idempotent+commutative) and all unit cases green.

- [ ] **Step 6: Commit**

```bash
git add packages/tool-manifest/src/classify.ts packages/tool-manifest/src/classify.test.ts packages/tool-manifest/src/classify.property.test.ts
git commit -m "feat(tool-manifest): add risk classifier with raise-only join lattice"
```

---

## Task 8: Normalize a raw tool into a `NormalizedToolDefinition`

**Files:**
- Create: `packages/tool-manifest/src/normalize.ts`
- Test: `packages/tool-manifest/src/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/tool-manifest/src/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RawUpstreamTool } from "@traceguard/schemas";
import { computeSchemaHash, normalizeToolDefinition } from "./normalize.js";

const identity = { providerConnectionId: "pc_1", providerType: "bitget_agent_hub" as const };
const hash = (s: string): string => `h(${s.length})`;

describe("normalizeToolDefinition", () => {
  it("classifies and emits a stable normalizedJson + schemaHash", () => {
    const raw: RawUpstreamTool = { name: "spot_get_ticker", inputSchema: { type: "object" } };
    const def = normalizeToolDefinition(raw, identity, { hash });
    expect(def.riskClass).toBe("public_read");
    expect(def.schemaHash).toBe(hash(JSON.stringify({ type: "object" })));
    expect(def.normalizedJson).toContain('"name":"spot_get_ticker"');
    expect(def.normalizedJson).toContain('"riskClass":"public_read"');
  });

  it("produces normalizedJson invariant to input key order", () => {
    const a = normalizeToolDefinition(
      { name: "spot_get_ticker", inputSchema: { b: 1, a: 2 } },
      identity,
      { hash },
    );
    const b = normalizeToolDefinition(
      { name: "spot_get_ticker", inputSchema: { a: 2, b: 1 } },
      identity,
      { hash },
    );
    expect(a.normalizedJson).toBe(b.normalizedJson);
  });

  it("validates through the strict schema (parse succeeds)", () => {
    const def = normalizeToolDefinition(
      { name: "withdraw", inputSchema: { type: "object" } },
      identity,
      { hash },
    );
    expect(def.riskClass).toBe("asset_movement");
  });
});

describe("computeSchemaHash", () => {
  it("hashes an empty object for a nullish schema", () => {
    expect(computeSchemaHash(undefined, { hash })).toBe(hash("{}"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test normalize`
Expected: FAIL — `Cannot find module './normalize.js'`.

- [ ] **Step 3: Write the normalizer**

Create `packages/tool-manifest/src/normalize.ts`:

```ts
import {
  NormalizedToolDefinition,
  canonicalJson,
  type ProviderType,
  type RawUpstreamTool,
} from "@traceguard/schemas";
import { classifyRisk } from "./classify.js";

export interface ProviderIdentity {
  providerConnectionId: string;
  providerType: ProviderType;
}

export function computeSchemaHash(
  inputSchema: unknown,
  deps: { hash: (input: string) => string },
): string {
  return deps.hash(canonicalJson(inputSchema ?? {}));
}

export function normalizeToolDefinition(
  raw: RawUpstreamTool,
  identity: ProviderIdentity,
  deps: { hash: (input: string) => string },
): NormalizedToolDefinition {
  const riskClass = classifyRisk(raw, identity.providerType);
  const fingerprint = {
    providerType: identity.providerType,
    providerConnectionId: identity.providerConnectionId,
    name: raw.name,
    title: raw.title,
    description: raw.description,
    inputSchema: raw.inputSchema,
    outputSchema: raw.outputSchema,
    annotations: raw.annotations,
    riskClass,
  };
  const normalizedJson = canonicalJson(fingerprint);
  const schemaHash = computeSchemaHash(raw.inputSchema, deps);
  return NormalizedToolDefinition.parse({
    providerConnectionId: identity.providerConnectionId,
    providerType: identity.providerType,
    name: raw.name,
    title: raw.title,
    description: raw.description,
    inputSchema: raw.inputSchema,
    outputSchema: raw.outputSchema,
    annotations: raw.annotations,
    normalizedJson,
    schemaHash,
    riskClass,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test normalize`
Expected: PASS — classification, schemaHash, and key-order invariance green.

- [ ] **Step 5: Commit**

```bash
git add packages/tool-manifest/src/normalize.ts packages/tool-manifest/src/normalize.test.ts
git commit -m "feat(tool-manifest): add tool normalization with schema fingerprint"
```

---

## Task 9: Manifest hash

**Files:**
- Create: `packages/tool-manifest/src/manifest-hash.ts`
- Test: `packages/tool-manifest/src/manifest-hash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/tool-manifest/src/manifest-hash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { NormalizedToolDefinition } from "@traceguard/schemas";
import { computeManifestHash, manifestFingerprint } from "./manifest-hash.js";

const def = (
  name: string,
  riskClass: string,
  schemaHash: string,
): NormalizedToolDefinition =>
  ({
    providerConnectionId: "pc_1",
    providerType: "bitget_agent_hub",
    name,
    inputSchema: {},
    normalizedJson: "{}",
    schemaHash,
    riskClass,
  }) as NormalizedToolDefinition;

const hash = (s: string): string => `h:${s}`;

describe("computeManifestHash", () => {
  it("is order-independent over the tool list", () => {
    const a = computeManifestHash(
      [def("b", "public_read", "s1"), def("a", "trade_like", "s2")],
      { hash },
    );
    const b = computeManifestHash(
      [def("a", "trade_like", "s2"), def("b", "public_read", "s1")],
      { hash },
    );
    expect(a).toBe(b);
  });

  it("changes when a tool's schemaHash changes", () => {
    const a = computeManifestHash([def("a", "public_read", "s1")], { hash });
    const b = computeManifestHash([def("a", "public_read", "s2")], { hash });
    expect(a).not.toBe(b);
  });

  it("changes when a tool's riskClass changes", () => {
    const a = computeManifestHash([def("a", "public_read", "s1")], { hash });
    const b = computeManifestHash([def("a", "trade_like", "s1")], { hash });
    expect(a).not.toBe(b);
  });

  it("incorporates the normalization version", () => {
    const a = computeManifestHash([def("a", "public_read", "s1")], { hash });
    expect(a).toContain('"normalizationVersion":1');
  });
});

describe("manifestFingerprint", () => {
  it("projects only name, riskClass, schemaHash", () => {
    expect(manifestFingerprint(def("a", "public_read", "s1"))).toEqual({
      name: "a",
      riskClass: "public_read",
      schemaHash: "s1",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test manifest-hash`
Expected: FAIL — `Cannot find module './manifest-hash.js'`.

- [ ] **Step 3: Write the manifest hasher**

Create `packages/tool-manifest/src/manifest-hash.ts`:

```ts
import {
  canonicalJson,
  type NormalizedToolDefinition,
  type ToolManifestEntry,
} from "@traceguard/schemas";
import { NORMALIZATION_VERSION } from "./normalization-version.js";

export function manifestFingerprint(def: NormalizedToolDefinition): ToolManifestEntry {
  return { name: def.name, riskClass: def.riskClass, schemaHash: def.schemaHash };
}

function byName(a: ToolManifestEntry, b: ToolManifestEntry): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function computeManifestHash(
  defs: NormalizedToolDefinition[],
  deps: { hash: (input: string) => string },
): string {
  const tools = defs.map(manifestFingerprint).sort(byName);
  return deps.hash(canonicalJson({ normalizationVersion: NORMALIZATION_VERSION, tools }));
}
```

> **Test note:** the `incorporates the normalization version` case uses the stub `hash = (s) => "h:" + s`, so the canonical JSON string is visible in the output and can be asserted with `toContain`. The real `sha256hex` would obscure it — that path is exercised by the golden test in Task 14.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test manifest-hash`
Expected: PASS — order-independence, schemaHash/riskClass sensitivity, version embedding, and fingerprint projection green.

- [ ] **Step 5: Commit**

```bash
git add packages/tool-manifest/src/manifest-hash.ts packages/tool-manifest/src/manifest-hash.test.ts
git commit -m "feat(tool-manifest): add deterministic manifest hash"
```

---

## Task 10: Manifest diff

**Files:**
- Create: `packages/tool-manifest/src/diff.ts`
- Test: `packages/tool-manifest/src/diff.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/tool-manifest/src/diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { NormalizedToolDefinition, ToolManifestEntry } from "@traceguard/schemas";
import { diffManifest } from "./diff.js";

const entry = (name: string, riskClass: string, schemaHash: string): ToolManifestEntry =>
  ({ name, riskClass, schemaHash }) as ToolManifestEntry;

const obs = (
  name: string,
  riskClass: string,
  schemaHash: string,
): NormalizedToolDefinition =>
  ({
    providerConnectionId: "pc_1",
    providerType: "bitget_agent_hub",
    name,
    inputSchema: {},
    normalizedJson: "{}",
    schemaHash,
    riskClass,
  }) as NormalizedToolDefinition;

describe("diffManifest", () => {
  it("detects added tools", () => {
    const d = diffManifest([], [obs("a", "public_read", "s1")]);
    expect(d.added).toEqual([entry("a", "public_read", "s1")]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it("detects removed tools", () => {
    const d = diffManifest([entry("a", "public_read", "s1")], []);
    expect(d.removed).toEqual(["a"]);
    expect(d.added).toEqual([]);
  });

  it("flags a sensitive-class schema change as sensitive", () => {
    const d = diffManifest(
      [entry("withdraw", "asset_movement", "s1")],
      [obs("withdraw", "asset_movement", "s2")],
    );
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]).toMatchObject({
      name: "withdraw",
      previousSchemaHash: "s1",
      schemaHash: "s2",
      sensitive: true,
    });
  });

  it("flags a read-tool schema change as not sensitive", () => {
    const d = diffManifest(
      [entry("spot_get_ticker", "public_read", "s1")],
      [obs("spot_get_ticker", "public_read", "s2")],
    );
    expect(d.changed[0]).toMatchObject({ sensitive: false });
  });

  it("treats a risk-class escalation into a sensitive class as sensitive", () => {
    const d = diffManifest(
      [entry("x", "public_read", "s1")],
      [obs("x", "trade_like", "s1")],
    );
    expect(d.changed[0]).toMatchObject({
      previousRiskClass: "public_read",
      riskClass: "trade_like",
      sensitive: true,
    });
  });

  it("emits nothing when approved and observed match", () => {
    const d = diffManifest(
      [entry("a", "public_read", "s1")],
      [obs("a", "public_read", "s1")],
    );
    expect(d).toEqual({ added: [], removed: [], changed: [] });
  });

  it("sorts all three arrays by name", () => {
    const d = diffManifest(
      [entry("z", "public_read", "s"), entry("y", "public_read", "s")],
      [obs("b", "public_read", "s"), obs("a", "public_read", "s")],
    );
    expect(d.added.map((t) => t.name)).toEqual(["a", "b"]);
    expect(d.removed).toEqual(["y", "z"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/diff`
Expected: FAIL — `Cannot find module './diff.js'`.

- [ ] **Step 3: Write the diff**

Create `packages/tool-manifest/src/diff.ts`:

```ts
import type {
  ChangedTool,
  NormalizedToolDefinition,
  RiskClass,
  ToolManifestEntry,
} from "@traceguard/schemas";

const SENSITIVE_CLASSES = new Set<RiskClass>([
  "trade_like",
  "asset_movement",
  "administrative",
]);

export interface ManifestDiff {
  added: ToolManifestEntry[];
  removed: string[];
  changed: ChangedTool[];
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function diffManifest(
  approved: ToolManifestEntry[],
  observed: NormalizedToolDefinition[],
): ManifestDiff {
  const approvedByName = new Map(approved.map((t) => [t.name, t]));
  const observedByName = new Map(observed.map((t) => [t.name, t]));

  const added: ToolManifestEntry[] = [];
  const changed: ChangedTool[] = [];
  for (const obs of observed) {
    const prev = approvedByName.get(obs.name);
    if (prev === undefined) {
      added.push({ name: obs.name, riskClass: obs.riskClass, schemaHash: obs.schemaHash });
      continue;
    }
    if (prev.schemaHash !== obs.schemaHash || prev.riskClass !== obs.riskClass) {
      const sensitive =
        SENSITIVE_CLASSES.has(prev.riskClass) || SENSITIVE_CLASSES.has(obs.riskClass);
      changed.push({
        name: obs.name,
        previousSchemaHash: prev.schemaHash,
        schemaHash: obs.schemaHash,
        previousRiskClass: prev.riskClass,
        riskClass: obs.riskClass,
        sensitive,
      });
    }
  }

  const removed: string[] = [];
  for (const prev of approved) {
    if (!observedByName.has(prev.name)) removed.push(prev.name);
  }

  added.sort(byName);
  changed.sort(byName);
  removed.sort();
  return { added, removed, changed };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/diff`
Expected: PASS — add / remove / change-sensitivity / escalation / no-op / sorting green.

- [ ] **Step 5: Commit**

```bash
git add packages/tool-manifest/src/diff.ts packages/tool-manifest/src/diff.test.ts
git commit -m "feat(tool-manifest): add manifest diff with sensitivity flags"
```

---

## Task 11: Manifest reconciliation (emit layer, 3 cases)

This is the first emit-layer file: it turns observed upstream tools into a
hash-chained `LedgerEvent[]`, handling the three reconcile cases from spec §6.2 —
(1) first import (no approved baseline), (2) no-op (observed hash equals approved
hash), (3) drift (observed differs). It reuses the Tasks 6–10 pure functions and
the emit-closure pattern from Phase 1B's `authorization-gateway.ts`.

**Files:**
- Create: `packages/tool-manifest/src/reconcile.ts`
- Test: `packages/tool-manifest/src/reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/tool-manifest/src/reconcile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fixedClock, sequentialIdGen } from "@traceguard/testing-fixtures";
import type { RawUpstreamTool } from "@traceguard/schemas";
import { reconcileManifest, type ReconcileDeps } from "./reconcile.js";

function deps(): ReconcileDeps {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: (s: string) => `h:${s}` };
}

function raw(name: string, properties: Record<string, unknown> = {}): RawUpstreamTool {
  return { name, inputSchema: { type: "object", properties } };
}

describe("reconcileManifest — Case 1 (first import)", () => {
  it("emits ToolManifestImported then per-tool defaults", () => {
    const result = reconcileManifest(
      {
        workspaceId: "ws_1",
        providerConnectionId: "pc_1",
        providerType: "bitget_agent_hub",
        toolManifestVersionId: "tmv_1",
        observed: [raw("spot_get_ticker"), raw("withdraw"), raw("mystery_tool")],
      },
      deps(),
    );

    const types = result.events.map((e) => e.eventType);
    expect(types[0]).toBe("ToolManifestImported");
    expect(types.filter((t) => t === "ToolFrozen")).toHaveLength(1);
    expect(types.filter((t) => t === "ToolBlocked")).toHaveLength(1);
  });

  it("hash-chains the emitted events (first link is undefined)", () => {
    const result = reconcileManifest(
      {
        workspaceId: "ws_1",
        providerConnectionId: "pc_1",
        providerType: "bitget_agent_hub",
        toolManifestVersionId: "tmv_1",
        observed: [raw("spot_get_ticker"), raw("withdraw")],
      },
      deps(),
    );

    expect(result.events[0].previousEventHash).toBeUndefined();
    expect(result.events[1].previousEventHash).toBe(result.events[0].eventHash);
  });

  it("tags the manifest event on tool_manifest and tool events on tool_definition", () => {
    const result = reconcileManifest(
      {
        workspaceId: "ws_1",
        providerConnectionId: "pc_1",
        providerType: "bitget_agent_hub",
        toolManifestVersionId: "tmv_1",
        observed: [raw("withdraw")],
      },
      deps(),
    );

    expect(result.events[0].aggregateType).toBe("tool_manifest");
    expect(result.events[0].aggregateId).toBe("tmv_1");
    expect(result.events[1].aggregateType).toBe("tool_definition");
    expect(result.events[1].aggregateId).toBe("pc_1:withdraw");
  });
});

describe("reconcileManifest — Case 2 (no-op)", () => {
  it("emits nothing when the observed hash matches the approved hash", () => {
    const first = reconcileManifest(
      {
        workspaceId: "ws_1",
        providerConnectionId: "pc_1",
        providerType: "bitget_agent_hub",
        toolManifestVersionId: "tmv_1",
        observed: [raw("spot_get_ticker"), raw("withdraw")],
      },
      deps(),
    );

    const second = reconcileManifest(
      {
        workspaceId: "ws_1",
        providerConnectionId: "pc_1",
        providerType: "bitget_agent_hub",
        toolManifestVersionId: "tmv_2",
        observed: [raw("spot_get_ticker"), raw("withdraw")],
        approved: {
          manifestHash: first.manifestHash,
          tools: first.normalized.map((d) => ({
            name: d.name,
            riskClass: d.riskClass,
            schemaHash: d.schemaHash,
          })),
        },
      },
      deps(),
    );

    expect(second.events).toHaveLength(0);
  });
});

describe("reconcileManifest — Case 3 (drift)", () => {
  it("emits ToolManifestChanged plus freeze/block for the delta", () => {
    const result = reconcileManifest(
      {
        workspaceId: "ws_1",
        providerConnectionId: "pc_1",
        providerType: "bitget_agent_hub",
        toolManifestVersionId: "tmv_2",
        observed: [raw("withdraw", { coin: { type: "string" } }), raw("manage_subaccounts")],
        approved: {
          manifestHash: "h:stale",
          tools: [{ name: "withdraw", riskClass: "asset_movement", schemaHash: "h:old" }],
        },
      },
      deps(),
    );

    const types = result.events.map((e) => e.eventType);
    expect(types[0]).toBe("ToolManifestChanged");
    expect(types).toContain("ToolFrozen");
    expect(types).toContain("ToolBlocked");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/reconcile`
Expected: FAIL — `Cannot find module './reconcile.js'`.

- [ ] **Step 3: Write the reconciler**

Create `packages/tool-manifest/src/reconcile.ts`:

```ts
import {
  ToolBlockedPayload,
  ToolFrozenPayload,
  ToolManifestChangedPayload,
  ToolManifestImportedPayload,
  type ActorType,
  type AggregateType,
  type LedgerEvent,
  type NormalizedToolDefinition,
  type ProviderType,
  type RawUpstreamTool,
  type ToolManifestEntry,
} from "@traceguard/schemas";
import { makeEvent, type Clock, type IdGen } from "@traceguard/event-ledger";
import { NORMALIZATION_VERSION } from "./normalization-version.js";
import { normalizeToolDefinition } from "./normalize.js";
import { computeManifestHash, manifestFingerprint } from "./manifest-hash.js";
import { diffManifest } from "./diff.js";

export interface ReconcileDeps {
  clock: Clock;
  newId: IdGen;
  hash: (input: string) => string;
}

export interface ApprovedManifest {
  manifestHash: string;
  tools: ToolManifestEntry[];
}

export interface ReconcileManifestArgs {
  workspaceId: string;
  providerConnectionId: string;
  providerType: ProviderType;
  toolManifestVersionId: string;
  observed: RawUpstreamTool[];
  approved?: ApprovedManifest;
  previousEventHash?: string | null;
}

export interface ReconcileResult {
  events: LedgerEvent[];
  manifestHash: string;
  normalized: NormalizedToolDefinition[];
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function reconcileManifest(
  args: ReconcileManifestArgs,
  deps: ReconcileDeps,
): ReconcileResult {
  const identity = {
    providerConnectionId: args.providerConnectionId,
    providerType: args.providerType,
  };
  const normalized = args.observed.map((t) =>
    normalizeToolDefinition(t, identity, { hash: deps.hash }),
  );
  const manifestHash = computeManifestHash(normalized, { hash: deps.hash });
  const sorted = [...normalized].sort(byName);

  const events: LedgerEvent[] = [];
  let previousEventHash: string | null = args.previousEventHash ?? null;

  function emit<TPayload>(
    aggregateType: AggregateType,
    aggregateId: string,
    eventType: string,
    actorType: ActorType,
    payload: TPayload,
  ): void {
    const event = makeEvent(
      {
        workspaceId: args.workspaceId,
        aggregateType,
        aggregateId,
        eventType,
        eventVersion: 1,
        schemaVersion: 1,
        actorType,
        payload,
        previousEventHash,
      },
      deps,
    );
    events.push(event);
    previousEventHash = event.eventHash;
  }

  const toolAggregateId = (name: string): string =>
    `${args.providerConnectionId}:${name}`;

  function fanOutClassDefaults(def: NormalizedToolDefinition): void {
    if (def.riskClass === "unknown") {
      emit(
        "tool_definition",
        toolAggregateId(def.name),
        "ToolFrozen",
        "system",
        ToolFrozenPayload.parse({
          providerConnectionId: args.providerConnectionId,
          toolName: def.name,
          manifestHash,
          reasonCode: "unknown_risk",
        }),
      );
      return;
    }
    if (def.riskClass === "asset_movement" || def.riskClass === "administrative") {
      emit(
        "tool_definition",
        toolAggregateId(def.name),
        "ToolBlocked",
        "system",
        ToolBlockedPayload.parse({
          providerConnectionId: args.providerConnectionId,
          toolName: def.name,
          riskClass: def.riskClass,
          manifestHash,
          reasonCode: "risk_class_default",
        }),
      );
    }
  }

  // Case 2: no-op — observed manifest matches the approved baseline.
  if (args.approved !== undefined && args.approved.manifestHash === manifestHash) {
    return { events, manifestHash, normalized };
  }

  // Case 1: first import — no approved baseline yet.
  if (args.approved === undefined) {
    emit(
      "tool_manifest",
      args.toolManifestVersionId,
      "ToolManifestImported",
      "system",
      ToolManifestImportedPayload.parse({
        toolManifestVersionId: args.toolManifestVersionId,
        providerConnectionId: args.providerConnectionId,
        manifestHash,
        normalizationVersion: NORMALIZATION_VERSION,
        tools: sorted.map(manifestFingerprint),
      }),
    );
    sorted.forEach(fanOutClassDefaults);
    return { events, manifestHash, normalized };
  }

  // Case 3: drift — observed differs from the approved baseline.
  const diff = diffManifest(args.approved.tools, normalized);
  emit(
    "tool_manifest",
    args.toolManifestVersionId,
    "ToolManifestChanged",
    "system",
    ToolManifestChangedPayload.parse({
      toolManifestVersionId: args.toolManifestVersionId,
      providerConnectionId: args.providerConnectionId,
      previousManifestHash: args.approved.manifestHash,
      manifestHash,
      added: diff.added,
      removed: diff.removed,
      changed: diff.changed,
    }),
  );

  const byNameMap = new Map(sorted.map((d) => [d.name, d]));

  for (const change of diff.changed) {
    if (change.sensitive) {
      emit(
        "tool_definition",
        toolAggregateId(change.name),
        "ToolFrozen",
        "system",
        ToolFrozenPayload.parse({
          providerConnectionId: args.providerConnectionId,
          toolName: change.name,
          manifestHash,
          reasonCode: "changed_sensitive",
        }),
      );
    }
  }

  for (const added of diff.added) {
    const def = byNameMap.get(added.name);
    if (def !== undefined) fanOutClassDefaults(def);
  }

  return { events, manifestHash, normalized };
}
```

> **Why `deps` is passed straight to `makeEvent`:** `makeEvent`'s second
> parameter is typed `{ clock: Clock; newId: IdGen }`. Passing the wider
> `ReconcileDeps` (which also carries `hash`) is allowed because `deps` is a
> variable, not an object literal — TypeScript's excess-property check only
> fires on literals. This matches how `authorization-gateway.ts` threads its
> `{ clock, newId, hash }` deps into `makeEvent`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/reconcile`
Expected: PASS — all three reconcile cases, the hash-chain, and aggregate tagging green.

- [ ] **Step 5: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: PASS — confirms `ToolManifestEntry` / `ChangedTool` / `manifestFingerprint` / `diffManifest` signatures line up across Tasks 4 / 8 / 9 / 10 / 11.

- [ ] **Step 6: Commit**

```bash
git add packages/tool-manifest/src/reconcile.ts packages/tool-manifest/src/reconcile.test.ts
git commit -m "feat(tool-manifest): add manifest reconciliation emit layer"
```

---

## Task 12: Manifest approval + package barrel

`approveToolManifest` emits the single human-authored event that promotes an
observed manifest hash into the approved baseline — the only island event with a
`user` actor. This task also finalizes the package barrel so
`@traceguard/tool-manifest` exports its full public surface.

**Files:**
- Create: `packages/tool-manifest/src/approve.ts`
- Test: `packages/tool-manifest/src/approve.test.ts`
- Modify: `packages/tool-manifest/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/tool-manifest/src/approve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fixedClock, sequentialIdGen } from "@traceguard/testing-fixtures";
import { approveToolManifest, type ApproveDeps } from "./approve.js";

function deps(): ApproveDeps {
  return { clock: fixedClock(), newId: sequentialIdGen() };
}

describe("approveToolManifest", () => {
  it("emits a user-authored ToolManifestApproved event", () => {
    const event = approveToolManifest(
      {
        workspaceId: "ws_1",
        providerConnectionId: "pc_1",
        toolManifestVersionId: "tmv_1",
        manifestHash: "h:approved",
        approvedBy: "user_42",
      },
      deps(),
    );

    expect(event.eventType).toBe("ToolManifestApproved");
    expect(event.aggregateType).toBe("tool_manifest");
    expect(event.aggregateId).toBe("tmv_1");
    expect(event.actorType).toBe("user");
    expect(event.actorId).toBe("user_42");
  });

  it("stamps approvedAt from the injected clock", () => {
    const event = approveToolManifest(
      {
        workspaceId: "ws_1",
        providerConnectionId: "pc_1",
        toolManifestVersionId: "tmv_1",
        manifestHash: "h:approved",
        approvedBy: "user_42",
      },
      deps(),
    );

    expect((event.payload as { approvedAt: string }).approvedAt).toBe(
      "2026-06-08T00:00:00.000Z",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/approve`
Expected: FAIL — `Cannot find module './approve.js'`.

- [ ] **Step 3: Write the approver**

Create `packages/tool-manifest/src/approve.ts`:

```ts
import { ToolManifestApprovedPayload, type LedgerEvent } from "@traceguard/schemas";
import { makeEvent, type Clock, type IdGen } from "@traceguard/event-ledger";

export interface ApproveDeps {
  clock: Clock;
  newId: IdGen;
}

export interface ApproveToolManifestArgs {
  workspaceId: string;
  providerConnectionId: string;
  toolManifestVersionId: string;
  manifestHash: string;
  approvedBy: string;
  previousEventHash?: string | null;
}

export function approveToolManifest(
  args: ApproveToolManifestArgs,
  deps: ApproveDeps,
): LedgerEvent {
  return makeEvent(
    {
      workspaceId: args.workspaceId,
      aggregateType: "tool_manifest",
      aggregateId: args.toolManifestVersionId,
      eventType: "ToolManifestApproved",
      eventVersion: 1,
      schemaVersion: 1,
      actorType: "user",
      actorId: args.approvedBy,
      payload: ToolManifestApprovedPayload.parse({
        toolManifestVersionId: args.toolManifestVersionId,
        providerConnectionId: args.providerConnectionId,
        manifestHash: args.manifestHash,
        approvedBy: args.approvedBy,
        approvedAt: deps.clock.now(),
      }),
      previousEventHash: args.previousEventHash ?? null,
    },
    deps,
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/approve`
Expected: PASS — both approval assertions green.

- [ ] **Step 5: Finalize the package barrel**

Replace the contents of `packages/tool-manifest/src/index.ts` with the full public surface:

```ts
export * from "./normalization-version.js";
export * from "./risk-table.js";
export * from "./classify.js";
export * from "./normalize.js";
export * from "./manifest-hash.js";
export * from "./diff.js";
export * from "./reconcile.js";
export * from "./approve.js";
```

- [ ] **Step 6: Run the full package suite + typecheck**

Run: `pnpm test packages/tool-manifest`
Expected: PASS — every island test (normalization-version, risk-table, classify, normalize, manifest-hash, diff, reconcile, approve) green.

Run: `pnpm typecheck`
Expected: PASS — the finalized barrel re-exports resolve with no duplicate-symbol errors.

- [ ] **Step 7: Commit**

```bash
git add packages/tool-manifest/src/approve.ts packages/tool-manifest/src/approve.test.ts packages/tool-manifest/src/index.ts
git commit -m "feat(tool-manifest): add manifest approval and finalize barrel"
```

---

## Task 13: 36-tool Bitget `RawUpstreamTool` fixture

The fixture is the canonical input that every downstream test (the golden hash,
future projection tests, and 3B integration) reconciles against. Its schemas are
deliberately concrete and deterministic so the manifest hash is reproducible.
Per refinement #4, the read tools carry only non-sensitive inputs (notably
`get_deposit_address` → `{ coin }`), so recognition + raise rules yield exactly
the locked 13/10/9/3/1 base distribution.

**Files:**
- Create: `packages/testing-fixtures/src/bitget-tools.ts`
- Modify: `packages/testing-fixtures/src/index.ts`
- Test: `packages/testing-fixtures/src/bitget-tools.test.ts`

- [ ] **Step 1: Write the failing sanity test**

Create `packages/testing-fixtures/src/bitget-tools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bitget36RawTools } from "./bitget-tools.js";

describe("bitget36RawTools", () => {
  it("contains exactly 36 tools", () => {
    expect(bitget36RawTools).toHaveLength(36);
  });

  it("has unique tool names", () => {
    const names = new Set(bitget36RawTools.map((t) => t.name));
    expect(names.size).toBe(36);
  });

  it("gives every tool an object inputSchema", () => {
    for (const t of bitget36RawTools) {
      expect(t.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("keeps get_deposit_address input to a single non-sensitive field", () => {
    const dep = bitget36RawTools.find((t) => t.name === "get_deposit_address");
    expect(dep?.inputSchema).toEqual({ type: "object", properties: { coin: { type: "string" } } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test bitget-tools`
Expected: FAIL — `Cannot find module './bitget-tools.js'`.

- [ ] **Step 3: Write the fixture**

Create `packages/testing-fixtures/src/bitget-tools.ts`:

```ts
import type { RawUpstreamTool } from "@traceguard/schemas";

function obj(properties: Record<string, unknown>): { type: "object"; properties: Record<string, unknown> } {
  return { type: "object", properties };
}

const str = { type: "string" } as const;
const num = { type: "number" } as const;

export const bitget36RawTools: RawUpstreamTool[] = [
  // public_read (13)
  { name: "spot_get_ticker", inputSchema: obj({ symbol: str }) },
  { name: "spot_get_depth", inputSchema: obj({ symbol: str, limit: num }) },
  { name: "spot_get_candles", inputSchema: obj({ symbol: str, granularity: str }) },
  { name: "spot_get_trades", inputSchema: obj({ symbol: str, limit: num }) },
  { name: "spot_get_symbols", inputSchema: obj({}) },
  { name: "futures_get_ticker", inputSchema: obj({ symbol: str, productType: str }) },
  { name: "futures_get_depth", inputSchema: obj({ symbol: str, productType: str, limit: num }) },
  { name: "futures_get_candles", inputSchema: obj({ symbol: str, productType: str, granularity: str }) },
  { name: "futures_get_trades", inputSchema: obj({ symbol: str, productType: str }) },
  { name: "futures_get_contracts", inputSchema: obj({ productType: str }) },
  { name: "futures_get_funding_rate", inputSchema: obj({ symbol: str, productType: str }) },
  { name: "futures_get_open_interest", inputSchema: obj({ symbol: str, productType: str }) },
  { name: "system_get_capabilities", inputSchema: obj({}) },
  // account_read (10) — non-sensitive inputs only (refinement #4)
  { name: "spot_get_orders", inputSchema: obj({ symbol: str, status: str }) },
  { name: "spot_get_fills", inputSchema: obj({ symbol: str, orderId: str }) },
  { name: "spot_get_plan_orders", inputSchema: obj({ symbol: str }) },
  { name: "futures_get_orders", inputSchema: obj({ symbol: str, productType: str, status: str }) },
  { name: "futures_get_fills", inputSchema: obj({ symbol: str, productType: str }) },
  { name: "futures_get_positions", inputSchema: obj({ productType: str, symbol: str }) },
  { name: "get_account_assets", inputSchema: obj({}) },
  { name: "get_account_bills", inputSchema: obj({ coin: str }) },
  { name: "get_transaction_records", inputSchema: obj({ coin: str }) },
  { name: "get_deposit_address", inputSchema: obj({ coin: str }) },
  // trade_like (9) — plain trade schemas, no sensitive fields
  { name: "spot_place_order", inputSchema: obj({ symbol: str, side: str, orderType: str, size: str, price: str }) },
  { name: "spot_cancel_orders", inputSchema: obj({ symbol: str, orderId: str }) },
  { name: "spot_modify_order", inputSchema: obj({ symbol: str, orderId: str, newSize: str, newPrice: str }) },
  { name: "spot_place_plan_order", inputSchema: obj({ symbol: str, side: str, triggerPrice: str, size: str }) },
  { name: "spot_cancel_plan_orders", inputSchema: obj({ symbol: str, orderId: str }) },
  { name: "futures_place_order", inputSchema: obj({ symbol: str, productType: str, side: str, orderType: str, size: str, price: str }) },
  { name: "futures_cancel_orders", inputSchema: obj({ symbol: str, productType: str, orderId: str }) },
  { name: "futures_set_leverage", inputSchema: obj({ symbol: str, productType: str, marginCoin: str, leverage: str }) },
  { name: "futures_update_config", inputSchema: obj({ symbol: str, productType: str, marginMode: str }) },
  // asset_movement (3) — withdraw carries sensitive fields; stays asset_movement under join
  { name: "transfer", inputSchema: obj({ fromAccountType: str, toAccountType: str, coin: str, amount: str }) },
  { name: "withdraw", inputSchema: obj({ coin: str, amount: str, withdrawAddress: str, chain: str }) },
  { name: "cancel_withdrawal", inputSchema: obj({ orderId: str }) },
  // administrative (1) — apiKeyPermissions keeps it administrative under join
  { name: "manage_subaccounts", inputSchema: obj({ action: str, apiKeyPermissions: { type: "array", items: str } }) },
];
```

- [ ] **Step 4: Export from the testing-fixtures barrel**

In `packages/testing-fixtures/src/index.ts`, add (keep existing exports):

```ts
export * from "./bitget-tools.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test bitget-tools`
Expected: PASS — 36 tools, unique names, object schemas, and the `get_deposit_address` single-field guard green.

- [ ] **Step 6: Commit**

```bash
git add packages/testing-fixtures/src/bitget-tools.ts packages/testing-fixtures/src/bitget-tools.test.ts packages/testing-fixtures/src/index.ts
git commit -m "test(fixtures): add 36-tool Bitget raw-tool fixture"
```

---

## Task 14: Golden manifest-hash regression anchor + distribution

This task pins the byte-reproducible manifest hash over the 36-tool fixture using
the real `sha256hex` (not the test stub), and asserts the locked
32-visible / 4-blocked / 0-frozen distribution. The hash is bootstrapped: write a
placeholder, let the test print the actual value, then pin it. After this task,
any change to normalization, the risk table, the classifier, or the fixture that
shifts the manifest hash will fail loudly.

**Files:**
- Modify: `packages/testing-fixtures/src/bitget-tools.ts` (append the pinned hash)
- Test: `packages/tool-manifest/src/bitget-golden.test.ts`

- [ ] **Step 1: Add a placeholder golden constant to the fixture**

Append to `packages/testing-fixtures/src/bitget-tools.ts`:

```ts
// Pinned in Task 14 Step 4 from the failing golden test's printed value.
export const bitgetManifestHashV1 = "PLACEHOLDER_REPLACE_IN_STEP_4";
```

- [ ] **Step 2: Write the golden + distribution test**

Create `packages/tool-manifest/src/bitget-golden.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sha256hex } from "@traceguard/event-ledger";
import { bitget36RawTools, bitgetManifestHashV1 } from "@traceguard/testing-fixtures";
import type { RiskClass } from "@traceguard/schemas";
import { classifyRisk } from "./classify.js";
import { normalizeToolDefinition } from "./normalize.js";
import { computeManifestHash } from "./manifest-hash.js";

const identity = {
  providerConnectionId: "pc_bitget",
  providerType: "bitget_agent_hub" as const,
};

function bucket(rc: RiskClass): "visible" | "blocked" | "frozen" {
  if (rc === "unknown") return "frozen";
  if (rc === "asset_movement" || rc === "administrative") return "blocked";
  return "visible";
}

describe("bitget 36-tool golden manifest", () => {
  it("classifies into the locked 32 visible / 4 blocked / 0 frozen distribution", () => {
    const counts = { visible: 0, blocked: 0, frozen: 0 };
    for (const t of bitget36RawTools) {
      counts[bucket(classifyRisk(t, "bitget_agent_hub"))] += 1;
    }
    expect(counts).toEqual({ visible: 32, blocked: 4, frozen: 0 });
  });

  it("hashes to the pinned golden manifest hash (regression anchor)", () => {
    const normalized = bitget36RawTools.map((t) =>
      normalizeToolDefinition(t, identity, { hash: sha256hex }),
    );
    const manifestHash = computeManifestHash(normalized, { hash: sha256hex });
    expect(manifestHash).toBe(bitgetManifestHashV1);
  });
});
```

- [ ] **Step 3: Run the test — distribution passes, golden fails with the actual hash**

Run: `pnpm test bitget-golden`
Expected: the distribution case PASSES; the golden case FAILS with:
```
- Expected  "PLACEHOLDER_REPLACE_IN_STEP_4"
+ Received  "<64-hex-char sha256>"
```
Copy the received 64-character hash.

- [ ] **Step 4: Pin the real hash**

In `packages/testing-fixtures/src/bitget-tools.ts`, replace the placeholder with the captured value:

```ts
export const bitgetManifestHashV1 = "<paste the 64-char sha256 from Step 3>";
```

- [ ] **Step 5: Re-run to verify it passes**

Run: `pnpm test bitget-golden`
Expected: PASS — both the distribution and the golden regression anchor green.

- [ ] **Step 6: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: PASS — the cross-package golden test resolves `@traceguard/event-ledger`, `@traceguard/testing-fixtures`, and the in-package functions.

- [ ] **Step 7: Commit**

```bash
git add packages/testing-fixtures/src/bitget-tools.ts packages/tool-manifest/src/bitget-golden.test.ts
git commit -m "test(tool-manifest): pin golden Bitget manifest hash + distribution"
```

---

## Task 15: Tool-manifest replay projection

The projection folds the discovery event stream into a `ToolInventoryView` — the
queryable "current state of every tool" that 3B's gateway and the demo UI read.
It lives in `@traceguard/event-ledger` (alongside the other projections) and
re-derives the class-default status locally so event-ledger stays independent of
`@traceguard/tool-manifest` (the dependency only runs the other way). It mirrors
the reducer + replay-test shape of `authorization-projection.ts`.

**Files:**
- Create: `packages/event-ledger/src/tool-manifest-projection.ts`
- Modify: `packages/event-ledger/src/index.ts`
- Test: `packages/event-ledger/src/tool-manifest-projection.test.ts`

- [ ] **Step 1: Write the failing replay test**

Create `packages/event-ledger/src/tool-manifest-projection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { LedgerEvent } from "@traceguard/schemas";
import { toolManifestProjection } from "./tool-manifest-projection.js";

function ev(
  eventType: string,
  payload: unknown,
  aggregateType: "tool_manifest" | "tool_definition" = "tool_manifest",
): LedgerEvent {
  return {
    id: `evt_${eventType}`,
    workspaceId: "ws_1",
    aggregateType,
    aggregateId: "tmv_1",
    eventType,
    eventVersion: 1,
    schemaVersion: 1,
    occurredAt: "2026-06-08T00:00:00.000Z",
    recordedAt: "2026-06-08T00:00:00.000Z",
    actorType: "system",
    payload,
    payloadHash: "ph",
    eventHash: `eh_${eventType}`,
  };
}

const importEvent = ev("ToolManifestImported", {
  toolManifestVersionId: "tmv_1",
  providerConnectionId: "pc_1",
  manifestHash: "h:m1",
  normalizationVersion: 1,
  tools: [
    { name: "spot_get_ticker", riskClass: "public_read", schemaHash: "s1" },
    { name: "withdraw", riskClass: "asset_movement", schemaHash: "s2" },
    { name: "mystery", riskClass: "unknown", schemaHash: "s3" },
  ],
});

describe("toolManifestProjection", () => {
  it("returns an empty inventory for an empty stream", () => {
    const view = toolManifestProjection([]);
    expect(view.tools).toEqual([]);
    expect(view.manifestHash).toBeUndefined();
  });

  it("materializes per-class default statuses from an import", () => {
    const view = toolManifestProjection([importEvent]);
    expect(view.providerConnectionId).toBe("pc_1");
    expect(view.manifestHash).toBe("h:m1");
    expect(view.normalizationVersion).toBe(1);
    const byName = Object.fromEntries(view.tools.map((t) => [t.name, t]));
    expect(byName.spot_get_ticker).toMatchObject({ status: "active", visible: true });
    expect(byName.withdraw).toMatchObject({ status: "blocked", visible: false });
    expect(byName.mystery).toMatchObject({ status: "frozen", visible: false });
  });

  it("sorts the materialized tools by name", () => {
    const view = toolManifestProjection([importEvent]);
    expect(view.tools.map((t) => t.name)).toEqual(["mystery", "spot_get_ticker", "withdraw"]);
  });

  it("records a freeze reason from ToolFrozen", () => {
    const frozen = ev(
      "ToolFrozen",
      { providerConnectionId: "pc_1", toolName: "mystery", manifestHash: "h:m1", reasonCode: "unknown_risk" },
      "tool_definition",
    );
    const view = toolManifestProjection([importEvent, frozen]);
    expect(view.tools.find((t) => t.name === "mystery")).toMatchObject({
      status: "frozen",
      freezeReason: "unknown_risk",
    });
  });

  it("removes a tool on a ToolManifestChanged removal", () => {
    const changed = ev("ToolManifestChanged", {
      toolManifestVersionId: "tmv_2",
      providerConnectionId: "pc_1",
      previousManifestHash: "h:m1",
      manifestHash: "h:m2",
      added: [],
      removed: ["withdraw"],
      changed: [],
    });
    const view = toolManifestProjection([importEvent, changed]);
    expect(view.manifestHash).toBe("h:m2");
    expect(view.tools.find((t) => t.name === "withdraw")).toBeUndefined();
  });

  it("adds a blocked tool on a ToolManifestChanged addition", () => {
    const changed = ev("ToolManifestChanged", {
      toolManifestVersionId: "tmv_2",
      providerConnectionId: "pc_1",
      previousManifestHash: "h:m1",
      manifestHash: "h:m2",
      added: [{ name: "transfer", riskClass: "asset_movement", schemaHash: "s9" }],
      removed: [],
      changed: [],
    });
    const view = toolManifestProjection([importEvent, changed]);
    expect(view.tools.find((t) => t.name === "transfer")).toMatchObject({
      status: "blocked",
      visible: false,
    });
  });

  it("freezes a sensitive change, then releases it to class default on approval", () => {
    const changed = ev("ToolManifestChanged", {
      toolManifestVersionId: "tmv_2",
      providerConnectionId: "pc_1",
      previousManifestHash: "h:m1",
      manifestHash: "h:m2",
      added: [],
      removed: [],
      changed: [{ name: "withdraw", previousSchemaHash: "s2", schemaHash: "s2b", sensitive: true }],
    });
    const frozen = ev(
      "ToolFrozen",
      { providerConnectionId: "pc_1", toolName: "withdraw", manifestHash: "h:m2", reasonCode: "changed_sensitive" },
      "tool_definition",
    );
    const afterFreeze = toolManifestProjection([importEvent, changed, frozen]);
    expect(afterFreeze.tools.find((t) => t.name === "withdraw")).toMatchObject({
      status: "frozen",
      freezeReason: "changed_sensitive",
    });

    const approved = ev("ToolManifestApproved", {
      toolManifestVersionId: "tmv_2",
      providerConnectionId: "pc_1",
      manifestHash: "h:m2",
      approvedBy: "user_1",
      approvedAt: "2026-06-08T00:00:00.000Z",
    });
    const afterApprove = toolManifestProjection([importEvent, changed, frozen, approved]);
    expect(afterApprove.approvedManifestHash).toBe("h:m2");
    expect(afterApprove.tools.find((t) => t.name === "withdraw")).toMatchObject({
      status: "blocked",
      freezeReason: undefined,
    });
  });

  it("keeps an unknown-risk freeze frozen across approval", () => {
    const frozen = ev(
      "ToolFrozen",
      { providerConnectionId: "pc_1", toolName: "mystery", manifestHash: "h:m1", reasonCode: "unknown_risk" },
      "tool_definition",
    );
    const approved = ev("ToolManifestApproved", {
      toolManifestVersionId: "tmv_1",
      providerConnectionId: "pc_1",
      manifestHash: "h:m1",
      approvedBy: "user_1",
      approvedAt: "2026-06-08T00:00:00.000Z",
    });
    const view = toolManifestProjection([importEvent, frozen, approved]);
    expect(view.tools.find((t) => t.name === "mystery")).toMatchObject({
      status: "frozen",
      freezeReason: "unknown_risk",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tool-manifest-projection`
Expected: FAIL — `Cannot find module './tool-manifest-projection.js'`.

- [ ] **Step 3: Write the projection**

Create `packages/event-ledger/src/tool-manifest-projection.ts`:

```ts
import type { LedgerEvent, RiskClass } from "@traceguard/schemas";

export type ToolStatus = "active" | "blocked" | "frozen";

export interface ToolInventoryEntry {
  name: string;
  riskClass: RiskClass;
  schemaHash: string;
  status: ToolStatus;
  visible: boolean;
  freezeReason?: string;
}

export interface ToolInventoryView {
  providerConnectionId?: string;
  manifestHash?: string;
  approvedManifestHash?: string;
  normalizationVersion?: number;
  tools: ToolInventoryEntry[];
}

interface RawEntry {
  name: string;
  riskClass: RiskClass;
  schemaHash: string;
}

interface RawChanged {
  name: string;
  schemaHash?: string;
  riskClass?: RiskClass;
}

function asRecord(payload: unknown): Record<string, unknown> | undefined {
  return payload !== null && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : undefined;
}

function asString(payload: unknown, key: string): string | undefined {
  const value = asRecord(payload)?.[key];
  return typeof value === "string" ? value : undefined;
}

function asNumber(payload: unknown, key: string): number | undefined {
  const value = asRecord(payload)?.[key];
  return typeof value === "number" ? value : undefined;
}

function readToolEntries(payload: unknown, key: string): RawEntry[] {
  const value = asRecord(payload)?.[key];
  if (!Array.isArray(value)) return [];
  const out: RawEntry[] = [];
  for (const item of value) {
    const name = asString(item, "name");
    const riskClass = asString(item, "riskClass");
    const schemaHash = asString(item, "schemaHash");
    if (name !== undefined && riskClass !== undefined && schemaHash !== undefined) {
      out.push({ name, riskClass: riskClass as RiskClass, schemaHash });
    }
  }
  return out;
}

function readStringArray(payload: unknown, key: string): string[] {
  const value = asRecord(payload)?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

function readChangedEntries(payload: unknown, key: string): RawChanged[] {
  const value = asRecord(payload)?.[key];
  if (!Array.isArray(value)) return [];
  const out: RawChanged[] = [];
  for (const item of value) {
    const name = asString(item, "name");
    if (name === undefined) continue;
    const riskClass = asString(item, "riskClass");
    out.push({
      name,
      schemaHash: asString(item, "schemaHash"),
      riskClass: riskClass as RiskClass | undefined,
    });
  }
  return out;
}

function classDefault(riskClass: RiskClass): ToolStatus {
  if (riskClass === "asset_movement" || riskClass === "administrative") return "blocked";
  if (riskClass === "unknown") return "frozen";
  return "active";
}

function toEntry(name: string, riskClass: RiskClass, schemaHash: string): ToolInventoryEntry {
  const status = classDefault(riskClass);
  return { name, riskClass, schemaHash, status, visible: status === "active" };
}

export function toolManifestProjection(events: LedgerEvent[]): ToolInventoryView {
  const tools = new Map<string, ToolInventoryEntry>();
  const view: ToolInventoryView = { tools: [] };

  for (const e of events) {
    switch (e.eventType) {
      case "ToolManifestImported": {
        tools.clear();
        view.providerConnectionId =
          asString(e.payload, "providerConnectionId") ?? view.providerConnectionId;
        view.manifestHash = asString(e.payload, "manifestHash") ?? view.manifestHash;
        view.normalizationVersion =
          asNumber(e.payload, "normalizationVersion") ?? view.normalizationVersion;
        for (const t of readToolEntries(e.payload, "tools")) {
          tools.set(t.name, toEntry(t.name, t.riskClass, t.schemaHash));
        }
        break;
      }
      case "ToolBlocked": {
        const name = asString(e.payload, "toolName");
        if (name === undefined) break;
        const entry = tools.get(name);
        if (entry !== undefined) {
          entry.status = "blocked";
          entry.visible = false;
        }
        break;
      }
      case "ToolFrozen": {
        const name = asString(e.payload, "toolName");
        if (name === undefined) break;
        const entry = tools.get(name);
        if (entry !== undefined) {
          entry.status = "frozen";
          entry.visible = false;
          entry.freezeReason = asString(e.payload, "reasonCode");
        }
        break;
      }
      case "ToolManifestChanged": {
        view.manifestHash = asString(e.payload, "manifestHash") ?? view.manifestHash;
        view.normalizationVersion =
          asNumber(e.payload, "normalizationVersion") ?? view.normalizationVersion;
        for (const name of readStringArray(e.payload, "removed")) {
          tools.delete(name);
        }
        for (const t of readToolEntries(e.payload, "added")) {
          tools.set(t.name, toEntry(t.name, t.riskClass, t.schemaHash));
        }
        for (const c of readChangedEntries(e.payload, "changed")) {
          const entry = tools.get(c.name);
          if (entry === undefined) continue;
          if (c.schemaHash !== undefined) entry.schemaHash = c.schemaHash;
          if (c.riskClass !== undefined) entry.riskClass = c.riskClass;
          entry.status = classDefault(entry.riskClass);
          entry.visible = entry.status === "active";
          delete entry.freezeReason;
        }
        break;
      }
      case "ToolManifestApproved": {
        view.approvedManifestHash =
          asString(e.payload, "manifestHash") ?? view.approvedManifestHash;
        for (const entry of tools.values()) {
          if (entry.status === "frozen" && entry.freezeReason === "changed_sensitive") {
            entry.status = classDefault(entry.riskClass);
            entry.visible = entry.status === "active";
            delete entry.freezeReason;
          }
        }
        break;
      }
      default:
        break;
    }
  }

  view.tools = [...tools.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  return view;
}
```

> **Why class-default is re-derived here, not imported:** `@traceguard/tool-manifest`
> depends on `@traceguard/event-ledger`, so event-ledger must not import back from
> the island (that would be a cycle). The status defaults (asset_movement /
> administrative → blocked; unknown → frozen) are a small, stable rule re-stated
> locally — the manifest hash and the per-tool events remain the single source of
> truth for *which* class each tool is.

- [ ] **Step 4: Export from the event-ledger barrel**

In `packages/event-ledger/src/index.ts`, add (keep existing exports):

```ts
export * from "./tool-manifest-projection.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test tool-manifest-projection`
Expected: PASS — empty stream, import materialization, sorting, freeze-reason capture, removal, addition, sensitive-change → freeze → approval-release, and unknown-risk persistence all green.

- [ ] **Step 6: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: PASS — `RiskClass` resolves from schemas; no import of `@traceguard/tool-manifest` (no cycle).

- [ ] **Step 7: Commit**

```bash
git add packages/event-ledger/src/tool-manifest-projection.ts packages/event-ledger/src/tool-manifest-projection.test.ts packages/event-ledger/src/index.ts
git commit -m "feat(event-ledger): add tool-manifest inventory projection"
```

---

## Task 16: Documentation coherence sync

The two contract docs must match the implemented event catalog, classifier, and
projection exactly — no stale shapes. This is a coherence task: read each doc,
then align it to the canonical facts below, adding the two event sections that
the earlier draft omitted (`ToolBlocked`, `ToolManifestApproved`). No code, no
tests.

**Files:**
- Modify: `docs/event-model.md`
- Modify: `docs/mcp-gateway-contract.md`

- [ ] **Step 1: Read both docs to locate the relevant sections**

Read `docs/event-model.md` (tool-discovery events live around §6.4–6.6 and the
projection around §8.3) and `docs/mcp-gateway-contract.md` (tool discovery §7,
risk classification §8, event catalog §16.1). Note every place that describes a
tool-discovery event, the manifest hash, the classifier, or the tool projection.

- [ ] **Step 2: Align `docs/event-model.md` to the canonical event catalog**

Ensure the doc documents **exactly these five** tool-discovery events, each with
the aggregate, actor, and payload fields shown. Add any that are missing
(`ToolBlocked` and `ToolManifestApproved` were not in the earlier draft); correct
any field that drifted:

```
ToolManifestImported   aggregate=tool_manifest    actor=system
  payload: toolManifestVersionId, providerConnectionId, manifestHash,
           normalizationVersion, tools[] = { name, riskClass, schemaHash }

ToolManifestChanged    aggregate=tool_manifest    actor=system
  payload: toolManifestVersionId, providerConnectionId, previousManifestHash,
           manifestHash, added[] = ToolManifestEntry, removed[] = string,
           changed[] = { name, previousSchemaHash?, schemaHash?,
                         previousRiskClass?, riskClass?, sensitive }

ToolFrozen             aggregate=tool_definition  actor=system
  payload: providerConnectionId, toolName, manifestHash,
           reasonCode ∈ { changed_sensitive, unknown_risk }

ToolBlocked            aggregate=tool_definition  actor=system
  payload: providerConnectionId, toolName, riskClass, manifestHash,
           reasonCode ∈ { risk_class_default, operator_blocklist }

ToolManifestApproved   aggregate=tool_manifest    actor=user
  payload: toolManifestVersionId, providerConnectionId, manifestHash,
           approvedBy, approvedAt
```

- [ ] **Step 3: Align the §8.3 tool projection section to `ToolInventoryView`**

Make the projection section describe the implemented shape (from Task 15):

```
ToolInventoryView:
  providerConnectionId?, manifestHash?, approvedManifestHash?,
  normalizationVersion?,
  tools[]: { name, riskClass, schemaHash,
             status ∈ { active, blocked, frozen }, visible, freezeReason? }

Status defaults (re-derived in the projection):
  asset_movement | administrative -> blocked
  unknown                         -> frozen
  otherwise                       -> active
Approval semantics:
  ToolManifestApproved releases changed_sensitive freezes back to the
  class default; unknown_risk freezes persist across approval.
```

- [ ] **Step 4: Align `docs/mcp-gateway-contract.md` §7–8 to the implemented classifier + hash**

The doc must state these canonical facts; correct anything that contradicts them:

```
Normalized tool definition (§7.2):
  { providerConnectionId, providerType, name, title?, description?,
    inputSchema, outputSchema?, annotations?, normalizedJson, schemaHash, riskClass }

Manifest hash (§7.3):
  manifestHash = sha256hex(canonicalJson({
    normalizationVersion,
    tools: sortByName([{ name, riskClass, schemaHash }])
  }))
  - order-independent over the tool list
  - changes iff any tool's (name, riskClass, schemaHash) changes,
    a tool is added/removed, or normalizationVersion bumps

Tool visibility (§7.4):
  visible  = status active  (public_read | account_read | trade_like defaults)
  blocked  = asset_movement | administrative defaults, or operator blocklist
  frozen   = unknown risk, or a pending sensitive-change review

Risk classification — Approach B (§8): two orthogonal axes.
  Recognition: base-table lookup by (providerType, name). A miss ->
    riskClass = unknown -> freeze, and the raise rules are short-circuited.
  Severity lattice (low -> high):
    public_read < account_read < trade_like < asset_movement < administrative
  Classification = joinRisk (lattice max) of the base class and every raise
    rule. Raise-only: a rule may raise severity, never lower it (guaranteed
    structurally by the join).
  Raise rules:
    - sensitive schema field: address | withdrawAddress | chain -> asset_movement;
      apiKeyPassphrase | apiKeyPermissions | apiKeyIp -> administrative
    - write annotation: destructiveHint=true | readOnlyHint=false -> trade_like
    - danger tag in title/description: [DANGER] -> asset_movement; [CAUTION] -> trade_like

Bitget base table (§8) — 36 tools, distribution 13 / 10 / 9 / 3 / 1:
  public_read (13), account_read (10), trade_like (9),
  asset_movement (3), administrative (1)
  => 32 visible, 4 blocked, 0 frozen at the locked baseline.
```

- [ ] **Step 5: Align the §16.1 event catalog and sweep for stale terms**

Ensure §16.1 lists the same five events from Step 2. Then grep both docs for
shapes that the implementation does **not** use, and fix or remove each hit:

Run: `grep -nE "risk score|riskScore|ToolDiscovered|ToolManifestRejected|riskLevel" docs/event-model.md docs/mcp-gateway-contract.md`
Expected: no matches. (The contract uses a `riskClass` enum and the five event
names above — not a numeric score, and not `ToolDiscovered` / `ToolManifestRejected`.)
If any line matches, rewrite it to the canonical `riskClass` / event-name form.

- [ ] **Step 6: Commit**

```bash
git add docs/event-model.md docs/mcp-gateway-contract.md
git commit -m "docs: sync event-model and gateway-contract with 3A classification"
```

---

## Done — full-suite gate

After Task 16, run the whole suite and typecheck once more as a final gate:

- [ ] Run: `pnpm test`
  Expected: PASS — all packages green, including the fast-check property test and the golden regression anchor.
- [ ] Run: `pnpm typecheck`
  Expected: PASS — the seven-package project graph builds clean.

This plan is complete: the pure island (`normalize` / `classify` / `manifest-hash`
/ `diff`), the emit layer (`reconcile` / `approve`), the schemas, the 36-tool
fixture with a pinned golden hash, the replay projection, and the doc coherence
sync are all covered, each behind a failing-test-first step.
