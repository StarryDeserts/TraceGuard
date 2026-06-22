import { describe, it, expect } from "vitest";
import { InMemoryLedgerStore, sha256hex } from "@traceguard/event-ledger";
import { buildGatewayRuntime } from "../gateway-runtime.js";
import { createFakeUpstream } from "./fake-upstream.js";
import { counterIdGen, fixedClock } from "./deterministic-deps.js";
import { runScenario, type DecisionSpec } from "./scenario-driver.js";

const DECISION: DecisionSpec = {
  instrument: "BTC/USDT",
  marketType: "spot",
  action: "open_long",
  thesis: "Momentum breakout confirmed by volume.",
  evidenceRefs: ["note://btc-momentum"],
  requestedNotionalUsdt: "2500",
  confidence: 0.8,
};

async function freshRuntime() {
  const store = new InMemoryLedgerStore();
  return buildGatewayRuntime(
    {
      workspaceId: "ws-demo",
      providerConnectionId: "pc-demo",
      providerType: "bitget_agent_hub",
      toolManifestVersionId: "tmv-demo",
    },
    createFakeUpstream(),
    store,
    { clock: fixedClock(), newId: counterIdGen(), hash: sha256hex },
  );
}

describe("runScenario", () => {
  it("drives a full happy-path round-trip ending in execution", async () => {
    const runtime = await freshRuntime();
    const { transcript } = await runScenario({
      runtime,
      scenario: "happy",
      decision: DECISION,
      executionAdapter: "simulator",
    });
    expect(transcript.steps).toHaveLength(7);
    const kinds = transcript.steps.map((s) => s.kind);
    expect(kinds).toEqual([
      "run_started",
      "decision_proposed",
      "approval_requested",
      "approval_decided",
      "authorization_consumed",
      "execution_outcome",
      "run_finished",
    ]);
  });

  it("drives a denied path that stops before execution", async () => {
    const runtime = await freshRuntime();
    const { transcript } = await runScenario({
      runtime,
      scenario: "denied",
      decision: DECISION,
      executionAdapter: "simulator",
    });
    expect(transcript.steps).toHaveLength(5);
    const kinds = transcript.steps.map((s) => s.kind);
    expect(kinds).toEqual([
      "run_started",
      "decision_proposed",
      "approval_requested",
      "approval_decided",
      "run_finished",
    ]);
  });
});
