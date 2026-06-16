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

  it("re-exports the 3E-1 internal-tool surface", () => {
    expect(typeof gateway.DEFAULT_POLICY).toBe("object");
    expect(gateway.NOTIONAL_APPROVAL_THRESHOLD_USDT).toBe("1000");
    expect(typeof gateway.createDecisionCache).toBe("function");
    expect(typeof gateway.buildEvaluationContext).toBe("function");
    expect(typeof gateway.intendedUpstreamTool).toBe("function");
    expect(gateway.INTERNAL_TOOL_NAMES instanceof Set).toBe(true);
    expect(Array.isArray(gateway.INTERNAL_TOOL_DEFS)).toBe(true);
    expect(typeof gateway.dispatchInternalTool).toBe("function");
    expect(typeof gateway.eventsForApproval).toBe("function");
  });
});
