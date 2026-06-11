import { describe, expect, it } from "vitest";
import {
  ToolBlockedPayload,
  ToolFrozenPayload,
  ToolManifestApprovedPayload,
  ToolManifestChangedPayload,
  ToolManifestImportedPayload,
} from "./tool-manifest-payloads.js";

describe("ToolManifestImportedPayload", () => {
  it("parses a valid import payload", () => {
    expect(
      ToolManifestImportedPayload.parse({
        toolManifestVersionId: "tmv_1",
        providerConnectionId: "pc_1",
        manifestHash: "h",
        normalizationVersion: 1,
        tools: [{ name: "spot_get_ticker", riskClass: "public_read", schemaHash: "s" }],
      }),
    ).toMatchObject({ toolManifestVersionId: "tmv_1" });
  });

  it("rejects unknown keys", () => {
    expect(() =>
      ToolManifestImportedPayload.parse({
        toolManifestVersionId: "tmv_1",
        providerConnectionId: "pc_1",
        manifestHash: "h",
        normalizationVersion: 1,
        tools: [],
        extra: true,
      }),
    ).toThrow();
  });
});

describe("ToolManifestChangedPayload", () => {
  it("parses added/removed/changed", () => {
    expect(
      ToolManifestChangedPayload.parse({
        toolManifestVersionId: "tmv_2",
        providerConnectionId: "pc_1",
        previousManifestHash: "h1",
        manifestHash: "h2",
        added: [{ name: "new_tool", riskClass: "trade_like", schemaHash: "s" }],
        removed: ["old_tool"],
        changed: [
          {
            name: "spot_place_order",
            previousSchemaHash: "a",
            schemaHash: "b",
            sensitive: true,
          },
        ],
      }),
    ).toMatchObject({ manifestHash: "h2" });
  });
});

describe("ToolFrozenPayload", () => {
  it("accepts the freeze reason codes", () => {
    for (const reasonCode of ["changed_sensitive", "unknown_risk"]) {
      expect(
        ToolFrozenPayload.parse({
          providerConnectionId: "pc_1",
          toolName: "x",
          manifestHash: "h",
          reasonCode,
        }),
      ).toMatchObject({ reasonCode });
    }
  });
});

describe("ToolBlockedPayload", () => {
  it("accepts the block reason codes", () => {
    for (const reasonCode of ["risk_class_default", "operator_blocklist"]) {
      expect(
        ToolBlockedPayload.parse({
          providerConnectionId: "pc_1",
          toolName: "withdraw",
          riskClass: "asset_movement",
          manifestHash: "h",
          reasonCode,
        }),
      ).toMatchObject({ reasonCode });
    }
  });
});

describe("ToolManifestApprovedPayload", () => {
  it("parses an approval payload", () => {
    expect(
      ToolManifestApprovedPayload.parse({
        toolManifestVersionId: "tmv_1",
        providerConnectionId: "pc_1",
        manifestHash: "h",
        approvedBy: "user_1",
        approvedAt: "2026-06-11T00:00:00.000Z",
      }),
    ).toMatchObject({ approvedBy: "user_1" });
  });
});
