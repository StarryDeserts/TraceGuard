import { describe, it, expect } from "vitest";
import { RunCompletedPayload, RunFailedPayload } from "./run-payloads.js";

describe("RunCompletedPayload", () => {
  it("accepts an optional executionId and rejects unknown keys", () => {
    const ok = RunCompletedPayload.parse({
      runId: "run_1",
      completedAt: "2026-06-08T00:00:00.000Z",
      executionId: "exec_1",
    });
    expect(ok.executionId).toBe("exec_1");
    expect(() => RunCompletedPayload.parse({ runId: "run_1", completedAt: "2026-06-08T00:00:00.000Z" })).not.toThrow();
    expect(() => RunCompletedPayload.parse({ ...ok, extra: 1 })).toThrow();
  });
});

describe("RunFailedPayload", () => {
  it("requires a known failure reason and an ISO timestamp", () => {
    const ok = RunFailedPayload.parse({
      runId: "run_1",
      failedAt: "2026-06-08T00:00:00.000Z",
      reasonCode: "orchestrator_error",
    });
    expect(ok.reasonCode).toBe("orchestrator_error");
    expect(() => RunFailedPayload.parse({ ...ok, reasonCode: "other" })).toThrow();
    expect(() => RunFailedPayload.parse({ ...ok, failedAt: "nope" })).toThrow();
  });
});
