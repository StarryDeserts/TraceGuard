import { describe, it, expect } from "vitest";
import { fakeLiveAdapter, crashAdapter, sampleExecutionId } from "./execution-samples.js";

describe("fakeLiveAdapter", () => {
  it("advertises bitget_live and returns an unknown result", async () => {
    const adapter = fakeLiveAdapter();
    expect(adapter.adapterType).toBe("bitget_live");
    const result = await adapter.call();
    expect(result).toEqual({ kind: "unknown", reasonCode: "provider_status_unavailable" });
  });

  it("honours a custom reason code", async () => {
    const result = await fakeLiveAdapter("timeout_after_submit").call();
    expect(result).toEqual({ kind: "unknown", reasonCode: "timeout_after_submit" });
  });
});

describe("crashAdapter", () => {
  it("advertises simulator and throws on call", async () => {
    const adapter = crashAdapter();
    expect(adapter.adapterType).toBe("simulator");
    await expect(adapter.call()).rejects.toThrow("adapter crashed after burn");
  });
});

describe("samples", () => {
  it("exposes a stable execution id", () => {
    expect(sampleExecutionId).toBe("exec_000001");
  });
});
