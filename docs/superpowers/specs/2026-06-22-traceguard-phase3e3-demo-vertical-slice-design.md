# TraceGuard Phase 3E-3 — Demo Vertical Slice Design

**Date:** 2026-06-22
**Status:** Approved (brainstorming) — pending implementation plan
**Author:** stardust + Claude

## Goal

Deliver a runnable, end-to-end governed paper-trading round-trip plus a redacted,
human-readable transcript — both as live terminal narration and as a committed
Markdown artifact — so the TraceGuard governance story can be demonstrated on
stage at the hackathon and reviewed by judges from the repo.

## Background & Motivation

Phase 3E-2 (engine hardening) is complete: durable ledger (3E-2a), arg
validation + result redaction on the read-forward path (3E-2b), and the live
`bitget_live` spot adapter (3E-2c) are all shipped. The governed path is fully
wired in `boot-gateway.ts` (both `simulator` and `bitget_live` adapters), and
`bin/gateway-local.ts` already serves the gateway as an MCP stdio server against
`bitget-mcp-server --paper-trading`.

What is missing is a **scripted, self-contained demonstration**: today the six
internal `traceguard_*` tools can only be exercised by an external MCP client
(an agent) driving them by hand, and there is no artifact that renders the
audited governance story for a human. This slice fills exactly that gap — it is
the demo-facing vertical slice from the engine-hardening design's §5 "later
phase" menu. It adds **no new governance semantics**; it drives and renders the
existing ones.

## Scope

**In scope:**
- A pure transcript model + renderer over the ledger (terminal lines + Markdown).
- An in-process scenario driver that drives the six internal tools + the approval
  seam through a complete round-trip.
- Two scenarios: a **happy path** (proposal → approval → live paper execution →
  redacted receipt) and one **fail-closed path** (denied approval → no
  authorization minted → execution impossible → nothing reaches the exchange).
- Dual backends: **live** (real `bitget-mcp-server --paper-trading` +
  `bitget_live`) for the stage; **deterministic** (fake upstream + `simulator` +
  fixed clock + counter IDs) for CI tests and golden-artifact regeneration.
- A committed, byte-stable Markdown sample artifact guarded by a golden test.
- A behavior-preserving extraction of `buildGatewayRuntime` from `boot-gateway.ts`
  so the served server and the demo driver share the same safety-critical wiring.

**Out of scope (YAGNI / deferred to their own cycles):**
- Additional fail-closed scenarios beyond denied-approval (capability-unavailable,
  manifest-unapproved, policy-deny, execution-unknown) — the model and renderer
  must not special-case happy/denied so these stay cheap to add later, but they
  are not built now.
- Futures / non-spot live execution (out-of-scope-by-design for `bitget_live`).
- Real-funds trading — demo is paper-trading only.
- Hosted HTTP transport, persistent/Telegram approver, OTel spans, idempotency
  keys, replay/diff reconstruction.

## Architecture Overview

A **scenario driver** obtains an `InternalToolContext` + `GatewayState` from a
shared `buildGatewayRuntime` builder (extracted from `boot-gateway.ts`), then
drives the six internal tools in sequence via `dispatchInternalTool`, using the
existing out-of-band `approve`/`reject` seam for the human-in-the-loop step. The
resulting ledger is read back and passed to a **pure transcript model**
(`buildTranscript`) and **renderer** (`renderMarkdown` / `renderLines`), which
emit redacted output to the terminal and to a Markdown file.

The driver is parameterized by backend:
- **live** — real `StdioUpstreamClient` → `bitget-mcp-server --paper-trading`,
  `bitget_live` adapter, system clock + random IDs. Non-deterministic; for the
  stage. Writes a gitignored live artifact.
- **deterministic** — `fake-upstream` + `simulator` adapter + `fixedClock` +
  `counterIdGen`. Byte-stable; for CI and for (re)generating the committed
  Markdown golden.

All new code lives in `@traceguard/mcp-gateway`. No new package. Redaction reuses
the package's existing `redactResult` + `AGENT_CREDENTIAL_PROFILE`.

## Components & Interfaces

### 1. `src/gateway-runtime.ts` — shared runtime builder (extraction)

Extracts the context-construction body of `bootGateway` so it can be reused by
the demo driver without duplicating safety-critical wiring (adapters, policy,
TTLs, audit, `approve`/`reject`, the initial `RunCreated` event).

```ts
export interface GatewayRuntime {
  state: GatewayState;
  callCtx: GatewayCallContext;       // consumed by createGatewayServer (passthrough path)
  internalCtx: InternalToolContext;  // consumed by dispatchInternalTool
  approve: (approvalId: string, by: { approvedBy: string; channel: ApprovalChannel }) => Promise<ApprovalOutcome>;
  reject: (approvalId: string, by: { rejectedBy: string; channel: ApprovalChannel; reason?: string }) => Promise<ApprovalOutcome>;
  runId: string;
}

export async function buildGatewayRuntime(
  args: BootGatewayArgs,
  client: UpstreamManifestClient,
  store: LedgerStore,
  deps: ReconcileDeps,
): Promise<GatewayRuntime>;
```

`buildGatewayRuntime` performs the happy path only: `client.open()` →
`listTools()` → `reconcileManifest` → append → projection → `buildGatewayState`
→ `RunCreated` → build `callCtx` / `internalCtx` / `approve` / `reject`. On
`UpstreamUnavailableError` / `UpstreamListToolsError` it lets them propagate.

`bootGateway` is refactored to call it and keep its existing degraded handling:

```ts
export async function bootGateway(args, client, store, deps): Promise<GatewayHandle> {
  let runtime: GatewayRuntime;
  try {
    runtime = await buildGatewayRuntime(args, client, store, deps);
  } catch (err) {
    if (err instanceof UpstreamUnavailableError || err instanceof UpstreamListToolsError) {
      await safeClose(client);
      const degraded = degradedState();
      return { state: degraded, server: createGatewayServer(degraded), client };
    }
    await safeClose(client);
    throw err;
  }
  const server = createGatewayServer(runtime.state, runtime.callCtx, runtime.internalCtx);
  return {
    state: runtime.state, server, client,
    runId: runtime.runId, approve: runtime.approve, reject: runtime.reject,
  };
}
```

This is behavior-preserving: `bootGateway`'s existing tests must stay green.

### 2. `src/demo/transcript-model.ts` — pure ledger → transcript

```ts
export interface DemoTranscriptHeader {
  workspaceId: string;
  manifestHash: string;
  governedTools: { active: number; blocked: number; frozen: number };
}

export type DemoStep =
  | { kind: "run_started"; runId: string; agentName?: string; intent?: string; at: string }
  | { kind: "decision_proposed"; decisionId: string; instrument: string; marketType: string; action: string; size: string; at: string }
  | { kind: "approval_requested"; approvalId: string; reason: string; at: string }
  | { kind: "approval_decided"; approvalId: string; outcome: "approved" | "rejected"; by: string; at: string }
  | { kind: "authorization_consumed"; authorizationId: string; at: string }
  | { kind: "execution_outcome"; status: string; executionSent: boolean; receiptRef?: string; receiptHash?: string; reasonCode?: string; at: string }
  | { kind: "run_finished"; runId: string; status: string; at: string };

export interface DemoTranscript {
  header: DemoTranscriptHeader;
  steps: readonly DemoStep[];
}

export function buildTranscript(events: readonly LedgerEvent[]): DemoTranscript;
```

A pure function over the ledger. Header facts and steps are derived from the
existing projections (`toolManifestProjection`, `runStatusProjection`,
`approvalProjection`, `authorizationProjection`) and the execution events. It
does **not** special-case happy vs denied: a denied run simply yields an
`approval_decided{outcome:"rejected"}` and an `execution_outcome` with
`executionSent:false` and no receipt (or omits the execution step entirely if no
execution event exists — see Data Flow). Step ordering follows ledger sequence.

### 3. `src/demo/transcript-render.ts` — pure renderers

```ts
export function renderMarkdown(t: DemoTranscript): string;          // committed artifact + --out file
export function renderLines(t: DemoTranscript): readonly string[];  // terminal narration
```

Both are pure and deterministic given a `DemoTranscript`. Markdown uses a fixed
heading structure (header block + an ordered step list, with the happy/denied
outcome called out). Trailing newline normalized so golden comparison is stable.

### 4. `src/demo/scenario-driver.ts` — drives the round-trip

```ts
export type ScenarioKind = "happy" | "denied";

export interface DecisionSpec {
  instrument: string;
  marketType: "spot" | "futures";
  action: string;            // e.g. "open_long" | "buy"
  thesis: string;
  evidenceRefs: string[];
  requestedQuantity?: string;
  requestedNotionalUsdt?: string;
  requestedLeverage?: string;
  orderType?: string;
  limitPrice?: string;
}

export interface ScenarioResult {
  events: readonly LedgerEvent[];
  transcript: DemoTranscript;
}

export async function runScenario(opts: {
  runtime: GatewayRuntime;
  scenario: ScenarioKind;
  decision: DecisionSpec;
  executionAdapter: ExecutionAdapterType; // "simulator" (deterministic) | "bitget_live" (live)
}): Promise<ScenarioResult>;
```

Drives `dispatchInternalTool(runtime.internalCtx, runtime.state, name, args)` in
order. Both scenarios share `start_run → record_decision → request_execution`.
At the approval fork:
- **happy:** `runtime.approve(approvalId, …)` → `check_approval` (expect
  `APPROVED` + `authorizationId`) → `execute_authorized_action` (consumes
  `authorizationId`) → `finish_run`.
- **denied:** `runtime.reject(approvalId, …)` → `check_approval` (expect
  `REJECTED`) → `finish_run`. No execute call is made; burn-before-execute means
  no authorization exists, so no order can be submitted.

Finally `store.read(workspaceId)` → `buildTranscript(events)`.

### 5. `src/demo/deterministic-deps.ts` — production-importable determinism

```ts
export function counterIdGen(): IdGen;          // next(prefix) => `${prefix}_${n}` per-prefix counter
export function fixedClock(instant?: string): Clock; // now() => fixed instant (default a pinned ISO)
```

Lives in `src/demo/` (not `@traceguard/testing-fixtures`, which is a dev-only
dependency) because the `gateway-demo` bin imports them for `--mode
deterministic`. The minor duplication of `fixedClock` against testing-fixtures is
intentional and respects the production/dev package boundary.

### 6. `src/demo/fake-upstream.ts` — canned upstream for deterministic mode

```ts
export function createFakeUpstream(): UpstreamManifestClient;
```

Implements `open` / `listTools` / `callTool` / `close`. `listTools` returns a
small canned `RawUpstreamTool[]` that includes an active `spot_place_order` plus
at least one tool that normalizes to `blocked`/`frozen`, so the transcript's
governed-tool counts tell a real, deterministic governance story. `callTool`
returns a fixed `CallToolResult` (`structuredContent: { orderId: "PAPER-OID-1" }`)
— it is not invoked when the `simulator` adapter is selected, but a canned value
keeps the fake usable if pointed at `bitget_live`.

### 7. `src/bin/gateway-demo.ts` — CLI entrypoint

Flags:
- `--scenario happy|denied|both` (default `both`) — a single invocation can render
  both scenarios into one artifact for side-by-side "allow vs block" contrast.
- `--mode live|deterministic` (default `deterministic`) — the bare command is
  reproducible and never fails on a missing external server; `--mode live` is the
  stage command.
- `--out <path>` — optional override. Defaults: deterministic → the committed
  golden path; live → `.demo-out/live-run.md` (gitignored).

Assembles the backend (live: `StdioUpstreamClient` + `bitget_live` + `SystemClock`
+ `SystemIdGen`, mirroring `gateway-local.ts`; deterministic: `createFakeUpstream`
+ `simulator` + `fixedClock` + `counterIdGen`), calls `buildGatewayRuntime`, runs
the selected scenario(s) via `runScenario`, prints `renderLines` to stdout, and
writes `renderMarkdown` to the resolved path. Fail-closed: on upstream
unavailability or any thrown error, print a diagnostic to **stderr** and exit
non-zero (stdout is reserved for machine/MCP output, mirroring the existing
bins). No `package.json`
`bin` field is added; run via `node <dist>/bin/gateway-demo.js`, mirroring the
existing bins.

## Data Flow

```
gateway-demo (bin)
  └─ assemble backend (live | deterministic)
       └─ buildGatewayRuntime(args, client, store, deps)
            ├─ client.open() → listTools() → reconcileManifest → append → state
            └─ RunCreated + internalCtx + approve/reject
  └─ runScenario({ runtime, scenario, decision, executionAdapter })
       └─ dispatchInternalTool × { start_run, record_decision, request_execution,
            (approve|reject), check_approval, [execute_authorized_action], finish_run }
            └─ each appends events to the ledger store
       └─ store.read(workspaceId) → buildTranscript(events) → DemoTranscript
  └─ renderLines(transcript) → stdout (terminal narration)
  └─ renderMarkdown(transcript) → --out file (committed golden | gitignored live)
```

The ledger already stores only digests and governance facts — raw upstream
results never enter the ledger or reach the agent — so the transcript is sourced
from already-safe data. The execution step on the happy path may return
`{kind:"unknown", reasonCode}` (post-submit ambiguity); the transcript renders
that honestly as a reconciliation-required outcome, never as a fabricated success.

## Redaction

The transcript is built from ledger projections, which carry governance facts
(IDs, hashes, statuses, instrument/action/size), not credentials or raw order
bodies. As defense-in-depth, any free-form field echoed into a step passes
through `redactResult(value, AGENT_CREDENTIAL_PROFILE)` before rendering, and a
test asserts that a secret-bearing field renders as `[REDACTED]`. This keeps the
committed artifact safe to publish even if the ledger schema later widens.

## Determinism Strategy

Deterministic mode pins every volatile input: `fixedClock` (all `at` timestamps
equal the pinned instant — ordering comes from ledger sequence, not time),
`counterIdGen` (stable `run_1` / `dec_1` / `appr_1` / `auth_1` / `tmv_1`), and
`createFakeUpstream` (canned manifest + canned receipt). The `simulator` adapter
derives its receipt hash deterministically from inputs. The rendered Markdown is
therefore byte-stable across runs. Live mode uses real clock/IDs and the real
adapter; its output is non-deterministic and never committed.

## Committed Artifact + Golden Test

- **Artifact:** `docs/superpowers/demo/sample-governed-run.md`, generated by the
  deterministic `both`-scenario run.
- **Golden test:** renders the deterministic transcript and asserts byte-equality
  with the committed file, so the artifact cannot silently drift from behavior.
- **Regeneration:** `gateway-demo --mode deterministic --scenario both --out
  docs/superpowers/demo/sample-governed-run.md`, or an `UPDATE_GOLDEN=1`
  env-guarded write inside the golden test.
- `.gitignore` gains `.demo-out/` for live output.

## Error Handling / Fail-Closed

The driver inherits the gateway's fail-closed semantics. `buildGatewayRuntime`
propagates `UpstreamUnavailableError` / `UpstreamListToolsError`; the bin catches
them, prints to stderr, and exits non-zero. The denied scenario asserts that no
`AuthorizationConsumed` / execution / receipt event exists. A live
`{kind:"unknown"}` execution outcome is rendered as reconciliation-required
(`executionSent:true` where applicable, no fabricated receipt). The transcript
model never invents a success that the ledger does not contain.

## Testing Strategy (TDD)

- `transcript-model.test.ts` — `buildTranscript` over synthetic ledger arrays
  (happy, denied) → assert header facts and step sequence.
- `transcript-render.test.ts` — `renderMarkdown` / `renderLines` over a fixed
  `DemoTranscript` → assert key lines; redaction test asserts a secret-bearing
  field becomes `[REDACTED]`.
- `scenario-driver.test.ts` — `runScenario` in deterministic mode for happy and
  denied → assert ledger event types/sequence and terminal status (ALLOWED +
  receipt vs REJECTED, `executionSent:false`, no receipt).
- `gateway-runtime.test.ts` — `buildGatewayRuntime` builds a usable runtime;
  `boot-gateway`'s existing tests remain green (behavior-preserving refactor).
- `sample-governed-run.golden.test.ts` — deterministic `both` render equals the
  committed Markdown.
- Live path is **not** in CI; an optional `*.live.test.ts` guarded by
  `TRACEGUARD_LIVE_DEMO=1` may run the live happy path and assert a receipt.

## File Structure

**New:**
- `packages/mcp-gateway/src/gateway-runtime.ts` (+ `gateway-runtime.test.ts`)
- `packages/mcp-gateway/src/demo/transcript-model.ts` (+ `.test.ts`)
- `packages/mcp-gateway/src/demo/transcript-render.ts` (+ `.test.ts`)
- `packages/mcp-gateway/src/demo/scenario-driver.ts` (+ `.test.ts`)
- `packages/mcp-gateway/src/demo/deterministic-deps.ts` (+ covered via driver tests)
- `packages/mcp-gateway/src/demo/fake-upstream.ts` (+ covered via driver tests)
- `packages/mcp-gateway/src/demo/sample-governed-run.golden.test.ts`
- `packages/mcp-gateway/src/bin/gateway-demo.ts`
- `docs/superpowers/demo/sample-governed-run.md` (committed golden)

**Modified:**
- `packages/mcp-gateway/src/boot-gateway.ts` (call `buildGatewayRuntime`)
- `.gitignore` (add `.demo-out/`)

## Global Constraints (carried)

- Node ≥ 22.12; TypeScript strict ESM with `.js` import specifiers on `.ts`
  sources; vitest (does not type-check — `pnpm typecheck` = `tsc --build` is the
  gate); zod / ajv as already pinned.
- `@traceguard/runtime` must not import `@modelcontextprotocol/sdk` nor
  `@traceguard/mcp-gateway` — not a concern here, since all new code lives in
  `@traceguard/mcp-gateway`.
- Fail-safe boundary is non-negotiable: pre-submit error ⇒ throw ⇒
  `EXECUTION_FAILED`; post-submit ambiguity ⇒ `{kind:"unknown"}` ⇒
  reconciliation-required, never retried, never fabricated.
- No raw exchange credentials or order bodies in the ledger or the transcript.
- Strict TDD for all production code; frequent commits; DRY; YAGNI.

## Assumptions

- `bitget-mcp-server --paper-trading` exposes a governed `spot_place_order` and is
  safe to hit repeatedly with paper orders (consistent with prior 3B live
  verification). Live mode depends on this; deterministic mode does not.
- The deterministic golden is regenerated intentionally (never auto-written in
  CI) so that a behavior change forces a visible, reviewed artifact diff.
