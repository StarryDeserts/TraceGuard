import type { LedgerEvent } from "@traceguard/schemas";

export interface AuthorizationView {
  authorizationId?: string;
  actionDigest?: string;
  expiresAt?: string;
  approvalId?: string;
  status: "issued" | "consumed" | "revoked";
}

function readString(payload: unknown, key: string): string | undefined {
  if (payload !== null && typeof payload === "object" && key in payload) {
    const value = (payload as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

export function authorizationProjection(events: LedgerEvent[]): AuthorizationView {
  const view: AuthorizationView = { status: "issued" };
  let issued = false;
  for (const e of events) {
    switch (e.eventType) {
      case "AuthorizationIssued": {
        issued = true;
        view.status = "issued";
        const authorizationId = readString(e.payload, "authorizationId");
        const actionDigest = readString(e.payload, "actionDigest");
        const expiresAt = readString(e.payload, "expiresAt");
        const approvalId = readString(e.payload, "approvalId");
        if (authorizationId !== undefined) view.authorizationId = authorizationId;
        if (actionDigest !== undefined) view.actionDigest = actionDigest;
        if (expiresAt !== undefined) view.expiresAt = expiresAt;
        if (approvalId !== undefined) view.approvalId = approvalId;
        break;
      }
      case "AuthorizationConsumed":
        if (issued) view.status = "consumed";
        break;
      case "ApprovalRevoked":
        if (issued && readString(e.payload, "approvalId") === view.approvalId) {
          view.status = "revoked";
        }
        break;
      default:
        break;
    }
  }
  return view;
}
