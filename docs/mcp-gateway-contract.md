# TraceGuard MCP Gateway Contract

**Document status:** Draft v0.2
**Product:** TraceGuard
**Category:** Trading Agent Safety Runtime
**Primary purpose:** Define how AI clients connect to TraceGuard, and how TraceGuard governs MCP tool discovery, invocation, policy enforcement, approval, replay, and evidence capture.

------

## 0. Executive Summary

The MCP Gateway is TraceGuard's most important runtime boundary.

It sits between an AI client and upstream trading tools:

```text
AI Client
→ TraceGuard MCP Gateway
→ Provider Adapter
→ Bitget Agent Hub MCP Server
→ Bitget APIs
```

The Gateway is not a passive proxy. It is a governed execution boundary.

It must:

```text
intercept tool discovery
normalize and fingerprint tool manifests
classify tool risk
hide or freeze unsafe tools
validate tool-call arguments
attach run context
record trace events
evaluate policy
request approval when required
issue or verify authorization
route allowed calls upstream
sanitize responses
emit replayable evidence
```

The Gateway exists because direct tool exposure is not enough for operating trading agents safely. A trading agent should not be able to discover a powerful tool, call it, and implicitly authorize asset-impacting behavior merely because a model decided to use that tool.

The contract of the Gateway is:

```text
The agent may request.
The Gateway verifies.
Policy decides.
Approval authorizes.
Adapters execute.
The ledger records.
```

------

## 1. Design Goals

### 1.1 Preserve Existing Agent Workflow

TraceGuard should not require users to rewrite their agent inside a proprietary framework.

A developer should be able to replace:

```text
AI Client
→ Bitget MCP Server
```

with:

```text
AI Client
→ TraceGuard MCP Gateway
→ Bitget MCP Server
```

This is the main adoption advantage.

------

### 1.2 Make Tool Access Governable

The Gateway must turn raw tool exposure into governed tool access.

For each tool, TraceGuard must know:

```text
Which provider exposed it?
What is its schema?
What risk class does it belong to?
Was this exact definition reviewed?
Has it changed?
Is it visible to the model?
What policy applies before invocation?
```

------

### 1.3 Prevent Silent Capability Drift

Upstream tools can change. A harmless-looking market tool may gain new parameters. A trade-like tool may change schema. A description may be poisoned.

The Gateway must detect and respond to:

```text
new tools
removed tools
schema changes
description changes
risk-class changes
manifest hash drift
```

Changed sensitive tools should be frozen until reviewed.

------

### 1.4 Support Read-Only Work Without Friction

The Gateway should not make every action annoying.

Public market-data queries should usually be:

```text
allowed
traced
sanitized
returned quickly
```

The safety friction should appear when risk appears.

------

### 1.5 Support Replay and Evidence

Every meaningful Gateway action must be reconstructable.

A future investigator should be able to answer:

```text
Which tool did the agent request?
Which schema was active?
Which manifest hash was approved?
What arguments were sent?
What response came back?
Which policy version evaluated the action?
Was approval required?
Was anything sent upstream?
```

------

## 2. Non-Goals

The MCP Gateway should not:

```text
generate trading strategies
predict prices
replace Bitget Agent Hub
replace exchange-side permissions
store raw API secrets in traces
execute sensitive calls without policy
trust tool descriptions as safe instructions
use an LLM to make final authorization decisions
retry ambiguous execution blindly
become a generic logging proxy with no policy semantics
```

The Gateway is not a bot. It is the controlled boundary around bots.

------

## 3. Deployment Modes

TraceGuard should support two Gateway modes.

------

## 3.1 Local stdio Gateway

Primary first implementation.

```text
Claude Code / Cursor / Local Agent
→ traceguard-gateway-local over stdio
→ upstream bitget-mcp-server over stdio
```

### Why local stdio first?

Because the first user is likely a developer using an existing local AI client.

Advantages:

```text
lowest adoption friction
compatible with current MCP clients
secrets can remain local
easy to demo
easier to inspect logs
does not require hosted tenant infrastructure
```

Constraints:

```text
long-running approvals are awkward
stdio cannot be polluted by logs
upstream subprocess supervision is required
client timeout behavior may vary
```

------

## 3.2 Hosted Streamable HTTP Gateway

Future production mode.

```text
AI Client
→ HTTPS TraceGuard Gateway
→ Provider Adapter
→ Upstream MCP Provider
```

Advantages:

```text
multi-user workspaces
centralized policy control
hosted tool inventory
central approval workflow
better long-running sessions
easier team operations
```

Additional requirements:

```text
authentication
workspace isolation
origin validation
rate limiting
session lifecycle management
hosted secret management
tenant-aware telemetry
```

------

## 3.3 Architecture Decision

Implement local stdio first, but design the Gateway runtime so the same core pipeline can be reused by hosted HTTP.

Recommended package split:

```text
packages/mcp-core
packages/mcp-gateway-runtime
apps/gateway-local
apps/gateway-http
```

`mcp-gateway-runtime` should contain the pipeline. `gateway-local` and `gateway-http` should only adapt transport concerns.

------

## 4. Gateway Responsibilities

The Gateway must perform the following functions.

```text
MCP initialization
tools/list interception
tools/call interception
tool manifest normalization
manifest fingerprinting
tool risk classification
tool visibility filtering
argument validation
run context creation
trace event emission
policy evaluation
approval orchestration
execution authorization verification
safe upstream routing
response redaction
structured error mapping
OpenTelemetry span emission
```

The Gateway is the runtime place where model-controlled tool invocation becomes governed infrastructure.

------

## 5. Gateway Must Not Do

The Gateway must not:

```text
treat a tool name as sufficient proof of safety
trust a tool description as safe instruction
allow unknown tools by default
continue using changed sensitive tools without review
execute trade-like calls without a Decision Envelope
turn approval into broad reusable permission
store raw secrets
return unredacted private account data to Telegram
blindly retry ambiguous execution
hide blocked actions from the ledger
```

------

## 6. MCP Initialization

### 6.1 Client-Facing Initialize

The Gateway identifies itself as TraceGuard.

Example server info:

```json
{
  "serverInfo": {
    "name": "traceguard-gateway",
    "version": "0.2.0"
  },
  "capabilities": {
    "tools": {}
  }
}
```

The Gateway should not expose upstream capabilities directly until it has completed provider initialization and manifest review.

------

### 6.2 Upstream Initialization

Startup flow:

```text
load workspace config
resolve provider connection
start or connect upstream MCP server
send initialize
detect capabilities
request tools/list
normalize tool definitions
compute manifest hash
compare with approved manifest
update Tool Inventory
```

Failure behavior:

| Failure                         | Behavior                               |
| ------------------------------- | -------------------------------------- |
| Upstream process not found      | Provider degraded; offer manual setup  |
| Upstream initialize fails       | Provider degraded; no trade-like calls |
| tools/list fails                | Provider degraded; no tool exposure    |
| manifest changed                | Freeze changed sensitive tools         |
| capability detection incomplete | Unknown capabilities default to false  |

------

## 7. Tool Discovery Contract

### 7.1 `tools/list` Pipeline

When a client requests `tools/list`, TraceGuard must not simply forward the upstream list.

Pipeline:

```text
Client requests tools/list
→ Gateway requests upstream tools/list
→ Normalize tool definitions
→ Compute tool schema hashes
→ Compute manifest hash
→ Compare with approved manifest
→ Detect added/removed/changed tools
→ Classify tool risk
→ Freeze changed sensitive tools
→ Hide blocked/frozen tools
→ Return allowed tool view
→ Record manifest events
```

> **TraceGuard local stdio gateway (3C):** In the local stdio gateway this pipeline runs **once at startup** (`bootGateway`). `tools/list` is then answered from the governed in-memory cache — the persisted manifest projection joined with that boot's normalized tool definitions — not a fresh per-request upstream fetch. The long-lived upstream connection is reused by the call-routing milestone (3D).
>
> As of 3D, governed `tools/call` requests are forwarded over this same long-lived connection — the gateway never reconnects per call.

------

### 7.2 Normalized Tool Definition

```ts
interface NormalizedToolDefinition {
  providerConnectionId: string;
  providerType:
    | "bitget_agent_hub"
    | "custom_mcp"
    | "generic_rest";

  name: string;
  title?: string;
  description?: string;

  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: unknown;

  normalizedJson: string;
  schemaHash: string;

  riskClass:
    | "public_read"
    | "account_read"
    | "trade_like"
    | "asset_movement"
    | "administrative"
    | "unknown";
}
```

Normalization rules:

```text
sort object keys
preserve array order
remove insignificant whitespace
preserve tool names exactly
preserve descriptions exactly
canonicalize JSON schema
include provider identity
```

------

### 7.3 Manifest Hash

```text
manifestHash = sha256hex(canonicalJson({
  normalizationVersion,
  tools: sortByName([{ name, riskClass, schemaHash }])
}))
```

Properties:

```text
order-independent over the tool list
changes iff any tool's (name, riskClass, schemaHash) changes,
a tool is added or removed,
or normalizationVersion bumps
```

The per-tool `schemaHash` is itself a sha256 of the canonicalized normalized tool definition (provider type, provider connection ID, tool name, title, description, input schema, output schema, annotations), so any schema or description change propagates into the manifest hash through that tool's `schemaHash`.

The risk class is included intentionally. If a tool is reclassified from `public_read` to `trade_like`, this creates manifest drift.

------

### 7.4 Tool Visibility

The projection re-derives a tool's `status` from its `riskClass` (see §8.3 of `event-model.md`) and `visible` follows from `status`:

```text
visible  = status active   (public_read | account_read | trade_like defaults)
blocked  = asset_movement | administrative defaults, or operator blocklist
frozen   = unknown risk, or a pending sensitive-change review
```

| Tool status            | Visible to model? | Notes                    |
| ---------------------- | ----------------- | ------------------------ |
| Approved public read   | Yes               | Allowed and traced       |
| Approved account read  | Yes               | Audited and redacted     |
| Approved trade-like    | Yes               | Requires policy path     |
| Frozen                 | No                | Not visible until review |
| Blocked                | No                | Not visible              |
| Unknown                | No by default     | Frozen until classified  |
| Changed sensitive tool | No                | Frozen until review      |

The model should not plan around tools that TraceGuard will never allow.

------

## 8. Tool Risk Classification

TraceGuard maps provider-specific tools into normalized risk classes.

| Risk class       | Meaning                                                      | Default behavior |
| ---------------- | ------------------------------------------------------------ | ---------------- |
| `public_read`    | Public market data or metadata                               | Allow and trace  |
| `account_read`   | Balances, positions, account state                           | Allow with audit |
| `trade_like`     | Order placement, cancellation, leverage, margin, position changes | Policy-gated     |
| `asset_movement` | Withdrawals, transfers, deposits with sensitive implications | Block by default |
| `administrative` | API key, broker, account management                          | Block by default |
| `unknown`        | Not classified                                               | Freeze or block  |

The classifier uses **Approach B**: two orthogonal axes — **recognition** (is this tool known?) and **severity** (how dangerous is it?). The two never mix.

------

### 8.1 Recognition: Base-Table Lookup

The classifier first looks the tool up in a per-provider base table keyed by `(providerType, name)`:

```text
hit  -> base riskClass is the table entry
miss -> riskClass = unknown -> freeze; raise rules are short-circuited
```

A miss never falls through to severity raises. Unknown tools must be reviewed before they can be classified.

------

### 8.2 Severity Lattice and Raise-Only Join

The risk classes form a totally ordered lattice from low to high severity:

```text
public_read < account_read < trade_like < asset_movement < administrative
```

The final classification is the lattice maximum (`joinRisk`) of the base class and every triggered raise rule.

```text
classification = joinRisk(baseClass, raise_1, raise_2, ..., raise_n)
```

This is **raise-only**: a rule can raise severity but never lower it. The raise-only property is guaranteed structurally by the join — no rule needs an explicit "do not lower" check.

Raise rules:

```text
sensitive schema field:
  address | withdrawAddress | chain                  -> asset_movement
  apiKeyPassphrase | apiKeyPermissions | apiKeyIp    -> administrative

write annotation:
  destructiveHint = true | readOnlyHint = false      -> trade_like

danger tag in title or description:
  [DANGER]                                           -> asset_movement
  [CAUTION]                                          -> trade_like
```

Descriptions are untrusted. They may raise risk but cannot lower it.

Example:

```text
A tool named `safe_get_status` with schema field `withdrawAddress` should not be public_read.
```

If uncertain, `unknown -> freeze`. Risk may be raised automatically. Risk may only be lowered through review (an operator-approved manifest change that re-runs the classifier with new inputs).

------

### 8.3 Bitget Base Table

The locked Bitget Agent Hub baseline lists 36 tools with the distribution:

```text
public_read     13
account_read    10
trade_like       9
asset_movement   3
administrative   1
total           36
```

At the locked baseline this resolves to **32 visible, 4 blocked, 0 frozen**.

------

## 9. Tool Call Contract

> **3D status:** Existence + risk-class routing, governed read-class forwarding over the reused upstream connection, and digest-only `ToolCall*` / `IncidentOpened` audit events are live. Argument JSON-Schema validation, Decision Envelope construction, policy evaluation, approval, execution, and result redaction remain deferred to 3E.

### 9.1 `tools/call` Pipeline

```text
Receive tools/call
→ Validate JSON-RPC shape
→ Resolve workspace/session/agent
→ Create or attach Run
→ Check tool exists in approved manifest
→ Validate arguments against approved schema
→ Classify risk
→ Record ToolCallRequested
→ Execute handling path
→ Record result or block
→ Return structured response
```

------

### 9.2 Handling Path: Public Read

For public market data:

```text
trace request
forward upstream
capture response
sanitize response
record ToolCallCompleted
return response
```

No approval required.

------

### 9.3 Handling Path: Account Read

For account reads:

```text
trace request
redact sensitive arguments
forward upstream
redact sensitive response fields
record ToolCallCompleted
return sanitized response
```

No approval by default, but full audit required.

Potentially sensitive fields:

```text
account IDs
subaccount IDs
balances
positions
private order IDs
credential references
```

------

### 9.4 Handling Path: Trade-like

> **3E-1 (landed):** The trade-like governance path is implemented behind the six internal `traceguard_*` tools (`start_run → record_decision → request_execution → [check_approval] → execute_authorized_action → finish_run`), not by intercepting the upstream `*_place_order` call — the raw upstream `trade_like` deny (`DECISION_ENVELOPE_REQUIRED`) is unchanged. Execution targets a **simulator** adapter. Argument JSON-Schema validation (§9.2) and result redaction (§9.3) on the forwarded path remain deferred to **3E-2**.
>
> **3E-2c (landed):** `request_execution` / `execute_authorized_action` now accept `executionAdapter: "bitget_live"` in addition to `"simulator"`. The `bitget_live` adapter recovers the order intent from the run's `DecisionProposed` ledger event (the digest-centric `ExecutionRequest` carries no order body), maps it to the upstream `spot_place_order` call, and settles `ExecutionCompleted` with `finalStatus: "submitted"` and `receiptRef: "receipt:bitget:<orderId>"`. Live execution is **spot-only**: a non-spot `bitget_live` attempt is rejected by the execution gate as `CAPABILITY_UNAVAILABLE` (an auditable `ExecutionRejected`, `executionSent:false`). Pre-submit failures (intent not found, unmappable action, missing size, upstream error result) fail closed to `EXECUTION_FAILED`; post-submit ambiguity (timeout, connection loss, unreadable receipt) settles `ExecutionUnknown` (`reconciliationRequired:true`, `retryBlocked:true`) and returns `EXECUTION_UNKNOWN` — never retried. Argument JSON-Schema validation (§9.2) and result redaction (§9.3) on the forwarded path remain deferred.

For trade-like tools:

```text
require Decision Envelope
validate decision
evaluate policy
if allow:
  execute through configured adapter
if require_approval:
  create approval request
if block:
  reject and record incident if high risk
```

Trade-like calls should not be directly forwarded simply because the model called an upstream order tool.

------

### 9.5 Handling Path: Asset Movement

For asset movement:

```text
block by default
record ToolCallBlocked
create Incident if attempted
return structured block response
```

Examples:

```text
withdraw
internal transfer
subaccount transfer
```

------

### 9.6 Handling Path: Administrative

For administrative tools:

```text
block by default
record ToolCallBlocked
create Incident if attempted
```

Examples:

```text
API key creation
broker account operation
credential management
```

------

### 9.7 Handling Path: Unknown

Unknown tools are blocked.

```text
unknown tool → block
```

Do not ask an LLM whether the unknown tool is safe.

------

## 10. Run Context

Every tool call should belong to a Run.

```ts
interface TraceGuardRunContext {
  workspaceId: string;
  runId: string;
  agentId: string;
  providerConnectionId: string;
  policyVersionId: string;
  toolManifestVersionId: string;
  toolManifestHash: string;
  traceId: string;
  spanId: string;
  mode:
    | "safe_demo"
    | "approval_mode"
    | "guarded_autopilot"
    | "locked_investigation";
}
```

### 10.1 Run Creation

A Run may be created explicitly:

```text
traceguard_start_run
```

or implicitly when the first tool call arrives without an active run.

Recommendation for v0.1:

```text
Use explicit traceguard_start_run for clarity.
```

------

## 11. Decision Envelope Submission

There are two valid implementation patterns.

------

### 11.1 Explicit TraceGuard Tools

TraceGuard exposes internal tools:

```text
traceguard_start_run
traceguard_record_decision
traceguard_request_execution
traceguard_check_approval
traceguard_execute_authorized_action
traceguard_finish_run
traceguard_replay_run
```

This is easiest for v0.1.

Advantages:

```text
clear agent workflow
simple demo
explicit event model
less inference from arbitrary tool calls
easier replay
```

------

### 11.2 Gateway-Inferred Proposal

The Gateway detects a trade-like upstream call and requires a structured proposal.

If the model tries to call a trade-like upstream tool directly, the Gateway returns:

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "This action requires a TraceGuard Decision Envelope before execution."
    }
  ],
  "traceguard": {
    "errorCode": "DECISION_ENVELOPE_REQUIRED",
    "requiredTool": "traceguard_record_decision"
  }
}
```

This is more transparent but harder to make reliable across arbitrary agents.

Recommendation:

```text
v0.1 implements explicit tools first.
Future versions add inferred proposal handling.
```

------

## 12. TraceGuard Internal Tools

### 12.1 `traceguard_start_run`

Purpose:

```text
Create a new run and attach subsequent calls.
```

Input:

```json
{
  "agentName": "BTC Momentum Agent",
  "intent": "Analyze BTC and propose a risk-bounded action",
  "mode": "safe_demo"
}
```

Output:

```json
{
  "runId": "run_123",
  "policyVersionId": "polv_123",
  "toolManifestHash": "sha256_abc"
}
```

Events:

```text
RunCreated
RunStarted
```

------

### 12.2 `traceguard_record_decision`

Purpose:

```text
Record a structured agent proposal.
```

Input:

```json
{
  "runId": "run_123",
  "instrument": "BTCUSDT",
  "marketType": "futures",
  "action": "open_long",
  "thesis": "Momentum remains positive while funding is moderate.",
  "confidence": 0.72,
  "evidenceRefs": ["snapshot_btc_001"],
  "requestedNotionalUsdt": "300",
  "requestedLeverage": "2"
}
```

Output:

```json
{
  "decisionId": "dec_123",
  "status": "validated",
  "decisionHash": "sha256_decision"
}
```

Events:

```text
DecisionProposed
DecisionValidated
```

If invalid:

```text
DecisionRejected
```

------

### 12.3 `traceguard_request_execution`

> **3E-1 (landed):** The policy outcome is computed at `record_decision` (inside `proposeDecision`) and **cached**; `request_execution` acts on the cached outcome — allow ⇒ issue authorization + burn + simulate execution inline; require_approval ⇒ emit `ApprovalRequested` and return non-blocking `APPROVAL_REQUIRED`; block ⇒ `POLICY_BLOCKED` (`isError:true`, `matchedRules`, `executionSent:false`). `finish_run` is idempotent against an allow path that already settled the run.
>
> **3E-2c (landed):** On an `allow` outcome with `executionAdapter: "bitget_live"` and a **spot** decision, `request_execution` issues + burns the authorization and submits the order live, returning `ALLOWED` with `receipt.finalStatus: "submitted"` and `receipt.receiptRef: "receipt:bitget:<orderId>"`. A post-submit ambiguity returns `isError:true` with `errorCode: "EXECUTION_UNKNOWN"` (the run is left for reconciliation, not retried). A non-spot `bitget_live` decision returns `CAPABILITY_UNAVAILABLE`. The `simulator` adapter behavior is unchanged.

Purpose:

```text
Ask TraceGuard to evaluate and execute or escalate a decision.
```

Input:

```json
{
  "runId": "run_123",
  "decisionId": "dec_123",
  "executionAdapter": "simulator"
}
```

Output case: allowed.

```json
{
  "status": "ALLOWED",
  "executionId": "exec_123",
  "receipt": {
    "status": "simulated"
  }
}
```

Output case: approval required.

```json
{
  "status": "APPROVAL_REQUIRED",
  "approvalId": "appr_123",
  "expiresAt": "2026-06-08T15:00:00Z"
}
```

Output case: blocked.

```json
{
  "status": "BLOCKED",
  "matchedRules": [
    {
      "ruleId": "orders.max_leverage",
      "explanation": "Requested leverage is 8×, but policy maximum is 3×."
    }
  ],
  "executionSent": false
}
```

Events:

```text
PolicyEvaluationStarted
PolicyEvaluated
ApprovalRequested
AuthorizationIssued
ExecutionRequested
AuthorizationConsumed
ExecutionCompleted
ExecutionRejected
```

depending on result.

On an `allow` outcome, `traceguard_request_execution` auto-issues and consumes the single-use authorization inline (`AuthorizationIssued` then `AuthorizationConsumed`). On a `require_approval` outcome it stops at `ApprovalRequested`; the authorization is issued after approval and consumed later by `traceguard_execute_authorized_action`.

------

### 12.4 `traceguard_check_approval`

Purpose:

```text
Check whether a previously requested approval has been granted.
```

Input:

```json
{
  "approvalId": "appr_123"
}
```

Output:

```json
{
  "status": "approved",
  "authorizationId": "authz_123"
}
```

or:

```json
{
  "status": "pending"
}
```

or:

```json
{
  "status": "expired"
}
```

------

### 12.5 `traceguard_execute_authorized_action`

Purpose:

```text
Execute an action after approval.
```

Input:

```json
{
  "runId": "run_123",
  "decisionId": "dec_123",
  "authorizationId": "authz_123",
  "executionAdapter": "simulator"
}
```

Output:

```json
{
  "executionId": "exec_123",
  "status": "simulated",
  "receiptHash": "sha256_receipt"
}
```

Checks:

```text
authorization exists
authorization not expired
authorization not consumed
action digest matches
policy version matches
manifest hash matches
workspace mode still permits execution
```

Events:

```text
ExecutionRequested
AuthorizationConsumed
ExecutionCompleted
ExecutionRejected
ExecutionUnknown
```

depending on result.

------

### 12.6 `traceguard_replay_run`

Purpose:

```text
Create a replay job for a historical run.
```

Input:

```json
{
  "runId": "run_123",
  "replayType": "policy",
  "policyVersionId": "polv_456"
}
```

Output:

```json
{
  "replayId": "rpl_123",
  "result": "expected_difference",
  "diffUrl": "https://traceguard.local/replays/rpl_123"
}
```

------

### 12.7 `traceguard_finish_run`

Purpose:

```text
Close a run once analysis, execution, or escalation is complete.
```

Input:

```json
{
  "runId": "run_123",
  "outcome": "completed"
}
```

Output:

```json
{
  "runId": "run_123",
  "status": "completed"
}
```

Events:

```text
RunCompleted
RunFailed
```

`RunFailed` is emitted when the run ends in an error state; otherwise `RunCompleted` is emitted.

------

## 13. Approval Pending Semantics

> **3E-1 (landed):** Human approval is **out-of-band** via the `handle.approve` / `handle.reject` operator seam on the `GatewayHandle` (a human is not the agent), deliberately **not** an MCP tool. `request_execution` never blocks; the agent resumes via `check_approval` → `execute_authorized_action` once the approval flips to `APPROVED`. The seam is an in-process function in this slice; a persistent web/telegram approval channel is later-phase.

MCP clients may not support long-running approval waits uniformly. TraceGuard should support a check-and-continue model first.

------

### 13.1 Immediate Approval Required Response

When policy returns `require_approval`, return immediately:

```json
{
  "isError": false,
  "content": [
    {
      "type": "text",
      "text": "Approval is required. The request has been sent to TraceGuard."
    }
  ],
  "traceguard": {
    "status": "APPROVAL_REQUIRED",
    "approvalId": "appr_123",
    "runId": "run_123",
    "expiresAt": "2026-06-08T15:00:00Z"
  }
}
```

The agent may then poll or wait for user action.

------

### 13.2 Why Not Block the Tool Call Until Approval?

Blocking the MCP call until human approval creates problems:

```text
client timeouts
unclear cancellation behavior
poor local stdio UX
harder recovery if the client disconnects
```

So v0.1 should prefer:

```text
return approval required
→ user approves externally
→ agent or user continues with authorization
```

------

### 13.3 Future Task-like Continuation

Future MCP App or task-capable clients may support richer `input_required` continuation.

Do not depend on this for v0.1.

------

## 14. Structured Error Codes

> **3E-1 internal-tool codes:** `DECISION_INVALID`, `POLICY_BLOCKED`, `APPROVAL_REQUIRED` (a non-error `status`, `isError:false`), `APPROVAL_EXPIRED`, `AUTHORIZATION_MISSING`, `AUTHORIZATION_CONSUMED`, `ACTION_DIGEST_MISMATCH`, `EXECUTION_UNKNOWN`, `EXECUTION_FAILED`, `CAPABILITY_UNAVAILABLE`, `WORKSPACE_MODE_INVALID`, `RUN_NOT_FOUND`. Reserved-but-unreachable in the simulator slice (all gates `false`): `SNAPSHOT_STALE`, `PROVIDER_DEGRADED`, `WORKSPACE_LOCKED`, `MANIFEST_UNAPPROVED`.

| Code                         | Meaning                                           |
| ---------------------------- | ------------------------------------------------- |
| `TOOL_NOT_APPROVED`          | Tool is not in approved manifest                  |
| `TOOL_FROZEN`                | Tool changed and awaits review                    |
| `TOOL_BLOCKED`               | Tool is explicitly blocked                        |
| `TOOL_CALL_NOT_AVAILABLE`    | The gateway booted degraded (no governed call context / no active run); every `tools/call` is denied fail-closed. |
| `UPSTREAM_CALL_FAILED`       | Upstream `tools/call` threw after a governed forward; fail-closed, the long-lived connection is retained. |
| `UNKNOWN_TOOL`               | Tool is not recognized                            |
| `DECISION_ENVELOPE_REQUIRED` | Sensitive action lacks Decision Envelope          |
| `DECISION_INVALID`           | Decision Envelope failed schema validation        |
| `POLICY_BLOCKED`             | Policy produced block                             |
| `APPROVAL_REQUIRED`          | Human approval is required                        |
| `APPROVAL_EXPIRED`           | Approval expired                                  |
| `AUTHORIZATION_MISSING`      | No valid authorization                            |
| `AUTHORIZATION_CONSUMED`     | Authorization already used                        |
| `ACTION_DIGEST_MISMATCH`     | Approved action differs from attempted action     |
| `CAPABILITY_UNAVAILABLE`     | Provider does not support requested capability    |
| `SNAPSHOT_STALE`             | Market snapshot is too old                        |
| `MANIFEST_UNAPPROVED`        | Active tool manifest is not approved for execution |
| `WORKSPACE_LOCKED`           | Workspace is locked (e.g. investigation hold)     |
| `PROVIDER_DEGRADED`          | Upstream provider unavailable or degraded         |
| `EXECUTION_UNKNOWN`          | Provider state ambiguous; reconciliation required |
| `EXECUTION_FAILED`           | Execution failed for an unclassified reason       |
| `WORKSPACE_MODE_INVALID`     | `start_run` was given a mode outside the `WorkspaceMode` enum |
| `RUN_NOT_FOUND`              | The `runId` does not match the active governed run |

------

## 15. Error Response Format

```ts
interface TraceGuardMcpError {
  isError: true;
  content: Array<{
    type: "text";
    text: string;
  }>;
  traceguard: {
    errorCode: string;
    runId?: string;
    approvalId?: string;
    incidentId?: string;
    matchedRules?: Array<{
      ruleId: string;
      explanation: string;
    }>;
    executionSent?: boolean;
  };
}
```

User-facing text should be human-readable.

Machine-readable fields should support UI and replay.

------

## 16. Event Emission

> **3E-1 (landed):** The ledger is the source of truth for events; 3E-1 adds an in-memory `Map<decisionId, CachedDecision>` derived index that carries the `ActionDigestInput` base (so the action digest reproduces byte-for-byte at issue / approve / execute time) and the `policyEvaluationId`. It is rebuildable from a projection — that rebuild, plus per-approval event isolation beyond the one-decision-per-run `eventsForApproval` demo scope, is deferred to **3E-2+**.

Gateway must emit events for every meaningful transition.

### 16.1 Tool Discovery Events

```text
ToolManifestImported
ToolManifestChanged
ToolFrozen
ToolBlocked
ToolManifestApproved
```

### 16.2 Run Events

```text
RunCreated
RunStarted
RunCompleted
RunFailed
```

### 16.3 Tool Call Events

```text
ToolCallRequested
ToolCallCompleted
ToolCallFailed
ToolCallBlocked
```

### 16.4 Decision and Policy Events

```text
DecisionProposed
DecisionValidated
DecisionRejected
PolicyEvaluationStarted
PolicyEvaluated
```

### 16.5 Approval and Execution Events

```text
ApprovalRequested
ApprovalApproved
ApprovalRejected
ApprovalExpired
AuthorizationIssued
AuthorizationConsumed
ExecutionRequested
ExecutionCompleted
ExecutionRejected
ExecutionUnknown
```

------

## 17. Idempotency

Sensitive operations must be idempotent.

Recommended idempotency key:

```text
execution:{workspaceId}:{runId}:{decisionId}:{actionDigest}
```

Rules:

```text
Same idempotency key and completed execution → return existing receipt.
Same idempotency key and pending execution → return pending.
Same idempotency key and unknown execution → require reconciliation.
Never send duplicate live execution blindly.
```

------

## 18. Execution Unknown

If the Gateway sends an execution request and the provider times out after submission may have occurred:

```text
ExecutionUnknown
retryBlocked = true
reconciliationRequired = true
```

The Gateway must not retry automatically.

This prevents duplicate orders.

------

## 19. Security Rules

### 19.1 stdio Mode

```text
stdout is only for MCP JSON-RPC messages
logs go to stderr
malformed JSON-RPC is rejected
upstream subprocess args are not shell-interpolated
secrets are never logged
```

### 19.2 Streamable HTTP Mode

```text
validate Origin
require authentication
bind local servers to localhost
use session IDs
rate limit requests
enforce tenant isolation
```

### 19.3 Tool Manifest

```text
changed sensitive tools are frozen
unknown tools are blocked
tool identity is provider-scoped
risk class can be raised automatically
risk class can only be lowered by review
```

### 19.4 Approval and Execution

```text
approval creates authorization
authorization is single-use
action digest must match
no blind retry after ambiguous provider timeout
```

------

## 20. Response Redaction

Gateway must redact before storing or returning sensitive data to non-privileged surfaces.

Redact:

```text
API keys
secret keys
passphrases
authorization headers
private credential values
full account identifiers in public demo exports
raw private balances in public demo exports
```

Store references:

```text
credentialRef
requestRef
responseRef
receiptRef
```

------

## 21. OpenTelemetry

Each Run maps to one trace.

Recommended spans:

```text
traceguard.run
├─ mcp.tools.list
├─ mcp.tools.call
├─ traceguard.decision.validate
├─ traceguard.policy.evaluate
├─ traceguard.approval.wait
├─ traceguard.execution.simulate
└─ traceguard.replay
```

TraceGuard attributes:

```text
traceguard.workspace.id
traceguard.run.id
traceguard.agent.id
traceguard.provider.id
traceguard.policy.version
traceguard.policy.outcome
traceguard.tool.risk_class
traceguard.tool.manifest_hash
traceguard.execution.adapter
traceguard.execution.status
```

Never emit secrets as span attributes.

------

## 22. Product UX Consequences

The Gateway should not leak protocol complexity to users.

User-facing language:

```text
This action was blocked because it exceeds your leverage limit.
```

Not:

```text
POLICY_BLOCKED P-LEV-003.
```

Machine-readable error codes remain available for UI and tests.

------

## 23. First Vertical Slice

The v0.1 Gateway must support:

```text
local stdio mode
upstream Bitget Agent Hub MCP server
tools/list import
manifest hash
public Bitget market-data call passthrough
TraceGuard internal tools
Decision Envelope validation
policy evaluation
approval-required response
simulator execution
dangerous order block
run events
```

This is enough to demonstrate the product without depending on live funds.

------

## 24. Test Matrix

| Test                                     | Expected                 |
| ---------------------------------------- | ------------------------ |
| Upstream public market-data tool appears | Returned to client       |
| Upstream withdrawal tool appears         | Hidden or blocked        |
| Tool schema changes                      | Tool frozen              |
| Unknown tool call                        | Blocked                  |
| Trade-like call without decision         | Decision required        |
| Oversized leveraged proposal             | Blocked                  |
| Approval required action                 | Approval object returned |
| Approval callback consumed               | Execution allowed once   |
| Authorization reused                     | Blocked                  |
| Upstream timeout after submit            | ExecutionUnknown         |

------

## 25. Edge Cases

### 25.1 Agent Calls Upstream Order Tool Directly

Result:

```text
DECISION_ENVELOPE_REQUIRED
```

The Gateway should not forward it.

### 25.2 Tool Changed During Run

Result:

```text
Block sensitive execution.
Create incident.
Require manifest review.
```

### 25.3 Approval Arrives After Expiry

Result:

```text
ApprovalExpired
No authorization issued.
```

### 25.4 User Approves, Then Policy Changes

If the policy version is part of action digest, authorization becomes invalid.

Result:

```text
ACTION_DIGEST_MISMATCH or POLICY_CHANGED
```

### 25.5 Client Disconnects During Approval

Run remains pending until approval expires.

Gateway should allow later status retrieval.

------

## 26. Why This Is More Than a Proxy

A normal proxy forwards.

TraceGuard Gateway governs.

A normal proxy logs.

TraceGuard Gateway creates replayable evidence.

A normal proxy trusts tool availability.

TraceGuard Gateway reviews and fingerprints tool manifests.

A normal proxy treats confirmation as enough.

TraceGuard Gateway binds approval to exact action digest and consumes it once.

------

## 27. Final Statement

The MCP Gateway is where TraceGuard becomes real.

It is the place where model-controlled tool invocation becomes:

```text
visible
classified
policy-checked
approval-aware
idempotent
replayable
auditable
```

The Gateway is not a pass-through proxy. It is the runtime boundary that lets trading agents become operable infrastructure.