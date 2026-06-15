import { describe, it, expect } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { RawUpstreamTool } from "@traceguard/schemas";
import { sha256hex } from "@traceguard/event-ledger";
import { manifestFingerprint, type ReconcileDeps } from "@traceguard/tool-manifest";
import {
  bitget36RawTools,
  bitgetManifestHashV1,
  fixedClock,
  sequentialIdGen,
} from "@traceguard/testing-fixtures";
import { importManifest, type ImportManifestArgs } from "./import-manifest.js";
import {
  UpstreamListToolsError,
  UpstreamUnavailableError,
  type UpstreamManifestClient,
} from "./upstream-client.js";

class FakeUpstreamClient implements UpstreamManifestClient {
  opened = 0;
  listed = 0;
  closed = 0;
  constructor(
    private readonly script:
      | { kind: "tools"; tools: RawUpstreamTool[] }
      | { kind: "openThrows" }
      | { kind: "listThrows" },
  ) {}
  async open(): Promise<void> {
    this.opened++;
    if (this.script.kind === "openThrows") throw new UpstreamUnavailableError("spawn failed");
  }
  async listTools(): Promise<RawUpstreamTool[]> {
    this.listed++;
    if (this.script.kind === "listThrows") throw new UpstreamListToolsError("transport dropped");
    if (this.script.kind === "tools") return this.script.tools;
    throw new Error("unreachable");
  }
  async callTool(): Promise<CallToolResult> {
    throw new Error("callTool is not exercised by this test");
  }
  async close(): Promise<void> {
    this.closed++;
  }
}

function makeDeps(): ReconcileDeps {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

const baseArgs: ImportManifestArgs = {
  workspaceId: "ws_demo",
  providerConnectionId: "pc_bitget",
  providerType: "bitget_agent_hub",
  toolManifestVersionId: "tmv_1",
};

function countType(events: { eventType: string }[], type: string): number {
  return events.filter((e) => e.eventType === type).length;
}

describe("importManifest", () => {
  it("reproduces the golden manifest hash and observed toolCount", async () => {
    const client = new FakeUpstreamClient({ kind: "tools", tools: bitget36RawTools });
    const result = await importManifest(baseArgs, client, makeDeps());
    expect(result.manifestHash).toBe(bitgetManifestHashV1);
    expect(result.toolCount).toBe(36);
  });

  it("emits the locked fan-out (1 imported + 4 blocked + 0 frozen)", async () => {
    const client = new FakeUpstreamClient({ kind: "tools", tools: bitget36RawTools });
    const result = await importManifest(baseArgs, client, makeDeps());
    expect(result.events).toHaveLength(5);
    expect(countType(result.events, "ToolManifestImported")).toBe(1);
    expect(countType(result.events, "ToolBlocked")).toBe(4);
    expect(countType(result.events, "ToolFrozen")).toBe(0);
    const blockedNames = result.events
      .filter((e) => e.eventType === "ToolBlocked")
      .map((e) => (e.payload as { toolName: string }).toolName)
      .sort();
    expect(blockedNames).toEqual([
      "cancel_withdrawal",
      "manage_subaccounts",
      "transfer",
      "withdraw",
    ]);
  });

  it("tears down the upstream exactly once on the happy path", async () => {
    const client = new FakeUpstreamClient({ kind: "tools", tools: bitget36RawTools });
    await importManifest(baseArgs, client, makeDeps());
    expect(client.opened).toBe(1);
    expect(client.listed).toBe(1);
    expect(client.closed).toBe(1);
  });

  it("fail-closed: open() failure surfaces UpstreamUnavailableError, never reaches the core", async () => {
    const client = new FakeUpstreamClient({ kind: "openThrows" });
    await expect(importManifest(baseArgs, client, makeDeps())).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
    expect(client.opened).toBe(1);
    expect(client.listed).toBe(0); // 3A core never reached → zero events
    expect(client.closed).toBe(0); // open() awaited before try → finally did not run
  });

  it("fail-closed: listTools() failure surfaces UpstreamListToolsError, still closes", async () => {
    const client = new FakeUpstreamClient({ kind: "listThrows" });
    await expect(importManifest(baseArgs, client, makeDeps())).rejects.toBeInstanceOf(
      UpstreamListToolsError,
    );
    expect(client.opened).toBe(1);
    expect(client.listed).toBe(1);
    expect(client.closed).toBe(1); // finally ran
  });

  it("no-ops on an approved baseline matching the observed manifest (Case 2)", async () => {
    const deps = makeDeps();
    const first = await importManifest(
      baseArgs,
      new FakeUpstreamClient({ kind: "tools", tools: bitget36RawTools }),
      deps,
    );
    const approved = {
      manifestHash: first.manifestHash,
      tools: first.normalized.map(manifestFingerprint),
    };
    const second = await importManifest(
      { ...baseArgs, approved },
      new FakeUpstreamClient({ kind: "tools", tools: bitget36RawTools }),
      makeDeps(),
    );
    expect(second.events).toHaveLength(0);
    expect(second.toolCount).toBe(36);
  });
});
