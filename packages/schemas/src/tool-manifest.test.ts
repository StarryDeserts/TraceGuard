import { describe, expect, it } from "vitest";
import {
  NormalizedToolDefinition,
  ProviderType,
  RiskClass,
} from "./tool-manifest.js";

describe("RiskClass", () => {
  it("accepts the five severity classes plus unknown", () => {
    for (const c of [
      "public_read",
      "account_read",
      "trade_like",
      "asset_movement",
      "administrative",
      "unknown",
    ]) {
      expect(RiskClass.parse(c)).toBe(c);
    }
  });

  it("rejects an unlisted class", () => {
    expect(() => RiskClass.parse("nope")).toThrow();
  });
});

describe("ProviderType", () => {
  it("accepts the known provider types", () => {
    expect(ProviderType.parse("bitget_agent_hub")).toBe("bitget_agent_hub");
    expect(ProviderType.parse("custom_mcp")).toBe("custom_mcp");
    expect(ProviderType.parse("generic_rest")).toBe("generic_rest");
  });
});

describe("NormalizedToolDefinition", () => {
  const base = {
    providerConnectionId: "pc_1",
    providerType: "bitget_agent_hub",
    name: "spot_get_ticker",
    inputSchema: { type: "object" },
    normalizedJson: "{}",
    schemaHash: "abc",
    riskClass: "public_read",
  };

  it("parses a minimal valid definition", () => {
    expect(NormalizedToolDefinition.parse(base)).toMatchObject({ name: "spot_get_ticker" });
  });

  it("rejects unknown keys (strict)", () => {
    expect(() => NormalizedToolDefinition.parse({ ...base, extra: 1 })).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => NormalizedToolDefinition.parse({ ...base, name: "" })).toThrow();
  });
});
