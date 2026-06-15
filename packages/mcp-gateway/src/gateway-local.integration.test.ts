import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { SystemClock, SystemIdGen, sha256hex, InMemoryLedgerStore } from "@traceguard/event-ledger";
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
      } finally {
        await handle.client.close();
      }
    },
    30_000,
  );
});
