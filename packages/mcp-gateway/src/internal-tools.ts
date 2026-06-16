import type { ServedTool } from "./gateway-state.js";

export const INTERNAL_TOOL_NAMES: ReadonlySet<string> = new Set([
  "traceguard_start_run",
  "traceguard_record_decision",
  "traceguard_request_execution",
  "traceguard_check_approval",
  "traceguard_execute_authorized_action",
  "traceguard_finish_run",
]);

export const INTERNAL_TOOL_DEFS: ServedTool[] = [
  {
    name: "traceguard_start_run",
    description: "Begin a governed run; declares the agent and intent before any decision.",
    inputSchema: {
      type: "object",
      properties: {
        agentName: { type: "string" },
        intent: { type: "string" },
        mode: { type: "string" },
      },
      required: ["agentName", "intent"],
    },
  },
  {
    name: "traceguard_record_decision",
    description: "Record a trade decision envelope (thesis + evidence) and evaluate policy.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        instrument: { type: "string" },
        marketType: { type: "string", enum: ["spot", "futures", "tokenized_stock"] },
        action: { type: "string" },
        thesis: { type: "string" },
        confidence: { type: "number" },
        evidenceRefs: { type: "array", items: { type: "string" } },
        requestedNotionalUsdt: { type: "string" },
        requestedLeverage: { type: "string" },
      },
      required: ["runId", "instrument", "marketType", "action", "thesis", "evidenceRefs"],
    },
  },
  {
    name: "traceguard_request_execution",
    description:
      "Request execution of a recorded decision; returns ALLOWED, APPROVAL_REQUIRED, or POLICY_BLOCKED.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        decisionId: { type: "string" },
        executionAdapter: { type: "string", enum: ["simulator", "bitget_live", "replay"] },
      },
      required: ["runId", "decisionId"],
    },
  },
  {
    name: "traceguard_check_approval",
    description: "Poll the status of a pending approval (non-blocking).",
    inputSchema: {
      type: "object",
      properties: { approvalId: { type: "string" } },
      required: ["approvalId"],
    },
  },
  {
    name: "traceguard_execute_authorized_action",
    description: "Execute an action after its approval has been granted.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        decisionId: { type: "string" },
        authorizationId: { type: "string" },
        executionAdapter: { type: "string", enum: ["simulator", "bitget_live", "replay"] },
      },
      required: ["runId", "decisionId", "authorizationId"],
    },
  },
  {
    name: "traceguard_finish_run",
    description: "Mark the run terminal (succeeded or failed).",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        outcome: { type: "string", enum: ["succeeded", "failed"] },
      },
      required: ["runId", "outcome"],
    },
  },
];
