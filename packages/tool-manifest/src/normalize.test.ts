import { describe, expect, it } from "vitest";
import type { RawUpstreamTool } from "@traceguard/schemas";
import { computeSchemaHash, normalizeToolDefinition } from "./normalize.js";

const identity = { providerConnectionId: "pc_1", providerType: "bitget_agent_hub" as const };
const hash = (s: string): string => `h(${s.length})`;

describe("normalizeToolDefinition", () => {
  it("classifies and emits a stable normalizedJson + schemaHash", () => {
    const raw: RawUpstreamTool = { name: "spot_get_ticker", inputSchema: { type: "object" } };
    const def = normalizeToolDefinition(raw, identity, { hash });
    expect(def.riskClass).toBe("public_read");
    expect(def.schemaHash).toBe(hash(JSON.stringify({ type: "object" })));
    expect(def.normalizedJson).toContain('"name":"spot_get_ticker"');
    expect(def.normalizedJson).toContain('"riskClass":"public_read"');
  });

  it("produces normalizedJson invariant to input key order", () => {
    const a = normalizeToolDefinition(
      { name: "spot_get_ticker", inputSchema: { b: 1, a: 2 } },
      identity,
      { hash },
    );
    const b = normalizeToolDefinition(
      { name: "spot_get_ticker", inputSchema: { a: 2, b: 1 } },
      identity,
      { hash },
    );
    expect(a.normalizedJson).toBe(b.normalizedJson);
  });

  it("validates through the strict schema (parse succeeds)", () => {
    const def = normalizeToolDefinition(
      { name: "withdraw", inputSchema: { type: "object" } },
      identity,
      { hash },
    );
    expect(def.riskClass).toBe("asset_movement");
  });
});

describe("computeSchemaHash", () => {
  it("hashes an empty object for a nullish schema", () => {
    expect(computeSchemaHash(undefined, { hash })).toBe(hash("{}"));
  });
});
