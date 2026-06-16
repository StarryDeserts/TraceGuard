# TraceGuard Phase 3 — Sub-project 3E-1: Governed Decision → Execution (internal `traceguard_*` tools, simulator slice)

**Document status:** Design v1.0 (approved for planning)
**Date:** 2026-06-16
**Package:** `@traceguard/mcp-gateway` (extends merged 1A + 1B + 2 + 3A + 3B + 3C + 3D on `main`), plus one additive payload schema in `@traceguard/schemas`
**Builds on:** 3D (governed `tools/call` routing — read-classes forward and return raw upstream results; `trade_like` dead-ends at a fail-closed `DECISION_ENVELOPE_REQUIRED`; one `RunCreated` anchor at boot; digest-only tool-call audit trail)

---

## 1. Scope & Position in Phase 3

### 1.1 What 3E-1 delivers

3E-1 builds the **governed decision → execution path** that 3D deferred (contract §9): a connected agent can now drive a trade intent through `propose → evaluate → (approve) → execute` against a **simulator** execution adapter, with every step audited on the ledger and every gate fail-closed. The path is exposed as **six explicit internal `traceguard_*` MCP tools**, not by intercepting `trade_like` upstream calls — the 3D `DECISION_ENVELOPE_REQUIRED` deny seam is left **exactly as-is**. The internal tools *are* the envelope path; raw `trade_like` upstream calls still correctly deny.

The decisive framing: **3E-1 is overwhelmingly a wiring job.** The Phase 1B authorization core and the Phase 2 runtime already implement Decision-Envelope validation, policy evaluation, approval transitions, authorization issuance, the burn-before-execute guard, and execution settlement as pure, event-sourced library functions (`proposeDecision`, `resolveAuthorizationGateway`, `approveApproval` / `rejectApproval`, `executionOrchestrator`, `createSimulatorAdapter`). 3E-1 mints decision/run identifiers, builds the `EvaluationContext` and `ActionDigestInput` from tool arguments, threads these functions onto the gateway's ledger, and maps their outcomes to precise `traceguard.errorCode` / `traceguard.status` results. **Nothing in the trading-decision core is rewritten.**

Concretely, 3E-1 adds:

1. **Six internal tools** — `traceguard_start_run`, `traceguard_record_decision`, `traceguard_request_execution`, `traceguard_check_approval`, `traceguard_execute_authorized_action`, `traceguard_finish_run` — surfaced in `tools/list` alongside the governed upstream read tools, and dispatched in `tools/call` ahead of the upstream-forward path.
2. **Decision → policy evaluation** — `record_decision` constructs a `DecisionEnvelope` from its arguments and calls `proposeDecision` wholesale (validate **and** evaluate), emitting `DecisionProposed → DecisionValidated → PolicyEvaluationStarted → PolicyEvaluated` (or a fail-closed `DecisionRejected`). The policy outcome is computed **here** and cached.
3. **Authorization gateway + inline execution** — `request_execution` branches on the cached outcome: **allow** issues an authorization and runs the execution orchestrator inline against the simulator (burn-before-execute, `ExecutionCompleted`); **require_approval** emits `ApprovalRequested` and returns **non-blocking** `APPROVAL_REQUIRED`; **block** emits nothing further and fails closed `POLICY_BLOCKED`.
4. **Non-blocking human approval** — an out-of-band **operator seam** (`handle.approve` / `handle.reject` on the `GatewayHandle`) models the human approver (human ≠ agent). The agent polls `check_approval` and, once approved, calls `execute_authorized_action`; the original `request_execution` MCP call never blocks.
5. **One additive schema** — `RunStartedPayload` in `@traceguard/schemas` (the `runStatusProjection` already maps `RunStarted → "capturing"`; only the payload schema is missing).

### 1.2 What 3E-1 does NOT build (deferred to 3E-2)

- **Upstream-forward argument JSON-Schema validation** (`ajv` against each tool's `inputSchema`) and **result redaction** (contract §9.3 / §20). 3E-1 governs the *decision* path; the read-forward path from 3D stays byte-for-byte (args forwarded as received, results returned verbatim, digests persisted). These two genuinely-new hygiene concerns are 3E-2.
- **Real (`bitget_live`) execution.** 3E-1 wires only the **simulator** adapter. `executionAdapter` defaults to `"simulator"`; any other value fails closed `CAPABILITY_UNAVAILABLE`.
- **`replay` / diff reconstruction**, **OTel spans**, **idempotency keys** (§17), **durable (file/sqlite) ledger** (stays behind the unchanged `LedgerStore`), **hosted HTTP transport**, and the `mcp-core` / `apps/*` package split — everything stays in `@traceguard/mcp-gateway`.
- **Persistent approval store / Telegram approver.** The operator seam is an in-process function on the handle; a real approval channel (web / telegram) is later-phase.

### 1.3 Locked decisions (from brainstorming, 2026-06-16)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Surface shape | **Six explicit internal `traceguard_*` tools**, dispatched before the upstream-forward path. The 3D `trade_like → DECISION_ENVELOPE_REQUIRED` deny seam is **untouched** — internal tools are the governed path, not interception. |
| D2 | Decision-state carrier | **In-memory decision cache** (`Map<decisionId, CachedDecision>`), not a ledger projection. The ledger remains the source of truth for *events*; the cache holds the derived material (`ActionDigestInput` base, policy outcome, `policyEvaluationId`, `decisionHash`, summary) so `request_execution` and `execute_authorized_action` recompute an **identical** action digest. Rebuilding this from a projection is deferred. |
| D3 | Approval model | **Non-blocking.** `request_execution` returns `APPROVAL_REQUIRED` and stops; approval happens out-of-band via the `handle.approve` **operator seam**; the agent resumes via `check_approval` → `execute_authorized_action`. The MCP call never blocks on a human. |
| D4 | Execution adapter | **Simulator only.** `createSimulatorAdapter({ hash })`; all orchestrator `gates` / `executionGates` are `false` in this slice, so only the four burn-guard reasons (`missing_authorization`, `expired_authorization`, `already_consumed`, `action_digest_mismatch`) are reachable. |
| D5 | New schema footprint | **One additive export:** `RunStartedPayload`. No existing schema is modified except `run-payloads.ts` (one new export) and the barrel (already re-exports `./run-payloads.js`). |

### 1.4 Disclosure — refinements beyond a literal reading of the approved design

Grounding the reference implementations surfaced four details the approved Section A/B/C framing did not spell out; each is a faithful tightening, disclosed here per the full-coherence preference:

1. **`proposeDecision` does not mint the `decisionId`** — it reads `envelope.id` (`propose-decision.ts:162`). `record_decision` therefore mints `decisionId = deps.newId.next("dec")` and sets it as the envelope `id`.
2. **Reject-vs-block disambiguation.** `proposeDecision` returns `{ outcome: "block" }` for **both** a validation failure (fail-closed) and a genuine policy block. The two are distinguished by **the presence of a `PolicyEvaluated` event** in `result.events`: absent ⇒ validation reject ⇒ `DECISION_INVALID`; present ⇒ real evaluation ⇒ cache the outcome.
3. **The action digest finalizes at `request_execution` time, not `record_decision` time.** `ActionDigestInput.executionAdapter` is a required field (`action-digest-input.ts:25`), and `executionAdapter` is a `request_execution` argument. So the cache holds the digest **base** (every `ActionDigestInput` field except `executionAdapter`); `request_execution` and `execute_authorized_action` assemble the full input as `{ ...base, executionAdapter }`. The agent **must pass the same `executionAdapter`** to `execute_authorized_action` as it did to `request_execution`, or the burn guard fires `action_digest_mismatch` — correct fail-closed behaviour.
4. **`executionOrchestrator` returns only `{ outcome }`** (`"denied" | "rejected" | "completed" | "unknown" | "failed"`) — the fine-grained reason lives in the emitted terminal event (`AuthorizationRejected.reasonCode` for `denied`, `ExecutionRejected.reasonCode` for `rejected`). Handlers therefore **read back the terminal event from the ledger** to map the precise `traceguard.errorCode` (§7.2). And `request_execution`'s **block** branch — written `{ status: "BLOCKED" }` in the approved Section B — is realised as a fail-closed `isError: true` result carrying `traceguard.errorCode: "POLICY_BLOCKED"` plus `matchedRules` / `executionSent: false`, consistent with default-deny.

---

## 2. Architecture

3E-1 preserves the functional-core / imperative-shell split. The policy/digest/approval/execution logic is already pure and lives in `@traceguard/domain`, `@traceguard/policy-engine`, and `@traceguard/runtime`. The new gateway code is (a) **pure derivation** (`default-policy.ts`, `evaluation-context.ts`, `internal-tools.ts`) and (b) **thin imperative handlers** (`internal-tool-handlers.ts`) that read the ledger head, call a core function, append the returned events, and shape an MCP result. The in-memory `decision-cache.ts` is the one piece of mutable in-process state.

### 2.1 Module map

**Under `packages/mcp-gateway/src/`:**

```text
default-policy.ts          PURE   DEFAULT_POLICY: Policy (leverage_gt 3 → block; notional_gt T → require_approval;
                                  else allow via defaultEffect "block" + explicit allow rule); bootGateway-overridable
evaluation-context.ts      PURE   buildEvaluationContext(state, run, toolRiskClass) → EvaluationContext;
                                  policyVersionId(policy); intendedUpstreamTool(marketType); isoPlusSeconds(iso, n)
internal-tools.ts          PURE   the 6 tool definitions (name + description + inputSchema) + INTERNAL_TOOL_NAMES set
decision-cache.ts          IMPURE in-memory Map<decisionId, CachedDecision>; createDecisionCache(); ApprovalIndex
internal-tool-context.ts   WIRING InternalToolContext type ({ store, deps, audit, policy, adapter, run, cache, ttls })
internal-tool-handlers.ts  SHELL  the 6 async handlers + dispatchInternalTool(ctx, state, name, args)
gateway-server.ts          MOD    ListTools merges INTERNAL_TOOL_DEFS with state.servedTools;
                                  CallTool dispatches INTERNAL_TOOL_NAMES.has(name) → internal else handleToolCall
boot-gateway.ts            MOD    builds InternalToolContext + RunContext; exposes handle.approve / handle.reject
index.ts                   MOD    barrel: add default-policy / evaluation-context / internal-tools /
                                  decision-cache / internal-tool-context / internal-tool-handlers
```

**Under `packages/schemas/src/`:**

```text
run-payloads.ts            MOD    add RunStartedPayload  (barrel already re-exports ./run-payloads.js)
```

The 3D files `call-router.ts`, `tool-call-events.ts`, and the upstream-forward path of `call-handler.ts` are **untouched**. `gateway-server.ts` gains an internal-dispatch branch but keeps delegating every non-internal name to the existing `handleToolCall`.

### 2.2 Rejected alternative

**Intercept `trade_like` upstream `tools/call` and synthesise the envelope from the raw arguments.** Rejected: the agent's raw `place_order` arguments do not carry a thesis, evidence references, confidence, or a stable decision identity — the governance core *requires* a `DecisionEnvelope`, not an order payload. Reconstructing one from order args would fabricate the very provenance TraceGuard exists to capture, and would fuse policy evaluation into the upstream-forward shell. Explicit `traceguard_*` tools make the agent state its decision and evidence first-class, keep the pure governance functions reusable and golden-testable, and leave 3D's read-forward seam clean.

### 2.3 Why an in-memory cache rather than a projection (D2)

`request_execution` needs three things `record_decision` already computed: the policy **outcome**, the **`policyEvaluationId`** (surfaced only inside the `PolicyEvaluated` payload), and the **`ActionDigestInput` base** (so the action digest reproduces byte-for-byte at issue, approve, and execute time). All three are recoverable from the ledger by re-reading and re-projecting the decision aggregate, but for the demo slice an in-process `Map<decisionId, CachedDecision>` is simpler, keeps the digest material in one typed place, and avoids inventing a decision-material projection this phase. The ledger stays the source of truth for **events**; the cache is a derived, rebuildable index. Rebuilding it from a projection (for multi-process / durable deployments) is an explicit 3E-2+ follow-up.

---

## 3. Data Flow

### 3.1 Startup delta (`bootGateway` happy path)

3D's boot pipeline (open → list → reconcile → append → read → project → `buildGatewayState` → mint `runId` → `RunCreated` → build `GatewayCallContext`) is unchanged through the `RunCreated` anchor. 3E-1 additionally builds the internal-tool wiring on the happy path:

```text
... (3D steps through RunCreated unchanged; produces `state`, `runId`, upstream `callCtx`) ...
N.   run   = { runId, mode: "safe_demo", agentName: undefined, intent: undefined }   // RunContext
N+1. cache = createDecisionCache()
N+2. adapter = createSimulatorAdapter({ hash: deps.hash })
N+3. internalCtx = { store, deps, audit, policy: DEFAULT_POLICY, adapter, run, cache,
                     ttls: { approvalSeconds: 900, authorizationSeconds: 900 } }
N+4. server = createGatewayServer(state, callCtx, internalCtx)
→ return { state, server, client, runId, approve, reject }   // operator seam closures over internalCtx
```

`bootGateway` gains two optional args (both with defaults): `policy?: Policy` (defaults to `DEFAULT_POLICY`) and `now-derived ttls`. Degraded boot is **unchanged** from 3D: no run, no internal context; `tools/list` shows no internal tools and `tools/call` on any name short-circuits to `TOOL_CALL_NOT_AVAILABLE`.

### 3.2 The governed workflow (the six tools)

```text
start_run ──► record_decision ──► request_execution ──┬─[allow]──────────────► ALLOWED  (receipt) ──► finish_run
                                                       │
                                                       ├─[require_approval]──► APPROVAL_REQUIRED
                                                       │        │  (agent loops)        │
                                                       │        ▼                        │
                                                       │   check_approval ◄── handle.approve (operator, out-of-band)
                                                       │        │ approved                │
                                                       │        ▼                        │
                                                       │   execute_authorized_action ──► EXECUTED (receipt) ──► finish_run
                                                       │
                                                       └─[block]─────────────► POLICY_BLOCKED (isError) ──► finish_run
```

### 3.3 `request_execution` — the three branches (allow / require_approval / block)

```text
cached = cache.get(decisionId)              // unknown ⇒ DECISION_INVALID
input  = { ...cached.digestBase, executionAdapter }      // finalize ActionDigestInput
digest = computeActionDigest(input, hash)

cached.outcome === "allow":
    head ← store.head(ws)
    res  ← resolveAuthorizationGateway({ outcome:"allow", actionDigestInput: input,
              policyEvaluationId: cached.policyEvaluationId, summary: cached.summary, ... }, deps)
    store.append(head, res.events)          // AuthorizationIssued (authz aggregate, actionDigest = digest)
    orch ← executionOrchestrator({ attemptedActionDigest: digest, adapterType: executionAdapter,
              gates:{…all false}, executionGates:{…all false} }, { …deps, store, adapter })
    // orchestrator: authorizationProjection → authorizeExecution → BURN (ExecutionRequested +
    //   AuthorizationConsumed) → adapter.call → settleExecution (ExecutionCompleted + RunCompleted)
    completed ⇒ read back ExecutionCompleted ⇒ { isError:false, status:"ALLOWED", executionId, receipt }
    denied|rejected|unknown|failed ⇒ read back terminal event ⇒ mapped errorCode (§7.2)

cached.outcome === "require_approval":
    head ← store.head(ws)
    res  ← resolveAuthorizationGateway({ outcome:"require_approval", actionDigestInput: input,
              channelOptions:["mcp_app"], approvalExpiresAt, ... }, deps)   // ApprovalRequested
    store.append(head, res.events)
    approvalId ← res.events[0].payload.approvalId
    cache.approvalIndex.set(approvalId, { runId, decisionId })
    return { isError:false, status:"APPROVAL_REQUIRED", approvalId, runId, expiresAt: approvalExpiresAt }

cached.outcome === "block":
    return { isError:true, errorCode:"POLICY_BLOCKED", matchedRules: cached.matchedRules, executionSent:false }
```

**Non-blocking invariant:** the `require_approval` branch appends exactly one `ApprovalRequested` and returns immediately; no human wait, no polling inside the handler. The agent owns the wait loop via `check_approval`.

### 3.4 Approval → execution (operator seam + `execute_authorized_action`)

```text
operator (out-of-band):  handle.approve(approvalId, { approvedBy, channel })
    all   ← store.read(ws)
    state ← approvalProjection(eventsForApproval(all, approvalId))   // pending, carries actionDigest/decisionId/runId
    head  ← store.head(ws)
    res   ← approveApproval({ approvalState: state, approvedBy, approvalChannel: channel,
              authorizationExpiresAt, ... }, deps)     // ApprovalApproved (user) + AuthorizationIssued (system)
    store.append(head, res.events)                     // authz.actionDigest == the ApprovalRequested digest

agent:  check_approval({ approvalId })
    state ← approvalProjection(eventsForApproval(store.read(ws), approvalId))
    "approved" ⇒ { status:"APPROVED", authorizationId, authorizationExpiresAt }
    "pending"  ⇒ now>=expiresAt ? APPROVAL_EXPIRED : { status:"PENDING" }
    "rejected" ⇒ { status:"REJECTED" } ; "expired" ⇒ APPROVAL_EXPIRED ; "consumed" ⇒ { status:"CONSUMED" }

agent:  execute_authorized_action({ runId, decisionId, authorizationId, executionAdapter })
    cached = cache.get(decisionId)                     // unknown ⇒ DECISION_INVALID
    input  = { ...cached.digestBase, executionAdapter } ; digest = computeActionDigest(input, hash)
    orch ← executionOrchestrator({ attemptedActionDigest: digest, adapterType: executionAdapter,
              gates:{…false}, executionGates:{…false} }, { …deps, store, adapter })
    completed ⇒ { status:"EXECUTED", executionId, receipt }
    denied    ⇒ read back AuthorizationRejected.reasonCode ⇒ AUTHORIZATION_MISSING / APPROVAL_EXPIRED /
                 AUTHORIZATION_CONSUMED / ACTION_DIGEST_MISMATCH        (§7.2)
```

The operator-issued authorization carries the **same** `actionDigest` as the `ApprovalRequested` (read off the projection by `approveApproval`), so the agent's `execute_authorized_action` digest matches **iff** it passes the same `executionAdapter` it used at `request_execution` time. A second `execute_authorized_action` finds the authorization already consumed (the burn appended `AuthorizationConsumed`) → `denied` / `already_consumed` → `AUTHORIZATION_CONSUMED`.

---

## 4. Public Types & Signatures

### 4.1 `@traceguard/schemas` — additive `RunStartedPayload`

`run-payloads.ts` gains one export (alongside `RunCreatedPayload` / `RunCompletedPayload` / `RunFailedPayload`); optional fields are **omitted when absent** (house convention):

```ts
export const RunStartedPayload = z
  .object({
    runId: z.string().min(1),
    startedAt: IsoTimestamp,
    agentName: z.string().min(1).optional(),
    intent: z.string().min(1).optional(),
    mode: z.string().min(1).optional(),       // WorkspaceMode value, e.g. "safe_demo"
  })
  .strict();
export type RunStartedPayload = z.infer<typeof RunStartedPayload>;
```

No other schema changes: `runStatusProjection` already maps `RunStarted → "capturing"` (`run-status-projection.ts:10`); `AggregateType` already contains `run`; `eventType` is an open `z.string().min(1)`.

### 4.2 `default-policy.ts` (pure)

```ts
import type { Policy } from "@traceguard/schemas";

export const NOTIONAL_APPROVAL_THRESHOLD_USDT = "1000"; // DecimalString

export const DEFAULT_POLICY: Policy = {
  version: 1,
  defaultEffect: "block",
  rules: [
    { id: "block-high-leverage",      effect: "block",
      conditions: [{ kind: "leverage_gt", value: "3" }] },
    { id: "approve-large-notional",   effect: "require_approval",
      conditions: [{ kind: "notional_gt", value: NOTIONAL_APPROVAL_THRESHOLD_USDT }] },
    { id: "allow-trade-like",         effect: "allow",
      conditions: [{ kind: "tool_risk_class_eq", value: "trade_like" }] },
  ],
};
```

Rule precedence is whatever `@traceguard/policy-engine`'s `evaluate` already implements (3E-1 introduces no new evaluation semantics). The intent: **leverage > 3 → block; else notional > 1000 USDT → require_approval; else allow.** `bootGateway` accepts a `policy?` override; the default is bundled for the zero-config demo.

### 4.3 `evaluation-context.ts` (pure)

```ts
import type { EvaluationContext, Policy, RiskClass } from "@traceguard/schemas";
import type { GatewayState } from "./gateway-state.js";
import type { RunContext } from "./internal-tool-context.js";

export const EVALUATOR_VERSION = "traceguard-3e1";

export function policyVersionId(policy: Policy): string;        // `String(policy.version)`
export function intendedUpstreamTool(marketType: string): string; // spot→"spot_place_order", futures→"futures_place_order", tokenized_stock→"tstock_place_order"
export function isoPlusSeconds(iso: string, seconds: number): string; // new Date(iso)+s → ISO

export function buildEvaluationContext(
  state: GatewayState,
  run: RunContext,
  toolRiskClass: RiskClass,
  policy: Policy,
): EvaluationContext;
```

`buildEvaluationContext` returns:

| field | value |
|-------|-------|
| `runId` | `run.runId` |
| `policyVersionId` | `policyVersionId(policy)` (the `policy` argument) |
| `evaluatorVersion` | `EVALUATOR_VERSION` |
| `workspaceMode` | `run.mode` (`"safe_demo"`) |
| `manifestStatus` | `state.degraded ? "needs_review" : "approved"` (internal tools never run degraded, so effectively `"approved"`) |
| `snapshotAgeSeconds` | `0` (no live market snapshot in the simulator slice) |
| `toolRiskClass` | the argument (`"trade_like"` for a decision) |
| `instrumentAllowlist` | `[]` (the default policy gates on leverage/notional, not instrument) |

### 4.4 `internal-tools.ts` (pure tool definitions)

A frozen array `INTERNAL_TOOL_DEFS: ServedTool[]` (reusing the 3C `ServedTool` shape: `{ name, description, inputSchema }`) and `INTERNAL_TOOL_NAMES: ReadonlySet<string>`. Input schemas are plain JSON-Schema objects (the MCP wire shape), authored by hand to mirror the argument tables in §5.2 — not derived from Zod. Names:

```ts
export const INTERNAL_TOOL_NAMES = new Set([
  "traceguard_start_run",
  "traceguard_record_decision",
  "traceguard_request_execution",
  "traceguard_check_approval",
  "traceguard_execute_authorized_action",
  "traceguard_finish_run",
] as const);
```

### 4.5 `decision-cache.ts` (in-memory state)

```ts
import type { Effect, ActionDigestInput } from "@traceguard/schemas";
import type { AuthorizationSummary } from "@traceguard/domain";

export interface CachedDecision {
  decisionId: string;
  outcome: Effect;                                    // "allow" | "require_approval" | "block"
  matchedRules: string[];
  policyEvaluationId: string;                         // from the PolicyEvaluated payload
  decisionHash: string;                               // from the DecisionProposed payload
  summary: AuthorizationSummary;                      // { instrument, action, notionalUsdt?, leverage? }
  digestBase: Omit<ActionDigestInput, "executionAdapter">; // every digest field but the adapter
}

export interface DecisionCache {
  decisions: Map<string, CachedDecision>;
  approvalIndex: Map<string, { runId: string; decisionId: string }>; // approvalId → correlation
}

export function createDecisionCache(): DecisionCache;
```

### 4.6 `internal-tool-context.ts` (wiring)

```ts
import type { LedgerStore } from "@traceguard/event-ledger";
import type { ReconcileDeps } from "@traceguard/tool-manifest";   // { clock, newId, hash }
import type { Policy } from "@traceguard/schemas";
import type { ExecutionAdapter } from "@traceguard/domain";
import type { CallAudit } from "./tool-call-events.js";
import type { DecisionCache } from "./decision-cache.js";

export interface RunContext {
  runId: string;
  mode: string;                 // WorkspaceMode value; "safe_demo" for the demo
  agentName?: string;
  intent?: string;
}

export interface ApprovalTtls {
  approvalSeconds: number;       // default 900
  authorizationSeconds: number;  // default 900
}

export interface InternalToolContext {
  store: LedgerStore;
  deps: ReconcileDeps;
  audit: CallAudit;             // { workspaceId, runId, providerConnectionId }
  policy: Policy;
  adapter: ExecutionAdapter;    // simulator in 3E-1
  run: RunContext;              // mutated in place by start_run (agentName/intent/mode)
  cache: DecisionCache;
  ttls: ApprovalTtls;
}
```

### 4.7 `internal-tool-handlers.ts` (shell)

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GatewayState } from "./gateway-state.js";
import type { InternalToolContext } from "./internal-tool-context.js";

export type InternalErrorCode =
  | "DECISION_INVALID"
  | "POLICY_BLOCKED"
  | "APPROVAL_REQUIRED"        // carried as a non-error status, listed for completeness
  | "APPROVAL_EXPIRED"
  | "AUTHORIZATION_MISSING"
  | "AUTHORIZATION_CONSUMED"
  | "ACTION_DIGEST_MISMATCH"
  | "EXECUTION_UNKNOWN"
  | "EXECUTION_FAILED"
  | "CAPABILITY_UNAVAILABLE"
  | "RUN_NOT_FOUND";

// Success / non-error results carry a `traceguard.status`; failures carry `traceguard.errorCode`.
export function internalOk(status: string, extra: Record<string, unknown>): CallToolResult;
export function internalErr(code: InternalErrorCode, toolName: string, message?: string): CallToolResult;

export async function dispatchInternalTool(
  ctx: InternalToolContext,
  state: GatewayState,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult>;
```

`internalOk` / `internalErr` build the same loose `CallToolResult` shape 3D's `denyCall` uses (`isError`, a human `content[0].text`, and a top-level `traceguard` field that survives the client-side `CallToolResultSchema` parse). `dispatchInternalTool` validates `args.runId === ctx.run.runId` where the tool takes a `runId` (else `RUN_NOT_FOUND`) and routes to the per-tool handler. Reference for the two non-obvious handlers:

**`record_decision`** — mint id, build envelope, propose, disambiguate, cache:

```ts
const decisionId = ctx.deps.newId.next("dec");
const envelope = {
  id: decisionId,
  instrument: args.instrument, marketType: args.marketType, action: args.action,
  thesis: args.thesis, evidenceRefs: args.evidenceRefs,
  ...(args.confidence !== undefined ? { confidence: args.confidence } : {}),
  ...(args.requestedNotionalUsdt !== undefined ? { requestedNotionalUsdt: args.requestedNotionalUsdt } : {}),
  ...(args.requestedLeverage !== undefined ? { requestedLeverage: args.requestedLeverage } : {}),
};
const context = buildEvaluationContext(state, ctx.run, "trade_like", ctx.policy);
const head = await ctx.store.head(ctx.audit.workspaceId);
const result = proposeDecision(
  { workspaceId: ctx.audit.workspaceId, actorId: ctx.run.agentName, envelope,
    policy: ctx.policy, context, previousEventHash: head }, ctx.deps);
await ctx.store.append(head, result.events);

const evaluated = result.events.find((e) => e.eventType === "PolicyEvaluated");
if (evaluated === undefined) return internalErr("DECISION_INVALID", name);   // a DecisionRejected fired
const proposed = result.events.find((e) => e.eventType === "DecisionProposed")!;
const policyEvaluationId = (evaluated.payload as { evaluationId: string }).evaluationId;
const decisionHash      = (proposed.payload as { decisionHash: string }).decisionHash;

ctx.cache.decisions.set(decisionId, {
  decisionId,
  outcome: result.decision.outcome,
  matchedRules: result.decision.matchedRules,
  policyEvaluationId, decisionHash,
  summary: {
    instrument: args.instrument, action: args.action,
    ...(args.requestedNotionalUsdt !== undefined ? { notionalUsdt: args.requestedNotionalUsdt } : {}),
    ...(args.requestedLeverage !== undefined ? { leverage: args.requestedLeverage } : {}),
  },
  digestBase: {
    workspaceId: ctx.audit.workspaceId, runId: ctx.run.runId, decisionId,
    providerConnectionId: ctx.audit.providerConnectionId,
    toolName: intendedUpstreamTool(args.marketType),
    toolManifestHash: state.manifestHash!,                    // non-degraded ⇒ 64-hex
    policyVersionId: policyVersionId(ctx.policy),
    workspaceMode: ctx.run.mode,
    instrument: args.instrument, marketType: args.marketType, action: args.action,
    ...(args.requestedNotionalUsdt !== undefined ? { requestedNotionalUsdt: args.requestedNotionalUsdt } : {}),
    ...(args.requestedLeverage !== undefined ? { requestedLeverage: args.requestedLeverage } : {}),
  },
});
return internalOk("validated", { decisionId, decisionHash });
```

**`execute_authorized_action`** — orchestrate, then read back the terminal reason on denial:

```ts
const cached = ctx.cache.decisions.get(args.decisionId);
if (cached === undefined) return internalErr("DECISION_INVALID", name);
if (args.executionAdapter !== ctx.adapter.adapterType) return internalErr("CAPABILITY_UNAVAILABLE", name);
const input  = { ...cached.digestBase, executionAdapter: args.executionAdapter };
const digest = computeActionDigest(input, ctx.deps.hash);
const { outcome } = await executionOrchestrator(
  { workspaceId: ctx.audit.workspaceId, runId: ctx.run.runId, decisionId: args.decisionId,
    attemptedActionDigest: digest, adapterType: args.executionAdapter,
    gates: { workspaceLocked: false, manifestChanged: false, policyChanged: false },
    executionGates: { capabilityUnavailable: false, snapshotStale: false, manifestUnapproved: false } },
  { ...ctx.deps, store: ctx.store, adapter: ctx.adapter });

if (outcome === "completed") {
  const ev = await lastEvent(ctx.store, ctx.audit.workspaceId, ctx.run.runId, "ExecutionCompleted");
  return internalOk("EXECUTED", { executionId: ev.executionId, receipt: pickReceipt(ev) });
}
if (outcome === "denied")  return internalErr(mapGuardReason(await lastReason("AuthorizationRejected")), name);
if (outcome === "rejected") return internalErr(mapExecReason(await lastReason("ExecutionRejected")), name);
if (outcome === "unknown") return internalErr("EXECUTION_UNKNOWN", name);
return internalErr("EXECUTION_FAILED", name);  // "failed" (adapter threw) — unreachable with the simulator
```

`mapGuardReason` (§7.2) maps the burn-guard `reasonCode` enum to an `InternalErrorCode`; `lastReason` / `lastEvent` re-read `store.read(ws, runId)` and pick the last matching event's payload. The **`allow`** branch of `request_execution` shares the same post-orchestrator mapping.

### 4.8 `gateway-server.ts` (modify)

```ts
import { dispatchInternalTool, type InternalToolContext } from "./internal-tool-handlers.js";
import { INTERNAL_TOOL_DEFS, INTERNAL_TOOL_NAMES } from "./internal-tools.js";

export function createGatewayServer(
  state: GatewayState,
  callCtx?: GatewayCallContext,
  internalCtx?: InternalToolContext,
): Server {
  const server = new Server(GATEWAY_SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      ...(internalCtx !== undefined ? INTERNAL_TOOL_DEFS : []),
      ...state.servedTools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments ?? {};
    if (internalCtx !== undefined && INTERNAL_TOOL_NAMES.has(name))
      return dispatchInternalTool(internalCtx, state, name, args);
    return handleToolCall(state, callCtx, name, args);
  });

  return server;
}
```

Internal tools are listed/dispatched **only** when `internalCtx` is present (non-degraded boot). A name collision between an internal tool and an upstream tool is impossible in practice (the `traceguard_` prefix is reserved); internal names win by dispatch order regardless.

### 4.9 `boot-gateway.ts` (modify) — handle + operator seam

```ts
export interface GatewayHandle {
  state: GatewayState;
  server: Server;
  client: UpstreamManifestClient;
  runId?: string;
  approve?: (approvalId: string, by: { approvedBy: string; channel: ApprovalChannel }) => Promise<ApprovalOutcome>;
  reject?:  (approvalId: string, by: { rejectedBy: string; channel: ApprovalChannel; reason?: string }) => Promise<ApprovalOutcome>;
}

export interface BootGatewayArgs {
  /* …3D fields… */
  policy?: Policy;                       // defaults to DEFAULT_POLICY
}
```

`approve` / `reject` close over `internalCtx`, read the workspace events, project the target approval via `eventsForApproval`, call `approveApproval` / `rejectApproval`, append the result, and return the `ApprovalOutcome` (`"approved"` / `"rejected"` / `"expired"` / `"illegal_transition"`). They are **operator-facing** (the human approver / a future web/telegram channel), deliberately **not** MCP tools — a human is not the agent.

```ts
async function approve(approvalId, by) {
  const all   = await store.read(ws);
  const state = approvalProjection(eventsForApproval(all, approvalId));
  const head  = await store.head(ws);
  const res = approveApproval({
    workspaceId: ws, approvalState: state, approvedBy: by.approvedBy, approvalChannel: by.channel,
    authorizationExpiresAt: isoPlusSeconds(deps.clock.now(), ttls.authorizationSeconds),
    previousEventHash: head,
  }, deps);
  if (res.events.length > 0) await store.append(head, res.events);
  return res.outcome;
}
```

`eventsForApproval(events, approvalId)` (a small pure helper, colocated in `internal-tool-handlers.ts`) returns events where `aggregateType === "approval" && aggregateId === approvalId`, or `payload.approvalId === approvalId` (catches the correlated `AuthorizationIssued`). `approvalProjection` over that slice yields the single approval's state. (Demo scope: one decision/approval per run; multi-approval-per-run isolation is a 3E-2+ refinement.)

---

## 5. Downstream MCP Server Behaviour

### 5.1 `tools/list`

On a non-degraded boot, `tools/list` returns the **six `traceguard_*` tools first**, then the governed upstream read tools (`servedTools`, unchanged from 3C/3D — the blocked `withdraw` / `transfer` / `cancel_withdrawal` / `manage_subaccounts` remain hidden). A degraded boot returns neither (empty list), exactly as 3D.

### 5.2 The six internal tools — arguments & results

| Tool | Arguments | Success (`isError:false`) | Emits | Fail-closed |
|------|-----------|---------------------------|-------|-------------|
| `traceguard_start_run` | `{ agentName, intent, mode? }` | `{ status:"RUN_STARTED", runId, policyVersionId, toolManifestHash }` | `RunStarted` (once; idempotent if already `capturing`+) | — |
| `traceguard_record_decision` | `{ runId, instrument, marketType, action, thesis, confidence?, evidenceRefs, requestedNotionalUsdt?, requestedLeverage? }` | `{ status:"validated", decisionId, decisionHash }` | `DecisionProposed → DecisionValidated → PolicyEvaluationStarted → PolicyEvaluated` | `DecisionRejected` ⇒ `DECISION_INVALID` |
| `traceguard_request_execution` | `{ runId, decisionId, executionAdapter? }` (default `"simulator"`) | allow ⇒ `{ status:"ALLOWED", executionId, receipt }`; require_approval ⇒ `{ status:"APPROVAL_REQUIRED", approvalId, runId, expiresAt }` | allow ⇒ `AuthorizationIssued`, `ExecutionRequested`, `AuthorizationConsumed`, `ExecutionCompleted`, `RunCompleted`; require_approval ⇒ `ApprovalRequested` | block ⇒ `POLICY_BLOCKED`; unknown id ⇒ `DECISION_INVALID`; non-simulator ⇒ `CAPABILITY_UNAVAILABLE` |
| `traceguard_check_approval` | `{ approvalId }` | `{ status:"APPROVED", authorizationId, authorizationExpiresAt }` / `{ status:"PENDING" }` / `{ status:"REJECTED" }` / `{ status:"CONSUMED" }` | none (pure read) | expired ⇒ `APPROVAL_EXPIRED` |
| `traceguard_execute_authorized_action` | `{ runId, decisionId, authorizationId, executionAdapter? }` | `{ status:"EXECUTED", executionId, receipt }` | `ExecutionRequested`, `AuthorizationConsumed`, `ExecutionCompleted`, `RunCompleted` | guard ⇒ `AUTHORIZATION_MISSING` / `APPROVAL_EXPIRED` / `AUTHORIZATION_CONSUMED` / `ACTION_DIGEST_MISMATCH`; unknown id ⇒ `DECISION_INVALID` |
| `traceguard_finish_run` | `{ runId, outcome }` (`"succeeded" | "failed"`) | `{ status, runId }` (the projected terminal status) | `RunCompleted` or `RunFailed` — **only if** the run is not already terminal | — |

`start_run` is idempotent: it reads `runStatusProjection(store.read(ws, runId))`; if already `"capturing"` or beyond it returns the existing `runId` **without** re-emitting `RunStarted`, and merges `agentName` / `intent` / `mode` into the in-memory `RunContext`. `finish_run` is idempotent: if the projected status is already `"completed"` / `"failed"` (e.g. the allow path already settled), it returns that status without emitting a duplicate terminal event — this is why the allow path's inline `RunCompleted` and a later `finish_run` do not double-complete the run.

`receipt` is `{ receiptRef, receiptHash, finalStatus }` read from the `ExecutionCompleted` payload (the simulator returns `finalStatus: "simulated"`).

---

## 6. Persistence Wiring

- 3E-1 reuses the **same** `LedgerStore` instance 3D wired through `bootGateway`; no new store, no schema migration.
- Every internal handler follows the established optimistic-concurrency pattern: `head ← store.head(ws)`, call the pure core function with `previousEventHash: head`, `store.append(head, events)`. The pure functions return a correctly **chained** event list, so a multi-event append (e.g. `proposeDecision`'s four events, or the allow path's authorization+execution sequence) is one atomic `append`. Sequential stdio ⇒ no contention; the optimistic check still guards a programming error.
- The decision/run/approval/authorization/execution aggregates all chain onto the **single workspace hash chain** (the events carry their own `aggregateType`/`aggregateId`, but `previousEventHash` threads the global head — identical to how Phase 2 and 3D append).
- **No raw order payloads in the ledger.** The governance events carry the decision envelope's *material* and digests (`decisionHash`, `actionDigest`, `receiptHash`), never raw exchange credentials or order bodies. The simulator produces a synthetic `receiptRef` / `receiptHash`; nothing touches a real exchange in this slice.

---

## 7. Fail-Closed & Error Semantics

### 7.1 Error map (agent-visible `traceguard.errorCode`)

| Condition | Source | `errorCode` | `isError` |
|-----------|--------|-------------|-----------|
| Envelope fails validation (`proposeDecision` emits `DecisionRejected`) | `record_decision` | `DECISION_INVALID` | true |
| Unknown `decisionId` (not in cache) | `request_execution` / `execute_authorized_action` | `DECISION_INVALID` | true |
| `runId` ≠ the boot run | any tool taking `runId` | `RUN_NOT_FOUND` | true |
| Policy outcome `block` | `request_execution` | `POLICY_BLOCKED` (+ `matchedRules`, `executionSent:false`) | true |
| Policy outcome `require_approval` | `request_execution` | — (`status:"APPROVAL_REQUIRED"`) | **false** |
| Approval/authorization lapsed (`now ≥ expiresAt`, or guard `expired_authorization`) | `check_approval` / execute | `APPROVAL_EXPIRED` | true |
| Burn guard `missing_authorization` | execute | `AUTHORIZATION_MISSING` | true |
| Burn guard `already_consumed` (double execute) | execute | `AUTHORIZATION_CONSUMED` | true |
| Burn guard `action_digest_mismatch` (wrong `executionAdapter` / tampered) | execute | `ACTION_DIGEST_MISMATCH` | true |
| Adapter returns `unknown` | execute | `EXECUTION_UNKNOWN` | true |
| Non-simulator `executionAdapter` requested | request/execute | `CAPABILITY_UNAVAILABLE` | true |
| Orchestrator `failed` (adapter threw → `RunFailed`) | execute | `EXECUTION_FAILED` | true (unreachable with the simulator) |

Reserved-but-unreachable in the simulator slice (all gates `false`): `SNAPSHOT_STALE`, `PROVIDER_DEGRADED`, `WORKSPACE_LOCKED`, `MANIFEST_UNAPPROVED`. They are documented so 3E-2 / live-adapter work has stable codes.

### 7.2 Reading back the terminal reason

Because `executionOrchestrator` returns only `{ outcome }`, the precise reason is recovered from the ledger:

```ts
function mapGuardReason(reasonCode: string): InternalErrorCode {
  switch (reasonCode) {
    case "missing_authorization": return "AUTHORIZATION_MISSING";
    case "expired_authorization": return "APPROVAL_EXPIRED";
    case "already_consumed":      return "AUTHORIZATION_CONSUMED";
    case "action_digest_mismatch":return "ACTION_DIGEST_MISMATCH";
    default:                      return "AUTHORIZATION_MISSING"; // workspace_locked / manifest_changed / policy_changed (unreachable here)
  }
}
```

`outcome === "denied"` ⇒ read the last `AuthorizationRejected` payload's `reasonCode` ⇒ `mapGuardReason`. `outcome === "rejected"` ⇒ read the last `ExecutionRejected` payload's `reasonCode` ⇒ `mapExecReason` (the `executionGates` reasons — all unreachable in this slice, mapped to `CAPABILITY_UNAVAILABLE` / `SNAPSHOT_STALE` / `MANIFEST_UNAPPROVED` for forward-compat).

### 7.3 Default-deny holds end-to-end

The only path that reaches the simulator is `allow` (or an operator-approved `require_approval`) with a matching action digest and an unconsumed, unexpired authorization. Every other path denies with an audited, machine-readable reason. A malformed payload (`*.parse` throws inside a core builder) propagates as a programming error rather than persisting a bad event. stdout hygiene is unchanged: the downstream `StdioServerTransport` owns stdout; diagnostics stay on stderr.

---

## 8. Testing Strategy (TDD)

All tests run in the default vitest suite except the gated live test. `bin/gateway-local.ts` stays excluded.

### 8.1 `default-policy.test.ts` — pure (NEW)

Drive the bundled `DEFAULT_POLICY` through `@traceguard/policy-engine`'s `evaluate` with hand-built envelopes + a minimal `EvaluationContext` (`toolRiskClass:"trade_like"`): leverage `"5"` → `block`; leverage `"2"` + notional `"5000"` → `require_approval`; leverage `"2"` + notional `"100"` → `allow`; a `hold`/`abstain`-style non-trade still resolves deterministically. Asserts the policy *data* yields the intended three-way outcome — no gateway wiring.

### 8.2 `evaluation-context.test.ts` — pure (NEW)

`buildEvaluationContext(state, run, "trade_like", DEFAULT_POLICY)` over a fixed non-degraded `state` and a `safe_demo` run yields `manifestStatus:"approved"`, `snapshotAgeSeconds:0`, `evaluatorVersion: EVALUATOR_VERSION`, `workspaceMode:"safe_demo"`, `instrumentAllowlist:[]`. `intendedUpstreamTool("spot")==="spot_place_order"`, `"futures"`→`"futures_place_order"`. `isoPlusSeconds("2026-06-16T00:00:00.000Z", 900)` === `"2026-06-16T00:15:00.000Z"`. `policyVersionId({version:1,...})==="1"`.

### 8.3 `decision-cache.test.ts` — pure (NEW)

`createDecisionCache()` returns empty maps; `set`/`get` round-trips a `CachedDecision`; `approvalIndex` round-trips a correlation.

### 8.4 `internal-tool-handlers.test.ts` — orchestration with `InMemoryLedgerStore` + simulator (NEW)

A real `InMemoryLedgerStore`, the real `createSimulatorAdapter`, `DEFAULT_POLICY`, a fake counting `newId`, a fixed `clock`, and a real `sha256hex`. Seed a boot-equivalent ledger (`RunCreated`) and a non-degraded `state`. Drive whole workflows and assert **both** the returned `CallToolResult` and the **event sequence read back from the store**:

- **allow path:** `start_run` → `record_decision` (leverage `"2"`, notional `"100"`) returns `status:"validated"`; `request_execution` returns `status:"ALLOWED"` with a `receipt`; the store gained `RunStarted`, `DecisionProposed…PolicyEvaluated` (outcome `allow`), `AuthorizationIssued`, `ExecutionRequested`, `AuthorizationConsumed`, `ExecutionCompleted`, `RunCompleted`. `finish_run("succeeded")` returns `"completed"` and appends **no** duplicate terminal event.
- **require_approval + operator-approve path:** notional `"5000"` ⇒ `request_execution` returns `status:"APPROVAL_REQUIRED"` + `approvalId`; `check_approval` → `PENDING`; `handle.approve(approvalId, {...})` → outcome `"approved"`, store gains `ApprovalApproved` + `AuthorizationIssued`; `check_approval` → `APPROVED` + `authorizationId`; `execute_authorized_action` (same `executionAdapter`) → `EXECUTED` + receipt; store gains `ExecutionRequested`/`AuthorizationConsumed`/`ExecutionCompleted`.
- **block path:** leverage `"10"` ⇒ `request_execution` → `isError:true`, `POLICY_BLOCKED`, `matchedRules` non-empty, **no** execution events appended.
- **double-execute:** repeat `execute_authorized_action` ⇒ second call `isError:true`, `AUTHORIZATION_CONSUMED`.
- **digest-mismatch:** `request_execution` (require_approval) → approve → `execute_authorized_action` with a **different** `executionAdapter` ⇒ `CAPABILITY_UNAVAILABLE` (rejected before the orchestrator); and a forced-digest-tamper variant (cached `digestBase` mutated in a white-box test) ⇒ `ACTION_DIGEST_MISMATCH`.
- **invalid decision:** `record_decision` with empty `evidenceRefs` ⇒ `DECISION_INVALID`, store shows `DecisionRejected`, no cache entry; subsequent `request_execution` on that id ⇒ `DECISION_INVALID`.
- **bad runId:** any `runId`-taking tool with a foreign id ⇒ `RUN_NOT_FOUND`.

### 8.5 `gateway-server.test.ts` — extend (MODIFY)

With an `InternalToolContext` wired (fake upstream client for read forwards + real store + simulator), via a real SDK `Client`:
- `tools/list` includes the six `traceguard_*` names **plus** the governed read tools; the blocked names stay absent.
- a full `start_run → record_decision → request_execution` allow round-trip returns `status:"ALLOWED"` through the SDK transport (top-level `traceguard` survives the client parse).
- `request_execution` on a blocked decision returns `isError:true` / `POLICY_BLOCKED`.
- with **no** `internalCtx` (degraded server), `tools/list` omits the internal tools and `tools/call traceguard_start_run` → `TOOL_CALL_NOT_AVAILABLE`.

### 8.6 `boot-gateway.test.ts` — extend (MODIFY)

- happy path: `handle.approve` / `handle.reject` are defined; an end-to-end require_approval flow approved via `handle.approve` reaches `EXECUTED`.
- degraded path: `handle.approve === undefined`, `handle.runId === undefined`, no internal tools listed.

### 8.7 `gateway-local.integration.test.ts` — extend, gated by `TRACEGUARD_LIVE_MCP` (MODIFY)

Against the real `bitget-mcp-server --paper-trading`, after boot: `tools/list` includes `traceguard_record_decision`; a scripted `start_run → record_decision(allow-sized) → request_execution` returns `status:"ALLOWED"` with a simulator receipt (no live order is placed — execution is the simulator, not Bitget); a high-leverage decision returns `POLICY_BLOCKED`. Assertions stay behavioural (status / error-code), never exact counts (frozen-fixture rule).

---

## 9. File & Module Inventory

| Path | Action | Responsibility |
|------|--------|----------------|
| `packages/schemas/src/run-payloads.ts` | **modify** | Add `RunStartedPayload`. |
| `packages/mcp-gateway/src/default-policy.ts` | **create** | `DEFAULT_POLICY` + `NOTIONAL_APPROVAL_THRESHOLD_USDT`. |
| `packages/mcp-gateway/src/evaluation-context.ts` | **create** | `buildEvaluationContext`, `policyVersionId`, `intendedUpstreamTool`, `isoPlusSeconds`, `EVALUATOR_VERSION`. |
| `packages/mcp-gateway/src/internal-tools.ts` | **create** | `INTERNAL_TOOL_DEFS`, `INTERNAL_TOOL_NAMES`. |
| `packages/mcp-gateway/src/decision-cache.ts` | **create** | `CachedDecision`, `DecisionCache`, `createDecisionCache`. |
| `packages/mcp-gateway/src/internal-tool-context.ts` | **create** | `InternalToolContext`, `RunContext`, `ApprovalTtls`. |
| `packages/mcp-gateway/src/internal-tool-handlers.ts` | **create** | `dispatchInternalTool`, the six handlers, `internalOk`/`internalErr`, `eventsForApproval`, reason maps. |
| `packages/mcp-gateway/src/gateway-server.ts` | **modify** | `createGatewayServer(state, callCtx?, internalCtx?)` — merge/dispatch internal tools. |
| `packages/mcp-gateway/src/boot-gateway.ts` | **modify** | Build `InternalToolContext` + `RunContext`; `policy?` arg; `handle.approve`/`handle.reject`. |
| `packages/mcp-gateway/src/index.ts` | **modify** | Barrel: add the six new modules. |
| `packages/mcp-gateway/src/default-policy.test.ts` | **create** | Policy data → three-way outcome. |
| `packages/mcp-gateway/src/evaluation-context.test.ts` | **create** | Context derivation + helpers. |
| `packages/mcp-gateway/src/decision-cache.test.ts` | **create** | Cache round-trips. |
| `packages/mcp-gateway/src/internal-tool-handlers.test.ts` | **create** | Allow / approve / block / double-execute / invalid / bad-run workflows. |
| `packages/mcp-gateway/src/gateway-server.test.ts` | **modify** | List-merge + dispatch + degraded omission. |
| `packages/mcp-gateway/src/boot-gateway.test.ts` | **modify** | Operator seam present (happy) / absent (degraded). |
| `packages/mcp-gateway/src/gateway-local.integration.test.ts` | **modify** | Live governed allow + block. |
| `packages/mcp-gateway/src/bin/gateway-local.ts` | **unchanged** | Composition root already destructures the handle; new fields are additive. |

The 3D pure cores (`call-router.ts`, `tool-call-events.ts`) and the upstream-forward path in `call-handler.ts` are untouched.

---

## 10. Documentation Alignment

Land these `docs/mcp-gateway-contract.md` notes in the 3E-1 plan (full-coherence preference):

1. **§9 handling paths — mark the governance concerns as landed in 3E-1:** Decision-Envelope validation, policy evaluation, approval gating, authorization, and (simulator) execution are now implemented behind the `traceguard_*` internal tools. Argument JSON-Schema validation (§9.2-ish) and response redaction (§9.3) remain deferred to **3E-2**.
2. **§12 (run lifecycle / timing) — record where policy is evaluated:** the policy outcome is computed at `record_decision` (inside `proposeDecision`) and **cached**; `request_execution` acts on the cached outcome (allow ⇒ issue+execute, require_approval ⇒ `ApprovalRequested`, block ⇒ `POLICY_BLOCKED`). Note the non-blocking approval seam and that `finish_run` is idempotent against an already-settled allow path.
3. **§13 (approval) — document the operator seam:** human approval is out-of-band via `handle.approve`/`handle.reject` (human ≠ agent); the agent resumes via `check_approval` → `execute_authorized_action`.
4. **§16 (or the state/cache section) — document the in-memory decision cache:** rationale (digest reproduction + `policyEvaluationId` carry), its rebuildable-from-projection deferral, and the one-decision-per-run demo scope of `eventsForApproval`.
5. **§14 error table — add the internal-tool codes:** `DECISION_INVALID`, `POLICY_BLOCKED`, `APPROVAL_REQUIRED` (non-error status), `APPROVAL_EXPIRED`, `AUTHORIZATION_MISSING`, `AUTHORIZATION_CONSUMED`, `ACTION_DIGEST_MISMATCH`, `EXECUTION_UNKNOWN`, `EXECUTION_FAILED`, `CAPABILITY_UNAVAILABLE`, `RUN_NOT_FOUND`, plus the reserved set.

No 3A/3B/3C/3D spec edits needed; the 3D `DECISION_ENVELOPE_REQUIRED` seam description stays accurate.

---

## 11. Acceptance Criteria

- [ ] On a non-degraded boot, `tools/list` returns the six `traceguard_*` tools plus the governed read tools; the blocked tools remain hidden; a degraded boot returns neither.
- [ ] `start_run → record_decision(allow-sized) → request_execution` returns `status:"ALLOWED"` with a simulator `receipt`, and the ledger shows the full `DecisionProposed…PolicyEvaluated`, `AuthorizationIssued`, burn (`ExecutionRequested`+`AuthorizationConsumed`), `ExecutionCompleted`, `RunCompleted` chain.
- [ ] A `require_approval`-sized decision returns non-blocking `APPROVAL_REQUIRED`; `handle.approve` issues the authorization; `check_approval` flips to `APPROVED`; `execute_authorized_action` (same adapter) returns `EXECUTED` with a receipt.
- [ ] A second `execute_authorized_action` on the same authorization returns `AUTHORIZATION_CONSUMED`; a mismatched action digest returns `ACTION_DIGEST_MISMATCH`; a lapsed approval/authorization returns `APPROVAL_EXPIRED`.
- [ ] A `block`-sized decision returns `isError:true` / `POLICY_BLOCKED` with `matchedRules` and **no** execution events; an invalid envelope returns `DECISION_INVALID` (`DecisionRejected` on the ledger, no cache entry).
- [ ] A non-`simulator` `executionAdapter` returns `CAPABILITY_UNAVAILABLE`; a foreign `runId` returns `RUN_NOT_FOUND`.
- [ ] The 3D upstream-forward path is unchanged: a raw `trade_like` `tools/call` still denies `DECISION_ENVELOPE_REQUIRED`; read-class forwards still return raw upstream results.
- [ ] `RunStartedPayload` is additive; no other schema is modified; the ledger envelope and `aggregateType`/`actorType` enums are unchanged.
- [ ] All default-suite tests pass; the live test stays gated behind `TRACEGUARD_LIVE_MCP`; stdout carries only JSON-RPC.

---

## 12. Out-of-Scope Boundary (hand-off to 3E-2)

3E-2 adds the upstream-forward **hygiene** layer 3D and 3E-1 deferred, and broadens execution beyond the simulator:

- **Argument JSON-Schema validation** (`ajv`) of forwarded read/trade-tool arguments against each tool's `inputSchema` (contract §9.2), rejecting malformed calls *before* the upstream hit / before `record_decision` accepts them.
- **Result redaction** (contract §9.3 / §20) on forwarded results and on receipts, by `redactionProfile`.
- **Live (`bitget_live`) execution adapter** behind the same `ExecutionAdapter` seam, lifting `CAPABILITY_UNAVAILABLE` for `bitget_live` and exercising the currently-reserved gate reasons (`snapshot_stale`, `manifest_unapproved`, `workspace_locked`).
- **Decision-material projection** to retire the in-memory cache for durable / multi-process deployments, and **per-approval event isolation** beyond the one-decision-per-run demo assumption.

3E-1 deliberately keeps the upstream-forward path and the `DECISION_ENVELOPE_REQUIRED` seam byte-for-byte from 3D, so 3E-2 is an additive hygiene/adapter layer over a working, audited, fail-closed governance pipeline — not a rewrite.
