import { describe, it, expect } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { RawUpstreamTool } from "@traceguard/schemas";
import { InMemoryLedgerStore, sha256hex } from "@traceguard/event-ledger";
import type { ReconcileDeps } from "@traceguard/tool-manifest";
import {
  bitget36RawTools,
  bitgetManifestHashV1,
  fixedClock,
  sequentialIdGen,
} from "@traceguard/testing-fixtures";
import { bootGateway, type BootGatewayArgs } from "./boot-gateway.js";
import {
  UpstreamListToolsError,
  UpstreamUnavailableError,
  type UpstreamManifestClient,
} from "./upstream-client.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

function tg(res: unknown): Record<string, unknown> {
  return ((res as { traceguard?: Record<string, unknown> }).traceguard ?? {}) as Record<string, unknown>;
}

async function connect(server: import("@modelcontextprotocol/sdk/server/index.js").Server): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "boot-test-agent", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

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

const baseArgs: BootGatewayArgs = {
  workspaceId: "ws_demo",
  providerConnectionId: "pc_bitget",
  providerType: "bitget_agent_hub",
  toolManifestVersionId: "tmv_1",
};

describe("bootGateway", () => {
  it("happy path: serves 32 governed tools, persists events, keeps the client open", async () => {
    const client = new FakeUpstreamClient({ kind: "tools", tools: bitget36RawTools });
    const store = new InMemoryLedgerStore();
    const handle = await bootGateway(baseArgs, client, store, makeDeps());

    expect(handle.state.degraded).toBe(false);
    expect(handle.state.servedTools).toHaveLength(32);
    expect(handle.state.manifestHash).toBe(bitgetManifestHashV1);
    expect(handle.state.toolCount).toBe(36);
    expect(handle.server).toBeDefined();

    expect(client.opened).toBe(1);
    expect(client.listed).toBe(1);
    expect(client.closed).toBe(0); // D2: connection kept alive on success

    expect(await store.head(baseArgs.workspaceId)).not.toBeNull();
    const events = await store.read(baseArgs.workspaceId);
    expect(events).toHaveLength(6);
    expect(handle.runId).toMatch(/^run_/);
    const runEvent = events[5]!;
    expect(runEvent.eventType).toBe("RunCreated");
    expect(runEvent.aggregateType).toBe("run");
    expect(runEvent.previousEventHash).toBe(events[4]!.eventHash);
  });

  it("degraded (listTools throws): empty tool list, client closed, nothing persisted", async () => {
    const client = new FakeUpstreamClient({ kind: "listThrows" });
    const store = new InMemoryLedgerStore();
    const handle = await bootGateway(baseArgs, client, store, makeDeps());

    expect(handle.state.degraded).toBe(true);
    expect(handle.state.servedTools).toHaveLength(0);
    expect(handle.state.manifestHash).toBeNull();
    expect(handle.server).toBeDefined(); // still serves (empty list), never refuses to boot

    expect(client.opened).toBe(1);
    expect(client.listed).toBe(1);
    expect(client.closed).toBe(1); // degraded: nothing to keep alive

    expect(await store.read(baseArgs.workspaceId)).toHaveLength(0);
    expect(handle.runId).toBeUndefined();
  });

  it("degraded (open throws): never lists, client closed, nothing persisted", async () => {
    const client = new FakeUpstreamClient({ kind: "openThrows" });
    const store = new InMemoryLedgerStore();
    const handle = await bootGateway(baseArgs, client, store, makeDeps());

    expect(handle.state.degraded).toBe(true);
    expect(handle.state.servedTools).toHaveLength(0);

    expect(client.opened).toBe(1);
    expect(client.listed).toBe(0); // open() threw before listTools
    expect(client.closed).toBe(1);

    expect(await store.read(baseArgs.workspaceId)).toHaveLength(0);
    expect(handle.runId).toBeUndefined();
  });

  it("happy path: exposes the operator seam and runs require_approval -> approve -> EXECUTED", async () => {
    const client = new FakeUpstreamClient({ kind: "tools", tools: bitget36RawTools });
    const store = new InMemoryLedgerStore();
    const handle = await bootGateway(baseArgs, client, store, makeDeps());

    expect(typeof handle.approve).toBe("function");
    expect(typeof handle.reject).toBe("function");
    expect(handle.runId).toMatch(/^run_/);

    const agent = await connect(handle.server);
    try {
      await agent.callTool({
        name: "traceguard_start_run",
        arguments: { runId: handle.runId, agentName: "a", intent: "i" },
      });
      const rec = await agent.callTool({
        name: "traceguard_record_decision",
        arguments: {
          runId: handle.runId,
          instrument: "BTCUSDT",
          marketType: "futures",
          action: "open_long",
          thesis: "t",
          evidenceRefs: ["ev:1"],
          requestedNotionalUsdt: "5000",
          requestedLeverage: "2",
        },
      });
      const decisionId = tg(rec).decisionId as string;

      const reqExec = await agent.callTool({
        name: "traceguard_request_execution",
        arguments: { runId: handle.runId, decisionId, executionAdapter: "simulator" },
      });
      expect(tg(reqExec).status).toBe("APPROVAL_REQUIRED");
      const approvalId = tg(reqExec).approvalId as string;

      const pending = await agent.callTool({ name: "traceguard_check_approval", arguments: { approvalId } });
      expect(tg(pending).status).toBe("PENDING");

      const outcome = await handle.approve!(approvalId, { approvedBy: "ops", channel: "web" });
      expect(outcome).toBe("approved");

      const approved = await agent.callTool({ name: "traceguard_check_approval", arguments: { approvalId } });
      expect(tg(approved).status).toBe("APPROVED");
      const authorizationId = tg(approved).authorizationId as string;

      const exec = await agent.callTool({
        name: "traceguard_execute_authorized_action",
        arguments: { runId: handle.runId, decisionId, authorizationId, executionAdapter: "simulator" },
      });
      expect(tg(exec).status).toBe("EXECUTED");
      expect((tg(exec).receipt as { finalStatus?: string }).finalStatus).toBe("simulated");
    } finally {
      await agent.close();
    }
  });

  it("degraded path: no operator seam, no runId, no internal tools listed", async () => {
    const client = new FakeUpstreamClient({ kind: "listThrows" });
    const store = new InMemoryLedgerStore();
    const handle = await bootGateway(baseArgs, client, store, makeDeps());

    expect(handle.approve).toBeUndefined();
    expect(handle.reject).toBeUndefined();
    expect(handle.runId).toBeUndefined();

    const agent = await connect(handle.server);
    try {
      const names = (await agent.listTools()).tools.map((t) => t.name);
      expect(names.some((n) => n.startsWith("traceguard_"))).toBe(false);
    } finally {
      await agent.close();
    }
  });
});
