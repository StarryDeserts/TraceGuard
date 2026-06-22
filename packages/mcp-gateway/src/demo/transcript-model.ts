import { toolManifestProjection } from "@traceguard/event-ledger";
import type { LedgerEvent } from "@traceguard/schemas";

export interface DemoTranscriptHeader {
  workspaceId: string;
  manifestHash: string;
  governedTools: { active: number; blocked: number; frozen: number };
}

export type DemoStep =
  | { kind: "run_started"; runId: string; agentName?: string; intent?: string }
  | { kind: "decision_proposed"; decisionId: string; instrument: string; marketType: string; action: string; size: string }
  | { kind: "approval_requested"; approvalId: string; reason: string }
  | { kind: "approval_decided"; outcome: "approved" | "rejected"; by: string }
  | { kind: "authorization_consumed"; authorizationId: string }
  | {
      kind: "execution_outcome";
      status: string;
      executionSent: boolean;
      receiptRef?: string;
      receiptHash?: string;
      reasonCode?: string;
    }
  | { kind: "run_finished"; status: "completed" | "failed" };

export interface DemoTranscript {
  header: DemoTranscriptHeader;
  steps: DemoStep[];
}

function rec(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

function str(payload: unknown, key: string): string | undefined {
  const value = rec(payload)[key];
  return typeof value === "string" ? value : undefined;
}

function buildHeader(events: LedgerEvent[]): DemoTranscriptHeader {
  const view = toolManifestProjection(events);
  const governedTools = { active: 0, blocked: 0, frozen: 0 };
  for (const tool of view.tools) governedTools[tool.status] += 1;
  return {
    workspaceId: events[0]?.workspaceId ?? "",
    manifestHash: view.manifestHash ?? "",
    governedTools,
  };
}

function stepFor(event: LedgerEvent): DemoStep | undefined {
  const p = event.payload;
  switch (event.eventType) {
    case "RunStarted": {
      const agentName = str(p, "agentName");
      const intent = str(p, "intent");
      return {
        kind: "run_started",
        runId: str(p, "runId") ?? "",
        ...(agentName !== undefined ? { agentName } : {}),
        ...(intent !== undefined ? { intent } : {}),
      };
    }
    case "DecisionProposed":
      return {
        kind: "decision_proposed",
        decisionId: str(p, "decisionId") ?? "",
        instrument: str(p, "instrument") ?? "",
        marketType: str(p, "marketType") ?? "",
        action: str(p, "action") ?? "",
        size: str(p, "requestedNotionalUsdt") ?? str(p, "requestedQuantity") ?? "",
      };
    case "ApprovalRequested":
      return {
        kind: "approval_requested",
        approvalId: str(p, "approvalId") ?? "",
        reason: str(rec(p).summary, "policyOutcome") ?? "",
      };
    case "ApprovalApproved":
      return { kind: "approval_decided", outcome: "approved", by: str(p, "approvedBy") ?? "" };
    case "ApprovalRejected":
      return { kind: "approval_decided", outcome: "rejected", by: str(p, "rejectedBy") ?? "" };
    case "AuthorizationConsumed":
      return { kind: "authorization_consumed", authorizationId: str(p, "authorizationId") ?? "" };
    case "ExecutionCompleted": {
      const receiptRef = str(p, "receiptRef");
      const receiptHash = str(p, "receiptHash");
      return {
        kind: "execution_outcome",
        status: str(p, "finalStatus") ?? "",
        executionSent: true,
        ...(receiptRef !== undefined ? { receiptRef } : {}),
        ...(receiptHash !== undefined ? { receiptHash } : {}),
      };
    }
    case "ExecutionRejected": {
      const reasonCode = str(p, "reasonCode");
      return {
        kind: "execution_outcome",
        status: "rejected",
        executionSent: false,
        ...(reasonCode !== undefined ? { reasonCode } : {}),
      };
    }
    case "ExecutionUnknown": {
      const reasonCode = str(p, "reasonCode");
      return {
        kind: "execution_outcome",
        status: "unknown",
        executionSent: true,
        ...(reasonCode !== undefined ? { reasonCode } : {}),
      };
    }
    case "RunCompleted":
      return { kind: "run_finished", status: "completed" };
    case "RunFailed":
      return { kind: "run_finished", status: "failed" };
    default:
      return undefined;
  }
}

function buildSteps(events: LedgerEvent[]): DemoStep[] {
  const steps: DemoStep[] = [];
  for (const event of events) {
    const step = stepFor(event);
    if (step !== undefined) steps.push(step);
  }
  return steps;
}

export function buildTranscript(events: LedgerEvent[]): DemoTranscript {
  return { header: buildHeader(events), steps: buildSteps(events) };
}
