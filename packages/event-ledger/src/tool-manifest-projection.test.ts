import { describe, it, expect } from "vitest";
import type { LedgerEvent } from "@traceguard/schemas";
import { toolManifestProjection } from "./tool-manifest-projection.js";

function ev(
  eventType: string,
  payload: unknown,
  aggregateType: "tool_manifest" | "tool_definition" = "tool_manifest",
): LedgerEvent {
  return {
    id: `evt_${eventType}`,
    workspaceId: "ws_1",
    aggregateType,
    aggregateId: "tmv_1",
    eventType,
    eventVersion: 1,
    schemaVersion: 1,
    occurredAt: "2026-06-08T00:00:00.000Z",
    recordedAt: "2026-06-08T00:00:00.000Z",
    actorType: "system",
    payload,
    payloadHash: "ph",
    eventHash: `eh_${eventType}`,
  };
}

const importEvent = ev("ToolManifestImported", {
  toolManifestVersionId: "tmv_1",
  providerConnectionId: "pc_1",
  manifestHash: "h:m1",
  normalizationVersion: 1,
  tools: [
    { name: "spot_get_ticker", riskClass: "public_read", schemaHash: "s1" },
    { name: "withdraw", riskClass: "asset_movement", schemaHash: "s2" },
    { name: "mystery", riskClass: "unknown", schemaHash: "s3" },
  ],
});

describe("toolManifestProjection", () => {
  it("returns an empty inventory for an empty stream", () => {
    const view = toolManifestProjection([]);
    expect(view.tools).toEqual([]);
    expect(view.manifestHash).toBeUndefined();
  });

  it("materializes per-class default statuses from an import", () => {
    const view = toolManifestProjection([importEvent]);
    expect(view.providerConnectionId).toBe("pc_1");
    expect(view.manifestHash).toBe("h:m1");
    expect(view.normalizationVersion).toBe(1);
    const byName = Object.fromEntries(view.tools.map((t) => [t.name, t]));
    expect(byName.spot_get_ticker).toMatchObject({ status: "active", visible: true });
    expect(byName.withdraw).toMatchObject({ status: "blocked", visible: false });
    expect(byName.mystery).toMatchObject({ status: "frozen", visible: false });
  });

  it("sorts the materialized tools by name", () => {
    const view = toolManifestProjection([importEvent]);
    expect(view.tools.map((t) => t.name)).toEqual(["mystery", "spot_get_ticker", "withdraw"]);
  });

  it("records a freeze reason from ToolFrozen", () => {
    const frozen = ev(
      "ToolFrozen",
      { providerConnectionId: "pc_1", toolName: "mystery", manifestHash: "h:m1", reasonCode: "unknown_risk" },
      "tool_definition",
    );
    const view = toolManifestProjection([importEvent, frozen]);
    expect(view.tools.find((t) => t.name === "mystery")).toMatchObject({
      status: "frozen",
      freezeReason: "unknown_risk",
    });
  });

  it("removes a tool on a ToolManifestChanged removal", () => {
    const changed = ev("ToolManifestChanged", {
      toolManifestVersionId: "tmv_2",
      providerConnectionId: "pc_1",
      previousManifestHash: "h:m1",
      manifestHash: "h:m2",
      added: [],
      removed: ["withdraw"],
      changed: [],
    });
    const view = toolManifestProjection([importEvent, changed]);
    expect(view.manifestHash).toBe("h:m2");
    expect(view.tools.find((t) => t.name === "withdraw")).toBeUndefined();
  });

  it("adds a blocked tool on a ToolManifestChanged addition", () => {
    const changed = ev("ToolManifestChanged", {
      toolManifestVersionId: "tmv_2",
      providerConnectionId: "pc_1",
      previousManifestHash: "h:m1",
      manifestHash: "h:m2",
      added: [{ name: "transfer", riskClass: "asset_movement", schemaHash: "s9" }],
      removed: [],
      changed: [],
    });
    const view = toolManifestProjection([importEvent, changed]);
    expect(view.tools.find((t) => t.name === "transfer")).toMatchObject({
      status: "blocked",
      visible: false,
    });
  });

  it("freezes a sensitive change, then releases it to class default on approval", () => {
    const changed = ev("ToolManifestChanged", {
      toolManifestVersionId: "tmv_2",
      providerConnectionId: "pc_1",
      previousManifestHash: "h:m1",
      manifestHash: "h:m2",
      added: [],
      removed: [],
      changed: [{ name: "withdraw", previousSchemaHash: "s2", schemaHash: "s2b", sensitive: true }],
    });
    const frozen = ev(
      "ToolFrozen",
      { providerConnectionId: "pc_1", toolName: "withdraw", manifestHash: "h:m2", reasonCode: "changed_sensitive" },
      "tool_definition",
    );
    const afterFreeze = toolManifestProjection([importEvent, changed, frozen]);
    expect(afterFreeze.tools.find((t) => t.name === "withdraw")).toMatchObject({
      status: "frozen",
      freezeReason: "changed_sensitive",
    });

    const approved = ev("ToolManifestApproved", {
      toolManifestVersionId: "tmv_2",
      providerConnectionId: "pc_1",
      manifestHash: "h:m2",
      approvedBy: "user_1",
      approvedAt: "2026-06-08T00:00:00.000Z",
    });
    const afterApprove = toolManifestProjection([importEvent, changed, frozen, approved]);
    expect(afterApprove.approvedManifestHash).toBe("h:m2");
    const released = afterApprove.tools.find((t) => t.name === "withdraw");
    expect(released).toMatchObject({ status: "blocked" });
    expect(released?.freezeReason).toBeUndefined();
  });

  it("keeps an unknown-risk freeze frozen across approval", () => {
    const frozen = ev(
      "ToolFrozen",
      { providerConnectionId: "pc_1", toolName: "mystery", manifestHash: "h:m1", reasonCode: "unknown_risk" },
      "tool_definition",
    );
    const approved = ev("ToolManifestApproved", {
      toolManifestVersionId: "tmv_1",
      providerConnectionId: "pc_1",
      manifestHash: "h:m1",
      approvedBy: "user_1",
      approvedAt: "2026-06-08T00:00:00.000Z",
    });
    const view = toolManifestProjection([importEvent, frozen, approved]);
    expect(view.tools.find((t) => t.name === "mystery")).toMatchObject({
      status: "frozen",
      freezeReason: "unknown_risk",
    });
  });
});
