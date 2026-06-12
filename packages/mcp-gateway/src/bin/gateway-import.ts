#!/usr/bin/env node
import { createRequire } from "node:module";
import {
  SystemClock,
  SystemIdGen,
  sha256hex,
  toolManifestProjection,
} from "@traceguard/event-ledger";
import { StdioUpstreamClient } from "../stdio-upstream-client.js";
import { importManifest } from "../import-manifest.js";

async function main(): Promise<void> {
  const newId = new SystemIdGen();
  const deps = { clock: new SystemClock(), newId, hash: sha256hex };

  // child_process.spawn searches PATH, not node_modules/.bin — resolve the entry explicitly
  // and launch it with `node <entry>`, rather than relying on a bin shim on PATH.
  const serverEntry = createRequire(import.meta.url).resolve("bitget-mcp-server");
  const client = new StdioUpstreamClient({
    command: process.execPath,
    args: [serverEntry, "--paper-trading"],
  });

  const result = await importManifest(
    {
      workspaceId: "ws_demo",
      providerConnectionId: "pc_bitget_demo",
      providerType: "bitget_agent_hub",
      toolManifestVersionId: newId.next("tmv"),
    },
    client,
    deps,
  );

  const view = toolManifestProjection(result.events);
  const n = (s: string): number => view.tools.filter((t) => t.status === s).length;
  console.log(`upstream tools: ${result.toolCount}`);
  console.log(`manifestHash:   ${result.manifestHash}`);
  console.log(`governed:       active=${n("active")} blocked=${n("blocked")} frozen=${n("frozen")}`);
}

main().catch((err: unknown) => {
  console.error("[gateway-import] fail-closed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
