import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { SystemClock, SystemIdGen, sha256hex } from "@traceguard/event-ledger";
import { StdioUpstreamClient } from "./stdio-upstream-client.js";
import { importManifest } from "./import-manifest.js";

const live = Boolean(process.env.TRACEGUARD_LIVE_MCP);

describe.skipIf(!live)("StdioUpstreamClient (live, gated by TRACEGUARD_LIVE_MCP)", () => {
  it(
    "discovers the live Bitget manifest end-to-end",
    async () => {
      const serverEntry = createRequire(import.meta.url).resolve("bitget-mcp-server");
      const client = new StdioUpstreamClient({
        command: process.execPath,
        args: [serverEntry, "--paper-trading"],
      });
      const newId = new SystemIdGen();
      const result = await importManifest(
        {
          workspaceId: "ws_live",
          providerConnectionId: "pc_bitget_live",
          providerType: "bitget_agent_hub",
          toolManifestVersionId: newId.next("tmv"),
        },
        client,
        { clock: new SystemClock(), newId, hash: sha256hex },
      );
      expect(result.toolCount).toBeGreaterThan(0);
      expect(result.manifestHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.events.length).toBeGreaterThan(0);
    },
    30_000,
  );
});
