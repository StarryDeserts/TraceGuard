# TraceGuard — Governed Paper-Trading Demo

Every step below is replayed from the append-only TraceGuard ledger. Agent-facing results are redacted before display — no raw credentials or order bodies ever appear.

## Governed manifest

- Workspace: ws_demo
- Manifest hash: 5a71b4116875731722386daed9053712471e4b3d8b9dee7c97944cd1297ae050
- Governed tools: 1 active, 1 blocked, 1 frozen

## Happy path — approval granted, paper order placed

1. Run run_1 started by demo-agent — Governed paper-trading demo
2. Decision dec_1: buy BTCUSDT (spot), size 2500
3. Approval appr_1 requested — policy outcome: require_approval
4. Approval granted by ops-desk
5. Authorization authz_1 consumed
6. Execution simulated — receipt receipt:exec_1
7. Run finished — completed

## Fail-closed — approval denied, nothing reaches the exchange

1. Run run_1 started by demo-agent — Governed paper-trading demo
2. Decision dec_1: buy BTCUSDT (spot), size 2500
3. Approval appr_1 requested — policy outcome: require_approval
4. Approval denied by ops-desk
5. Run finished — completed
