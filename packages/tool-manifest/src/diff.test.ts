import { describe, expect, it } from "vitest";
import type { NormalizedToolDefinition, ToolManifestEntry } from "@traceguard/schemas";
import { diffManifest } from "./diff.js";

const entry = (name: string, riskClass: string, schemaHash: string): ToolManifestEntry =>
  ({ name, riskClass, schemaHash }) as ToolManifestEntry;

const obs = (
  name: string,
  riskClass: string,
  schemaHash: string,
): NormalizedToolDefinition =>
  ({
    providerConnectionId: "pc_1",
    providerType: "bitget_agent_hub",
    name,
    inputSchema: {},
    normalizedJson: "{}",
    schemaHash,
    riskClass,
  }) as NormalizedToolDefinition;

describe("diffManifest", () => {
  it("detects added tools", () => {
    const d = diffManifest([], [obs("a", "public_read", "s1")]);
    expect(d.added).toEqual([entry("a", "public_read", "s1")]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it("detects removed tools", () => {
    const d = diffManifest([entry("a", "public_read", "s1")], []);
    expect(d.removed).toEqual(["a"]);
    expect(d.added).toEqual([]);
  });

  it("flags a sensitive-class schema change as sensitive", () => {
    const d = diffManifest(
      [entry("withdraw", "asset_movement", "s1")],
      [obs("withdraw", "asset_movement", "s2")],
    );
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]).toMatchObject({
      name: "withdraw",
      previousSchemaHash: "s1",
      schemaHash: "s2",
      sensitive: true,
    });
  });

  it("flags a read-tool schema change as not sensitive", () => {
    const d = diffManifest(
      [entry("spot_get_ticker", "public_read", "s1")],
      [obs("spot_get_ticker", "public_read", "s2")],
    );
    expect(d.changed[0]).toMatchObject({ sensitive: false });
  });

  it("treats a risk-class escalation into a sensitive class as sensitive", () => {
    const d = diffManifest(
      [entry("x", "public_read", "s1")],
      [obs("x", "trade_like", "s1")],
    );
    expect(d.changed[0]).toMatchObject({
      previousRiskClass: "public_read",
      riskClass: "trade_like",
      sensitive: true,
    });
  });

  it("emits nothing when approved and observed match", () => {
    const d = diffManifest(
      [entry("a", "public_read", "s1")],
      [obs("a", "public_read", "s1")],
    );
    expect(d).toEqual({ added: [], removed: [], changed: [] });
  });

  it("sorts all three arrays by name", () => {
    const d = diffManifest(
      [entry("z", "public_read", "s"), entry("y", "public_read", "s")],
      [obs("b", "public_read", "s"), obs("a", "public_read", "s")],
    );
    expect(d.added.map((t) => t.name)).toEqual(["a", "b"]);
    expect(d.removed).toEqual(["y", "z"]);
  });
});
