# TraceGuard Demo Script

**Document status:** Draft v0.3
**Product:** TraceGuard
**Category:** Trading Agent Safety Runtime
**Purpose:** Define the 3-minute hackathon demo, judging narrative, fallback plan, and submission messaging.

------

## 0. Demo Goal

The demo should make judges understand TraceGuard in one sentence:

```text
Bitget Agent Hub lets AI agents reach trading tools.
TraceGuard makes those agents governable, approvable, replayable, and auditable.
```

The demo must not feel like a generic dashboard.

It must show one complete trust story:

```text
Connect Bitget Agent Hub
→ import tools
→ read real Bitget market data
→ approve a bounded simulated action
→ block a dangerous action
→ replay and diff
→ export evidence
```

The judge should leave with this understanding:

```text
AI trading agents are powerful, but risky.
TraceGuard adds the missing safety runtime between agents and execution.
```

------

## 1. Demo Constraints

Time limit:

```text
3 minutes
```

Assumptions:

```text
live execution is not required
public market-data call should be real
execution should be simulated by default
Telegram approval should be visible
Web Control Plane should show Run Detail and Replay
no sensitive credentials should be shown
```

The demo should be honest:

```text
Real market data.
Real policy check.
Real Telegram approval.
Real simulator receipt.
Real replay result.
No fake live funds.
```

------

## 2. Core Narrative

### 2.1 Problem

AI trading agents can now access powerful market and trading tools.

But once an agent can act, developers and operators need to know:

```text
What did it see?
Why did it propose this?
Did it stay inside my limits?
Who approved it?
Was anything sent upstream?
Can I replay it later?
```

Without TraceGuard, the developer may have tool calls and chat logs, but not a coherent safety runtime.

### 2.2 Solution

TraceGuard inserts a governed runtime between the agent and Bitget Agent Hub.

```text
Agent proposal
→ TraceGuard policy
→ approval when needed
→ simulated or controlled execution
→ replayable evidence
```

### 2.3 Differentiation

TraceGuard is:

```text
not another trading bot
not another strategy generator
not another market dashboard
not a thin API wrapper
```

TraceGuard is the safety control center for Bitget Agent Hub trading agents.

------

## 3. Demo Setup

Prepare:

```text
Web Control Plane open
Telegram Guardian open on phone or desktop
AI client or scripted agent prompt ready
Bitget public market-data call ready
Normal proposal fixture ready
Dangerous proposal fixture ready
Replay page ready
Evidence export ready
```

Scenarios:

```text
A. bounded BTCUSDT proposal
B. dangerous high-leverage BTCUSDT proposal
```

Recommended workspace state:

```text
Provider: Bitget Agent Hub
Mode: Approval Mode or Safe Demo with approval enabled
Policy: Bitget Safe Approval
Allowed instruments: BTCUSDT, ETHUSDT
Max order notional: 1000 USDT
Approval threshold: 500 USDT
Max leverage: 3x
Simulator: enabled
Live execution: disabled
```

------

## 4. Three-Minute Timeline

## 0:00–0:20 — Problem

Script:

```text
Bitget Agent Hub makes it easy for AI agents to connect to trading tools. But once an agent can act, developers need a runtime that answers: what did the agent see, why did it propose this action, did it stay inside policy, and can we replay the decision later?
```

Visual:

```text
AI Agent → Bitget Agent Hub
```

Then show TraceGuard inserted:

```text
AI Agent → TraceGuard → Bitget Agent Hub
```

Key message:

```text
Tool access is not enough. Trading agents need a safety runtime.
```

------

## 0:20–0:45 — Connect Bitget Agent Hub

Show:

```text
Provider: Bitget Agent Hub
Imported tools: 58
Manifest fingerprint: verified
Mode: Safe Demo / Approval Mode
```

Script:

```text
TraceGuard connects to Bitget Agent Hub as an MCP gateway. It imports the available tools, fingerprints the manifest, and classifies tools by risk.
```

Show Tool Inventory rows:

```text
spot_get_ticker              public_read      approved
futures_get_funding_rate     public_read      approved
account_get_balances         account_read     audit
futures_place_order          trade_like       policy-gated
account_withdraw             asset_movement   blocked
```

Key point:

```text
TraceGuard understands that not all tools carry the same risk.
```

Do not spend too long here. The Tool Inventory is proof, not the whole product.

------

## 0:45–1:10 — Real Bitget Market Data

Show agent or guided test:

```text
Read BTCUSDT ticker
Read funding rate
Capture market snapshot
```

Script:

```text
The agent can still use Bitget market data normally. TraceGuard does not interrupt harmless analysis, but it records the context as evidence for later replay.
```

Visual:

```text
Run Detail → Perception
BTCUSDT ticker captured
Funding rate captured
Snapshot stored
```

Key point:

```text
Read-only work stays low-friction. Risky actions get governed.
```

------

## 1:10–1:40 — Bounded Simulated Action + Telegram Approval

Agent proposes:

```text
Buy 300 USDT BTCUSDT at 2x leverage.
```

Show Decision Envelope:

```text
Instrument: BTCUSDT
Action: Open Long
Notional: 300 USDT
Leverage: 2x
Thesis: momentum positive while funding remains moderate
```

Policy result:

```text
REQUIRE_APPROVAL
```

Telegram message:

```text
BTCUSDT Buy Request
Amount: 300 USDT
Leverage: 2x
Policy: Passed
[Approve Once] [Reject] [View Trace]
```

Click:

```text
Approve Once
```

Show:

```text
Authorization issued
Authorization consumed
Simulated execution completed
```

Script:

```text
Approval is not broad permission. It is bound to this exact action digest and can be consumed only once.
```

Key point:

```text
The user approves one exact action, not a permanent authority expansion.
```

------

## 1:40–2:10 — Dangerous Action Blocked

Agent proposes:

```text
Buy 2500 USDT BTCUSDT at 8x leverage.
```

Show policy result:

```text
BLOCKED
```

Matched rules:

```text
Maximum order size: 1000 USDT
Requested order size: 2500 USDT

Maximum leverage: 3x
Requested leverage: 8x
```

Telegram alert:

```text
Action blocked by TraceGuard.
No order was sent.
```

Script:

```text
Here the agent is trying to exceed both notional and leverage limits. TraceGuard blocks it before any execution adapter is called.
```

Most important phrase:

```text
No order was sent.
```

This is the emotional peak of the demo. It proves TraceGuard is not just observing; it is enforcing.

------

## 2:10–2:40 — Replay and Diff

Open Replay.

Show two runs:

```text
Run A: approved simulated action
Run B: blocked dangerous action
```

Run Policy Replay on the dangerous action.

Show diff:

```text
Original policy: block
Replay policy: block
Result: match

Matched rules:
max_order_notional_usdt
max_leverage
```

Optional stricter policy:

```text
Policy v2 would also require approval above 200 USDT.
```

Script:

```text
TraceGuard is not just live monitoring. Every run can be replayed with the same evidence and compared across policy versions.
```

Key point:

```text
This turns agent behavior into something teams can debug and regression-test.
```

------

## 2:40–2:55 — Evidence Export

Show Evidence Export:

```text
Run metadata
Bitget tool manifest hash
Market snapshot
Decision envelope
Policy evaluation
Approval record
Execution receipt
Replay result
Bundle hash
```

Script:

```text
The result is an auditable evidence bundle that developers can use for debugging, incident review, or public demo export.
```

Key point:

```text
TraceGuard creates a durable record of why an agent action was allowed, approved, blocked, or replayed.
```

------

## 2:55–3:00 — Closing

Script:

```text
Bitget Agent Hub makes AI-native trading possible. TraceGuard makes it safer to trust, easier to debug, and ready to operate.
```

End with product line:

```text
TraceGuard: Safety Control Center for Bitget Trading Agents.
```

------

## 5. What Must Be Real

The demo must include:

```text
real Bitget public market-data call
actual imported tool inventory
actual manifest hash
actual policy evaluation
actual Telegram approval callback
actual simulator receipt
actual replay result
actual evidence bundle file
```

Do not fake these.

If something is simulated, label it as simulated.

------

## 6. What Can Be Simulated

It is acceptable to simulate:

```text
order execution
position update
fill receipt
PnL
live exchange submission
```

But the UI must clearly label:

```text
Simulated execution
```

Do not imply real funds were used.

Good phrase:

```text
We use real Bitget market data and simulated execution by default.
```

Bad phrase:

```text
We safely placed a real Bitget trade.
```

Unless that actually happened and was documented.

------

## 7. UI Checklist

### 7.1 Dashboard

Show:

```text
Provider connected
Safe Demo / Approval Mode
Pending approvals
Recent blocked actions
Recent runs
```

The dashboard should answer:

```text
Is my agent operating safely right now?
```

### 7.2 Tool Inventory

Show:

```text
Bitget tools
risk class
status
manifest hash
```

The Tool Inventory should answer:

```text
Which capabilities are exposed to the agent, and which are blocked?
```

### 7.3 Run Detail

Show timeline:

```text
Intent
Perception
Tool Calls
Decision
Policy
Approval
Execution
Evidence
```

The Run Detail should answer:

```text
Why did this happen?
```

### 7.4 Replay

Show:

```text
Original result
Replay result
Diff
Matched rules
Evidence status
```

The Replay page should answer:

```text
Can we reproduce or compare this run?
```

### 7.5 Telegram

Show:

```text
Approve Once
Reject
View Trace
Blocked action alert
```

Telegram should answer:

```text
What does the agent want to do, and do I need to act?
```

------

## 8. Judge-Facing Explanation

### 8.1 If a judge asks why this is infrastructure

Answer:

```text
TraceGuard is not a strategy. It is the runtime layer that lets developers operate trading agents safely: tool governance, policy enforcement, approvals, replay, and audit evidence.
```

### 8.2 If a judge asks why Bitget

Answer:

```text
The first adapter is designed around Bitget Agent Hub's MCP tool workflow. We import Bitget tools, classify their trading risk, call Bitget market data, and protect Bitget trade-like actions with policy and approvals.
```

### 8.3 If a judge asks why not just read-only mode

Answer:

```text
Read-only mode is useful, but developers need more granular control: some reads should pass, some simulated actions should run, some actions should require approval, and some must be blocked. TraceGuard adds that runtime policy layer plus replay and evidence.
```

### 8.4 If a judge asks about live trading

Answer:

```text
The first release defaults to simulation. Live execution is treated as a capability-gated adapter that requires explicit workspace mode, policy approval, idempotency, and reconciliation.
```

### 8.5 If a judge asks whether this competes with Bitget Agent Hub

Answer:

```text
No. Bitget Agent Hub gives agents access to tools. TraceGuard adds the governance layer around that access so developers can operate agents with more control and auditability.
```

------

## 9. Demo Failure Backup

### 9.1 If Telegram fails

Use Web approval page.

Say:

```text
Telegram is one approval channel, not the core runtime. The same approval request is available in the Web Control Plane.
```

### 9.2 If Bitget public market data fails

Use previously captured market snapshot.

Say:

```text
Replay and policy evaluation use stored evidence. The system does not depend on live API availability to reconstruct historical runs.
```

### 9.3 If MCP client fails

Use guided Web safety test that invokes the same Gateway/Adapter path.

Say:

```text
This guided test uses the same policy, event, and simulator path that the MCP Gateway uses.
```

### 9.4 If Replay takes too long

Use precomputed replay result, but show event and bundle IDs.

Say:

```text
This replay result is generated from the stored evidence bundle and linked to the original run.
```

### 9.5 If screen recording is too small to read

Zoom into:

```text
Policy result
Telegram approval
Blocked action reason
Replay diff
```

Do not waste time showing raw JSON.

------

## 10. Submission Assets

Prepare:

```text
GitHub repo
README quick start
Demo video
Architecture diagram
Screenshots:
  Tool Inventory
  Run Detail
  Telegram Approval
  Blocked Action
  Replay Diff
  Evidence Export
Public demo evidence bundle
```

The README should include:

```text
what TraceGuard is
why Bitget Agent Hub matters
quick start
demo scenario
architecture diagram
safety boundaries
what is simulated
what is not claimed
```

------

## 11. Video Description

Suggested text:

```text
TraceGuard is a Bitget-first safety runtime for trading agents. It connects to Bitget Agent Hub as an MCP gateway, imports and fingerprints tools, records agent runs, applies deterministic policies, requests one-time approvals through Telegram, blocks dangerous actions, and lets developers replay and export evidence for every run.
```

Short version:

```text
A safety control center for Bitget Agent Hub trading agents: policy checks, approvals, blocked actions, replay, and audit evidence.
```

------

## 12. Social Post Draft

```text
Built TraceGuard for the Bitget AI Hackathon.

Bitget Agent Hub makes it easy for AI agents to access trading tools.

TraceGuard adds the missing safety runtime:
- tool manifest review
- policy checks
- one-time approvals
- blocked dangerous actions
- replay and diff
- auditable evidence

Demo: AI proposes a normal BTC action, Telegram approves it once, then TraceGuard blocks an oversized 8x leverage proposal before execution.
```

------

## 13. Landing Page Copy

Headline:

```text
Safety Control Center for Bitget Trading Agents
```

Subheadline:

```text
TraceGuard adds policy checks, one-time approvals, replay, and auditable evidence around Bitget Agent Hub trading agents.
```

Hero bullets:

```text
See what your agent observed
Control what it can do
Approve risky actions once
Block unsafe proposals
Replay and export evidence
```

CTA:

```text
Connect Bitget Agent Hub
```

------

## 14. README Opening

Suggested README opening:

```text
# TraceGuard

TraceGuard is a Bitget-first safety runtime for trading agents.

It sits between an AI agent and Bitget Agent Hub, adding deterministic policy checks, one-time approvals, replayable decision traces, and auditable evidence.

Bitget Agent Hub makes AI-native trading tools accessible. TraceGuard helps developers operate those agents safely.
```

Safety boundary section:

```text
TraceGuard uses real Bitget market data in the demo.
Trade-like execution is simulated by default.
Live execution is disabled unless explicitly configured and capability-detected.
Withdrawals, transfers, and administrative tools are blocked by default.
```

------

## 15. Demo Script Full Voiceover

This is the continuous version for recording.

```text
Bitget Agent Hub makes it easy for AI agents to connect to trading tools. But once an agent can act, developers need a runtime that answers: what did the agent see, why did it propose this action, did it stay inside policy, and can we replay the decision later?

TraceGuard connects to Bitget Agent Hub as an MCP gateway. It imports the available tools, fingerprints the manifest, and classifies tools by risk. Public market-data tools are approved, account reads are audited, trade-like tools are policy-gated, and asset-movement tools are blocked by default.

Here the agent reads BTCUSDT market data from Bitget. TraceGuard does not interrupt harmless analysis, but it records the market snapshot as evidence for replay.

Now the agent proposes a bounded action: buy 300 USDT of BTCUSDT at 2x leverage. TraceGuard validates the Decision Envelope and evaluates the active policy. This action is within limits but requires approval, so TraceGuard sends a Telegram approval request.

I approve once. This does not grant broad permission. It creates a single-use authorization bound to this exact action digest. The simulator executes the action and stores an execution receipt.

Now the agent proposes a dangerous action: buy 2500 USDT of BTCUSDT at 8x leverage. This violates both the max order size and max leverage rules. TraceGuard blocks it before execution. No order was sent.

Finally, we open Replay. TraceGuard reconstructs the run from stored evidence, shows the same policy result, and lets us compare outcomes across policy versions. We can export an evidence bundle containing the Bitget tool manifest hash, market snapshot, decision envelope, policy evaluation, approval record, execution receipt, and replay result.

Bitget Agent Hub makes AI-native trading possible. TraceGuard makes it safer to trust, easier to debug, and ready to operate.
```

------

## 16. Shot List

### Shot 1

```text
Architecture diagram:
AI Agent → TraceGuard → Bitget Agent Hub
```

### Shot 2

```text
Tool Inventory:
Bitget tools classified by risk
```

### Shot 3

```text
Run Detail:
BTCUSDT market snapshot captured
```

### Shot 4

```text
Decision Envelope:
300 USDT BTCUSDT at 2x
```

### Shot 5

```text
Telegram:
Approve Once
```

### Shot 6

```text
Execution:
Simulated receipt
```

### Shot 7

```text
Blocked action:
2500 USDT at 8x
```

### Shot 8

```text
Replay Diff:
Original vs Replay
```

### Shot 9

```text
Evidence Export:
Bundle hash
```

------

## 17. What to Avoid in the Demo

Do not spend time on:

```text
settings pages
generic charts
raw database tables
raw JSON payloads
long architecture explanations
multi-provider future roadmap
complex policy editor
```

Do show:

```text
agent action
policy result
approval
block
replay
evidence
```

The demo should be a story, not a feature tour.

------

## 18. Strongest Winning Angle

The strongest angle is not:

```text
We built another AI trading assistant.
```

The strongest angle is:

```text
As trading agents become easier to build through Bitget Agent Hub, developers need a safety runtime that makes agent behavior controlled, approved, replayable, and auditable.
```

This positions TraceGuard as infrastructure, not strategy.

------

## 19. Final Demo Principle

Do not show many features.

Show one complete trust story:

```text
The agent can act.
TraceGuard sees it.
TraceGuard checks it.
The user approves it.
TraceGuard blocks what is unsafe.
The whole thing can be replayed.
```

That is the product.