import { describe, it, expect } from "vitest";
import { UpstreamUnavailableError, UpstreamListToolsError } from "./upstream-client.js";

describe("upstream error classes", () => {
  it("UpstreamUnavailableError carries name, message, and is an Error", () => {
    const err = new UpstreamUnavailableError("spawn failed");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("UpstreamUnavailableError");
    expect(err.message).toBe("spawn failed");
  });

  it("UpstreamListToolsError carries name, message, and is an Error", () => {
    const err = new UpstreamListToolsError("transport dropped");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("UpstreamListToolsError");
    expect(err.message).toBe("transport dropped");
  });

  it("preserves the error cause when provided", () => {
    const cause = new Error("root");
    const err = new UpstreamUnavailableError("wrapped", { cause });
    expect(err.cause).toBe(cause);
  });
});
