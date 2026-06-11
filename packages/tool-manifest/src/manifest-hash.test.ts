import { describe, expect, it } from "vitest";
import type { NormalizedToolDefinition } from "@traceguard/schemas";
import { computeManifestHash, manifestFingerprint } from "./manifest-hash.js";

const def = (
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

const hash = (s: string): string => `h:${s}`;

describe("computeManifestHash", () => {
  it("is order-independent over the tool list", () => {
    const a = computeManifestHash(
      [def("b", "public_read", "s1"), def("a", "trade_like", "s2")],
      { hash },
    );
    const b = computeManifestHash(
      [def("a", "trade_like", "s2"), def("b", "public_read", "s1")],
      { hash },
    );
    expect(a).toBe(b);
  });

  it("changes when a tool's schemaHash changes", () => {
    const a = computeManifestHash([def("a", "public_read", "s1")], { hash });
    const b = computeManifestHash([def("a", "public_read", "s2")], { hash });
    expect(a).not.toBe(b);
  });

  it("changes when a tool's riskClass changes", () => {
    const a = computeManifestHash([def("a", "public_read", "s1")], { hash });
    const b = computeManifestHash([def("a", "trade_like", "s1")], { hash });
    expect(a).not.toBe(b);
  });

  it("incorporates the normalization version", () => {
    const a = computeManifestHash([def("a", "public_read", "s1")], { hash });
    expect(a).toContain('"normalizationVersion":1');
  });
});

describe("manifestFingerprint", () => {
  it("projects only name, riskClass, schemaHash", () => {
    expect(manifestFingerprint(def("a", "public_read", "s1"))).toEqual({
      name: "a",
      riskClass: "public_read",
      schemaHash: "s1",
    });
  });
});
