import { describe, it, expect } from "vitest";
import * as gateway from "./index.js";

describe("@traceguard/mcp-gateway barrel", () => {
  it("re-exports the public surface", () => {
    expect(typeof gateway.importManifest).toBe("function");
    expect(typeof gateway.mapTool).toBe("function");
    expect(typeof gateway.StdioUpstreamClient).toBe("function");
    expect(typeof gateway.UpstreamUnavailableError).toBe("function");
    expect(typeof gateway.UpstreamListToolsError).toBe("function");
  });
});
