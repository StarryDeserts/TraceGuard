import type { AuthorizationRejectionReason } from "@traceguard/schemas";

export type AuthorizationUseStatus = "issued" | "consumed" | "expired" | "revoked";

export interface AuthorizationUseInput {
  authorization?: {
    authorizationId: string;
    actionDigest: string;
    expiresAt: string;
    status: AuthorizationUseStatus;
  };
  attemptedActionDigest: string;
  now: string;
  gates: {
    workspaceLocked: boolean;
    manifestChanged: boolean;
    policyChanged: boolean;
  };
}

export type AuthorizationUseResult =
  | { ok: true; authorizationId: string }
  | { ok: false; reasonCode: AuthorizationRejectionReason };

export function evaluateAuthorizationUse(input: AuthorizationUseInput): AuthorizationUseResult {
  const authz = input.authorization;
  if (authz === undefined || authz.status === "revoked") {
    return { ok: false, reasonCode: "missing_authorization" };
  }
  if (authz.status === "expired" || input.now >= authz.expiresAt) {
    return { ok: false, reasonCode: "expired_authorization" };
  }
  if (authz.status === "consumed") {
    return { ok: false, reasonCode: "already_consumed" };
  }
  if (input.attemptedActionDigest !== authz.actionDigest) {
    return { ok: false, reasonCode: "action_digest_mismatch" };
  }
  if (input.gates.workspaceLocked) {
    return { ok: false, reasonCode: "workspace_locked" };
  }
  if (input.gates.manifestChanged) {
    return { ok: false, reasonCode: "manifest_changed" };
  }
  if (input.gates.policyChanged) {
    return { ok: false, reasonCode: "policy_changed" };
  }
  return { ok: true, authorizationId: authz.authorizationId };
}
