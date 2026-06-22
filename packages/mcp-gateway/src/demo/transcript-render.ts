import { redactResult, AGENT_CREDENTIAL_PROFILE } from "../result-redaction.js";
import type { DemoStep, DemoTranscript, DemoTranscriptHeader } from "./transcript-model.js";

export const MARKDOWN_TITLE = "# TraceGuard — Governed Paper-Trading Demo";

const PREAMBLE =
  "Every step below is replayed from the append-only TraceGuard ledger. " +
  "Agent-facing results are redacted before display — no raw credentials or order bodies ever appear.";

export interface DemoSection {
  title: string;
  transcript: DemoTranscript;
}

export function redactStep(step: DemoStep): DemoStep {
  return redactResult(step, AGENT_CREDENTIAL_PROFILE);
}

function describeExecution(step: Extract<DemoStep, { kind: "execution_outcome" }>): string {
  if (step.executionSent === false) {
    return `Execution blocked — nothing was sent to the exchange (reason: ${step.reasonCode ?? "unspecified"})`;
  }
  if (step.status === "unknown") {
    return "Execution outcome unknown — reconciliation required, no fabricated receipt.";
  }
  return `Execution ${step.status} — receipt ${step.receiptRef ?? "(none)"}`;
}

function describeStep(step: DemoStep): string {
  switch (step.kind) {
    case "run_started":
      return `Run ${step.runId} started${step.agentName !== undefined ? ` by ${step.agentName}` : ""}${step.intent !== undefined ? ` — ${step.intent}` : ""}`;
    case "decision_proposed":
      return `Decision ${step.decisionId}: ${step.action} ${step.instrument} (${step.marketType}), size ${step.size}`;
    case "approval_requested":
      return `Approval ${step.approvalId} requested — policy outcome: ${step.reason}`;
    case "approval_decided":
      return step.outcome === "approved" ? `Approval granted by ${step.by}` : `Approval denied by ${step.by}`;
    case "authorization_consumed":
      return `Authorization ${step.authorizationId} consumed`;
    case "execution_outcome":
      return describeExecution(step);
    case "run_finished":
      return `Run finished — ${step.status}`;
  }
}

function headerBullets(header: DemoTranscriptHeader): string[] {
  const g = header.governedTools;
  return [
    `- Workspace: ${header.workspaceId}`,
    `- Manifest hash: ${header.manifestHash}`,
    `- Governed tools: ${g.active} active, ${g.blocked} blocked, ${g.frozen} frozen`,
  ];
}

export function renderMarkdownDocument(sections: DemoSection[]): string {
  const lines: string[] = [MARKDOWN_TITLE, "", PREAMBLE, ""];
  const header = sections[0]?.transcript.header;
  if (header !== undefined) {
    lines.push("## Governed manifest", "", ...headerBullets(header), "");
  }
  for (const section of sections) {
    lines.push(`## ${section.title}`, "");
    section.transcript.steps.forEach((step, i) => {
      lines.push(`${i + 1}. ${describeStep(redactStep(step))}`);
    });
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderLinesDocument(sections: DemoSection[]): string {
  const lines: string[] = ["TraceGuard — Governed Paper-Trading Demo", ""];
  const header = sections[0]?.transcript.header;
  if (header !== undefined) {
    lines.push(...headerBullets(header).map((b) => b.replace(/^- /, "  ")), "");
  }
  for (const section of sections) {
    lines.push(section.title, "");
    section.transcript.steps.forEach((step, i) => {
      lines.push(`  ${i + 1}. ${describeStep(redactStep(step))}`);
    });
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
