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
