import { describe, it, expect } from "vitest";
import { canonicalJson, sha256hex } from "@traceguard/event-ledger";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fixedClock, sequentialIdGen } from "@traceguard/testing-fixtures";
import {
  recordRunCreated,
  recordToolCallRequested,
  recordToolCallCompleted,
  recordToolCallFailed,
  recordToolCallDenied,
  recordIncidentOpened,
  type CallAudit,
} from "./tool-call-events.js";

const audit: CallAudit = {
  workspaceId: "ws_demo",
  runId: "run_1",
  providerConnectionId: "pc_bitget",
};

function deps() {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

describe("tool-call event builders", () => {
  it("recordRunCreated anchors the run aggregate", () => {
    const d = deps();
    const ev = recordRunCreated(audit, d, null);
    expect(ev.eventType).toBe("RunCreated");
    expect(ev.aggregateType).toBe("run");
    expect(ev.aggregateId).toBe("run_1");
    expect(ev.actorType).toBe("agent");
    expect(ev.runId).toBe("run_1");
    expect(ev.previousEventHash).toBeUndefined();
    expect(ev.eventVersion).toBe(1);
    expect(ev.payload.createdAt).toBe("2026-06-08T00:00:00.000Z");
    expect(ev.payload.providerConnectionId).toBe("pc_bitget");
  });

  it("recordToolCallRequested digests the arguments", () => {
    const d = deps();
    const args = { symbol: "BTCUSDT" };
    const ev = recordToolCallRequested(audit, d, "h0", {
      toolName: "spot_get_ticker",
      riskClass: "public_read",
      argumentsDigest: sha256hex(canonicalJson(args)),
    });
    expect(ev.eventType).toBe("ToolCallRequested");
    expect(ev.aggregateType).toBe("run");
    expect(ev.actorType).toBe("agent");
    expect(ev.previousEventHash).toBe("h0");
    expect(ev.payload.argumentsDigest).toBe(sha256hex(canonicalJson(args)));
    expect(ev.payload.riskClass).toBe("public_read");
  });

  it("recordToolCallCompleted digests the result and defaults isError to false", () => {
    const d = deps();
    const result = { content: [{ type: "text", text: "ok" }] } as unknown as CallToolResult;
    const ev = recordToolCallCompleted(audit, d, "h1", {
      toolName: "spot_get_ticker",
      result,
    });
    expect(ev.eventType).toBe("ToolCallCompleted");
    expect(ev.payload.resultDigest).toBe(sha256hex(canonicalJson(result)));
    expect(ev.payload.isError).toBe(false);
  });

  it("recordToolCallCompleted preserves an upstream isError flag", () => {
    const d = deps();
    const result = { content: [], isError: true } as unknown as CallToolResult;
    const ev = recordToolCallCompleted(audit, d, "h1", {
      toolName: "spot_get_ticker",
      result,
    });
    expect(ev.payload.isError).toBe(true);
  });

  it("recordToolCallFailed records the upstream_call_failed reason", () => {
    const d = deps();
    const ev = recordToolCallFailed(audit, d, "h1", { toolName: "spot_get_ticker" });
    expect(ev.eventType).toBe("ToolCallFailed");
    expect(ev.payload.reasonCode).toBe("upstream_call_failed");
  });

  it("recordToolCallDenied omits riskClass when not supplied", () => {
    const d = deps();
    const ev = recordToolCallDenied(audit, d, "h0", {
      toolName: "no_such_tool",
      denyCode: "UNKNOWN_TOOL",
    });
    expect(ev.eventType).toBe("ToolCallDenied");
    expect(ev.payload.denyCode).toBe("UNKNOWN_TOOL");
    expect(ev.payload.riskClass).toBeUndefined();
  });

  it("recordToolCallDenied includes riskClass when supplied", () => {
    const d = deps();
    const ev = recordToolCallDenied(audit, d, "h0", {
      toolName: "spot_place_order",
      denyCode: "DECISION_ENVELOPE_REQUIRED",
      riskClass: "trade_like",
    });
    expect(ev.payload.riskClass).toBe("trade_like");
  });

  it("recordIncidentOpened mints an incident aggregate that still carries runId", () => {
    const d = deps();
    const ev = recordIncidentOpened(audit, d, "hDenied", {
      toolName: "withdraw",
      riskClass: "asset_movement",
    });
    expect(ev.eventType).toBe("IncidentOpened");
    expect(ev.aggregateType).toBe("incident");
    expect(ev.actorType).toBe("system");
    expect(ev.aggregateId).toMatch(/^inc_/);
    expect(ev.payload.incidentId).toBe(ev.aggregateId);
    expect(ev.runId).toBe("run_1");
    expect(ev.previousEventHash).toBe("hDenied");
    expect(ev.payload.reasonCode).toBe("blocked_tool_call_attempt");
  });

  it("chains events by previousEventHash", () => {
    const d = deps();
    const run = recordRunCreated(audit, d, null);
    const requested = recordToolCallRequested(audit, d, run.eventHash, {
      toolName: "spot_get_ticker",
      riskClass: "public_read",
      argumentsDigest: "a".repeat(64),
    });
    expect(requested.previousEventHash).toBe(run.eventHash);
  });
});
