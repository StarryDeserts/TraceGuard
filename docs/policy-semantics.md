# TraceGuard Policy Semantics

**Document status:** Draft v0.2
**Product:** TraceGuard
**Category:** Trading Agent Safety Runtime
**Primary purpose:** Define the deterministic authorization semantics that separate agent proposals from executable authority.

------

## 0. Executive Summary

TraceGuard's policy layer exists to answer one question:

> Given an agent proposal, current workspace mode, active policy version, provider capabilities, approved tool manifest, market context, and approval state, should this action be allowed, escalated to human approval, or blocked?

The policy engine must be deterministic. It must not depend on an LLM to make the final authorization decision.

The central invariant is:

```text
Proposal ≠ Authorization ≠ Execution
```

A trading agent may propose an action. A policy may allow, require approval, or block it. An execution adapter may execute only after a valid authorization exists.

TraceGuard does not make trading agents safer by trusting the model more. It makes them safer by trusting the model less at the execution boundary.

------

## 1. Design Goals

TraceGuard policy semantics must satisfy six goals.

### 1.1 Safety

Prevent unauthorized, oversized, over-leveraged, stale-context, unreviewed-tool, or asset-movement actions even when the agent is manipulated.

### 1.2 Clarity

Explain exactly why an action was allowed, escalated, or blocked.

Bad explanation:

```text
Rule P-ORDER-002 failed.
```

Good explanation:

```text
This action was blocked because the requested leverage is 8×, but your policy limit is 3×.
```

### 1.3 Replayability

The same decision, market snapshot, tool manifest, provider capability set, policy version, and evaluator version must produce the same result during Replay.

### 1.4 Auditability

Every evaluation must record:

```text
policyVersionId
evaluatorVersion
decisionId
toolManifestHash
matchedRules
outcome
evaluationInputHash
evaluationOutputHash
```

### 1.5 Low Friction

Harmless read-only analysis should not constantly interrupt the user. Market-data queries should usually pass automatically but still be traced.

### 1.6 Bitget-first Usefulness

The semantics must map naturally onto Bitget Agent Hub tools:

```text
public market data       → allow and trace
account reads            → allow with audit
trade-like actions       → policy-gated
internal transfer        → block by default
withdraw                 → block by default
broker/admin operations  → block by default
```

------

## 2. Non-Goals

TraceGuard policies do not:

```text
predict market direction
determine whether a strategy is profitable
replace exchange-side permission controls
guarantee regulatory compliance
use an LLM as the final authorization engine
allow model-generated policy drafts to publish themselves
grant broad permanent approvals through Telegram
make live execution safe without capability detection and reconciliation
```

Policy is not alpha. Policy is the execution boundary.

------

## 3. Core Policy Outcomes

Every policy evaluation returns exactly one top-level outcome.

| Outcome            | Meaning                                                      | Can execution proceed?                         |
| ------------------ | ------------------------------------------------------------ | ---------------------------------------------- |
| `allow`            | The action fits all active rules and does not need human confirmation. | Yes, if adapter and workspace mode support it. |
| `require_approval` | The action is within hard limits but requires a human decision. | Only after single-use authorization.           |
| `block`            | The action violates a hard rule or required context is missing. | No.                                            |

------

## 4. Outcome Precedence

Policy outcomes are ordered by safety:

```text
block > require_approval > allow
```

Evaluation rule:

```text
If any block rule matches:
  outcome = block

Else if any require_approval rule matches:
  outcome = require_approval

Else:
  outcome = allow
```

This must hold even when an allow rule also matches.

Example:

```text
BTCUSDT is allowed.
But requested leverage is 8×.
Policy max leverage is 3×.
Result: block.
```

The fact that BTCUSDT is an allowed instrument does not matter once a hard leverage rule is violated.

------

## 5. Policy Inputs

A policy evaluation requires a normalized input object.

```ts
interface PolicyEvaluationInput {
  workspace: {
    id: string;
    mode:
      | "safe_demo"
      | "approval_mode"
      | "guarded_autopilot"
      | "locked_investigation";
  };

  provider: {
    providerConnectionId: string;
    providerType:
      | "bitget_agent_hub"
      | "custom_mcp"
      | "generic_rest";
    capabilities: ProviderCapabilities;
  };

  tool: {
    name: string;
    riskClass:
      | "public_read"
      | "account_read"
      | "trade_like"
      | "asset_movement"
      | "administrative"
      | "unknown";
    manifestVersionId: string;
    manifestHash: string;
    reviewStatus:
      | "approved"
      | "needs_review"
      | "frozen"
      | "blocked";
  };

  decision?: DecisionEnvelope;

  context: {
    marketSnapshotId?: string;
    marketSnapshotCapturedAt?: string;
    marketSnapshotExpiresAt?: string;
    currentTime: string;
  };

  policy: {
    policyVersionId: string;
    evaluatorVersion: string;
  };
}
```

`ProviderCapabilities` is the canonical nested capability type: `{ provider, adapterVersion, detectedAt, marketData: { publicRead, accountRead }, execution: { simulated, liveOrderPlace, liveOrderCancel, leverageChange, internalTransfer, withdraw }, evidence: { toolManifest, structuredOutput, receiptLookup } }`. Policy evaluation reads only the nested booleans; it never relies on a flattened capability shape.

If a required field is missing, TraceGuard must fail closed.

```text
Missing required context → block
```

Never silently allow.

------

## 6. Decision Envelope

A `DecisionEnvelope` is mandatory for trade-like actions.

```ts
interface DecisionEnvelope {
  id: string;

  instrument: string;
  marketType:
    | "spot"
    | "futures"
    | "tokenized_stock";

  action:
    | "buy"
    | "sell"
    | "open_long"
    | "open_short"
    | "reduce"
    | "close"
    | "hold"
    | "abstain";

  thesis: string;
  confidence?: number;

  evidenceRefs: string[];

  requestedNotionalUsdt?: string;
  requestedQuantity?: string;
  requestedLeverage?: string;

  orderType?: string;
  limitPrice?: string;

  stopLoss?: string;
  takeProfit?: string;

  promptVersion?: string;
  modelProvider?: string;
  modelName?: string;
}
```

### 6.1 The thesis is not chain-of-thought

The `thesis` field stores a public explanation, not hidden model reasoning.

Acceptable:

```text
Momentum remains positive while funding is moderate.
```

Not acceptable:

```text
A private chain-of-thought transcript.
```

TraceGuard should record what the agent publicly claims, what evidence it references, and what action it proposes. It should not attempt to preserve hidden model reasoning.

### 6.2 Financial and execution values must be decimal strings

All financial and execution values in policy inputs and event payloads (notional, quantity, leverage, limit price, stop loss, take profit) must use decimal strings.

Use:

```json
{
  "requestedNotionalUsdt": "300",
  "requestedLeverage": "2"
}
```

Avoid:

```json
{
  "requestedNotionalUsdt": 300.0,
  "requestedLeverage": 2.0
}
```

Reason:

```text
No floating-point drift
Stable action digest
Deterministic replay
Cleaner audit output
```

`confidence` is exempt. It is an advisory model score, not a financial or execution value, so it stays a JSON number and is excluded from the decision hash and the action digest.

------

## 7. Policy DSL

TraceGuard should support YAML and JSON.

YAML is better for humans. JSON is better for APIs.

Example:

```yaml
policy_id: bitget-safe-approval
version: 1

mode:
  allowed:
    - safe_demo
    - approval_mode

providers:
  allowed:
    - bitget_agent_hub

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
  - api_key_create
  - broker_api_key_create

context:
  require_decision_envelope: true
  require_approved_tool_manifest: true
  max_market_snapshot_age_seconds: 15

execution:
  live_execution_enabled: false
  simulator_enabled: true
```

------

## 8. Rule Families

### 8.1 Workspace Mode Rules

| Mode                   | Behavior                                                     |
| ---------------------- | ------------------------------------------------------------ |
| `safe_demo`            | Trade-like actions can only use simulator or replay adapters. |
| `approval_mode`        | Trade-like actions require approval unless policy explicitly allows bounded simulated actions. |
| `guarded_autopilot`    | Low-risk bounded actions may proceed automatically; higher-risk actions escalate. |
| `locked_investigation` | New trade-like execution is blocked. Replay and evidence remain available. |

Hard rule:

```text
locked_investigation always blocks new execution.
```

### 8.2 Tool Risk Rules

| Risk class       | Default outcome                                  |
| ---------------- | ------------------------------------------------ |
| `public_read`    | `allow`                                          |
| `account_read`   | `allow` with audit                               |
| `trade_like`     | Requires Decision Envelope and policy evaluation |
| `asset_movement` | `block` by default                               |
| `administrative` | `block` by default                               |
| `unknown`        | `block` by default                               |

### 8.3 Instrument Rules

If `instruments.allowed` exists, the proposed instrument must appear in that list.

Violation:

```text
block
```

Example:

```text
Allowed: BTCUSDT, ETHUSDT
Requested: DOGEUSDT
Result: block
```

### 8.4 Market Type Rules

If `market_types.allowed` exists, the proposed market type must appear in that list.

Violation:

```text
block
```

Example:

```text
Allowed: spot
Requested: futures
Result: block
```

### 8.5 Order Notional Rules

If:

```text
requestedNotionalUsdt > max_order_notional_usdt
```

Result:

```text
block
```

If:

```text
requestedNotionalUsdt > approval.required_above_notional_usdt
```

Result:

```text
require_approval
```

Example:

```text
max_order_notional_usdt = 1000
approval.required_above_notional_usdt = 500
requestedNotionalUsdt = 700
Result: require_approval
```

Example:

```text
max_order_notional_usdt = 1000
requestedNotionalUsdt = 2500
Result: block
```

### 8.6 Leverage Rules

If:

```text
requestedLeverage > max_leverage
```

Result:

```text
block
```

If:

```text
requestedLeverage > approval.required_above_leverage
```

Result:

```text
require_approval
```

Example:

```text
max_leverage = 3
requestedLeverage = 8
Result: block
```

### 8.7 Manifest Rules

If the tool manifest is not approved:

```text
block
```

Changed tools must be frozen before the model sees them as available tools.

This protects against:

```text
tool poisoning
tool rug pull
schema drift
tool shadowing
```

### 8.8 Market Snapshot Freshness

Snapshot freshness is checked once, at decision and policy-evaluation time. If a trade-like action depends on market data, and the latest snapshot is older than the configured threshold at that moment:

```text
block
```

Example:

```text
max_market_snapshot_age_seconds = 15
market snapshot age = 42 seconds
Result: block
```

After a human approves a `require_approval` outcome, the action is governed by the approval and authorization expiry, not by the snapshot-age window. A pending approval is not re-blocked simply because the original snapshot has since aged past `max_market_snapshot_age_seconds`; the freshness gate already ran at decision time, and the approval expiry bounds how long the authorization stays valid.

### 8.9 Provider Capability Rules

If a provider capability is required but not detected:

```text
block
```

Examples:

```text
live order placement not detected
receipt lookup unavailable for live execution
account-read tool unavailable
tool manifest cannot be fingerprinted
```

### 8.10 Execution Adapter Rules

If:

```text
execution.live_execution_enabled = false
```

Live adapters cannot execute.

If:

```text
execution.simulator_enabled = true
```

Simulator can be used for safe demo and replay workflows.

------

## 9. Action Digest

An approval is valid only for one exact action. TraceGuard uses an Action Digest to bind the approval.

### 9.1 Digest Input

```ts
interface ActionDigestInput {
  workspaceId: string;
  runId: string;
  decisionId: string;

  providerConnectionId: string;
  toolName: string;
  toolManifestHash: string;

  policyVersionId: string;
  workspaceMode: string;

  instrument: string;
  marketType: string;
  action: string;

  requestedNotionalUsdt?: string;
  requestedQuantity?: string;
  requestedLeverage?: string;

  orderType?: string;
  limitPrice?: string;
  stopLoss?: string;
  takeProfit?: string;

  marketSnapshotRef?: string;

  executionAdapter:
    | "simulator"
    | "bitget_live"
    | "replay";
}
```

### 9.2 Digest Formula

```text
actionDigest = sha256(canonical_json(ActionDigestInput))
```

### 9.3 Digest Rules

If any material field changes after approval, the digest changes and the previous approval becomes invalid.

Examples that require a new approval:

```text
BTCUSDT changed to ETHUSDT
300 USDT changed to 301 USDT
2× leverage changed to 3×
simulator changed to live adapter
policy version changed
tool manifest hash changed
stop-loss removed
provider connection changed
market snapshot changed
```

------

## 10. Approval Semantics

### 10.1 Approval is not execution

Approval produces an authorization artifact. It does not execute by itself.

```text
ApprovalApproved
→ AuthorizationIssued
→ ExecutionRequested
→ AuthorizationConsumed
→ ExecutionCompleted
```

### 10.2 Single-use authorization

An authorization can be consumed once.

If reused:

```text
block
create incident
```

### 10.3 Expiry

Approval and authorization must expire.

Recommended defaults:

| Action type           | Approval expiry        |
| --------------------- | ---------------------- |
| Simulated action      | 5 minutes              |
| Low-risk live action  | 120 seconds            |
| High-risk live action | Web step-up required   |
| Asset movement        | Not approvable in v0.1 |

Approval expiry must exceed the MCP gateway poll window. Otherwise an approval can expire before the waiting gateway poll observes it and consumes the authorization. The 120-second low-risk live default assumes a gateway poll window well under that; if the poll window is widened, raise this expiry to stay above it.

### 10.4 Telegram vs Web

Telegram may approve:

```text
simulated trade-like actions
low-risk bounded actions in approval mode
blocked-action acknowledgment
replay notification acknowledgment
```

Telegram must not approve:

```text
withdrawals
internal transfers
API key creation
broker administrative operations
first live-execution enablement
policy publication
workspace owner changes
critical incident resolution
```

Web step-up is required for:

```text
enabling live execution
publishing relaxed policies
increasing maximum leverage
enabling guarded autopilot
approving sensitive live actions
```

------

## 11. Natural Language Policy Drafting

Natural language policy drafting is allowed only as a drafting convenience.

Flow:

```text
User natural language
→ Policy draft
→ Schema validation
→ Deterministic tests
→ Impact preview
→ Human publish
```

The model may propose a policy draft. It may not publish the draft.

Example input:

```text
Only allow BTC and ETH.
Keep single orders below 500 USDT.
Ask me before leverage above 2×.
Never allow withdrawals.
```

Draft output:

```yaml
instruments:
  allowed:
    - BTCUSDT
    - ETHUSDT

orders:
  max_order_notional_usdt: "500"

approval:
  required_above_leverage: "2"

blocked_operations:
  - withdraw
```

Publish requires human confirmation.

------

## 12. Policy Evaluation Output

```ts
interface PolicyEvaluationResult {
  evaluationId: string;
  policyVersionId: string;
  evaluatorVersion: string;

  outcome:
    | "allow"
    | "require_approval"
    | "block";

  matchedRules: Array<{
    ruleId: string;
    outcome:
      | "allow"
      | "require_approval"
      | "block";
    explanation: string;
    expected?: unknown;
    actual?: unknown;
  }>;

  evaluationInputHash: string;
  evaluationOutputHash: string;
}
```

Every block or approval result must answer:

```text
What was requested?
Which rule matched?
What was allowed?
What was requested?
Was anything sent upstream?
What can the user do next?
```

------

## 13. Policy Impact Preview

Before publishing a policy, TraceGuard should show historical impact.

Example:

```text
Under policy-v3:
- 12 historical runs would still be allowed.
- 3 historical runs would now require approval.
- 2 historical runs would now be blocked.
```

This helps users understand whether a policy change is a tightening or relaxation.

### 13.1 Relaxation Warnings

Policy relaxation should be highlighted.

Examples:

```text
increasing leverage limit
increasing order size
enabling live execution
removing asset restrictions
lowering approval requirements
unblocking asset movement
```

High-risk relaxations require web step-up.

------

## 14. Evaluation Examples

### 14.1 Public Market Data Query

Input:

```text
tool risk class = public_read
```

Outcome:

```text
allow
```

Reason:

```text
Public market-data queries are allowed and traced.
```

### 14.2 Account Balance Query

Input:

```text
tool risk class = account_read
workspace mode = approval_mode
```

Outcome:

```text
allow
```

Reason:

```text
Account-read tools are allowed with audit logging.
```

### 14.3 Safe Simulated Order

Input:

```text
instrument = BTCUSDT
notional = 300
leverage = 2
adapter = simulator
max_order_notional = 1000
max_leverage = 3
approval_above_notional = 500
```

Outcome:

```text
allow
```

### 14.4 Medium-risk Simulated Order

Input:

```text
instrument = BTCUSDT
notional = 700
leverage = 2
adapter = simulator
approval_above_notional = 500
```

Outcome:

```text
require_approval
```

### 14.5 Dangerous Leveraged Order

Input:

```text
instrument = BTCUSDT
notional = 2500
leverage = 8
max_order_notional = 1000
max_leverage = 3
```

Outcome:

```text
block
```

### 14.6 Withdraw Tool

Input:

```text
tool risk class = asset_movement
operation = withdraw
```

Outcome:

```text
block
```

### 14.7 Manifest Changed

Input:

```text
tool risk class = trade_like
manifest review status = needs_review
```

Outcome:

```text
block
```

Reason:

```text
The tool definition changed and has not been reviewed.
```

------

## 15. Failure Semantics

| Failure                               | Outcome |
| ------------------------------------- | ------- |
| Policy version missing                | block   |
| Evaluator unavailable                 | block   |
| Decision envelope invalid             | block   |
| Tool manifest unapproved              | block   |
| Market snapshot stale                 | block   |
| Provider capability unknown           | block   |
| Approval expired                      | block   |
| Authorization reused                  | block   |
| Workspace locked                      | block   |
| Live execution not explicitly enabled | block   |

TraceGuard must fail closed.

------

## 16. Tests

### 16.1 Unit Tests

```text
block overrides require_approval
require_approval overrides allow
missing decision envelope blocks trade-like actions
stale market snapshot blocks execution
unapproved manifest blocks trade-like calls
asset movement blocks by default
policy relaxation is detected
decimal string comparison is correct
```

### 16.2 Replay Tests

```text
same input and same policy produce same result
stricter policy changes approval to block
relaxed policy changes block to approval or allow and produces warning
unsupported policy version returns replay unsupported
```

### 16.3 Security Tests

```text
approval digest mismatch blocks execution
reused authorization blocks execution
Telegram cannot approve withdrawal
natural-language policy draft cannot publish itself
live execution cannot be enabled in safe demo
```

------

## 17. Product Implications

Policy semantics are not only backend logic. They shape the product.

Web UI should show:

```text
Requested action
Policy result
Matched rule
What was allowed
What was requested
Whether anything was sent upstream
Next safe action
```

Telegram should show only the minimal approval summary.

Replay should show policy-version diffs.

Evidence export should include:

```text
policy source
compiled policy hash
evaluator version
matched rules
action digest
```

------

## 18. First Vertical Slice Requirements

The first implementation must support:

```text
Safe Demo mode
Bitget public market-data reads
Decision Envelope validation
Policy DSL with instrument, notional, leverage, manifest, and snapshot rules
allow / require_approval / block
Action Digest
Telegram approval for simulated bounded action
Blocked dangerous leveraged action
Event recording for policy evaluation
Policy replay against a historical run
```

------

## 19. Final Statement

TraceGuard does not make trading agents safer by trusting them more.

It makes them safer by placing a deterministic, replayable, and auditable policy boundary between model-generated proposals and execution systems.