// Bundle the governed MCP gateway into a single self-contained ESM file that
// runs under plain `node`. The workspace uses a src-first convention (every
// package's `main` points at ./src/*.ts), so the tsc-built dist bin cannot run
// standalone — its `@traceguard/*` imports resolve to TypeScript source whose
// `.js` import specifiers have no compiled counterpart. esbuild inlines every
// workspace dependency (rewriting those `.js` specifiers to their `.ts`
// sources), leaving a portable artifact. `bitget-mcp-server` stays external: it
// is resolved and spawned as a child process at runtime, never imported.
import { build } from "esbuild";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(pkgRoot, "dist/bin/gateway-local.mjs");

await build({
  entryPoints: [resolve(pkgRoot, "src/bin/gateway-local.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // esbuild preserves the entry file's hashbang on line 1, then emits this
  // banner below it. The banner defines a real `require` so esbuild's ESM
  // `__require` shim delegates to it instead of throwing — bundled CJS deps
  // (e.g. cross-spawn doing `require("child_process")`) need this to work.
  banner: {
    js: [
      "import { createRequire as __traceguardCreateRequire } from 'node:module';",
      "var require = __traceguardCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  external: ["bitget-mcp-server"],
  logLevel: "info",
});

chmodSync(outfile, 0o755);
console.error(`[build-bin] wrote ${outfile}`);
