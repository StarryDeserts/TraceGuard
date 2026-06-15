# TraceGuard Phase 3 — 3D Governed tools/call Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 3C's `TOOL_CALL_NOT_AVAILABLE` stub with real governed `tools/call` routing that forwards read-class calls over the long-lived upstream connection, fail-closed-denies everything else by risk class, and records digest-only audit events for every governed call.

**Architecture:** A pure `routeCall(state, name)` router classifies every tool from `state.route` (status-first: frozen/blocked beat risk-class; then risk-class within active). An imperative `handleToolCall` shell consumes that outcome — forwarding `public_read`/`account_read` to the reused `StdioUpstreamClient`, denying `trade_like`/`blocked`/`frozen`/`unknown` with typed `traceguard.errorCode` payloads, opening an `IncidentOpened` event only for `TOOL_BLOCKED`. Every governed call brackets the upstream call with `ToolCallRequested` → `ToolCallCompleted`/`ToolCallFailed` audit events on the append-only hash-chained ledger, anchored by one `RunCreated` event minted at boot.

**Tech Stack:** TypeScript strict ESM (NodeNext, ES2022, `noUncheckedIndexedAccess`), `@modelcontextprotocol/sdk` ^1.29.0, zod, vitest ^4.1.0, pnpm workspaces. Event-sourced ledger via `@traceguard/event-ledger`; payload schemas via `@traceguard/schemas`; injected `deps = {clock, newId, hash}` for byte-reproducibility.

---

## File Structure

**Create:**
- `packages/schemas/src/tool-call-payloads.ts` — zod payload schemas for the 5 ToolCall* / Incident / deny-code types (digest-only, `.strict()`).
- `packages/schemas/src/tool-call-payloads.test.ts` — schema unit tests.
- `packages/mcp-gateway/src/call-router.ts` — pure `routeCall(state, name): RouteOutcome` classifier.
- `packages/mcp-gateway/src/call-router.test.ts` — router truth-table tests.
- `packages/mcp-gateway/src/tool-call-events.ts` — 6 ledger-event builders (RunCreated + 4 ToolCall* + IncidentOpened).
- `packages/mcp-gateway/src/tool-call-events.test.ts` — builder envelope/digest tests.
- `packages/mcp-gateway/src/call-handler.ts` — imperative `handleToolCall` shell + `denyCall` helper.
- `packages/mcp-gateway/src/call-handler.test.ts` — end-to-end governed-call tests with fakes.
- `packages/mcp-gateway/src/upstream-client.test.ts` — `UpstreamCallError` anchor test.

**Modify:**
- `packages/schemas/src/run-payloads.ts` — add `RunCreatedPayload`.
- `packages/schemas/src/index.ts` — barrel `tool-call-payloads.js`.
- `packages/mcp-gateway/src/gateway-state.ts` — add `route: Map<string, RouteEntry>` + `RouteEntry`.
- `packages/mcp-gateway/src/upstream-client.ts` — add `callTool` to interface + `UpstreamCallError`.
- `packages/mcp-gateway/src/stdio-upstream-client.ts` — implement `callTool`.
- `packages/mcp-gateway/src/gateway-server.ts` — wire `handleToolCall`, drop local stub.
- `packages/mcp-gateway/src/boot-gateway.ts` — mint `RunCreated` anchor + build `GatewayCallContext`.
- `packages/mcp-gateway/src/index.ts` — barrel new modules (ordered to avoid duplicate export).
- `packages/mcp-gateway/src/gateway-state.test.ts` — route assertions.
- `packages/mcp-gateway/src/gateway-server.test.ts` — rewrite for governed call wiring.
- `packages/mcp-gateway/src/boot-gateway.test.ts` — RunCreated anchor assertions + `callTool` fake stub.
- `packages/mcp-gateway/src/import-manifest.test.ts` — `callTool` fake stub.
- `packages/mcp-gateway/src/gateway-local.integration.test.ts` — live governed-call assertions.
- `docs/mcp-gateway-contract.md` — §7.1/§9/§14 alignment.

**Build order (keeps the suite green after every commit):** (1) schemas payloads → (2) gateway-state route → (3) call-router → (4) upstream `callTool` seam → (5) tool-call-events → (6) call-handler [no barrel line] → (7) gateway-server wiring [+ call-handler barrel] → (8) boot-gateway run anchor → (9) integration test → (10) docs alignment.

**Barrel-ordering hazard (read before Task 3/5/7):** both `call-handler.ts` and the 3C `gateway-server.ts` export a symbol named `ToolCallDenial`. Exporting `call-handler.js` from the barrel while `gateway-server.ts` still exports its own `ToolCallDenial` produces `TS2308 duplicate export`. Resolution: the `call-router.js` (Task 3) and `tool-call-events.js` (Task 5) barrel lines are safe immediately; the `call-handler.js` barrel line is deferred to **Task 7**, the same commit that deletes `gateway-server.ts`'s local `ToolCallDenial`. Until then, internal files import `./call-handler.js` by relative path.

---

## Task 1: ToolCall payload schemas

**Files:**
- Create: `packages/schemas/src/tool-call-payloads.ts`
- Modify: `packages/schemas/src/run-payloads.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/tool-call-payloads.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/tool-call-payloads.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  CallDenyCode,
  ToolCallRequestedPayload,
  ToolCallCompletedPayload,
  ToolCallFailedPayload,
  ToolCallDeniedPayload,
  IncidentOpenedPayload,
} from "./tool-call-payloads.js";
import { RunCreatedPayload } from "./run-payloads.js";

const DIGEST = "a".repeat(64);

describe("tool-call payloads", () => {
  it("CallDenyCode enumerates the four deny codes", () => {
    expect(CallDenyCode.options).toEqual([
      "UNKNOWN_TOOL",
      "TOOL_FROZEN",
      "TOOL_BLOCKED",
      "DECISION_ENVELOPE_REQUIRED",
    ]);
  });

  it("ToolCallRequestedPayload requires a 64-hex argumentsDigest", () => {
    expect(() =>
      ToolCallRequestedPayload.parse({
        runId: "run_1",
        toolName: "spot_get_ticker",
        riskClass: "public_read",
        argumentsDigest: "abc",
      }),
    ).toThrow();
    expect(
      ToolCallRequestedPayload.parse({
        runId: "run_1",
        toolName: "spot_get_ticker",
        riskClass: "public_read",
        argumentsDigest: DIGEST,
      }).argumentsDigest,
    ).toBe(DIGEST);
  });

  it("ToolCallCompletedPayload is strict and digest-only", () => {
    expect(() =>
      ToolCallCompletedPayload.parse({
        runId: "run_1",
        toolName: "spot_get_ticker",
        resultDigest: DIGEST,
        isError: false,
        extra: "nope",
      }),
    ).toThrow();
  });

  it("ToolCallFailedPayload rejects an unknown reasonCode", () => {
    expect(() =>
      ToolCallFailedPayload.parse({
        runId: "run_1",
        toolName: "spot_get_ticker",
        reasonCode: "made_up",
      }),
    ).toThrow();
    expect(
      ToolCallFailedPayload.parse({
        runId: "run_1",
        toolName: "spot_get_ticker",
        reasonCode: "upstream_call_failed",
      }).reasonCode,
    ).toBe("upstream_call_failed");
  });

  it("ToolCallDeniedPayload allows riskClass to be omitted for UNKNOWN_TOOL", () => {
    const parsed = ToolCallDeniedPayload.parse({
      runId: "run_1",
      toolName: "no_such_tool",
      denyCode: "UNKNOWN_TOOL",
    });
    expect(parsed.riskClass).toBeUndefined();
    expect(
      ToolCallDeniedPayload.parse({
        runId: "run_1",
        toolName: "spot_place_order",
        denyCode: "DECISION_ENVELOPE_REQUIRED",
        riskClass: "trade_like",
      }).riskClass,
    ).toBe("trade_like");
  });

  it("IncidentOpenedPayload accepts a valid blocked-call incident", () => {
    const parsed = IncidentOpenedPayload.parse({
      incidentId: "inc_1",
      runId: "run_1",
      toolName: "withdraw",
      riskClass: "asset_movement",
      reasonCode: "blocked_tool_call_attempt",
    });
    expect(parsed.reasonCode).toBe("blocked_tool_call_attempt");
  });

  it("RunCreatedPayload requires an ISO createdAt", () => {
    expect(() =>
      RunCreatedPayload.parse({
        runId: "run_1",
        providerConnectionId: "pc_bitget",
        createdAt: "nope",
      }),
    ).toThrow();
    expect(
      RunCreatedPayload.parse({
        runId: "run_1",
        providerConnectionId: "pc_bitget",
        createdAt: "2026-06-08T00:00:00.000Z",
      }).runId,
    ).toBe("run_1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/schemas/src/tool-call-payloads.test.ts`
Expected: FAIL — cannot resolve `./tool-call-payloads.js` and `RunCreatedPayload` is not exported.

- [ ] **Step 3: Create the payload schema module**

Create `packages/schemas/src/tool-call-payloads.ts`:

```typescript
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
    argumentsDigest: z.string().length(64),
  })
  .strict();
export type ToolCallRequestedPayload = z.infer<typeof ToolCallRequestedPayload>;

export const ToolCallCompletedPayload = z
  .object({
    runId: z.string().min(1),
    toolName: z.string().min(1),
    resultDigest: z.string().length(64),
    isError: z.boolean(),
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
    riskClass: RiskClass.optional(),
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

- [ ] **Step 4: Add RunCreatedPayload to run-payloads.ts**

In `packages/schemas/src/run-payloads.ts`, add (the file already imports `IsoTimestamp` from `./scalars.js`):

```typescript
export const RunCreatedPayload = z
  .object({
    runId: z.string().min(1),
    providerConnectionId: z.string().min(1),
    createdAt: IsoTimestamp,
  })
  .strict();
export type RunCreatedPayload = z.infer<typeof RunCreatedPayload>;
```

- [ ] **Step 5: Barrel the new module**

In `packages/schemas/src/index.ts`, append:

```typescript
export * from "./tool-call-payloads.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run packages/schemas/src/tool-call-payloads.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: clean (no errors).

- [ ] **Step 8: Commit**

```bash
git add packages/schemas/src/tool-call-payloads.ts packages/schemas/src/tool-call-payloads.test.ts packages/schemas/src/run-payloads.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add ToolCall and Incident payload schemas for 3D"
```

---

## Task 2: gateway-state route table

**Files:**
- Modify: `packages/mcp-gateway/src/gateway-state.ts`
- Test: `packages/mcp-gateway/src/gateway-state.test.ts` (modify)
- Test: `packages/mcp-gateway/src/gateway-server.test.ts` (interim fixture patch)

- [ ] **Step 1: Write the failing test**

In `packages/mcp-gateway/src/gateway-state.test.ts`, update the `degradedState` assertion to include `route` and add a new route-coverage test. The existing degraded assertion becomes:

```typescript
    expect(degradedState()).toEqual({
      servedTools: [],
      route: new Map(),
      manifestHash: null,
      toolCount: 0,
      degraded: true,
    });
```

Add this new test inside the existing top-level `describe` block (the file already constructs a `view`/`buildGatewayState` result — reuse the same builder call the existing "served tools" test uses; name the built state `state`):

```typescript
  it("route classifies every tool including hidden blocked ones", () => {
    const state = buildGatewayState({
      view,
      manifestHash: bitgetManifestHashV1,
    });
    expect(state.route.size).toBe(36);
    for (const blocked of [
      "transfer",
      "withdraw",
      "cancel_withdrawal",
      "manage_subaccounts",
    ]) {
      expect(state.route.get(blocked)?.status).toBe("blocked");
      expect(state.servedTools.map((t) => t.name)).not.toContain(blocked);
    }
    expect(state.route.get("spot_get_ticker")).toEqual({
      status: "active",
      riskClass: "public_read",
    });
  });
```

> If the existing test's `buildGatewayState({ view, manifestHash })` argument shape differs, match it exactly — the only new assertions are on `state.route`. `view` and `bitgetManifestHashV1` are already imported/constructed in this test file by the existing 3C tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/mcp-gateway/src/gateway-state.test.ts`
Expected: FAIL — `route` does not exist on `GatewayState`; `degradedState()` lacks `route`.

- [ ] **Step 3: Add RouteEntry + route to gateway-state.ts**

In `packages/mcp-gateway/src/gateway-state.ts`, update the imports to add `RiskClass` (type) from schemas and `ToolStatus` (type) from event-ledger, then add `RouteEntry`, extend `GatewayState`, populate `route` in `buildGatewayState`, and add `route` to `degradedState`.

Imports (merge into existing import lines — do not duplicate):

```typescript
import type { NormalizedToolDefinition, RiskClass } from "@traceguard/schemas";
import type { ToolInventoryView, ToolStatus } from "@traceguard/event-ledger";
```

Add the interface near `ServedTool`:

```typescript
export interface RouteEntry {
  status: ToolStatus;
  riskClass: RiskClass;
}
```

Add the field to `GatewayState` (the route map is keyed by tool name and covers ALL tools, not just served ones):

```typescript
  route: Map<string, RouteEntry>;
```

In `buildGatewayState`, add `route` to the returned object (the function already receives `args.view`):

```typescript
    route: new Map(
      args.view.tools.map((t) => [t.name, { status: t.status, riskClass: t.riskClass }]),
    ),
```

In `degradedState`, add `route`:

```typescript
    route: new Map(),
```

- [ ] **Step 4: Patch the gateway-server.test.ts interim fixture**

`gateway-server.test.ts` builds a `GatewayState` object literal (`fixtureState()`) that will now miss `route`. Add `route: new Map(),` to that literal so the suite stays green. (Task 7 rewrites this file wholesale; this is a one-line interim patch.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/mcp-gateway/src/gateway-state.test.ts packages/mcp-gateway/src/gateway-server.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/mcp-gateway/src/gateway-state.ts packages/mcp-gateway/src/gateway-state.test.ts packages/mcp-gateway/src/gateway-server.test.ts
git commit -m "feat(mcp-gateway): add route table to GatewayState covering all tools"
```

---

## Task 3: Pure call-router

**Files:**
- Create: `packages/mcp-gateway/src/call-router.ts`
- Modify: `packages/mcp-gateway/src/index.ts`
- Test: `packages/mcp-gateway/src/call-router.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mcp-gateway/src/call-router.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { RiskClass } from "@traceguard/schemas";
import type { ToolStatus } from "@traceguard/event-ledger";
import type { GatewayState } from "./gateway-state.js";
import { routeCall } from "./call-router.js";

function stateWith(rows: Array<[string, ToolStatus, RiskClass]>): GatewayState {
  return {
    servedTools: [],
    route: new Map(rows.map(([name, status, riskClass]) => [name, { status, riskClass }])),
    manifestHash: null,
    toolCount: rows.length,
    degraded: false,
  };
}

describe("routeCall", () => {
  it("forwards public_read", () => {
    const out = routeCall(stateWith([["spot_get_ticker", "active", "public_read"]]), "spot_get_ticker");
    expect(out).toEqual({ kind: "forward", riskClass: "public_read" });
  });

  it("forwards account_read", () => {
    const out = routeCall(stateWith([["get_account_assets", "active", "account_read"]]), "get_account_assets");
    expect(out).toEqual({ kind: "forward", riskClass: "account_read" });
  });

  it("denies trade_like with DECISION_ENVELOPE_REQUIRED (no incident)", () => {
    const out = routeCall(stateWith([["spot_place_order", "active", "trade_like"]]), "spot_place_order");
    expect(out).toEqual({
      kind: "deny",
      code: "DECISION_ENVELOPE_REQUIRED",
      incident: false,
      riskClass: "trade_like",
    });
  });

  it("denies blocked tools with TOOL_BLOCKED and opens an incident", () => {
    const out = routeCall(stateWith([["withdraw", "blocked", "asset_movement"]]), "withdraw");
    expect(out).toEqual({
      kind: "deny",
      code: "TOOL_BLOCKED",
      incident: true,
      riskClass: "asset_movement",
    });
  });

  it("status beats risk class: a frozen public_read tool is TOOL_FROZEN", () => {
    const out = routeCall(stateWith([["spot_get_ticker", "frozen", "public_read"]]), "spot_get_ticker");
    expect(out).toEqual({
      kind: "deny",
      code: "TOOL_FROZEN",
      incident: false,
      riskClass: "public_read",
    });
  });

  it("status beats risk class: a blocked trade_like tool is TOOL_BLOCKED with incident", () => {
    const out = routeCall(stateWith([["spot_place_order", "blocked", "trade_like"]]), "spot_place_order");
    expect(out).toEqual({
      kind: "deny",
      code: "TOOL_BLOCKED",
      incident: true,
      riskClass: "trade_like",
    });
  });

  it("denies an unknown tool with UNKNOWN_TOOL and no riskClass", () => {
    const out = routeCall(stateWith([]), "no_such_tool");
    expect(out).toEqual({ kind: "deny", code: "UNKNOWN_TOOL", incident: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/mcp-gateway/src/call-router.test.ts`
Expected: FAIL — cannot resolve `./call-router.js`.

- [ ] **Step 3: Create the router**

Create `packages/mcp-gateway/src/call-router.ts`:

```typescript
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
  if (entry === undefined) {
    return { kind: "deny", code: "UNKNOWN_TOOL", incident: false };
  }
  if (entry.status === "frozen") {
    return { kind: "deny", code: "TOOL_FROZEN", incident: false, riskClass: entry.riskClass };
  }
  if (entry.status === "blocked") {
    return { kind: "deny", code: "TOOL_BLOCKED", incident: true, riskClass: entry.riskClass };
  }
  if (entry.riskClass === "public_read" || entry.riskClass === "account_read") {
    return { kind: "forward", riskClass: entry.riskClass };
  }
  return {
    kind: "deny",
    code: "DECISION_ENVELOPE_REQUIRED",
    incident: false,
    riskClass: entry.riskClass,
  };
}
```

- [ ] **Step 4: Barrel the router**

In `packages/mcp-gateway/src/index.ts`, insert between the `gateway-state` and `gateway-server` lines:

```typescript
export * from "./call-router.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/mcp-gateway/src/call-router.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/mcp-gateway/src/call-router.ts packages/mcp-gateway/src/call-router.test.ts packages/mcp-gateway/src/index.ts
git commit -m "feat(mcp-gateway): add pure routeCall classifier (status-first, then risk class)"
```

---

## Task 4: Upstream callTool seam

**Files:**
- Modify: `packages/mcp-gateway/src/upstream-client.ts`
- Modify: `packages/mcp-gateway/src/stdio-upstream-client.ts`
- Modify: `packages/mcp-gateway/src/import-manifest.test.ts`
- Modify: `packages/mcp-gateway/src/boot-gateway.test.ts`
- Test: `packages/mcp-gateway/src/upstream-client.test.ts`

> **Ripple warning:** adding `callTool` to `UpstreamManifestClient` breaks all three implementors — `StdioUpstreamClient` plus the two `FakeUpstreamClient` test doubles in `import-manifest.test.ts` and `boot-gateway.test.ts`. This task updates all three in the same commit so the suite stays green.

- [ ] **Step 1: Write the failing test (RED anchor for the new error type)**

Create `packages/mcp-gateway/src/upstream-client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { UpstreamCallError } from "./upstream-client.js";

describe("UpstreamCallError", () => {
  it("carries name, message, instanceof, and cause", () => {
    const cause = new Error("boom");
    const err = new UpstreamCallError("callTool failed", { cause });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UpstreamCallError);
    expect(err.name).toBe("UpstreamCallError");
    expect(err.message).toBe("callTool failed");
    expect(err.cause).toBe(cause);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/mcp-gateway/src/upstream-client.test.ts`
Expected: FAIL — `UpstreamCallError` is not exported.

- [ ] **Step 3: Extend the interface + add the error class**

In `packages/mcp-gateway/src/upstream-client.ts`, add the SDK type import at the top:

```typescript
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
```

Add `callTool` to the `UpstreamManifestClient` interface (alongside `open`, `listTools`, `close`):

```typescript
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
```

Add the error class alongside the existing error classes:

```typescript
export class UpstreamCallError extends Error {
  override readonly name = "UpstreamCallError";
}
```

- [ ] **Step 4: Implement callTool on StdioUpstreamClient**

In `packages/mcp-gateway/src/stdio-upstream-client.ts`:

Add to the SDK types import (the file already imports from `@modelcontextprotocol/sdk/types.js` — merge, do not duplicate):

```typescript
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
```

Add `UpstreamCallError` to the existing `./upstream-client.js` import.

Add the timeout constant near the existing `DEFAULT_*` constants:

```typescript
const DEFAULT_CALL_TIMEOUT_MS = 10_000;
```

Add the method (mirrors the existing `listTools` null-guard pattern using the private `#client`):

```typescript
  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const client = this.#client;
    if (client === null) {
      throw new UpstreamCallError("callTool called before open");
    }
    try {
      const result = await client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: DEFAULT_CALL_TIMEOUT_MS },
      );
      return result as CallToolResult;
    } catch (err) {
      throw new UpstreamCallError(messageOf(err), { cause: err });
    }
  }
```

> `Client.callTool` returns the union `CallToolResult | CompatibilityCallToolResult`; the `as CallToolResult` cast is necessary and will not trip `no-unnecessary-type-assertion`. `messageOf` already exists in this file.

- [ ] **Step 5: Add callTool stubs to both test fakes**

In **both** `packages/mcp-gateway/src/import-manifest.test.ts` and `packages/mcp-gateway/src/boot-gateway.test.ts`, the `FakeUpstreamClient implements UpstreamManifestClient` classes now miss a method. Add the SDK type import to each test file:

```typescript
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
```

And add this stub method to each `FakeUpstreamClient` (manifest-import and boot tests never exercise `callTool`):

```typescript
  async callTool(): Promise<CallToolResult> {
    throw new Error("callTool is not exercised by this test");
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run packages/mcp-gateway/src/upstream-client.test.ts packages/mcp-gateway/src/import-manifest.test.ts packages/mcp-gateway/src/boot-gateway.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: clean — all three implementors satisfy the interface.

- [ ] **Step 8: Commit**

```bash
git add packages/mcp-gateway/src/upstream-client.ts packages/mcp-gateway/src/upstream-client.test.ts packages/mcp-gateway/src/stdio-upstream-client.ts packages/mcp-gateway/src/import-manifest.test.ts packages/mcp-gateway/src/boot-gateway.test.ts
git commit -m "feat(mcp-gateway): add governed callTool seam to upstream client"
```

---

## Task 5: ToolCall ledger-event builders

**Files:**
- Create: `packages/mcp-gateway/src/tool-call-events.ts`
- Modify: `packages/mcp-gateway/src/index.ts`
- Test: `packages/mcp-gateway/src/tool-call-events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mcp-gateway/src/tool-call-events.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { canonicalJson, sha256hex } from "@traceguard/event-ledger";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fixedClock, sequentialIdGen } from "@traceguard/testing-fixtures";
import {
  recordRunCreated,
  recordToolCallRequested,
  recordToolCallCompleted,
  recordToolCallFailed,
  recordToolCallDenied,
  recordIncidentOpened,
  type CallAudit,
} from "./tool-call-events.js";

const audit: CallAudit = {
  workspaceId: "ws_demo",
  runId: "run_1",
  providerConnectionId: "pc_bitget",
};

function deps() {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

describe("tool-call event builders", () => {
  it("recordRunCreated anchors the run aggregate", () => {
    const d = deps();
    const ev = recordRunCreated(audit, d, null);
    expect(ev.eventType).toBe("RunCreated");
    expect(ev.aggregateType).toBe("run");
    expect(ev.aggregateId).toBe("run_1");
    expect(ev.actorType).toBe("agent");
    expect(ev.runId).toBe("run_1");
    expect(ev.previousEventHash).toBeUndefined();
    expect(ev.eventVersion).toBe(1);
    expect(ev.payload.createdAt).toBe("2026-06-08T00:00:00.000Z");
    expect(ev.payload.providerConnectionId).toBe("pc_bitget");
  });

  it("recordToolCallRequested digests the arguments", () => {
    const d = deps();
    const args = { symbol: "BTCUSDT" };
    const ev = recordToolCallRequested(audit, d, "h0", {
      toolName: "spot_get_ticker",
      riskClass: "public_read",
      argumentsDigest: sha256hex(canonicalJson(args)),
    });
    expect(ev.eventType).toBe("ToolCallRequested");
    expect(ev.aggregateType).toBe("run");
    expect(ev.actorType).toBe("agent");
    expect(ev.previousEventHash).toBe("h0");
    expect(ev.payload.argumentsDigest).toBe(sha256hex(canonicalJson(args)));
    expect(ev.payload.riskClass).toBe("public_read");
  });

  it("recordToolCallCompleted digests the result and defaults isError to false", () => {
    const d = deps();
    const result = { content: [{ type: "text", text: "ok" }] } as unknown as CallToolResult;
    const ev = recordToolCallCompleted(audit, d, "h1", {
      toolName: "spot_get_ticker",
      result,
    });
    expect(ev.eventType).toBe("ToolCallCompleted");
    expect(ev.payload.resultDigest).toBe(sha256hex(canonicalJson(result)));
    expect(ev.payload.isError).toBe(false);
  });

  it("recordToolCallCompleted preserves an upstream isError flag", () => {
    const d = deps();
    const result = { content: [], isError: true } as unknown as CallToolResult;
    const ev = recordToolCallCompleted(audit, d, "h1", {
      toolName: "spot_get_ticker",
      result,
    });
    expect(ev.payload.isError).toBe(true);
  });

  it("recordToolCallFailed records the upstream_call_failed reason", () => {
    const d = deps();
    const ev = recordToolCallFailed(audit, d, "h1", { toolName: "spot_get_ticker" });
    expect(ev.eventType).toBe("ToolCallFailed");
    expect(ev.payload.reasonCode).toBe("upstream_call_failed");
  });

  it("recordToolCallDenied omits riskClass when not supplied", () => {
    const d = deps();
    const ev = recordToolCallDenied(audit, d, "h0", {
      toolName: "no_such_tool",
      denyCode: "UNKNOWN_TOOL",
    });
    expect(ev.eventType).toBe("ToolCallDenied");
    expect(ev.payload.denyCode).toBe("UNKNOWN_TOOL");
    expect(ev.payload.riskClass).toBeUndefined();
  });

  it("recordToolCallDenied includes riskClass when supplied", () => {
    const d = deps();
    const ev = recordToolCallDenied(audit, d, "h0", {
      toolName: "spot_place_order",
      denyCode: "DECISION_ENVELOPE_REQUIRED",
      riskClass: "trade_like",
    });
    expect(ev.payload.riskClass).toBe("trade_like");
  });

  it("recordIncidentOpened mints an incident aggregate that still carries runId", () => {
    const d = deps();
    const ev = recordIncidentOpened(audit, d, "hDenied", {
      toolName: "withdraw",
      riskClass: "asset_movement",
    });
    expect(ev.eventType).toBe("IncidentOpened");
    expect(ev.aggregateType).toBe("incident");
    expect(ev.actorType).toBe("system");
    expect(ev.aggregateId).toMatch(/^inc_/);
    expect(ev.payload.incidentId).toBe(ev.aggregateId);
    expect(ev.runId).toBe("run_1");
    expect(ev.previousEventHash).toBe("hDenied");
    expect(ev.payload.reasonCode).toBe("blocked_tool_call_attempt");
  });

  it("chains events by previousEventHash", () => {
    const d = deps();
    const run = recordRunCreated(audit, d, null);
    const requested = recordToolCallRequested(audit, d, run.eventHash, {
      toolName: "spot_get_ticker",
      riskClass: "public_read",
      argumentsDigest: "a".repeat(64),
    });
    expect(requested.previousEventHash).toBe(run.eventHash);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/mcp-gateway/src/tool-call-events.test.ts`
Expected: FAIL — cannot resolve `./tool-call-events.js`.

- [ ] **Step 3: Create the builders**

Create `packages/mcp-gateway/src/tool-call-events.ts`:

```typescript
import { makeEvent, canonicalJson } from "@traceguard/event-ledger";
import {
  RunCreatedPayload,
  ToolCallRequestedPayload,
  ToolCallCompletedPayload,
  ToolCallFailedPayload,
  ToolCallDeniedPayload,
  IncidentOpenedPayload,
  type RiskClass,
  type LedgerEvent,
} from "@traceguard/schemas";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ReconcileDeps } from "@traceguard/tool-manifest";
import type { CallDenyCode } from "./call-router.js";

export interface CallAudit {
  workspaceId: string;
  runId: string;
  providerConnectionId: string;
}

type Deps = ReconcileDeps;

function envelope(audit: CallAudit) {
  return {
    workspaceId: audit.workspaceId,
    runId: audit.runId,
    eventVersion: 1 as const,
    schemaVersion: 1 as const,
  };
}

export function recordRunCreated(
  audit: CallAudit,
  deps: Deps,
  prev: string | null,
): LedgerEvent<RunCreatedPayload> {
  const payload = RunCreatedPayload.parse({
    runId: audit.runId,
    providerConnectionId: audit.providerConnectionId,
    createdAt: deps.clock.now(),
  });
  return makeEvent(
    {
      ...envelope(audit),
      eventType: "RunCreated",
      aggregateType: "run",
      aggregateId: audit.runId,
      actorType: "agent",
      previousEventHash: prev,
      payload,
    },
    deps,
  );
}

export function recordToolCallRequested(
  audit: CallAudit,
  deps: Deps,
  prev: string | null,
  input: { toolName: string; riskClass: RiskClass; argumentsDigest: string },
): LedgerEvent<ToolCallRequestedPayload> {
  const payload = ToolCallRequestedPayload.parse({
    runId: audit.runId,
    toolName: input.toolName,
    riskClass: input.riskClass,
    argumentsDigest: input.argumentsDigest,
  });
  return makeEvent(
    {
      ...envelope(audit),
      eventType: "ToolCallRequested",
      aggregateType: "run",
      aggregateId: audit.runId,
      actorType: "agent",
      previousEventHash: prev,
      payload,
    },
    deps,
  );
}

export function recordToolCallCompleted(
  audit: CallAudit,
  deps: Deps,
  prev: string | null,
  input: { toolName: string; result: CallToolResult },
): LedgerEvent<ToolCallCompletedPayload> {
  const payload = ToolCallCompletedPayload.parse({
    runId: audit.runId,
    toolName: input.toolName,
    resultDigest: deps.hash(canonicalJson(input.result)),
    isError: input.result.isError ?? false,
  });
  return makeEvent(
    {
      ...envelope(audit),
      eventType: "ToolCallCompleted",
      aggregateType: "run",
      aggregateId: audit.runId,
      actorType: "agent",
      previousEventHash: prev,
      payload,
    },
    deps,
  );
}

export function recordToolCallFailed(
  audit: CallAudit,
  deps: Deps,
  prev: string | null,
  input: { toolName: string },
): LedgerEvent<ToolCallFailedPayload> {
  const payload = ToolCallFailedPayload.parse({
    runId: audit.runId,
    toolName: input.toolName,
    reasonCode: "upstream_call_failed",
  });
  return makeEvent(
    {
      ...envelope(audit),
      eventType: "ToolCallFailed",
      aggregateType: "run",
      aggregateId: audit.runId,
      actorType: "agent",
      previousEventHash: prev,
      payload,
    },
    deps,
  );
}

export function recordToolCallDenied(
  audit: CallAudit,
  deps: Deps,
  prev: string | null,
  input: { toolName: string; denyCode: CallDenyCode; riskClass?: RiskClass },
): LedgerEvent<ToolCallDeniedPayload> {
  const payload = ToolCallDeniedPayload.parse({
    runId: audit.runId,
    toolName: input.toolName,
    denyCode: input.denyCode,
    ...(input.riskClass !== undefined ? { riskClass: input.riskClass } : {}),
  });
  return makeEvent(
    {
      ...envelope(audit),
      eventType: "ToolCallDenied",
      aggregateType: "run",
      aggregateId: audit.runId,
      actorType: "agent",
      previousEventHash: prev,
      payload,
    },
    deps,
  );
}

export function recordIncidentOpened(
  audit: CallAudit,
  deps: Deps,
  prev: string | null,
  input: { toolName: string; riskClass: RiskClass },
): LedgerEvent<IncidentOpenedPayload> {
  const incidentId = deps.newId.next("inc");
  const payload = IncidentOpenedPayload.parse({
    incidentId,
    runId: audit.runId,
    toolName: input.toolName,
    riskClass: input.riskClass,
    reasonCode: "blocked_tool_call_attempt",
  });
  return makeEvent(
    {
      ...envelope(audit),
      eventType: "IncidentOpened",
      aggregateType: "incident",
      aggregateId: incidentId,
      actorType: "system",
      previousEventHash: prev,
      payload,
    },
    deps,
  );
}
```

> If `makeEvent`'s generic return type does not infer as written, fall back to the exact return-type annotation style used by the existing builders in `packages/event-ledger/src/` (e.g. `propose-decision.ts`). The envelope fields (`workspaceId`, `runId`, `eventVersion`, `schemaVersion`) and the `makeEvent(args, deps)` two-arg shape match those builders; `deps.clock.now()` returns the ISO string `IsoTimestamp` expects.

- [ ] **Step 4: Barrel the builders**

In `packages/mcp-gateway/src/index.ts`, insert between the `call-router` line and the `gateway-server` line:

```typescript
export * from "./tool-call-events.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/mcp-gateway/src/tool-call-events.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/mcp-gateway/src/tool-call-events.ts packages/mcp-gateway/src/tool-call-events.test.ts packages/mcp-gateway/src/index.ts
git commit -m "feat(mcp-gateway): add digest-only ToolCall and Incident event builders"
```

---

## Task 6: Imperative call-handler

**Files:**
- Create: `packages/mcp-gateway/src/call-handler.ts` (NO barrel line yet — see hazard note)
- Test: `packages/mcp-gateway/src/call-handler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mcp-gateway/src/call-handler.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { InMemoryLedgerStore, sha256hex } from "@traceguard/event-ledger";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { LedgerEvent, RiskClass } from "@traceguard/schemas";
import type { ToolStatus } from "@traceguard/event-ledger";
import { fixedClock, sequentialIdGen } from "@traceguard/testing-fixtures";
import type { GatewayState } from "./gateway-state.js";
import type { UpstreamManifestClient } from "./upstream-client.js";
import { recordRunCreated, type CallAudit } from "./tool-call-events.js";
import { handleToolCall, type GatewayCallContext } from "./call-handler.js";

const AUDIT: CallAudit = {
  workspaceId: "ws_demo",
  runId: "run_1",
  providerConnectionId: "pc_bitget",
};

type Script = { kind: "result"; result: CallToolResult } | { kind: "throw" };

class FakeUpstreamClient implements UpstreamManifestClient {
  callToolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  constructor(private readonly script: Script) {}
  async open(): Promise<void> {}
  async listTools(): Promise<never> {
    throw new Error("listTools not used here");
  }
  async close(): Promise<void> {}
  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    this.callToolCalls.push({ name, args });
    if (this.script.kind === "throw") throw new Error("upstream exploded");
    return this.script.result;
  }
}

function deps() {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

function stateWith(rows: Array<[string, ToolStatus, RiskClass]>): GatewayState {
  return {
    servedTools: [],
    route: new Map(rows.map(([name, status, riskClass]) => [name, { status, riskClass }])),
    manifestHash: null,
    toolCount: rows.length,
    degraded: false,
  };
}

async function seededCtx(
  client: UpstreamManifestClient,
  d: ReturnType<typeof deps>,
): Promise<{ ctx: GatewayCallContext; store: InMemoryLedgerStore }> {
  const store = new InMemoryLedgerStore();
  const run = recordRunCreated(AUDIT, d, null);
  await store.append(null, [run]);
  return { ctx: { client, store, deps: d, audit: AUDIT }, store };
}

function types(events: ReadonlyArray<LedgerEvent<unknown>>): string[] {
  return events.map((e) => e.eventType);
}

function tg(res: CallToolResult): { errorCode: string; toolName: string } {
  return (res as unknown as { traceguard: { errorCode: string; toolName: string } }).traceguard;
}

describe("handleToolCall", () => {
  it("forwards a public_read call and records Requested + Completed", async () => {
    const d = deps();
    const result = { content: [{ type: "text", text: "ok" }] } as unknown as CallToolResult;
    const client = new FakeUpstreamClient({ kind: "result", result });
    const { ctx, store } = await seededCtx(client, d);
    const state = stateWith([["spot_get_ticker", "active", "public_read"]]);

    const res = await handleToolCall(state, ctx, "spot_get_ticker", { symbol: "BTCUSDT" });

    expect((res as unknown as { isError?: boolean }).isError).toBeFalsy();
    expect(client.callToolCalls).toEqual([{ name: "spot_get_ticker", args: { symbol: "BTCUSDT" } }]);
    const events = await store.read(AUDIT.workspaceId);
    expect(types(events)).toEqual(["RunCreated", "ToolCallRequested", "ToolCallCompleted"]);
  });

  it("denies a trade_like call with DECISION_ENVELOPE_REQUIRED and does not forward", async () => {
    const d = deps();
    const client = new FakeUpstreamClient({ kind: "throw" });
    const { ctx, store } = await seededCtx(client, d);
    const state = stateWith([["spot_place_order", "active", "trade_like"]]);

    const res = await handleToolCall(state, ctx, "spot_place_order", {});

    expect(tg(res).errorCode).toBe("DECISION_ENVELOPE_REQUIRED");
    expect(client.callToolCalls).toEqual([]);
    const events = await store.read(AUDIT.workspaceId);
    expect(types(events)).toEqual(["RunCreated", "ToolCallDenied"]);
  });

  it("denies a blocked call with TOOL_BLOCKED and opens an incident", async () => {
    const d = deps();
    const client = new FakeUpstreamClient({ kind: "throw" });
    const { ctx, store } = await seededCtx(client, d);
    const state = stateWith([["withdraw", "blocked", "asset_movement"]]);

    const res = await handleToolCall(state, ctx, "withdraw", {});

    expect(tg(res).errorCode).toBe("TOOL_BLOCKED");
    const events = await store.read(AUDIT.workspaceId);
    expect(types(events)).toEqual(["RunCreated", "ToolCallDenied", "IncidentOpened"]);
    expect(events[2]!.aggregateType).toBe("incident");
  });

  it("denies a frozen call with TOOL_FROZEN", async () => {
    const d = deps();
    const client = new FakeUpstreamClient({ kind: "throw" });
    const { ctx, store } = await seededCtx(client, d);
    const state = stateWith([["spot_get_ticker", "frozen", "public_read"]]);

    const res = await handleToolCall(state, ctx, "spot_get_ticker", {});

    expect(tg(res).errorCode).toBe("TOOL_FROZEN");
    const events = await store.read(AUDIT.workspaceId);
    expect(types(events)).toEqual(["RunCreated", "ToolCallDenied"]);
  });

  it("denies an unknown call with UNKNOWN_TOOL", async () => {
    const d = deps();
    const client = new FakeUpstreamClient({ kind: "throw" });
    const { ctx, store } = await seededCtx(client, d);
    const state = stateWith([]);

    const res = await handleToolCall(state, ctx, "no_such_tool", {});

    expect(tg(res).errorCode).toBe("UNKNOWN_TOOL");
    const events = await store.read(AUDIT.workspaceId);
    expect(types(events)).toEqual(["RunCreated", "ToolCallDenied"]);
  });

  it("fails closed when the upstream call throws: Requested + Failed, UPSTREAM_CALL_FAILED", async () => {
    const d = deps();
    const client = new FakeUpstreamClient({ kind: "throw" });
    const { ctx, store } = await seededCtx(client, d);
    const state = stateWith([["spot_get_ticker", "active", "public_read"]]);

    const res = await handleToolCall(state, ctx, "spot_get_ticker", {});

    expect(tg(res).errorCode).toBe("UPSTREAM_CALL_FAILED");
    const events = await store.read(AUDIT.workspaceId);
    expect(types(events)).toEqual(["RunCreated", "ToolCallRequested", "ToolCallFailed"]);
  });

  it("returns TOOL_CALL_NOT_AVAILABLE and records nothing when no call context is wired", async () => {
    const d = deps();
    const client = new FakeUpstreamClient({ kind: "throw" });
    const { store } = await seededCtx(client, d);
    const state = stateWith([["spot_get_ticker", "active", "public_read"]]);

    const res = await handleToolCall(state, undefined, "spot_get_ticker", {});

    expect(tg(res).errorCode).toBe("TOOL_CALL_NOT_AVAILABLE");
    const events = await store.read(AUDIT.workspaceId);
    expect(types(events)).toEqual(["RunCreated"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/mcp-gateway/src/call-handler.test.ts`
Expected: FAIL — cannot resolve `./call-handler.js`.

- [ ] **Step 3: Create the handler**

Create `packages/mcp-gateway/src/call-handler.ts`:

```typescript
import { canonicalJson, type LedgerStore } from "@traceguard/event-ledger";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ReconcileDeps } from "@traceguard/tool-manifest";
import type { UpstreamManifestClient } from "./upstream-client.js";
import type { GatewayState } from "./gateway-state.js";
import { routeCall, type CallDenyCode } from "./call-router.js";
import {
  recordToolCallRequested,
  recordToolCallCompleted,
  recordToolCallFailed,
  recordToolCallDenied,
  recordIncidentOpened,
  type CallAudit,
} from "./tool-call-events.js";

export interface GatewayCallContext {
  client: UpstreamManifestClient;
  store: LedgerStore;
  deps: ReconcileDeps;
  audit: CallAudit;
}

export type CallErrorCode = CallDenyCode | "TOOL_CALL_NOT_AVAILABLE" | "UPSTREAM_CALL_FAILED";

export interface ToolCallDenial {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  traceguard: { errorCode: CallErrorCode; toolName: string };
}

const DENY_TEXT: Record<CallErrorCode, string> = {
  UNKNOWN_TOOL: "This tool is not part of the governed manifest.",
  TOOL_FROZEN: "This tool is frozen by policy and cannot be called.",
  TOOL_BLOCKED: "This tool is blocked by policy; a security incident has been recorded.",
  DECISION_ENVELOPE_REQUIRED:
    "This action requires an approved Decision Envelope before it can execute.",
  TOOL_CALL_NOT_AVAILABLE: "Tool execution is not available because the gateway booted degraded.",
  UPSTREAM_CALL_FAILED: "The upstream provider call failed; the request was not completed.",
};

export function denyCall(
  code: CallErrorCode,
  toolName: string,
  message?: string,
): CallToolResult {
  const denial: ToolCallDenial = {
    isError: true,
    content: [{ type: "text", text: message ?? DENY_TEXT[code] }],
    traceguard: { errorCode: code, toolName },
  };
  return denial as unknown as CallToolResult;
}

export async function handleToolCall(
  state: GatewayState,
  ctx: GatewayCallContext | undefined,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  if (ctx === undefined) {
    return denyCall("TOOL_CALL_NOT_AVAILABLE", name);
  }

  const outcome = routeCall(state, name);

  if (outcome.kind === "deny") {
    const deniedHead = await ctx.store.head(ctx.audit.workspaceId);
    const denied = recordToolCallDenied(ctx.audit, ctx.deps, deniedHead, {
      toolName: name,
      denyCode: outcome.code,
      ...(outcome.riskClass !== undefined ? { riskClass: outcome.riskClass } : {}),
    });
    await ctx.store.append(deniedHead, [denied]);

    if (outcome.incident && outcome.riskClass !== undefined) {
      const incident = recordIncidentOpened(ctx.audit, ctx.deps, denied.eventHash, {
        toolName: name,
        riskClass: outcome.riskClass,
      });
      await ctx.store.append(denied.eventHash, [incident]);
    }
    return denyCall(outcome.code, name);
  }

  const argumentsDigest = ctx.deps.hash(canonicalJson(args));
  const requestedHead = await ctx.store.head(ctx.audit.workspaceId);
  const requested = recordToolCallRequested(ctx.audit, ctx.deps, requestedHead, {
    toolName: name,
    riskClass: outcome.riskClass,
    argumentsDigest,
  });
  await ctx.store.append(requestedHead, [requested]);

  try {
    const result = await ctx.client.callTool(name, args);
    const completed = recordToolCallCompleted(ctx.audit, ctx.deps, requested.eventHash, {
      toolName: name,
      result,
    });
    await ctx.store.append(requested.eventHash, [completed]);
    return result;
  } catch {
    const failed = recordToolCallFailed(ctx.audit, ctx.deps, requested.eventHash, {
      toolName: name,
    });
    await ctx.store.append(requested.eventHash, [failed]);
    return denyCall("UPSTREAM_CALL_FAILED", name);
  }
}
```

> Do NOT add a `call-handler.js` line to `index.ts` in this task — `gateway-server.ts` still exports its own `ToolCallDenial` until Task 7, and barrelling both now causes `TS2308`. Internal importers use the relative path `./call-handler.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/mcp-gateway/src/call-handler.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-gateway/src/call-handler.ts packages/mcp-gateway/src/call-handler.test.ts
git commit -m "feat(mcp-gateway): add governed handleToolCall shell with fail-closed denials"
```

---

## Task 7: Wire call-handler into gateway-server

**Files:**
- Modify: `packages/mcp-gateway/src/gateway-server.ts`
- Modify: `packages/mcp-gateway/src/index.ts`
- Test: `packages/mcp-gateway/src/gateway-server.test.ts` (rewrite)

- [ ] **Step 1: Rewrite gateway-server.test.ts**

Replace `packages/mcp-gateway/src/gateway-server.test.ts` wholesale:

```typescript
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  InMemoryLedgerStore,
  sha256hex,
} from "@traceguard/event-ledger";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fixedClock, sequentialIdGen } from "@traceguard/testing-fixtures";
import type { GatewayState, RouteEntry } from "./gateway-state.js";
import type { UpstreamManifestClient } from "./upstream-client.js";
import { recordRunCreated, type CallAudit } from "./tool-call-events.js";
import { createGatewayServer, type GatewayCallContext } from "./gateway-server.js";

const AUDIT: CallAudit = {
  workspaceId: "ws_demo",
  runId: "run_1",
  providerConnectionId: "pc_bitget",
};

class FakeUpstreamClient implements UpstreamManifestClient {
  async open(): Promise<void> {}
  async listTools(): Promise<never> {
    throw new Error("listTools not used here");
  }
  async close(): Promise<void> {}
  async callTool(): Promise<CallToolResult> {
    return { content: [{ type: "text", text: "upstream-ok" }] } as unknown as CallToolResult;
  }
}

function deps() {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

function fixtureState(): GatewayState {
  const route = new Map<string, RouteEntry>([
    ["spot_get_ticker", { status: "active", riskClass: "public_read" }],
    ["spot_place_order", { status: "active", riskClass: "trade_like" }],
  ]);
  return {
    servedTools: [
      { name: "spot_get_ticker", description: "ticker", inputSchema: { type: "object" } },
    ],
    route,
    manifestHash: "f".repeat(64),
    toolCount: 2,
    degraded: false,
  };
}

async function makeCtx(d: ReturnType<typeof deps>): Promise<GatewayCallContext> {
  const store = new InMemoryLedgerStore();
  const run = recordRunCreated(AUDIT, d, null);
  await store.append(null, [run]);
  return { client: new FakeUpstreamClient(), store, deps: d, audit: AUDIT };
}

async function connectedClient(
  state: GatewayState,
  callCtx?: GatewayCallContext,
): Promise<Client> {
  const server = createGatewayServer(state, callCtx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function tg(res: unknown): { errorCode: string; toolName: string } {
  return (res as { traceguard: { errorCode: string; toolName: string } }).traceguard;
}

describe("createGatewayServer governed tools/call", () => {
  it("lists only served tools", async () => {
    const client = await connectedClient(fixtureState(), await makeCtx(deps()));
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).toEqual(["spot_get_ticker"]);
    await client.close();
  });

  it("forwards a public_read call to the upstream", async () => {
    const client = await connectedClient(fixtureState(), await makeCtx(deps()));
    const res = await client.callTool({ name: "spot_get_ticker", arguments: { symbol: "BTCUSDT" } });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    await client.close();
  });

  it("denies a trade_like call with DECISION_ENVELOPE_REQUIRED", async () => {
    const client = await connectedClient(fixtureState(), await makeCtx(deps()));
    const res = await client.callTool({ name: "spot_place_order", arguments: {} });
    expect(tg(res).errorCode).toBe("DECISION_ENVELOPE_REQUIRED");
    await client.close();
  });

  it("returns TOOL_CALL_NOT_AVAILABLE when no call context is wired", async () => {
    const client = await connectedClient(fixtureState(), undefined);
    const res = await client.callTool({ name: "spot_get_ticker", arguments: {} });
    expect(tg(res).errorCode).toBe("TOOL_CALL_NOT_AVAILABLE");
    await client.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/mcp-gateway/src/gateway-server.test.ts`
Expected: FAIL — `createGatewayServer` does not yet accept `callCtx` / does not export `GatewayCallContext`.

- [ ] **Step 3: Rewrite gateway-server.ts**

Replace `packages/mcp-gateway/src/gateway-server.ts`. Remove the local `denyToolCall` / `ToolCallDenial` (now owned by `call-handler.ts`) and the now-unused `CallToolResult` import if it is only used by the stub. Wire `handleToolCall`:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { GatewayState } from "./gateway-state.js";
import { handleToolCall, type GatewayCallContext } from "./call-handler.js";

export type { GatewayCallContext } from "./call-handler.js";

export function createGatewayServer(
  state: GatewayState,
  callCtx?: GatewayCallContext,
): Server {
  const server = new Server(
    { name: "traceguard-gateway", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: state.servedTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    handleToolCall(state, callCtx, req.params.name, req.params.arguments ?? {}),
  );

  return server;
}
```

> Match the exact `Server` constructor metadata and `servedTools` field names (`description`, `inputSchema`) used by the existing 3C `gateway-server.ts`. The only behavioural change is the `CallTool` handler now delegating to `handleToolCall` and the new optional `callCtx` parameter. If 3C's `ServedTool` shape differs, keep its mapping verbatim and only swap the handler body.

- [ ] **Step 4: Add the deferred call-handler barrel line**

In `packages/mcp-gateway/src/index.ts`, insert between the `gateway-server` line and the `boot-gateway` line:

```typescript
export * from "./call-handler.js";
```

> This is now safe: `gateway-server.ts` no longer exports `ToolCallDenial`, so the duplicate-export conflict is gone. `gateway-server.ts` re-exports `GatewayCallContext` as a type-only re-export, and `call-handler.js` exports the value/interface — `export *` de-duplicates a type re-export against its origin, but if `tsc` reports a conflict on `GatewayCallContext`, drop the `export type { GatewayCallContext }` line from `gateway-server.ts` (the barrel already surfaces it via `call-handler.js`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/mcp-gateway/src/gateway-server.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/mcp-gateway/src/gateway-server.ts packages/mcp-gateway/src/gateway-server.test.ts packages/mcp-gateway/src/index.ts
git commit -m "feat(mcp-gateway): wire governed handleToolCall into the downstream server"
```

---

## Task 8: boot-gateway RunCreated anchor + call context

**Files:**
- Modify: `packages/mcp-gateway/src/boot-gateway.ts`
- Test: `packages/mcp-gateway/src/boot-gateway.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/mcp-gateway/src/boot-gateway.test.ts`, update the happy-path test and the degraded tests. The happy path currently asserts the ledger holds 5 events; it now holds 6 (the `RunCreated` anchor appended last). Find the happy-path assertion block and replace it with:

```typescript
    expect(events).toHaveLength(6);
    expect(handle.runId).toMatch(/^run_/);
    const runEvent = events[5]!;
    expect(runEvent.eventType).toBe("RunCreated");
    expect(runEvent.aggregateType).toBe("run");
    expect(runEvent.previousEventHash).toBe(events[4]!.eventHash);
```

In each of the two degraded-boot tests, add:

```typescript
    expect(handle.runId).toBeUndefined();
```

> The existing happy-path test already reads `events` via `store.read(...)` and holds the `handle`. Keep its setup; only the count and the new `runId`/`RunCreated` assertions change. If the existing test named the read result differently, reuse that name.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/mcp-gateway/src/boot-gateway.test.ts`
Expected: FAIL — ledger has 5 events not 6; `handle.runId` is undefined on the happy path.

- [ ] **Step 3: Update boot-gateway.ts**

In `packages/mcp-gateway/src/boot-gateway.ts`:

Add imports:

```typescript
import { recordRunCreated, type CallAudit } from "./tool-call-events.js";
import type { GatewayCallContext } from "./call-handler.js";
```

Add `runId` to the `GatewayHandle` interface (optional — absent on degraded boot):

```typescript
  runId?: string;
```

The degraded branch (inside `catch`) returns a handle with **no** `runId` and **no** call context — it builds the server with `createGatewayServer(degraded)` (one argument). Keep that branch as-is aside from confirming it does not pass a `runId`.

After the try/catch (the happy path, where `state` is the successfully built non-degraded state and `client` is open), replace the existing `createGatewayServer(state)` / return with:

```typescript
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
  const server = createGatewayServer(state, callCtx);
  return { state, server, client, runId };
```

> `args.providerConnectionId` is already a field on the boot args (3C uses it for the manifest import). `store.head(args.workspaceId)` returns the current chain head after the 5 manifest-import events, so the `RunCreated` anchor chains onto event index 4. The degraded branch must return BEFORE this block (it already does in 3C, via `return` inside `catch`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/mcp-gateway/src/boot-gateway.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Run the full mcp-gateway suite**

Run: `pnpm vitest run packages/mcp-gateway`
Expected: PASS (all gateway tests green; integration test still `skipIf`-skipped).

- [ ] **Step 7: Commit**

```bash
git add packages/mcp-gateway/src/boot-gateway.ts packages/mcp-gateway/src/boot-gateway.test.ts
git commit -m "feat(mcp-gateway): mint RunCreated anchor and wire call context at boot"
```

---

## Task 9: Live integration governed-call assertions

**Files:**
- Modify: `packages/mcp-gateway/src/gateway-local.integration.test.ts`

> This test is gated by `describe.skipIf(!live)`; the default suite run skips it. We verify via typecheck + a skipped run (no RED/GREEN cycle). Live verification against `bitget-mcp-server --paper-trading` is run manually by setting `TRACEGUARD_LIVE_MCP=1`.

- [ ] **Step 1: Extend the live test**

In `packages/mcp-gateway/src/gateway-local.integration.test.ts`, add two imports at the top:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
```

Inside the existing `try` block, AFTER the current `handle.state` assertions and BEFORE the `finally`, add an in-process downstream client that drives a governed read and a governed deny over `handle.server`:

```typescript
        const [agentTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await handle.server.connect(serverTransport);
        const agent = new Client({ name: "live-test-agent", version: "0.0.0" });
        await agent.connect(agentTransport);
        try {
          const ok = await agent.callTool({
            name: "spot_get_ticker",
            arguments: { symbol: "BTCUSDT" },
          });
          expect((ok as { isError?: boolean }).isError).toBeFalsy();

          const denied = await agent.callTool({
            name: "spot_place_order",
            arguments: {},
          });
          expect(
            (denied as { traceguard?: { errorCode?: string } }).traceguard?.errorCode,
          ).toBe("DECISION_ENVELOPE_REQUIRED");
        } finally {
          await agent.close();
        }
```

> `spot_get_ticker` is a `public_read` tool that forwards to the real paper-trading server and returns a non-error result. `spot_place_order` is `trade_like` and must be denied with `DECISION_ENVELOPE_REQUIRED` without ever reaching the upstream. The existing outer `finally { await handle.client.close(); }` stays.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Run the suite (test stays skipped by default)**

Run: `pnpm vitest run packages/mcp-gateway/src/gateway-local.integration.test.ts`
Expected: the `describe.skipIf(!live)` block is skipped (0 failures, suite reports the test as skipped). No RED/GREEN — this is a live-gated test.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-gateway/src/gateway-local.integration.test.ts
git commit -m "test(mcp-gateway): assert governed forward + deny in the live integration test"
```

---

## Task 10: Documentation alignment

**Files:**
- Modify: `docs/mcp-gateway-contract.md`

> Doc-only commit. Read the contract first to locate the exact §7.1, §9, and §14 anchors before editing.

- [ ] **Step 1: Read the contract sections**

Read `docs/mcp-gateway-contract.md` and locate: the §14 error-code table, the §9 governed-call lifecycle note, and the §7.1 connection-reuse blockquote.

- [ ] **Step 2: Add the UPSTREAM_CALL_FAILED error-code row (§14)**

In the §14 error-code table, add a new row:

```markdown
| `UPSTREAM_CALL_FAILED` | Upstream `tools/call` threw after a governed forward; fail-closed, the long-lived connection is retained. |
```

- [ ] **Step 3: Revise the TOOL_CALL_NOT_AVAILABLE row (§14)**

Find the existing `TOOL_CALL_NOT_AVAILABLE` row (3C described it as "Gateway build does not yet route tool execution (pre-3D); fail-closed deny"). Replace its description with:

```markdown
| `TOOL_CALL_NOT_AVAILABLE` | The gateway booted degraded (no governed call context / no active run); every `tools/call` is denied fail-closed. |
```

- [ ] **Step 4: Note the 3D-implemented governance subset (§9)**

In §9, add a note clarifying what 3D implements versus what is deferred to 3E:

```markdown
> **3D status:** Existence + risk-class routing, governed read-class forwarding over the reused upstream connection, and digest-only `ToolCall*` / `IncidentOpened` audit events are live. Argument JSON-Schema validation, Decision Envelope construction, policy evaluation, approval, execution, and result redaction remain deferred to 3E.
```

- [ ] **Step 5: Confirm connection reuse in §7.1**

In the §7.1 blockquote about the long-lived upstream connection, append a half-sentence confirming 3D routes `tools/call` over that same reused connection rather than reconnecting per call:

```markdown
> As of 3D, governed `tools/call` requests are forwarded over this same long-lived connection — the gateway never reconnects per call.
```

- [ ] **Step 6: Commit**

```bash
git add docs/mcp-gateway-contract.md
git commit -m "docs(mcp-gateway): align contract with 3D governed call routing"
```

---

## Final Verification

- [ ] **Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: clean across all packages.

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: all tests pass; the live integration block is skipped (no `TRACEGUARD_LIVE_MCP`).

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: clean build.

- [ ] **Step 4 (optional, manual live verification):**

With Bitget demo credentials exported, run:

```bash
TRACEGUARD_LIVE_MCP=1 pnpm vitest run packages/mcp-gateway/src/gateway-local.integration.test.ts
```

Expected: boots a governed gateway against the real `bitget-mcp-server --paper-trading`, forwards `spot_get_ticker`, and denies `spot_place_order` with `DECISION_ENVELOPE_REQUIRED`.

---

## Self-Review Notes

**Spec coverage (§1–§12):**
- §1.3 locked behaviours D1–D5 → Task 3 (routeCall truth table), Task 6 (handler dispatch), Task 8 (degraded → TOOL_CALL_NOT_AVAILABLE).
- §1.4 additive-schemas disclosure → Task 1 (new payloads, no breaking changes to existing schemas).
- §2.1 module map → Tasks 3/5/6/7 create call-router, tool-call-events, call-handler, wire gateway-server.
- §2.3 route-carries-all-tools → Task 2 (`route` from `view.tools`, not `servedTools`).
- §3.1 startup steps → Task 8 (RunCreated anchor after manifest import).
- §3.2 serve-time flow → Task 6 (Requested → forward → Completed/Failed ordering).
- §4.1–§4.8 public types → Tasks 1 (payloads), 3 (RouteOutcome), 2 (RouteEntry/GatewayState), 4 (callTool/UpstreamCallError), 5 (builders), 6 (GatewayCallContext/ToolCallDenial/handleToolCall), 7 (createGatewayServer), 8 (boot).
- §5 downstream behaviour table → Task 6 tests (one per row) + Task 7 server-level tests.
- §6 persistence (digest-only) → Task 5 (`deps.hash(canonicalJson(x))`), Task 1 (`.length(64)` digests, `.strict()`).
- §7 fail-closed → Task 6 (upstream throw → Failed + UPSTREAM_CALL_FAILED), Task 8 (degraded).
- §8 testing 8.1–8.7 → Task 3 (8.1 router), Task 5 (8.2 builders), Task 6 (8.3 handler), Task 7 (8.4 server), Task 8 (8.5 boot), Task 9 (8.6 live), Task 1 (8.7 schemas).
- §9 file inventory → all create/modify targets covered in File Structure.
- §10 doc alignment (4 edits) → Task 10.
- §11 acceptance → Final Verification.
- §12 3E handoff → documented as deferred in Task 10 §9 note.

**Placeholder scan:** No "TBD"/"TODO"/"add appropriate X"; every code step has complete code. The few `>`-prefixed notes are disambiguation guidance for matching existing 3C field names, not deferred work.

**Type consistency:** `routeCall` returns `RouteOutcome` (Task 3) consumed by `handleToolCall` (Task 6); `CallDenyCode` (Task 3 TS union) ⟷ `CallDenyCode` (Task 1 zod enum) carry identical members; `CallAudit` (Task 5) consumed by Tasks 6/7/8; `GatewayCallContext` (Task 6) re-exported by Task 7 and consumed by Task 8; `RouteEntry`/`route: Map` (Task 2) consumed by Tasks 3/6/7; `callTool(name, args): Promise<CallToolResult>` signature identical across interface (Task 4), Stdio impl (Task 4), and all fakes (Tasks 4/6/7); `recordRunCreated(audit, deps, prev)` 3-arg shape identical in Tasks 5/6/7/8.
