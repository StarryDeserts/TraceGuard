#!/usr/bin/env bash
#
# TraceGuard one-click governed-run demo.
#
# Deterministic and offline: no exchange credentials, no network, no Bitget
# account. It reproduces the committed governed run from the append-only
# TraceGuard ledger and prints the redacted transcript a judge would review.
#
# Why vitest is the runner: this repo's packages resolve to TypeScript sources
# (each package's "main" points at ./src/*.ts), so a plain `node dist/...` entry
# cannot load them. vitest (vite/esbuild) is the project's TypeScript runner and
# resolves the workspace sources, so the demo runs through it.
#
# Usage:
#   pnpm demo          # or: bash scripts/demo.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

GOLDEN_TEST="packages/mcp-gateway/src/demo/sample-governed-run.golden.test.ts"
TRANSCRIPT="docs/superpowers/demo/sample-governed-run.md"

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies (pnpm install --frozen-lockfile)…"
  pnpm install --frozen-lockfile
  echo
fi

echo "==> Reproducing the governed run (deterministic backend, no live exchange)…"
echo "    The test below rebuilds the transcript in-memory from the real gateway"
echo "    runtime + ledger and asserts it byte-for-byte equals the committed file."
echo
pnpm exec vitest run "$GOLDEN_TEST"

echo
echo "================================================================"
echo "  Governed run transcript — replayed from the append-only ledger"
echo "  (agent-facing results are redacted; no credentials or order"
echo "   bodies ever appear)"
echo "================================================================"
echo
cat "$TRANSCRIPT"
