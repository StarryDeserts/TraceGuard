import { describe, it, expect } from "vitest";
import {
  ExecutionRequestedPayload,
  ExecutionCompletedPayload,
  ExecutionRejectedPayload,
  ExecutionUnknownPayload,
} from "./execution-payloads.js";

describe("ExecutionRequestedPayload", () => {
  it("accepts a well-formed request and rejects unknown keys", () => {
    const ok = ExecutionRequestedPayload.parse({
      executionId: "exec_1",
      runId: "run_1",
      decisionId: "dec_1",
      authorizationId: "authz_1",
      adapterType: "simulator",
      actionDigest: "digest_1",
      idempotencyKey: "execution:ws_1:run_1:dec_1:digest_1",
      requestRef: "execution:ws_1:run_1:dec_1:digest_1",
      requestHash: "hash_1",
    });
    expect(ok.adapterType).toBe("simulator");
    expect(() => ExecutionRequestedPayload.parse({ ...ok, extra: 1 })).toThrow();
  });

  it("allows authorizationId to be omitted", () => {
    expect(() =>
      ExecutionRequestedPayload.parse({
        executionId: "exec_1",
        runId: "run_1",
        decisionId: "dec_1",
        adapterType: "replay",
        actionDigest: "digest_1",
        idempotencyKey: "k",
        requestRef: "k",
        requestHash: "h",
      }),
    ).not.toThrow();
  });
});

describe("ExecutionCompletedPayload", () => {
  it("requires a final status from the allowed set and an ISO timestamp", () => {
    const ok = ExecutionCompletedPayload.parse({
      executionId: "exec_1",
      runId: "run_1",
      adapterType: "simulator",
      finalStatus: "simulated",
      receiptRef: "receipt:exec_1",
      receiptHash: "rh_1",
      completedAt: "2026-06-08T00:00:00.000Z",
    });
    expect(ok.finalStatus).toBe("simulated");
    expect(() => ExecutionCompletedPayload.parse({ ...ok, finalStatus: "bogus" })).toThrow();
    expect(() => ExecutionCompletedPayload.parse({ ...ok, completedAt: "not-a-time" })).toThrow();
  });
});

describe("ExecutionRejectedPayload", () => {
  it("pins executionSent to false and requires a rejection reason", () => {
    const ok = ExecutionRejectedPayload.parse({
      executionId: "exec_1",
      runId: "run_1",
      decisionId: "dec_1",
      reasonCode: "capability_unavailable",
      executionSent: false,
    });
    expect(ok.executionSent).toBe(false);
    expect(() => ExecutionRejectedPayload.parse({ ...ok, executionSent: true })).toThrow();
  });
});

describe("ExecutionUnknownPayload", () => {
  it("forces live-only reconciliation flags", () => {
    const ok = ExecutionUnknownPayload.parse({
      executionId: "exec_1",
      runId: "run_1",
      adapterType: "bitget_live",
      reasonCode: "timeout_after_submit",
      reconciliationRequired: true,
      retryBlocked: true,
    });
    expect(ok.reconciliationRequired).toBe(true);
    expect(() => ExecutionUnknownPayload.parse({ ...ok, adapterType: "simulator" })).toThrow();
    expect(() => ExecutionUnknownPayload.parse({ ...ok, retryBlocked: false })).toThrow();
  });
});
