import { describe, it, expect } from "vitest";
import { SystemClock, SystemIdGen, sha256hex, InMemoryLedgerStore } from "@traceguard/event-ledger";
import { createSimulatorAdapter } from "@traceguard/runtime";
import type { GatewayState } from "./gateway-state.js";
import { DEFAULT_POLICY } from "./default-policy.js";
import { createDecisionCache } from "./decision-cache.js";
import type { InternalToolContext } from "./internal-tool-context.js";
import { dispatchInternalTool } from "./internal-tool-handlers.js";

function gatewayState(): GatewayState {
  return { servedTools: [], route: new Map(), manifestHash: "a".repeat(64), toolCount: 0, degraded: false };
}

function context(): InternalToolContext {
  return {
    store: new InMemoryLedgerStore(),
    deps: { clock: new SystemClock(), newId: new SystemIdGen(), hash: sha256hex },
    audit: { workspaceId: "ws_demo", runId: "run_demo", providerConnectionId: "pc_bitget" },
    policy: DEFAULT_POLICY,
    adapter: createSimulatorAdapter({ hash: sha256hex }),
    run: { runId: "run_demo", mode: "safe_demo" },
    cache: createDecisionCache(),
    ttls: { approvalSeconds: 900, authorizationSeconds: 900 },
  };
}

function tg(r: unknown): Record<string, unknown> {
  return ((r as { traceguard?: Record<string, unknown> }).traceguard ?? {}) as Record<string, unknown>;
}

async function record(ctx: InternalToolContext, state: GatewayState, over: Record<string, unknown>) {
  return dispatchInternalTool(ctx, state, "traceguard_record_decision", {
    runId: "run_demo",
    instrument: "BTCUSDT",
    marketType: "futures",
    action: "open_long",
    thesis: "t",
    evidenceRefs: ["ev:1"],
    ...over,
  });
}

describe("dispatchInternalTool", () => {
  it("start_run emits RunStarted and returns RUN_STARTED", async () => {
    const ctx = context();
    const r = await dispatchInternalTool(ctx, gatewayState(), "traceguard_start_run", {
      runId: "run_demo",
      agentName: "demo-agent",
      intent: "rebalance",
    });
    expect(tg(r).status).toBe("RUN_STARTED");
    expect(tg(r).toolManifestHash).toBe("a".repeat(64));
    expect(ctx.run.agentName).toBe("demo-agent");
    expect((r as { isError?: boolean }).isError).toBe(false);
  });

  it("runs the allow path end-to-end to ALLOWED with a receipt", async () => {
    const ctx = context();
    const state = gatewayState();
    await dispatchInternalTool(ctx, state, "traceguard_start_run", { runId: "run_demo" });
    const rec = await record(ctx, state, { requestedNotionalUsdt: "100", requestedLeverage: "2" });
    expect(tg(rec).status).toBe("validated");
    const decisionId = tg(rec).decisionId as string;

    const exec = await dispatchInternalTool(ctx, state, "traceguard_request_execution", {
      runId: "run_demo",
      decisionId,
      executionAdapter: "simulator",
    });
    expect(tg(exec).status).toBe("ALLOWED");
    expect(typeof tg(exec).executionId).toBe("string");
    expect((tg(exec).receipt as { receiptRef?: string }).receiptRef).toMatch(/^receipt:/);
    expect((tg(exec).receipt as { finalStatus?: string }).finalStatus).toBe("simulated");
  });

  it("blocks a high-leverage decision with POLICY_BLOCKED", async () => {
    const ctx = context();
    const state = gatewayState();
    await dispatchInternalTool(ctx, state, "traceguard_start_run", { runId: "run_demo" });
    const rec = await record(ctx, state, { requestedNotionalUsdt: "100", requestedLeverage: "5" });
    const decisionId = tg(rec).decisionId as string;

    const exec = await dispatchInternalTool(ctx, state, "traceguard_request_execution", {
      runId: "run_demo",
      decisionId,
      executionAdapter: "simulator",
    });
    expect((exec as { isError?: boolean }).isError).toBe(true);
    expect(tg(exec).errorCode).toBe("POLICY_BLOCKED");
    expect(tg(exec).executionSent).toBe(false);
    expect(Array.isArray(tg(exec).matchedRules)).toBe(true);
  });

  it("requires approval for large notional and then reports PENDING", async () => {
    const ctx = context();
    const state = gatewayState();
    await dispatchInternalTool(ctx, state, "traceguard_start_run", { runId: "run_demo" });
    const rec = await record(ctx, state, { requestedNotionalUsdt: "5000", requestedLeverage: "2" });
    const decisionId = tg(rec).decisionId as string;

    const exec = await dispatchInternalTool(ctx, state, "traceguard_request_execution", {
      runId: "run_demo",
      decisionId,
      executionAdapter: "simulator",
    });
    expect((exec as { isError?: boolean }).isError).toBe(false);
    expect(tg(exec).status).toBe("APPROVAL_REQUIRED");
    const approvalId = tg(exec).approvalId as string;
    expect(typeof approvalId).toBe("string");

    const poll = await dispatchInternalTool(ctx, state, "traceguard_check_approval", { approvalId });
    expect(tg(poll).status).toBe("PENDING");
  });

  it("rejects non-simulator adapters with CAPABILITY_UNAVAILABLE", async () => {
    const ctx = context();
    const state = gatewayState();
    await dispatchInternalTool(ctx, state, "traceguard_start_run", { runId: "run_demo" });
    const rec = await record(ctx, state, { requestedNotionalUsdt: "100", requestedLeverage: "2" });
    const decisionId = tg(rec).decisionId as string;
    const exec = await dispatchInternalTool(ctx, state, "traceguard_request_execution", {
      runId: "run_demo",
      decisionId,
      executionAdapter: "bitget_live",
    });
    expect(tg(exec).errorCode).toBe("CAPABILITY_UNAVAILABLE");
  });

  it("returns DECISION_INVALID for an unknown decisionId", async () => {
    const ctx = context();
    const exec = await dispatchInternalTool(ctx, gatewayState(), "traceguard_request_execution", {
      runId: "run_demo",
      decisionId: "dec_missing",
    });
    expect(tg(exec).errorCode).toBe("DECISION_INVALID");
  });

  it("rejects a runId that does not match the active run", async () => {
    const ctx = context();
    const r = await dispatchInternalTool(ctx, gatewayState(), "traceguard_record_decision", { runId: "run_other" });
    expect(tg(r).errorCode).toBe("RUN_NOT_FOUND");
  });
});
