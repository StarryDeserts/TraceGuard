import { describe, it, expect } from "vitest";
import { InMemoryLedgerStore, sha256hex } from "@traceguard/event-ledger";
import { buildGatewayRuntime } from "./gateway-runtime.js";
import { createFakeUpstream } from "./demo/fake-upstream.js";
import { counterIdGen, fixedClock } from "./demo/deterministic-deps.js";
import type { BootGatewayArgs } from "./boot-gateway.js";

const ARGS: BootGatewayArgs = {
  workspaceId: "ws_demo",
  providerConnectionId: "pc_bitget_demo",
  providerType: "bitget_agent_hub",
  toolManifestVersionId: "tmv_demo",
};

describe("buildGatewayRuntime", () => {
  it("builds a usable runtime with adapters and a started run", async () => {
    const store = new InMemoryLedgerStore();
    const runtime = await buildGatewayRuntime(ARGS, createFakeUpstream(), store, {
      clock: fixedClock(),
      newId: counterIdGen(),
      hash: sha256hex,
    });

    expect(runtime.runId).toMatch(/^run_/);
    expect(runtime.state.degraded).toBe(false);
    expect(runtime.state.servedTools.map((t) => t.name)).toEqual(["spot_place_order"]);
    expect(runtime.internalCtx.adapters.simulator).toBeDefined();
    expect(runtime.internalCtx.adapters.bitget_live).toBeDefined();
    expect(typeof runtime.approve).toBe("function");
    expect(typeof runtime.reject).toBe("function");

    const events = await store.read("ws_demo");
    expect(events[events.length - 1]?.eventType).toBe("RunCreated");
  });
});
