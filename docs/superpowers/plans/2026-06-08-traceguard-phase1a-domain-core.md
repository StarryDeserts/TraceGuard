# TraceGuard Phase 1A — Domain Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the functional-core / event-sourcing kernel that takes a proposed trading action and deterministically classifies it as allow / require_approval / block (or rejects an invalid one), recording the outcome as an immutable, hash-chained event sequence.

**Architecture:** Functional core / imperative shell. All decision logic is pure functions over plain data; the only shell is an in-memory `LedgerStore` adapter. Clock and id generation are injected so output is byte-reproducible. pnpm workspace with five packages: `schemas` ← (`event-ledger`, `policy-engine`, `domain`), plus `testing-fixtures`.

**Tech Stack:** TypeScript (strict, ESM, NodeNext), Node v24, pnpm v10 workspace, Vitest (tests), fast-check (property tests), Zod (schemas), Node `crypto` (SHA-256). No database, no network, no Turborepo.

**Spec:** `docs/superpowers/specs/2026-06-08-traceguard-phase1a-domain-core-design.md`. Canonical doc references (e.g. event-model §2) point at the source of truth; if this plan and a canonical doc disagree, the canonical doc wins.

---

## Conventions used throughout this plan

- **Package layout:** every package lives in `packages/<name>/` with `src/`, a `package.json`, and a `tsconfig.json` that extends the root. Source files are `.ts`; tests are colocated as `*.test.ts` under `packages/<name>/src/`.
- **Imports:** ESM with explicit `.js` extensions on relative imports (NodeNext resolution). Cross-package imports use the package name (e.g. `import { canonicalJson } from "@traceguard/event-ledger"`).
- **Run tests for one package:** `pnpm --filter @traceguard/<name> test`. Run all: `pnpm -r test`.
- **Commit cadence:** one commit per task (after its tests pass). Conventional-commit style: `feat(scope): …`, `test(scope): …`, `chore: …`.
- **Decimal rule:** financial/execution values are decimal **strings**, never JS numbers (policy-semantics §6.2). The only number in any payload is `confidence`, and it is excluded from the decision hash and the action digest.

---

## File Structure

```
TraceGuard/
  pnpm-workspace.yaml                         # workspace globs
  package.json                                # root scripts + devDeps (vitest, fast-check, typescript)
  tsconfig.base.json                          # shared strict/ESM compiler options
  vitest.config.ts                            # root vitest config (workspace-wide)
  packages/
    schemas/
      package.json
      tsconfig.json
      src/
        scalars.ts          # DecimalString, IsoTimestamp, prefixed-id schemas
        scalars.test.ts
        decision-envelope.ts# DecisionEnvelope (policy-semantics §6)
        decision-envelope.test.ts
        ledger-event.ts     # LedgerEvent<T>, AggregateType, ActorType (event-model §2)
        ledger-event.test.ts
        event-payloads.ts   # 5 payload schemas (event-model §6.12–6.18)
        event-payloads.test.ts
        policy.ts           # Effect, Condition, Rule, Policy AST
        policy.test.ts
        action-digest-input.ts # ActionDigestInput (policy-semantics §9.1)
        run-status.ts       # RunStatus enum (event-model §8.1)
        index.ts            # barrel re-export
    event-ledger/
      package.json
      tsconfig.json
      src/
        canonical-json.ts   # canonicalize + canonicalJson (event-model §10.3)
        canonical-json.test.ts
        hashing.ts          # sha256hex, payloadHash, eventHash (event-model §10.1–10.2)
        hashing.test.ts
        clock-id.ts         # Clock, IdGen interfaces
        make-event.ts       # makeEvent (composes hashing + clock/id)
        make-event.test.ts
        ledger-store.ts     # LedgerStore port, InMemoryLedgerStore, error types
        ledger-store.test.ts
        run-status-projection.ts
        run-status-projection.test.ts
        index.ts
    policy-engine/
      package.json
      tsconfig.json
      src/
        predicates.ts       # condition evaluation (decimal-aware)
        predicates.test.ts
        evaluate.ts         # evaluate(): precedence + default-deny
        evaluate.test.ts
        action-digest.ts    # computeActionDigest (policy-semantics §9.2)
        action-digest.test.ts
        index.ts
    testing-fixtures/
      package.json
      tsconfig.json
      src/
        deps.ts             # fixedClock, sequentialIdGen
        samples.ts          # sample envelopes, policies, contexts, run ids
        index.ts
    domain/
      package.json
      tsconfig.json
      src/
        propose-decision.ts # proposeDecision use-case (composes all)
        propose-decision.test.ts
        acceptance.test.ts  # 1A exit-criterion end-to-end test
        index.ts
```

---

## Task 0: Workspace bootstrap

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `vitest.config.ts`

- [ ] **Step 1: Create the workspace manifest**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 2: Create the root package.json**

Create `package.json`:

```json
{
  "name": "traceguard",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc --build",
    "typecheck": "tsc --build --pretty",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "fast-check": "^3.22.0"
  }
}
```

- [ ] **Step 3: Create the shared TypeScript config**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "composite": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 4: Create the root vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`
Expected: lockfile `pnpm-lock.yaml` created; `node_modules/` populated; no errors.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json vitest.config.ts pnpm-lock.yaml
git commit -m "chore: bootstrap pnpm workspace with TS strict + vitest"
```

---

## Task 1: `schemas` package scaffold + scalar types

**Files:**
- Create: `packages/schemas/package.json`, `packages/schemas/tsconfig.json`
- Create: `packages/schemas/src/scalars.ts`
- Test: `packages/schemas/src/scalars.test.ts`

- [ ] **Step 1: Create the package manifest**

Create `packages/schemas/package.json`:

```json
{
  "name": "@traceguard/schemas",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run --root . " },
  "dependencies": { "zod": "^3.23.0" }
}
```

- [ ] **Step 2: Create the package tsconfig**

Create `packages/schemas/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 3: Install zod into the package**

Run: `pnpm --filter @traceguard/schemas add zod`
Expected: `zod` added to `packages/schemas/package.json` dependencies; lockfile updated.

- [ ] **Step 4: Write the failing test**

Create `packages/schemas/src/scalars.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DecimalString, IsoTimestamp, PrefixedId } from "./scalars.js";

describe("DecimalString", () => {
  it("accepts integer and decimal strings", () => {
    expect(DecimalString.parse("300")).toBe("300");
    expect(DecimalString.parse("300.50")).toBe("300.50");
    expect(DecimalString.parse("-1.25")).toBe("-1.25");
  });
  it("rejects numbers and non-decimal strings", () => {
    expect(() => DecimalString.parse(300 as unknown)).toThrow();
    expect(() => DecimalString.parse("3e2")).toThrow();
    expect(() => DecimalString.parse("abc")).toThrow();
    expect(() => DecimalString.parse("")).toThrow();
  });
});

describe("IsoTimestamp", () => {
  it("accepts ISO-8601 UTC instants", () => {
    expect(IsoTimestamp.parse("2026-06-08T00:00:00.000Z")).toBe("2026-06-08T00:00:00.000Z");
  });
  it("rejects non-UTC or malformed", () => {
    expect(() => IsoTimestamp.parse("2026-06-08")).toThrow();
    expect(() => IsoTimestamp.parse("2026-06-08T00:00:00+02:00")).toThrow();
  });
});

describe("PrefixedId", () => {
  it("builds a schema that requires the given prefix", () => {
    const DecisionId = PrefixedId("dec");
    expect(DecisionId.parse("dec_01")).toBe("dec_01");
    expect(() => DecisionId.parse("evt_01")).toThrow();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @traceguard/schemas exec vitest run src/scalars.test.ts`
Expected: FAIL — cannot find module `./scalars.js`.

- [ ] **Step 6: Implement the scalars**

Create `packages/schemas/src/scalars.ts`:

```ts
import { z } from "zod";

/** Decimal string: optional sign, digits, optional fractional part. No exponent, no float. */
export const DecimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "must be a decimal string (no exponent, no float)");
export type DecimalString = z.infer<typeof DecimalString>;

/** ISO-8601 instant in UTC (must end in Z, must include time). */
export const IsoTimestamp = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/,
    "must be an ISO-8601 UTC instant ending in Z",
  );
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

/** Builds a schema for ids that must start with `<prefix>_`. */
export function PrefixedId(prefix: string) {
  return z.string().regex(new RegExp(`^${prefix}_.+`), `must start with "${prefix}_"`);
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @traceguard/schemas exec vitest run src/scalars.test.ts`
Expected: PASS (3 suites).

- [ ] **Step 8: Commit**

```bash
git add packages/schemas
git commit -m "feat(schemas): add decimal-string, ISO timestamp, prefixed-id scalars"
```

---

## Task 2: `DecisionEnvelope` schema (policy-semantics §6)

**Files:**
- Create: `packages/schemas/src/decision-envelope.ts`
- Test: `packages/schemas/src/decision-envelope.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/decision-envelope.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DecisionEnvelope } from "./decision-envelope.js";

const valid = {
  id: "dec_1",
  instrument: "BTCUSDT",
  marketType: "futures",
  action: "open_long",
  thesis: "Momentum positive, funding moderate.",
  evidenceRefs: ["ev_1"],
  requestedNotionalUsdt: "300",
  requestedLeverage: "2",
};

describe("DecisionEnvelope", () => {
  it("accepts a minimal valid envelope", () => {
    expect(DecisionEnvelope.parse(valid)).toMatchObject({ action: "open_long" });
  });
  it("accepts confidence as a number", () => {
    expect(DecisionEnvelope.parse({ ...valid, confidence: 0.7 }).confidence).toBe(0.7);
  });
  it("rejects an unknown action", () => {
    expect(() => DecisionEnvelope.parse({ ...valid, action: "yolo" })).toThrow();
  });
  it("rejects a numeric notional (must be a decimal string)", () => {
    expect(() => DecisionEnvelope.parse({ ...valid, requestedNotionalUsdt: 300 })).toThrow();
  });
  it("rejects unknown keys (strict)", () => {
    expect(() => DecisionEnvelope.parse({ ...valid, surprise: 1 })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @traceguard/schemas exec vitest run src/decision-envelope.test.ts`
Expected: FAIL — cannot find module `./decision-envelope.js`.

- [ ] **Step 3: Implement the schema**

Create `packages/schemas/src/decision-envelope.ts`:

```ts
import { z } from "zod";
import { DecimalString } from "./scalars.js";

export const MarketType = z.enum(["spot", "futures", "tokenized_stock"]);
export type MarketType = z.infer<typeof MarketType>;

export const DecisionAction = z.enum([
  "buy",
  "sell",
  "open_long",
  "open_short",
  "reduce",
  "close",
  "hold",
  "abstain",
]);
export type DecisionAction = z.infer<typeof DecisionAction>;

export const DecisionEnvelope = z
  .object({
    id: z.string().min(1),
    instrument: z.string().min(1),
    marketType: MarketType,
    action: DecisionAction,
    thesis: z.string(),
    confidence: z.number().min(0).max(1).optional(),
    evidenceRefs: z.array(z.string()),
    requestedNotionalUsdt: DecimalString.optional(),
    requestedQuantity: DecimalString.optional(),
    requestedLeverage: DecimalString.optional(),
    orderType: z.string().optional(),
    limitPrice: DecimalString.optional(),
    stopLoss: DecimalString.optional(),
    takeProfit: DecimalString.optional(),
    promptVersion: z.string().optional(),
    modelProvider: z.string().optional(),
    modelName: z.string().optional(),
  })
  .strict();
export type DecisionEnvelope = z.infer<typeof DecisionEnvelope>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @traceguard/schemas exec vitest run src/decision-envelope.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/decision-envelope.ts packages/schemas/src/decision-envelope.test.ts
git commit -m "feat(schemas): add DecisionEnvelope schema"
```

---

## Task 3: `LedgerEvent` envelope (event-model §2)

**Files:**
- Create: `packages/schemas/src/ledger-event.ts`
- Test: `packages/schemas/src/ledger-event.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/ledger-event.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AggregateType, ActorType, LedgerEvent } from "./ledger-event.js";

const base = {
  id: "evt_1",
  workspaceId: "ws_1",
  aggregateType: "decision",
  aggregateId: "dec_1",
  eventType: "DecisionProposed",
  eventVersion: 1,
  schemaVersion: 1,
  occurredAt: "2026-06-08T00:00:00.000Z",
  recordedAt: "2026-06-08T00:00:00.000Z",
  actorType: "agent",
  payload: { any: "thing" },
  payloadHash: "h1",
  eventHash: "h2",
};

describe("LedgerEvent", () => {
  it("accepts a minimal event without previousEventHash", () => {
    expect(LedgerEvent.parse(base).eventHash).toBe("h2");
  });
  it("accepts an event with previousEventHash and runId", () => {
    expect(LedgerEvent.parse({ ...base, previousEventHash: "h0", runId: "run_1" }).previousEventHash).toBe("h0");
  });
  it("rejects an unknown aggregateType", () => {
    expect(() => LedgerEvent.parse({ ...base, aggregateType: "spaceship" })).toThrow();
  });
  it("enumerates the canonical aggregate and actor types", () => {
    expect(AggregateType.options).toContain("authorization");
    expect(ActorType.options).toEqual(["user", "agent", "system", "provider", "worker"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @traceguard/schemas exec vitest run src/ledger-event.test.ts`
Expected: FAIL — cannot find module `./ledger-event.js`.

- [ ] **Step 3: Implement the envelope**

Create `packages/schemas/src/ledger-event.ts`:

```ts
import { z } from "zod";
import { IsoTimestamp } from "./scalars.js";

export const AggregateType = z.enum([
  "workspace",
  "provider_connection",
  "tool_manifest",
  "tool_definition",
  "agent",
  "run",
  "decision",
  "policy",
  "approval",
  "authorization",
  "execution",
  "replay",
  "incident",
  "evidence_export",
  "telegram_binding",
]);
export type AggregateType = z.infer<typeof AggregateType>;

export const ActorType = z.enum(["user", "agent", "system", "provider", "worker"]);
export type ActorType = z.infer<typeof ActorType>;

export const RedactionProfile = z.enum(["internal_full", "developer_debug", "public_demo"]);
export type RedactionProfile = z.infer<typeof RedactionProfile>;

/** Event envelope, event-model §2. Generic over the payload type. */
export interface LedgerEvent<TPayload = unknown> {
  id: string;
  workspaceId: string;
  aggregateType: AggregateType;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  schemaVersion: number;
  occurredAt: string;
  recordedAt: string;
  actorType: ActorType;
  actorId?: string;
  runId?: string;
  agentId?: string;
  providerConnectionId?: string;
  policyVersionId?: string;
  toolManifestVersionId?: string;
  traceId?: string;
  spanId?: string;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
  payload: TPayload;
  payloadHash: string;
  previousEventHash?: string;
  eventHash: string;
  redactionProfile?: RedactionProfile;
}

/** Runtime validator for an envelope (payload validated separately by its own schema). */
export const LedgerEvent = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    aggregateType: AggregateType,
    aggregateId: z.string().min(1),
    eventType: z.string().min(1),
    eventVersion: z.number().int().nonnegative(),
    schemaVersion: z.number().int().nonnegative(),
    occurredAt: IsoTimestamp,
    recordedAt: IsoTimestamp,
    actorType: ActorType,
    actorId: z.string().optional(),
    runId: z.string().optional(),
    agentId: z.string().optional(),
    providerConnectionId: z.string().optional(),
    policyVersionId: z.string().optional(),
    toolManifestVersionId: z.string().optional(),
    traceId: z.string().optional(),
    spanId: z.string().optional(),
    correlationId: z.string().optional(),
    causationId: z.string().optional(),
    idempotencyKey: z.string().optional(),
    payload: z.unknown(),
    payloadHash: z.string().min(1),
    previousEventHash: z.string().optional(),
    eventHash: z.string().min(1),
    redactionProfile: RedactionProfile.optional(),
  })
  .strict();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @traceguard/schemas exec vitest run src/ledger-event.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/ledger-event.ts packages/schemas/src/ledger-event.test.ts
git commit -m "feat(schemas): add LedgerEvent envelope + aggregate/actor enums"
```

---

## Task 4: The five 1A event payloads (event-model §6.12–6.18)

**Files:**
- Create: `packages/schemas/src/event-payloads.ts`
- Test: `packages/schemas/src/event-payloads.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/event-payloads.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DecisionProposedPayload,
  DecisionValidatedPayload,
  DecisionRejectedPayload,
  PolicyEvaluationStartedPayload,
  PolicyEvaluatedPayload,
} from "./event-payloads.js";

describe("event payloads", () => {
  it("DecisionProposedPayload requires decisionHash and a canonical action", () => {
    const p = DecisionProposedPayload.parse({
      decisionId: "dec_1",
      runId: "run_1",
      envelopeVersion: 1,
      instrument: "BTCUSDT",
      marketType: "futures",
      action: "open_long",
      thesis: "x",
      evidenceRefs: [],
      decisionHash: "sha",
    });
    expect(p.decisionHash).toBe("sha");
  });

  it("DecisionValidatedPayload pins validationResult to 'valid'", () => {
    expect(() =>
      DecisionValidatedPayload.parse({
        decisionId: "dec_1",
        runId: "run_1",
        validationResult: "invalid",
        normalizedDecisionRef: "ref",
        normalizedDecisionHash: "h",
      }),
    ).toThrow();
  });

  it("DecisionRejectedPayload constrains reasonCode", () => {
    const p = DecisionRejectedPayload.parse({
      runId: "run_1",
      reasonCode: "schema_invalid",
      validationErrors: [{ path: "action", message: "bad" }],
    });
    expect(p.reasonCode).toBe("schema_invalid");
    expect(() =>
      DecisionRejectedPayload.parse({ runId: "run_1", reasonCode: "nope", validationErrors: [] }),
    ).toThrow();
  });

  it("PolicyEvaluationStartedPayload requires evaluationInputHash", () => {
    const p = PolicyEvaluationStartedPayload.parse({
      evaluationId: "eval_1",
      runId: "run_1",
      decisionId: "dec_1",
      policyVersionId: "pv_1",
      evaluatorVersion: "1.0.0",
      evaluationInputHash: "h",
    });
    expect(p.evaluatorVersion).toBe("1.0.0");
  });

  it("PolicyEvaluatedPayload carries outcome + matchedRules", () => {
    const p = PolicyEvaluatedPayload.parse({
      evaluationId: "eval_1",
      runId: "run_1",
      decisionId: "dec_1",
      policyVersionId: "pv_1",
      evaluatorVersion: "1.0.0",
      outcome: "require_approval",
      matchedRules: [{ ruleId: "r1", outcome: "require_approval", explanation: "notional>200" }],
      evaluationOutputHash: "h",
    });
    expect(p.outcome).toBe("require_approval");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @traceguard/schemas exec vitest run src/event-payloads.test.ts`
Expected: FAIL — cannot find module `./event-payloads.js`.

- [ ] **Step 3: Implement the payloads**

Create `packages/schemas/src/event-payloads.ts`:

```ts
import { z } from "zod";
import { DecimalString } from "./scalars.js";
import { DecisionAction, MarketType } from "./decision-envelope.js";

export const Effect = z.enum(["allow", "require_approval", "block"]);
export type Effect = z.infer<typeof Effect>;

/** event-model §6.12 */
export const DecisionProposedPayload = z
  .object({
    decisionId: z.string().min(1),
    runId: z.string().min(1),
    envelopeVersion: z.number().int().nonnegative(),
    instrument: z.string().min(1),
    marketType: MarketType,
    action: DecisionAction,
    thesis: z.string(),
    confidence: z.number().optional(),
    evidenceRefs: z.array(z.string()),
    requestedNotionalUsdt: DecimalString.optional(),
    requestedQuantity: DecimalString.optional(),
    requestedLeverage: DecimalString.optional(),
    orderType: z.string().optional(),
    limitPrice: DecimalString.optional(),
    stopLoss: DecimalString.optional(),
    takeProfit: DecimalString.optional(),
    promptVersion: z.string().optional(),
    modelProvider: z.string().optional(),
    modelName: z.string().optional(),
    decisionHash: z.string().min(1),
  })
  .strict();
export type DecisionProposedPayload = z.infer<typeof DecisionProposedPayload>;

/** event-model §6.13 */
export const DecisionValidatedPayload = z
  .object({
    decisionId: z.string().min(1),
    runId: z.string().min(1),
    validationResult: z.literal("valid"),
    normalizedDecisionRef: z.string().min(1),
    normalizedDecisionHash: z.string().min(1),
  })
  .strict();
export type DecisionValidatedPayload = z.infer<typeof DecisionValidatedPayload>;

/** event-model §6.14 */
export const DecisionRejectedPayload = z
  .object({
    decisionId: z.string().optional(),
    runId: z.string().min(1),
    reasonCode: z.enum([
      "schema_invalid",
      "missing_required_field",
      "unsupported_action",
      "missing_evidence",
      "snapshot_rejected",
      "numeric_parse_error",
    ]),
    validationErrors: z.array(z.object({ path: z.string(), message: z.string() }).strict()),
  })
  .strict();
export type DecisionRejectedPayload = z.infer<typeof DecisionRejectedPayload>;

/** event-model §6.17 */
export const PolicyEvaluationStartedPayload = z
  .object({
    evaluationId: z.string().min(1),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    policyVersionId: z.string().min(1),
    evaluatorVersion: z.string().min(1),
    evaluationInputHash: z.string().min(1),
  })
  .strict();
export type PolicyEvaluationStartedPayload = z.infer<typeof PolicyEvaluationStartedPayload>;

/** event-model §6.18 */
export const MatchedRule = z
  .object({
    ruleId: z.string().min(1),
    outcome: Effect,
    explanation: z.string(),
    expected: z.unknown().optional(),
    actual: z.unknown().optional(),
  })
  .strict();
export type MatchedRule = z.infer<typeof MatchedRule>;

export const PolicyEvaluatedPayload = z
  .object({
    evaluationId: z.string().min(1),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    policyVersionId: z.string().min(1),
    evaluatorVersion: z.string().min(1),
    outcome: Effect,
    matchedRules: z.array(MatchedRule),
    evaluationOutputHash: z.string().min(1),
  })
  .strict();
export type PolicyEvaluatedPayload = z.infer<typeof PolicyEvaluatedPayload>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @traceguard/schemas exec vitest run src/event-payloads.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/event-payloads.ts packages/schemas/src/event-payloads.test.ts
git commit -m "feat(schemas): add the five Phase 1A decision/policy event payloads"
```

---

## Task 5: Policy AST, `ActionDigestInput`, `RunStatus`, barrel export

**Files:**
- Create: `packages/schemas/src/policy.ts`, `packages/schemas/src/action-digest-input.ts`, `packages/schemas/src/run-status.ts`, `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/policy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Policy, Condition } from "./policy.js";

describe("Policy AST", () => {
  it("accepts a policy with a default-deny and one rule", () => {
    const p = Policy.parse({
      version: 1,
      defaultEffect: "block",
      rules: [
        {
          id: "r1",
          effect: "require_approval",
          conditions: [{ kind: "notional_gt", value: "200" }],
        },
      ],
    });
    expect(p.defaultEffect).toBe("block");
  });

  it("forces defaultEffect to be 'block' (default-deny)", () => {
    expect(() =>
      Policy.parse({ version: 1, defaultEffect: "allow", rules: [] }),
    ).toThrow();
  });

  it("rejects an unknown condition kind", () => {
    expect(() => Condition.parse({ kind: "wat", value: "1" })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @traceguard/schemas exec vitest run src/policy.test.ts`
Expected: FAIL — cannot find module `./policy.js`.

- [ ] **Step 3: Implement the policy AST**

Create `packages/schemas/src/policy.ts`:

```ts
import { z } from "zod";
import { DecimalString } from "./scalars.js";
import { DecisionAction, MarketType } from "./decision-envelope.js";
import { Effect } from "./event-payloads.js";

/**
 * The 1A predicate set. Every condition is deterministic. Numeric comparators
 * operate on decimal strings, compared as decimals (never floats).
 */
export const Condition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("action_in"), values: z.array(DecisionAction).min(1) }).strict(),
  z.object({ kind: z.literal("instrument_in"), values: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ kind: z.literal("market_type_in"), values: z.array(MarketType).min(1) }).strict(),
  z.object({ kind: z.literal("notional_gt"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("notional_lte"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("quantity_gt"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("leverage_gt"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("workspace_mode_eq"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("manifest_status_eq"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("snapshot_age_gt"), seconds: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("tool_risk_class_eq"), value: z.string().min(1) }).strict(),
]);
export type Condition = z.infer<typeof Condition>;

export const Rule = z
  .object({
    id: z.string().min(1),
    effect: Effect,
    /** All conditions must hold for the rule to match (logical AND). */
    conditions: z.array(Condition),
  })
  .strict();
export type Rule = z.infer<typeof Rule>;

export const Policy = z
  .object({
    version: z.number().int().nonnegative(),
    /** Default-deny is encoded in the type: defaultEffect is always "block". */
    defaultEffect: z.literal("block"),
    rules: z.array(Rule),
  })
  .strict();
export type Policy = z.infer<typeof Policy>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @traceguard/schemas exec vitest run src/policy.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Implement `ActionDigestInput` (no test of its own; exercised in policy-engine)**

Create `packages/schemas/src/action-digest-input.ts`:

```ts
import { z } from "zod";
import { DecimalString } from "./scalars.js";

/** policy-semantics §9.1 */
export const ActionDigestInput = z
  .object({
    workspaceId: z.string().min(1),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    providerConnectionId: z.string().min(1),
    toolName: z.string().min(1),
    toolManifestHash: z.string().min(1),
    policyVersionId: z.string().min(1),
    workspaceMode: z.string().min(1),
    instrument: z.string().min(1),
    marketType: z.string().min(1),
    action: z.string().min(1),
    requestedNotionalUsdt: DecimalString.optional(),
    requestedQuantity: DecimalString.optional(),
    requestedLeverage: DecimalString.optional(),
    orderType: z.string().optional(),
    limitPrice: DecimalString.optional(),
    stopLoss: DecimalString.optional(),
    takeProfit: DecimalString.optional(),
    marketSnapshotRef: z.string().optional(),
    executionAdapter: z.enum(["simulator", "bitget_live", "replay"]),
  })
  .strict();
export type ActionDigestInput = z.infer<typeof ActionDigestInput>;
```

- [ ] **Step 6: Implement `RunStatus` (event-model §8.1)**

Create `packages/schemas/src/run-status.ts`:

```ts
import { z } from "zod";

export const RunStatus = z.enum([
  "created",
  "capturing",
  "decision_ready",
  "policy_evaluating",
  "allowed",
  "approval_required",
  "blocked",
  "executing",
  "completed",
  "failed",
  "replayed",
]);
export type RunStatus = z.infer<typeof RunStatus>;
```

- [ ] **Step 7: Create the barrel export**

Create `packages/schemas/src/index.ts`:

```ts
export * from "./scalars.js";
export * from "./decision-envelope.js";
export * from "./ledger-event.js";
export * from "./event-payloads.js";
export * from "./policy.js";
export * from "./action-digest-input.js";
export * from "./run-status.js";
```

- [ ] **Step 8: Typecheck the whole package**

Run: `pnpm --filter @traceguard/schemas exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/schemas/src
git commit -m "feat(schemas): add policy AST, ActionDigestInput, RunStatus, barrel export"
```

---

## Task 6: `event-ledger` scaffold + canonical JSON (event-model §10.3)

**Files:**
- Create: `packages/event-ledger/package.json`, `packages/event-ledger/tsconfig.json`
- Create: `packages/event-ledger/src/canonical-json.ts`
- Test: `packages/event-ledger/src/canonical-json.test.ts`

- [ ] **Step 1: Create the package manifest**

Create `packages/event-ledger/package.json`:

```json
{
  "name": "@traceguard/event-ledger",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@traceguard/schemas": "workspace:*" }
}
```

- [ ] **Step 2: Create the package tsconfig**

Create `packages/event-ledger/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [{ "path": "../schemas" }]
}
```

- [ ] **Step 3: Link the workspace dependency**

Run: `pnpm install`
Expected: `@traceguard/schemas` symlinked into `packages/event-ledger/node_modules`; no errors.

- [ ] **Step 4: Write the failing test**

Create `packages/event-ledger/src/canonical-json.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canonicalJson } from "./canonical-json.js";

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
  it("is invariant to input key order", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it("drops undefined values", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
  it("keeps null and preserves array order", () => {
    expect(canonicalJson({ a: null, xs: [3, 1, 2] })).toBe('{"a":null,"xs":[3,1,2]}');
  });
  it("preserves decimal strings verbatim", () => {
    expect(canonicalJson({ n: "300.50" })).toBe('{"n":"300.50"}');
  });
  it("emits no insignificant whitespace", () => {
    expect(canonicalJson({ a: 1 })).not.toContain(" ");
  });
  it("throws on non-finite numbers", () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    expect(() => canonicalJson({ x: Number.POSITIVE_INFINITY })).toThrow();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @traceguard/event-ledger exec vitest run src/canonical-json.test.ts`
Expected: FAIL — cannot find module `./canonical-json.js`.

- [ ] **Step 6: Implement canonical JSON**

Create `packages/event-ledger/src/canonical-json.ts`:

```ts
/**
 * Canonicalization rules (event-model §10.3): sorted object keys, no undefined values,
 * arrays preserve order, decimal values are strings (preserved verbatim). The output of
 * canonicalJson is the exact byte string that gets hashed.
 */
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
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v === undefined) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value; // string | boolean
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @traceguard/event-ledger exec vitest run src/canonical-json.test.ts`
Expected: PASS (7 assertions).

- [ ] **Step 8: Commit**

```bash
git add packages/event-ledger
git commit -m "feat(event-ledger): add deterministic canonical JSON"
```

---

## Task 7: Hashing — `sha256hex`, `payloadHash`, `eventHash` (event-model §10.1–10.2)

**Files:**
- Create: `packages/event-ledger/src/hashing.ts`
- Test: `packages/event-ledger/src/hashing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/event-ledger/src/hashing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sha256hex, payloadHash, eventHash, type EventHashHeader } from "./hashing.js";

const header: EventHashHeader = {
  id: "evt_1",
  workspaceId: "ws_1",
  aggregateType: "decision",
  aggregateId: "dec_1",
  eventType: "DecisionProposed",
  eventVersion: 1,
  schemaVersion: 1,
  occurredAt: "2026-06-08T00:00:00.000Z",
  actorType: "agent",
  payloadHash: "ph",
  previousEventHash: null,
};

describe("hashing", () => {
  it("sha256hex matches the known SHA-256 of 'abc'", () => {
    expect(sha256hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("payloadHash is the sha256 of the canonical JSON", () => {
    expect(payloadHash({ b: 1, a: 2 })).toBe(sha256hex('{"a":2,"b":1}'));
  });
  it("eventHash covers exactly the 12-field preimage", () => {
    const direct = sha256hex(
      '{"actorType":"agent","aggregateId":"dec_1","aggregateType":"decision",' +
        '"eventType":"DecisionProposed","eventVersion":1,"id":"evt_1",' +
        '"occurredAt":"2026-06-08T00:00:00.000Z","payloadHash":"ph",' +
        '"previousEventHash":null,"schemaVersion":1,"workspaceId":"ws_1"}',
    );
    expect(eventHash(header)).toBe(direct);
  });
  it("eventHash ignores fields outside the preimage (e.g. recordedAt)", () => {
    const withExtra = { ...header } as EventHashHeader & { recordedAt: string };
    withExtra.recordedAt = "2026-01-01T00:00:00.000Z";
    expect(eventHash(withExtra)).toBe(eventHash(header));
  });
  it("eventHash changes when previousEventHash changes", () => {
    expect(eventHash({ ...header, previousEventHash: "abc" })).not.toBe(eventHash(header));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @traceguard/event-ledger exec vitest run src/hashing.test.ts`
Expected: FAIL — cannot find module `./hashing.js`.

- [ ] **Step 3: Implement hashing**

Create `packages/event-ledger/src/hashing.ts`:

```ts
import { createHash } from "node:crypto";
import type { AggregateType, ActorType } from "@traceguard/schemas";
import { canonicalJson } from "./canonical-json.js";

export function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** event-model §10.1 */
export function payloadHash(payload: unknown): string {
  return sha256hex(canonicalJson(payload));
}

/** The exact 12-field subset hashed by event-model §10.2. */
export interface EventHashHeader {
  id: string;
  workspaceId: string;
  aggregateType: AggregateType;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  schemaVersion: number;
  occurredAt: string;
  actorType: ActorType;
  actorId?: string;
  payloadHash: string;
  previousEventHash: string | null;
}

/** event-model §10.2 — canonicalJson sorts keys, so field order here is irrelevant. */
export function eventHash(h: EventHashHeader): string {
  return sha256hex(
    canonicalJson({
      id: h.id,
      workspaceId: h.workspaceId,
      aggregateType: h.aggregateType,
      aggregateId: h.aggregateId,
      eventType: h.eventType,
      eventVersion: h.eventVersion,
      schemaVersion: h.schemaVersion,
      occurredAt: h.occurredAt,
      actorType: h.actorType,
      actorId: h.actorId,
      payloadHash: h.payloadHash,
      previousEventHash: h.previousEventHash,
    }),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @traceguard/event-ledger exec vitest run src/hashing.test.ts`
Expected: PASS (5 assertions). The "abc" digest is the canonical SHA-256 test vector.

- [ ] **Step 5: Commit**

```bash
git add packages/event-ledger/src/hashing.ts packages/event-ledger/src/hashing.test.ts
git commit -m "feat(event-ledger): add sha256, payloadHash, and 12-field eventHash"
```

---

## Task 8: Injected `Clock`/`IdGen` + `makeEvent`

**Files:**
- Create: `packages/event-ledger/src/clock-id.ts`
- Create: `packages/event-ledger/src/make-event.ts`
- Test: `packages/event-ledger/src/make-event.test.ts`

- [ ] **Step 1: Implement the dependency interfaces (no test of their own)**

Create `packages/event-ledger/src/clock-id.ts`:

```ts
/** Injected nondeterminism. The core stays pure by depending on these, never on globals. */
export interface Clock {
  /** Returns an ISO-8601 UTC instant (e.g. "2026-06-08T00:00:00.000Z"). */
  now(): string;
}

export interface IdGen {
  /** Returns a prefixed id, e.g. next("evt") -> "evt_000001". */
  next(prefix: string): string;
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/event-ledger/src/make-event.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeEvent } from "./make-event.js";
import { eventHash, payloadHash } from "./hashing.js";
import type { Clock, IdGen } from "./clock-id.js";

const clock: Clock = { now: () => "2026-06-08T00:00:00.000Z" };
function idGen(): IdGen {
  let n = 0;
  return { next: (p) => `${p}_${String(++n).padStart(6, "0")}` };
}

const args = {
  workspaceId: "ws_1",
  aggregateType: "decision" as const,
  aggregateId: "dec_1",
  eventType: "DecisionProposed",
  eventVersion: 1,
  schemaVersion: 1,
  actorType: "agent" as const,
  runId: "run_1",
  payload: { hello: "world" },
  previousEventHash: null,
};

describe("makeEvent", () => {
  it("fills id, timestamps, hashes, and links", () => {
    const e = makeEvent(args, { clock, newId: idGen() });
    expect(e.id).toBe("evt_000001");
    expect(e.occurredAt).toBe("2026-06-08T00:00:00.000Z");
    expect(e.recordedAt).toBe("2026-06-08T00:00:00.000Z");
    expect(e.payloadHash).toBe(payloadHash(args.payload));
    expect(e.eventHash).toBe(
      eventHash({
        id: "evt_000001",
        workspaceId: "ws_1",
        aggregateType: "decision",
        aggregateId: "dec_1",
        eventType: "DecisionProposed",
        eventVersion: 1,
        schemaVersion: 1,
        occurredAt: "2026-06-08T00:00:00.000Z",
        actorType: "agent",
        payloadHash: payloadHash(args.payload),
        previousEventHash: null,
      }),
    );
  });
  it("omits previousEventHash on the first event", () => {
    const e = makeEvent(args, { clock, newId: idGen() });
    expect("previousEventHash" in e).toBe(false);
  });
  it("stores previousEventHash when linking", () => {
    const e = makeEvent({ ...args, previousEventHash: "prev" }, { clock, newId: idGen() });
    expect(e.previousEventHash).toBe("prev");
  });
  it("is deterministic under fixed deps", () => {
    const a = makeEvent(args, { clock, newId: idGen() });
    const b = makeEvent(args, { clock, newId: idGen() });
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @traceguard/event-ledger exec vitest run src/make-event.test.ts`
Expected: FAIL — cannot find module `./make-event.js`.

- [ ] **Step 4: Implement `makeEvent`**

Create `packages/event-ledger/src/make-event.ts`:

```ts
import type { AggregateType, ActorType, LedgerEvent } from "@traceguard/schemas";
import { eventHash, payloadHash } from "./hashing.js";
import type { Clock, IdGen } from "./clock-id.js";

export interface MakeEventArgs<T> {
  workspaceId: string;
  aggregateType: AggregateType;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  schemaVersion: number;
  actorType: ActorType;
  actorId?: string;
  runId?: string;
  payload: T;
  previousEventHash: string | null;
}

export function makeEvent<T>(
  args: MakeEventArgs<T>,
  deps: { clock: Clock; newId: IdGen },
): LedgerEvent<T> {
  const id = deps.newId.next("evt");
  const occurredAt = deps.clock.now();
  const ph = payloadHash(args.payload);
  const eh = eventHash({
    id,
    workspaceId: args.workspaceId,
    aggregateType: args.aggregateType,
    aggregateId: args.aggregateId,
    eventType: args.eventType,
    eventVersion: args.eventVersion,
    schemaVersion: args.schemaVersion,
    occurredAt,
    actorType: args.actorType,
    actorId: args.actorId,
    payloadHash: ph,
    previousEventHash: args.previousEventHash,
  });
  const event: LedgerEvent<T> = {
    id,
    workspaceId: args.workspaceId,
    aggregateType: args.aggregateType,
    aggregateId: args.aggregateId,
    eventType: args.eventType,
    eventVersion: args.eventVersion,
    schemaVersion: args.schemaVersion,
    occurredAt,
    recordedAt: occurredAt,
    actorType: args.actorType,
    payload: args.payload,
    payloadHash: ph,
    eventHash: eh,
  };
  if (args.actorId !== undefined) event.actorId = args.actorId;
  if (args.runId !== undefined) event.runId = args.runId;
  if (args.previousEventHash !== null) event.previousEventHash = args.previousEventHash;
  return event;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @traceguard/event-ledger exec vitest run src/make-event.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 6: Commit**

```bash
git add packages/event-ledger/src/clock-id.ts packages/event-ledger/src/make-event.ts packages/event-ledger/src/make-event.test.ts
git commit -m "feat(event-ledger): add injected clock/id and makeEvent"
```

---

## Task 9: `LedgerStore` port + `InMemoryLedgerStore` + chain verification

**Files:**
- Create: `packages/event-ledger/src/ledger-store.ts`
- Test: `packages/event-ledger/src/ledger-store.test.ts`

- [ ] **Step 1: Write the failing test (the reusable contract suite)**

Create `packages/event-ledger/src/ledger-store.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  InMemoryLedgerStore,
  LedgerConflictError,
  LedgerChainError,
  LedgerIntegrityError,
  verifyChain,
} from "./ledger-store.js";
import { makeEvent } from "./make-event.js";
import type { Clock, IdGen } from "./clock-id.js";

const clock: Clock = { now: () => "2026-06-08T00:00:00.000Z" };
function idGen(): IdGen {
  let n = 0;
  return { next: (p) => `${p}_${String(++n).padStart(6, "0")}` };
}

function chainOf(prev: string | null, count: number, newId: IdGen) {
  const events = [];
  let head = prev;
  for (let i = 0; i < count; i++) {
    const e = makeEvent(
      {
        workspaceId: "ws_1",
        aggregateType: "decision",
        aggregateId: "dec_1",
        eventType: "DecisionProposed",
        eventVersion: 1,
        schemaVersion: 1,
        actorType: "agent",
        runId: "run_1",
        payload: { i },
        previousEventHash: head,
      },
      { clock, newId },
    );
    events.push(e);
    head = e.eventHash;
  }
  return events;
}

describe("InMemoryLedgerStore", () => {
  it("starts empty (head null) and appends a linked batch", async () => {
    const store = new InMemoryLedgerStore();
    expect(await store.head("ws_1")).toBeNull();
    const events = chainOf(null, 2, idGen());
    await store.append(null, events);
    expect(await store.head("ws_1")).toBe(events[1]!.eventHash);
    expect(await store.read("ws_1")).toHaveLength(2);
  });

  it("rejects an append when expectedHead does not match (optimistic concurrency)", async () => {
    const store = new InMemoryLedgerStore();
    await store.append(null, chainOf(null, 1, idGen()));
    await expect(store.append(null, chainOf(null, 1, idGen()))).rejects.toBeInstanceOf(
      LedgerConflictError,
    );
  });

  it("rejects a broken intra-batch link", async () => {
    const store = new InMemoryLedgerStore();
    const events = chainOf(null, 2, idGen());
    const tampered = [events[0]!, { ...events[1]!, previousEventHash: "wrong" }];
    await expect(store.append(null, tampered)).rejects.toBeInstanceOf(LedgerChainError);
  });

  it("rejects an event whose eventHash was tampered", async () => {
    const store = new InMemoryLedgerStore();
    const [e] = chainOf(null, 1, idGen());
    await expect(
      store.append(null, [{ ...e!, eventHash: "deadbeef" }]),
    ).rejects.toBeInstanceOf(LedgerIntegrityError);
  });

  it("read filters by runId and isolates workspaces", async () => {
    const store = new InMemoryLedgerStore();
    await store.append(null, chainOf(null, 2, idGen()));
    expect(await store.read("ws_1", "run_1")).toHaveLength(2);
    expect(await store.read("ws_1", "run_other")).toHaveLength(0);
    expect(await store.read("ws_other")).toHaveLength(0);
  });

  it("verifyChain catches a tampered payload", async () => {
    const events = chainOf(null, 2, idGen());
    expect(() => verifyChain(events)).not.toThrow();
    const tampered = [events[0]!, { ...events[1]!, payload: { i: 999 } }];
    expect(() => verifyChain(tampered)).toThrow(LedgerIntegrityError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @traceguard/event-ledger exec vitest run src/ledger-store.test.ts`
Expected: FAIL — cannot find module `./ledger-store.js`.

- [ ] **Step 3: Implement the port, adapter, and verifier**

Create `packages/event-ledger/src/ledger-store.ts`:

```ts
import type { LedgerEvent } from "@traceguard/schemas";
import { eventHash, payloadHash } from "./hashing.js";

export class LedgerConflictError extends Error {
  constructor(
    readonly expectedHead: string | null,
    readonly actualHead: string | null,
  ) {
    super(`ledger head conflict: expected ${expectedHead}, actual ${actualHead}`);
    this.name = "LedgerConflictError";
  }
}
export class LedgerChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerChainError";
  }
}
export class LedgerIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerIntegrityError";
  }
}

export interface LedgerStore {
  /** Atomic, append-only. Rejects if expectedHead != current head, or a link/hash is bad. */
  append(expectedHead: string | null, events: LedgerEvent[]): Promise<void>;
  /** workspaceId is mandatory (workspace isolation). Optional runId narrows the stream. */
  read(workspaceId: string, runId?: string): Promise<LedgerEvent[]>;
  /** Latest eventHash for the workspace chain, or null if empty. */
  head(workspaceId: string): Promise<string | null>;
}

function recompute(e: LedgerEvent): string {
  return eventHash({
    id: e.id,
    workspaceId: e.workspaceId,
    aggregateType: e.aggregateType,
    aggregateId: e.aggregateId,
    eventType: e.eventType,
    eventVersion: e.eventVersion,
    schemaVersion: e.schemaVersion,
    occurredAt: e.occurredAt,
    actorType: e.actorType,
    actorId: e.actorId,
    payloadHash: e.payloadHash,
    previousEventHash: e.previousEventHash ?? null,
  });
}

/** Re-folds payload and event hashes and checks links. Throws on any tamper. */
export function verifyChain(events: LedgerEvent[], startHead: string | null = null): void {
  let prev = startHead;
  for (const e of events) {
    if (payloadHash(e.payload) !== e.payloadHash) {
      throw new LedgerIntegrityError(`payloadHash mismatch at ${e.id}`);
    }
    const ePrev = e.previousEventHash ?? null;
    if (ePrev !== prev) {
      throw new LedgerChainError(`broken link at ${e.id}: previousEventHash ${ePrev} != ${prev}`);
    }
    if (recompute(e) !== e.eventHash) {
      throw new LedgerIntegrityError(`eventHash mismatch at ${e.id}`);
    }
    prev = e.eventHash;
  }
}

export class InMemoryLedgerStore implements LedgerStore {
  private readonly byWorkspace = new Map<string, LedgerEvent[]>();

  async head(workspaceId: string): Promise<string | null> {
    const list = this.byWorkspace.get(workspaceId);
    if (list === undefined || list.length === 0) return null;
    return list[list.length - 1]!.eventHash;
  }

  async append(expectedHead: string | null, events: LedgerEvent[]): Promise<void> {
    if (events.length === 0) return;
    const workspaceId = events[0]!.workspaceId;
    for (const e of events) {
      if (e.workspaceId !== workspaceId) {
        throw new LedgerChainError("all events in a batch must share one workspaceId");
      }
    }
    const list = this.byWorkspace.get(workspaceId) ?? [];
    const currentHead = list.length === 0 ? null : list[list.length - 1]!.eventHash;
    if (currentHead !== expectedHead) {
      throw new LedgerConflictError(expectedHead, currentHead);
    }
    verifyChain(events, currentHead);
    this.byWorkspace.set(workspaceId, [...list, ...events]);
  }

  async read(workspaceId: string, runId?: string): Promise<LedgerEvent[]> {
    const list = this.byWorkspace.get(workspaceId) ?? [];
    const copy = [...list];
    return runId === undefined ? copy : copy.filter((e) => e.runId === runId);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @traceguard/event-ledger exec vitest run src/ledger-store.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/event-ledger/src/ledger-store.ts packages/event-ledger/src/ledger-store.test.ts
git commit -m "feat(event-ledger): add LedgerStore port, in-memory adapter, chain verify"
```

---

## Task 10: Run-status projection + barrel export (event-model §8.1)

**Files:**
- Create: `packages/event-ledger/src/run-status-projection.ts`, `packages/event-ledger/src/index.ts`
- Test: `packages/event-ledger/src/run-status-projection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/event-ledger/src/run-status-projection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runStatusProjection } from "./run-status-projection.js";
import type { LedgerEvent } from "@traceguard/schemas";

function ev(eventType: string, payload: unknown = {}): LedgerEvent {
  return {
    id: "evt",
    workspaceId: "ws_1",
    aggregateType: "decision",
    aggregateId: "dec_1",
    eventType,
    eventVersion: 1,
    schemaVersion: 1,
    occurredAt: "2026-06-08T00:00:00.000Z",
    recordedAt: "2026-06-08T00:00:00.000Z",
    actorType: "agent",
    payload,
    payloadHash: "ph",
    eventHash: "eh",
  };
}

describe("runStatusProjection", () => {
  it("defaults to created and ignores DecisionProposed", () => {
    expect(runStatusProjection([ev("DecisionProposed")])).toBe("created");
  });
  it("folds a full allow flow to allowed", () => {
    expect(
      runStatusProjection([
        ev("DecisionProposed"),
        ev("DecisionValidated"),
        ev("PolicyEvaluationStarted"),
        ev("PolicyEvaluated", { outcome: "allow" }),
      ]),
    ).toBe("allowed");
  });
  it("maps require_approval and block outcomes", () => {
    expect(runStatusProjection([ev("PolicyEvaluated", { outcome: "require_approval" })])).toBe(
      "approval_required",
    );
    expect(runStatusProjection([ev("PolicyEvaluated", { outcome: "block" })])).toBe("blocked");
  });
  it("leaves a rejected decision at created (never advances)", () => {
    expect(runStatusProjection([ev("DecisionProposed"), ev("DecisionRejected")])).toBe("created");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @traceguard/event-ledger exec vitest run src/run-status-projection.test.ts`
Expected: FAIL — cannot find module `./run-status-projection.js`.

- [ ] **Step 3: Implement the projection**

Create `packages/event-ledger/src/run-status-projection.ts`:

```ts
import type { LedgerEvent, RunStatus, PolicyEvaluatedPayload } from "@traceguard/schemas";

/**
 * Pure fold to RunStatus, event-model §8.1 (1A subset). Run-lifecycle events (RunCreated,
 * RunStarted) are out of scope in 1A; the fold starts at "created". DecisionProposed and
 * DecisionRejected have no run-status transition in §8.1, so they leave the status untouched.
 */
export function runStatusProjection(events: LedgerEvent[]): RunStatus {
  let status: RunStatus = "created";
  for (const e of events) {
    switch (e.eventType) {
      case "RunCreated":
        status = "created";
        break;
      case "RunStarted":
        status = "capturing";
        break;
      case "DecisionValidated":
        status = "decision_ready";
        break;
      case "PolicyEvaluationStarted":
        status = "policy_evaluating";
        break;
      case "PolicyEvaluated": {
        const outcome = (e.payload as PolicyEvaluatedPayload).outcome;
        status =
          outcome === "allow"
            ? "allowed"
            : outcome === "require_approval"
              ? "approval_required"
              : "blocked";
        break;
      }
      default:
        break;
    }
  }
  return status;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @traceguard/event-ledger exec vitest run src/run-status-projection.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Create the barrel export**

Create `packages/event-ledger/src/index.ts`:

```ts
export * from "./canonical-json.js";
export * from "./hashing.js";
export * from "./clock-id.js";
export * from "./make-event.js";
export * from "./ledger-store.js";
export * from "./run-status-projection.js";
```

- [ ] **Step 6: Typecheck the package**

Run: `pnpm --filter @traceguard/event-ledger exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/event-ledger/src
git commit -m "feat(event-ledger): add run-status projection and barrel export"
```

---

## Task 11: `policy-engine` scaffold + `EvaluationContext` + predicates + `evaluate`

**Files:**
- Modify: `packages/schemas/src/policy.ts`, `packages/schemas/src/policy.test.ts`
- Create: `packages/policy-engine/package.json`, `packages/policy-engine/tsconfig.json`
- Create: `packages/policy-engine/src/predicates.ts`, `packages/policy-engine/src/evaluate.ts`
- Test: `packages/policy-engine/src/predicates.test.ts`, `packages/policy-engine/src/evaluate.test.ts`

- [ ] **Step 1: Extend the schemas test with `EvaluationContext`**

Replace `packages/schemas/src/policy.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { Policy, Condition, EvaluationContext } from "./policy.js";

describe("Policy AST", () => {
  it("accepts a policy with a default-deny and one rule", () => {
    const p = Policy.parse({
      version: 1,
      defaultEffect: "block",
      rules: [
        {
          id: "r1",
          effect: "require_approval",
          conditions: [{ kind: "notional_gt", value: "200" }],
        },
      ],
    });
    expect(p.defaultEffect).toBe("block");
  });

  it("forces defaultEffect to be 'block' (default-deny)", () => {
    expect(() => Policy.parse({ version: 1, defaultEffect: "allow", rules: [] })).toThrow();
  });

  it("rejects an unknown condition kind", () => {
    expect(() => Condition.parse({ kind: "wat", value: "1" })).toThrow();
  });

  it("accepts the evaluation context needed by predicates and event payloads", () => {
    const ctx = EvaluationContext.parse({
      runId: "run_1",
      policyVersionId: "pv_1",
      evaluatorVersion: "policy-engine@1.0.0",
      workspaceMode: "approval_mode",
      manifestStatus: "active",
      snapshotAgeSeconds: 12,
      toolRiskClass: "trade",
      instrumentAllowlist: ["BTCUSDT"],
    });
    expect(ctx.policyVersionId).toBe("pv_1");
  });
});
```

- [ ] **Step 2: Run the schemas test to verify it fails**

Run: `pnpm --filter @traceguard/schemas exec vitest run src/policy.test.ts`
Expected: FAIL — `EvaluationContext` is not exported by `./policy.js`.

- [ ] **Step 3: Add `EvaluationContext` to the policy schema file**

Replace `packages/schemas/src/policy.ts` with:

```ts
import { z } from "zod";
import { DecimalString } from "./scalars.js";
import { DecisionAction, MarketType } from "./decision-envelope.js";
import { Effect } from "./event-payloads.js";

export const Condition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("action_in"), values: z.array(DecisionAction).min(1) }).strict(),
  z.object({ kind: z.literal("instrument_in"), values: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ kind: z.literal("market_type_in"), values: z.array(MarketType).min(1) }).strict(),
  z.object({ kind: z.literal("notional_gt"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("notional_lte"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("quantity_gt"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("leverage_gt"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("workspace_mode_eq"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("manifest_status_eq"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("snapshot_age_gt"), seconds: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("tool_risk_class_eq"), value: z.string().min(1) }).strict(),
]);
export type Condition = z.infer<typeof Condition>;

export const Rule = z
  .object({
    id: z.string().min(1),
    effect: Effect,
    conditions: z.array(Condition),
  })
  .strict();
export type Rule = z.infer<typeof Rule>;

export const Policy = z
  .object({
    version: z.number().int().nonnegative(),
    defaultEffect: z.literal("block"),
    rules: z.array(Rule),
  })
  .strict();
export type Policy = z.infer<typeof Policy>;

export const EvaluationContext = z
  .object({
    runId: z.string().min(1),
    policyVersionId: z.string().min(1),
    evaluatorVersion: z.string().min(1),
    workspaceMode: z.string().min(1),
    manifestStatus: z.string().min(1),
    snapshotAgeSeconds: z.number().int().nonnegative(),
    toolRiskClass: z.string().min(1),
    instrumentAllowlist: z.array(z.string().min(1)),
  })
  .strict();
export type EvaluationContext = z.infer<typeof EvaluationContext>;
```

- [ ] **Step 4: Run the schemas test to verify it passes**

Run: `pnpm --filter @traceguard/schemas exec vitest run src/policy.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Create the policy-engine package manifest**

Create `packages/policy-engine/package.json`:

```json
{
  "name": "@traceguard/policy-engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@traceguard/schemas": "workspace:*" }
}
```

- [ ] **Step 6: Create the policy-engine tsconfig**

Create `packages/policy-engine/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [{ "path": "../schemas" }]
}
```

- [ ] **Step 7: Link the workspace dependency**

Run: `pnpm install`
Expected: `@traceguard/schemas` symlinked into `packages/policy-engine/node_modules`; no errors.

- [ ] **Step 8: Write the failing predicate tests**

Create `packages/policy-engine/src/predicates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { compareDecimalStrings, evaluateCondition } from "./predicates.js";
import type { DecisionEnvelope, EvaluationContext } from "@traceguard/schemas";

const envelope: DecisionEnvelope = {
  id: "dec_1",
  instrument: "BTCUSDT",
  marketType: "futures",
  action: "open_long",
  thesis: "Momentum positive.",
  confidence: 0.7,
  evidenceRefs: ["ev_1"],
  requestedNotionalUsdt: "200.50",
  requestedQuantity: "0.10",
  requestedLeverage: "2",
};

const context: EvaluationContext = {
  runId: "run_1",
  policyVersionId: "pv_1",
  evaluatorVersion: "policy-engine@1.0.0",
  workspaceMode: "approval_mode",
  manifestStatus: "active",
  snapshotAgeSeconds: 30,
  toolRiskClass: "trade",
  instrumentAllowlist: ["BTCUSDT"],
};

describe("compareDecimalStrings", () => {
  it("compares decimal strings without floats", () => {
    expect(compareDecimalStrings("200.50", "200.5")).toBe(0);
    expect(compareDecimalStrings("200.5001", "200.5")).toBe(1);
    expect(compareDecimalStrings("-1.25", "0")).toBe(-1);
  });
});

describe("evaluateCondition", () => {
  it("matches action, instrument, and market conditions", () => {
    expect(evaluateCondition({ kind: "action_in", values: ["open_long"] }, envelope, context).matched).toBe(true);
    expect(evaluateCondition({ kind: "instrument_in", values: ["BTCUSDT"] }, envelope, context).matched).toBe(true);
    expect(evaluateCondition({ kind: "market_type_in", values: ["futures"] }, envelope, context).matched).toBe(true);
  });

  it("requires instrument to be present in both policy values and context allowlist", () => {
    const blockedContext = { ...context, instrumentAllowlist: [] };
    expect(evaluateCondition({ kind: "instrument_in", values: ["BTCUSDT"] }, envelope, blockedContext).matched).toBe(false);
  });

  it("matches decimal comparators", () => {
    expect(evaluateCondition({ kind: "notional_gt", value: "200.499" }, envelope, context).matched).toBe(true);
    expect(evaluateCondition({ kind: "notional_lte", value: "200.500" }, envelope, context).matched).toBe(true);
    expect(evaluateCondition({ kind: "quantity_gt", value: "0.09" }, envelope, context).matched).toBe(true);
    expect(evaluateCondition({ kind: "leverage_gt", value: "1.5" }, envelope, context).matched).toBe(true);
  });

  it("does not match numeric conditions when the envelope value is absent", () => {
    const { requestedNotionalUsdt, ...withoutNotional } = envelope;
    expect(evaluateCondition({ kind: "notional_gt", value: "1" }, withoutNotional, context).matched).toBe(false);
    expect(requestedNotionalUsdt).toBe("200.50");
  });

  it("matches context predicates", () => {
    expect(evaluateCondition({ kind: "workspace_mode_eq", value: "approval_mode" }, envelope, context).matched).toBe(true);
    expect(evaluateCondition({ kind: "manifest_status_eq", value: "active" }, envelope, context).matched).toBe(true);
    expect(evaluateCondition({ kind: "snapshot_age_gt", seconds: 10 }, envelope, context).matched).toBe(true);
    expect(evaluateCondition({ kind: "tool_risk_class_eq", value: "trade" }, envelope, context).matched).toBe(true);
  });
});
```

- [ ] **Step 9: Run the predicate tests to verify they fail**

Run: `pnpm --filter @traceguard/policy-engine exec vitest run src/predicates.test.ts`
Expected: FAIL — cannot find module `./predicates.js`.

- [ ] **Step 10: Implement predicate evaluation**

Create `packages/policy-engine/src/predicates.ts`:

```ts
import type { Condition, DecisionEnvelope, EvaluationContext } from "@traceguard/schemas";

export interface PredicateResult {
  matched: boolean;
  explanation: string;
  expected?: unknown;
  actual?: unknown;
}

function fractionLength(value: string): number {
  return (value.split(".")[1] ?? "").length;
}

function decimalToScaledBigInt(value: string, scale: number): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const parts = unsigned.split(".");
  const whole = parts[0] ?? "0";
  const fraction = parts[1] ?? "";
  const digits = `${whole}${fraction.padEnd(scale, "0")}`;
  const n = BigInt(digits);
  return negative ? -n : n;
}

export function compareDecimalStrings(a: string, b: string): -1 | 0 | 1 {
  const scale = Math.max(fractionLength(a), fractionLength(b));
  const left = decimalToScaledBigInt(a, scale);
  const right = decimalToScaledBigInt(b, scale);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function decimalPredicate(
  actual: string | undefined,
  expected: string,
  op: "gt" | "lte",
  explanation: string,
): PredicateResult {
  if (actual === undefined) return { matched: false, explanation, expected, actual: undefined };
  const cmp = compareDecimalStrings(actual, expected);
  return { matched: op === "gt" ? cmp > 0 : cmp <= 0, explanation, expected, actual };
}

export function evaluateCondition(
  condition: Condition,
  envelope: DecisionEnvelope,
  context: EvaluationContext,
): PredicateResult {
  switch (condition.kind) {
    case "action_in":
      return { matched: condition.values.includes(envelope.action), explanation: "action is in the configured set", expected: condition.values, actual: envelope.action };
    case "instrument_in": {
      const matched = condition.values.includes(envelope.instrument) && context.instrumentAllowlist.includes(envelope.instrument);
      return {
        matched,
        explanation: "instrument is in the policy set and workspace allowlist",
        expected: { policyValues: condition.values, instrumentAllowlist: context.instrumentAllowlist },
        actual: envelope.instrument,
      };
    }
    case "market_type_in":
      return { matched: condition.values.includes(envelope.marketType), explanation: "marketType is in the configured set", expected: condition.values, actual: envelope.marketType };
    case "notional_gt":
      return decimalPredicate(envelope.requestedNotionalUsdt, condition.value, "gt", "requestedNotionalUsdt is greater than the threshold");
    case "notional_lte":
      return decimalPredicate(envelope.requestedNotionalUsdt, condition.value, "lte", "requestedNotionalUsdt is less than or equal to the threshold");
    case "quantity_gt":
      return decimalPredicate(envelope.requestedQuantity, condition.value, "gt", "requestedQuantity is greater than the threshold");
    case "leverage_gt":
      return decimalPredicate(envelope.requestedLeverage, condition.value, "gt", "requestedLeverage is greater than the threshold");
    case "workspace_mode_eq":
      return { matched: context.workspaceMode === condition.value, explanation: "workspaceMode equals the required value", expected: condition.value, actual: context.workspaceMode };
    case "manifest_status_eq":
      return { matched: context.manifestStatus === condition.value, explanation: "manifestStatus equals the required value", expected: condition.value, actual: context.manifestStatus };
    case "snapshot_age_gt":
      return { matched: context.snapshotAgeSeconds > condition.seconds, explanation: "snapshotAgeSeconds is greater than the threshold", expected: condition.seconds, actual: context.snapshotAgeSeconds };
    case "tool_risk_class_eq":
      return { matched: context.toolRiskClass === condition.value, explanation: "toolRiskClass equals the required value", expected: condition.value, actual: context.toolRiskClass };
  }
}
```

- [ ] **Step 11: Run the predicate tests to verify they pass**

Run: `pnpm --filter @traceguard/policy-engine exec vitest run src/predicates.test.ts`
Expected: PASS (6 assertions groups across the two suites).

- [ ] **Step 12: Write the failing evaluation tests**

Create `packages/policy-engine/src/evaluate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { evaluate } from "./evaluate.js";
import type { DecisionEnvelope, EvaluationContext, Policy } from "@traceguard/schemas";

const envelope: DecisionEnvelope = {
  id: "dec_1",
  instrument: "BTCUSDT",
  marketType: "futures",
  action: "open_long",
  thesis: "Momentum positive.",
  evidenceRefs: ["ev_1"],
  requestedNotionalUsdt: "300",
  requestedLeverage: "2",
};

const context: EvaluationContext = {
  runId: "run_1",
  policyVersionId: "pv_1",
  evaluatorVersion: "policy-engine@1.0.0",
  workspaceMode: "approval_mode",
  manifestStatus: "active",
  snapshotAgeSeconds: 10,
  toolRiskClass: "trade",
  instrumentAllowlist: ["BTCUSDT"],
};

function policy(rules: Policy["rules"]): Policy {
  return { version: 1, defaultEffect: "block", rules };
}

describe("evaluate", () => {
  it("defaults to block when no rule matches", () => {
    expect(evaluate(envelope, policy([]), context)).toEqual({ outcome: "block", matchedRules: [] });
  });

  it("allows when only an allow rule matches", () => {
    const result = evaluate(
      envelope,
      policy([{ id: "allow-btc", effect: "allow", conditions: [{ kind: "instrument_in", values: ["BTCUSDT"] }] }]),
      context,
    );
    expect(result.outcome).toBe("allow");
    expect(result.matchedRules[0]).toMatchObject({ ruleId: "allow-btc", outcome: "allow" });
  });

  it("applies precedence block > require_approval > allow", () => {
    const result = evaluate(
      envelope,
      policy([
        { id: "allow-small", effect: "allow", conditions: [{ kind: "notional_lte", value: "500" }] },
        { id: "approval-large", effect: "require_approval", conditions: [{ kind: "notional_gt", value: "200" }] },
        { id: "block-stale", effect: "block", conditions: [{ kind: "snapshot_age_gt", seconds: 5 }] },
      ]),
      context,
    );
    expect(result.outcome).toBe("block");
    expect(result.matchedRules.map((r) => r.ruleId)).toEqual(["allow-small", "approval-large", "block-stale"]);
  });

  it("requires approval when require_approval and allow match but no block rule matches", () => {
    const result = evaluate(
      envelope,
      policy([
        { id: "allow-btc", effect: "allow", conditions: [{ kind: "instrument_in", values: ["BTCUSDT"] }] },
        { id: "approval-large", effect: "require_approval", conditions: [{ kind: "notional_gt", value: "200" }] },
      ]),
      context,
    );
    expect(result.outcome).toBe("require_approval");
  });

  it("property: any matched block rule forces block", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("allow" as const, "require_approval" as const), { maxLength: 8 }), (effects) => {
        const rules: Policy["rules"] = effects.map((effect, index) => ({
          id: `r${index}`,
          effect,
          conditions: [{ kind: "action_in", values: ["open_long"] }],
        }));
        rules.push({ id: "block-any-open-long", effect: "block", conditions: [{ kind: "action_in", values: ["open_long"] }] });
        expect(evaluate(envelope, policy(rules), context).outcome).toBe("block");
      }),
    );
  });
});
```

- [ ] **Step 13: Run the evaluation tests to verify they fail**

Run: `pnpm --filter @traceguard/policy-engine exec vitest run src/evaluate.test.ts`
Expected: FAIL — cannot find module `./evaluate.js`.

- [ ] **Step 14: Implement evaluation**

Create `packages/policy-engine/src/evaluate.ts`:

```ts
import type { DecisionEnvelope, Effect, EvaluationContext, MatchedRule, Policy, Rule } from "@traceguard/schemas";
import { evaluateCondition, type PredicateResult } from "./predicates.js";

export interface PolicyDecision {
  outcome: Effect;
  matchedRules: MatchedRule[];
}

function ruleToMatchedRule(rule: Rule, results: PredicateResult[]): MatchedRule {
  return {
    ruleId: rule.id,
    outcome: rule.effect,
    explanation: results.length === 0 ? "always" : results.map((r) => r.explanation).join(" AND "),
    expected: results.map((r) => r.expected ?? null),
    actual: results.map((r) => r.actual ?? null),
  };
}

function chooseOutcome(matchedRules: MatchedRule[], defaultEffect: Effect): Effect {
  if (matchedRules.some((r) => r.outcome === "block")) return "block";
  if (matchedRules.some((r) => r.outcome === "require_approval")) return "require_approval";
  if (matchedRules.some((r) => r.outcome === "allow")) return "allow";
  return defaultEffect;
}

export function evaluate(envelope: DecisionEnvelope, policy: Policy, context: EvaluationContext): PolicyDecision {
  const matchedRules: MatchedRule[] = [];

  for (const rule of policy.rules) {
    const results = rule.conditions.map((condition) => evaluateCondition(condition, envelope, context));
    if (results.every((result) => result.matched)) matchedRules.push(ruleToMatchedRule(rule, results));
  }

  return { outcome: chooseOutcome(matchedRules, policy.defaultEffect), matchedRules };
}
```

- [ ] **Step 15: Run policy-engine tests to verify they pass**

Run: `pnpm --filter @traceguard/policy-engine exec vitest run src/predicates.test.ts src/evaluate.test.ts`
Expected: PASS.

- [ ] **Step 16: Typecheck schemas and policy-engine**

Run: `pnpm --filter @traceguard/schemas exec tsc --noEmit -p tsconfig.json && pnpm --filter @traceguard/policy-engine exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 17: Commit**

```bash
git add packages/schemas/src/policy.ts packages/schemas/src/policy.test.ts packages/policy-engine
git commit -m "feat(policy-engine): add deterministic predicate evaluation"
```

---

## Task 12: `computeActionDigest` + policy-engine barrel export (policy-semantics §9.2)

**Files:**
- Create: `packages/policy-engine/src/action-digest.ts`, `packages/policy-engine/src/index.ts`
- Test: `packages/policy-engine/src/action-digest.test.ts`

- [ ] **Step 1: Write the failing action-digest tests**

Create `packages/policy-engine/src/action-digest.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { computeActionDigest } from "./action-digest.js";
import type { ActionDigestInput } from "@traceguard/schemas";

function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

const input: ActionDigestInput = {
  workspaceId: "ws_1",
  runId: "run_1",
  decisionId: "dec_1",
  providerConnectionId: "pc_1",
  toolName: "place_order",
  toolManifestHash: "tmh_1",
  policyVersionId: "pv_1",
  workspaceMode: "approval_mode",
  instrument: "BTCUSDT",
  marketType: "futures",
  action: "open_long",
  requestedNotionalUsdt: "300",
  requestedQuantity: "0.01",
  requestedLeverage: "2",
  orderType: "limit",
  limitPrice: "65000.50",
  stopLoss: "63000",
  takeProfit: "69000",
  marketSnapshotRef: "snap_1",
  executionAdapter: "simulator",
};

describe("computeActionDigest", () => {
  it("is stable under object key reordering", () => {
    const reordered: ActionDigestInput = {
      executionAdapter: input.executionAdapter,
      marketSnapshotRef: input.marketSnapshotRef,
      takeProfit: input.takeProfit,
      stopLoss: input.stopLoss,
      limitPrice: input.limitPrice,
      orderType: input.orderType,
      requestedLeverage: input.requestedLeverage,
      requestedQuantity: input.requestedQuantity,
      requestedNotionalUsdt: input.requestedNotionalUsdt,
      action: input.action,
      marketType: input.marketType,
      instrument: input.instrument,
      workspaceMode: input.workspaceMode,
      policyVersionId: input.policyVersionId,
      toolManifestHash: input.toolManifestHash,
      toolName: input.toolName,
      providerConnectionId: input.providerConnectionId,
      decisionId: input.decisionId,
      runId: input.runId,
      workspaceId: input.workspaceId,
    };
    expect(computeActionDigest(reordered, sha256hex)).toBe(computeActionDigest(input, sha256hex));
  });

  it("changes when a material field changes", () => {
    expect(computeActionDigest({ ...input, requestedNotionalUsdt: "301" }, sha256hex)).not.toBe(computeActionDigest(input, sha256hex));
    expect(computeActionDigest({ ...input, executionAdapter: "bitget_live" }, sha256hex)).not.toBe(computeActionDigest(input, sha256hex));
  });

  it("validates ActionDigestInput before hashing", () => {
    expect(() => computeActionDigest({ ...input, requestedNotionalUsdt: 300 } as unknown as ActionDigestInput, sha256hex)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @traceguard/policy-engine exec vitest run src/action-digest.test.ts`
Expected: FAIL — cannot find module `./action-digest.js`.

- [ ] **Step 3: Implement action digest**

Create `packages/policy-engine/src/action-digest.ts`:

```ts
import { ActionDigestInput, type ActionDigestInput as ActionDigestInputValue } from "@traceguard/schemas";

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite numbers are not allowed");
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v === undefined) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function computeActionDigest(input: ActionDigestInputValue, hash: (s: string) => string): string {
  return hash(canonicalJson(ActionDigestInput.parse(input)));
}
```

- [ ] **Step 4: Run the action-digest test to verify it passes**

Run: `pnpm --filter @traceguard/policy-engine exec vitest run src/action-digest.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Create the policy-engine barrel export**

Create `packages/policy-engine/src/index.ts`:

```ts
export * from "./predicates.js";
export * from "./evaluate.js";
export * from "./action-digest.js";
```

- [ ] **Step 6: Run all policy-engine tests and typecheck**

Run: `pnpm --filter @traceguard/policy-engine exec vitest run src && pnpm --filter @traceguard/policy-engine exec tsc --noEmit -p tsconfig.json`
Expected: all tests pass; no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/policy-engine/src/action-digest.ts packages/policy-engine/src/action-digest.test.ts packages/policy-engine/src/index.ts
git commit -m "feat(policy-engine): add action digest and public exports"
```

---

## Task 13: `testing-fixtures` package

**Files:**
- Create: `packages/testing-fixtures/package.json`, `packages/testing-fixtures/tsconfig.json`
- Create: `packages/testing-fixtures/src/deps.ts`, `packages/testing-fixtures/src/samples.ts`, `packages/testing-fixtures/src/index.ts`
- Test: `packages/testing-fixtures/src/samples.test.ts`

- [ ] **Step 1: Create the package manifest**

Create `packages/testing-fixtures/package.json`:

```json
{
  "name": "@traceguard/testing-fixtures",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@traceguard/schemas": "workspace:*" }
}
```

- [ ] **Step 2: Create the package tsconfig**

Create `packages/testing-fixtures/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [{ "path": "../schemas" }]
}
```

- [ ] **Step 3: Link the workspace dependency**

Run: `pnpm install`
Expected: `@traceguard/schemas` symlinked into `packages/testing-fixtures/node_modules`; no errors.

- [ ] **Step 4: Write the failing fixtures test**

Create `packages/testing-fixtures/src/samples.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DecisionEnvelope, EvaluationContext, Policy } from "@traceguard/schemas";
import { fixedClock, sequentialIdGen } from "./deps.js";
import {
  allowDecisionEnvelope,
  allowPolicy,
  approvalPolicy,
  blockPolicy,
  missingEvidenceEnvelope,
  sampleEvaluationContext,
  sampleRunId,
  sampleWorkspaceId,
} from "./samples.js";

describe("testing fixtures", () => {
  it("provides deterministic clock and id doubles", () => {
    const clock = fixedClock();
    const ids = sequentialIdGen();
    expect(clock.now()).toBe("2026-06-08T00:00:00.000Z");
    expect(ids.next("evt")).toBe("evt_000001");
    expect(ids.next("eval")).toBe("eval_000002");
  });

  it("provides schema-valid sample envelopes and policies", () => {
    expect(DecisionEnvelope.parse(allowDecisionEnvelope).id).toBe("dec_allow");
    expect(DecisionEnvelope.parse(missingEvidenceEnvelope).evidenceRefs).toEqual([]);
    expect(Policy.parse(allowPolicy).rules[0]!.effect).toBe("allow");
    expect(Policy.parse(approvalPolicy).rules[0]!.effect).toBe("require_approval");
    expect(Policy.parse(blockPolicy).rules[0]!.effect).toBe("block");
  });

  it("provides a schema-valid evaluation context and stable ids", () => {
    expect(sampleWorkspaceId).toBe("ws_1");
    expect(sampleRunId).toBe("run_1");
    expect(EvaluationContext.parse(sampleEvaluationContext).runId).toBe(sampleRunId);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @traceguard/testing-fixtures exec vitest run src/samples.test.ts`
Expected: FAIL — cannot find modules `./deps.js` and `./samples.js`.

- [ ] **Step 6: Implement deterministic dependency doubles**

Create `packages/testing-fixtures/src/deps.ts`:

```ts
export function fixedClock(instant = "2026-06-08T00:00:00.000Z") {
  return { now: () => instant };
}

export function sequentialIdGen() {
  let n = 0;
  return { next: (prefix: string) => `${prefix}_${String(++n).padStart(6, "0")}` };
}
```

- [ ] **Step 7: Implement sample envelopes, policies, context, and ids**

Create `packages/testing-fixtures/src/samples.ts`:

```ts
import type { DecisionEnvelope, EvaluationContext, Policy } from "@traceguard/schemas";

export const sampleWorkspaceId = "ws_1";
export const sampleRunId = "run_1";
export const sampleActorId = "agent_1";

const baseEnvelope = {
  instrument: "BTCUSDT",
  marketType: "futures",
  action: "open_long",
  thesis: "Momentum positive with controlled risk.",
  evidenceRefs: ["ev_1"],
  requestedLeverage: "2",
} satisfies Omit<DecisionEnvelope, "id" | "requestedNotionalUsdt">;

export const allowDecisionEnvelope: DecisionEnvelope = {
  ...baseEnvelope,
  id: "dec_allow",
  requestedNotionalUsdt: "100",
};

export const approvalDecisionEnvelope: DecisionEnvelope = {
  ...baseEnvelope,
  id: "dec_approval",
  requestedNotionalUsdt: "300",
};

export const blockDecisionEnvelope: DecisionEnvelope = {
  ...baseEnvelope,
  id: "dec_block",
  requestedNotionalUsdt: "300",
  requestedLeverage: "5",
};

export const missingEvidenceEnvelope: DecisionEnvelope = {
  ...allowDecisionEnvelope,
  id: "dec_rejected",
  evidenceRefs: [],
};

export const sampleEvaluationContext: EvaluationContext = {
  runId: sampleRunId,
  policyVersionId: "pv_1",
  evaluatorVersion: "policy-engine@1.0.0",
  workspaceMode: "approval_mode",
  manifestStatus: "active",
  snapshotAgeSeconds: 10,
  toolRiskClass: "trade",
  instrumentAllowlist: ["BTCUSDT"],
};

export const allowPolicy: Policy = {
  version: 1,
  defaultEffect: "block",
  rules: [
    {
      id: "allow-small-btc-futures",
      effect: "allow",
      conditions: [
        { kind: "action_in", values: ["open_long"] },
        { kind: "instrument_in", values: ["BTCUSDT"] },
        { kind: "market_type_in", values: ["futures"] },
        { kind: "notional_lte", value: "200" },
      ],
    },
  ],
};

export const approvalPolicy: Policy = {
  version: 1,
  defaultEffect: "block",
  rules: [
    {
      id: "approval-large-notional",
      effect: "require_approval",
      conditions: [{ kind: "notional_gt", value: "200" }],
    },
    {
      id: "allow-btc-futures",
      effect: "allow",
      conditions: [
        { kind: "action_in", values: ["open_long"] },
        { kind: "instrument_in", values: ["BTCUSDT"] },
        { kind: "market_type_in", values: ["futures"] },
      ],
    },
  ],
};

export const blockPolicy: Policy = {
  version: 1,
  defaultEffect: "block",
  rules: [
    {
      id: "block-high-leverage",
      effect: "block",
      conditions: [{ kind: "leverage_gt", value: "3" }],
    },
    {
      id: "approval-large-notional",
      effect: "require_approval",
      conditions: [{ kind: "notional_gt", value: "200" }],
    },
    {
      id: "allow-btc-futures",
      effect: "allow",
      conditions: [{ kind: "instrument_in", values: ["BTCUSDT"] }],
    },
  ],
};

export const defaultBlockPolicy: Policy = { version: 1, defaultEffect: "block", rules: [] };
```

- [ ] **Step 8: Create the fixtures barrel export**

Create `packages/testing-fixtures/src/index.ts`:

```ts
export * from "./deps.js";
export * from "./samples.js";
```

- [ ] **Step 9: Run tests and typecheck**

Run: `pnpm --filter @traceguard/testing-fixtures exec vitest run src/samples.test.ts && pnpm --filter @traceguard/testing-fixtures exec tsc --noEmit -p tsconfig.json`
Expected: PASS; no type errors.

- [ ] **Step 10: Commit**

```bash
git add packages/testing-fixtures
git commit -m "test(fixtures): add deterministic samples and dependency doubles"
```

---

## Task 14: `domain` package + `proposeDecision` pipeline

**Files:**
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`
- Create: `packages/domain/src/propose-decision.ts`, `packages/domain/src/index.ts`
- Test: `packages/domain/src/propose-decision.test.ts`

**Implementation notes:**
- `proposeDecision` accepts `envelope: unknown` at the boundary so schema-invalid input can be rejected instead of being impossible to pass in TypeScript.
- `previousEventHash` is an explicit optional argument because the first emitted event must link to the current ledger head; use `null` for an empty ledger.
- If the raw input cannot be parsed into the canonical `DecisionEnvelope`, emit only `DecisionRejected`; a canonical `DecisionProposedPayload` cannot be constructed from non-canonical fields. Semantic validation failures (for example, missing evidence) emit `DecisionProposed` followed by `DecisionRejected` and then stop.

- [ ] **Step 1: Create the package manifest**

Create `packages/domain/package.json`:

```json
{
  "name": "@traceguard/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@traceguard/event-ledger": "workspace:*",
    "@traceguard/policy-engine": "workspace:*",
    "@traceguard/schemas": "workspace:*"
  },
  "devDependencies": { "@traceguard/testing-fixtures": "workspace:*" }
}
```

- [ ] **Step 2: Create the package tsconfig**

Create `packages/domain/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [
    { "path": "../schemas" },
    { "path": "../event-ledger" },
    { "path": "../policy-engine" },
    { "path": "../testing-fixtures" }
  ]
}
```

- [ ] **Step 3: Link workspace dependencies**

Run: `pnpm install`
Expected: all domain workspace dependencies symlinked; no errors.

- [ ] **Step 4: Write the failing domain tests**

Create `packages/domain/src/propose-decision.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sha256hex, verifyChain } from "@traceguard/event-ledger";
import {
  allowDecisionEnvelope,
  allowPolicy,
  fixedClock,
  missingEvidenceEnvelope,
  sampleActorId,
  sampleEvaluationContext,
  sampleWorkspaceId,
  sequentialIdGen,
} from "@traceguard/testing-fixtures";
import { proposeDecision } from "./propose-decision.js";

function deps() {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

describe("proposeDecision", () => {
  it("emits a deterministic allow event sequence", () => {
    const args = {
      workspaceId: sampleWorkspaceId,
      actorId: sampleActorId,
      envelope: allowDecisionEnvelope,
      policy: allowPolicy,
      context: sampleEvaluationContext,
      previousEventHash: null,
    };
    const a = proposeDecision(args, deps());
    const b = proposeDecision(args, deps());

    expect(a).toEqual(b);
    expect(a.decision.outcome).toBe("allow");
    expect(a.events.map((e) => e.eventType)).toEqual([
      "DecisionProposed",
      "DecisionValidated",
      "PolicyEvaluationStarted",
      "PolicyEvaluated",
    ]);
    expect(a.events[0]!.previousEventHash).toBeUndefined();
    expect(a.events[1]!.previousEventHash).toBe(a.events[0]!.eventHash);
    expect(a.events[3]!.payload).toMatchObject({ outcome: "allow" });
    expect(() => verifyChain(a.events)).not.toThrow();
  });

  it("rejects missing evidence and stops before policy evaluation", () => {
    const result = proposeDecision(
      {
        workspaceId: sampleWorkspaceId,
        actorId: sampleActorId,
        envelope: missingEvidenceEnvelope,
        policy: allowPolicy,
        context: sampleEvaluationContext,
        previousEventHash: null,
      },
      deps(),
    );

    expect(result.decision).toEqual({ outcome: "block", matchedRules: [] });
    expect(result.events.map((e) => e.eventType)).toEqual(["DecisionProposed", "DecisionRejected"]);
    expect(result.events[1]!.payload).toMatchObject({ reasonCode: "missing_evidence" });
    expect(() => verifyChain(result.events)).not.toThrow();
  });

  it("emits only DecisionRejected when the raw input is not a canonical DecisionEnvelope", () => {
    const result = proposeDecision(
      {
        workspaceId: sampleWorkspaceId,
        actorId: sampleActorId,
        envelope: { ...allowDecisionEnvelope, requestedNotionalUsdt: 300 },
        policy: allowPolicy,
        context: sampleEvaluationContext,
        previousEventHash: null,
      },
      deps(),
    );

    expect(result.decision.outcome).toBe("block");
    expect(result.events.map((e) => e.eventType)).toEqual(["DecisionRejected"]);
    expect(result.events[0]!.payload).toMatchObject({ reasonCode: "numeric_parse_error" });
    expect(() => verifyChain(result.events)).not.toThrow();
  });
});
```

- [ ] **Step 5: Run the domain test to verify it fails**

Run: `pnpm --filter @traceguard/domain exec vitest run src/propose-decision.test.ts`
Expected: FAIL — cannot find module `./propose-decision.js`.

- [ ] **Step 6: Implement `proposeDecision`**

Create `packages/domain/src/propose-decision.ts`:

```ts
import {
  DecisionEnvelope,
  DecisionProposedPayload,
  DecisionRejectedPayload,
  DecisionValidatedPayload,
  PolicyEvaluatedPayload,
  PolicyEvaluationStartedPayload,
  type DecisionEnvelope as DecisionEnvelopeValue,
  type DecisionRejectedPayload as DecisionRejectedPayloadValue,
  type EvaluationContext,
  type LedgerEvent,
  type Policy,
} from "@traceguard/schemas";
import { canonicalJson, makeEvent, type Clock, type IdGen } from "@traceguard/event-ledger";
import { evaluate, type PolicyDecision } from "@traceguard/policy-engine";

interface ParseIssue {
  path: Array<string | number>;
  message: string;
  code: string;
  received?: unknown;
}

export interface ProposeDecisionArgs {
  workspaceId: string;
  actorId?: string;
  envelope: unknown;
  policy: Policy;
  context: EvaluationContext;
  previousEventHash?: string | null;
}

export interface ProposeDecisionDeps {
  clock: Clock;
  newId: IdGen;
  hash: (s: string) => string;
}

export interface ProposeDecisionResult {
  decision: PolicyDecision;
  events: LedgerEvent[];
}

function failClosedDecision(): PolicyDecision {
  return { outcome: "block", matchedRules: [] };
}

function rawDecisionId(envelope: unknown): string | undefined {
  if (typeof envelope !== "object" || envelope === null) return undefined;
  const id = (envelope as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}

function reasonFromIssues(issues: readonly ParseIssue[]): DecisionRejectedPayloadValue["reasonCode"] {
  if (issues.some((issue) => issue.path[0] === "action")) return "unsupported_action";
  if (issues.some((issue) => issue.path[0] === "requestedNotionalUsdt" || issue.path[0] === "requestedQuantity" || issue.path[0] === "requestedLeverage" || issue.path[0] === "limitPrice" || issue.path[0] === "stopLoss" || issue.path[0] === "takeProfit")) return "numeric_parse_error";
  if (issues.some((issue) => issue.code === "invalid_type" && issue.received === "undefined")) return "missing_required_field";
  return "schema_invalid";
}

function materialDecision(envelope: DecisionEnvelopeValue): Omit<DecisionEnvelopeValue, "confidence"> {
  const { confidence, ...material } = envelope;
  return material;
}

function proposedPayload(envelope: DecisionEnvelopeValue, runId: string, decisionHash: string): DecisionProposedPayload {
  return DecisionProposedPayload.parse({
    decisionId: envelope.id,
    runId,
    envelopeVersion: 1,
    instrument: envelope.instrument,
    marketType: envelope.marketType,
    action: envelope.action,
    thesis: envelope.thesis,
    confidence: envelope.confidence,
    evidenceRefs: envelope.evidenceRefs,
    requestedNotionalUsdt: envelope.requestedNotionalUsdt,
    requestedQuantity: envelope.requestedQuantity,
    requestedLeverage: envelope.requestedLeverage,
    orderType: envelope.orderType,
    limitPrice: envelope.limitPrice,
    stopLoss: envelope.stopLoss,
    takeProfit: envelope.takeProfit,
    promptVersion: envelope.promptVersion,
    modelProvider: envelope.modelProvider,
    modelName: envelope.modelName,
    decisionHash,
  });
}

function rejectionPayload(
  runId: string,
  decisionId: string | undefined,
  reasonCode: DecisionRejectedPayloadValue["reasonCode"],
  validationErrors: DecisionRejectedPayloadValue["validationErrors"],
): DecisionRejectedPayload {
  return DecisionRejectedPayload.parse({ decisionId, runId, reasonCode, validationErrors });
}

export function proposeDecision(args: ProposeDecisionArgs, deps: ProposeDecisionDeps): ProposeDecisionResult {
  const events: LedgerEvent[] = [];
  const parsed = DecisionEnvelope.safeParse(args.envelope);
  const decisionId = parsed.success ? parsed.data.id : rawDecisionId(args.envelope);
  const aggregateId = decisionId ?? args.context.runId;
  let previousEventHash = args.previousEventHash ?? null;

  function emit<T>(eventType: string, actorType: "agent" | "system", payload: T): void {
    const event = makeEvent(
      {
        workspaceId: args.workspaceId,
        aggregateType: "decision",
        aggregateId,
        eventType,
        eventVersion: 1,
        schemaVersion: 1,
        actorType,
        actorId: args.actorId,
        runId: args.context.runId,
        payload,
        previousEventHash,
      },
      { clock: deps.clock, newId: deps.newId },
    );
    events.push(event);
    previousEventHash = event.eventHash;
  }

  if (!parsed.success) {
    emit(
      "DecisionRejected",
      "system",
      rejectionPayload(
        args.context.runId,
        decisionId,
        reasonFromIssues(parsed.error.issues),
        parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      ),
    );
    return { decision: failClosedDecision(), events };
  }

  const envelope = parsed.data;
  const material = materialDecision(envelope);
  const decisionHash = deps.hash(canonicalJson(material));
  emit("DecisionProposed", "agent", proposedPayload(envelope, args.context.runId, decisionHash));

  if (envelope.evidenceRefs.length === 0) {
    emit(
      "DecisionRejected",
      "system",
      rejectionPayload(args.context.runId, envelope.id, "missing_evidence", [
        { path: "evidenceRefs", message: "must contain at least one evidence reference" },
      ]),
    );
    return { decision: failClosedDecision(), events };
  }

  emit(
    "DecisionValidated",
    "system",
    DecisionValidatedPayload.parse({
      decisionId: envelope.id,
      runId: args.context.runId,
      validationResult: "valid",
      normalizedDecisionRef: `normalized:${envelope.id}`,
      normalizedDecisionHash: deps.hash(canonicalJson(material)),
    }),
  );

  const evaluationId = deps.newId.next("eval");
  const evaluationInputHash = deps.hash(canonicalJson({ decision: material, policy: args.policy, context: args.context }));
  emit(
    "PolicyEvaluationStarted",
    "system",
    PolicyEvaluationStartedPayload.parse({
      evaluationId,
      runId: args.context.runId,
      decisionId: envelope.id,
      policyVersionId: args.context.policyVersionId,
      evaluatorVersion: args.context.evaluatorVersion,
      evaluationInputHash,
    }),
  );

  const decision = evaluate(envelope, args.policy, args.context);
  emit(
    "PolicyEvaluated",
    "system",
    PolicyEvaluatedPayload.parse({
      evaluationId,
      runId: args.context.runId,
      decisionId: envelope.id,
      policyVersionId: args.context.policyVersionId,
      evaluatorVersion: args.context.evaluatorVersion,
      outcome: decision.outcome,
      matchedRules: decision.matchedRules,
      evaluationOutputHash: deps.hash(canonicalJson(decision)),
    }),
  );

  return { decision, events };
}
```

- [ ] **Step 7: Create the domain barrel export**

Create `packages/domain/src/index.ts`:

```ts
export * from "./propose-decision.js";
```

- [ ] **Step 8: Run domain tests and typecheck**

Run: `pnpm --filter @traceguard/domain exec vitest run src/propose-decision.test.ts && pnpm --filter @traceguard/domain exec tsc --noEmit -p tsconfig.json`
Expected: PASS; no type errors.

- [ ] **Step 9: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): add deterministic proposeDecision pipeline"
```

---

## Task 15: Phase 1A acceptance test — end-to-end ledger + projection

**Files:**
- Create: `packages/domain/src/acceptance.test.ts`

- [ ] **Step 1: Write the failing acceptance test**

Create `packages/domain/src/acceptance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { InMemoryLedgerStore, runStatusProjection, sha256hex, verifyChain } from "@traceguard/event-ledger";
import type { DecisionEnvelope, Policy, RunStatus } from "@traceguard/schemas";
import {
  allowDecisionEnvelope,
  allowPolicy,
  approvalDecisionEnvelope,
  approvalPolicy,
  blockDecisionEnvelope,
  blockPolicy,
  fixedClock,
  missingEvidenceEnvelope,
  sampleActorId,
  sampleEvaluationContext,
  sampleWorkspaceId,
  sequentialIdGen,
} from "@traceguard/testing-fixtures";
import { proposeDecision } from "./propose-decision.js";

async function runScenario(envelope: DecisionEnvelope, policy: Policy) {
  const store = new InMemoryLedgerStore();
  const expectedHead = await store.head(sampleWorkspaceId);
  const result = proposeDecision(
    {
      workspaceId: sampleWorkspaceId,
      actorId: sampleActorId,
      envelope,
      policy,
      context: sampleEvaluationContext,
      previousEventHash: expectedHead,
    },
    { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex },
  );
  await store.append(expectedHead, result.events);
  const events = await store.read(sampleWorkspaceId, sampleEvaluationContext.runId);
  verifyChain(events);
  return { result, events, status: runStatusProjection(events) };
}

describe("Phase 1A acceptance", () => {
  it("classifies allow / require_approval / block / rejected and records hash-chained events", async () => {
    const allow = await runScenario(allowDecisionEnvelope, allowPolicy);
    expect(allow.result.decision.outcome).toBe("allow");
    expect(allow.status satisfies RunStatus).toBe("allowed");
    expect(allow.events.map((e) => e.eventType)).toEqual([
      "DecisionProposed",
      "DecisionValidated",
      "PolicyEvaluationStarted",
      "PolicyEvaluated",
    ]);

    const approval = await runScenario(approvalDecisionEnvelope, approvalPolicy);
    expect(approval.result.decision.outcome).toBe("require_approval");
    expect(approval.status satisfies RunStatus).toBe("approval_required");

    const block = await runScenario(blockDecisionEnvelope, blockPolicy);
    expect(block.result.decision.outcome).toBe("block");
    expect(block.status satisfies RunStatus).toBe("blocked");

    const rejected = await runScenario(missingEvidenceEnvelope, allowPolicy);
    expect(rejected.result.decision.outcome).toBe("block");
    expect(rejected.status satisfies RunStatus).toBe("created");
    expect(rejected.events.map((e) => e.eventType)).toEqual(["DecisionProposed", "DecisionRejected"]);
  });
});
```

- [ ] **Step 2: Run the acceptance test to verify it passes after Task 14 exists**

Run: `pnpm --filter @traceguard/domain exec vitest run src/acceptance.test.ts`
Expected: PASS. This confirms the Phase 1 exit criterion for the 1A slice: proposed actions are validated, policy-evaluated into allow / require_approval / block, rejected invalid proposals fail closed, events are append-only/hash-chained, and replay via `runStatusProjection` yields the expected states.

- [ ] **Step 3: Run the full workspace verification**

Run: `pnpm -r exec tsc --noEmit && pnpm test`
Expected: no type errors; all Vitest suites pass.

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/acceptance.test.ts
git commit -m "test(domain): add Phase 1A acceptance coverage"
```

---

## Plan self-review results

**Spec coverage:** Tasks 0–5 define strict schemas and event payloads; Tasks 6–10 implement canonical JSON, hashing, append-only ledger behavior, and projection/replay; Tasks 11–12 implement deterministic policy evaluation and action digest; Tasks 13–15 cover deterministic fixtures, the pure domain pipeline, and the Phase 1A exit criterion.

**Placeholder scan:** No unresolved placeholders remain; every code-changing step includes concrete file content, commands, expected outcomes, and commit boundaries.

**Type consistency:** `EvaluationContext`, `PolicyDecision`, `DecisionEnvelope`, `Policy`, `LedgerEvent`, `Clock`, and `IdGen` names are used consistently across packages. The two implementation refinements relative to the spec signature are explicit in Task 14: `envelope: unknown` at the validation boundary, and `previousEventHash` as the ledger-head link input.
