import { describe, it, expect } from "vitest";
import type { LedgerEvent } from "@traceguard/schemas";
import { buildTranscript } from "./transcript-model.js";

// buildTranscript reads only eventType, payload, and workspaceId, so a minimal
// cast keeps these fixtures honest without fabricating hash-chain fields.
function ev(eventType: string, payload: Record<string, unknown>): LedgerEvent {
  return { eventType, payload, workspaceId: "ws_demo" } as unknown as LedgerEvent;
}

const MANIFEST = ev("ToolManifestImported", {
  manifestHash: "mh_demo",
  tools: [
    { name: "spot_place_order", riskClass: "trade_like", schemaHash: "h1" },
    { name: "withdraw", riskClass: "asset_movement", schemaHash: "h2" },
    { name: "mystery_capability", riskClass: "unknown", schemaHash: "h3" },
  ],
});

describe("buildTranscript header", () => {
  it("counts governed tools by status and carries the manifest hash", () => {
    const { header } = buildTranscript([MANIFEST]);
    expect(header).toEqual({
      workspaceId: "ws_demo",
      manifestHash: "mh_demo",
      governedTools: { active: 1, blocked: 1, frozen: 1 },
    });
  });
});

describe("buildTranscript steps", () => {
  it("maps a full happy-path event stream to display steps", () => {
    const { steps } = buildTranscript([
      MANIFEST,
      ev("RunCreated", { runId: "run_1" }),
      ev("RunStarted", { runId: "run_1", agentName: "demo-agent", intent: "demo" }),
      ev("DecisionProposed", {
        decisionId: "dec_1",
        instrument: "BTCUSDT",
        marketType: "spot",
        action: "buy",
        requestedNotionalUsdt: "2500",
      }),
      ev("PolicyEvaluated", { evaluationId: "pe_1" }),
      ev("ApprovalRequested", { approvalId: "apr_1", summary: { policyOutcome: "require_approval" } }),
      ev("ApprovalApproved", { approvedBy: "ops-desk" }),
      ev("AuthorizationIssued", { authorizationId: "auth_1" }),
      ev("AuthorizationConsumed", { authorizationId: "auth_1" }),
      ev("ExecutionCompleted", {
        finalStatus: "submitted",
        receiptRef: "receipt:bitget:PAPER-OID-1",
        receiptHash: "rh_1",
      }),
      ev("RunCompleted", { runId: "run_1" }),
    ]);

    expect(steps).toEqual([
      { kind: "run_started", runId: "run_1", agentName: "demo-agent", intent: "demo" },
      {
        kind: "decision_proposed",
        decisionId: "dec_1",
        instrument: "BTCUSDT",
        marketType: "spot",
        action: "buy",
        size: "2500",
      },
      { kind: "approval_requested", approvalId: "apr_1", reason: "require_approval" },
      { kind: "approval_decided", outcome: "approved", by: "ops-desk" },
      { kind: "authorization_consumed", authorizationId: "auth_1" },
      {
        kind: "execution_outcome",
        status: "submitted",
        executionSent: true,
        receiptRef: "receipt:bitget:PAPER-OID-1",
        receiptHash: "rh_1",
      },
      { kind: "run_finished", status: "completed" },
    ]);
  });

  it("maps the denied path with a rejected decision and no execution step", () => {
    const { steps } = buildTranscript([
      MANIFEST,
      ev("RunStarted", { runId: "run_1" }),
      ev("DecisionProposed", { decisionId: "dec_1", instrument: "BTCUSDT", marketType: "spot", action: "buy", requestedNotionalUsdt: "2500" }),
      ev("ApprovalRequested", { approvalId: "apr_1", summary: { policyOutcome: "require_approval" } }),
      ev("ApprovalRejected", { rejectedBy: "ops-desk" }),
      ev("RunCompleted", { runId: "run_1" }),
    ]);

    expect(steps.map((s) => s.kind)).toEqual([
      "run_started",
      "decision_proposed",
      "approval_requested",
      "approval_decided",
      "run_finished",
    ]);
    expect(steps[3]).toEqual({ kind: "approval_decided", outcome: "rejected", by: "ops-desk" });
  });
});
