import type { ApprovalStatus, LedgerEvent } from "@traceguard/schemas";

export interface ApprovalProjection {
  approvalId?: string;
  runId?: string;
  decisionId?: string;
  actionDigest?: string;
  expiresAt?: string;
  status: ApprovalStatus;
  authorizationId?: string;
  authorizationExpiresAt?: string;
}

function readString(payload: unknown, key: string): string | undefined {
  if (payload !== null && typeof payload === "object" && key in payload) {
    const value = (payload as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

export function approvalProjection(events: LedgerEvent[]): ApprovalProjection {
  const state: ApprovalProjection = { status: "pending" };
  for (const e of events) {
    switch (e.eventType) {
      case "ApprovalRequested": {
        state.status = "pending";
        const approvalId = readString(e.payload, "approvalId");
        const runId = readString(e.payload, "runId");
        const decisionId = readString(e.payload, "decisionId");
        const actionDigest = readString(e.payload, "actionDigest");
        const expiresAt = readString(e.payload, "expiresAt");
        if (approvalId !== undefined) state.approvalId = approvalId;
        if (runId !== undefined) state.runId = runId;
        if (decisionId !== undefined) state.decisionId = decisionId;
        if (actionDigest !== undefined) state.actionDigest = actionDigest;
        if (expiresAt !== undefined) state.expiresAt = expiresAt;
        break;
      }
      case "ApprovalApproved":
        state.status = "approved";
        break;
      case "AuthorizationIssued": {
        state.status = "approved";
        const authorizationId = readString(e.payload, "authorizationId");
        const authorizationExpiresAt = readString(e.payload, "expiresAt");
        const runId = readString(e.payload, "runId");
        const decisionId = readString(e.payload, "decisionId");
        const actionDigest = readString(e.payload, "actionDigest");
        if (authorizationId !== undefined) state.authorizationId = authorizationId;
        if (authorizationExpiresAt !== undefined) state.authorizationExpiresAt = authorizationExpiresAt;
        if (runId !== undefined && state.runId === undefined) state.runId = runId;
        if (decisionId !== undefined && state.decisionId === undefined) state.decisionId = decisionId;
        if (actionDigest !== undefined && state.actionDigest === undefined) state.actionDigest = actionDigest;
        break;
      }
      case "AuthorizationConsumed":
        state.status = "consumed";
        break;
      case "ApprovalRejected":
        state.status = "rejected";
        break;
      case "ApprovalExpired":
        state.status = "expired";
        break;
      case "ApprovalRevoked":
        state.status = "revoked";
        break;
      default:
        break;
    }
  }
  return state;
}
