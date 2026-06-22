import { describe, it, expect } from "vitest";
import type { DemoStep, DemoTranscript } from "./transcript-model.js";
import { redactStep, renderMarkdownDocument, renderLinesDocument } from "./transcript-render.js";

const HAPPY: DemoTranscript = {
  header: { workspaceId: "ws_demo", manifestHash: "mh_demo", governedTools: { active: 1, blocked: 1, frozen: 1 } },
  steps: [
    { kind: "run_started", runId: "run_1", agentName: "demo-agent" },
    { kind: "decision_proposed", decisionId: "dec_1", instrument: "BTCUSDT", marketType: "spot", action: "buy", size: "2500" },
    { kind: "approval_requested", approvalId: "apr_1", reason: "require_approval" },
    { kind: "approval_decided", outcome: "approved", by: "ops-desk" },
    { kind: "authorization_consumed", authorizationId: "auth_1" },
    {
      kind: "execution_outcome",
      status: "submitted",
      executionSent: true,
      receiptRef: "receipt:bitget:PAPER-OID-1",
      receiptHash: "RECEIPTHASH_SENTINEL",
    },
    { kind: "run_finished", status: "completed" },
  ],
};

describe("redactStep", () => {
  it("scrubs credential-shaped fields but keeps audit identifiers", () => {
    const step = {
      kind: "authorization_consumed",
      authorizationId: "auth_1",
      apiKey: "SUPER_SECRET",
    } as unknown as DemoStep;
    const red = redactStep(step) as unknown as Record<string, unknown>;
    expect(red.apiKey).toBe("[REDACTED]");
    expect(red.authorizationId).toBe("auth_1");
  });
});

describe("renderMarkdownDocument", () => {
  it("renders the header, the section title, and the receipt ref — never the receipt hash", () => {
    const md = renderMarkdownDocument([{ title: "Happy path", transcript: HAPPY }]);
    expect(md).toContain("# TraceGuard — Governed Paper-Trading Demo");
    expect(md).toContain("## Happy path");
    expect(md).toContain("1 active, 1 blocked, 1 frozen");
    expect(md).toContain("receipt:bitget:PAPER-OID-1");
    expect(md).not.toContain("RECEIPTHASH_SENTINEL");
    expect(md.endsWith("\n")).toBe(true);
  });
});

describe("renderLinesDocument", () => {
  it("renders a plain-text document with the section title", () => {
    const lines = renderLinesDocument([{ title: "Happy path", transcript: HAPPY }]);
    expect(lines).toContain("Happy path");
    expect(lines).toContain("receipt:bitget:PAPER-OID-1");
    expect(lines).not.toContain("RECEIPTHASH_SENTINEL");
  });
});
