# TraceGuard Phase 3 — 3E-1: Governed Decision → Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six internal `traceguard_*` MCP tools to `@traceguard/mcp-gateway` that drive a trade intent through `propose → evaluate → (approve) → execute` against a simulator adapter, with every step audited on the ledger and every gate fail-closed — leaving 3D's `DECISION_ENVELOPE_REQUIRED` upstream-forward seam byte-for-byte untouched.

**Architecture:** Functional-core / imperative-shell. The Phase 1B authorization core (`proposeDecision`, `resolveAuthorizationGateway`, `approveApproval`/`rejectApproval`) and the Phase 2 runtime (`executionOrchestrator`, `createSimulatorAdapter`) already implement decision validation, policy evaluation, approval transitions, and burn-before-execute settlement as pure, event-sourced library functions. 3E-1 is a **wiring job**: new pure derivation modules (`default-policy`, `evaluation-context`, `internal-tools`), an in-memory `decision-cache`, and thin imperative handlers (`internal-tool-handlers`) that read the ledger head, call a core function, append the returned chained events, and shape an MCP `CallToolResult`. An out-of-band operator seam (`handle.approve` / `handle.reject`) models the human approver; approval is non-blocking.

**Tech Stack:** TypeScript (NodeNext ESM, `tsc --build` project references), pnpm workspace, vitest ^4.1.0, zod, `@modelcontextprotocol/sdk` ^1.29.0. Node ≥22.12.0.

**Git constraint:** Commit locally on `main` after each task. **Do NOT push.**

**Commands:**
- Build: `pnpm build` (`tsc --build`)
- Typecheck: `pnpm typecheck` (`tsc --build --pretty`)
- Full test suite: `pnpm test` (`vitest run`)
- Single test file: `pnpm vitest run packages/mcp-gateway/src/<file>.test.ts`

---

## Disclosure — refinements beyond a literal reading of the spec

Grounding the merged reference code surfaced details the approved design (§4) wrote as illustrative pseudocode. Each is a faithful tightening, disclosed here per the full-coherence preference; every one is already baked into the task code below:

- **(A) `matchedRules` projection.** `PolicyDecision.matchedRules` is `MatchedRule[]`, but `CachedDecision.matchedRules` is `string[]`. `record_decision` stores `result.decision.matchedRules.map((r) => r.ruleId)`.
- **(B) `ToolRiskClass`, not `RiskClass`.** `EvaluationContext.toolRiskClass` is typed `ToolRiskClass` (spec §4.3 wrote `RiskClass`). `buildEvaluationContext` types its param `ToolRiskClass`; `record_decision` passes the literal `"trade_like"`.
- **(C) Operator seam lives in handlers.** `eventsForApproval` is a pure helper exported from `internal-tool-handlers.ts`; `boot-gateway.ts` imports it for the `approve`/`reject` closures (avoids a circular module).
- **(D) `finish_run("failed")`** emits `RunFailed` with `reasonCode: "orchestrator_error"` — the only value in the `RunFailureReason` enum today.
- **(E) `mapExecReason`** returns forward-compat codes only; all `executionGates` are `false` in this slice, so it is unreachable but defined.
- **(F) Loose result shape.** `internalOk` / `internalErr` build the same `as unknown as CallToolResult` shape 3D's `denyCall` uses, so the top-level `traceguard` field survives the client-side `CallToolResultSchema` parse.
- **(G) Shared `finishExecution` helper.** The allow branch of `request_execution` and `execute_authorized_action` share one post-orchestrator mapping helper.
- **(H) Dependency wiring (two files).** `mcp-gateway` gains `@traceguard/domain`, `@traceguard/policy-engine`, `@traceguard/runtime` in **both** `package.json` `dependencies` **and** `tsconfig.json` `references` — `tsc --build` fails on a missing reference even when the runtime import resolves.
- **(I) Arg casting + `internalErr` third param.** Handler args arrive as `Record<string, unknown>`; handlers cast at the boundary (the envelope is re-validated by `proposeDecision`'s zod parse, so an invalid cast fails closed as `DECISION_INVALID`). `internalErr`'s third param is a structured `extra?: Record<string, unknown>` (carries `matchedRules` / `executionSent` for `POLICY_BLOCKED`), not a free-text `message`.

---

## File Structure

**New files (`packages/mcp-gateway/src/`):**

| File | Responsibility |
|------|----------------|
| `default-policy.ts` | `DEFAULT_POLICY: Policy` + `NOTIONAL_APPROVAL_THRESHOLD_USDT`. Pure. |
| `decision-cache.ts` | `CachedDecision`, `DecisionCache`, `createDecisionCache()`. In-memory state. |
| `internal-tool-context.ts` | `InternalToolContext`, `RunContext`, `ApprovalTtls` types. Wiring. |
| `evaluation-context.ts` | `buildEvaluationContext`, `policyVersionId`, `intendedUpstreamTool`, `isoPlusSeconds`, `EVALUATOR_VERSION`. Pure. |
| `internal-tools.ts` | `INTERNAL_TOOL_DEFS: ServedTool[]`, `INTERNAL_TOOL_NAMES`. Pure tool definitions. |
| `internal-tool-handlers.ts` | `dispatchInternalTool`, the six handlers, `internalOk`/`internalErr`, `eventsForApproval`, reason maps. Shell. |

**Modified files:**

| File | Change |
|------|--------|
| `packages/schemas/src/run-payloads.ts` | Add `RunStartedPayload`. |
| `packages/mcp-gateway/package.json` | Add domain/policy-engine/runtime deps. |
| `packages/mcp-gateway/tsconfig.json` | Add domain/policy-engine/runtime references. |
| `packages/mcp-gateway/src/gateway-server.ts` | `createGatewayServer(state, callCtx?, internalCtx?)` — merge/dispatch internal tools. |
| `packages/mcp-gateway/src/boot-gateway.ts` | Build `InternalToolContext`+`RunContext`; `policy?` arg; `handle.approve`/`handle.reject`. |
| `packages/mcp-gateway/src/index.ts` | Barrel: add the six new modules. |
| `packages/mcp-gateway/src/gateway-server.test.ts` | List-merge + dispatch + degraded omission. |
| `packages/mcp-gateway/src/boot-gateway.test.ts` | Operator seam present (happy) / absent (degraded). |
| `packages/mcp-gateway/src/gateway-local.integration.test.ts` | Live governed allow + block. |
| `docs/mcp-gateway-contract.md` | §9/§12/§13/§14/§16 alignment notes. |

**Build order (dependency-driven):** 1 (schema leaf) → 2 (deps infra) → 3 (default-policy) → 4 (decision-cache) → 5 (context types) → 6 (evaluation-context) → 7 (internal-tools) → 8 (handlers) → 9 (gateway-server) → 10 (boot-gateway) → 11 (barrel + integration) → 12 (docs).

---

### Task 1: `RunStartedPayload` in `@traceguard/schemas`

**Files:**
- Modify: `packages/schemas/src/run-payloads.ts`
- Test: `packages/schemas/src/run-payloads.test.ts`

- [ ] **Step 1: Write the failing test**

Add this import change and `describe` block to `packages/schemas/src/run-payloads.test.ts`. Change line 2's import to include `RunStartedPayload`:

```ts
import { RunCompletedPayload, RunFailedPayload, RunStartedPayload } from "./run-payloads.js";
```

Append at the end of the file:

```ts
describe("RunStartedPayload", () => {
  it("parses a minimal payload (runId + startedAt)", () => {
    const ok = RunStartedPayload.parse({
      runId: "run_1",
      startedAt: "2026-06-16T00:00:00.000Z",
    });
    expect(ok.runId).toBe("run_1");
  });

  it("accepts optional agentName / intent / mode", () => {
    const ok = RunStartedPayload.parse({
      runId: "run_1",
      startedAt: "2026-06-16T00:00:00.000Z",
      agentName: "demo-agent",
      intent: "rebalance",
      mode: "safe_demo",
    });
    expect(ok.mode).toBe("safe_demo");
  });

  it("throws on an unknown key", () => {
    expect(() =>
      RunStartedPayload.parse({
        runId: "run_1",
        startedAt: "2026-06-16T00:00:00.000Z",
        nope: 1,
      }),
    ).toThrow();
  });

  it("throws on a malformed startedAt", () => {
    expect(() => RunStartedPayload.parse({ runId: "run_1", startedAt: "not-a-date" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/schemas/src/run-payloads.test.ts`
Expected: FAIL — `RunStartedPayload` is not exported (import error / undefined).

- [ ] **Step 3: Write minimal implementation**

Append to `packages/schemas/src/run-payloads.ts` (after the existing `RunCreatedPayload` export):

```ts
export const RunStartedPayload = z
  .object({
    runId: z.string().min(1),
    startedAt: IsoTimestamp,
    agentName: z.string().min(1).optional(),
    intent: z.string().min(1).optional(),
    mode: z.string().min(1).optional(),
  })
  .strict();
export type RunStartedPayload = z.infer<typeof RunStartedPayload>;
```

(`z` and `IsoTimestamp` are already imported at the top of the file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/schemas/src/run-payloads.test.ts`
Expected: PASS (all four new cases + the existing `RunCompletedPayload`/`RunFailedPayload` blocks).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/run-payloads.ts packages/schemas/src/run-payloads.test.ts
git commit -m "feat(schemas): add additive RunStartedPayload for 3E-1 run lifecycle"
```

---

### Task 2: Wire domain / policy-engine / runtime into `@traceguard/mcp-gateway`

**Files:**
- Modify: `packages/mcp-gateway/package.json`
- Modify: `packages/mcp-gateway/tsconfig.json`

This is an infrastructure prerequisite — no new test. Verification is a clean `pnpm build`. **It must precede every task that imports those three packages (4, 5, 6, 8, 10).**

- [ ] **Step 1: Add the three workspace dependencies**

In `packages/mcp-gateway/package.json`, inside `"dependencies"` (alongside the existing `@traceguard/schemas`, `@traceguard/event-ledger`, `@traceguard/tool-manifest`), add:

```json
    "@traceguard/domain": "workspace:*",
    "@traceguard/policy-engine": "workspace:*",
    "@traceguard/runtime": "workspace:*",
```

- [ ] **Step 2: Add the three project references**

In `packages/mcp-gateway/tsconfig.json`, inside `"references"` (alongside the existing `../schemas`, `../event-ledger`, `../tool-manifest`, `../testing-fixtures`), add:

```json
    { "path": "../domain" },
    { "path": "../policy-engine" },
    { "path": "../runtime" }
```

- [ ] **Step 3: Install and build**

Run: `pnpm install`
Then run: `pnpm build`
Expected: clean build (the new deps resolve; nothing imports them yet, so no behavior change).

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-gateway/package.json packages/mcp-gateway/tsconfig.json pnpm-lock.yaml
git commit -m "build(mcp-gateway): depend on domain/policy-engine/runtime for 3E-1"
```

---

### Task 3: `default-policy.ts`

**Files:**
- Create: `packages/mcp-gateway/src/default-policy.ts`
- Test: `packages/mcp-gateway/src/default-policy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mcp-gateway/src/default-policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { evaluate } from "@traceguard/policy-engine";
import type { DecisionEnvelope, EvaluationContext } from "@traceguard/schemas";
import { DEFAULT_POLICY, NOTIONAL_APPROVAL_THRESHOLD_USDT } from "./default-policy.js";

function ctx(): EvaluationContext {
  return {
    runId: "run_1",
    policyVersionId: "1",
    evaluatorVersion: "traceguard-3e1",
    workspaceMode: "safe_demo",
    manifestStatus: "approved",
    snapshotAgeSeconds: 0,
    toolRiskClass: "trade_like",
    instrumentAllowlist: [],
  };
}

function envelope(over: Partial<DecisionEnvelope>): DecisionEnvelope {
  return {
    id: "dec_1",
    instrument: "BTCUSDT",
    marketType: "futures",
    action: "open_long",
    thesis: "t",
    evidenceRefs: ["ev:1"],
    ...over,
  } as DecisionEnvelope;
}

describe("DEFAULT_POLICY", () => {
  it("blocks leverage > 3", () => {
    const d = evaluate(envelope({ requestedLeverage: "5", requestedNotionalUsdt: "100" }), DEFAULT_POLICY, ctx());
    expect(d.outcome).toBe("block");
  });

  it("requires approval for notional > threshold at safe leverage", () => {
    const d = evaluate(envelope({ requestedLeverage: "2", requestedNotionalUsdt: "5000" }), DEFAULT_POLICY, ctx());
    expect(d.outcome).toBe("require_approval");
  });

  it("allows a small trade_like decision at safe leverage", () => {
    const d = evaluate(envelope({ requestedLeverage: "2", requestedNotionalUsdt: "100" }), DEFAULT_POLICY, ctx());
    expect(d.outcome).toBe("allow");
  });

  it("exposes the notional threshold constant", () => {
    expect(NOTIONAL_APPROVAL_THRESHOLD_USDT).toBe("1000");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/mcp-gateway/src/default-policy.test.ts`
Expected: FAIL — `./default-policy.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `packages/mcp-gateway/src/default-policy.ts`:

```ts
import type { Policy } from "@traceguard/schemas";

export const NOTIONAL_APPROVAL_THRESHOLD_USDT = "1000"; // DecimalString

export const DEFAULT_POLICY: Policy = {
  version: 1,
  defaultEffect: "block",
  rules: [
    {
      id: "block-high-leverage",
      effect: "block",
      conditions: [{ kind: "leverage_gt", value: "3" }],
    },
    {
      id: "approve-large-notional",
      effect: "require_approval",
      conditions: [{ kind: "notional_gt", value: NOTIONAL_APPROVAL_THRESHOLD_USDT }],
    },
    {
      id: "allow-trade-like",
      effect: "allow",
      conditions: [{ kind: "tool_risk_class_eq", value: "trade_like" }],
    },
  ],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/mcp-gateway/src/default-policy.test.ts`
Expected: PASS (block / require_approval / allow / constant).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-gateway/src/default-policy.ts packages/mcp-gateway/src/default-policy.test.ts
git commit -m "feat(mcp-gateway): add DEFAULT_POLICY (leverage>3 block, notional>1000 approve, else allow)"
```

---

### Task 4: `decision-cache.ts`

**Files:**
- Create: `packages/mcp-gateway/src/decision-cache.ts`
- Test: `packages/mcp-gateway/src/decision-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mcp-gateway/src/decision-cache.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { CachedDecision } from "./decision-cache.js";
import { createDecisionCache } from "./decision-cache.js";

function sample(): CachedDecision {
  return {
    decisionId: "dec_1",
    outcome: "allow",
    matchedRules: ["allow-trade-like"],
    policyEvaluationId: "eval_1",
    decisionHash: "f".repeat(64),
    summary: { instrument: "BTCUSDT", action: "open_long", notionalUsdt: "100" },
    digestBase: {
      workspaceId: "ws_demo",
      runId: "run_1",
      decisionId: "dec_1",
      providerConnectionId: "pc_bitget",
      toolName: "futures_place_order",
      toolManifestHash: "a".repeat(64),
      policyVersionId: "1",
      workspaceMode: "safe_demo",
      instrument: "BTCUSDT",
      marketType: "futures",
      action: "open_long",
      requestedNotionalUsdt: "100",
    },
  };
}

describe("createDecisionCache", () => {
  it("starts with empty maps", () => {
    const cache = createDecisionCache();
    expect(cache.decisions.size).toBe(0);
    expect(cache.approvalIndex.size).toBe(0);
  });

  it("round-trips a CachedDecision", () => {
    const cache = createDecisionCache();
    const d = sample();
    cache.decisions.set(d.decisionId, d);
    expect(cache.decisions.get("dec_1")?.outcome).toBe("allow");
    expect(cache.decisions.get("dec_1")?.digestBase.toolName).toBe("futures_place_order");
  });

  it("round-trips an approval correlation", () => {
    const cache = createDecisionCache();
    cache.approvalIndex.set("appr_1", { runId: "run_1", decisionId: "dec_1" });
    expect(cache.approvalIndex.get("appr_1")).toEqual({ runId: "run_1", decisionId: "dec_1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/mcp-gateway/src/decision-cache.test.ts`
Expected: FAIL — `./decision-cache.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `packages/mcp-gateway/src/decision-cache.ts`:

```ts
import type { Effect, ActionDigestInput } from "@traceguard/schemas";
import type { AuthorizationSummary } from "@traceguard/domain";

export interface CachedDecision {
  decisionId: string;
  outcome: Effect; // "allow" | "require_approval" | "block"
  matchedRules: string[];
  policyEvaluationId: string; // from the PolicyEvaluated payload
  decisionHash: string; // from the DecisionProposed payload
  summary: AuthorizationSummary; // { instrument, action, notionalUsdt?, leverage? }
  digestBase: Omit<ActionDigestInput, "executionAdapter">; // every digest field but the adapter
}

export interface DecisionCache {
  decisions: Map<string, CachedDecision>;
  approvalIndex: Map<string, { runId: string; decisionId: string }>; // approvalId → correlation
}

export function createDecisionCache(): DecisionCache {
  return { decisions: new Map(), approvalIndex: new Map() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/mcp-gateway/src/decision-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-gateway/src/decision-cache.ts packages/mcp-gateway/src/decision-cache.test.ts
git commit -m "feat(mcp-gateway): add in-memory decision cache (digest base + policy outcome carry)"
```

---

### Task 5: `internal-tool-context.ts` (wiring types)

**Files:**
- Create: `packages/mcp-gateway/src/internal-tool-context.ts`

Types only; the spec lists no dedicated test. Verified by `pnpm typecheck` and consumed by later tasks.

- [ ] **Step 1: Write the implementation**

Create `packages/mcp-gateway/src/internal-tool-context.ts`:

```ts
import type { LedgerStore } from "@traceguard/event-ledger";
import type { ReconcileDeps } from "@traceguard/tool-manifest"; // { clock, newId, hash }
import type { Policy } from "@traceguard/schemas";
import type { ExecutionAdapter } from "@traceguard/domain";
import type { CallAudit } from "./tool-call-events.js";
import type { DecisionCache } from "./decision-cache.js";

export interface RunContext {
  runId: string;
  mode: string; // WorkspaceMode value; "safe_demo" for the demo
  agentName?: string;
  intent?: string;
}

export interface ApprovalTtls {
  approvalSeconds: number; // default 900
  authorizationSeconds: number; // default 900
}

export interface InternalToolContext {
  store: LedgerStore;
  deps: ReconcileDeps;
  audit: CallAudit; // { workspaceId, runId, providerConnectionId }
  policy: Policy;
  adapter: ExecutionAdapter; // simulator in 3E-1
  run: RunContext; // mutated in place by start_run (agentName/intent/mode)
  cache: DecisionCache;
  ttls: ApprovalTtls;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS (no errors; the file is types-only and all imports resolve after Task 2).

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-gateway/src/internal-tool-context.ts
git commit -m "feat(mcp-gateway): add InternalToolContext / RunContext / ApprovalTtls wiring types"
```

---

### Task 6: `evaluation-context.ts`

**Files:**
- Create: `packages/mcp-gateway/src/evaluation-context.ts`
- Test: `packages/mcp-gateway/src/evaluation-context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mcp-gateway/src/evaluation-context.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { GatewayState } from "./gateway-state.js";
import type { RunContext } from "./internal-tool-context.js";
import { DEFAULT_POLICY } from "./default-policy.js";
import {
  EVALUATOR_VERSION,
  buildEvaluationContext,
  intendedUpstreamTool,
  isoPlusSeconds,
  policyVersionId,
} from "./evaluation-context.js";

function state(degraded = false): GatewayState {
  return {
    servedTools: [],
    route: new Map(),
    manifestHash: degraded ? null : "a".repeat(64),
    toolCount: 0,
    degraded,
  };
}

const run: RunContext = { runId: "run_1", mode: "safe_demo" };

describe("evaluation-context helpers", () => {
  it("policyVersionId stringifies the policy version", () => {
    expect(policyVersionId({ version: 1, defaultEffect: "block", rules: [] })).toBe("1");
  });

  it("intendedUpstreamTool maps market types", () => {
    expect(intendedUpstreamTool("spot")).toBe("spot_place_order");
    expect(intendedUpstreamTool("futures")).toBe("futures_place_order");
    expect(intendedUpstreamTool("tokenized_stock")).toBe("tstock_place_order");
  });

  it("isoPlusSeconds adds seconds and returns ISO", () => {
    expect(isoPlusSeconds("2026-06-16T00:00:00.000Z", 900)).toBe("2026-06-16T00:15:00.000Z");
  });

  it("buildEvaluationContext derives a non-degraded context", () => {
    const c = buildEvaluationContext(state(), run, "trade_like", DEFAULT_POLICY);
    expect(c.manifestStatus).toBe("approved");
    expect(c.snapshotAgeSeconds).toBe(0);
    expect(c.evaluatorVersion).toBe(EVALUATOR_VERSION);
    expect(c.workspaceMode).toBe("safe_demo");
    expect(c.toolRiskClass).toBe("trade_like");
    expect(c.instrumentAllowlist).toEqual([]);
  });

  it("buildEvaluationContext reports needs_review when degraded", () => {
    const c = buildEvaluationContext(state(true), run, "trade_like", DEFAULT_POLICY);
    expect(c.manifestStatus).toBe("needs_review");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/mcp-gateway/src/evaluation-context.test.ts`
Expected: FAIL — `./evaluation-context.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `packages/mcp-gateway/src/evaluation-context.ts`:

```ts
import type { EvaluationContext, Policy, ToolRiskClass } from "@traceguard/schemas";
import type { GatewayState } from "./gateway-state.js";
import type { RunContext } from "./internal-tool-context.js";

export const EVALUATOR_VERSION = "traceguard-3e1";

export function policyVersionId(policy: Policy): string {
  return String(policy.version);
}

export function intendedUpstreamTool(marketType: string): string {
  switch (marketType) {
    case "spot":
      return "spot_place_order";
    case "futures":
      return "futures_place_order";
    case "tokenized_stock":
      return "tstock_place_order";
    default:
      return "spot_place_order";
  }
}

export function isoPlusSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

export function buildEvaluationContext(
  state: GatewayState,
  run: RunContext,
  toolRiskClass: ToolRiskClass,
  policy: Policy,
): EvaluationContext {
  return {
    runId: run.runId,
    policyVersionId: policyVersionId(policy),
    evaluatorVersion: EVALUATOR_VERSION,
    workspaceMode: run.mode as EvaluationContext["workspaceMode"],
    manifestStatus: state.degraded ? "needs_review" : "approved",
    snapshotAgeSeconds: 0,
    toolRiskClass,
    instrumentAllowlist: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/mcp-gateway/src/evaluation-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-gateway/src/evaluation-context.ts packages/mcp-gateway/src/evaluation-context.test.ts
git commit -m "feat(mcp-gateway): add buildEvaluationContext + policy/market/iso helpers"
```

---

### Task 7: `internal-tools.ts` (tool definitions)

**Files:**
- Create: `packages/mcp-gateway/src/internal-tools.ts`
- Test: `packages/mcp-gateway/src/internal-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mcp-gateway/src/internal-tools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { INTERNAL_TOOL_DEFS, INTERNAL_TOOL_NAMES } from "./internal-tools.js";

describe("internal tool definitions", () => {
  it("defines the six traceguard_* tools", () => {
    const names = INTERNAL_TOOL_DEFS.map((t) => t.name);
    expect(names).toEqual([
      "traceguard_start_run",
      "traceguard_record_decision",
      "traceguard_request_execution",
      "traceguard_check_approval",
      "traceguard_execute_authorized_action",
      "traceguard_finish_run",
    ]);
  });

  it("INTERNAL_TOOL_NAMES matches the defs", () => {
    for (const t of INTERNAL_TOOL_DEFS) expect(INTERNAL_TOOL_NAMES.has(t.name)).toBe(true);
    expect(INTERNAL_TOOL_NAMES.size).toBe(INTERNAL_TOOL_DEFS.length);
  });

  it("every tool carries an object inputSchema and a description", () => {
    for (const t of INTERNAL_TOOL_DEFS) {
      expect(typeof t.description).toBe("string");
      expect((t.inputSchema as { type?: string }).type).toBe("object");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/mcp-gateway/src/internal-tools.test.ts`
Expected: FAIL — `./internal-tools.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `packages/mcp-gateway/src/internal-tools.ts`:

```ts
import type { ServedTool } from "./gateway-state.js";

export const INTERNAL_TOOL_NAMES: ReadonlySet<string> = new Set([
  "traceguard_start_run",
  "traceguard_record_decision",
  "traceguard_request_execution",
  "traceguard_check_approval",
  "traceguard_execute_authorized_action",
  "traceguard_finish_run",
]);

export const INTERNAL_TOOL_DEFS: ServedTool[] = [
  {
    name: "traceguard_start_run",
    description: "Begin a governed run; declares the agent and intent before any decision.",
    inputSchema: {
      type: "object",
      properties: {
        agentName: { type: "string" },
        intent: { type: "string" },
        mode: { type: "string" },
      },
      required: ["agentName", "intent"],
    },
  },
  {
    name: "traceguard_record_decision",
    description: "Record a trade decision envelope (thesis + evidence) and evaluate policy.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        instrument: { type: "string" },
        marketType: { type: "string", enum: ["spot", "futures", "tokenized_stock"] },
        action: { type: "string" },
        thesis: { type: "string" },
        confidence: { type: "number" },
        evidenceRefs: { type: "array", items: { type: "string" } },
        requestedNotionalUsdt: { type: "string" },
        requestedLeverage: { type: "string" },
      },
      required: ["runId", "instrument", "marketType", "action", "thesis", "evidenceRefs"],
    },
  },
  {
    name: "traceguard_request_execution",
    description:
      "Request execution of a recorded decision; returns ALLOWED, APPROVAL_REQUIRED, or POLICY_BLOCKED.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        decisionId: { type: "string" },
        executionAdapter: { type: "string", enum: ["simulator", "bitget_live", "replay"] },
      },
      required: ["runId", "decisionId"],
    },
  },
  {
    name: "traceguard_check_approval",
    description: "Poll the status of a pending approval (non-blocking).",
    inputSchema: {
      type: "object",
      properties: { approvalId: { type: "string" } },
      required: ["approvalId"],
    },
  },
  {
    name: "traceguard_execute_authorized_action",
    description: "Execute an action after its approval has been granted.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        decisionId: { type: "string" },
        authorizationId: { type: "string" },
        executionAdapter: { type: "string", enum: ["simulator", "bitget_live", "replay"] },
      },
      required: ["runId", "decisionId", "authorizationId"],
    },
  },
  {
    name: "traceguard_finish_run",
    description: "Mark the run terminal (succeeded or failed).",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        outcome: { type: "string", enum: ["succeeded", "failed"] },
      },
      required: ["runId", "outcome"],
    },
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/mcp-gateway/src/internal-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-gateway/src/internal-tools.ts packages/mcp-gateway/src/internal-tools.test.ts
git commit -m "feat(mcp-gateway): add the six internal traceguard_* tool definitions"
```

---

### Task 8: `internal-tool-handlers.ts` (the six handlers + dispatch)

This is the imperative shell: each handler reads the ledger head, calls a pure core function, appends the returned chained events, and shapes a `CallToolResult`. The approve→execute path is exercised in Task 10 (the operator seam); this task covers `start_run`, the allow path to `ALLOWED`, the `block` path to `POLICY_BLOCKED`, the `require_approval` path to `APPROVAL_REQUIRED` + a `PENDING` poll, and `RUN_NOT_FOUND`.

**Files:**
- Create: `packages/mcp-gateway/src/internal-tool-handlers.ts`
- Test: `packages/mcp-gateway/src/internal-tool-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mcp-gateway/src/internal-tool-handlers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SystemClock, SystemIdGen, sha256hex, InMemoryLedgerStore } from "@traceguard/event-ledger";
import { createSimulatorAdapter } from "@traceguard/runtime";
import type { GatewayState } from "./gateway-state.js";
import { DEFAULT_POLICY } from "./default-policy.js";
import { createDecisionCache } from "./decision-cache.js";
import type { InternalToolContext } from "./internal-tool-context.js";
import { dispatchInternalTool } from "./internal-tool-handlers.js";

function gatewayState(): GatewayState {
  return { servedTools: [], route: new Map(), manifestHash: "a".repeat(64), toolCount: 0, degraded: false };
}

function context(): InternalToolContext {
  return {
    store: new InMemoryLedgerStore(),
    deps: { clock: new SystemClock(), newId: new SystemIdGen(), hash: sha256hex },
    audit: { workspaceId: "ws_demo", runId: "run_demo", providerConnectionId: "pc_bitget" },
    policy: DEFAULT_POLICY,
    adapter: createSimulatorAdapter({ hash: sha256hex }),
    run: { runId: "run_demo", mode: "safe_demo" },
    cache: createDecisionCache(),
    ttls: { approvalSeconds: 900, authorizationSeconds: 900 },
  };
}

// Pull the structured traceguard envelope off the loose CallToolResult.
function tg(r: unknown): Record<string, unknown> {
  return ((r as { traceguard?: Record<string, unknown> }).traceguard ?? {}) as Record<string, unknown>;
}

async function record(ctx: InternalToolContext, state: GatewayState, over: Record<string, unknown>) {
  return dispatchInternalTool(ctx, state, "traceguard_record_decision", {
    runId: "run_demo",
    instrument: "BTCUSDT",
    marketType: "futures",
    action: "open_long",
    thesis: "t",
    evidenceRefs: ["ev:1"],
    ...over,
  });
}

describe("dispatchInternalTool", () => {
  it("start_run emits RunStarted and returns RUN_STARTED", async () => {
    const ctx = context();
    const r = await dispatchInternalTool(ctx, gatewayState(), "traceguard_start_run", {
      runId: "run_demo",
      agentName: "demo-agent",
      intent: "rebalance",
    });
    expect(tg(r).status).toBe("RUN_STARTED");
    expect(tg(r).toolManifestHash).toBe("a".repeat(64));
    expect(ctx.run.agentName).toBe("demo-agent");
    expect((r as { isError?: boolean }).isError).toBe(false);
  });

  it("runs the allow path end-to-end to ALLOWED with a receipt", async () => {
    const ctx = context();
    const state = gatewayState();
    await dispatchInternalTool(ctx, state, "traceguard_start_run", { runId: "run_demo" });
    const rec = await record(ctx, state, { requestedNotionalUsdt: "100", requestedLeverage: "2" });
    expect(tg(rec).status).toBe("validated");
    const decisionId = tg(rec).decisionId as string;

    const exec = await dispatchInternalTool(ctx, state, "traceguard_request_execution", {
      runId: "run_demo",
      decisionId,
      executionAdapter: "simulator",
    });
    expect(tg(exec).status).toBe("ALLOWED");
    expect(typeof tg(exec).executionId).toBe("string");
    expect((tg(exec).receipt as { receiptRef?: string }).receiptRef).toMatch(/^receipt:/);
    expect((tg(exec).receipt as { finalStatus?: string }).finalStatus).toBe("simulated");
  });

  it("blocks a high-leverage decision with POLICY_BLOCKED", async () => {
    const ctx = context();
    const state = gatewayState();
    await dispatchInternalTool(ctx, state, "traceguard_start_run", { runId: "run_demo" });
    const rec = await record(ctx, state, { requestedNotionalUsdt: "100", requestedLeverage: "5" });
    const decisionId = tg(rec).decisionId as string;

    const exec = await dispatchInternalTool(ctx, state, "traceguard_request_execution", {
      runId: "run_demo",
      decisionId,
      executionAdapter: "simulator",
    });
    expect((exec as { isError?: boolean }).isError).toBe(true);
    expect(tg(exec).errorCode).toBe("POLICY_BLOCKED");
    expect(tg(exec).executionSent).toBe(false);
    expect(Array.isArray(tg(exec).matchedRules)).toBe(true);
  });

  it("requires approval for large notional and then reports PENDING", async () => {
    const ctx = context();
    const state = gatewayState();
    await dispatchInternalTool(ctx, state, "traceguard_start_run", { runId: "run_demo" });
    const rec = await record(ctx, state, { requestedNotionalUsdt: "5000", requestedLeverage: "2" });
    const decisionId = tg(rec).decisionId as string;

    const exec = await dispatchInternalTool(ctx, state, "traceguard_request_execution", {
      runId: "run_demo",
      decisionId,
      executionAdapter: "simulator",
    });
    expect((exec as { isError?: boolean }).isError).toBe(false);
    expect(tg(exec).status).toBe("APPROVAL_REQUIRED");
    const approvalId = tg(exec).approvalId as string;
    expect(typeof approvalId).toBe("string");

    const poll = await dispatchInternalTool(ctx, state, "traceguard_check_approval", { approvalId });
    expect(tg(poll).status).toBe("PENDING");
  });

  it("rejects non-simulator adapters with CAPABILITY_UNAVAILABLE", async () => {
    const ctx = context();
    const state = gatewayState();
    await dispatchInternalTool(ctx, state, "traceguard_start_run", { runId: "run_demo" });
    const rec = await record(ctx, state, { requestedNotionalUsdt: "100", requestedLeverage: "2" });
    const decisionId = tg(rec).decisionId as string;
    const exec = await dispatchInternalTool(ctx, state, "traceguard_request_execution", {
      runId: "run_demo",
      decisionId,
      executionAdapter: "bitget_live",
    });
    expect(tg(exec).errorCode).toBe("CAPABILITY_UNAVAILABLE");
  });

  it("returns DECISION_INVALID for an unknown decisionId", async () => {
    const ctx = context();
    const exec = await dispatchInternalTool(ctx, gatewayState(), "traceguard_request_execution", {
      runId: "run_demo",
      decisionId: "dec_missing",
    });
    expect(tg(exec).errorCode).toBe("DECISION_INVALID");
  });

  it("rejects a runId that does not match the active run", async () => {
    const ctx = context();
    const r = await dispatchInternalTool(ctx, gatewayState(), "traceguard_record_decision", { runId: "run_other" });
    expect(tg(r).errorCode).toBe("RUN_NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/mcp-gateway/src/internal-tool-handlers.test.ts`
Expected: FAIL — `./internal-tool-handlers.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `packages/mcp-gateway/src/internal-tool-handlers.ts`:

```ts
import { makeEvent, approvalProjection, runStatusProjection, type LedgerStore } from "@traceguard/event-ledger";
import { computeActionDigest } from "@traceguard/policy-engine";
import { proposeDecision, resolveAuthorizationGateway } from "@traceguard/domain";
import { executionOrchestrator } from "@traceguard/runtime";
import {
  RunStartedPayload,
  RunCompletedPayload,
  RunFailedPayload,
  type ActionDigestInput,
  type DecisionAction,
  type ExecutionAdapterType,
  type LedgerEvent,
} from "@traceguard/schemas";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GatewayState } from "./gateway-state.js";
import type { InternalToolContext } from "./internal-tool-context.js";
import type { CachedDecision } from "./decision-cache.js";
import {
  buildEvaluationContext,
  intendedUpstreamTool,
  isoPlusSeconds,
  policyVersionId,
} from "./evaluation-context.js";

export type { InternalToolContext } from "./internal-tool-context.js";

export type InternalErrorCode =
  | "DECISION_INVALID"
  | "POLICY_BLOCKED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_EXPIRED"
  | "AUTHORIZATION_MISSING"
  | "AUTHORIZATION_CONSUMED"
  | "ACTION_DIGEST_MISMATCH"
  | "EXECUTION_UNKNOWN"
  | "EXECUTION_FAILED"
  | "CAPABILITY_UNAVAILABLE"
  | "RUN_NOT_FOUND";

// Same loose-cast shape 3D's denyCall uses, so the top-level `traceguard` field
// survives the client-side CallToolResultSchema parse.
export function internalOk(status: string, extra: Record<string, unknown> = {}): CallToolResult {
  return {
    isError: false,
    content: [{ type: "text", text: `traceguard:${status}` }],
    traceguard: { status, ...extra },
  } as unknown as CallToolResult;
}

export function internalErr(
  code: InternalErrorCode,
  toolName: string,
  extra: Record<string, unknown> = {},
): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `traceguard:error:${code}` }],
    traceguard: { errorCode: code, toolName, ...extra },
  } as unknown as CallToolResult;
}

// Every tool except check_approval carries the run it belongs to.
const RUN_ID_TOOLS: ReadonlySet<string> = new Set([
  "traceguard_start_run",
  "traceguard_record_decision",
  "traceguard_request_execution",
  "traceguard_execute_authorized_action",
  "traceguard_finish_run",
]);

export async function dispatchInternalTool(
  ctx: InternalToolContext,
  state: GatewayState,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  if (RUN_ID_TOOLS.has(name) && args.runId !== ctx.run.runId) {
    return internalErr("RUN_NOT_FOUND", name);
  }
  switch (name) {
    case "traceguard_start_run":
      return startRun(ctx, state);
    case "traceguard_record_decision":
      return recordDecision(ctx, state, args);
    case "traceguard_request_execution":
      return requestExecution(ctx, args);
    case "traceguard_check_approval":
      return checkApproval(ctx, args);
    case "traceguard_execute_authorized_action":
      return executeAuthorizedAction(ctx, args);
    case "traceguard_finish_run":
      return finishRun(ctx, args);
    default:
      return internalErr("DECISION_INVALID", name);
  }
}

// Pure helper (also imported by boot-gateway's operator seam): the events for one
// approval — its own aggregate, plus the correlated AuthorizationIssued (payload.approvalId).
export function eventsForApproval(events: LedgerEvent[], approvalId: string): LedgerEvent[] {
  return events.filter((e) => {
    if (e.aggregateType === "approval" && e.aggregateId === approvalId) return true;
    const payload = e.payload as { approvalId?: string } | null;
    return payload?.approvalId === approvalId;
  });
}

async function startRun(ctx: InternalToolContext, state: GatewayState): Promise<CallToolResult> {
  const ws = ctx.audit.workspaceId;
  const events = await ctx.store.read(ws, ctx.run.runId);
  if (runStatusProjection(events) === "created") {
    const head = await ctx.store.head(ws);
    const started = makeEvent(
      {
        workspaceId: ws,
        aggregateType: "run",
        aggregateId: ctx.run.runId,
        eventType: "RunStarted",
        eventVersion: 1,
        schemaVersion: 1,
        actorType: "agent",
        ...(ctx.run.agentName !== undefined ? { actorId: ctx.run.agentName } : {}),
        runId: ctx.run.runId,
        payload: RunStartedPayload.parse({
          runId: ctx.run.runId,
          startedAt: ctx.deps.clock.now(),
          ...(ctx.run.agentName !== undefined ? { agentName: ctx.run.agentName } : {}),
          ...(ctx.run.intent !== undefined ? { intent: ctx.run.intent } : {}),
          mode: ctx.run.mode,
        }),
        previousEventHash: head,
      },
      ctx.deps,
    );
    await ctx.store.append(head, [started]);
  }
  return internalOk("RUN_STARTED", {
    runId: ctx.run.runId,
    policyVersionId: policyVersionId(ctx.policy),
    toolManifestHash: state.manifestHash,
  });
}

async function recordDecision(
  ctx: InternalToolContext,
  state: GatewayState,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const name = "traceguard_record_decision";
  const ws = ctx.audit.workspaceId;
  const decisionId = ctx.deps.newId.next("dec");
  const instrument = String(args.instrument ?? "");
  const marketType = String(args.marketType ?? "");
  const action = String(args.action ?? "") as DecisionAction;
  const notional = args.requestedNotionalUsdt !== undefined ? String(args.requestedNotionalUsdt) : undefined;
  const leverage = args.requestedLeverage !== undefined ? String(args.requestedLeverage) : undefined;

  const envelope: Record<string, unknown> = {
    id: decisionId,
    instrument,
    marketType,
    action,
    thesis: String(args.thesis ?? ""),
    evidenceRefs: Array.isArray(args.evidenceRefs) ? args.evidenceRefs : [],
    ...(notional !== undefined ? { requestedNotionalUsdt: notional } : {}),
    ...(leverage !== undefined ? { requestedLeverage: leverage } : {}),
    ...(args.confidence !== undefined ? { confidence: args.confidence } : {}),
  };

  const context = buildEvaluationContext(state, ctx.run, "trade_like", ctx.policy);
  const head = await ctx.store.head(ws);
  const result = proposeDecision(
    {
      workspaceId: ws,
      ...(ctx.run.agentName !== undefined ? { actorId: ctx.run.agentName } : {}),
      envelope,
      policy: ctx.policy,
      context,
      previousEventHash: head,
    },
    ctx.deps,
  );
  await ctx.store.append(head, result.events);

  const evaluated = result.events.find((e) => e.eventType === "PolicyEvaluated");
  if (!evaluated) return internalErr("DECISION_INVALID", name); // fail-closed: DecisionRejected, no evaluation
  const proposed = result.events.find((e) => e.eventType === "DecisionProposed");
  const decisionHash = (proposed?.payload as { decisionHash?: string } | undefined)?.decisionHash ?? "";
  const policyEvaluationId = (evaluated.payload as { evaluationId: string }).evaluationId;

  const digestBase: Omit<ActionDigestInput, "executionAdapter"> = {
    workspaceId: ws,
    runId: ctx.run.runId,
    decisionId,
    providerConnectionId: ctx.audit.providerConnectionId,
    toolName: intendedUpstreamTool(marketType),
    toolManifestHash: state.manifestHash ?? "",
    policyVersionId: policyVersionId(ctx.policy),
    workspaceMode: ctx.run.mode,
    instrument,
    marketType,
    action,
    ...(notional !== undefined ? { requestedNotionalUsdt: notional } : {}),
    ...(leverage !== undefined ? { requestedLeverage: leverage } : {}),
  };

  const cached: CachedDecision = {
    decisionId,
    outcome: result.decision.outcome,
    matchedRules: result.decision.matchedRules.map((r) => r.ruleId),
    policyEvaluationId,
    decisionHash,
    summary: {
      instrument,
      action,
      ...(notional !== undefined ? { notionalUsdt: notional } : {}),
      ...(leverage !== undefined ? { leverage } : {}),
    },
    digestBase,
  };
  ctx.cache.decisions.set(decisionId, cached);
  return internalOk("validated", { decisionId, decisionHash });
}

async function requestExecution(ctx: InternalToolContext, args: Record<string, unknown>): Promise<CallToolResult> {
  const name = "traceguard_request_execution";
  const decisionId = String(args.decisionId ?? "");
  const cached = ctx.cache.decisions.get(decisionId);
  if (!cached) return internalErr("DECISION_INVALID", name);

  const executionAdapter = (args.executionAdapter ?? "simulator") as ExecutionAdapterType;
  if (executionAdapter !== "simulator") return internalErr("CAPABILITY_UNAVAILABLE", name);

  if (cached.outcome === "block") {
    return internalErr("POLICY_BLOCKED", name, { matchedRules: cached.matchedRules, executionSent: false });
  }

  const ws = ctx.audit.workspaceId;
  const actionDigestInput: ActionDigestInput = { ...cached.digestBase, executionAdapter };
  const now = ctx.deps.clock.now();
  const head = await ctx.store.head(ws);
  const gate = resolveAuthorizationGateway(
    {
      workspaceId: ws,
      runId: ctx.run.runId,
      decisionId,
      policyEvaluationId: cached.policyEvaluationId,
      outcome: cached.outcome,
      actionDigestInput,
      channelOptions: ["web"],
      summary: cached.summary,
      approvalExpiresAt: isoPlusSeconds(now, ctx.ttls.approvalSeconds),
      authorizationExpiresAt: isoPlusSeconds(now, ctx.ttls.authorizationSeconds),
      previousEventHash: head,
    },
    ctx.deps,
  );
  await ctx.store.append(head, gate.events);

  if (cached.outcome === "require_approval") {
    const requested = gate.events.find((e) => e.eventType === "ApprovalRequested");
    const approvalId = (requested?.payload as { approvalId: string }).approvalId;
    ctx.cache.approvalIndex.set(approvalId, { runId: ctx.run.runId, decisionId });
    return internalOk("APPROVAL_REQUIRED", {
      approvalId,
      runId: ctx.run.runId,
      expiresAt: isoPlusSeconds(now, ctx.ttls.approvalSeconds),
    });
  }

  // allow: the authorization is already on the ledger; burn-and-execute now.
  return finishExecution(ctx, decisionId, actionDigestInput, executionAdapter, "ALLOWED", name);
}

async function checkApproval(ctx: InternalToolContext, args: Record<string, unknown>): Promise<CallToolResult> {
  const name = "traceguard_check_approval";
  const approvalId = String(args.approvalId ?? "");
  const all = await ctx.store.read(ctx.audit.workspaceId);
  const view = approvalProjection(eventsForApproval(all, approvalId));
  const now = ctx.deps.clock.now();

  switch (view.status) {
    case "approved":
      return internalOk("APPROVED", {
        authorizationId: view.authorizationId,
        authorizationExpiresAt: view.authorizationExpiresAt,
      });
    case "pending":
      if (view.expiresAt !== undefined && now >= view.expiresAt) return internalErr("APPROVAL_EXPIRED", name);
      return internalOk("PENDING");
    case "rejected":
      return internalOk("REJECTED");
    case "consumed":
      return internalOk("CONSUMED");
    default: // expired / revoked
      return internalErr("APPROVAL_EXPIRED", name);
  }
}

async function executeAuthorizedAction(
  ctx: InternalToolContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const name = "traceguard_execute_authorized_action";
  const decisionId = String(args.decisionId ?? "");
  const cached = ctx.cache.decisions.get(decisionId);
  if (!cached) return internalErr("DECISION_INVALID", name);

  const executionAdapter = (args.executionAdapter ?? "simulator") as ExecutionAdapterType;
  if (executionAdapter !== "simulator") return internalErr("CAPABILITY_UNAVAILABLE", name);

  const actionDigestInput: ActionDigestInput = { ...cached.digestBase, executionAdapter };
  return finishExecution(ctx, decisionId, actionDigestInput, executionAdapter, "EXECUTED", name);
}

async function finishRun(ctx: InternalToolContext, args: Record<string, unknown>): Promise<CallToolResult> {
  const ws = ctx.audit.workspaceId;
  const outcome = String(args.outcome ?? "succeeded");
  const status = runStatusProjection(await ctx.store.read(ws, ctx.run.runId));
  if (status === "completed" || status === "failed") {
    return internalOk(status, { runId: ctx.run.runId }); // idempotent: allow path already settled
  }

  const head = await ctx.store.head(ws);
  const now = ctx.deps.clock.now();
  const event =
    outcome === "failed"
      ? makeEvent(
          {
            workspaceId: ws,
            aggregateType: "run",
            aggregateId: ctx.run.runId,
            eventType: "RunFailed",
            eventVersion: 1,
            schemaVersion: 1,
            actorType: "system",
            runId: ctx.run.runId,
            payload: RunFailedPayload.parse({ runId: ctx.run.runId, failedAt: now, reasonCode: "orchestrator_error" }),
            previousEventHash: head,
          },
          ctx.deps,
        )
      : makeEvent(
          {
            workspaceId: ws,
            aggregateType: "run",
            aggregateId: ctx.run.runId,
            eventType: "RunCompleted",
            eventVersion: 1,
            schemaVersion: 1,
            actorType: "system",
            runId: ctx.run.runId,
            payload: RunCompletedPayload.parse({ runId: ctx.run.runId, completedAt: now }),
            previousEventHash: head,
          },
          ctx.deps,
        );
  await ctx.store.append(head, [event]);
  return internalOk(outcome === "failed" ? "failed" : "completed", { runId: ctx.run.runId });
}

// Shared burn-and-settle mapping for the allow branch and execute_authorized_action.
async function finishExecution(
  ctx: InternalToolContext,
  decisionId: string,
  actionDigestInput: ActionDigestInput,
  adapterType: ExecutionAdapterType,
  okStatus: "ALLOWED" | "EXECUTED",
  toolName: string,
): Promise<CallToolResult> {
  const ws = ctx.audit.workspaceId;
  const attemptedActionDigest = computeActionDigest(actionDigestInput, ctx.deps.hash);
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

  if (outcome === "completed") {
    const payload = await lastEventPayload(ctx.store, ws, ctx.run.runId, "ExecutionCompleted");
    const completed = (payload ?? {}) as { executionId?: string };
    return internalOk(okStatus, { executionId: completed.executionId, receipt: pickReceipt(payload) });
  }
  if (outcome === "denied") {
    const payload = await lastEventPayload(ctx.store, ws, ctx.run.runId, "AuthorizationRejected");
    return internalErr(mapGuardReason(reasonOf(payload)), toolName);
  }
  if (outcome === "rejected") {
    const payload = await lastEventPayload(ctx.store, ws, ctx.run.runId, "ExecutionRejected");
    return internalErr(mapExecReason(reasonOf(payload)), toolName);
  }
  if (outcome === "unknown") return internalErr("EXECUTION_UNKNOWN", toolName);
  return internalErr("EXECUTION_FAILED", toolName);
}

async function lastEventPayload(
  store: LedgerStore,
  ws: string,
  runId: string,
  eventType: string,
): Promise<unknown> {
  const events = await store.read(ws, runId);
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.eventType === eventType) return events[i]!.payload;
  }
  return undefined;
}

function reasonOf(payload: unknown): string {
  return (payload as { reasonCode?: string } | undefined)?.reasonCode ?? "";
}

function pickReceipt(payload: unknown): { receiptRef: string; receiptHash: string; finalStatus: string } {
  const p = (payload ?? {}) as { receiptRef?: string; receiptHash?: string; finalStatus?: string };
  return { receiptRef: p.receiptRef ?? "", receiptHash: p.receiptHash ?? "", finalStatus: p.finalStatus ?? "" };
}

function mapGuardReason(reasonCode: string): InternalErrorCode {
  switch (reasonCode) {
    case "missing_authorization":
      return "AUTHORIZATION_MISSING";
    case "expired_authorization":
      return "APPROVAL_EXPIRED";
    case "already_consumed":
      return "AUTHORIZATION_CONSUMED";
    case "action_digest_mismatch":
      return "ACTION_DIGEST_MISMATCH";
    default:
      return "AUTHORIZATION_MISSING"; // workspace_locked / manifest_changed / policy_changed (unreachable here)
  }
}

// Forward-compat only: every executionGate is false in this slice, so this is unreachable.
function mapExecReason(_reasonCode: string): InternalErrorCode {
  return "CAPABILITY_UNAVAILABLE";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/mcp-gateway/src/internal-tool-handlers.test.ts`
Expected: PASS (start_run / allow→ALLOWED / block→POLICY_BLOCKED / require_approval→APPROVAL_REQUIRED + PENDING / non-simulator / unknown id / RUN_NOT_FOUND).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-gateway/src/internal-tool-handlers.ts packages/mcp-gateway/src/internal-tool-handlers.test.ts
git commit -m "feat(mcp-gateway): add internal tool handlers (governed decision -> execution)"
```

---

### Task 9: Wire internal tools into `gateway-server.ts`

`createGatewayServer` gains an optional third arg `internalCtx`. When present (non-degraded boot), the six `traceguard_*` tools are listed **first** and `tools/call` on an internal name dispatches to `dispatchInternalTool`; everything else falls through to 3D's `handleToolCall` unchanged.

**Files:**
- Modify: `packages/mcp-gateway/src/gateway-server.ts`
- Test: `packages/mcp-gateway/src/gateway-server.test.ts`

- [ ] **Step 1: Write the failing test additions**

In `packages/mcp-gateway/src/gateway-server.test.ts`, add these imports after the existing `createGatewayServer` import (line 13):

```ts
import { createSimulatorAdapter } from "@traceguard/runtime";
import { DEFAULT_POLICY } from "./default-policy.js";
import { createDecisionCache } from "./decision-cache.js";
import type { InternalToolContext } from "./internal-tool-context.js";
```

Replace the existing `connectedClient` helper (lines 59-69) with this internalCtx-aware version:

```ts
async function connectedClient(
  state: GatewayState,
  callCtx?: GatewayCallContext,
  internalCtx?: InternalToolContext,
): Promise<Client> {
  const server = createGatewayServer(state, callCtx, internalCtx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

async function makeInternalCtx(
  d: ReturnType<typeof deps>,
): Promise<{ callCtx: GatewayCallContext; internalCtx: InternalToolContext }> {
  const store = new InMemoryLedgerStore();
  const run = recordRunCreated(AUDIT, d, null);
  await store.append(null, [run]);
  const callCtx: GatewayCallContext = { client: new FakeUpstreamClient(), store, deps: d, audit: AUDIT };
  const internalCtx: InternalToolContext = {
    store,
    deps: d,
    audit: AUDIT,
    policy: DEFAULT_POLICY,
    adapter: createSimulatorAdapter({ hash: sha256hex }),
    run: { runId: AUDIT.runId, mode: "safe_demo" },
    cache: createDecisionCache(),
    ttls: { approvalSeconds: 900, authorizationSeconds: 900 },
  };
  return { callCtx, internalCtx };
}

function tgStatus(res: unknown): Record<string, unknown> {
  return ((res as { traceguard?: Record<string, unknown> }).traceguard ?? {}) as Record<string, unknown>;
}
```

Append this `describe` block at the end of the file:

```ts
describe("createGatewayServer internal traceguard_* tools", () => {
  it("lists the six internal tools first, then the governed read tools", async () => {
    const { callCtx, internalCtx } = await makeInternalCtx(deps());
    const client = await connectedClient(fixtureState(), callCtx, internalCtx);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.slice(0, 6)).toEqual([
      "traceguard_start_run",
      "traceguard_record_decision",
      "traceguard_request_execution",
      "traceguard_check_approval",
      "traceguard_execute_authorized_action",
      "traceguard_finish_run",
    ]);
    expect(names).toContain("spot_get_ticker");
    expect(names).not.toContain("spot_place_order"); // blocked/non-served, unchanged from 3D
    await client.close();
  });

  it("drives start_run -> record_decision -> request_execution to ALLOWED through the SDK", async () => {
    const { callCtx, internalCtx } = await makeInternalCtx(deps());
    const client = await connectedClient(fixtureState(), callCtx, internalCtx);

    await client.callTool({ name: "traceguard_start_run", arguments: { runId: "run_1", agentName: "a", intent: "i" } });
    const rec = await client.callTool({
      name: "traceguard_record_decision",
      arguments: {
        runId: "run_1",
        instrument: "BTCUSDT",
        marketType: "futures",
        action: "open_long",
        thesis: "t",
        evidenceRefs: ["ev:1"],
        requestedNotionalUsdt: "100",
        requestedLeverage: "2",
      },
    });
    const decisionId = tgStatus(rec).decisionId as string;

    const exec = await client.callTool({
      name: "traceguard_request_execution",
      arguments: { runId: "run_1", decisionId, executionAdapter: "simulator" },
    });
    expect(tgStatus(exec).status).toBe("ALLOWED");
    expect(typeof tgStatus(exec).executionId).toBe("string");
    await client.close();
  });

  it("returns POLICY_BLOCKED for a high-leverage decision through the SDK", async () => {
    const { callCtx, internalCtx } = await makeInternalCtx(deps());
    const client = await connectedClient(fixtureState(), callCtx, internalCtx);

    await client.callTool({ name: "traceguard_start_run", arguments: { runId: "run_1" } });
    const rec = await client.callTool({
      name: "traceguard_record_decision",
      arguments: {
        runId: "run_1",
        instrument: "BTCUSDT",
        marketType: "futures",
        action: "open_long",
        thesis: "t",
        evidenceRefs: ["ev:1"],
        requestedNotionalUsdt: "100",
        requestedLeverage: "10",
      },
    });
    const decisionId = tgStatus(rec).decisionId as string;
    const exec = await client.callTool({
      name: "traceguard_request_execution",
      arguments: { runId: "run_1", decisionId, executionAdapter: "simulator" },
    });
    expect((exec as { isError?: boolean }).isError).toBe(true);
    expect(tgStatus(exec).errorCode).toBe("POLICY_BLOCKED");
    await client.close();
  });

  it("omits internal tools and short-circuits when no context is wired (degraded)", async () => {
    const client = await connectedClient(fixtureState(), undefined, undefined);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.some((n) => n.startsWith("traceguard_"))).toBe(false);
    const res = await client.callTool({ name: "traceguard_start_run", arguments: { runId: "run_1" } });
    expect((res as { traceguard: { errorCode: string } }).traceguard.errorCode).toBe("TOOL_CALL_NOT_AVAILABLE");
    await client.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/mcp-gateway/src/gateway-server.test.ts`
Expected: FAIL — `createGatewayServer` ignores the third arg, so the internal tools are never listed/dispatched (and may be a TS arity error on the new call).

- [ ] **Step 3: Modify `gateway-server.ts`**

Replace the entire contents of `packages/mcp-gateway/src/gateway-server.ts` with:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { GatewayState } from "./gateway-state.js";
import { handleToolCall, type GatewayCallContext } from "./call-handler.js";
import { dispatchInternalTool, type InternalToolContext } from "./internal-tool-handlers.js";
import { INTERNAL_TOOL_DEFS, INTERNAL_TOOL_NAMES } from "./internal-tools.js";

export type { GatewayCallContext } from "./call-handler.js";

export function createGatewayServer(
  state: GatewayState,
  callCtx?: GatewayCallContext,
  internalCtx?: InternalToolContext,
): Server {
  const server = new Server(
    { name: "traceguard-gateway", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      ...(internalCtx !== undefined
        ? INTERNAL_TOOL_DEFS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          }))
        : []),
      ...state.servedTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments ?? {};
    if (internalCtx !== undefined && INTERNAL_TOOL_NAMES.has(name)) {
      return dispatchInternalTool(internalCtx, state, name, args);
    }
    return handleToolCall(state, callCtx, name, args);
  });

  return server;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/mcp-gateway/src/gateway-server.test.ts`
Expected: PASS (list-merge, ALLOWED round-trip, POLICY_BLOCKED, degraded omission + `TOOL_CALL_NOT_AVAILABLE`), and the four existing 3D cases still green.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-gateway/src/gateway-server.ts packages/mcp-gateway/src/gateway-server.test.ts
git commit -m "feat(mcp-gateway): list and dispatch internal traceguard_* tools when internalCtx is wired"
```

---

### Task 10: Wire `InternalToolContext` + operator seam into `boot-gateway.ts`

A non-degraded boot now builds the `InternalToolContext` (simulator adapter, `DEFAULT_POLICY` or the `policy?` override, a fresh decision cache, the seed `RunContext`), passes it to `createGatewayServer`, and exposes `handle.approve` / `handle.reject` operator closures. Degraded boot is **byte-for-byte unchanged** from 3D (no run, no internal ctx, no seam).

**Files:**
- Modify: `packages/mcp-gateway/src/boot-gateway.ts`
- Test: `packages/mcp-gateway/src/boot-gateway.test.ts`

- [ ] **Step 1: Write the failing test additions**

In `packages/mcp-gateway/src/boot-gateway.test.ts`, add these imports after the existing imports (after line 17):

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

function tg(res: unknown): Record<string, unknown> {
  return ((res as { traceguard?: Record<string, unknown> }).traceguard ?? {}) as Record<string, unknown>;
}

async function connect(server: import("@modelcontextprotocol/sdk/server/index.js").Server): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "boot-test-agent", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}
```

Append these two `it` blocks inside the existing `describe("bootGateway", ...)` block (before its closing `});`):

```ts
it("happy path: exposes the operator seam and runs require_approval -> approve -> EXECUTED", async () => {
  const client = new FakeUpstreamClient({ kind: "tools", tools: bitget36RawTools });
  const store = new InMemoryLedgerStore();
  const handle = await bootGateway(baseArgs, client, store, makeDeps());

  expect(typeof handle.approve).toBe("function");
  expect(typeof handle.reject).toBe("function");
  expect(handle.runId).toMatch(/^run_/);

  const agent = await connect(handle.server);
  try {
    await agent.callTool({
      name: "traceguard_start_run",
      arguments: { runId: handle.runId, agentName: "a", intent: "i" },
    });
    const rec = await agent.callTool({
      name: "traceguard_record_decision",
      arguments: {
        runId: handle.runId,
        instrument: "BTCUSDT",
        marketType: "futures",
        action: "open_long",
        thesis: "t",
        evidenceRefs: ["ev:1"],
        requestedNotionalUsdt: "5000",
        requestedLeverage: "2",
      },
    });
    const decisionId = tg(rec).decisionId as string;

    const reqExec = await agent.callTool({
      name: "traceguard_request_execution",
      arguments: { runId: handle.runId, decisionId, executionAdapter: "simulator" },
    });
    expect(tg(reqExec).status).toBe("APPROVAL_REQUIRED");
    const approvalId = tg(reqExec).approvalId as string;

    const pending = await agent.callTool({ name: "traceguard_check_approval", arguments: { approvalId } });
    expect(tg(pending).status).toBe("PENDING");

    const outcome = await handle.approve!(approvalId, { approvedBy: "ops", channel: "web" });
    expect(outcome).toBe("approved");

    const approved = await agent.callTool({ name: "traceguard_check_approval", arguments: { approvalId } });
    expect(tg(approved).status).toBe("APPROVED");
    const authorizationId = tg(approved).authorizationId as string;

    const exec = await agent.callTool({
      name: "traceguard_execute_authorized_action",
      arguments: { runId: handle.runId, decisionId, authorizationId, executionAdapter: "simulator" },
    });
    expect(tg(exec).status).toBe("EXECUTED");
    expect((tg(exec).receipt as { finalStatus?: string }).finalStatus).toBe("simulated");
  } finally {
    await agent.close();
  }
});

it("degraded path: no operator seam, no runId, no internal tools listed", async () => {
  const client = new FakeUpstreamClient({ kind: "listThrows" });
  const store = new InMemoryLedgerStore();
  const handle = await bootGateway(baseArgs, client, store, makeDeps());

  expect(handle.approve).toBeUndefined();
  expect(handle.reject).toBeUndefined();
  expect(handle.runId).toBeUndefined();

  const agent = await connect(handle.server);
  try {
    const names = (await agent.listTools()).tools.map((t) => t.name);
    expect(names.some((n) => n.startsWith("traceguard_"))).toBe(false);
  } finally {
    await agent.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/mcp-gateway/src/boot-gateway.test.ts`
Expected: FAIL — `handle.approve` is `undefined` and the server lists no internal tools (the success path does not yet build `internalCtx`).

- [ ] **Step 3: Modify `boot-gateway.ts`**

Replace the entire contents of `packages/mcp-gateway/src/boot-gateway.ts` with:

```ts
import { reconcileManifest, type ReconcileDeps } from "@traceguard/tool-manifest";
import {
  toolManifestProjection,
  approvalProjection,
  type LedgerStore,
} from "@traceguard/event-ledger";
import type { ApprovalChannel, Policy, ProviderType } from "@traceguard/schemas";
import {
  approveApproval,
  rejectApproval,
  type ApprovalOutcome,
} from "@traceguard/domain";
import { createSimulatorAdapter } from "@traceguard/runtime";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  type UpstreamManifestClient,
  UpstreamUnavailableError,
  UpstreamListToolsError,
} from "./upstream-client.js";
import { buildGatewayState, degradedState, type GatewayState } from "./gateway-state.js";
import { createGatewayServer } from "./gateway-server.js";
import { recordRunCreated, type CallAudit } from "./tool-call-events.js";
import type { GatewayCallContext } from "./call-handler.js";
import { DEFAULT_POLICY } from "./default-policy.js";
import { createDecisionCache } from "./decision-cache.js";
import { isoPlusSeconds } from "./evaluation-context.js";
import { eventsForApproval } from "./internal-tool-handlers.js";
import type { ApprovalTtls, InternalToolContext, RunContext } from "./internal-tool-context.js";

export interface BootGatewayArgs {
  workspaceId: string;
  providerConnectionId: string;
  providerType: ProviderType;
  toolManifestVersionId: string;
  policy?: Policy; // defaults to DEFAULT_POLICY
}

export interface GatewayHandle {
  state: GatewayState;
  server: Server;
  client: UpstreamManifestClient; // long-lived on success; caller owns shutdown
  runId?: string;
  approve?: (approvalId: string, by: { approvedBy: string; channel: ApprovalChannel }) => Promise<ApprovalOutcome>;
  reject?: (
    approvalId: string,
    by: { rejectedBy: string; channel: ApprovalChannel; reason?: string },
  ) => Promise<ApprovalOutcome>;
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
      const degraded = degradedState();
      const server = createGatewayServer(degraded);
      return { state: degraded, server, client };
    }
    await safeClose(client); // unexpected (e.g. LedgerConflictError, bug): surface it
    throw err;
  }

  const runId = deps.newId.next("run");
  const runHead = await store.head(args.workspaceId);
  const runEvent = recordRunCreated(
    {
      workspaceId: args.workspaceId,
      runId,
      providerConnectionId: args.providerConnectionId,
    },
    deps,
    runHead,
  );
  await store.append(runHead, [runEvent]);

  const audit: CallAudit = {
    workspaceId: args.workspaceId,
    runId,
    providerConnectionId: args.providerConnectionId,
  };
  const callCtx: GatewayCallContext = { client, store, deps, audit };

  const ws = args.workspaceId;
  const policy = args.policy ?? DEFAULT_POLICY;
  const ttls: ApprovalTtls = { approvalSeconds: 900, authorizationSeconds: 900 };
  const run: RunContext = { runId, mode: "safe_demo" };
  const internalCtx: InternalToolContext = {
    store,
    deps,
    audit,
    policy,
    adapter: createSimulatorAdapter({ hash: deps.hash }),
    run,
    cache: createDecisionCache(),
    ttls,
  };

  async function approve(
    approvalId: string,
    by: { approvedBy: string; channel: ApprovalChannel },
  ): Promise<ApprovalOutcome> {
    const all = await store.read(ws);
    const approvalState = approvalProjection(eventsForApproval(all, approvalId));
    const head = await store.head(ws);
    const res = approveApproval(
      {
        workspaceId: ws,
        approvalState,
        approvedBy: by.approvedBy,
        approvalChannel: by.channel,
        authorizationExpiresAt: isoPlusSeconds(deps.clock.now(), ttls.authorizationSeconds),
        previousEventHash: head,
      },
      deps,
    );
    if (res.events.length > 0) await store.append(head, res.events);
    return res.outcome;
  }

  async function reject(
    approvalId: string,
    by: { rejectedBy: string; channel: ApprovalChannel; reason?: string },
  ): Promise<ApprovalOutcome> {
    const all = await store.read(ws);
    const approvalState = approvalProjection(eventsForApproval(all, approvalId));
    const head = await store.head(ws);
    const res = rejectApproval(
      {
        workspaceId: ws,
        approvalState,
        rejectedBy: by.rejectedBy,
        rejectionChannel: by.channel,
        ...(by.reason !== undefined ? { reason: by.reason } : {}),
        previousEventHash: head,
      },
      deps,
    );
    if (res.events.length > 0) await store.append(head, res.events);
    return res.outcome;
  }

  const server = createGatewayServer(state, callCtx, internalCtx);
  return { state, server, client, runId, approve, reject };
}

async function safeClose(client: UpstreamManifestClient): Promise<void> {
  try {
    await client.close();
  } catch {
    /* teardown is best-effort */
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/mcp-gateway/src/boot-gateway.test.ts`
Expected: PASS — the three existing 3D cases plus the new happy (seam present, approve→EXECUTED) and degraded (no seam, no internal tools) cases.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-gateway/src/boot-gateway.ts packages/mcp-gateway/src/boot-gateway.test.ts
git commit -m "feat(mcp-gateway): build InternalToolContext and expose approve/reject operator seam on boot"
```

---

### Task 11: Barrel exports + governed live integration test

Re-export the six new modules from the package barrel, then extend the gated live test with a governed allow + block round-trip against the real `bitget-mcp-server --paper-trading`.

**Files:**
- Modify: `packages/mcp-gateway/src/index.ts`
- Modify: `packages/mcp-gateway/src/index.test.ts`
- Modify: `packages/mcp-gateway/src/gateway-local.integration.test.ts`

- [ ] **Step 1: Write the failing barrel test additions**

Append this `it` block inside the existing `describe("@traceguard/mcp-gateway barrel", ...)` in `packages/mcp-gateway/src/index.test.ts` (before its closing `});`):

```ts
it("re-exports the 3E-1 internal-tool surface", () => {
  expect(typeof gateway.DEFAULT_POLICY).toBe("object");
  expect(gateway.NOTIONAL_APPROVAL_THRESHOLD_USDT).toBe("1000");
  expect(typeof gateway.createDecisionCache).toBe("function");
  expect(typeof gateway.buildEvaluationContext).toBe("function");
  expect(typeof gateway.intendedUpstreamTool).toBe("function");
  expect(gateway.INTERNAL_TOOL_NAMES instanceof Set).toBe(true);
  expect(Array.isArray(gateway.INTERNAL_TOOL_DEFS)).toBe(true);
  expect(typeof gateway.dispatchInternalTool).toBe("function");
  expect(typeof gateway.eventsForApproval).toBe("function");
});
```

- [ ] **Step 2: Run the barrel test to verify it fails**

Run: `pnpm vitest run packages/mcp-gateway/src/index.test.ts`
Expected: FAIL — `gateway.DEFAULT_POLICY` (and the other new symbols) are `undefined` until the barrel re-exports them.

- [ ] **Step 3: Modify the barrel `index.ts`**

Replace the entire contents of `packages/mcp-gateway/src/index.ts` with:

```ts
export * from "./upstream-client.js";
export * from "./map-tool.js";
export * from "./import-manifest.js";
export * from "./stdio-upstream-client.js";
export * from "./gateway-state.js";
export * from "./call-router.js";
export * from "./tool-call-events.js";
export * from "./gateway-server.js";
export * from "./call-handler.js";
export * from "./boot-gateway.js";
export * from "./default-policy.js";
export * from "./decision-cache.js";
export * from "./evaluation-context.js";
export * from "./internal-tools.js";
export * from "./internal-tool-handlers.js";
// internal-tool-context's InternalToolContext is already re-exported by
// internal-tool-handlers.js; re-export only the two types it does not surface,
// to avoid an `export *` name collision on InternalToolContext.
export type { RunContext, ApprovalTtls } from "./internal-tool-context.js";
```

- [ ] **Step 4: Run the barrel test to verify it passes**

Run: `pnpm vitest run packages/mcp-gateway/src/index.test.ts`
Expected: PASS (the existing surface plus the nine new symbols).

- [ ] **Step 5: Extend the gated live integration test**

In `packages/mcp-gateway/src/gateway-local.integration.test.ts`, inside the inner `try { … } finally { await agent.close(); }` block, **after** the existing `DECISION_ENVELOPE_REQUIRED` assertion (after line 57) and **before** the `finally`, insert:

```ts
          const listed = await agent.listTools();
          expect(listed.tools.map((t) => t.name)).toContain("traceguard_record_decision");

          await agent.callTool({
            name: "traceguard_start_run",
            arguments: { runId: handle.runId, agentName: "live", intent: "demo" },
          });
          const rec = await agent.callTool({
            name: "traceguard_record_decision",
            arguments: {
              runId: handle.runId,
              instrument: "BTCUSDT",
              marketType: "futures",
              action: "open_long",
              thesis: "t",
              evidenceRefs: ["ev:1"],
              requestedNotionalUsdt: "100",
              requestedLeverage: "2",
            },
          });
          const decisionId = (rec as { traceguard?: { decisionId?: string } }).traceguard?.decisionId;
          const allowed = await agent.callTool({
            name: "traceguard_request_execution",
            arguments: { runId: handle.runId, decisionId, executionAdapter: "simulator" },
          });
          expect((allowed as { traceguard?: { status?: string } }).traceguard?.status).toBe("ALLOWED");

          const recBlocked = await agent.callTool({
            name: "traceguard_record_decision",
            arguments: {
              runId: handle.runId,
              instrument: "BTCUSDT",
              marketType: "futures",
              action: "open_long",
              thesis: "t",
              evidenceRefs: ["ev:1"],
              requestedNotionalUsdt: "100",
              requestedLeverage: "10",
            },
          });
          const blockedId = (recBlocked as { traceguard?: { decisionId?: string } }).traceguard?.decisionId;
          const blocked = await agent.callTool({
            name: "traceguard_request_execution",
            arguments: { runId: handle.runId, decisionId: blockedId, executionAdapter: "simulator" },
          });
          expect((blocked as { traceguard?: { errorCode?: string } }).traceguard?.errorCode).toBe(
            "POLICY_BLOCKED",
          );
```

- [ ] **Step 6: Verify the full suite (live test stays skipped)**

Run: `pnpm test`
Expected: PASS. The live test is `describe.skipIf(!live)` and `TRACEGUARD_LIVE_MCP` is unset, so it is skipped; it must still **compile** (the new `handle.runId` / `agent.callTool` lines typecheck). To exercise it manually: `TRACEGUARD_LIVE_MCP=1 pnpm vitest run packages/mcp-gateway/src/gateway-local.integration.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/mcp-gateway/src/index.ts packages/mcp-gateway/src/index.test.ts packages/mcp-gateway/src/gateway-local.integration.test.ts
git commit -m "feat(mcp-gateway): export internal-tool surface and add governed live allow/block integration"
```

---

### Task 12: Documentation alignment (`docs/mcp-gateway-contract.md`)

Land the §10 documentation-alignment notes so the contract reflects what 3E-1 implemented (full-coherence preference). Prose only — no test; verification is a clean `pnpm build` (docs do not affect compilation) plus a grep that the notes landed.

**Files:**
- Modify: `docs/mcp-gateway-contract.md`

- [ ] **Step 1: §9.4 — mark the trade-like governance path as landed**

Find the heading line `### 9.4 Handling Path: Trade-like` and insert immediately after it (as a new paragraph):

```markdown
> **3E-1 (landed):** The trade-like governance path is implemented behind the six internal `traceguard_*` tools (`start_run → record_decision → request_execution → [check_approval] → execute_authorized_action → finish_run`), not by intercepting the upstream `*_place_order` call — the raw upstream `trade_like` deny (`DECISION_ENVELOPE_REQUIRED`) is unchanged. Execution targets a **simulator** adapter. Argument JSON-Schema validation (§9.2) and result redaction (§9.3) on the forwarded path remain deferred to **3E-2**.
```

- [ ] **Step 2: §12.3 — record where policy is evaluated**

Find the heading line ``### 12.3 `traceguard_request_execution` `` and insert immediately after it:

```markdown
> **3E-1 (landed):** The policy outcome is computed at `record_decision` (inside `proposeDecision`) and **cached**; `request_execution` acts on the cached outcome — allow ⇒ issue authorization + burn + simulate execution inline; require_approval ⇒ emit `ApprovalRequested` and return non-blocking `APPROVAL_REQUIRED`; block ⇒ `POLICY_BLOCKED` (`isError:true`, `matchedRules`, `executionSent:false`). `finish_run` is idempotent against an allow path that already settled the run.
```

- [ ] **Step 3: §13 — document the operator seam**

Find the heading line `## 13. Approval Pending Semantics` and insert immediately after it:

```markdown
> **3E-1 (landed):** Human approval is **out-of-band** via the `handle.approve` / `handle.reject` operator seam on the `GatewayHandle` (a human is not the agent), deliberately **not** an MCP tool. `request_execution` never blocks; the agent resumes via `check_approval` → `execute_authorized_action` once the approval flips to `APPROVED`. The seam is an in-process function in this slice; a persistent web/telegram approval channel is later-phase.
```

- [ ] **Step 4: §14 — add the internal-tool error codes**

Find the heading line `## 14. Structured Error Codes` and insert immediately after it:

```markdown
> **3E-1 internal-tool codes:** `DECISION_INVALID`, `POLICY_BLOCKED`, `APPROVAL_REQUIRED` (a non-error `status`, `isError:false`), `APPROVAL_EXPIRED`, `AUTHORIZATION_MISSING`, `AUTHORIZATION_CONSUMED`, `ACTION_DIGEST_MISMATCH`, `EXECUTION_UNKNOWN`, `EXECUTION_FAILED`, `CAPABILITY_UNAVAILABLE`, `RUN_NOT_FOUND`. Reserved-but-unreachable in the simulator slice (all gates `false`): `SNAPSHOT_STALE`, `PROVIDER_DEGRADED`, `WORKSPACE_LOCKED`, `MANIFEST_UNAPPROVED`.
```

- [ ] **Step 5: §16 — document the in-memory decision cache**

Find the heading line `## 16. Event Emission` and insert immediately after it:

```markdown
> **3E-1 (landed):** The ledger is the source of truth for events; 3E-1 adds an in-memory `Map<decisionId, CachedDecision>` derived index that carries the `ActionDigestInput` base (so the action digest reproduces byte-for-byte at issue / approve / execute time) and the `policyEvaluationId`. It is rebuildable from a projection — that rebuild, plus per-approval event isolation beyond the one-decision-per-run `eventsForApproval` demo scope, is deferred to **3E-2+**.
```

- [ ] **Step 6: Verify the notes landed and the build is clean**

Run: `grep -c "3E-1" docs/mcp-gateway-contract.md`
Expected: `5` (one note under each of §9.4, §12.3, §13, §14, §16).
Run: `pnpm build`
Expected: clean (docs do not affect compilation; this confirms nothing else regressed).

- [ ] **Step 7: Commit**

```bash
git add docs/mcp-gateway-contract.md
git commit -m "docs(mcp-gateway): align contract §9/§12/§13/§14/§16 with 3E-1 governed execution"
```

---

## Final verification (after all tasks)

- [ ] **Whole-suite green + clean build/typecheck**

```bash
pnpm build && pnpm typecheck && pnpm test
```

Expected: `tsc --build` clean, no type errors, all default-suite tests pass (the live integration test stays skipped without `TRACEGUARD_LIVE_MCP`).

- [ ] **Acceptance walk-through (spec §11)** — confirm each holds:
  - Non-degraded `tools/list` = six `traceguard_*` first + governed read tools; blocked tools hidden; degraded = neither.
  - `start_run → record_decision(allow) → request_execution` ⇒ `ALLOWED` + receipt; ledger shows `DecisionProposed…PolicyEvaluated`, `AuthorizationIssued`, `ExecutionRequested`+`AuthorizationConsumed`, `ExecutionCompleted`, `RunCompleted`.
  - `require_approval` ⇒ non-blocking `APPROVAL_REQUIRED`; `handle.approve` ⇒ `APPROVED`; `execute_authorized_action` (same adapter) ⇒ `EXECUTED` + receipt.
  - Double `execute_authorized_action` ⇒ `AUTHORIZATION_CONSUMED`; non-simulator ⇒ `CAPABILITY_UNAVAILABLE`; foreign `runId` ⇒ `RUN_NOT_FOUND`; `block` ⇒ `POLICY_BLOCKED` (no execution events); invalid envelope ⇒ `DECISION_INVALID`.
  - 3D unchanged: raw `trade_like` `tools/call` still denies `DECISION_ENVELOPE_REQUIRED`; read-class forwards still return raw upstream results.
  - `RunStartedPayload` is the only schema change; stdout carries only JSON-RPC.
