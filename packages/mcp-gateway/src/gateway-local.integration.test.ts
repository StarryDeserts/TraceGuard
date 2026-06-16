import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { SystemClock, SystemIdGen, sha256hex, InMemoryLedgerStore } from "@traceguard/event-ledger";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioUpstreamClient } from "./stdio-upstream-client.js";
import { bootGateway } from "./boot-gateway.js";

const live = Boolean(process.env.TRACEGUARD_LIVE_MCP);
const BLOCKED = ["withdraw", "transfer", "cancel_withdrawal", "manage_subaccounts"];

describe.skipIf(!live)("gateway-local (live, gated by TRACEGUARD_LIVE_MCP)", () => {
  it(
    "boots a governed gateway against the real bitget-mcp-server",
    async () => {
      const serverEntry = createRequire(import.meta.url).resolve("bitget-mcp-server");
      const newId = new SystemIdGen();
      const client = new StdioUpstreamClient({
        command: process.execPath,
        args: [serverEntry, "--paper-trading"],
      });
      const store = new InMemoryLedgerStore();
      const handle = await bootGateway(
        {
          workspaceId: "ws_live",
          providerConnectionId: "pc_bitget_live",
          providerType: "bitget_agent_hub",
          toolManifestVersionId: newId.next("tmv"),
        },
        client,
        store,
        { clock: new SystemClock(), newId, hash: sha256hex },
      );
      try {
        expect(handle.state.degraded).toBe(false);
        expect(handle.state.servedTools.length).toBeGreaterThan(0);
        expect(handle.state.manifestHash).toMatch(/^[0-9a-f]{64}$/);
        const names = handle.state.servedTools.map((t) => t.name);
        for (const blocked of BLOCKED) expect(names).not.toContain(blocked);
        const [agentTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await handle.server.connect(serverTransport);
        const agent = new Client({ name: "live-test-agent", version: "0.0.0" });
        await agent.connect(agentTransport);
        try {
          const ok = await agent.callTool({
            name: "spot_get_ticker",
            arguments: { symbol: "BTCUSDT" },
          });
          expect((ok as { isError?: boolean }).isError).toBeFalsy();

          const denied = await agent.callTool({
            name: "spot_place_order",
            arguments: {},
          });
          expect(
            (denied as { traceguard?: { errorCode?: string } }).traceguard?.errorCode,
          ).toBe("DECISION_ENVELOPE_REQUIRED");

          const listed = await agent.listTools();
          expect(listed.tools.map((t) => t.name)).toContain("traceguard_record_decision");

          await agent.callTool({
            name: "traceguard_start_run",
            arguments: { runId: handle.runId, agentName: "live", intent: "demo" },
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
              requestedNotionalUsdt: "100",
              requestedLeverage: "2",
            },
          });
          const decisionId = (rec as { traceguard?: { decisionId?: string } }).traceguard?.decisionId;
          const allowed = await agent.callTool({
            name: "traceguard_request_execution",
            arguments: { runId: handle.runId, decisionId, executionAdapter: "simulator" },
          });
          expect((allowed as { traceguard?: { status?: string } }).traceguard?.status).toBe("ALLOWED");

          const recBlocked = await agent.callTool({
            name: "traceguard_record_decision",
            arguments: {
              runId: handle.runId,
              instrument: "BTCUSDT",
              marketType: "futures",
              action: "open_long",
              thesis: "t",
              evidenceRefs: ["ev:1"],
              requestedNotionalUsdt: "100",
              requestedLeverage: "10",
            },
          });
          const blockedId = (recBlocked as { traceguard?: { decisionId?: string } }).traceguard?.decisionId;
          const blocked = await agent.callTool({
            name: "traceguard_request_execution",
            arguments: { runId: handle.runId, decisionId: blockedId, executionAdapter: "simulator" },
          });
          expect((blocked as { traceguard?: { errorCode?: string } }).traceguard?.errorCode).toBe(
            "POLICY_BLOCKED",
          );
        } finally {
          await agent.close();
        }
      } finally {
        await handle.client.close();
      }
    },
    30_000,
  );
});
