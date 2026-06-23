import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// The bundled bin spawns the real bitget-mcp-server (--paper-trading, public
// data only) as its upstream, so this is gated behind TRACEGUARD_LIVE_MCP like
// the rest of the live suite. It is the regression guard proving the shipped
// artifact boots under plain `node` despite the src-first workspace layout.
const live = Boolean(process.env.TRACEGUARD_LIVE_MCP);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, "../../dist/bin/gateway-local.mjs");

describe.skipIf(!live)("gateway-local bundled bin (gated by TRACEGUARD_LIVE_MCP)", () => {
  it(
    "boots under plain node and emits the served-tools banner",
    async () => {
      expect(existsSync(bin)).toBe(true);

      const child = spawn(process.execPath, [bin], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      try {
        const banner = await new Promise<string>((res, rej) => {
          let buf = "";
          const timer = setTimeout(
            () => rej(new Error(`timeout waiting for banner; stderr so far:\n${buf}`)),
            25_000,
          );
          child.stderr.on("data", (d: Buffer) => {
            buf += d.toString();
            if (/served tools: \d+/.test(buf)) {
              clearTimeout(timer);
              res(buf);
            }
          });
          child.on("exit", (code) => {
            clearTimeout(timer);
            rej(new Error(`bin exited early (code=${code}); stderr:\n${buf}`));
          });
        });
        expect(banner).toMatch(/served tools: \d+/);
        expect(banner).not.toMatch(/DEGRADED/);
      } finally {
        child.kill("SIGTERM");
      }
    },
    30_000,
  );
});
