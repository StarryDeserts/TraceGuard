import type { Policy } from "@traceguard/schemas";

export const NOTIONAL_APPROVAL_THRESHOLD_USDT = "1000"; // DecimalString

export const DEFAULT_POLICY: Policy = {
  version: 1,
  defaultEffect: "block",
  rules: [
    {
      id: "block-high-leverage",
      effect: "block",
      conditions: [{ kind: "leverage_gt", value: "3" }],
    },
    {
      id: "approve-large-notional",
      effect: "require_approval",
      conditions: [{ kind: "notional_gt", value: NOTIONAL_APPROVAL_THRESHOLD_USDT }],
    },
    {
      id: "allow-trade-like",
      effect: "allow",
      conditions: [{ kind: "tool_risk_class_eq", value: "trade_like" }],
    },
  ],
};
