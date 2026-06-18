# TraceGuard Phase 3E-2b — Argument Validation + Result Redaction (Design)

**Status:** Approved for planning (2026-06-18)
**Increment:** 3E-2b (second of the 3E-2 engine-hardening decomposition: 3E-2a durable persistence → **3E-2b arg validation + result redaction** → 3E-2c live execution adapter)
**Supersedes:** the §3 sketch in `2026-06-17-traceguard-phase3-local-mcp-gateway-3e2-engine-hardening-design.md`

**Goal:** On the governed forward path, validate tool-call arguments against the approved upstream JSON Schema before the upstream call (rejecting malformed args with a new `ARGUMENTS_INVALID` deny code), and redact credential-class secrets from the result before it is returned to the agent — without weakening ledger audit fidelity.

**Architecture:** Two pure modules (`arg-validation.ts`, `result-redaction.ts`) injected into the existing `handleToolCall` forward path at two seams. Governance routing (`routeCall`) and the hash-chain ledger semantics are unchanged except for one added deny-code value. Functional-core/imperative-shell: both modules are pure and independently unit-tested; the imperative shell (`boot-gateway.ts`) constructs the argument validator once per boot and threads it through the call context.

**Tech stack:** TypeScript strict (ESM, `.js` import specifiers), vitest 4, new runtime dependency `ajv@^8.17` (gateway package only).

---

## 1. Background & Fit

`handleToolCall` (`packages/mcp-gateway/src/call-handler.ts`) is the `tools/call` entry. Today it: denies when no call context (degraded boot); routes via `routeCall`; on a governance deny records `ToolCallDenied` (+ `IncidentOpened` for blocked high-risk) and returns a denial; on forward computes `argumentsDigest`, records `ToolCallRequested`, calls upstream, records `ToolCallCompleted` (digest of the raw result), and returns the raw result.

Only `public_read` and `account_read` reach the forward branch (`routeCall`). The contract (`docs/mcp-gateway-contract.md`) §9.1 pipeline places "Validate arguments against approved schema" **before** `ToolCallRequested`, and §9.2/§9.3/§20 require response sanitization/redaction — all explicitly deferred to 3E-2 until now.

This increment lands the argument-validation seam and the agent-facing credential-redaction seam. The richer "public demo export" redaction (account identifiers + raw balances, §20) is **out of scope** — no export surface exists yet (greenfield); the redactor is built profile-parameterized so that profile can drop in later.

## 2. Settled Decisions (brainstorming 2026-06-18)

1. **Scope:** validation + redaction land together in 3E-2b.
2. **Validation strictness — pragmatic:** validate `required`, `type`, `enum`, and other ajv-core structural keywords (`pattern`, `minimum`/`maximum`, `minLength`, …); **tolerate additional properties** (do not synthesize `additionalProperties:false`); **no type coercion**. Arguments are never mutated, so `argumentsDigest` stays faithful to what the agent sent. (`format` keyword is **not** enforced — that would require `ajv-formats`; see §8.)
3. **Reject seam:** on validation failure, return a structured `ARGUMENTS_INVALID` error to the agent and record one `ToolCallDenied` event with `denyCode: "ARGUMENTS_INVALID"`. **No incident** (malformed args are agent error, not an attack). Validation runs before `ToolCallRequested`, so a rejected call records only the `ToolCallDenied` — symmetric with the existing `routeCall` deny path.
4. **Redaction scope:** agent-facing credential redaction only. Keep balances/positions (the agent needs them to decide). The redactor is a pure, profile-parameterized transform; the public-export profile is deferred.
5. **Sensitive-key set — narrow, high-signal:** key-name match, recursive, with key normalization (lowercase + strip `_`/`-`). Set = `apikey, secretkey, passphrase, authorization, privatekey, credential, credentialref`. Deliberately excludes ambiguous trading-domain words (`token` often means a coin symbol; `secret`/`sign` collide with order fields). Matched values are replaced with the placeholder `"[REDACTED]"` (field presence preserved for auditability).

## 3. Two load-bearing engineering judgments (approved)

- **(a) Ledger digest over the raw result; redaction only rewrites the agent-facing value.** `recordToolCallCompleted` already hashes `canonicalJson(result)` into `resultDigest` — a hash, never the raw value, so no secret is stored. We record the completed event over the **raw** result first, then return `redactResult(raw, …)`. Audit commits to what upstream truly returned; the agent payload is protected.
- **(b) Validation fails open when the schema is unusable (validation step only).** If a tool's `inputSchema` is absent/empty (`undefined`/`null`/`{}`) → skip validation, forward. If a schema fails to compile in ajv → skip validation for that tool, emit a one-time stderr warning, forward. The governance gate (`routeCall` risk-class) still holds; the agent gains no privilege. This prevents a malformed upstream-published schema from blocking an already-approved tool.

## 4. Components

### 4.1 `packages/mcp-gateway/src/arg-validation.ts` (new, pure)

New dependency `ajv@^8.17`. The validator compiles each served tool's schema **once at construction** (eager), keyed by tool name, so call-time validation is a map lookup + one `validate(args)` — no per-call compilation.

```ts
import Ajv, { type ValidateFunction } from "ajv";
import type { ServedTool } from "./gateway-state.js";

export type ArgValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export interface ArgValidator {
  validate(toolName: string, args: Record<string, unknown>): ArgValidationResult;
}

// `null` marks a tool whose schema is absent/empty/uncompilable → validation skipped.
export function createArgValidator(servedTools: ServedTool[]): ArgValidator {
  const ajv = new Ajv({
    strict: false,         // tolerate upstream schema quirks so they compile
    allErrors: true,       // collect every error for a useful message
    coerceTypes: false,    // never mutate args (digest fidelity)
    useDefaults: false,
    removeAdditional: false, // tolerate additionalProperties
  });

  const validators = new Map<string, ValidateFunction | null>();
  for (const tool of servedTools) {
    validators.set(tool.name, compileOrNull(ajv, tool));
  }

  return {
    validate(toolName, args) {
      if (!validators.has(toolName)) return { ok: true }; // existence gated by routeCall
      const fn = validators.get(toolName);
      if (fn === null || fn === undefined) return { ok: true }; // unusable schema → skip
      if (fn(args)) return { ok: true };
      return { ok: false, errors: (fn.errors ?? []).map(formatError) };
    },
  };
}

function compileOrNull(ajv: Ajv, tool: ServedTool): ValidateFunction | null {
  const schema = tool.inputSchema;
  if (schema === undefined || schema === null) return null;
  if (typeof schema === "object" && Object.keys(schema as object).length === 0) return null;
  try {
    return ajv.compile(schema as object);
  } catch (err) {
    console.error(
      `[arg-validation] tool ${tool.name} has an uncompilable inputSchema; ` +
        `argument validation skipped: ${(err as Error).message}`,
    );
    return null;
  }
}

function formatError(e: { instancePath?: string; message?: string }): string {
  const at = e.instancePath && e.instancePath.length > 0 ? e.instancePath : "(root)";
  return `${at} ${e.message ?? "is invalid"}`.trim();
}
```

> ESM note: ajv v8 default-exports the class. If `NodeNext` resolution complains about the default import, the implementer should switch to `import { default as Ajv } from "ajv"`. The TDD red→green run will surface this immediately.

### 4.2 `packages/mcp-gateway/src/result-redaction.ts` (new, pure, no deps)

```ts
export interface RedactionProfile {
  sensitiveKeys: ReadonlySet<string>; // normalized keys
  placeholder: string;
}

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

export const AGENT_CREDENTIAL_PROFILE: RedactionProfile = {
  sensitiveKeys: new Set([
    "apikey",
    "secretkey",
    "passphrase",
    "authorization",
    "privatekey",
    "credential",
    "credentialref",
  ]),
  placeholder: "[REDACTED]",
};

// Structure-preserving, pure (never mutates input). Generic so callers keep their type.
export function redactResult<T>(value: T, profile: RedactionProfile): T {
  return walk(value, profile) as T;
}

function walk(value: unknown, profile: RedactionProfile): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, profile));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = profile.sensitiveKeys.has(normalizeKey(k)) ? profile.placeholder : walk(v, profile);
    }
    return out;
  }
  return value; // primitives, null, undefined pass through unchanged
}
```

The walker is generic over the whole `CallToolResult` graph (including `structuredContent`). Secrets embedded inside free-text `content[].text` are **not** matched (the decision is key-name, not value-pattern) — an explicit scope boundary (§8). Sensitive keys are redacted at any depth and inside arrays.

### 4.3 `packages/schemas/src/tool-call-payloads.ts` (modify)

`CallDenyCode` is a `z.enum`, and `ToolCallDeniedPayload` is `.strict()` — so the new value must be added here or `ToolCallDeniedPayload.parse({ denyCode: "ARGUMENTS_INVALID" })` throws:

```ts
export const CallDenyCode = z.enum([
  "UNKNOWN_TOOL",
  "TOOL_FROZEN",
  "TOOL_BLOCKED",
  "DECISION_ENVELOPE_REQUIRED",
  "ARGUMENTS_INVALID", // 3E-2b
]);
```

### 4.4 `packages/mcp-gateway/src/call-router.ts` (modify)

A **second, separate** `CallDenyCode` TS union (consumed by `recordToolCallDenied` and `DENY_TEXT`) must be kept in sync:

```ts
export type CallDenyCode =
  | "UNKNOWN_TOOL"
  | "TOOL_FROZEN"
  | "TOOL_BLOCKED"
  | "DECISION_ENVELOPE_REQUIRED"
  | "ARGUMENTS_INVALID"; // 3E-2b
```

`routeCall` itself is unchanged — it never returns `ARGUMENTS_INVALID`; that value originates in `handleToolCall`. Widening the union is harmless (the existing `RouteOutcome` switch stays exhaustive).

### 4.5 `packages/mcp-gateway/src/call-handler.ts` (modify — the two seams)

- Extend `GatewayCallContext` with the validator:

```ts
import type { ArgValidator } from "./arg-validation.js";

export interface GatewayCallContext {
  client: UpstreamManifestClient;
  store: LedgerStore;
  deps: ReconcileDeps;
  audit: CallAudit;
  argValidator: ArgValidator; // 3E-2b
}
```

- Add the `DENY_TEXT` entry (the `Record<CallErrorCode, string>` will not type-check without it):

```ts
ARGUMENTS_INVALID: "The arguments did not match the tool's approved schema.",
```

- **Seam 1 — validation** (after `routeCall` forward, before `argumentsDigest`/`ToolCallRequested`):

```ts
// outcome.kind === "forward"
const validation = ctx.argValidator.validate(name, args);
if (!validation.ok) {
  const head = await ctx.store.head(ctx.audit.workspaceId);
  const denied = recordToolCallDenied(ctx.audit, ctx.deps, head, {
    toolName: name,
    denyCode: "ARGUMENTS_INVALID",
    riskClass: outcome.riskClass,
  });
  await ctx.store.append(head, [denied]);
  return denyCall(
    "ARGUMENTS_INVALID",
    name,
    `${DENY_TEXT.ARGUMENTS_INVALID} ${validation.errors.slice(0, 5).join("; ")}`.trim(),
  );
}
```

(No `IncidentOpened`. `riskClass` is included for audit parity with other denials; `recordToolCallDenied` already accepts an optional `riskClass`.)

- **Seam 2 — redaction** (the completed event is recorded over the raw result, then the returned value is redacted):

```ts
const result = await ctx.client.callTool(name, args);
const completed = recordToolCallCompleted(ctx.audit, ctx.deps, requested.eventHash, {
  toolName: name,
  result, // raw — resultDigest commits to the true upstream response
});
await ctx.store.append(requested.eventHash, [completed]);
return redactResult(result, AGENT_CREDENTIAL_PROFILE); // agent-facing only
```

### 4.6 `packages/mcp-gateway/src/boot-gateway.ts` (modify)

`state` is in scope at the `callCtx` assembly (line ~100, happy path only; degraded boot never builds a `callCtx`). Construct the validator from the booted served tools:

```ts
import { createArgValidator } from "./arg-validation.js";
// ...
const callCtx: GatewayCallContext = {
  client,
  store,
  deps,
  audit,
  argValidator: createArgValidator(state.servedTools),
};
```

### 4.7 `packages/mcp-gateway/package.json` (modify)

Add `"ajv": "^8.17.1"` to `dependencies`.

## 5. Data Flow (forward path, after change)

```
handleToolCall(state, ctx, name, args)
  ctx === undefined → denyCall(TOOL_CALL_NOT_AVAILABLE)                      [unchanged]
  outcome = routeCall(state, name)
  outcome.kind === "deny" → record ToolCallDenied (+Incident?) → denyCall    [unchanged]
  // forward:
  validation = ctx.argValidator.validate(name, args)                         [NEW seam 1]
  !validation.ok → record ToolCallDenied("ARGUMENTS_INVALID", no incident)
                   → denyCall("ARGUMENTS_INVALID", …errors)
  argumentsDigest = deps.hash(canonicalJson(args))                           [unchanged — args unmutated]
  record ToolCallRequested
  try result = await client.callTool(name, args)
     record ToolCallCompleted (resultDigest over RAW result)                 [unchanged]
     return redactResult(result, AGENT_CREDENTIAL_PROFILE)                   [NEW seam 2]
  catch → record ToolCallFailed → denyCall(UPSTREAM_CALL_FAILED)             [unchanged]
```

## 6. Error Handling

- **Invalid args** → `ToolCallDenial { isError: true, traceguard: { errorCode: "ARGUMENTS_INVALID", toolName } }`, content = base message + up to 5 ajv error strings; one `ToolCallDenied` recorded; no incident; **upstream not called**.
- **Absent/empty/uncompilable schema** → validation skipped (judgment 3b); call forwarded; compile failure logs once to stderr.
- **Redaction** is total and pure; non-object inputs pass through; never throws.

## 7. Testing (TDD, per task)

**`arg-validation.test.ts`**
- valid args → `{ ok: true }`
- missing `required` → `{ ok: false }`
- wrong `type` → `{ ok: false }`
- `enum` violation → `{ ok: false }`
- extra property tolerated → `{ ok: true }` (no `additionalProperties:false` synthesized)
- no coercion: string `"5"` for a `number` field → `{ ok: false }` (not coerced)
- absent / empty `{}` schema → `{ ok: true }` (skipped)
- uncompilable schema → `{ ok: true }` (skipped; constructor does not throw)
- compiled once: a spy/counter proves `ajv.compile` runs at construction, not per `validate` call

**`result-redaction.test.ts`**
- redacts `apiKey`/`secretKey`/`passphrase`/`authorization`/`privateKey`/`credential`/`credentialRef` at top level, nested, and inside arrays
- normalization: `api_key`, `API-KEY`, `ApiKey` all hit
- value replaced with `"[REDACTED]"`
- `balance`/`positions`/`token` (coin symbol) **not** redacted
- input object **not** mutated (purity): deep-equal the original after redaction
- primitives/`null`/`undefined` pass through
- walks `structuredContent` within a `CallToolResult`-shaped object

**`call-handler.test.ts` (extend)**
- invalid args → `ARGUMENTS_INVALID` denial; one `ToolCallDenied` recorded; no `IncidentOpened`; upstream `callTool` **not** invoked; no `ToolCallRequested`
- valid args → forwarded; `ToolCallRequested` + `ToolCallCompleted` recorded; returned result is redacted
- `resultDigest` on `ToolCallCompleted` is computed over the **raw** (unredacted) result
- `argumentsDigest` unchanged (args not mutated by validation)
- test contexts must now supply `argValidator` in `GatewayCallContext` (a trivial always-`{ ok: true }` stub where validation is not under test, or a real `createArgValidator([...])`)

**`packages/schemas/src/tool-call-payloads.test.ts` (extend)**
- `ToolCallDeniedPayload.parse({ …, denyCode: "ARGUMENTS_INVALID" })` succeeds

## 8. Scope Boundaries (YAGNI)

- No public-demo-export surface or profile (deferred until that surface exists — likely 3E-2c+).
- No value-pattern / free-text redaction (key-name structured match only).
- No per-tool sensitive-path maps.
- One redaction profile (`AGENT_CREDENTIAL_PROFILE`); the type is profile-parameterized for future profiles.
- `format` keyword not enforced (no `ajv-formats`); ajv-core keywords (`type`, `required`, `enum`, `pattern`, `minimum`/`maximum`, `minLength`, …) are. `ajv-formats` can be added later if a served tool's schema relies on `format`.

## 9. Deferred Follow-ups (not implementation tasks)

- **Contract doc reclassification.** `docs/mcp-gateway-contract.md` §9.2/§9.3/§20 should move from "deferred to 3E-2" to "landed (3E-2b)". This file currently carries **uncommitted R6 edits**; reclassifying it inside a 3E-2b commit would entangle those edits (and partial-file staging is fragile). Defer the doc reclassification until the R6 contract edits are committed, then update it in a dedicated doc commit. Code remains the source of truth in the meantime.
- The two `CallDenyCode` definitions (schemas Zod enum + gateway TS union) are hand-synced; a future consolidation could derive one from the other, but that cross-package refactor is out of scope here.

## 10. File Manifest

**Create**
- `packages/mcp-gateway/src/arg-validation.ts`
- `packages/mcp-gateway/src/arg-validation.test.ts`
- `packages/mcp-gateway/src/result-redaction.ts`
- `packages/mcp-gateway/src/result-redaction.test.ts`

**Modify**
- `packages/schemas/src/tool-call-payloads.ts` (add `ARGUMENTS_INVALID` to `CallDenyCode` enum)
- `packages/schemas/src/tool-call-payloads.test.ts` (assert it parses)
- `packages/mcp-gateway/src/call-router.ts` (add `ARGUMENTS_INVALID` to the TS union)
- `packages/mcp-gateway/src/call-handler.ts` (`GatewayCallContext.argValidator`, `DENY_TEXT` entry, seams 1 & 2)
- `packages/mcp-gateway/src/call-handler.test.ts` (new cases + `argValidator` in test contexts)
- `packages/mcp-gateway/src/boot-gateway.ts` (construct `argValidator` into `callCtx`)
- `packages/mcp-gateway/package.json` (add `ajv`)

**Do NOT touch** (uncommitted R6 / cross-cutting): `internal-tool-handlers.ts`, `internal-tool-handlers.test.ts`, `docs/mcp-gateway-contract.md`.
