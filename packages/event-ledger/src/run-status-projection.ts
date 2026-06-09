import type { LedgerEvent, RunStatus } from "@traceguard/schemas";

export function runStatusProjection(events: LedgerEvent[]): RunStatus {
  let status: RunStatus = "created";
  for (const e of events) {
    switch (e.eventType) {
      case "RunCreated":
        status = "created";
        break;
      case "RunStarted":
        status = "capturing";
        break;
      case "DecisionValidated":
        status = "decision_ready";
        break;
      case "PolicyEvaluationStarted":
        status = "policy_evaluating";
        break;
      case "ApprovalRequested":
        status = "approval_required";
        break;
      case "ApprovalApproved":
        status = "approval_required";
        break;
      case "PolicyEvaluated": {
        const payload = e.payload;
        const outcome =
          payload !== null && typeof payload === "object" && "outcome" in payload
            ? (payload as { outcome?: unknown }).outcome
            : undefined;
        if (outcome === "allow") {
          status = "allowed";
        } else if (outcome === "require_approval") {
          status = "approval_required";
        } else if (outcome === "block") {
          status = "blocked";
        }
        break;
      }
      default:
        break;
    }
  }
  return status;
}
