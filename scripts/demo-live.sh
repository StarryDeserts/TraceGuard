#!/usr/bin/env bash
#
# TraceGuard live paper-trading demo.
#
# This goes one tier past `pnpm demo`: instead of a deterministic offline
# replay, it boots the TraceGuard gateway against the REAL Bitget Agent Hub
# MCP server (`bitget-mcp-server --paper-trading`) and exercises governance
# against live Bitget market data.
#
# What it proves, live and reproducibly:
#   - the gateway imports and fingerprints the real upstream tool manifest;
#   - asset-movement tools (withdraw, transfer, ...) are excluded by default;
#   - a real `spot_get_ticker BTCUSDT` call against Bitget passes governance;
#   - a raw `spot_place_order` with no Decision Envelope is rejected
#     (DECISION_ENVELOPE_REQUIRED);
#   - an in-policy decision (2x leverage) is ALLOWED and an out-of-policy one
#     (10x leverage) is POLICY_BLOCKED.
#
# Requirements vs. `pnpm demo`:
#   - network access (it reaches Bitget public market-data endpoints);
#   - it spawns `bitget-mcp-server --paper-trading`, which uses PUBLIC market
#     data only — no API keys, no private endpoints, no real funds.
#
# Why vitest is the runner: same reason as scripts/demo.sh — each package's
# "main" points at ./src/*.ts, so vitest (vite/esbuild) is the project's
# TypeScript runner. The live integration test is gated behind the
# TRACEGUARD_LIVE_MCP env var so it only runs when you opt in here.
#
# Usage:
#   pnpm demo:live     # or: bash scripts/demo-live.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LIVE_TEST="packages/mcp-gateway/src/gateway-local.integration.test.ts"

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies (pnpm install --frozen-lockfile)…"
  pnpm install --frozen-lockfile
  echo
fi

echo "==> Booting the TraceGuard gateway against the REAL bitget-mcp-server"
echo "    (--paper-trading, public market data only — no API keys, no funds)…"
echo
echo "    This spawns bitget-mcp-server and reaches Bitget public endpoints, so"
echo "    it needs network access. It then governs a real spot_get_ticker call"
echo "    and proves trade-like proposals are policy-checked before execution."
echo

TRACEGUARD_LIVE_MCP=1 pnpm exec vitest run "$LIVE_TEST"

echo
echo "================================================================"
echo "  Live paper-trading governance verified against bitget-mcp-server"
echo "    - upstream manifest fingerprinted; asset-movement tools blocked"
echo "    - real BTCUSDT ticker call passed governance"
echo "    - raw spot_place_order rejected (DECISION_ENVELOPE_REQUIRED)"
echo "    - in-policy decision ALLOWED; out-of-policy decision POLICY_BLOCKED"
echo "================================================================"
