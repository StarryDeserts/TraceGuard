import type { DecisionEnvelope, EvaluationContext, Policy } from "@traceguard/schemas";

export const sampleWorkspaceId = "ws_1";
export const sampleRunId = "run_1";
export const sampleActorId = "agent_1";

const baseEnvelope = {
  instrument: "BTCUSDT",
  marketType: "futures",
  action: "open_long",
  thesis: "Momentum positive with controlled risk.",
  evidenceRefs: ["ev_1"],
  requestedLeverage: "2",
} satisfies Omit<DecisionEnvelope, "id" | "requestedNotionalUsdt">;

export const allowDecisionEnvelope: DecisionEnvelope = {
  ...baseEnvelope,
  id: "dec_allow",
  requestedNotionalUsdt: "100",
};

export const approvalDecisionEnvelope: DecisionEnvelope = {
  ...baseEnvelope,
  id: "dec_approval",
  requestedNotionalUsdt: "300",
};

export const blockDecisionEnvelope: DecisionEnvelope = {
  ...baseEnvelope,
  id: "dec_block",
  requestedNotionalUsdt: "300",
  requestedLeverage: "5",
};

export const missingEvidenceEnvelope: DecisionEnvelope = {
  ...allowDecisionEnvelope,
  id: "dec_rejected",
  evidenceRefs: [],
};

export const sampleEvaluationContext: EvaluationContext = {
  runId: sampleRunId,
  policyVersionId: "pv_1",
  evaluatorVersion: "policy-engine@1.0.0",
  workspaceMode: "approval_mode",
  manifestStatus: "approved",
  snapshotAgeSeconds: 10,
  toolRiskClass: "trade_like",
  instrumentAllowlist: ["BTCUSDT"],
};

export const allowPolicy: Policy = {
  version: 1,
  defaultEffect: "block",
  rules: [
    {
      id: "allow-small-btc-futures",
      effect: "allow",
      conditions: [
        { kind: "action_in", values: ["open_long"] },
        { kind: "instrument_in", values: ["BTCUSDT"] },
        { kind: "market_type_in", values: ["futures"] },
        { kind: "notional_lte", value: "200" },
      ],
    },
  ],
};

export const approvalPolicy: Policy = {
  version: 1,
  defaultEffect: "block",
  rules: [
    {
      id: "approval-large-notional",
      effect: "require_approval",
      conditions: [{ kind: "notional_gt", value: "200" }],
    },
    {
      id: "allow-btc-futures",
      effect: "allow",
      conditions: [
        { kind: "action_in", values: ["open_long"] },
        { kind: "instrument_in", values: ["BTCUSDT"] },
        { kind: "market_type_in", values: ["futures"] },
      ],
    },
  ],
};

export const blockPolicy: Policy = {
  version: 1,
  defaultEffect: "block",
  rules: [
    {
      id: "block-high-leverage",
      effect: "block",
      conditions: [{ kind: "leverage_gt", value: "3" }],
    },
    {
      id: "approval-large-notional",
      effect: "require_approval",
      conditions: [{ kind: "notional_gt", value: "200" }],
    },
    {
      id: "allow-btc-futures",
      effect: "allow",
      conditions: [{ kind: "instrument_in", values: ["BTCUSDT"] }],
    },
  ],
};

export const defaultBlockPolicy: Policy = { version: 1, defaultEffect: "block", rules: [] };
