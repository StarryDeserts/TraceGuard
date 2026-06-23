# TraceGuard — Live Paper-Trading Evidence

This is the **verifiable usage record** for TraceGuard's governance running live
against the real Bitget Agent Hub MCP server. It is the live counterpart to the
deterministic, byte-reproducible transcript in
[`sample-governed-run.md`](sample-governed-run.md).

Where `sample-governed-run.md` is generated offline with the `simulator` adapter
(so it reproduces byte-for-byte), this record was captured from a **live run**
of TraceGuard's gateway-demo in front of `bitget-mcp-server --paper-trading`,
using the capability-gated `bitget_live` execution adapter.

## Provenance

| Field | Value |
| ----- | ----- |
| Captured | 2026-06-22, 10:46:55–10:46:56 UTC |
| Upstream | `bitget-mcp-server --paper-trading` (real Bitget Agent Hub MCP server) |
| Data used | **public market data only** — no API keys, no private endpoints, no funds |
| Workspace | `ws_demo` · provider connection `pc_bitget_demo` |
| Evaluator | `traceguard-3e1` |
| Raw event logs | [`live-events-happy.json`](live-events-happy.json) (18 events) · [`live-events-denied.json`](live-events-denied.json) (15 events) |

Both runs are append-only, hash-chained ledgers: every event carries a
`payloadHash` and a `previousEventHash` linking it to the prior event's
`eventHash`. The chain is tamper-evident and replays deterministically. IDs and
timestamps are per-run, so re-running produces an *equivalent* (not byte-identical)
log; `pnpm demo:live` independently re-verifies the same governance live.

## Governed manifest (both runs)

The gateway imported and fingerprinted the **real** upstream tool list, then
applied risk-class defaults before any run started.

- **Manifest hash:** `3a2999ecbddfd3a9e744625b23faa91e6bb9a00aa4cf40ebc977c2679a10f4de`
- **36 tools** imported → **31 active, 5 blocked, 0 frozen**

The 5 tools blocked by default (`reasonCode: risk_class_default`), before any
agent could call them:

| Tool | Risk class |
| ---- | ---------- |
| `withdraw` | `asset_movement` |
| `transfer` | `asset_movement` |
| `cancel_withdrawal` | `asset_movement` |
| `get_deposit_address` | `asset_movement` |
| `manage_subaccounts` | `administrative` |

## Run 1 — happy path: approved, then fail-closed at the live exchange

Run `run_a823b88b…`. The agent proposed an in-policy-but-large trade; a human
approved that exact action; the single-use authorization was burned; execution
was attempted via the live adapter — and the run **failed closed** because the
upstream could not confirm the order.

| # | Event | Time (UTC) | Key facts |
| - | ----- | ---------- | --------- |
| 1 | `ToolManifestImported` | 10:46:55.726 | 36 tools, hash `3a2999…` |
| 2–6 | `ToolBlocked` ×5 | 10:46:55.727–.728 | the 5 asset-movement/admin tools above |
| 7 | `RunCreated` | 10:46:55.731 | |
| 8 | `RunStarted` | 10:46:55.811 | agent `demo-agent`, mode `safe_demo` |
| 9 | `DecisionProposed` | 10:46:55.812 | BTCUSDT spot **buy**, notional **2500**, `decisionHash 5c30a9…` |
| 10 | `DecisionValidated` | 10:46:55.812 | `valid` |
| 11 | `PolicyEvaluationStarted` | 10:46:55.813 | evaluator `traceguard-3e1` |
| 12 | `PolicyEvaluated` | 10:46:55.813 | **`require_approval`** — rule `approve-large-notional` (2500 > 1000) |
| 13 | `ApprovalRequested` | 10:46:55.814 | `actionDigest 4a8d08…`, expires 11:01:55 |
| 14 | `ApprovalApproved` | 10:46:55.815 | by `ops-desk` (web) |
| 15 | `AuthorizationIssued` | 10:46:55.815 | `scope: single_action` |
| 16 | `ExecutionRequested` | 10:46:55.818 | adapter **`bitget_live`**, idempotency-keyed |
| 17 | `AuthorizationConsumed` | 10:46:55.818 | **burned** before the result is known |
| 18 | `RunFailed` | 10:46:55.823 | `reasonCode: orchestrator_error` |

**Why this is the safe outcome.** The authorization is single-use and was
**consumed before execution resolved** (burn-before-execute). When the live
upstream could not confirm the order, the run ended `RunFailed` — fail-closed —
and there is no surviving authorization to retry. This matches Bitget Agent Hub's
documented state that upstream order execution is not fully implemented yet: the
honest result is a failed run, not a silently dropped or duplicated order.

## Run 2 — fail-closed path: denied, nothing reaches the exchange

Run `run_05e67508…`. Same proposal, but the human **denied** the approval. The
chain stops at the approval — **no authorization is ever issued and no execution
is ever requested.**

| # | Event | Time (UTC) | Key facts |
| - | ----- | ---------- | --------- |
| 1 | `ToolManifestImported` | 10:46:5x | same manifest hash `3a2999…` |
| 2–6 | `ToolBlocked` ×5 | | same 5 tools |
| 7 | `RunCreated` | | |
| 8 | `RunStarted` | | |
| 9 | `DecisionProposed` | | BTCUSDT spot **buy**, notional **2500** |
| 10 | `DecisionValidated` | | `valid` |
| 11 | `PolicyEvaluationStarted` | | |
| 12 | `PolicyEvaluated` | | **`require_approval`** |
| 13 | `ApprovalRequested` | 10:46:56.115 | `actionDigest 8aecdf…` |
| 14 | `ApprovalRejected` | 10:46:56.116 | by `ops-desk`, reason `demo denial` |
| 15 | `RunCompleted` | 10:46:56.116 | **no `AuthorizationIssued`, no `ExecutionRequested`** |

The absence of any `Authorization*` or `Execution*` event in this log is the
proof: when approval is withheld, **nothing reaches the exchange.**

## How to reproduce

```bash
pnpm demo:live
```

This boots the gateway against `bitget-mcp-server --paper-trading` and asserts the
same governance live: the manifest is fingerprinted, the asset-movement tools are
excluded, a real `spot_get_ticker BTCUSDT` passes, a raw `spot_place_order` with
no Decision Envelope is rejected (`DECISION_ENVELOPE_REQUIRED`), an in-policy
decision is `ALLOWED`, and an out-of-policy one is `POLICY_BLOCKED`. See the
repository README for the offline counterpart (`pnpm demo`).
