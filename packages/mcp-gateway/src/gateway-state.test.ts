import { describe, it, expect } from "vitest";
import { reconcileManifest, type ReconcileManifestArgs } from "@traceguard/tool-manifest";
import { toolManifestProjection, sha256hex } from "@traceguard/event-ledger";
import {
  bitget36RawTools,
  bitgetManifestHashV1,
  fixedClock,
  sequentialIdGen,
} from "@traceguard/testing-fixtures";
import { selectServedTools, buildGatewayState, degradedState } from "./gateway-state.js";

function makeDeps() {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

const baseArgs: Omit<ReconcileManifestArgs, "observed"> = {
  workspaceId: "ws_demo",
  providerConnectionId: "pc_bitget",
  providerType: "bitget_agent_hub",
  toolManifestVersionId: "tmv_1",
};

describe("selectServedTools / buildGatewayState", () => {
  it("selects exactly the 32 governed-visible tools, excluding the 4 blocked", () => {
    const result = reconcileManifest({ ...baseArgs, observed: bitget36RawTools }, makeDeps());
    const view = toolManifestProjection(result.events);
    const served = selectServedTools(result.normalized, view);

    expect(served).toHaveLength(32);
    const names = served.map((t) => t.name);
    for (const blocked of ["transfer", "withdraw", "cancel_withdrawal", "manage_subaccounts"]) {
      expect(names).not.toContain(blocked);
    }
    const ticker = served.find((t) => t.name === "spot_get_ticker");
    expect(ticker).toBeDefined();
    expect(ticker?.inputSchema).toBeDefined();
  });

  it("is sorted by name", () => {
    const result = reconcileManifest({ ...baseArgs, observed: bitget36RawTools }, makeDeps());
    const view = toolManifestProjection(result.events);
    const names = selectServedTools(result.normalized, view).map((t) => t.name);
    expect(names).toEqual([...names].sort());
  });

  it("reproduces the golden manifest hash (fixture intact)", () => {
    const result = reconcileManifest({ ...baseArgs, observed: bitget36RawTools }, makeDeps());
    expect(result.manifestHash).toBe(bitgetManifestHashV1);
  });

  it("buildGatewayState wraps the selection with counts and degraded=false", () => {
    const result = reconcileManifest({ ...baseArgs, observed: bitget36RawTools }, makeDeps());
    const view = toolManifestProjection(result.events);
    const state = buildGatewayState({
      normalized: result.normalized,
      view,
      manifestHash: result.manifestHash,
      toolCount: bitget36RawTools.length,
    });
    expect(state.servedTools).toHaveLength(32);
    expect(state.toolCount).toBe(36);
    expect(state.degraded).toBe(false);
    expect(state.manifestHash).toBe(bitgetManifestHashV1);
  });

  it("degradedState exposes zero tools and a null manifest hash", () => {
    expect(degradedState()).toEqual({
      servedTools: [],
      manifestHash: null,
      toolCount: 0,
      degraded: true,
    });
  });
});
