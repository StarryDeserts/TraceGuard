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
