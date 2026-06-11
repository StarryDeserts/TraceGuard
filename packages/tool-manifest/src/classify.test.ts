import { describe, expect, it } from "vitest";
import type { RawUpstreamTool } from "@traceguard/schemas";
import { classifyRisk } from "./classify.js";

const raw = (over: Partial<RawUpstreamTool> & { name: string }): RawUpstreamTool => ({
  inputSchema: { type: "object" },
  ...over,
});

describe("classifyRisk recognition gate", () => {
  it("returns unknown for an unrecognized tool", () => {
    expect(classifyRisk(raw({ name: "mystery_tool" }), "bitget_agent_hub")).toBe("unknown");
  });

  it("returns the base class for a recognized read tool", () => {
    expect(classifyRisk(raw({ name: "spot_get_ticker" }), "bitget_agent_hub")).toBe(
      "public_read",
    );
  });

  it("short-circuits raise rules for an unrecognized tool", () => {
    const tool = raw({ name: "mystery_tool", annotations: { destructiveHint: true } });
    expect(classifyRisk(tool, "bitget_agent_hub")).toBe("unknown");
  });
});

describe("classifyRisk raise rules", () => {
  it("raises to asset_movement via a sensitive schema field", () => {
    const tool = raw({
      name: "spot_get_ticker",
      inputSchema: { type: "object", properties: { withdrawAddress: { type: "string" } } },
    });
    expect(classifyRisk(tool, "bitget_agent_hub")).toBe("asset_movement");
  });

  it("raises a read tool to trade_like via a write annotation", () => {
    const tool = raw({ name: "spot_get_ticker", annotations: { readOnlyHint: false } });
    expect(classifyRisk(tool, "bitget_agent_hub")).toBe("trade_like");
  });

  it("raises via a [DANGER] tag in the description", () => {
    const tool = raw({ name: "spot_get_ticker", description: "[DANGER] do not use" });
    expect(classifyRisk(tool, "bitget_agent_hub")).toBe("asset_movement");
  });

  it("never lowers a higher base class (join is raise-only)", () => {
    const tool = raw({ name: "withdraw", description: "[CAUTION] moves funds" });
    expect(classifyRisk(tool, "bitget_agent_hub")).toBe("asset_movement");
  });

  it("finds sensitive fields nested under array items", () => {
    const tool = raw({
      name: "spot_get_ticker",
      inputSchema: {
        type: "object",
        properties: {
          batch: { type: "array", items: { type: "object", properties: { chain: {} } } },
        },
      },
    });
    expect(classifyRisk(tool, "bitget_agent_hub")).toBe("asset_movement");
  });
});
