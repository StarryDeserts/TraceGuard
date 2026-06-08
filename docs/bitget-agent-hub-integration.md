# TraceGuard Bitget Agent Hub Integration

**Document status:** Draft v0.3
**Product:** TraceGuard
**Category:** Trading Agent Safety Runtime
**Primary purpose:** Define how TraceGuard becomes genuinely Bitget-first for the hackathon while preserving a provider-neutral core.

------

## 0. Executive Summary

TraceGuard must not look like a generic MCP proxy with a Bitget logo.

For the hackathon, the product must visibly start from Bitget Agent Hub's actual workflow:

```text
Developer connects an AI client to Bitget Agent Hub
→ Bitget tools become available to the agent
→ Agent can read market data and propose actions
→ TraceGuard adds tool governance, policy checks, approval, replay, and evidence
```

The correct positioning is:

```text
Bitget Agent Hub makes AI-native trading tools accessible.
TraceGuard makes those tools safer to operate through policy, approvals, replay, and audit evidence.
```

TraceGuard should be **Bitget-first in product and demo**, but **provider-neutral in architecture**.

That means:

```text
the first adapter is BitgetAgentHubAdapter
the first onboarding flow is --provider bitget
the first Tool Inventory shows Bitget MCP tools
the first real external call reads Bitget market data
the first policy template is Bitget-oriented
the first demo explains how this complements Bitget Agent Hub
```

It should not claim official endorsement or full GetClaw integration unless those exist.

------

## 1. Integration Goals

### 1.1 Product Goals

The Bitget integration should let a developer do the following:

```text
Run one onboarding command
→ detect or configure Bitget Agent Hub
→ import available MCP tools
→ see a Bitget Tool Inventory
→ run a real market-data call
→ create a protected agent run
→ approve a bounded simulated action
→ block a dangerous action
→ replay and export evidence
```

The user should feel that TraceGuard is not asking them to abandon Bitget Agent Hub. It wraps Bitget Agent Hub with governance.

### 1.2 Hackathon Goals

Judges should see:

```text
This project uses Bitget Agent Hub as the first-class integration surface.
This is not a generic log viewer.
This solves a real problem for people building trading agents on Bitget.
```

### 1.3 Safety Goals

The first release must default to:

```text
public market data: allowed and traced
account reads: audited and redacted
trade-like actions: simulated or approval-gated
asset movement: blocked
administrative operations: blocked
live execution: disabled unless explicitly enabled and capability-detected
```

------

## 2. Integration Surfaces

TraceGuard has five Bitget-facing surfaces.

| Surface           | Purpose                                            |
| ----------------- | -------------------------------------------------- |
| CLI               | Detect and configure Bitget Agent Hub              |
| MCP Gateway       | Intercept Bitget MCP tools                         |
| Web Control Plane | Show Bitget Tool Inventory, Runs, Replay, Evidence |
| Telegram Guardian | Approve or alert on Bitget-related agent actions   |
| Evidence Export   | Prove what Bitget tools and policies were involved |

The integration must be visible in all five surfaces.

If Bitget only appears in the README, the project will feel shallow.

------

## 3. CLI Onboarding

Recommended command:

```bash
npx @traceguard/cli init --provider bitget
```

Expected output:

```text
TraceGuard Bitget setup

✓ Local environment detected
✓ Bitget Agent Hub provider selected
✓ Bitget MCP tool inventory imported
✓ Tool manifest fingerprint created
✓ Sensitive operations classified
✓ Safe Demo policy activated

Next:
1. Add this MCP config to your AI client.
2. Open the TraceGuard Control Plane.
3. Run the guided BTCUSDT safety test.
```

### 3.1 Detection Strategy

The CLI should try, in order:

```text
1. inspect existing MCP client config for Bitget entries
2. detect installed bitget-mcp-server command or package
3. ask for manual command/path if not found
4. fall back to Safe Demo with captured sample provider metadata
```

The onboarding must not require trade-enabled credentials.

### 3.2 Failure Behavior

| Failure                               | User-facing behavior                  |
| ------------------------------------- | ------------------------------------- |
| Bitget Agent Hub not detected         | Offer manual config or Safe Demo      |
| Upstream `tools/list` fails           | Mark provider degraded                |
| Public market data unavailable        | Let user retry or use sample snapshot |
| Credentials missing                   | Continue with public market data only |
| Tool manifest cannot be fingerprinted | Freeze sensitive tools                |

------

## 4. Capability Detection

Never infer capability purely from a tool name.

TraceGuard should publish a detected capability object:

```ts
interface ProviderCapabilities {
  provider: "bitget_agent_hub" | "custom_mcp" | "generic_rest";
  adapterVersion: string;
  detectedAt: string;

  marketData: {
    publicRead: boolean;
    accountRead: boolean;
  };

  execution: {
    simulated: boolean;
    liveOrderPlace: boolean;
    liveOrderCancel: boolean;
    leverageChange: boolean;
    internalTransfer: boolean;
    withdraw: boolean;
  };

  evidence: {
    toolManifest: boolean;
    structuredOutput: boolean;
    receiptLookup: boolean;
  };
}
```

This is the canonical nested `ProviderCapabilities` type shared across the architecture, event model, and policy semantics. Bitget broker and administrative operations are not capability flags; they are governed by the `administrative` tool risk class and blocked by default.

Default:

```text
false until detected
```

This matters because the hackathon environment may support public or simulated flows more reliably than live execution.

### 4.1 Initial Capability Posture

| Capability                   | Initial behavior                   |
| ---------------------------- | ---------------------------------- |
| `marketData.publicRead`      | Enable when detected               |
| `marketData.accountRead`     | Enable with audit and redaction    |
| `execution.simulated`        | Enable for safe demo and replay    |
| `execution.liveOrderPlace`   | Simulate by default                |
| `execution.liveOrderCancel`  | Simulate or block                  |
| `execution.leverageChange`   | Approval-gated or blocked          |
| `execution.internalTransfer` | Block                              |
| `execution.withdraw`         | Block                              |
| `evidence.receiptLookup`     | Required before any live execution |

### 4.2 Capability Detection Events

Capability detection should emit:

```text
ProviderCapabilitiesDetected
ProviderDegraded
ProviderRecovered
```

Each event should include:

```text
providerConnectionId
adapterVersion
detectedCapabilities
unknownCapabilities
detectedAt
```

This lets Replay and Evidence Export show what the system believed the provider could safely do at the time.

------

## 5. Tool Import and Normalization

For every Bitget MCP tool, store a normalized record.

```ts
interface ImportedBitgetTool {
  providerConnectionId: string;
  providerType: "bitget_agent_hub";

  toolName: string;
  module?: "spot" | "futures" | "account" | "broker" | "unknown";

  title?: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: unknown;

  normalizedHash: string;

  riskClass:
    | "public_read"
    | "account_read"
    | "trade_like"
    | "asset_movement"
    | "administrative"
    | "unknown";

  status:
    | "approved"
    | "frozen"
    | "blocked"
    | "needs_review";
}
```

Normalization must include:

```text
tool name
description
input schema
output schema if available
annotations if available
provider identity
risk class
normalization version
```

### 5.1 Why Risk Class Belongs in the Manifest

Risk class should be included in the manifest hash.

Reason:

```text
A tool becoming more dangerous is as important as a schema change.
```

Example:

```text
futures_set_leverage initially classified as account_read
later reclassified as trade_like
```

This should create manifest drift and require review.

------

## 6. Bitget Tool Risk Classification

The classifier should use conservative mappings.

### 6.1 Public Read

Likely examples:

```text
ticker
depth
candles
funding rate
open interest
public market metadata
```

Default:

```text
allow and trace
```

Rationale:

```text
Public market-data calls are needed for the agent to analyze conditions.
Interrupting these calls would make TraceGuard feel like friction rather than infrastructure.
```

### 6.2 Account Read

Likely examples:

```text
balances
positions
account assets
order history
position history
```

Default:

```text
allow with audit if credentials are present
redact sensitive output in public exports
```

Rationale:

```text
Account reads can be necessary for risk-aware decisions, but they may expose sensitive data.
They should be visible in the ledger and redacted in public demo exports.
```

### 6.3 Trade-like

Likely examples:

```text
place order
cancel order
close position
change leverage
change margin mode
set stop loss
set take profit
```

Default:

```text
require Decision Envelope
evaluate policy
simulate by default
approval-gate if needed
```

Rationale:

```text
These tools can change market exposure.
They must never be forwarded simply because the model called them.
```

### 6.4 Asset Movement

Likely examples:

```text
withdraw
internal transfer
subaccount transfer
fund movement
```

Default:

```text
block
```

Rationale:

```text
TraceGuard v0.1 is a trading-agent safety runtime, not a funds-movement automation system.
Asset movement creates a different risk class and should remain out of the first product slice.
```

### 6.5 Administrative

Likely examples:

```text
broker API key creation
broker account operation
credential management
account administration
```

Default:

```text
block
```

Rationale:

```text
Administrative actions can expand future authority.
They are more dangerous than a single trade and should not be Telegram-approvable.
```

### 6.6 Unknown

Default:

```text
freeze pending review
```

Rationale:

```text
Unknown is not safe.
Unknown means TraceGuard has not yet established the risk boundary.
```

------

## 7. Bitget Tool Inventory UX

The Web Control Plane should show a Bitget-specific inventory.

Columns:

```text
Tool
Module
Risk Class
Status
Schema Fingerprint
Last Reviewed
Changed?
```

Example:

```text
spot_get_ticker              Spot      public_read      approved
futures_get_funding_rate     Futures   public_read      approved
futures_get_open_interest    Futures   public_read      approved
account_get_balances         Account   account_read     audit
futures_place_order          Futures   trade_like       policy-gated
account_withdraw             Account   asset_movement   blocked
broker_create_api_key        Broker    administrative   blocked
```

This page is important because it visually proves the Bitget-first integration.

### 7.1 Product Detail

The Tool Inventory should not look like a raw JSON dump.

It should answer:

```text
What can the agent see?
What can the agent call?
What is blocked?
What changed?
Which tools require policy or approval?
```

### 7.2 Manifest Drift UI

If a tool changes:

```text
Tool changed unexpectedly.
Status: Frozen
Action required: Review new definition
```

Show diff:

```text
previous schema
current schema
risk class
review status
```

------

## 8. Bitget Safe Policy Template

TraceGuard should ship a policy template designed for Bitget Agent Hub.

```yaml
policy_id: bitget-safe-demo
version: 1

providers:
  allowed:
    - bitget_agent_hub

mode:
  allowed:
    - safe_demo
    - approval_mode

instruments:
  allowed:
    - BTCUSDT
    - ETHUSDT

market_types:
  allowed:
    - spot
    - futures

orders:
  max_order_notional_usdt: "1000"
  max_position_notional_usdt: "3000"
  max_leverage: "3"

approval:
  required_above_notional_usdt: "500"
  required_above_leverage: "2"

blocked_operations:
  - withdraw
  - internal_transfer
  - broker_api_key_create
  - account_admin

context:
  require_approved_tool_manifest: true
  require_decision_envelope: true
  max_market_snapshot_age_seconds: 15

execution:
  simulator_enabled: true
  live_execution_enabled: false
```

This policy template is both a product feature and a demo prop.

It communicates:

```text
TraceGuard understands trading risk.
TraceGuard understands Bitget Agent Hub tools.
TraceGuard starts safe by default.
```

------

## 9. Guided Bitget Safety Test

Onboarding should not end with an empty dashboard.

The guided safety test should run:

```text
1. Read BTCUSDT ticker from Bitget market-data tool.
2. Read funding rate or open interest if available.
3. Capture a market snapshot.
4. Create a simulated BTCUSDT Decision Envelope.
5. Evaluate the Bitget Safe Demo policy.
6. Execute through simulator.
7. Store Run Detail and Evidence.
```

User-facing success message:

```text
Your first protected Bitget run is complete.

Market data: Captured
Decision: Simulated BTCUSDT action
Policy: Passed
Execution: Simulated
Evidence: Stored
```

### 9.1 Why This Matters

Most developer tools make the user connect something and then stare at an empty dashboard.

TraceGuard should immediately show:

```text
one protected run
one market snapshot
one policy result
one execution receipt
one replayable record
```

This makes the product tangible within minutes.

------

## 10. Demo Scenarios

### 10.1 Normal Bounded Action

Agent proposes:

```text
Buy 300 USDT BTCUSDT at 2x leverage.
```

TraceGuard:

```text
validates Decision Envelope
evaluates policy
requests approval if mode requires
sends Telegram approval
executes through simulator
stores execution receipt
```

Expected result:

```text
Approved once.
Simulated execution completed.
Evidence recorded.
```

### 10.2 Dangerous Action

Agent proposes:

```text
Buy 2500 USDT BTCUSDT at 8x leverage.
```

TraceGuard:

```text
blocks on max_order_notional_usdt
blocks on max_leverage
sends blocked-action alert
records no order was sent
```

Expected result:

```text
Blocked.
No order was sent.
Replayable evidence stored.
```

### 10.3 Replay

TraceGuard replays both runs:

```text
same Bitget market evidence
same Decision Envelope
same or new policy version
diff displayed
```

Expected result:

```text
The judge sees that TraceGuard is not only a runtime guard but also a debugging and regression-testing layer.
```

------

## 11. Evidence Fields

Bitget-related evidence bundles should include:

```text
provider type = bitget_agent_hub
provider connection ID
tool manifest hash
tool names used
market snapshot references
tool-call request and response hashes
Decision Envelope
policy version
policy evaluation result
approval record
execution adapter
execution receipt
replay result
bundle hash
```

Public demo exports must redact:

```text
private account IDs
private balances
API key references
credential scopes
real private order IDs
```

### 11.1 Evidence Export Value

Evidence is not just compliance theater.

It supports:

```text
debugging
incident review
public demo proof
policy regression testing
future proof trail
```

------

## 12. Messaging Strategy

### 12.1 Primary Claim

```text
Built for the Bitget Agent Hub ecosystem.
```

### 12.2 Strong Claim

```text
TraceGuard adds policy control, approvals, replay, and audit evidence around Bitget Agent Hub trading agents.
```

### 12.3 Ecosystem Claim

```text
Bitget Agent Hub makes AI-native trading tools accessible.
TraceGuard helps developers operate those agents with safer execution boundaries.
```

### 12.4 Claims to Avoid

Do not claim:

```text
officially endorsed by Bitget
fully integrated with GetClaw
guarantees safe trading
secures all Bitget activity
eliminates trading risk
supports live execution unless actually demonstrated
```

------

## 13. Why This Is Not a Generic Wrapper

A generic wrapper would say:

```text
We support many exchanges.
```

TraceGuard should say:

```text
We start with Bitget Agent Hub because it is already an MCP-native trading-agent ecosystem. We import Bitget tools, classify their risks, protect trade-like actions, and replay decisions built on Bitget market evidence.
```

Depth comes from the product workflow, not from mentioning Bitget in the README.

### 13.1 Good Product Framing

```text
Bitget Agent Hub gives agents access.
TraceGuard gives operators control.
```

### 13.2 Bad Product Framing

```text
TraceGuard is an exchange wrapper.
```

That framing is too shallow and misses the actual value.

------

## 14. Implementation Slice

Minimum real integration:

```text
CLI provider selection: bitget
Gateway tools/list through Bitget Agent Hub
Tool manifest hash
Tool risk classification
Tool Inventory page
Real BTCUSDT market-data call
Safe Demo policy template
Simulated 300 USDT BTCUSDT action
Blocked 2500 USDT 8x BTCUSDT action
Replay and evidence export
```

### 14.1 Do Not Overbuild v0.1

Do not start with:

```text
full live execution
multi-exchange support
complex portfolio accounting
chain anchoring
enterprise RBAC
complex backtesting
```

Those can come later.

The first Bitget slice must be coherent, not huge.

------

## 15. Failure Cases

| Failure                        | Behavior                       |
| ------------------------------ | ------------------------------ |
| Bitget Agent Hub not found     | Manual setup or Safe Demo      |
| `tools/list` fails             | Provider degraded              |
| Manifest changes               | Freeze changed sensitive tools |
| Public market data unavailable | Retry or use captured snapshot |
| Credentials missing            | Public market data only        |
| Live execution unavailable     | Simulator only                 |
| Unknown tool                   | Freeze pending review          |

### 15.1 UX Copy for Failures

Example:

```text
Bitget Agent Hub was not detected.
You can continue with Safe Demo or provide a manual MCP command.
```

Example:

```text
A Bitget tool changed unexpectedly.
TraceGuard froze the tool until review.
```

Example:

```text
Live execution is not enabled.
This action will be simulated.
```

------

## 16. Tests

| Test                           | Expected                               |
| ------------------------------ | -------------------------------------- |
| Import public-read tool        | Approved                               |
| Import withdrawal-like tool    | Blocked                                |
| Import unknown tool            | Frozen                                 |
| Read BTCUSDT ticker            | `ToolCallCompleted`                    |
| 300 USDT 2x simulated proposal | Allow or approval                      |
| 2500 USDT 8x proposal          | Block                                  |
| Tool schema changes            | `ToolManifestChanged` and `ToolFrozen` |
| Public demo export             | No secrets                             |
| Live execution disabled        | No real order sent                     |

------

## 17. Judge Q&A

### Q: Why is this infrastructure and not a strategy?

```text
TraceGuard does not decide what to trade. It governs how an agent may use trading tools. It provides policy checks, approvals, replay, and evidence around Bitget Agent Hub.
```

### Q: Why does Bitget need this if Agent Hub already has tools?

```text
Agent Hub gives agents access to tools. TraceGuard adds an operator runtime around that access: tool review, policy versions, one-time approvals, blocked actions, replay, and evidence export.
```

### Q: Are you executing real trades?

```text
The first release uses real Bitget market data and simulated execution by default. Live execution is treated as a capability-gated future adapter requiring explicit policy, approval, idempotency, and reconciliation.
```

### Q: Is this officially integrated with Bitget?

```text
This is designed for the Bitget Agent Hub ecosystem and uses Bitget Agent Hub as the first provider. We do not claim official endorsement.
```

------

## 18. Final Statement

TraceGuard should be provider-neutral in architecture and Bitget-first in product reality.

For the hackathon, the strongest story is not:

```text
We might support every exchange someday.
```

The strongest story is:

```text
We start where Bitget is already building: AI-native trading agents.

TraceGuard adds the runtime safety layer that makes those agents easier to trust, debug, approve, and replay.
```