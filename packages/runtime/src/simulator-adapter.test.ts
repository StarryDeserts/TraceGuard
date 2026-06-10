import { describe, it, expect } from "vitest";
import { sha256hex } from "@traceguard/event-ledger";
import type { ExecutionRequest } from "@traceguard/domain";
import { createSimulatorAdapter } from "./simulator-adapter.js";

function request(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    executionId: "exec_1",
    runId: "run_1",
    decisionId: "dec_1",
    authorizationId: "auth_1",
    actionDigest: "digest_1",
    idempotencyKey: "idem_1",
    requestRef: "decision:dec_1",
    requestHash: "rh_1",
    ...overrides,
  };
}

describe("createSimulatorAdapter", () => {
  it("returns a completed simulated result", async () => {
    const adapter = createSimulatorAdapter({ hash: sha256hex });
    const result = await adapter.call(request());
    expect(result).toEqual({
      kind: "completed",
      finalStatus: "simulated",
      receiptRef: "receipt:exec_1",
      receiptHash: sha256hex("receipt:exec_1:rh_1"),
    });
  });

  it("has adapterType simulator", () => {
    const adapter = createSimulatorAdapter({ hash: sha256hex });
    expect(adapter.adapterType).toBe("simulator");
  });

  it("derives the receipt deterministically from the request hash", async () => {
    const adapter = createSimulatorAdapter({ hash: sha256hex });
    const a = await adapter.call(request({ requestHash: "rh_A" }));
    const b = await adapter.call(request({ requestHash: "rh_A" }));
    expect(a).toEqual(b);
  });
});
