import { describe, it, expect } from "vitest";
import { mapTool } from "./map-tool.js";

describe("mapTool", () => {
  it("copies the RawUpstreamTool fields and drops _meta", () => {
    const sdkTool = {
      name: "withdraw",
      title: "Withdraw",
      description: "move funds",
      inputSchema: { type: "object", properties: { coin: { type: "string" } } },
      outputSchema: { type: "object" },
      annotations: { destructiveHint: true },
      _meta: { progressToken: "x" },
    };
    const mapped = mapTool(sdkTool);
    expect(mapped).toEqual({
      name: "withdraw",
      title: "Withdraw",
      description: "move funds",
      inputSchema: { type: "object", properties: { coin: { type: "string" } } },
      outputSchema: { type: "object" },
      annotations: { destructiveHint: true },
    });
    expect("_meta" in mapped).toBe(false);
  });

  it("omits absent optionals (no explicit-undefined keys)", () => {
    const mapped = mapTool({ name: "spot_get_ticker", inputSchema: { type: "object" } });
    expect(mapped).toEqual({ name: "spot_get_ticker", inputSchema: { type: "object" } });
    expect("title" in mapped).toBe(false);
    expect("description" in mapped).toBe(false);
    expect("outputSchema" in mapped).toBe(false);
    expect("annotations" in mapped).toBe(false);
  });

  it("maps a missing inputSchema to {}", () => {
    const mapped = mapTool({ name: "no_schema" });
    expect(mapped.inputSchema).toEqual({});
  });
});
