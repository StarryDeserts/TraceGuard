# TraceGuard Phase 1B — Approval & Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a policy outcome into a human-approved or auto-issued single-use execution authorization, recorded as immutable hash-chained events, plus a pure guard that refuses any reused/expired/mismatched/missing authorization.

**Architecture:** Functional core / imperative shell, identical to Phase 1A. Every domain function is pure — `(args, deps) → { events, outcome }` with `deps = { clock, newId, hash }` injected for byte-reproducibility; the shell appends events to the `LedgerStore`. The single-use guard is pure and dependency-free (`now` is an input). No new package; 1B extends the existing five.

**Tech Stack:** TypeScript (strict, ESM, NodeNext), pnpm workspace, Vitest 4.1.x (`vitest run`), fast-check 3.22.x, Zod, Node `crypto` (SHA-256). Node >= 22.12.0.

**Spec:** `docs/superpowers/specs/2026-06-09-traceguard-phase1b-approval-authorization-design.md` (approved). Where this plan and the spec disagree, the spec wins.

**Commands (run from repo root):**
- Single test file: `pnpm exec vitest run <path>`
- Whole suite: `pnpm test`
- Typecheck all packages: `pnpm typecheck`
- Build all packages: `pnpm build`

---

## File Structure

**`packages/schemas/src/`**
- Create `approval-payloads.ts` — `ApprovalChannel`, `ApprovalStatus`, and the four approval payloads (`ApprovalRequested/Approved/Rejected/Expired`).
- Create `authorization-payloads.ts` — `AuthorizationRejectionReason` and the three authorization payloads (`AuthorizationIssued/Consumed/Rejected`).
- Modify `index.ts` — re-export both new modules.
- Create `approval-payloads.test.ts`, `authorization-payloads.test.ts`.

**`packages/policy-engine/src/`**
- Create `authorization-guard.ts` — `evaluateAuthorizationUse` (pure, total, dependency-free).
- Modify `index.ts` — re-export it.
- Create `authorization-guard.test.ts` — unit (one case per reason + precedence) and fast-check property tests.

**`packages/event-ledger/src/`**
- Modify `run-status-projection.ts` — add `ApprovalRequested` / `ApprovalApproved` → `approval_required`.
- Modify `run-status-projection.test.ts` — new cases + "unchanged by issue/reject/expire".
- Create `approval-projection.ts` — `ApprovalProjection` type + `approvalProjection` fold.
- Modify `index.ts` — re-export it.
- Create `approval-projection.test.ts`.

**`packages/testing-fixtures/src/`**
- Create `approval-samples.ts` — deterministic approval/authorization fixtures.
- Modify `index.ts` — re-export it.

**`packages/domain/src/`**
- Create `authorization-gateway.ts` — `resolveAuthorizationGateway` + shared `ApprovalTransitionDeps` / `ApprovalTransitionResult` / `ApprovalOutcome` types.
- Create `approval-transitions.ts` — `approveApproval`, `rejectApproval`, `expireApproval`.
- Modify `index.ts` — re-export both.
- Create `authorization-gateway.test.ts`, `approval-transitions.test.ts`, `acceptance-phase1b.test.ts`.

**Build order (dependency-respecting):** schemas → policy-engine → event-ledger → testing-fixtures → domain.

---

## Task 1: Schemas — approval payloads

**Files:**
- Create: `packages/schemas/src/approval-payloads.ts`
- Test: `packages/schemas/src/approval-payloads.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/approval-payloads.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ApprovalChannel,
  ApprovalStatus,
  ApprovalRequestedPayload,
  ApprovalApprovedPayload,
  ApprovalRejectedPayload,
  ApprovalExpiredPayload,
} from "./approval-payloads.js";

describe("approval payloads", () => {
  it("ApprovalChannel and ApprovalStatus enumerate the canonical members", () => {
    expect(ApprovalChannel.options).toEqual(["web", "telegram", "mcp_app"]);
    expect(ApprovalStatus.options).toEqual(["pending", "approved", "consumed", "rejected", "expired", "revoked"]);
  });

  it("ApprovalRequestedPayload requires a nested summary pinned to require_approval", () => {
    const p = ApprovalRequestedPayload.parse({
      approvalId: "appr_1",
      runId: "run_1",
      decisionId: "dec_1",
      policyEvaluationId: "eval_1",
      actionDigest: "digest_1",
      channelOptions: ["web", "telegram"],
      expiresAt: "2026-06-08T00:05:00.000Z",
      summary: {
        instrument: "BTCUSDT",
        action: "open_long",
        notionalUsdt: "300",
        leverage: "2",
        policyOutcome: "require_approval",
      },
    });
    expect(p.summary.policyOutcome).toBe("require_approval");
    expect(() =>
      ApprovalRequestedPayload.parse({
        approvalId: "appr_1",
        runId: "run_1",
        decisionId: "dec_1",
        policyEvaluationId: "eval_1",
        actionDigest: "digest_1",
        channelOptions: ["web"],
        expiresAt: "2026-06-08T00:05:00.000Z",
        summary: { instrument: "BTCUSDT", action: "open_long", policyOutcome: "allow" },
      }),
    ).toThrow();
  });

  it("ApprovalRequestedPayload rejects unknown keys (strict)", () => {
    expect(() =>
      ApprovalRequestedPayload.parse({
        approvalId: "appr_1",
        runId: "run_1",
        decisionId: "dec_1",
        policyEvaluationId: "eval_1",
        actionDigest: "digest_1",
        channelOptions: ["web"],
        expiresAt: "2026-06-08T00:05:00.000Z",
        summary: { instrument: "BTCUSDT", action: "open_long", policyOutcome: "require_approval" },
        surprise: true,
      }),
    ).toThrow();
  });

  it("ApprovalApprovedPayload carries approver, channel, and both timestamps", () => {
    const p = ApprovalApprovedPayload.parse({
      approvalId: "appr_1",
      runId: "run_1",
      decisionId: "dec_1",
      actionDigest: "digest_1",
      approvedBy: "user_1",
      approvalChannel: "web",
      approvedAt: "2026-06-08T00:01:00.000Z",
      expiresAt: "2026-06-08T00:06:00.000Z",
    });
    expect(p.approvedBy).toBe("user_1");
  });

  it("ApprovalRejectedPayload keeps reason optional", () => {
    const p = ApprovalRejectedPayload.parse({
      approvalId: "appr_1",
      rejectedBy: "user_1",
      rejectionChannel: "telegram",
    });
    expect(p.reason).toBeUndefined();
  });

  it("ApprovalExpiredPayload requires expiredAt and actionDigest", () => {
    const p = ApprovalExpiredPayload.parse({
      approvalId: "appr_1",
      expiredAt: "2026-06-08T00:05:00.000Z",
      actionDigest: "digest_1",
    });
    expect(p.actionDigest).toBe("digest_1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/schemas/src/approval-payloads.test.ts`
Expected: FAIL — cannot resolve `./approval-payloads.js` (module not yet created).

- [ ] **Step 3: Write the implementation**

Create `packages/schemas/src/approval-payloads.ts`:

```ts
import { z } from "zod";
import { DecimalString, IsoTimestamp } from "./scalars.js";
import { DecisionAction } from "./decision-envelope.js";

export const ApprovalChannel = z.enum(["web", "telegram", "mcp_app"]);
export type ApprovalChannel = z.infer<typeof ApprovalChannel>;

export const ApprovalStatus = z.enum(["pending", "approved", "consumed", "rejected", "expired", "revoked"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalRequestedPayload = z
  .object({
    approvalId: z.string().min(1),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    policyEvaluationId: z.string().min(1),
    actionDigest: z.string().min(1),
    channelOptions: z.array(ApprovalChannel),
    expiresAt: IsoTimestamp,
    summary: z
      .object({
        instrument: z.string().min(1),
        action: DecisionAction,
        notionalUsdt: DecimalString.optional(),
        leverage: DecimalString.optional(),
        policyOutcome: z.literal("require_approval"),
      })
      .strict(),
  })
  .strict();
export type ApprovalRequestedPayload = z.infer<typeof ApprovalRequestedPayload>;

export const ApprovalApprovedPayload = z
  .object({
    approvalId: z.string().min(1),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    actionDigest: z.string().min(1),
    approvedBy: z.string().min(1),
    approvalChannel: ApprovalChannel,
    approvedAt: IsoTimestamp,
    expiresAt: IsoTimestamp,
  })
  .strict();
export type ApprovalApprovedPayload = z.infer<typeof ApprovalApprovedPayload>;

export const ApprovalRejectedPayload = z
  .object({
    approvalId: z.string().min(1),
    rejectedBy: z.string().min(1),
    rejectionChannel: ApprovalChannel,
    reason: z.string().optional(),
  })
  .strict();
export type ApprovalRejectedPayload = z.infer<typeof ApprovalRejectedPayload>;

export const ApprovalExpiredPayload = z
  .object({
    approvalId: z.string().min(1),
    expiredAt: IsoTimestamp,
    actionDigest: z.string().min(1),
  })
  .strict();
export type ApprovalExpiredPayload = z.infer<typeof ApprovalExpiredPayload>;
```

- [ ] **Step 4: Add the index export**

Modify `packages/schemas/src/index.ts` — add after the `run-status.js` line:

```ts
export * from "./approval-payloads.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/schemas/src/approval-payloads.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/approval-payloads.ts packages/schemas/src/approval-payloads.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add Phase 1B approval payloads and enums"
```

---

## Task 2: Schemas — authorization payloads

**Files:**
- Create: `packages/schemas/src/authorization-payloads.ts`
- Test: `packages/schemas/src/authorization-payloads.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/authorization-payloads.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  AuthorizationRejectionReason,
  AuthorizationIssuedPayload,
  AuthorizationConsumedPayload,
  AuthorizationRejectedPayload,
} from "./authorization-payloads.js";

describe("authorization payloads", () => {
  it("AuthorizationRejectionReason enumerates the seven canonical reasons", () => {
    expect(AuthorizationRejectionReason.options).toEqual([
      "missing_authorization",
      "expired_authorization",
      "already_consumed",
      "action_digest_mismatch",
      "workspace_locked",
      "manifest_changed",
      "policy_changed",
    ]);
  });

  it("AuthorizationIssuedPayload pins scope to single_action and keeps approvalId optional", () => {
    const p = AuthorizationIssuedPayload.parse({
      authorizationId: "authz_1",
      runId: "run_1",
      decisionId: "dec_1",
      actionDigest: "digest_1",
      expiresAt: "2026-06-08T00:05:00.000Z",
      scope: "single_action",
    });
    expect(p.approvalId).toBeUndefined();
    expect(() =>
      AuthorizationIssuedPayload.parse({
        authorizationId: "authz_1",
        runId: "run_1",
        decisionId: "dec_1",
        actionDigest: "digest_1",
        expiresAt: "2026-06-08T00:05:00.000Z",
        scope: "multi_action",
      }),
    ).toThrow();
  });

  it("AuthorizationConsumedPayload requires executionId and consumedAt", () => {
    const p = AuthorizationConsumedPayload.parse({
      authorizationId: "authz_1",
      runId: "run_1",
      decisionId: "dec_1",
      actionDigest: "digest_1",
      consumedAt: "2026-06-08T00:02:00.000Z",
      executionId: "exec_1",
    });
    expect(p.executionId).toBe("exec_1");
  });

  it("AuthorizationRejectedPayload carries attempted digest and a rejection reason", () => {
    const p = AuthorizationRejectedPayload.parse({
      runId: "run_1",
      decisionId: "dec_1",
      attemptedActionDigest: "digest_2",
      expectedActionDigest: "digest_1",
      reasonCode: "action_digest_mismatch",
    });
    expect(p.reasonCode).toBe("action_digest_mismatch");
    expect(() =>
      AuthorizationRejectedPayload.parse({
        runId: "run_1",
        decisionId: "dec_1",
        attemptedActionDigest: "digest_2",
        reasonCode: "not_a_reason",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/schemas/src/authorization-payloads.test.ts`
Expected: FAIL — cannot resolve `./authorization-payloads.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/schemas/src/authorization-payloads.ts`:

```ts
import { z } from "zod";
import { IsoTimestamp } from "./scalars.js";

export const AuthorizationRejectionReason = z.enum([
  "missing_authorization",
  "expired_authorization",
  "already_consumed",
  "action_digest_mismatch",
  "workspace_locked",
  "manifest_changed",
  "policy_changed",
]);
export type AuthorizationRejectionReason = z.infer<typeof AuthorizationRejectionReason>;

export const AuthorizationIssuedPayload = z
  .object({
    authorizationId: z.string().min(1),
    approvalId: z.string().min(1).optional(),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    actionDigest: z.string().min(1),
    expiresAt: IsoTimestamp,
    scope: z.literal("single_action"),
  })
  .strict();
export type AuthorizationIssuedPayload = z.infer<typeof AuthorizationIssuedPayload>;

export const AuthorizationConsumedPayload = z
  .object({
    authorizationId: z.string().min(1),
    approvalId: z.string().min(1).optional(),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    actionDigest: z.string().min(1),
    consumedAt: IsoTimestamp,
    executionId: z.string().min(1),
  })
  .strict();
export type AuthorizationConsumedPayload = z.infer<typeof AuthorizationConsumedPayload>;

export const AuthorizationRejectedPayload = z
  .object({
    authorizationId: z.string().min(1).optional(),
    approvalId: z.string().min(1).optional(),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    attemptedActionDigest: z.string().min(1),
    expectedActionDigest: z.string().min(1).optional(),
    reasonCode: AuthorizationRejectionReason,
  })
  .strict();
export type AuthorizationRejectedPayload = z.infer<typeof AuthorizationRejectedPayload>;
```

- [ ] **Step 4: Add the index export**

Modify `packages/schemas/src/index.ts` — add after the `approval-payloads.js` line:

```ts
export * from "./authorization-payloads.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/schemas/src/authorization-payloads.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/authorization-payloads.ts packages/schemas/src/authorization-payloads.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add Phase 1B authorization payloads and rejection reasons"
```

---

## Task 3: Policy-engine — `evaluateAuthorizationUse` single-use guard

**Files:**
- Create: `packages/policy-engine/src/authorization-guard.ts`
- Test: `packages/policy-engine/src/authorization-guard.test.ts`
- Modify: `packages/policy-engine/src/index.ts`

The guard is pure, total, and dependency-free (`now` is an input). Refusal precedence (first match wins, fail-closed): missing/revoked → `missing_authorization`; expired-status or `now ≥ expiresAt` → `expired_authorization`; consumed → `already_consumed`; digest mismatch → `action_digest_mismatch`; then gates `workspace_locked` → `manifest_changed` → `policy_changed`; else `ok`. Expiry comparison is lexical string compare on canonical UTC ISO-8601 (equals chronological order).

- [ ] **Step 1: Write the failing unit + property tests**

Create `packages/policy-engine/src/authorization-guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { evaluateAuthorizationUse, type AuthorizationUseInput } from "./authorization-guard.js";

const baseAuthorization = {
  authorizationId: "authz_1",
  actionDigest: "digest_1",
  expiresAt: "2026-06-08T00:05:00.000Z",
  status: "issued" as const,
};

function input(overrides: Partial<AuthorizationUseInput> = {}): AuthorizationUseInput {
  return {
    authorization: { ...baseAuthorization },
    attemptedActionDigest: "digest_1",
    now: "2026-06-08T00:01:00.000Z",
    gates: { workspaceLocked: false, manifestChanged: false, policyChanged: false },
    ...overrides,
  };
}

describe("evaluateAuthorizationUse", () => {
  it("returns ok with the authorizationId when every check passes", () => {
    expect(evaluateAuthorizationUse(input())).toEqual({ ok: true, authorizationId: "authz_1" });
  });

  it("refuses a missing authorization", () => {
    expect(evaluateAuthorizationUse(input({ authorization: undefined }))).toEqual({
      ok: false,
      reasonCode: "missing_authorization",
    });
  });

  it("maps a revoked authorization to missing_authorization", () => {
    expect(
      evaluateAuthorizationUse(input({ authorization: { ...baseAuthorization, status: "revoked" } })),
    ).toEqual({ ok: false, reasonCode: "missing_authorization" });
  });

  it("refuses an expired authorization by status or by clock", () => {
    expect(
      evaluateAuthorizationUse(input({ authorization: { ...baseAuthorization, status: "expired" } })),
    ).toEqual({ ok: false, reasonCode: "expired_authorization" });
    expect(evaluateAuthorizationUse(input({ now: "2026-06-08T00:05:00.000Z" }))).toEqual({
      ok: false,
      reasonCode: "expired_authorization",
    });
  });

  it("refuses a consumed authorization", () => {
    expect(
      evaluateAuthorizationUse(input({ authorization: { ...baseAuthorization, status: "consumed" } })),
    ).toEqual({ ok: false, reasonCode: "already_consumed" });
  });

  it("refuses a mismatched action digest", () => {
    expect(evaluateAuthorizationUse(input({ attemptedActionDigest: "digest_2" }))).toEqual({
      ok: false,
      reasonCode: "action_digest_mismatch",
    });
  });

  it("refuses on each contextual gate in precedence order", () => {
    expect(
      evaluateAuthorizationUse(input({ gates: { workspaceLocked: true, manifestChanged: true, policyChanged: true } })),
    ).toEqual({ ok: false, reasonCode: "workspace_locked" });
    expect(
      evaluateAuthorizationUse(input({ gates: { workspaceLocked: false, manifestChanged: true, policyChanged: true } })),
    ).toEqual({ ok: false, reasonCode: "manifest_changed" });
    expect(
      evaluateAuthorizationUse(input({ gates: { workspaceLocked: false, manifestChanged: false, policyChanged: true } })),
    ).toEqual({ ok: false, reasonCode: "policy_changed" });
  });

  it("applies precedence: missing/revoked beats expiry beats consumed beats mismatch beats gates", () => {
    // revoked + expired-by-clock + mismatch + all gates: highest-precedence wins.
    expect(
      evaluateAuthorizationUse(
        input({
          authorization: { ...baseAuthorization, status: "revoked", expiresAt: "2026-06-08T00:00:00.000Z" },
          attemptedActionDigest: "digest_2",
          now: "2026-06-08T09:00:00.000Z",
          gates: { workspaceLocked: true, manifestChanged: true, policyChanged: true },
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "missing_authorization" });
    // expired + consumed-status is impossible (one status), so check expiry beats mismatch+gates.
    expect(
      evaluateAuthorizationUse(
        input({
          now: "2026-06-08T09:00:00.000Z",
          attemptedActionDigest: "digest_2",
          gates: { workspaceLocked: true, manifestChanged: true, policyChanged: true },
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "expired_authorization" });
  });

  it("property: total — never throws on arbitrary input and always returns a boolean ok", () => {
    const statusArb = fc.constantFrom("issued", "consumed", "expired", "revoked");
    const tsArb = fc.constantFrom(
      "2026-06-08T00:00:00.000Z",
      "2026-06-08T00:05:00.000Z",
      "2026-06-09T00:00:00.000Z",
    );
    const inputArb = fc.record({
      authorization: fc.option(
        fc.record({
          authorizationId: fc.string({ minLength: 1 }),
          actionDigest: fc.string(),
          expiresAt: tsArb,
          status: statusArb,
        }),
        { nil: undefined },
      ),
      attemptedActionDigest: fc.string(),
      now: tsArb,
      gates: fc.record({
        workspaceLocked: fc.boolean(),
        manifestChanged: fc.boolean(),
        policyChanged: fc.boolean(),
      }),
    });
    fc.assert(
      fc.property(inputArb, (arbInput) => {
        const result = evaluateAuthorizationUse(arbInput as AuthorizationUseInput);
        expect(typeof result.ok).toBe("boolean");
      }),
    );
  });

  it("property: ok implies issued + unexpired + matching digest + all gates clear", () => {
    const statusArb = fc.constantFrom("issued", "consumed", "expired", "revoked");
    const tsArb = fc.constantFrom("2026-06-08T00:00:00.000Z", "2026-06-08T00:05:00.000Z");
    const inputArb = fc.record({
      authorization: fc.option(
        fc.record({
          authorizationId: fc.string({ minLength: 1 }),
          actionDigest: fc.constantFrom("digest_1", "digest_2"),
          expiresAt: tsArb,
          status: statusArb,
        }),
        { nil: undefined },
      ),
      attemptedActionDigest: fc.constantFrom("digest_1", "digest_2"),
      now: tsArb,
      gates: fc.record({
        workspaceLocked: fc.boolean(),
        manifestChanged: fc.boolean(),
        policyChanged: fc.boolean(),
      }),
    });
    fc.assert(
      fc.property(inputArb, (arbInput) => {
        const typed = arbInput as AuthorizationUseInput;
        const result = evaluateAuthorizationUse(typed);
        if (result.ok) {
          const authz = typed.authorization!;
          expect(authz.status).toBe("issued");
          expect(typed.now < authz.expiresAt).toBe(true);
          expect(typed.attemptedActionDigest).toBe(authz.actionDigest);
          expect(typed.gates.workspaceLocked || typed.gates.manifestChanged || typed.gates.policyChanged).toBe(false);
        }
      }),
    );
  });

  it("property: expiry is monotone — at or after expiresAt, the result is never ok", () => {
    const statusArb = fc.constantFrom("issued", "consumed", "expired", "revoked");
    const tsArb = fc.constantFrom("2026-06-08T00:00:00.000Z", "2026-06-08T00:05:00.000Z");
    const inputArb = fc.record({
      authorization: fc.record({
        authorizationId: fc.string({ minLength: 1 }),
        actionDigest: fc.constantFrom("digest_1", "digest_2"),
        expiresAt: tsArb,
        status: statusArb,
      }),
      attemptedActionDigest: fc.constantFrom("digest_1", "digest_2"),
      now: tsArb,
      gates: fc.record({
        workspaceLocked: fc.boolean(),
        manifestChanged: fc.boolean(),
        policyChanged: fc.boolean(),
      }),
    });
    fc.assert(
      fc.property(inputArb, (arbInput) => {
        const typed = arbInput as AuthorizationUseInput;
        if (typed.now >= typed.authorization!.expiresAt) {
          expect(evaluateAuthorizationUse(typed).ok).toBe(false);
        }
      }),
    );
  });

  it("property: a mismatched action digest is never ok", () => {
    const statusArb = fc.constantFrom("issued", "consumed", "expired", "revoked");
    const tsArb = fc.constantFrom("2026-06-08T00:00:00.000Z", "2026-06-08T00:05:00.000Z");
    const inputArb = fc.record({
      authorization: fc.record({
        authorizationId: fc.string({ minLength: 1 }),
        actionDigest: fc.constantFrom("digest_1", "digest_2"),
        expiresAt: tsArb,
        status: statusArb,
      }),
      attemptedActionDigest: fc.constantFrom("digest_1", "digest_2"),
      now: tsArb,
      gates: fc.record({
        workspaceLocked: fc.boolean(),
        manifestChanged: fc.boolean(),
        policyChanged: fc.boolean(),
      }),
    });
    fc.assert(
      fc.property(inputArb, (arbInput) => {
        const typed = arbInput as AuthorizationUseInput;
        if (typed.attemptedActionDigest !== typed.authorization!.actionDigest) {
          expect(evaluateAuthorizationUse(typed).ok).toBe(false);
        }
      }),
    );
  });

  it("property: deterministic — identical inputs produce identical results", () => {
    const statusArb = fc.constantFrom("issued", "consumed", "expired", "revoked");
    const tsArb = fc.constantFrom(
      "2026-06-08T00:00:00.000Z",
      "2026-06-08T00:05:00.000Z",
      "2026-06-09T00:00:00.000Z",
    );
    const inputArb = fc.record({
      authorization: fc.option(
        fc.record({
          authorizationId: fc.string({ minLength: 1 }),
          actionDigest: fc.constantFrom("digest_1", "digest_2"),
          expiresAt: tsArb,
          status: statusArb,
        }),
        { nil: undefined },
      ),
      attemptedActionDigest: fc.constantFrom("digest_1", "digest_2"),
      now: tsArb,
      gates: fc.record({
        workspaceLocked: fc.boolean(),
        manifestChanged: fc.boolean(),
        policyChanged: fc.boolean(),
      }),
    });
    fc.assert(
      fc.property(inputArb, (arbInput) => {
        const typed = arbInput as AuthorizationUseInput;
        expect(evaluateAuthorizationUse(typed)).toEqual(evaluateAuthorizationUse(typed));
      }),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/policy-engine/src/authorization-guard.test.ts`
Expected: FAIL — cannot resolve `./authorization-guard.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/policy-engine/src/authorization-guard.ts`:

```ts
import type { AuthorizationRejectionReason } from "@traceguard/schemas";

export type AuthorizationUseStatus = "issued" | "consumed" | "expired" | "revoked";

export interface AuthorizationUseInput {
  authorization?: {
    authorizationId: string;
    actionDigest: string;
    expiresAt: string;
    status: AuthorizationUseStatus;
  };
  attemptedActionDigest: string;
  now: string;
  gates: {
    workspaceLocked: boolean;
    manifestChanged: boolean;
    policyChanged: boolean;
  };
}

export type AuthorizationUseResult =
  | { ok: true; authorizationId: string }
  | { ok: false; reasonCode: AuthorizationRejectionReason };

export function evaluateAuthorizationUse(input: AuthorizationUseInput): AuthorizationUseResult {
  const authz = input.authorization;
  if (authz === undefined || authz.status === "revoked") {
    return { ok: false, reasonCode: "missing_authorization" };
  }
  if (authz.status === "expired" || input.now >= authz.expiresAt) {
    return { ok: false, reasonCode: "expired_authorization" };
  }
  if (authz.status === "consumed") {
    return { ok: false, reasonCode: "already_consumed" };
  }
  if (input.attemptedActionDigest !== authz.actionDigest) {
    return { ok: false, reasonCode: "action_digest_mismatch" };
  }
  if (input.gates.workspaceLocked) {
    return { ok: false, reasonCode: "workspace_locked" };
  }
  if (input.gates.manifestChanged) {
    return { ok: false, reasonCode: "manifest_changed" };
  }
  if (input.gates.policyChanged) {
    return { ok: false, reasonCode: "policy_changed" };
  }
  return { ok: true, authorizationId: authz.authorizationId };
}
```

- [ ] **Step 4: Add the index export**

Modify `packages/policy-engine/src/index.ts` — add after the `action-digest.js` line:

```ts
export * from "./authorization-guard.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/policy-engine/src/authorization-guard.test.ts`
Expected: PASS (13 tests, including 5 fast-check properties).

- [ ] **Step 6: Commit**

```bash
git add packages/policy-engine/src/authorization-guard.ts packages/policy-engine/src/authorization-guard.test.ts packages/policy-engine/src/index.ts
git commit -m "feat(policy-engine): add pure single-use authorization guard"
```

---

## Task 4: Event-ledger — extend `runStatusProjection`

**Files:**
- Modify: `packages/event-ledger/src/run-status-projection.ts`
- Test: `packages/event-ledger/src/run-status-projection.test.ts`

`ApprovalRequested` and `ApprovalApproved` advance run status to `approval_required`. Faithful to event-model §8.1, `AuthorizationIssued`, `ApprovalRejected`, and `ApprovalExpired` do **not** change run status (the run stays `approval_required` or `allowed` until a run-lifecycle event closes it — out of 1B scope).

- [ ] **Step 1: Add the failing test cases**

Modify `packages/event-ledger/src/run-status-projection.test.ts` — add these two `it` blocks inside the `describe("runStatusProjection", ...)` block, before its closing `});`:

```ts
  it("maps ApprovalRequested and ApprovalApproved to approval_required", () => {
    expect(runStatusProjection([ev("ApprovalRequested")])).toBe("approval_required");
    expect(runStatusProjection([ev("ApprovalApproved")])).toBe("approval_required");
  });

  it("leaves run status unchanged for AuthorizationIssued / ApprovalRejected / ApprovalExpired", () => {
    expect(runStatusProjection([ev("PolicyEvaluated", { outcome: "allow" }), ev("AuthorizationIssued")])).toBe(
      "allowed",
    );
    expect(runStatusProjection([ev("ApprovalRequested"), ev("ApprovalRejected")])).toBe("approval_required");
    expect(runStatusProjection([ev("ApprovalRequested"), ev("ApprovalExpired")])).toBe("approval_required");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/event-ledger/src/run-status-projection.test.ts`
Expected: FAIL — `ApprovalRequested` currently falls through to `default`, so the first new assertion gets `"created"` instead of `"approval_required"`.

- [ ] **Step 3: Write the implementation**

Modify `packages/event-ledger/src/run-status-projection.ts` — add two cases to the `switch`, immediately before the `case "PolicyEvaluated":` line:

```ts
      case "ApprovalRequested":
        status = "approval_required";
        break;
      case "ApprovalApproved":
        status = "approval_required";
        break;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/event-ledger/src/run-status-projection.test.ts`
Expected: PASS (all prior cases + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/event-ledger/src/run-status-projection.ts packages/event-ledger/src/run-status-projection.test.ts
git commit -m "feat(event-ledger): project approval events into run status"
```

---

## Task 5: Event-ledger — `approvalProjection` fold

**Files:**
- Create: `packages/event-ledger/src/approval-projection.ts`
- Test: `packages/event-ledger/src/approval-projection.test.ts`
- Modify: `packages/event-ledger/src/index.ts`

A pure fold producing the approval read-model and the state source the domain transitions consume. Forward-compatible: it folds `AuthorizationConsumed → consumed` and `ApprovalRevoked → revoked` even though 1B never emits them. The seed status is `"pending"` (fail-closed: a stream with no approval event is treated as not-yet-approved). `AuthorizationIssued` records `authorizationId` + `authorizationExpiresAt`, and backfills `runId`/`decisionId`/`actionDigest` only when an earlier `ApprovalRequested` did not already set them (so the allow path — which has no `ApprovalRequested` — is still populated).

- [ ] **Step 1: Write the failing test**

Create `packages/event-ledger/src/approval-projection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { approvalProjection } from "./approval-projection.js";
import type { LedgerEvent } from "@traceguard/schemas";

function ev(eventType: string, payload: unknown = {}): LedgerEvent {
  return {
    id: "evt",
    workspaceId: "ws_1",
    aggregateType: "approval",
    aggregateId: "appr_1",
    eventType,
    eventVersion: 1,
    schemaVersion: 1,
    occurredAt: "2026-06-08T00:00:00.000Z",
    recordedAt: "2026-06-08T00:00:00.000Z",
    actorType: "system",
    payload,
    payloadHash: "ph",
    eventHash: "eh",
  };
}

const requested = ev("ApprovalRequested", {
  approvalId: "appr_1",
  runId: "run_1",
  decisionId: "dec_1",
  actionDigest: "digest_1",
  expiresAt: "2026-06-08T00:05:00.000Z",
});

describe("approvalProjection", () => {
  it("seeds an empty stream to pending with no identifiers", () => {
    expect(approvalProjection([])).toEqual({ status: "pending" });
  });

  it("records request fields and marks pending", () => {
    expect(approvalProjection([requested])).toEqual({
      status: "pending",
      approvalId: "appr_1",
      runId: "run_1",
      decisionId: "dec_1",
      actionDigest: "digest_1",
      expiresAt: "2026-06-08T00:05:00.000Z",
    });
  });

  it("folds the approve path to approved and records the authorization", () => {
    const state = approvalProjection([
      requested,
      ev("ApprovalApproved", {}),
      ev("AuthorizationIssued", {
        authorizationId: "authz_1",
        approvalId: "appr_1",
        runId: "run_1",
        decisionId: "dec_1",
        actionDigest: "digest_1",
        expiresAt: "2026-06-08T00:06:00.000Z",
      }),
    ]);
    expect(state.status).toBe("approved");
    expect(state.authorizationId).toBe("authz_1");
    expect(state.authorizationExpiresAt).toBe("2026-06-08T00:06:00.000Z");
    expect(state.approvalId).toBe("appr_1");
    expect(state.expiresAt).toBe("2026-06-08T00:05:00.000Z");
  });

  it("folds an allow-path AuthorizationIssued with no prior request", () => {
    const state = approvalProjection([
      ev("AuthorizationIssued", {
        authorizationId: "authz_1",
        runId: "run_1",
        decisionId: "dec_1",
        actionDigest: "digest_1",
        expiresAt: "2026-06-08T00:05:00.000Z",
      }),
    ]);
    expect(state.status).toBe("approved");
    expect(state.approvalId).toBeUndefined();
    expect(state.runId).toBe("run_1");
    expect(state.decisionId).toBe("dec_1");
    expect(state.actionDigest).toBe("digest_1");
    expect(state.authorizationId).toBe("authz_1");
    expect(state.authorizationExpiresAt).toBe("2026-06-08T00:05:00.000Z");
  });

  it("folds rejected, expired, consumed, and revoked transitions", () => {
    expect(approvalProjection([requested, ev("ApprovalRejected", {})]).status).toBe("rejected");
    expect(approvalProjection([requested, ev("ApprovalExpired", {})]).status).toBe("expired");
    expect(approvalProjection([requested, ev("ApprovalApproved", {}), ev("AuthorizationConsumed", {})]).status).toBe(
      "consumed",
    );
    expect(approvalProjection([requested, ev("ApprovalRevoked", {})]).status).toBe("revoked");
  });

  it("ignores unrelated decision events", () => {
    expect(approvalProjection([ev("DecisionProposed", {}), ev("PolicyEvaluated", { outcome: "allow" })])).toEqual({
      status: "pending",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/event-ledger/src/approval-projection.test.ts`
Expected: FAIL — cannot resolve `./approval-projection.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/event-ledger/src/approval-projection.ts`:

```ts
import type { ApprovalStatus, LedgerEvent } from "@traceguard/schemas";

export interface ApprovalProjection {
  approvalId?: string;
  runId?: string;
  decisionId?: string;
  actionDigest?: string;
  expiresAt?: string;
  status: ApprovalStatus;
  authorizationId?: string;
  authorizationExpiresAt?: string;
}

function readString(payload: unknown, key: string): string | undefined {
  if (payload !== null && typeof payload === "object" && key in payload) {
    const value = (payload as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

export function approvalProjection(events: LedgerEvent[]): ApprovalProjection {
  const state: ApprovalProjection = { status: "pending" };
  for (const e of events) {
    switch (e.eventType) {
      case "ApprovalRequested": {
        state.status = "pending";
        const approvalId = readString(e.payload, "approvalId");
        const runId = readString(e.payload, "runId");
        const decisionId = readString(e.payload, "decisionId");
        const actionDigest = readString(e.payload, "actionDigest");
        const expiresAt = readString(e.payload, "expiresAt");
        if (approvalId !== undefined) state.approvalId = approvalId;
        if (runId !== undefined) state.runId = runId;
        if (decisionId !== undefined) state.decisionId = decisionId;
        if (actionDigest !== undefined) state.actionDigest = actionDigest;
        if (expiresAt !== undefined) state.expiresAt = expiresAt;
        break;
      }
      case "ApprovalApproved":
        state.status = "approved";
        break;
      case "AuthorizationIssued": {
        state.status = "approved";
        const authorizationId = readString(e.payload, "authorizationId");
        const authorizationExpiresAt = readString(e.payload, "expiresAt");
        const runId = readString(e.payload, "runId");
        const decisionId = readString(e.payload, "decisionId");
        const actionDigest = readString(e.payload, "actionDigest");
        if (authorizationId !== undefined) state.authorizationId = authorizationId;
        if (authorizationExpiresAt !== undefined) state.authorizationExpiresAt = authorizationExpiresAt;
        if (runId !== undefined && state.runId === undefined) state.runId = runId;
        if (decisionId !== undefined && state.decisionId === undefined) state.decisionId = decisionId;
        if (actionDigest !== undefined && state.actionDigest === undefined) state.actionDigest = actionDigest;
        break;
      }
      case "AuthorizationConsumed":
        state.status = "consumed";
        break;
      case "ApprovalRejected":
        state.status = "rejected";
        break;
      case "ApprovalExpired":
        state.status = "expired";
        break;
      case "ApprovalRevoked":
        state.status = "revoked";
        break;
      default:
        break;
    }
  }
  return state;
}
```

- [ ] **Step 4: Add the index export**

Modify `packages/event-ledger/src/index.ts` — add after the `run-status-projection.js` line:

```ts
export * from "./approval-projection.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/event-ledger/src/approval-projection.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/event-ledger/src/approval-projection.ts packages/event-ledger/src/approval-projection.test.ts packages/event-ledger/src/index.ts
git commit -m "feat(event-ledger): add approval projection fold"
```

---

### Task 6: Testing Fixtures — Approval Samples

**Files:**
- Create: `packages/testing-fixtures/src/approval-samples.ts`
- Modify: `packages/testing-fixtures/src/index.ts`

These fixtures are pure data (no behavior), so there is no dedicated unit test. They are
exercised by the domain unit tests (Tasks 7-8) and the acceptance test (Task 9). Verification
is a successful `pnpm typecheck` plus the downstream tests compiling against them.

- [ ] **Step 1: Create the approval samples file**

Create `packages/testing-fixtures/src/approval-samples.ts`:

```ts
import type { ActionDigestInput, ApprovalChannel } from "@traceguard/schemas";
import { sampleRunId, sampleWorkspaceId } from "./samples.js";

export const sampleDecisionId = "dec_approval";
export const samplePolicyEvaluationId = "eval_000001";
export const sampleApprovedBy = "user_1";
export const sampleRejectedBy = "user_1";
export const sampleApprovalChannel: ApprovalChannel = "web";
export const sampleApprovalExpiresAt = "2026-06-08T00:05:00.000Z";
export const sampleAuthorizationExpiresAt = "2026-06-08T00:05:00.000Z";
export const sampleChannelOptions: ApprovalChannel[] = ["web", "telegram"];

export const sampleActionDigestInput: ActionDigestInput = {
  workspaceId: sampleWorkspaceId,
  runId: sampleRunId,
  decisionId: sampleDecisionId,
  providerConnectionId: "pc_1",
  toolName: "place_order",
  toolManifestHash: "tmh_1",
  policyVersionId: "pv_1",
  workspaceMode: "approval_mode",
  instrument: "BTCUSDT",
  marketType: "futures",
  action: "open_long",
  requestedNotionalUsdt: "300",
  requestedLeverage: "2",
  executionAdapter: "simulator",
};
```

- [ ] **Step 2: Add the index export**

Modify `packages/testing-fixtures/src/index.ts` — add after `export * from "./samples.js";`:

```ts
export * from "./approval-samples.js";
```

The file should then read:

```ts
export * from "./deps.js";
export * from "./samples.js";
export * from "./approval-samples.js";
```

- [ ] **Step 3: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: PASS (no errors). This confirms `sampleActionDigestInput` satisfies the
`ActionDigestInput` strict schema and `ApprovalChannel` is exported from `@traceguard/schemas`.

- [ ] **Step 4: Commit**

```bash
git add packages/testing-fixtures/src/approval-samples.ts packages/testing-fixtures/src/index.ts
git commit -m "test(testing-fixtures): add Phase 1B approval samples"
```

---

### Task 7: Domain — `resolveAuthorizationGateway` + shared transition types

**Files:**
- Create: `packages/domain/src/authorization-gateway.ts`
- Test: `packages/domain/src/authorization-gateway.test.ts`
- Modify: `packages/domain/src/index.ts`

This is the entry point of the authorization path. Given a policy `Effect`, it either issues a
single-use authorization (`allow`), requests human approval (`require_approval`), or emits nothing
(`block`). It also defines the shared `ApprovalTransitionDeps` / `ApprovalOutcome` /
`ApprovalTransitionResult` types reused by Task 8. The action digest is recomputed here from the
`ActionDigestInput` (never trusted from the agent), mirroring Phase 1A's `deps.hash` discipline.

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/authorization-gateway.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sha256hex } from "@traceguard/event-ledger";
import type { ApprovalRequestedPayload, AuthorizationIssuedPayload, Effect, LedgerEvent } from "@traceguard/schemas";
import {
  fixedClock,
  sampleActionDigestInput,
  sampleApprovalExpiresAt,
  sampleAuthorizationExpiresAt,
  sampleChannelOptions,
  sampleDecisionId,
  samplePolicyEvaluationId,
  sampleRunId,
  sampleWorkspaceId,
  sequentialIdGen,
} from "@traceguard/testing-fixtures";
import { resolveAuthorizationGateway, type ResolveAuthorizationGatewayArgs } from "./authorization-gateway.js";

function makeArgs(outcome: Effect): ResolveAuthorizationGatewayArgs {
  return {
    workspaceId: sampleWorkspaceId,
    runId: sampleRunId,
    decisionId: sampleDecisionId,
    policyEvaluationId: samplePolicyEvaluationId,
    outcome,
    actionDigestInput: sampleActionDigestInput,
    channelOptions: sampleChannelOptions,
    summary: { instrument: "BTCUSDT", action: "open_long", notionalUsdt: "300", leverage: "2" },
    approvalExpiresAt: sampleApprovalExpiresAt,
    authorizationExpiresAt: sampleAuthorizationExpiresAt,
    previousEventHash: null,
  };
}

function makeDeps() {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

describe("resolveAuthorizationGateway", () => {
  it("issues a single-action authorization on allow", () => {
    const result = resolveAuthorizationGateway(makeArgs("allow"), makeDeps());
    expect(result.outcome).toBe("issued");
    expect(result.events.map((e) => e.eventType)).toEqual(["AuthorizationIssued"]);
    const event = result.events[0] as LedgerEvent<AuthorizationIssuedPayload>;
    expect(event.aggregateType).toBe("authorization");
    expect(event.actorType).toBe("system");
    expect(event.actorId).toBeUndefined();
    expect(event.payload.scope).toBe("single_action");
    expect(event.payload.expiresAt).toBe(sampleAuthorizationExpiresAt);
    expect(event.payload.approvalId).toBeUndefined();
    expect(event.payload.actionDigest.length).toBeGreaterThan(0);
  });

  it("requests approval on require_approval, pinning summary.policyOutcome", () => {
    const result = resolveAuthorizationGateway(makeArgs("require_approval"), makeDeps());
    expect(result.outcome).toBe("requested");
    expect(result.events.map((e) => e.eventType)).toEqual(["ApprovalRequested"]);
    const event = result.events[0] as LedgerEvent<ApprovalRequestedPayload>;
    expect(event.aggregateType).toBe("approval");
    expect(event.actorType).toBe("system");
    expect(event.payload.summary.policyOutcome).toBe("require_approval");
    expect(event.payload.summary.notionalUsdt).toBe("300");
    expect(event.payload.channelOptions).toEqual(sampleChannelOptions);
    expect(event.payload.expiresAt).toBe(sampleApprovalExpiresAt);
    expect(event.payload.policyEvaluationId).toBe(samplePolicyEvaluationId);
  });

  it("emits no events on block", () => {
    const result = resolveAuthorizationGateway(makeArgs("block"), makeDeps());
    expect(result.outcome).toBe("blocked");
    expect(result.events).toEqual([]);
  });

  it("recomputes the action digest from the input (matches policy-engine)", async () => {
    const { computeActionDigest } = await import("@traceguard/policy-engine");
    const result = resolveAuthorizationGateway(makeArgs("allow"), makeDeps());
    const event = result.events[0] as LedgerEvent<AuthorizationIssuedPayload>;
    expect(event.payload.actionDigest).toBe(computeActionDigest(sampleActionDigestInput, sha256hex));
  });

  it("is deterministic — identical args+deps produce byte-identical events", () => {
    const a = resolveAuthorizationGateway(makeArgs("allow"), makeDeps());
    const b = resolveAuthorizationGateway(makeArgs("allow"), makeDeps());
    expect(a.events).toEqual(b.events);
    expect(a.events[0]?.eventHash).toBe(b.events[0]?.eventHash);
  });

  it("threads previousEventHash from args into the emitted event", () => {
    const result = resolveAuthorizationGateway({ ...makeArgs("allow"), previousEventHash: "prev_hash" }, makeDeps());
    expect(result.events[0]?.previousEventHash).toBe("prev_hash");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/domain/src/authorization-gateway.test.ts`
Expected: FAIL — cannot resolve `./authorization-gateway.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/domain/src/authorization-gateway.ts`:

```ts
import {
  ApprovalRequestedPayload,
  AuthorizationIssuedPayload,
  type ActionDigestInput,
  type ActorType,
  type ApprovalChannel,
  type DecisionAction,
  type Effect,
  type LedgerEvent,
} from "@traceguard/schemas";
import { makeEvent, type Clock, type IdGen } from "@traceguard/event-ledger";
import { computeActionDigest } from "@traceguard/policy-engine";

export interface ApprovalTransitionDeps {
  clock: Clock;
  newId: IdGen;
  hash: (s: string) => string;
}

export type ApprovalOutcome =
  | "issued"
  | "requested"
  | "blocked"
  | "approved"
  | "rejected"
  | "expired"
  | "not_yet_expired"
  | "illegal_transition";

export interface ApprovalTransitionResult {
  events: LedgerEvent[];
  outcome: ApprovalOutcome;
}

export interface AuthorizationSummary {
  instrument: string;
  action: DecisionAction;
  notionalUsdt?: string;
  leverage?: string;
}

export interface ResolveAuthorizationGatewayArgs {
  workspaceId: string;
  runId: string;
  decisionId: string;
  policyEvaluationId: string;
  outcome: Effect;
  actionDigestInput: ActionDigestInput;
  channelOptions: ApprovalChannel[];
  summary: AuthorizationSummary;
  approvalExpiresAt: string;
  authorizationExpiresAt: string;
  previousEventHash?: string | null;
}

export function resolveAuthorizationGateway(
  args: ResolveAuthorizationGatewayArgs,
  deps: ApprovalTransitionDeps,
): ApprovalTransitionResult {
  const events: LedgerEvent[] = [];
  let previousEventHash = args.previousEventHash ?? null;
  const actionDigest = computeActionDigest(args.actionDigestInput, deps.hash);

  function emit<TPayload>(
    aggregateType: "approval" | "authorization",
    aggregateId: string,
    eventType: string,
    actorType: ActorType,
    payload: TPayload,
  ): LedgerEvent<TPayload> {
    const event = makeEvent(
      {
        workspaceId: args.workspaceId,
        aggregateType,
        aggregateId,
        eventType,
        eventVersion: 1,
        schemaVersion: 1,
        actorType,
        runId: args.runId,
        payload,
        previousEventHash,
      },
      deps,
    );
    events.push(event);
    previousEventHash = event.eventHash;
    return event;
  }

  if (args.outcome === "allow") {
    const authorizationId = deps.newId.next("authz");
    emit(
      "authorization",
      authorizationId,
      "AuthorizationIssued",
      "system",
      AuthorizationIssuedPayload.parse({
        authorizationId,
        runId: args.runId,
        decisionId: args.decisionId,
        actionDigest,
        expiresAt: args.authorizationExpiresAt,
        scope: "single_action",
      }),
    );
    return { events, outcome: "issued" };
  }

  if (args.outcome === "require_approval") {
    const approvalId = deps.newId.next("appr");
    emit(
      "approval",
      approvalId,
      "ApprovalRequested",
      "system",
      ApprovalRequestedPayload.parse({
        approvalId,
        runId: args.runId,
        decisionId: args.decisionId,
        policyEvaluationId: args.policyEvaluationId,
        actionDigest,
        channelOptions: args.channelOptions,
        expiresAt: args.approvalExpiresAt,
        summary: {
          instrument: args.summary.instrument,
          action: args.summary.action,
          ...(args.summary.notionalUsdt !== undefined ? { notionalUsdt: args.summary.notionalUsdt } : {}),
          ...(args.summary.leverage !== undefined ? { leverage: args.summary.leverage } : {}),
          policyOutcome: "require_approval",
        },
      }),
    );
    return { events, outcome: "requested" };
  }

  return { events, outcome: "blocked" };
}
```

- [ ] **Step 4: Add the index export**

Modify `packages/domain/src/index.ts` — add after the `propose-decision.js` line:

```ts
export * from "./authorization-gateway.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/domain/src/authorization-gateway.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/authorization-gateway.ts packages/domain/src/authorization-gateway.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): add authorization gateway resolving policy effect to events"
```

---

### Task 8: Domain — approval transitions (`approveApproval` / `rejectApproval` / `expireApproval`)

**Files:**
- Create: `packages/domain/src/approval-transitions.ts`
- Test: `packages/domain/src/approval-transitions.test.ts`
- Modify: `packages/domain/src/index.ts`

The three human/worker-driven transitions out of a `pending` approval. Each is pure and total:
it folds the current `ApprovalProjection`, refuses any non-`pending` state (`illegal_transition`,
fail-closed), and re-derives `now` from `deps.clock`. A **unified expiry rule** governs all three
(spec §5.2, Invariant I2): before any pending-state transition, if `now ≥ expiresAt` the only legal
emission is `ApprovalExpired` (`actorType:"system"`) — a lapse is never overridden by the intended
approve/reject. So both `approveApproval` and `rejectApproval` check the deadline first (inclusive
boundary) and otherwise emit their intended events: `approveApproval` emits the ordered pair
`[ApprovalApproved, AuthorizationIssued]`; `rejectApproval` emits `ApprovalRejected`. `expireApproval`
is the worker sweep: it emits `ApprovalExpired` only once the window has lapsed (no-op before then).

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/approval-transitions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sha256hex, type ApprovalProjection } from "@traceguard/event-ledger";
import type { ApprovalApprovedPayload, AuthorizationIssuedPayload, LedgerEvent } from "@traceguard/schemas";
import {
  fixedClock,
  sampleApprovalChannel,
  sampleApprovalExpiresAt,
  sampleApprovedBy,
  sampleAuthorizationExpiresAt,
  sampleDecisionId,
  sampleRejectedBy,
  sampleRunId,
  sampleWorkspaceId,
  sequentialIdGen,
} from "@traceguard/testing-fixtures";
import { approveApproval, expireApproval, rejectApproval } from "./approval-transitions.js";

function pendingState(overrides: Partial<ApprovalProjection> = {}): ApprovalProjection {
  return {
    status: "pending",
    approvalId: "appr_1",
    runId: sampleRunId,
    decisionId: sampleDecisionId,
    actionDigest: "digest_1",
    expiresAt: sampleApprovalExpiresAt,
    ...overrides,
  };
}

function deps(instant?: string) {
  return { clock: fixedClock(instant), newId: sequentialIdGen(), hash: sha256hex };
}

describe("approveApproval", () => {
  it("emits ApprovalApproved then AuthorizationIssued and returns approved", () => {
    const result = approveApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: pendingState(),
        approvedBy: sampleApprovedBy,
        approvalChannel: sampleApprovalChannel,
        authorizationExpiresAt: sampleAuthorizationExpiresAt,
        previousEventHash: null,
      },
      deps(),
    );
    expect(result.outcome).toBe("approved");
    expect(result.events.map((e) => e.eventType)).toEqual(["ApprovalApproved", "AuthorizationIssued"]);
    const approved = result.events[0] as LedgerEvent<ApprovalApprovedPayload>;
    expect(approved.actorType).toBe("user");
    expect(approved.actorId).toBe(sampleApprovedBy);
    expect(approved.payload.approvedBy).toBe(sampleApprovedBy);
    const issued = result.events[1] as LedgerEvent<AuthorizationIssuedPayload>;
    expect(issued.aggregateType).toBe("authorization");
    expect(issued.actorType).toBe("system");
    expect(issued.payload.approvalId).toBe("appr_1");
    expect(issued.payload.scope).toBe("single_action");
    expect(issued.previousEventHash).toBe(approved.eventHash);
  });

  it("expires instead of approving at or past the deadline (boundary inclusive)", () => {
    const result = approveApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: pendingState(),
        approvedBy: sampleApprovedBy,
        approvalChannel: sampleApprovalChannel,
        authorizationExpiresAt: sampleAuthorizationExpiresAt,
        previousEventHash: null,
      },
      deps(sampleApprovalExpiresAt), // now === expiresAt
    );
    expect(result.outcome).toBe("expired");
    expect(result.events.map((e) => e.eventType)).toEqual(["ApprovalExpired"]);
  });

  it("refuses to approve a non-pending approval", () => {
    const result = approveApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: pendingState({ status: "approved" }),
        approvedBy: sampleApprovedBy,
        approvalChannel: sampleApprovalChannel,
        authorizationExpiresAt: sampleAuthorizationExpiresAt,
        previousEventHash: null,
      },
      deps(),
    );
    expect(result).toEqual({ events: [], outcome: "illegal_transition" });
  });

  it("refuses when the pending state is missing required fields", () => {
    const result = approveApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: { status: "pending" },
        approvedBy: sampleApprovedBy,
        approvalChannel: sampleApprovalChannel,
        authorizationExpiresAt: sampleAuthorizationExpiresAt,
        previousEventHash: null,
      },
      deps(),
    );
    expect(result).toEqual({ events: [], outcome: "illegal_transition" });
  });
});

describe("rejectApproval", () => {
  it("emits ApprovalRejected by the user with an optional reason", () => {
    const result = rejectApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: pendingState(),
        rejectedBy: sampleRejectedBy,
        rejectionChannel: sampleApprovalChannel,
        reason: "too risky",
        previousEventHash: null,
      },
      deps(),
    );
    expect(result.outcome).toBe("rejected");
    expect(result.events.map((e) => e.eventType)).toEqual(["ApprovalRejected"]);
    expect(result.events[0]?.actorType).toBe("user");
    expect(result.events[0]?.actorId).toBe(sampleRejectedBy);
    expect(result.events[0]?.payload).toMatchObject({ reason: "too risky", rejectedBy: sampleRejectedBy });
  });

  it("expires instead of rejecting at or past the deadline (boundary inclusive)", () => {
    const result = rejectApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: pendingState(),
        rejectedBy: sampleRejectedBy,
        rejectionChannel: sampleApprovalChannel,
        previousEventHash: null,
      },
      deps(sampleApprovalExpiresAt), // now === expiresAt
    );
    expect(result.outcome).toBe("expired");
    expect(result.events.map((e) => e.eventType)).toEqual(["ApprovalExpired"]);
    expect(result.events[0]?.actorType).toBe("system");
  });

  it("refuses to reject a non-pending approval", () => {
    const result = rejectApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: pendingState({ status: "rejected" }),
        rejectedBy: sampleRejectedBy,
        rejectionChannel: sampleApprovalChannel,
        previousEventHash: null,
      },
      deps(),
    );
    expect(result).toEqual({ events: [], outcome: "illegal_transition" });
  });
});

describe("expireApproval", () => {
  it("emits ApprovalExpired once the deadline has passed", () => {
    const result = expireApproval(
      { workspaceId: sampleWorkspaceId, approvalState: pendingState(), previousEventHash: null },
      deps("2026-06-08T00:10:00.000Z"),
    );
    expect(result.outcome).toBe("expired");
    expect(result.events.map((e) => e.eventType)).toEqual(["ApprovalExpired"]);
    expect(result.events[0]?.payload).toMatchObject({ expiredAt: "2026-06-08T00:10:00.000Z" });
  });

  it("does nothing while the approval is still within its window", () => {
    const result = expireApproval(
      { workspaceId: sampleWorkspaceId, approvalState: pendingState(), previousEventHash: null },
      deps("2026-06-08T00:01:00.000Z"),
    );
    expect(result).toEqual({ events: [], outcome: "not_yet_expired" });
  });

  it("refuses to expire a non-pending approval", () => {
    const result = expireApproval(
      { workspaceId: sampleWorkspaceId, approvalState: pendingState({ status: "approved" }), previousEventHash: null },
      deps(),
    );
    expect(result).toEqual({ events: [], outcome: "illegal_transition" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/domain/src/approval-transitions.test.ts`
Expected: FAIL — cannot resolve `./approval-transitions.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/domain/src/approval-transitions.ts`:

```ts
import {
  ApprovalApprovedPayload,
  ApprovalExpiredPayload,
  ApprovalRejectedPayload,
  AuthorizationIssuedPayload,
  type ActorType,
  type ApprovalChannel,
  type LedgerEvent,
} from "@traceguard/schemas";
import { makeEvent, type ApprovalProjection } from "@traceguard/event-ledger";
import type { ApprovalTransitionDeps, ApprovalTransitionResult } from "./authorization-gateway.js";

function createEmitter(workspaceId: string, runId: string, deps: ApprovalTransitionDeps, startHash: string | null) {
  const events: LedgerEvent[] = [];
  let previousEventHash = startHash;
  function emit<TPayload>(
    aggregateType: "approval" | "authorization",
    aggregateId: string,
    eventType: string,
    actorType: ActorType,
    actorId: string | undefined,
    payload: TPayload,
  ): void {
    const event = makeEvent(
      {
        workspaceId,
        aggregateType,
        aggregateId,
        eventType,
        eventVersion: 1,
        schemaVersion: 1,
        actorType,
        actorId,
        runId,
        payload,
        previousEventHash,
      },
      deps,
    );
    events.push(event);
    previousEventHash = event.eventHash;
  }
  return { events, emit };
}

export interface ApproveApprovalArgs {
  workspaceId: string;
  approvalState: ApprovalProjection;
  approvedBy: string;
  approvalChannel: ApprovalChannel;
  authorizationExpiresAt: string;
  previousEventHash?: string | null;
}

export function approveApproval(args: ApproveApprovalArgs, deps: ApprovalTransitionDeps): ApprovalTransitionResult {
  const state = args.approvalState;
  if (state.status !== "pending") {
    return { events: [], outcome: "illegal_transition" };
  }
  const { approvalId, runId, decisionId, actionDigest, expiresAt } = state;
  if (
    approvalId === undefined ||
    runId === undefined ||
    decisionId === undefined ||
    actionDigest === undefined ||
    expiresAt === undefined
  ) {
    return { events: [], outcome: "illegal_transition" };
  }

  const now = deps.clock.now();
  const { events, emit } = createEmitter(args.workspaceId, runId, deps, args.previousEventHash ?? null);

  if (now >= expiresAt) {
    emit(
      "approval",
      approvalId,
      "ApprovalExpired",
      "system",
      undefined,
      ApprovalExpiredPayload.parse({ approvalId, expiredAt: now, actionDigest }),
    );
    return { events, outcome: "expired" };
  }

  emit(
    "approval",
    approvalId,
    "ApprovalApproved",
    "user",
    args.approvedBy,
    ApprovalApprovedPayload.parse({
      approvalId,
      runId,
      decisionId,
      actionDigest,
      approvedBy: args.approvedBy,
      approvalChannel: args.approvalChannel,
      approvedAt: now,
      expiresAt: args.authorizationExpiresAt,
    }),
  );

  const authorizationId = deps.newId.next("authz");
  emit(
    "authorization",
    authorizationId,
    "AuthorizationIssued",
    "system",
    undefined,
    AuthorizationIssuedPayload.parse({
      authorizationId,
      approvalId,
      runId,
      decisionId,
      actionDigest,
      expiresAt: args.authorizationExpiresAt,
      scope: "single_action",
    }),
  );

  return { events, outcome: "approved" };
}

export interface RejectApprovalArgs {
  workspaceId: string;
  approvalState: ApprovalProjection;
  rejectedBy: string;
  rejectionChannel: ApprovalChannel;
  reason?: string;
  previousEventHash?: string | null;
}

export function rejectApproval(args: RejectApprovalArgs, deps: ApprovalTransitionDeps): ApprovalTransitionResult {
  const state = args.approvalState;
  if (state.status !== "pending") {
    return { events: [], outcome: "illegal_transition" };
  }
  const { approvalId, runId, actionDigest, expiresAt } = state;
  if (approvalId === undefined || runId === undefined || actionDigest === undefined || expiresAt === undefined) {
    return { events: [], outcome: "illegal_transition" };
  }

  const now = deps.clock.now();
  const { events, emit } = createEmitter(args.workspaceId, runId, deps, args.previousEventHash ?? null);

  // Unified expiry rule (spec §5.2, Invariant I2): a lapse is never overridden by a rejection.
  if (now >= expiresAt) {
    emit(
      "approval",
      approvalId,
      "ApprovalExpired",
      "system",
      undefined,
      ApprovalExpiredPayload.parse({ approvalId, expiredAt: now, actionDigest }),
    );
    return { events, outcome: "expired" };
  }

  emit(
    "approval",
    approvalId,
    "ApprovalRejected",
    "user",
    args.rejectedBy,
    ApprovalRejectedPayload.parse({
      approvalId,
      rejectedBy: args.rejectedBy,
      rejectionChannel: args.rejectionChannel,
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
    }),
  );
  return { events, outcome: "rejected" };
}

export interface ExpireApprovalArgs {
  workspaceId: string;
  approvalState: ApprovalProjection;
  previousEventHash?: string | null;
}

export function expireApproval(args: ExpireApprovalArgs, deps: ApprovalTransitionDeps): ApprovalTransitionResult {
  const state = args.approvalState;
  if (state.status !== "pending") {
    return { events: [], outcome: "illegal_transition" };
  }
  const { approvalId, runId, actionDigest, expiresAt } = state;
  if (approvalId === undefined || runId === undefined || actionDigest === undefined || expiresAt === undefined) {
    return { events: [], outcome: "illegal_transition" };
  }

  const now = deps.clock.now();
  if (now < expiresAt) {
    return { events: [], outcome: "not_yet_expired" };
  }

  const { events, emit } = createEmitter(args.workspaceId, runId, deps, args.previousEventHash ?? null);
  emit(
    "approval",
    approvalId,
    "ApprovalExpired",
    "system",
    undefined,
    ApprovalExpiredPayload.parse({ approvalId, expiredAt: now, actionDigest }),
  );
  return { events, outcome: "expired" };
}
```

- [ ] **Step 4: Add the index export**

Modify `packages/domain/src/index.ts` — add after the `authorization-gateway.js` line:

```ts
export * from "./approval-transitions.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/domain/src/approval-transitions.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/approval-transitions.ts packages/domain/src/approval-transitions.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): add approve/reject/expire approval transitions"
```

---

### Task 9: Domain — Phase 1B end-to-end acceptance + final verification

**Files:**
- Create: `packages/domain/src/acceptance-phase1b.test.ts`

This wires the whole 1B slice together against a real `InMemoryLedgerStore`: propose → resolve
gateway → (approve | reject | expire), append the combined event list, re-read by run, verify the
hash chain across aggregates, and assert both projections. **All chained calls in one scenario share
a single `deps` object** so `sequentialIdGen`'s counter keeps every `evt_*`/`appr_*`/`authz_*` id
unique (fresh deps per call would reissue `evt_000001` and corrupt the ledger semantics). The expire
scenario reuses that same `newId`/`hash` but swaps in a later `clock`, the only way to advance past
`expiresAt` while preserving id uniqueness.

- [ ] **Step 1: Write the acceptance test**

Create `packages/domain/src/acceptance-phase1b.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  InMemoryLedgerStore,
  approvalProjection,
  runStatusProjection,
  sha256hex,
  verifyChain,
} from "@traceguard/event-ledger";
import type { DecisionEnvelope, Policy, PolicyEvaluatedPayload, RunStatus } from "@traceguard/schemas";
import {
  allowDecisionEnvelope,
  allowPolicy,
  approvalDecisionEnvelope,
  approvalPolicy,
  fixedClock,
  sampleActionDigestInput,
  sampleActorId,
  sampleApprovalChannel,
  sampleApprovalExpiresAt,
  sampleApprovedBy,
  sampleAuthorizationExpiresAt,
  sampleChannelOptions,
  sampleEvaluationContext,
  sampleRejectedBy,
  sampleRunId,
  sampleWorkspaceId,
  sequentialIdGen,
} from "@traceguard/testing-fixtures";
import { proposeDecision } from "./propose-decision.js";
import { resolveAuthorizationGateway, type ApprovalTransitionDeps } from "./authorization-gateway.js";
import { approveApproval, expireApproval, rejectApproval } from "./approval-transitions.js";

function sharedDeps(): ApprovalTransitionDeps {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

function proposeAndResolve(
  envelope: DecisionEnvelope,
  policy: Policy,
  deps: ApprovalTransitionDeps,
  previousEventHash: string | null,
) {
  const proposed = proposeDecision(
    {
      workspaceId: sampleWorkspaceId,
      actorId: sampleActorId,
      envelope,
      policy,
      context: sampleEvaluationContext,
      previousEventHash,
    },
    deps,
  );
  const last = proposed.events.at(-1)!;
  const policyEvaluationId = (last.payload as PolicyEvaluatedPayload).evaluationId;
  const gateway = resolveAuthorizationGateway(
    {
      workspaceId: sampleWorkspaceId,
      runId: sampleRunId,
      decisionId: envelope.id,
      policyEvaluationId,
      outcome: proposed.decision.outcome,
      actionDigestInput: { ...sampleActionDigestInput, decisionId: envelope.id },
      channelOptions: sampleChannelOptions,
      summary: {
        instrument: envelope.instrument,
        action: envelope.action,
        ...(envelope.requestedNotionalUsdt !== undefined ? { notionalUsdt: envelope.requestedNotionalUsdt } : {}),
        ...(envelope.requestedLeverage !== undefined ? { leverage: envelope.requestedLeverage } : {}),
      },
      approvalExpiresAt: sampleApprovalExpiresAt,
      authorizationExpiresAt: sampleAuthorizationExpiresAt,
      previousEventHash: last.eventHash,
    },
    deps,
  );
  return { proposed, gateway, events: [...proposed.events, ...gateway.events] };
}

describe("Phase 1B acceptance", () => {
  it("allow → issues a single-use authorization directly", async () => {
    const store = new InMemoryLedgerStore();
    const expectedHead = await store.head(sampleWorkspaceId);
    const deps = sharedDeps();
    const { proposed, gateway, events } = proposeAndResolve(allowDecisionEnvelope, allowPolicy, deps, expectedHead);
    expect(proposed.decision.outcome).toBe("allow");
    expect(gateway.outcome).toBe("issued");

    await store.append(expectedHead, events);
    const stored = await store.read(sampleWorkspaceId, sampleRunId);
    verifyChain(stored);
    expect(stored.map((e) => e.eventType)).toEqual([
      "DecisionProposed",
      "DecisionValidated",
      "PolicyEvaluationStarted",
      "PolicyEvaluated",
      "AuthorizationIssued",
    ]);
    expect(runStatusProjection(stored) satisfies RunStatus).toBe("allowed");
    const approval = approvalProjection(stored);
    expect(approval.status).toBe("approved");
    expect(approval.authorizationId).toBeDefined();
  });

  it("require_approval → user approves → authorization issued", async () => {
    const store = new InMemoryLedgerStore();
    const expectedHead = await store.head(sampleWorkspaceId);
    const deps = sharedDeps();
    const { proposed, gateway, events: pre } = proposeAndResolve(
      approvalDecisionEnvelope,
      approvalPolicy,
      deps,
      expectedHead,
    );
    expect(proposed.decision.outcome).toBe("require_approval");
    expect(gateway.outcome).toBe("requested");

    const approved = approveApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: approvalProjection(pre),
        approvedBy: sampleApprovedBy,
        approvalChannel: sampleApprovalChannel,
        authorizationExpiresAt: sampleAuthorizationExpiresAt,
        previousEventHash: gateway.events.at(-1)!.eventHash,
      },
      deps,
    );
    expect(approved.outcome).toBe("approved");

    await store.append(expectedHead, [...pre, ...approved.events]);
    const stored = await store.read(sampleWorkspaceId, sampleRunId);
    verifyChain(stored);
    expect(stored.map((e) => e.eventType)).toEqual([
      "DecisionProposed",
      "DecisionValidated",
      "PolicyEvaluationStarted",
      "PolicyEvaluated",
      "ApprovalRequested",
      "ApprovalApproved",
      "AuthorizationIssued",
    ]);
    expect(runStatusProjection(stored) satisfies RunStatus).toBe("approval_required");
    const approval = approvalProjection(stored);
    expect(approval.status).toBe("approved");
    expect(approval.authorizationId).toBeDefined();
    expect(approval.authorizationExpiresAt).toBe(sampleAuthorizationExpiresAt);
  });

  it("require_approval → user rejects → no authorization", async () => {
    const store = new InMemoryLedgerStore();
    const expectedHead = await store.head(sampleWorkspaceId);
    const deps = sharedDeps();
    const { gateway, events: pre } = proposeAndResolve(approvalDecisionEnvelope, approvalPolicy, deps, expectedHead);

    const rejected = rejectApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: approvalProjection(pre),
        rejectedBy: sampleRejectedBy,
        rejectionChannel: sampleApprovalChannel,
        reason: "manual override",
        previousEventHash: gateway.events.at(-1)!.eventHash,
      },
      deps,
    );
    expect(rejected.outcome).toBe("rejected");

    await store.append(expectedHead, [...pre, ...rejected.events]);
    const stored = await store.read(sampleWorkspaceId, sampleRunId);
    verifyChain(stored);
    expect(stored.map((e) => e.eventType)).toEqual([
      "DecisionProposed",
      "DecisionValidated",
      "PolicyEvaluationStarted",
      "PolicyEvaluated",
      "ApprovalRequested",
      "ApprovalRejected",
    ]);
    // 1B does not close the run; a run-lifecycle event (Phase 2) would. Status stays put.
    expect(runStatusProjection(stored) satisfies RunStatus).toBe("approval_required");
    expect(approvalProjection(stored).status).toBe("rejected");
  });

  it("require_approval → deadline lapses → worker expires it", async () => {
    const store = new InMemoryLedgerStore();
    const expectedHead = await store.head(sampleWorkspaceId);
    const deps = sharedDeps();
    const { gateway, events: pre } = proposeAndResolve(approvalDecisionEnvelope, approvalPolicy, deps, expectedHead);

    // Reuse the same id generator + hash, but advance the clock past expiresAt.
    const expireDeps: ApprovalTransitionDeps = {
      clock: fixedClock("2026-06-08T00:10:00.000Z"),
      newId: deps.newId,
      hash: deps.hash,
    };
    const expired = expireApproval(
      {
        workspaceId: sampleWorkspaceId,
        approvalState: approvalProjection(pre),
        previousEventHash: gateway.events.at(-1)!.eventHash,
      },
      expireDeps,
    );
    expect(expired.outcome).toBe("expired");
    expect(expired.events[0]?.payload).toMatchObject({ expiredAt: "2026-06-08T00:10:00.000Z" });

    await store.append(expectedHead, [...pre, ...expired.events]);
    const stored = await store.read(sampleWorkspaceId, sampleRunId);
    verifyChain(stored);
    expect(stored.map((e) => e.eventType)).toEqual([
      "DecisionProposed",
      "DecisionValidated",
      "PolicyEvaluationStarted",
      "PolicyEvaluated",
      "ApprovalRequested",
      "ApprovalExpired",
    ]);
    expect(approvalProjection(stored).status).toBe("expired");
  });
});
```

- [ ] **Step 2: Run the acceptance test to verify it passes**

Run: `pnpm exec vitest run packages/domain/src/acceptance-phase1b.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Typecheck, build, and run the full suite**

Run: `pnpm typecheck`
Expected: PASS (no errors across all packages).

Run: `pnpm build`
Expected: PASS (clean `tsc --build`).

Run: `pnpm test`
Expected: PASS — every package's suite green, including the new Phase 1B tests and all retained
Phase 1A tests (no regressions).

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/acceptance-phase1b.test.ts
git commit -m "test(domain): add Phase 1B end-to-end acceptance suite"
```

---

## Done — Phase 1B Complete

After Task 9, Phase 1B is implemented: approval payloads + authorization payloads in `schemas`, the
pure single-use `evaluateAuthorizationUse` guard in `policy-engine`, run-status + approval
projections in `event-ledger`, deterministic fixtures, and the `resolveAuthorizationGateway` +
approve/reject/expire transitions in `domain`, all proven end-to-end. Per the active constraint,
**commit locally only — do not push** without an explicit instruction.

---
