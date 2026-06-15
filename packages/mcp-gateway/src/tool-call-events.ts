import { makeEvent, canonicalJson } from "@traceguard/event-ledger";
import {
  RunCreatedPayload,
  ToolCallRequestedPayload,
  ToolCallCompletedPayload,
  ToolCallFailedPayload,
  ToolCallDeniedPayload,
  IncidentOpenedPayload,
  type RiskClass,
  type LedgerEvent,
} from "@traceguard/schemas";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ReconcileDeps } from "@traceguard/tool-manifest";
import type { CallDenyCode } from "./call-router.js";

export interface CallAudit {
  workspaceId: string;
  runId: string;
  providerConnectionId: string;
}

type Deps = ReconcileDeps;

function envelope(audit: CallAudit) {
  return {
    workspaceId: audit.workspaceId,
    runId: audit.runId,
    eventVersion: 1 as const,
    schemaVersion: 1 as const,
  };
}

export function recordRunCreated(
  audit: CallAudit,
  deps: Deps,
  prev: string | null,
): LedgerEvent<RunCreatedPayload> {
  const payload = RunCreatedPayload.parse({
    runId: audit.runId,
    providerConnectionId: audit.providerConnectionId,
    createdAt: deps.clock.now(),
  });
  return makeEvent(
    {
      ...envelope(audit),
      eventType: "RunCreated",
      aggregateType: "run",
      aggregateId: audit.runId,
      actorType: "agent",
      previousEventHash: prev,
      payload,
    },
    deps,
  );
}

export function recordToolCallRequested(
  audit: CallAudit,
  deps: Deps,
  prev: string | null,
  input: { toolName: string; riskClass: RiskClass; argumentsDigest: string },
): LedgerEvent<ToolCallRequestedPayload> {
  const payload = ToolCallRequestedPayload.parse({
    runId: audit.runId,
    toolName: input.toolName,
    riskClass: input.riskClass,
    argumentsDigest: input.argumentsDigest,
  });
  return makeEvent(
    {
      ...envelope(audit),
      eventType: "ToolCallRequested",
      aggregateType: "run",
      aggregateId: audit.runId,
      actorType: "agent",
      previousEventHash: prev,
      payload,
    },
    deps,
  );
}

export function recordToolCallCompleted(
  audit: CallAudit,
  deps: Deps,
  prev: string | null,
  input: { toolName: string; result: CallToolResult },
): LedgerEvent<ToolCallCompletedPayload> {
  const payload = ToolCallCompletedPayload.parse({
    runId: audit.runId,
    toolName: input.toolName,
    resultDigest: deps.hash(canonicalJson(input.result)),
    isError: input.result.isError ?? false,
  });
  return makeEvent(
    {
      ...envelope(audit),
      eventType: "ToolCallCompleted",
      aggregateType: "run",
      aggregateId: audit.runId,
      actorType: "agent",
      previousEventHash: prev,
      payload,
    },
    deps,
  );
}

export function recordToolCallFailed(
  audit: CallAudit,
  deps: Deps,
  prev: string | null,
  input: { toolName: string },
): LedgerEvent<ToolCallFailedPayload> {
  const payload = ToolCallFailedPayload.parse({
    runId: audit.runId,
    toolName: input.toolName,
    reasonCode: "upstream_call_failed",
  });
  return makeEvent(
    {
      ...envelope(audit),
      eventType: "ToolCallFailed",
      aggregateType: "run",
      aggregateId: audit.runId,
      actorType: "agent",
      previousEventHash: prev,
      payload,
    },
    deps,
  );
}

export function recordToolCallDenied(
  audit: CallAudit,
  deps: Deps,
  prev: string | null,
  input: { toolName: string; denyCode: CallDenyCode; riskClass?: RiskClass },
): LedgerEvent<ToolCallDeniedPayload> {
  const payload = ToolCallDeniedPayload.parse({
    runId: audit.runId,
    toolName: input.toolName,
    denyCode: input.denyCode,
    ...(input.riskClass !== undefined ? { riskClass: input.riskClass } : {}),
  });
  return makeEvent(
    {
      ...envelope(audit),
      eventType: "ToolCallDenied",
      aggregateType: "run",
      aggregateId: audit.runId,
      actorType: "agent",
      previousEventHash: prev,
      payload,
    },
    deps,
  );
}

export function recordIncidentOpened(
  audit: CallAudit,
  deps: Deps,
  prev: string | null,
  input: { toolName: string; riskClass: RiskClass },
): LedgerEvent<IncidentOpenedPayload> {
  const incidentId = deps.newId.next("inc");
  const payload = IncidentOpenedPayload.parse({
    incidentId,
    runId: audit.runId,
    toolName: input.toolName,
    riskClass: input.riskClass,
    reasonCode: "blocked_tool_call_attempt",
  });
  return makeEvent(
    {
      ...envelope(audit),
      eventType: "IncidentOpened",
      aggregateType: "incident",
      aggregateId: incidentId,
      actorType: "system",
      previousEventHash: prev,
      payload,
    },
    deps,
  );
}
