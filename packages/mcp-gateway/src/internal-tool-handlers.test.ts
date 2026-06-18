import { describe, it, expect } from "vitest";
import { SystemClock, SystemIdGen, sha256hex, InMemoryLedgerStore, approvalProjection } from "@traceguard/event-ledger";
import { createSimulatorAdapter } from "@traceguard/runtime";
import { approveApproval } from "@traceguard/domain";
import type { GatewayState } from "./gateway-state.js";
import { DEFAULT_POLICY } from "./default-policy.js";
import { createDecisionCache } from "./decision-cache.js";
import { isoPlusSeconds } from "./evaluation-context.js";
import type { InternalToolContext } from "./internal-tool-context.js";
import { dispatchInternalTool, eventsForApproval, mapExecReason } from "./internal-tool-handlers.js";

function gatewayState(): GatewayState {
  return { servedTools: [], route: new Map(), manifestHash: "a".repeat(64), toolCount: 0, degraded: false };
}

function context(clock: { now: () => string } = new SystemClock()): InternalToolContext {
  return {
    store: new InMemoryLedgerStore(),
    deps: { clock, newId: new SystemIdGen(), hash: sha256hex },
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

function mutableClock(instant = "2026-06-08T00:00:00.000Z") {
  let t = instant;
  return { now: () => t, set: (next: string) => void (t = next) };
}

// Mirrors the boot-gateway operator seam (handle.approve): out-of-band human approval.
async function approve(ctx: InternalToolContext, approvalId: string): Promise<string> {
  const ws = ctx.audit.workspaceId;
  const approvalState = approvalProjection(eventsForApproval(await ctx.store.read(ws), approvalId));
  const head = await ctx.store.head(ws);
  const res = approveApproval(
    {
      workspaceId: ws,
      approvalState,
      approvedBy: "ops",
      approvalChannel: "web",
      authorizationExpiresAt: isoPlusSeconds(ctx.deps.clock.now(), ctx.ttls.authorizationSeconds),
      previousEventHash: head,
    },
    ctx.deps,
  );
  if (res.events.length > 0) await ctx.store.append(head, res.events);
  return res.outcome;
}

// Drives start_run -> record(approval-sized) -> request_execution -> approve -> APPROVED.
async function toApproved(ctx: InternalToolContext, state: GatewayState) {
  await dispatchInternalTool(ctx, state, "traceguard_start_run", { runId: "run_demo" });
  const rec = await record(ctx, state, { requestedNotionalUsdt: "5000", requestedLeverage: "2" });
  const decisionId = tg(rec).decisionId as string;
  const exec = await dispatchInternalTool(ctx, state, "traceguard_request_execution", {
    runId: "run_demo",
    decisionId,
    executionAdapter: "simulator",
  });
  const approvalId = tg(exec).approvalId as string;
  expect(await approve(ctx, approvalId)).toBe("approved");
  const poll = await dispatchInternalTool(ctx, state, "traceguard_check_approval", { approvalId });
  expect(tg(poll).status).toBe("APPROVED");
  return { decisionId, approvalId, authorizationId: tg(poll).authorizationId as string };
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

describe("dispatchInternalTool — start_run workspace-mode validation (R6 hardening)", () => {
  it("rejects an unrecognized workspace mode with WORKSPACE_MODE_INVALID and does not start the run", async () => {
    const ctx = context();
    const state = gatewayState();
    const r = await dispatchInternalTool(ctx, state, "traceguard_start_run", {
      runId: "run_demo",
      mode: "yolo_autopilot",
    });
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect(tg(r).errorCode).toBe("WORKSPACE_MODE_INVALID");
    // Fail-closed: the bad mode is neither persisted onto the run nor used to start it.
    expect(ctx.run.mode).toBe("safe_demo");
    const events = await ctx.store.read(ctx.audit.workspaceId, ctx.run.runId);
    expect(events.some((e) => e.eventType === "RunStarted")).toBe(false);
  });

  it("accepts a recognized non-default workspace mode", async () => {
    const ctx = context();
    const state = gatewayState();
    const r = await dispatchInternalTool(ctx, state, "traceguard_start_run", {
      runId: "run_demo",
      mode: "approval_mode",
    });
    expect((r as { isError?: boolean }).isError).toBe(false);
    expect(tg(r).status).toBe("RUN_STARTED");
    expect(ctx.run.mode).toBe("approval_mode");
  });
});

describe("dispatchInternalTool — authorization-use guards (§11 criterion 4)", () => {
  it("a second execute_authorized_action on the same authorization returns AUTHORIZATION_CONSUMED", async () => {
    const ctx = context();
    const state = gatewayState();
    const { decisionId, authorizationId } = await toApproved(ctx, state);

    const first = await dispatchInternalTool(ctx, state, "traceguard_execute_authorized_action", {
      runId: "run_demo",
      decisionId,
      authorizationId,
      executionAdapter: "simulator",
    });
    expect(tg(first).status).toBe("EXECUTED");

    const second = await dispatchInternalTool(ctx, state, "traceguard_execute_authorized_action", {
      runId: "run_demo",
      decisionId,
      authorizationId,
      executionAdapter: "simulator",
    });
    expect((second as { isError?: boolean }).isError).toBe(true);
    expect(tg(second).errorCode).toBe("AUTHORIZATION_CONSUMED");
  });

  it("a mismatched action digest returns ACTION_DIGEST_MISMATCH", async () => {
    const ctx = context();
    const state = gatewayState();
    const { decisionId, authorizationId } = await toApproved(ctx, state);

    // Tamper the cached digest base after the authorization was bound to the original digest.
    const cached = ctx.cache.decisions.get(decisionId)!;
    ctx.cache.decisions.set(decisionId, {
      ...cached,
      digestBase: { ...cached.digestBase, requestedNotionalUsdt: "9999" },
    });

    const ex = await dispatchInternalTool(ctx, state, "traceguard_execute_authorized_action", {
      runId: "run_demo",
      decisionId,
      authorizationId,
      executionAdapter: "simulator",
    });
    expect((ex as { isError?: boolean }).isError).toBe(true);
    expect(tg(ex).errorCode).toBe("ACTION_DIGEST_MISMATCH");
  });

  it("a lapsed authorization returns APPROVAL_EXPIRED", async () => {
    const clock = mutableClock();
    const ctx = context(clock);
    const state = gatewayState();
    const { decisionId, authorizationId } = await toApproved(ctx, state);

    // Advance past the authorization's expiry window before executing.
    clock.set(isoPlusSeconds(clock.now(), ctx.ttls.authorizationSeconds + 60));

    const ex = await dispatchInternalTool(ctx, state, "traceguard_execute_authorized_action", {
      runId: "run_demo",
      decisionId,
      authorizationId,
      executionAdapter: "simulator",
    });
    expect((ex as { isError?: boolean }).isError).toBe(true);
    expect(tg(ex).errorCode).toBe("APPROVAL_EXPIRED");
  });

  it("rejects execute_authorized_action when the presented authorizationId is not the issued one", async () => {
    const ctx = context();
    const state = gatewayState();
    const { decisionId } = await toApproved(ctx, state);

    const ex = await dispatchInternalTool(ctx, state, "traceguard_execute_authorized_action", {
      runId: "run_demo",
      decisionId,
      authorizationId: "authz_forged",
      executionAdapter: "simulator",
    });
    expect((ex as { isError?: boolean }).isError).toBe(true);
    expect(tg(ex).errorCode).toBe("AUTHORIZATION_MISSING");
  });
});

describe("mapExecReason", () => {
  it("maps each execution-gate reason to its structured error code", () => {
    expect(mapExecReason("capability_unavailable")).toBe("CAPABILITY_UNAVAILABLE");
    expect(mapExecReason("snapshot_stale")).toBe("SNAPSHOT_STALE");
    expect(mapExecReason("manifest_unapproved")).toBe("MANIFEST_UNAPPROVED");
    expect(mapExecReason("workspace_locked")).toBe("WORKSPACE_LOCKED");
  });

  it("falls back to EXECUTION_FAILED for an unrecognized reason", () => {
    expect(mapExecReason("something_unexpected")).toBe("EXECUTION_FAILED");
  });
});
