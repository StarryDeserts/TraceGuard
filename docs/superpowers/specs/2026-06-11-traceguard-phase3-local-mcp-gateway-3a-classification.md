# TraceGuard — Phase 3 (3A): Tool Manifest & Risk Classification Design

- **Status:** Approved (design), ready for implementation planning
- **Date:** 2026-06-11
- **Scope:** Phase 3 sub-project **3A** — the pure functional core of the Local MCP Gateway's
  tool-discovery path. Given an in-memory list of raw upstream MCP tools, **normalize** each tool
  into a canonical definition, **fingerprint** it (schema hash + manifest hash), **classify** its
  risk, **diff** an observed manifest against an approved baseline, and **reconcile** that diff
  into hash-chained ledger events (`ToolManifestImported` / `ToolManifestChanged` / `ToolFrozen` /
  `ToolBlocked` / `ToolManifestApproved`) plus a `toolManifestProjection` that folds those events
  into a tool-inventory view with visibility. 3A is **transport-free and store-free**: no stdio
  server, no upstream MCP client, no persistence wiring.
- **Source of truth:** `docs/mcp-gateway-contract.md` (§7 Tool Discovery, §8 Risk Classification,
  §16.1 Tool Discovery Events), `docs/architecture.md`, `docs/event-model.md`. Where this spec
  restates a canonical type or rule, the canonical doc wins; section references are given so drift
  can be detected.
- **Builds on:** Spec 1A + 1B + 2 (merged on `main`). 3A reuses the functional-core /
  imperative-shell split, injected `clock` / `newId` / `hash` dependencies, hash-chained
  `makeEvent`, the `canonicalJson` canonicalizer, `LedgerEvent`, and the projection-fold pattern
  (`authorizationProjection` / `runStatusProjection`) — the safety-decision core
  (authorize / settle / policy-gate / orchestrator) is unchanged and untouched.

---

## 1. Context and goal

TraceGuard's central invariant is `Proposal ≠ Authorization ≠ Execution`, fail-closed /
default-deny. Phases 1A–2 built the **decision and execution** core: an agent proposal is
classified, turned into a single-use authorization, and burned exactly once to drive a (simulated)
execution — all as an immutable, hash-chained event stream. That core assumes a *known* action
against a *known* tool surface.

Phase 3 (the Local MCP Gateway) is the layer that puts a real MCP client and a real upstream
exchange (`bitget-mcp-server`) in front of that core. Before the gateway can route a single
`tools/call`, it must answer a prior question: **what tools does the upstream expose, and how
dangerous is each one?** A trading agent that can silently gain a `withdraw` tool — or whose
`spot_get_ticker` is silently swapped for something that moves funds — defeats the entire safety
runtime. 3A is that gatekeeper: it turns an opaque upstream tool list into a **classified,
fingerprinted, drift-detected manifest** recorded in the ledger, so that 3B–3E can build discovery,
routing, and approval on top of a surface TraceGuard has already reasoned about.

3A is deliberately the **pure core** of that gatekeeper. It performs no I/O: its input is an
in-memory `RawUpstreamTool[]` (which 3B will later source from a live `tools/list` over stdio) and
its output is `LedgerEvent[]` + a projection. This keeps every classification and fingerprinting
rule unit-testable and byte-reproducible without a running upstream, exactly as the Phase 1/2 pure
functions are testable without a running adapter.

### 1.1 Phase 3 decomposition (context, not scope)

The Local MCP Gateway is built as a vertical-slice sequence; only **3A** is specified here:

- **3A (this spec)** — tool manifest & risk classification (pure core + projection + events).
- **3B** — stdio MCP server shell + upstream client; spawns `bitget-mcp-server` (with
  `--paper-trading` for the demo), performs `initialize` + `tools/list`, feeds real
  `RawUpstreamTool[]` into 3A.
- **3C** — `tools/list` response pipeline: persist the manifest via `LedgerStore`, apply the §7.4
  visibility filter, return the governed tool list to the MCP client.
- **3D** — `tools/call` routing into the existing decision/execution core.
- **3E** — OpenTelemetry spans + response redaction.

Demo-vs-live is a **3B shell concern** (the `--paper-trading` flag selects Bitget Demo Trading); the
3A core is environment-independent — `futures_place_order` is `trade_like` whether the upstream is
live or demo.

### 1.2 Exit criterion

> Given a list of raw upstream tools and an optional approved baseline, 3A deterministically
> produces (a) a normalized, schema-hashed, risk-classified definition per tool, (b) a stable
> `manifestHash` over the whole set, (c) a reconcile result — `imported` (first sight),
> `unchanged` (idempotent, **zero events**), or `changed` (drift) — expressed as ordered,
> hash-chained `ToolManifest*` / `Tool{Frozen,Blocked}` events, and (d) a `toolManifestProjection`
> folding those events into a tool inventory whose `visible` flag matches contract §7.4. Risk is
> **raise-only**: no signal, rule order, or diff can ever lower a tool's class below its base
> classification, and an unrecognized tool is `unknown → frozen`.

3A is "done" when: unit tests pin every pure function (including the locked 36-tool Bitget mapping);
a fast-check property test proves the raise-only invariant; a golden `manifestHash` regression test
anchors fingerprint stability over the 36-tool fixture; and projection replay tests mirror the
existing `authorization-projection.test.ts` / `run-status-projection.test.ts`.

---

## 2. Scope

### 2.1 In scope (3A)

- `schemas`: **promote** `canonicalJson` / `canonicalize` to a shared module (§3.2); a new
  `tool-manifest.ts` (`RiskClass`, `ProviderType`, `NormalizedToolDefinition`); a new
  `tool-manifest-payloads.ts` (the five discovery-event payloads + their nested entry types). All
  `.strict()` Zod with inferred TS types.
- `tool-manifest` (**new package** `@traceguard/tool-manifest`): the pure manifest core —
  `normalize`, `risk-table` (the 36-entry Bitget mapping), `classify` (recognition gate +
  severity-lattice join), `manifest-hash`, `diff` — plus the thin event-emitting layer
  `reconcile` (`reconcileManifest`) and `approve` (`approveToolManifest`).
- `event-ledger`: a new `toolManifestProjection` fold (events → tool-inventory view with
  visibility). Re-export `canonicalJson` from its new home for source compatibility (§3.2).
- `testing-fixtures`: a deterministic **36-tool Bitget `RawUpstreamTool[]` fixture** and a fixed
  test `hash` double, used by the golden manifest-hash anchor and the classification tests.
- `policy-engine`: drop the private `canonicalize` / `canonicalJson` in `action-digest.ts`; import
  the shared one (§3.2 de-duplication).
- `docs/event-model.md` + `docs/mcp-gateway-contract.md`: a coherence sync recording the five
  discovery-event **payload interfaces** (the contract names the event *types* in §16.1 but defines
  no payload shapes) and the `toolManifestProjection` reducer (§12.G).

### 2.2 Out of scope (YAGNI / later sub-projects)

- **stdio server, `initialize`, real upstream `tools/list` client** — 3B. 3A's input is an
  in-memory `RawUpstreamTool[]`.
- **Persistence / `LedgerStore` wiring / the `tools/list` response & visibility *filter*** — 3C.
  3A *computes* per-tool `visible` in the projection but does not apply it to a client response,
  and does not append events to a store (it returns `LedgerEvent[]`; tests assemble/verify chains
  in-memory exactly as Phase 1/2 unit tests do).
- **`tools/call` routing, decision/execution wiring** — 3D (the existing core already exists).
- **OpenTelemetry spans / redaction** — 3E.
- **Operator-blocklist & operator-override inputs:** the payload vocabularies reserve
  `operator_blocklist` (block reason) and the §8.1 "operator override / historical review" signals,
  but 3A wires only the **automatic** raise-only signals; operator inputs are a later concern
  (the enum slot exists so adding them is non-breaking).
- **Time-based or live re-classification triggers:** reconcile is invoked with an explicit observed
  list + approved baseline; *when* to re-run it (polling, `tools/list_changed` notifications) is 3B.

---

## 3. Architecture and package layout

3A keeps the functional-core / imperative-shell shape. The new `@traceguard/tool-manifest` package
is **pure** (no I/O, no async, no store): like the Phase 1/2 domain functions it depends on
`schemas` for types and on `event-ledger` only for `makeEvent` + the `Clock` / `IdGen` types used
to stamp events. The projection lives in `event-ledger` alongside the other folds.

| Package                   | 3A addition                                                                                          | Prior parallel              |
|---------------------------|------------------------------------------------------------------------------------------------------|-----------------------------|
| `schemas`                 | `canonical-json.ts` (promoted), `tool-manifest.ts`, `tool-manifest-payloads.ts`                      | `authorization-payloads.ts` |
| `tool-manifest` (**new**) | `normalize.ts`, `risk-table.ts`, `classify.ts`, `manifest-hash.ts`, `diff.ts`, `reconcile.ts`, `approve.ts`, `normalization-version.ts` | `domain` transitions        |
| `event-ledger`            | `tool-manifest-projection.ts`; re-export of `canonicalJson`                                          | `authorization-projection.ts` |
| `policy-engine`           | drop private `canonicalize`; import shared                                                            | — (de-dup)                  |
| `testing-fixtures`        | 36-tool Bitget raw fixture + fixed test `hash`                                                        | execution fixtures          |

Dependency direction stays acyclic: `schemas ← (event-ledger, policy-engine, domain, runtime,
tool-manifest)`; `tool-manifest ← (schemas, event-ledger)`; nothing depends on `tool-manifest` yet
(3B will). No new cycles.

### 3.1 The pure-island / emit-layer boundary (internal to `tool-manifest`)

The package has two internal layers, so the classifier stays reusable by 3B/3C without dragging in
event construction:

```text
  pure island (schemas + injected hash only)            emit layer (+ event-ledger makeEvent)
  ───────────────────────────────────────────          ─────────────────────────────────────
  normalize · risk-table · classify ·          ──────▶  reconcile · approve
  manifest-hash · diff                                  (decide which events; stamp via makeEvent)
```

The island never imports `event-ledger`; it takes a `hash: (input: string) => string` directly.
Only `reconcile.ts` / `approve.ts` import `makeEvent` and take the full
`deps = { clock, newId, hash }`. This mirrors Phase 2, where `evaluateAuthorizationUse` (pure) is
bracketed by `authorizeExecution` (emit) — here the bracketing is a within-package layering.

### 3.2 `canonicalJson` promotion to `schemas` (de-duplication)

`canonicalJson` / `canonicalize` is currently defined in `event-ledger/src/canonical-json.ts`
(re-exported by event-ledger's barrel, consumed by `hashing.ts`, `domain`) **and privately
re-implemented** in `policy-engine/src/action-digest.ts:3,34`. 3A's pure island is the **third**
consumer and must canonicalize without importing `event-ledger` (to preserve §3.1). Rule-of-three:
move the implementation to `schemas/src/canonical-json.ts`, then:

- `event-ledger/src/canonical-json.ts` becomes a one-line **re-export** from `@traceguard/schemas`
  (so `hashing.ts` and every existing `import { canonicalJson } from "@traceguard/event-ledger"`
  keep working unchanged — zero churn at call sites).
- `policy-engine/src/action-digest.ts` drops its private copy and imports the shared one (its
  `actionDigest` output must be byte-identical — the implementations are already equivalent;
  Phase 1 action-digest golden tests guard this).
- `tool-manifest` imports `canonicalJson` from `@traceguard/schemas`.

This is the only cross-package refactor in 3A; it removes a real duplication and is guarded by
existing hash/digest golden tests (§12.A).

---

## 4. Schemas

### 4.1 `tool-manifest.ts` (new) — normalized definition + enums

```text
RiskClass    = z.enum(["public_read","account_read","trade_like",
                       "asset_movement","administrative","unknown"])     // contract §7.2 / §8
ProviderType = z.enum(["bitget_agent_hub","custom_mcp","generic_rest"])  // contract §7.2

NormalizedToolDefinition = z.object({
  providerConnectionId: z.string().min(1),
  providerType:         ProviderType,
  name:                 z.string().min(1),
  title:                z.string().optional(),
  description:          z.string().optional(),
  inputSchema:          z.unknown(),
  outputSchema:         z.unknown().optional(),
  annotations:          z.unknown().optional(),
  normalizedJson:       z.string().min(1),   // canonicalJson(fingerprint) — see §5.1
  schemaHash:           z.string().min(1),   // hash(canonicalJson(inputSchema ?? {}))
  riskClass:            RiskClass,
}).strict()
```

This is the contract §7.2 interface expressed as `.strict()` Zod + inferred type. **Decision
(locked):** `normalizationVersion` is **not** a field on `NormalizedToolDefinition` — it is a
module constant (`NORMALIZATION_VERSION`, §5.1) folded into the manifest hash. The contract lists
"normalization version" among the *manifest-hash inputs* (§7.3) but not among the §7.2 *fields*;
making it a hash input rather than a per-tool field resolves that tension (§12.B).

### 4.2 `tool-manifest-payloads.ts` (new) — the five discovery-event payloads

Nested entry types:

```text
ToolManifestEntry = z.object({ name: z.string().min(1),
                               riskClass: RiskClass,
                               schemaHash: z.string().min(1) }).strict()

ChangedTool = z.object({ name: z.string().min(1),
                         previousSchemaHash: z.string().min(1).optional(),
                         schemaHash:         z.string().min(1).optional(),
                         previousRiskClass:  RiskClass.optional(),
                         riskClass:          RiskClass.optional(),
                         sensitive:          z.boolean() }).strict()

ToolFreezeReason = z.enum(["changed_sensitive","unknown_risk"])
ToolBlockReason  = z.enum(["risk_class_default","operator_blocklist"])
```

Event payloads (all `.strict()`, with same-named `z.infer` types):

```text
ToolManifestImportedPayload = {
  toolManifestVersionId: z.string().min(1),
  providerConnectionId:  z.string().min(1),
  manifestHash:          z.string().min(1),
  normalizationVersion:  z.number().int().nonnegative(),
  tools:                 z.array(ToolManifestEntry) }

ToolManifestChangedPayload = {
  toolManifestVersionId: z.string().min(1),
  providerConnectionId:  z.string().min(1),
  previousManifestHash:  z.string().min(1),
  manifestHash:          z.string().min(1),
  added:                 z.array(ToolManifestEntry),   // ◀── entries, not names (§4.3)
  removed:               z.array(z.string().min(1)),   // names suffice to drop from inventory
  changed:               z.array(ChangedTool) }

ToolFrozenPayload = {
  providerConnectionId: z.string().min(1),
  toolName:             z.string().min(1),
  manifestHash:         z.string().min(1),
  reasonCode:           ToolFreezeReason }

ToolBlockedPayload = {
  providerConnectionId: z.string().min(1),
  toolName:             z.string().min(1),
  riskClass:            RiskClass,
  manifestHash:         z.string().min(1),
  reasonCode:           ToolBlockReason }

ToolManifestApprovedPayload = {
  toolManifestVersionId: z.string().min(1),
  providerConnectionId:  z.string().min(1),
  manifestHash:          z.string().min(1),
  approvedBy:            z.string().min(1),
  approvedAt:            IsoTimestamp }
```

### 4.3 `added` carries entries, not names (coherence fix, disclosed)

The pre-design sketch typed `ToolManifestChangedPayload.added` as `string[]`. It is corrected to
`ToolManifestEntry[]` so the projection can place a newly-added tool into the inventory
**self-sufficiently** (it needs `riskClass` + `schemaHash` to compute the tool's default status and
record its fingerprint) without re-deriving from a normalized definition it does not carry.
`removed` stays `string[]` — dropping a tool needs only its name. `changed` uses `ChangedTool`
(before/after schema hash + risk class + the `sensitive` flag). (§12.C.)

### 4.4 Barrel exports — `schemas/src/index.ts` (modify)

Add `export * from "./canonical-json.js"`, `export * from "./tool-manifest.js"`,
`export * from "./tool-manifest-payloads.js"`.

---

## 5. The pure manifest core (`tool-manifest`, pure island)

Shared local types:

```text
type HashFn = (input: string) => string
interface RawUpstreamTool { name: string; title?: string; description?: string;
                            inputSchema: unknown; outputSchema?: unknown; annotations?: unknown }
interface ProviderIdentity { providerConnectionId: string; providerType: ProviderType }
```

`RawUpstreamTool` is the MCP `tools/list` tool shape (3B sources it from the real upstream; the
`annotations` field carries `bitget-mcp-server`'s `readOnlyHint` / `destructiveHint` —
see §5.3).

### 5.1 `normalize.ts` — canonical definition + schema hash

```text
NORMALIZATION_VERSION = 1                                        // normalization-version.ts

computeSchemaHash(inputSchema: unknown, hash: HashFn): string
  = hash(canonicalJson(inputSchema ?? {}))                      // null/undefined → {} (total)

normalizeToolDefinition(raw: RawUpstreamTool, id: ProviderIdentity,
                        deps: { hash: HashFn }): NormalizedToolDefinition
  schemaHash = computeSchemaHash(raw.inputSchema, deps.hash)
  riskClass  = classifyRisk(raw, id.providerType)               // §5.3
  fingerprint = { providerType, providerConnectionId, name, title, description,
                  inputSchema, outputSchema, annotations, riskClass }   // the §7.3 hash inputs
  return NormalizedToolDefinition.parse({
           ...fingerprint, normalizedJson: canonicalJson(fingerprint), schemaHash })
```

`normalizedJson` is the canonical-JSON serialization of the fingerprint (sorted keys, array order
preserved, `undefined` dropped) — the per-tool stable string the contract §7.2 calls `normalizedJson`.
`riskClass` is *inside* the fingerprint, so a reclassification changes `normalizedJson` and thus the
manifest hash — i.e. reclassification is intentional drift (contract §7.3).

### 5.2 `risk-table.ts` — the recognized base classification (Bitget, locked)

```text
BITGET_RISK_TABLE: Record<string, RiskClass>   // exactly the 36 tools bitget-mcp-server exposes
TABLES: Partial<Record<ProviderType, Record<string, RiskClass>>>
        = { bitget_agent_hub: BITGET_RISK_TABLE }
lookupBaseClass(pt: ProviderType, name: string): RiskClass | undefined
        = TABLES[pt]?.[name]
```

The locked 36-tool mapping (this is the authoritative 3A artifact; `bitget-mcp-server` exposes
exactly these with `spot,futures,account` modules + `system_get_capabilities`):

| Base class       | n  | Tools |
|------------------|----|-------|
| `public_read`    | 13 | `spot_get_ticker`, `spot_get_depth`, `spot_get_candles`, `spot_get_trades`, `spot_get_symbols`, `futures_get_ticker`, `futures_get_depth`, `futures_get_candles`, `futures_get_trades`, `futures_get_contracts`, `futures_get_funding_rate`, `futures_get_open_interest`, `system_get_capabilities` |
| `account_read`   | 10 | `spot_get_orders`, `spot_get_fills`, `spot_get_plan_orders`, `futures_get_orders`, `futures_get_fills`, `futures_get_positions`, `get_account_assets`, `get_account_bills`, `get_transaction_records`, `get_deposit_address` |
| `trade_like`     | 9  | `spot_place_order`, `spot_cancel_orders`, `spot_modify_order`, `spot_place_plan_order`, `spot_cancel_plan_orders`, `futures_place_order`, `futures_cancel_orders`, `futures_set_leverage`, `futures_update_config` |
| `asset_movement` | 3  | `transfer`, `withdraw`, `cancel_withdrawal` |
| `administrative` | 1  | `manage_subaccounts` |

A name **absent** from the table → `lookupBaseClass` returns `undefined` → `unknown` (§5.3). The
table is the "known provider mapping" signal of contract §8.1; it is the floor, never the ceiling.

### 5.3 `classify.ts` — recognition gate + severity-lattice join (Approach B)

Two orthogonal axes — *recognition* (is this a tool we know?) and *severity* (how dangerous?):

```text
SEVERITY = ["public_read","account_read","trade_like","asset_movement","administrative"] as const
idx(c) = SEVERITY.indexOf(c)
joinRisk(a: RiskClass, b: RiskClass): RiskClass = idx(b) > idx(a) ? b : a   // lattice max — only-up

type RaiseRule = (raw: RawUpstreamTool) => RiskClass | undefined            // returns a floor to raise to
RAISE_RULES: RaiseRule[] = [ schemaFieldRule, writeAnnotationRule, dangerTagRule ]

classifyRisk(raw: RawUpstreamTool, pt: ProviderType): RiskClass
  base = lookupBaseClass(pt, raw.name)
  if (base === undefined) return "unknown"          // ◀── RECOGNITION GATE: short-circuit; rules DO NOT run
  let risk = base
  for (const rule of RAISE_RULES) {
    const floor = rule(raw)
    if (floor !== undefined) risk = joinRisk(risk, floor)
  }
  return risk
```

The recognition gate is the crux: an unrecognized tool is `unknown` and the raise rules never run —
we do **not** try to "guess up" from signals on a tool we don't recognize; we freeze it (contract
§8.2). `unknown` is deliberately **outside** the `SEVERITY` lattice (it is a recognition verdict,
not a severity), so `joinRisk` is only ever called on the five ordered classes.

Raise rules (each may only *raise*; `joinRisk` enforces it structurally regardless of rule order):

```text
SENSITIVE_SCHEMA_FIELDS: Record<string, RiskClass> = {
  address: "asset_movement", withdrawAddress: "asset_movement", chain: "asset_movement",
  apiKeyPassphrase: "administrative", apiKeyPermissions: "administrative", apiKeyIp: "administrative" }

schemaFieldRule(raw):  scan raw.inputSchema's property names (only when it is an object with a
                       `properties` object); return the highest SENSITIVE_SCHEMA_FIELDS hit, else undefined.
                       // contract §8.1 example: `safe_get_status` carrying `withdrawAddress` ⇒ asset_movement

writeAnnotationRule(raw): if raw.annotations?.destructiveHint === true
                          || raw.annotations?.readOnlyHint === false  ⇒ "trade_like"; else undefined.
                          // bitget-mcp-server sets these per tool (isWrite signal)

dangerTagRule(raw):   if (raw.description ?? "").includes("[DANGER]")  ⇒ "asset_movement";
                      else if includes("[CAUTION]")                   ⇒ "trade_like"; else undefined.
                      // descriptions are untrusted: may RAISE, never LOWER (contract §8.1)
```

Because classification is `base` joined with raise-only floors, it is **monotone**: for a recognized
tool, `idx(classifyRisk(raw)) ≥ idx(base)`, and adding/removing/reordering signals can only move it
up. This is the structural guarantee that 3A can never down-classify a dangerous tool — proven by
the §10 property test.

### 5.4 `manifest-hash.ts` — the set fingerprint

```text
manifestFingerprint(def: NormalizedToolDefinition)
  = { name: def.name, riskClass: def.riskClass, schemaHash: def.schemaHash,
      normalizedJson: def.normalizedJson }     // per-tool §7.3 inputs (already include provider identity)

computeManifestHash(defs: NormalizedToolDefinition[], deps: { hash: HashFn }): string
  = deps.hash(canonicalJson({
      normalizationVersion: NORMALIZATION_VERSION,
      tools: defs.map(manifestFingerprint).sort(byName) }))   // sort by name → order-independent
```

`sort(byName)` realizes contract §7.3's `sorted(NormalizedToolDefinition[])`: the hash is
independent of the order the upstream listed tools in, but changes if any tool's name, risk class,
schema, or the normalization version changes. (`byName` is a total order on the `name` string;
duplicate names sort adjacent and both contribute — §9.)

### 5.5 `diff.ts` — observed vs approved baseline

```text
SENSITIVE_CLASSES = new Set<RiskClass>(["trade_like","asset_movement","administrative"])

ManifestDiff = { added: NormalizedToolDefinition[]; removed: string[]; changed: ChangedTool[] }

diffManifest(approved: ToolManifestEntry[], observed: NormalizedToolDefinition[]): ManifestDiff
  index approved by name; index observed by name
  added   = observed tools whose name ∉ approved
  removed = approved names ∉ observed
  changed = names in both where schemaHash OR riskClass differs, each as a ChangedTool:
              { name, previousSchemaHash, schemaHash, previousRiskClass, riskClass,
                sensitive: approved.riskClass ∈ SENSITIVE_CLASSES
                        || observed.riskClass ∈ SENSITIVE_CLASSES }
```

`sensitive` is true if **either** side is a sensitive class — a tool that *was* `trade_like` and is
now `public_read` (a suspicious *downgrade in the observed surface*) is just as freeze-worthy as the
reverse. (Note: this is the *upstream changing what it exposes*, detected by comparison — distinct
from 3A's own classifier, which is raise-only.)

---

## 6. Reconcile & approve (`tool-manifest`, emit layer)

`reconcileManifest` follows the established transition shape `(args, deps) → { events, ... }` with
`deps = { clock, newId, hash }`, threading `previousEventHash` through an `emit` closure exactly like
`resolveAuthorizationGateway`. Events are stamped via `event-ledger`'s `makeEvent`.

```text
ReconcileArgs = { workspaceId, providerConnectionId, toolManifestVersionId,
                  observed: RawUpstreamTool[],
                  approved?: { manifestHash: string; tools: ToolManifestEntry[] },
                  previousEventHash?: string | null }
ReconcileResult = { events: LedgerEvent[]; manifestHash: string;
                    outcome: "imported" | "unchanged" | "changed" }

reconcileManifest(args, deps):
  defs         = args.observed.map(raw => normalizeToolDefinition(raw, identity, deps))
  manifestHash = computeManifestHash(defs, deps)
  sorted       = [...defs].sort(byName)        // deterministic per-tool event order

  // CASE 1 — import (no approved baseline yet)
  if (args.approved === undefined):
    emit ToolManifestImported { toolManifestVersionId, providerConnectionId, manifestHash,
                                normalizationVersion: NORMALIZATION_VERSION,
                                tools: defs.map(toEntry) }        // aggregateType "tool_manifest"
    for (def of sorted):
      if (def.riskClass === "unknown")
            emit ToolFrozen { providerConnectionId, toolName: def.name, manifestHash,
                              reasonCode: "unknown_risk" }        // aggregateType "tool_definition"
      else if (def.riskClass === "asset_movement" || def.riskClass === "administrative")
            emit ToolBlocked { providerConnectionId, toolName: def.name, riskClass: def.riskClass,
                               manifestHash, reasonCode: "risk_class_default" }
    return { events, manifestHash, outcome: "imported" }

  // CASE 2 — unchanged (idempotent: byte-identical manifest ⇒ ZERO events)
  if (manifestHash === args.approved.manifestHash):
    return { events: [], manifestHash, outcome: "unchanged" }

  // CASE 3 — changed (drift vs approved baseline)
  diff = diffManifest(args.approved.tools, defs)
  emit ToolManifestChanged { toolManifestVersionId, providerConnectionId,
                             previousManifestHash: args.approved.manifestHash, manifestHash,
                             added: diff.added.map(toEntry), removed: diff.removed, changed: diff.changed }
  for (c of diff.changed) if (c.sensitive)
        emit ToolFrozen { ..., toolName: c.name, reasonCode: "changed_sensitive" }
  for (def of diff.added sorted by name):
        if (def.riskClass === "unknown")            emit ToolFrozen  { reasonCode: "unknown_risk" }
        else if (asset_movement || administrative)  emit ToolBlocked { reasonCode: "risk_class_default" }
  return { events, manifestHash, outcome: "changed" }
```

Event envelope conventions (via `makeEvent`):

- `ToolManifestImported` / `ToolManifestChanged`: `aggregateType: "tool_manifest"`,
  `aggregateId: toolManifestVersionId`, `actorType: "system"`.
- `ToolFrozen` / `ToolBlocked`: `aggregateType: "tool_definition"`,
  `aggregateId: providerConnectionId + ":" + toolName`, `actorType: "system"`.
- `eventVersion: 1`, `schemaVersion: 1` (existing convention).
- `providerConnectionId` / `toolManifestVersionId` live **in the payload** (not auto-threaded onto
  the envelope), matching Phase 2's treatment of `policyVersionId` (§12.D).

`approveToolManifest` — the human-review emitter (separate from reconcile; in 3A its trigger is the
test/caller, in 3C an operator action):

```text
ApproveArgs = { workspaceId, providerConnectionId, toolManifestVersionId, manifestHash,
                approvedBy, previousEventHash?: string | null }
approveToolManifest(args, deps): { events: [ ToolManifestApproved ] }
  emit ToolManifestApproved { toolManifestVersionId, providerConnectionId, manifestHash,
                              approvedBy, approvedAt: deps.clock.now() }
        // aggregateType "tool_manifest", aggregateId toolManifestVersionId,
        // actorType "user", actorId approvedBy
```

---

## 7. Projection (`event-ledger`) — `toolManifestProjection`

A pure fold (events → view), same shape as `authorizationProjection`:

```text
ToolStatus = "active" | "blocked" | "frozen"
ToolInventoryEntry = { name: string; riskClass: RiskClass; schemaHash: string;
                       status: ToolStatus; freezeReason?: ToolFreezeReason; visible: boolean }
ToolInventoryView  = { providerConnectionId?: string; manifestHash?: string;
                       approvedManifestHash?: string; normalizationVersion?: number;
                       tools: ToolInventoryEntry[] }

classDefault(rc: RiskClass): ToolStatus
  = (rc === "asset_movement" || rc === "administrative") ? "blocked"
  : (rc === "unknown")                                   ? "frozen"
  : "active"
```

`visible = (status === "active")` on every entry — the contract §7.4 visibility column (approved
public/account/trade-like = visible; frozen / blocked / unknown / changed-sensitive = hidden).

Reducer (over a `Map<name, entry>`, switch on `eventType`, ignoring unrelated events):

```text
ToolManifestImported: providerConnectionId = p.providerConnectionId
                      manifestHash = p.manifestHash; normalizationVersion = p.normalizationVersion
                      tools = map each entry → { ...entry, status: classDefault(riskClass) }
ToolBlocked:          tools[p.toolName].status = "blocked"; clear freezeReason
ToolFrozen:           tools[p.toolName].status = "frozen";  freezeReason = p.reasonCode
ToolManifestChanged:  manifestHash = p.manifestHash
                      remove p.removed names
                      add p.added entries → status classDefault(riskClass)
                      for c of p.changed: refresh schemaHash/riskClass; status classDefault(new riskClass)
                      // a following ToolFrozen(changed_sensitive)/ToolBlocked then overrides status
ToolManifestApproved: approvedManifestHash = p.manifestHash
                      for each tool with status "frozen" && freezeReason "changed_sensitive":
                          status = classDefault(riskClass); clear freezeReason   // review clears change-freeze
                      // freezeReason "unknown_risk" stays frozen; "blocked" stays blocked
```

Recompute `visible` from `status` after every event. `approveToolManifest` accepting a manifest
clears **change-driven** freezes (a human reviewed the drift) but never lowers risk: `unknown_risk`
freezes stay (the tool is still unclassified) and class-default blocks stay (asset_movement /
administrative remain blocked by standing default — approval of the manifest is not a policy grant).
This is faithful to contract §8.2 "risk may only be lowered through review" — and even review here
only accepts drift, it does not reclassify.

The projection emits entries in stable `name`-sorted order so replay is deterministic.

---

## 8. Data flow (end-to-end, in-memory)

```text
First sight (import):
  RawUpstreamTool[] (36 Bitget tools)
    → reconcileManifest({ observed, approved: undefined })
        normalize×36 → classify×36 → computeManifestHash
        emit ToolManifestImported{ tools:36 }
        emit ToolBlocked × {transfer, withdraw, cancel_withdrawal, manage_subaccounts}   (4)
        (no unknown in the clean Bitget set ⇒ no ToolFrozen)
    → toolManifestProjection ⇒ 13 public_read + 10 account_read + 9 trade_like = 32 visible,
                                4 blocked (asset_movement/administrative) = hidden

Idempotent re-sync (unchanged):
  same 36 tools, approved baseline = that manifestHash
    → reconcileManifest ⇒ { events: [], outcome: "unchanged" }      ◀── ZERO events

Drift (changed):
  upstream adds a tool `mystery_tool` (not in table) and swaps spot_get_ticker's schema
    → reconcileManifest({ observed, approved })
        emit ToolManifestChanged{ added:[mystery_tool], changed:[spot_get_ticker] }
        emit ToolFrozen{ spot_get_ticker, changed_sensitive }?  (only if either side sensitive)
        emit ToolFrozen{ mystery_tool, unknown_risk }
    → projection ⇒ mystery_tool frozen+hidden; spot_get_ticker frozen iff sensitive

Approval (review accepts drift):
  approveToolManifest({ manifestHash: <new> , approvedBy: "operator:alice" })
        emit ToolManifestApproved
    → projection ⇒ approvedManifestHash set; changed_sensitive freezes cleared;
                    unknown_risk (mystery_tool) STAYS frozen
```

The dangerous Bitget tools (`futures_place_order` = trade_like → policy-gated when called;
`withdraw` / `transfer` = asset_movement → blocked-by-default + hidden) are exactly the surface the
hackathon demo shows TraceGuard governing — and 3A is where that governance verdict is first
computed and recorded.

---

## 9. Error handling, edge cases, invariants (fail-closed)

3A is pure and synchronous; "error handling" is about **boundary input shapes** and **determinism**,
not exceptions. Refusal verdicts are carried in data (`riskClass: "unknown"`, `status`), never thrown.

| Input | Behavior | Rationale |
|-------|----------|-----------|
| empty `observed` (`[]`) | `computeManifestHash([])` = a definite non-empty hash; import emits `ToolManifestImported{ tools: [] }`, no freeze/block | an empty surface is a legal state (upstream offline), not an error |
| `inputSchema` null/absent | `computeSchemaHash` uses `inputSchema ?? {}` → hashes `{}` | hashing must be total; never throw on null |
| `inputSchema` malformed (string/array) | `canonicalJson` serializes it as-is; `schemaFieldRule` only scans when it is an object with `properties` → no raise, but still fingerprinted | tolerate; 3A does not adjudicate upstream schema validity |
| duplicate tool `name` in one manifest | not de-duped; `sort(byName)` puts copies adjacent, **both** enter the hash; projection map keeps the last | upstream duplicates are upstream bugs — fingerprint faithfully (drift visible), do not silently swallow |
| `unchanged` (hash equals baseline) | `reconcileManifest` returns `events: []` | idempotent: re-syncing an unchanged manifest is zero-noise |

**`z.unknown()` + `.strict()` absent-vs-`undefined` nuance:** in the fingerprint fed to
`canonicalJson`, a key whose value is `undefined` is **dropped** by `canonicalize` — so "field absent"
and "field explicitly `undefined`" produce the **same** `normalizedJson` / hash (semantically
identical). A `null`, however, serializes to `null` and is **distinct** from absent (an explicit
upstream signal). This is asserted in tests.

**Invariants:**

1. **I1 — raise-only / no down-classification.** For a recognized tool,
   `idx(classifyRisk(raw)) ≥ idx(base)`; no signal, rule subset, or rule order can lower it.
   `joinRisk` is the lattice max, so it is commutative + associative + monotone. (§10 property test.)
2. **I2 — recognition gate.** An unrecognized name is `unknown`; raise rules never run on it; it
   freezes. We never "guess up" a class for a tool we don't recognize.
3. **I3 — fail-closed defaults.** `unknown → frozen → hidden`; `asset_movement` / `administrative`
   `→ blocked → hidden`. The model never sees a tool TraceGuard would refuse.
4. **I4 — fingerprint stability.** `manifestHash` is order-independent (name-sorted) but sensitive to
   name / risk-class / schema / normalization-version changes; reclassification *is* drift (by design).
5. **I5 — idempotence.** Unchanged manifest ⇒ zero events (no projection mutation, no chain growth).
6. **I6 — byte determinism.** With an injected `hash`, identical `(observed, approved)` inputs produce
   identical `defs`, `manifestHash`, events, and `eventHash` chain. `clock` / `newId` affect only the
   event envelope (`occurredAt` / `id`), never the fingerprint or risk verdict.
7. **I7 — hash chain continuity.** Emitted events link via `previousEventHash` onto the supplied head,
   with `eventHash` over the same canonical preimage as Phase 1/2 (`makeEvent` unchanged).
8. **I8 — review never lowers risk.** `ToolManifestApproved` clears only `changed_sensitive` freezes;
   `unknown_risk` and class-default blocks persist.

---

## 10. Testing strategy (Vitest + fast-check)

Four layers, TDD throughout.

- **Unit — pure functions (`tool-manifest`):**
  - `computeSchemaHash`: null / absent / malformed → definite hash; distinct schemas → distinct hashes.
  - `classifyRisk`: each of the 36 Bitget tools lands in its locked class (13 / 10 / 9 / 3 / 1);
    a name outside the table → `unknown`; the contract §8.1 reversal — a `safe_get_status` carrying
    `withdrawAddress` → raised to `asset_movement`; `annotations.destructiveHint: true` → raised to
    `trade_like`; `[DANGER]` in description → `asset_movement`.
  - `joinRisk`: lattice max on the five classes.
  - `diffManifest`: added / removed / changed; `sensitive` true when either side is sensitive
    (including a `trade_like → public_read` observed downgrade).
  - `reconcileManifest`: import emits `Imported` + 4 `ToolBlocked` for the clean Bitget set;
    unchanged → `[]`; changed → `Changed` + the right freeze/block fan-out.
- **Property test (fast-check) — the raise-only invariant (the key safety assertion):**
  - over arbitrary `(base, signalFloors[])`, `classifyRisk`-style folding never yields
    `idx(result) < idx(base)`;
  - `joinRisk` is order-independent: any permutation of the same raise floors yields the same class
    (commutativity / associativity of the lattice max).
  - This proves *structurally* that 3A cannot down-classify a dangerous tool.
- **Golden regression — `manifestHash` anchor:**
  - the 36-tool Bitget `RawUpstreamTool[]` fixture (in `testing-fixtures`) + a fixed test `hash`
    (sha256) → `computeManifestHash` must equal a written-down golden string. Any unintended change to
    normalization, the risk table, or `NORMALIZATION_VERSION` flips the hash and reddens the test —
    fingerprint stability becomes a CI gate.
- **Projection replay (`event-ledger`, mirroring `authorization-projection.test.ts` /
  `run-status-projection.test.ts`):**
  - feed `reconcileManifest` output to `toolManifestProjection`; assert post-import inventory
    (32 visible, 4 blocked, 0 frozen for the clean set); a drift sequence freezes the unknown +
    changed-sensitive tools; `ToolManifestApproved` clears `changed_sensitive` but leaves
    `unknown_risk` frozen and class-default blocks blocked;
  - replay determinism: the same event sequence folded twice yields the identical view.

---

## 11. Canonical source mapping

| 3A artifact | Canonical source |
|-------------|------------------|
| `NormalizedToolDefinition`, `RiskClass`, `ProviderType` | contract §7.2 |
| `normalizedJson` + normalization rules | contract §7.2 ("Normalization rules") |
| `computeManifestHash` (sorted, risk + normalization-version included) | contract §7.3 |
| `visible` = active | contract §7.4 (visibility table) |
| 36-tool base mapping + default behaviors | contract §8 (risk table) |
| raise-only signals (untrusted descriptions, `withdrawAddress` example) | contract §8.1 |
| `unknown → frozen`; raise auto / lower only by review | contract §8.2 |
| `ToolManifestImported/Changed/Frozen/Blocked/Approved` event types | contract §16.1 |
| discovery-event **payload** interfaces (net-new) | not in contract/event-model; defined here, synced (§12.G) |
| `makeEvent` / hash-chain / `canonicalJson` | event-model §10; 1A/1B/2 artifacts (unchanged) |
| projection-fold pattern | event-model §8; `authorizationProjection` (1B/2 artifact) |

---

## 12. Deviations and coherence notes (disclosed)

- **A. `canonicalJson` promoted to `schemas`; `event-ledger` re-exports; `policy-engine` de-duped.**
  3A's pure island is the third consumer and must canonicalize without importing `event-ledger`.
  The move is byte-identical (guarded by existing hash/action-digest golden tests); call sites are
  unchanged via the event-ledger re-export. (§3.2.)
- **B. `normalizationVersion` is a module constant + manifest-hash input, not a §7.2 field.** The
  contract lists it among §7.3 hash inputs but not §7.2 fields; folding it into the hash (not onto
  each `NormalizedToolDefinition`) honors both. (§4.1 / §5.4.)
- **C. `ToolManifestChangedPayload.added` is `ToolManifestEntry[]`, not `string[]`.** The projection
  needs `riskClass` + `schemaHash` to place an added tool; `removed` stays `string[]`. (§4.3.)
- **D. Discovery-event identifiers live in the payload, not auto-threaded onto the envelope.**
  `makeEvent` does not thread `providerConnectionId` / `toolManifestVersionId` (it never threaded
  `policyVersionId` either); 3A keeps them in the payload, with `aggregateId` carrying the manifest
  version (manifest events) or `providerConnectionId:toolName` (tool events). Consistent with Phase 2.
- **E. `unknown` is outside the `SEVERITY` lattice.** It is a recognition verdict, not a severity, so
  `joinRisk` only operates on the five ordered classes and the recognition gate short-circuits before
  any raise rule runs. (§5.3.)
- **F. `diff.sensitive` triggers on either side.** A `trade_like → public_read` *observed* downgrade
  freezes just like an upgrade — the upstream changing a sensitive tool's surface is the threat,
  independent of direction. This does not contradict the raise-only classifier (I1), which governs
  3A's *own* classification, not upstream drift. (§5.5.)
- **G. event-model.md / contract coherence sync (full list).** The contract names the five event
  *types* (§16.1) but neither it nor event-model defines their **payloads** or a tool-manifest
  projection reducer. 3A: (1) records the five payload interfaces (§4) in event-model §6; (2) records
  the `toolManifestProjection` reducer (§7) in event-model §8; (3) cross-links contract §7/§8/§16.1 to
  those payloads. Listed here so the doc-edit scope is visible at spec review.

---

## 13. Acceptance criteria (3A)

1. The pnpm workspace builds under TS `strict` + ESM with the new `@traceguard/tool-manifest`
   package and the `canonicalJson` promotion, with no new dependency cycles and `policy-engine`'s
   action-digest output unchanged.
2. `normalizeToolDefinition` produces a `.strict()`-valid `NormalizedToolDefinition` with a stable
   `normalizedJson` and a `schemaHash` total over null / absent / malformed `inputSchema`.
3. `classifyRisk` maps all 36 Bitget tools to the locked classes, returns `unknown` for unrecognized
   names, and is raise-only — proven by a fast-check property test over `joinRisk` / signal folding.
4. `computeManifestHash` is order-independent and matches a written-down golden value over the
   36-tool fixture under the fixed test `hash`.
5. `reconcileManifest` yields `imported` (`ToolManifestImported` + class-default `ToolBlocked`s +
   `unknown` `ToolFrozen`s), `unchanged` (**zero events**), or `changed` (`ToolManifestChanged` +
   sensitive-change freezes + added-tool fan-out), as ordered hash-chained events.
6. `approveToolManifest` emits `ToolManifestApproved` (envelope `actorType: "user"`, `actorId =
   approvedBy`).
7. `toolManifestProjection` folds the events into a `ToolInventoryView` whose `visible` flags match
   contract §7.4 (32 visible / 4 blocked / 0 frozen for the clean Bitget set), clears
   `changed_sensitive` freezes on approval while leaving `unknown_risk` frozen and class-default
   blocks blocked, and is replay-deterministic.
8. `docs/event-model.md` + `docs/mcp-gateway-contract.md` are synced per §12.G (the five payload
   interfaces + the projection reducer + cross-links).
```

