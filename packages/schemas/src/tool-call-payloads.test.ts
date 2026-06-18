import { describe, it, expect } from "vitest";
import {
  CallDenyCode,
  ToolCallRequestedPayload,
  ToolCallCompletedPayload,
  ToolCallFailedPayload,
  ToolCallDeniedPayload,
  IncidentOpenedPayload,
} from "./tool-call-payloads.js";
import { RunCreatedPayload } from "./run-payloads.js";

const DIGEST = "a".repeat(64);

describe("tool-call payloads", () => {
  it("CallDenyCode enumerates the five deny codes", () => {
    expect(CallDenyCode.options).toEqual([
      "UNKNOWN_TOOL",
      "TOOL_FROZEN",
      "TOOL_BLOCKED",
      "DECISION_ENVELOPE_REQUIRED",
      "ARGUMENTS_INVALID",
    ]);
  });

  it("ToolCallDeniedPayload accepts the ARGUMENTS_INVALID deny code", () => {
    const parsed = ToolCallDeniedPayload.parse({
      runId: "run_1",
      toolName: "spot_get_ticker",
      denyCode: "ARGUMENTS_INVALID",
      riskClass: "public_read",
    });
    expect(parsed.denyCode).toBe("ARGUMENTS_INVALID");
  });

  it("ToolCallRequestedPayload requires a 64-hex argumentsDigest", () => {
    expect(() =>
      ToolCallRequestedPayload.parse({
        runId: "run_1",
        toolName: "spot_get_ticker",
        riskClass: "public_read",
        argumentsDigest: "abc",
      }),
    ).toThrow();
    expect(
      ToolCallRequestedPayload.parse({
        runId: "run_1",
        toolName: "spot_get_ticker",
        riskClass: "public_read",
        argumentsDigest: DIGEST,
      }).argumentsDigest,
    ).toBe(DIGEST);
  });

  it("ToolCallCompletedPayload is strict and digest-only", () => {
    expect(() =>
      ToolCallCompletedPayload.parse({
        runId: "run_1",
        toolName: "spot_get_ticker",
        resultDigest: DIGEST,
        isError: false,
        extra: "nope",
      }),
    ).toThrow();
  });

  it("ToolCallFailedPayload rejects an unknown reasonCode", () => {
    expect(() =>
      ToolCallFailedPayload.parse({
        runId: "run_1",
        toolName: "spot_get_ticker",
        reasonCode: "made_up",
      }),
    ).toThrow();
    expect(
      ToolCallFailedPayload.parse({
        runId: "run_1",
        toolName: "spot_get_ticker",
        reasonCode: "upstream_call_failed",
      }).reasonCode,
    ).toBe("upstream_call_failed");
  });

  it("ToolCallDeniedPayload allows riskClass to be omitted for UNKNOWN_TOOL", () => {
    const parsed = ToolCallDeniedPayload.parse({
      runId: "run_1",
      toolName: "no_such_tool",
      denyCode: "UNKNOWN_TOOL",
    });
    expect(parsed.riskClass).toBeUndefined();
    expect(
      ToolCallDeniedPayload.parse({
        runId: "run_1",
        toolName: "spot_place_order",
        denyCode: "DECISION_ENVELOPE_REQUIRED",
        riskClass: "trade_like",
      }).riskClass,
    ).toBe("trade_like");
  });

  it("IncidentOpenedPayload accepts a valid blocked-call incident", () => {
    const parsed = IncidentOpenedPayload.parse({
      incidentId: "inc_1",
      runId: "run_1",
      toolName: "withdraw",
      riskClass: "asset_movement",
      reasonCode: "blocked_tool_call_attempt",
    });
    expect(parsed.reasonCode).toBe("blocked_tool_call_attempt");
  });

  it("RunCreatedPayload requires an ISO createdAt", () => {
    expect(() =>
      RunCreatedPayload.parse({
        runId: "run_1",
        providerConnectionId: "pc_bitget",
        createdAt: "nope",
      }),
    ).toThrow();
    expect(
      RunCreatedPayload.parse({
        runId: "run_1",
        providerConnectionId: "pc_bitget",
        createdAt: "2026-06-08T00:00:00.000Z",
      }).runId,
    ).toBe("run_1");
  });
});
