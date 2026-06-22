import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DecisionAction, LedgerEvent } from "@traceguard/schemas";
import { dispatchInternalTool } from "../internal-tool-handlers.js";
import type { GatewayRuntime } from "../gateway-runtime.js";
import { buildTranscript, type DemoTranscript } from "./transcript-model.js";

export type ScenarioKind = "happy" | "denied";

export interface DecisionSpec {
  instrument: string;
  marketType: "spot" | "futures" | "tokenized_stock";
  action: DecisionAction;
  thesis: string;
  evidenceRefs: string[];
  requestedNotionalUsdt?: string;
  requestedLeverage?: string;
  confidence?: number;
}

export interface RunScenarioArgs {
  runtime: GatewayRuntime;
  scenario: ScenarioKind;
  decision: DecisionSpec;
  executionAdapter: "simulator" | "bitget_live";
}

export interface ScenarioResult {
  events: LedgerEvent[];
  transcript: DemoTranscript;
}

function tg(res: CallToolResult): Record<string, unknown> {
  return (res as { traceguard?: Record<string, unknown> }).traceguard ?? {};
}

export async function runScenario(args: RunScenarioArgs): Promise<ScenarioResult> {
  const { runtime, scenario, decision } = args;
  const { internalCtx, state, runId } = runtime;
  const ws = internalCtx.audit.workspaceId;

  await dispatchInternalTool(internalCtx, state, "traceguard_start_run", {
    runId,
    agentName: "demo-agent",
    intent: "Governed paper-trading demo",
  });

  const decisionRes = await dispatchInternalTool(internalCtx, state, "traceguard_record_decision", {
    runId,
    instrument: decision.instrument,
    marketType: decision.marketType,
    action: decision.action,
    thesis: decision.thesis,
    evidenceRefs: decision.evidenceRefs,
    ...(decision.requestedNotionalUsdt !== undefined ? { requestedNotionalUsdt: decision.requestedNotionalUsdt } : {}),
    ...(decision.requestedLeverage !== undefined ? { requestedLeverage: decision.requestedLeverage } : {}),
    ...(decision.confidence !== undefined ? { confidence: decision.confidence } : {}),
  });
  const decisionId = String(tg(decisionRes).decisionId ?? "");

  const requestRes = await dispatchInternalTool(internalCtx, state, "traceguard_request_execution", {
    runId,
    decisionId,
    executionAdapter: args.executionAdapter,
  });
  const approvalId = String(tg(requestRes).approvalId ?? "");

  if (scenario === "happy") {
    await runtime.approve(approvalId, { approvedBy: "ops-desk", channel: "web" });
  } else {
    await runtime.reject(approvalId, { rejectedBy: "ops-desk", channel: "web", reason: "demo denial" });
  }

  const checkRes = await dispatchInternalTool(internalCtx, state, "traceguard_check_approval", { approvalId });

  if (scenario === "happy") {
    const authorizationId = String(tg(checkRes).authorizationId ?? "");
    await dispatchInternalTool(internalCtx, state, "traceguard_execute_authorized_action", {
      runId,
      decisionId,
      authorizationId,
      executionAdapter: args.executionAdapter,
    });
  }

  await dispatchInternalTool(internalCtx, state, "traceguard_finish_run", { runId, outcome: "succeeded" });

  const events = await internalCtx.store.read(ws);
  return { events, transcript: buildTranscript(events) };
}
