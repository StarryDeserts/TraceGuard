import type { RiskClass } from "@traceguard/schemas";
import type { GatewayState } from "./gateway-state.js";

export type CallDenyCode =
  | "UNKNOWN_TOOL"
  | "TOOL_FROZEN"
  | "TOOL_BLOCKED"
  | "DECISION_ENVELOPE_REQUIRED"
  | "ARGUMENTS_INVALID";

export type RouteOutcome =
  | { kind: "forward"; riskClass: RiskClass }
  | { kind: "deny"; code: CallDenyCode; incident: boolean; riskClass?: RiskClass };

export function routeCall(state: GatewayState, name: string): RouteOutcome {
  const entry = state.route.get(name);
  if (entry === undefined) {
    return { kind: "deny", code: "UNKNOWN_TOOL", incident: false };
  }
  if (entry.status === "frozen") {
    return { kind: "deny", code: "TOOL_FROZEN", incident: false, riskClass: entry.riskClass };
  }
  if (entry.status === "blocked") {
    return { kind: "deny", code: "TOOL_BLOCKED", incident: true, riskClass: entry.riskClass };
  }
  if (entry.riskClass === "public_read" || entry.riskClass === "account_read") {
    return { kind: "forward", riskClass: entry.riskClass };
  }
  return {
    kind: "deny",
    code: "DECISION_ENVELOPE_REQUIRED",
    incident: false,
    riskClass: entry.riskClass,
  };
}
