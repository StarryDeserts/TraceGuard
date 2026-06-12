import { describe, expect, it } from "vitest";
import { bitget36RawTools } from "./bitget-tools.js";

describe("bitget36RawTools", () => {
  it("contains exactly 36 tools", () => {
    expect(bitget36RawTools).toHaveLength(36);
  });

  it("has unique tool names", () => {
    const names = new Set(bitget36RawTools.map((t) => t.name));
    expect(names.size).toBe(36);
  });

  it("gives every tool an object inputSchema", () => {
    for (const t of bitget36RawTools) {
      expect(t.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("keeps get_deposit_address input to a single non-sensitive field", () => {
    const dep = bitget36RawTools.find((t) => t.name === "get_deposit_address");
    expect(dep?.inputSchema).toEqual({ type: "object", properties: { coin: { type: "string" } } });
  });
});
