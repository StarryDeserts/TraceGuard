import { describe, expect, it } from "vitest";
import { fixedClock, sequentialIdGen } from "@traceguard/testing-fixtures";
import type { RawUpstreamTool } from "@traceguard/schemas";
import { reconcileManifest, type ReconcileDeps } from "./reconcile.js";

function deps(): ReconcileDeps {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: (s: string) => `h:${s}` };
}

function raw(name: string, properties: Record<string, unknown> = {}): RawUpstreamTool {
  return { name, inputSchema: { type: "object", properties } };
}

describe("reconcileManifest — Case 1 (first import)", () => {
  it("emits ToolManifestImported then per-tool defaults", () => {
    const result = reconcileManifest(
      {
        workspaceId: "ws_1",
        providerConnectionId: "pc_1",
        providerType: "bitget_agent_hub",
        toolManifestVersionId: "tmv_1",
        observed: [raw("spot_get_ticker"), raw("withdraw"), raw("mystery_tool")],
      },
      deps(),
    );

    const types = result.events.map((e) => e.eventType);
    expect(types[0]).toBe("ToolManifestImported");
    expect(types.filter((t) => t === "ToolFrozen")).toHaveLength(1);
    expect(types.filter((t) => t === "ToolBlocked")).toHaveLength(1);
  });

  it("hash-chains the emitted events (first link is undefined)", () => {
    const result = reconcileManifest(
      {
        workspaceId: "ws_1",
        providerConnectionId: "pc_1",
        providerType: "bitget_agent_hub",
        toolManifestVersionId: "tmv_1",
        observed: [raw("spot_get_ticker"), raw("withdraw")],
      },
      deps(),
    );

    expect(result.events[0]!.previousEventHash).toBeUndefined();
    expect(result.events[1]!.previousEventHash).toBe(result.events[0]!.eventHash);
  });

  it("tags the manifest event on tool_manifest and tool events on tool_definition", () => {
    const result = reconcileManifest(
      {
        workspaceId: "ws_1",
        providerConnectionId: "pc_1",
        providerType: "bitget_agent_hub",
        toolManifestVersionId: "tmv_1",
        observed: [raw("withdraw")],
      },
      deps(),
    );

    expect(result.events[0]!.aggregateType).toBe("tool_manifest");
    expect(result.events[0]!.aggregateId).toBe("tmv_1");
    expect(result.events[1]!.aggregateType).toBe("tool_definition");
    expect(result.events[1]!.aggregateId).toBe("pc_1:withdraw");
  });
});

describe("reconcileManifest — Case 2 (no-op)", () => {
  it("emits nothing when the observed hash matches the approved hash", () => {
    const first = reconcileManifest(
      {
        workspaceId: "ws_1",
        providerConnectionId: "pc_1",
        providerType: "bitget_agent_hub",
        toolManifestVersionId: "tmv_1",
        observed: [raw("spot_get_ticker"), raw("withdraw")],
      },
      deps(),
    );

    const second = reconcileManifest(
      {
        workspaceId: "ws_1",
        providerConnectionId: "pc_1",
        providerType: "bitget_agent_hub",
        toolManifestVersionId: "tmv_2",
        observed: [raw("spot_get_ticker"), raw("withdraw")],
        approved: {
          manifestHash: first.manifestHash,
          tools: first.normalized.map((d) => ({
            name: d.name,
            riskClass: d.riskClass,
            schemaHash: d.schemaHash,
          })),
        },
      },
      deps(),
    );

    expect(second.events).toHaveLength(0);
  });
});

describe("reconcileManifest — Case 3 (drift)", () => {
  it("emits ToolManifestChanged plus freeze/block for the delta", () => {
    const result = reconcileManifest(
      {
        workspaceId: "ws_1",
        providerConnectionId: "pc_1",
        providerType: "bitget_agent_hub",
        toolManifestVersionId: "tmv_2",
        observed: [raw("withdraw", { coin: { type: "string" } }), raw("manage_subaccounts")],
        approved: {
          manifestHash: "h:stale",
          tools: [{ name: "withdraw", riskClass: "asset_movement", schemaHash: "h:old" }],
        },
      },
      deps(),
    );

    const types = result.events.map((e) => e.eventType);
    expect(types[0]).toBe("ToolManifestChanged");
    expect(types).toContain("ToolFrozen");
    expect(types).toContain("ToolBlocked");
  });
});
