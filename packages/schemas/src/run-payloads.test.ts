import { describe, it, expect } from "vitest";
import { RunCompletedPayload, RunFailedPayload, RunStartedPayload } from "./run-payloads.js";

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
