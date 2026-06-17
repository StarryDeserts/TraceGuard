#!/usr/bin/env node
import { createRequire } from "node:module";
import { SystemClock, SystemIdGen, sha256hex } from "@traceguard/event-ledger";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StdioUpstreamClient } from "../stdio-upstream-client.js";
import { bootGateway } from "../boot-gateway.js";
import { resolveLedgerStore } from "../ledger-selection.js";

async function main(): Promise<void> {
  const newId = new SystemIdGen();
  const deps = { clock: new SystemClock(), newId, hash: sha256hex };
  const serverEntry = createRequire(import.meta.url).resolve("bitget-mcp-server");
  const client = new StdioUpstreamClient({
    command: process.execPath,
    args: [serverEntry, "--paper-trading"],
  });
  const store = resolveLedgerStore(process.env);

  const { server, state, client: live } = await bootGateway(
    {
      workspaceId: "ws_demo",
      providerConnectionId: "pc_bitget_demo",
      providerType: "bitget_agent_hub",
      toolManifestVersionId: newId.next("tmv"),
    },
    client,
    store,
    deps,
  );

  // stdout is reserved for downstream JSON-RPC; every diagnostic goes to stderr (contract §19.1).
  console.error(
    `[gateway-local] served tools: ${state.servedTools.length}${state.degraded ? " (DEGRADED)" : ""}`,
  );
  console.error(`[gateway-local] manifestHash: ${state.manifestHash ?? "—"}`);
  if (process.env.TRACEGUARD_LEDGER_DIR) {
    console.error(`[gateway-local] durable ledger dir: ${process.env.TRACEGUARD_LEDGER_DIR}`);
  }

  await server.connect(new StdioServerTransport());

  const shutdown = (): void => {
    void server.close().catch(() => {});
    void live.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error("[gateway-local] fail-closed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
