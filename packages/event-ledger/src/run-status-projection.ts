import type { LedgerEvent, RunStatus, PolicyEvaluatedPayload } from "@traceguard/schemas";

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
      case "PolicyEvaluated": {
        const outcome = (e.payload as PolicyEvaluatedPayload).outcome;
        status =
          outcome === "allow"
            ? "allowed"
            : outcome === "require_approval"
              ? "approval_required"
              : "blocked";
        break;
      }
      default:
        break;
    }
  }
  return status;
}
