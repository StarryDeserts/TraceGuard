#!/usr/bin/env node
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  InMemoryLedgerStore,
  SystemClock,
  SystemIdGen,
  sha256hex,
  type LedgerStore,
} from "@traceguard/event-ledger";
import type { ReconcileDeps } from "@traceguard/tool-manifest";
import { StdioUpstreamClient } from "../stdio-upstream-client.js";
import type { UpstreamManifestClient } from "../upstream-client.js";
import { buildGatewayRuntime } from "../gateway-runtime.js";
import type { BootGatewayArgs } from "../boot-gateway.js";
import { runScenario, type ScenarioKind, type DecisionSpec } from "../demo/scenario-driver.js";
import {
  renderMarkdownDocument,
  renderLinesDocument,
  type DemoSection,
} from "../demo/transcript-render.js";
import { createFakeUpstream } from "../demo/fake-upstream.js";
import { counterIdGen, fixedClock } from "../demo/deterministic-deps.js";

export type DemoScenarioArg = "happy" | "denied" | "both";
export type DemoMode = "live" | "deterministic";

export interface DemoArgs {
  scenario: DemoScenarioArg;
  mode: DemoMode;
  out?: string;
}

export const DEFAULT_GOLDEN_PATH = "docs/superpowers/demo/sample-governed-run.md";
export const DEFAULT_LIVE_PATH = ".demo-out/live-run.md";

const DEMO_ARGS: BootGatewayArgs = {
  workspaceId: "ws_demo",
  providerConnectionId: "pc_bitget_demo",
  providerType: "bitget_agent_hub",
  toolManifestVersionId: "tmv_demo",
};

const DEMO_DECISION: DecisionSpec = {
  instrument: "BTCUSDT",
  marketType: "spot",
  action: "buy",
  thesis: "Momentum breakout above the prior range high on rising volume.",
  evidenceRefs: ["ev:demo:1"],
  requestedNotionalUsdt: "2500",
};

const SECTION_TITLES: Record<ScenarioKind, string> = {
  happy: "Happy path — approval granted, paper order placed",
  denied: "Fail-closed — approval denied, nothing reaches the exchange",
};

interface DemoBackend {
  client: UpstreamManifestClient;
  store: LedgerStore;
  deps: ReconcileDeps;
  executionAdapter: "simulator" | "bitget_live";
}

function deterministicBackend(): DemoBackend {
  return {
    client: createFakeUpstream(),
    store: new InMemoryLedgerStore(),
    deps: { clock: fixedClock(), newId: counterIdGen(), hash: sha256hex },
    executionAdapter: "simulator",
  };
}

function liveBackend(): DemoBackend {
  const serverEntry = createRequire(import.meta.url).resolve("bitget-mcp-server");
  const client = new StdioUpstreamClient({
    command: process.execPath,
    args: [serverEntry, "--paper-trading"],
  });
  return {
    client,
    store: new InMemoryLedgerStore(),
    deps: { clock: new SystemClock(), newId: new SystemIdGen(), hash: sha256hex },
    executionAdapter: "bitget_live",
  };
}

function isScenarioArg(value: string | undefined): value is DemoScenarioArg {
  return value === "happy" || value === "denied" || value === "both";
}

function isMode(value: string | undefined): value is DemoMode {
  return value === "live" || value === "deterministic";
}

export function parseDemoArgs(argv: string[]): DemoArgs {
  let scenario: DemoScenarioArg = "both";
  let mode: DemoMode = "deterministic";
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--scenario" && isScenarioArg(value)) {
      scenario = value;
      i++;
    } else if (flag === "--mode" && isMode(value)) {
      mode = value;
      i++;
    } else if (flag === "--out" && value !== undefined) {
      out = value;
      i++;
    }
  }
  return { scenario, mode, ...(out !== undefined ? { out } : {}) };
}

export function resolveOutPath(args: DemoArgs): string {
  if (args.out !== undefined) return args.out;
  return args.mode === "live" ? DEFAULT_LIVE_PATH : DEFAULT_GOLDEN_PATH;
}

async function safeClose(client: UpstreamManifestClient): Promise<void> {
  try {
    await client.close();
  } catch {
    /* teardown is best-effort */
  }
}

export async function buildDemoDocument(args: DemoArgs): Promise<{ markdown: string; lines: string }> {
  const scenarios: ScenarioKind[] = args.scenario === "both" ? ["happy", "denied"] : [args.scenario];
  const sections: DemoSection[] = [];
  for (const scenario of scenarios) {
    const backend = args.mode === "live" ? liveBackend() : deterministicBackend();
    try {
      const runtime = await buildGatewayRuntime(DEMO_ARGS, backend.client, backend.store, backend.deps);
      const result = await runScenario({
        runtime,
        scenario,
        decision: DEMO_DECISION,
        executionAdapter: backend.executionAdapter,
      });
      sections.push({ title: SECTION_TITLES[scenario], transcript: result.transcript });
    } finally {
      await safeClose(backend.client);
    }
  }
  return { markdown: renderMarkdownDocument(sections), lines: renderLinesDocument(sections) };
}

async function main(): Promise<void> {
  const args = parseDemoArgs(process.argv.slice(2));
  const { markdown, lines } = await buildDemoDocument(args);
  process.stdout.write(`${lines}\n`);
  const outPath = resolveOutPath(args);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, markdown, "utf8");
  // stdout carries the narration; the artifact path is a diagnostic on stderr.
  process.stderr.write(`[gateway-demo] wrote ${outPath}\n`);
}

function isMain(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  main().catch((err: unknown) => {
    process.stderr.write(`[gateway-demo] fail-closed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
