# TraceGuard Event Model

**Document status:** Draft v0.1
**Product:** TraceGuard
**Category:** Trading Agent Safety Runtime
**Related documents:** `product-spec.md`, `user-flows.md`, `architecture.md`, `threat-model.md`

------

## 0. Purpose

This document defines TraceGuard's event model.

The event model is the factual backbone of TraceGuard. It records what happened, in which order, under which policy, against which tool manifest, and with which approval or execution result.

TraceGuard's product promise depends on this event model:

```text
See what the agent did.
Control what the agent can do.
Approve sensitive actions.
Replay and compare historical runs.
Export auditable evidence.
```

The event ledger must support:

```text
append-only audit history
deterministic replay
incident investigation
evidence export
UI projections
policy impact analysis
security tests
telemetry correlation
future proof-trail extensions
```

------

## 1. Core Principles

### 1.1 Events are facts, not commands

A command expresses intent:

```text
Evaluate this policy.
Approve this action.
Execute this authorized action.
```

An event records something that already happened:

```text
PolicyEvaluated
ApprovalApproved
ExecutionCompleted
```

Events must use past-tense names.

Correct:

```text
DecisionProposed
PolicyEvaluated
ApprovalRequested
ApprovalApproved
AuthorizationIssued
ExecutionCompleted
```

Incorrect:

```text
ProposeDecision
EvaluatePolicy
ApproveAction
ExecuteOrder
```

------

### 1.2 Events are append-only

Events are never updated in place.

If something changes, emit a new event.

Example:

```text
ApprovalApproved
ApprovalRevoked
```

Do not mutate the original `ApprovalApproved` event.

Projection tables may be updated for UI performance, but projections must be rebuildable from the event ledger.

------

### 1.3 Events must be replayable

A run must be reconstructable from events and referenced artifacts.

A replay should be able to reconstruct:

```text
workspace mode
provider connection
tool manifest version
agent identity
market snapshots
tool calls
decision envelope
policy version
policy evaluation result
approval state
execution state
incident state
evidence bundle
```

------

### 1.4 Events must be tamper-evident

Every event should include:

```text
payloadHash
previousEventHash
eventHash
```

Hash chaining should be per aggregate stream, not global across the entire system.

Recommended stream identity:

```text
workspaceId + aggregateType + aggregateId
```

------

### 1.5 Events must be workspace-scoped

Every product event must include `workspaceId`.

TraceGuard must never look up a run, approval, replay, or evidence export by ID alone without checking workspace membership.

------

## 2. Event Envelope

All events share the same envelope.

```ts
interface LedgerEvent<TPayload = unknown> {
  id: string;

  workspaceId: string;

  aggregateType:
    | "workspace"
    | "provider_connection"
    | "tool_manifest"
    | "tool_definition"
    | "agent"
    | "run"
    | "decision"
    | "policy"
    | "approval"
    | "authorization"
    | "execution"
    | "replay"
    | "incident"
    | "evidence_export"
    | "telegram_binding";

  aggregateId: string;

  eventType: string;
  eventVersion: number;
  schemaVersion: number;

  occurredAt: string;
  recordedAt: string;

  actorType: "user" | "agent" | "system" | "provider" | "worker";
  actorId?: string;

  runId?: string;
  agentId?: string;
  providerConnectionId?: string;
  policyVersionId?: string;
  toolManifestVersionId?: string;

  traceId?: string;
  spanId?: string;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;

  payload: TPayload;

  payloadHash: string;
  previousEventHash?: string;
  eventHash: string;

  redactionProfile?: "internal_full" | "developer_debug" | "public_demo";
}
```

------

## 3. ID Conventions

Use prefixed IDs so logs, exports, and debugging remain readable.

| Object                | Prefix   | Example         |
| --------------------- | -------- | --------------- |
| Workspace             | `ws_`    | `ws_01jx...`    |
| Provider connection   | `pc_`    | `pc_01jx...`    |
| Tool manifest version | `tmv_`   | `tmv_01jx...`   |
| Tool definition       | `tool_`  | `tool_01jx...`  |
| Agent                 | `agt_`   | `agt_01jx...`   |
| Run                   | `run_`   | `run_01jx...`   |
| Decision              | `dec_`   | `dec_01jx...`   |
| Policy                | `pol_`   | `pol_01jx...`   |
| Policy version        | `polv_`  | `polv_01jx...`  |
| Approval              | `appr_`  | `appr_01jx...`  |
| Authorization         | `authz_` | `authz_01jx...` |
| Execution             | `exec_`  | `exec_01jx...`  |
| Replay                | `rpl_`   | `rpl_01jx...`   |
| Incident              | `inc_`   | `inc_01jx...`   |
| Evidence export       | `evx_`   | `evx_01jx...`   |
| Event                 | `evt_`   | `evt_01jx...`   |

------

## 4. Event Streams

Stream name:

```text
{workspaceId}:{aggregateType}:{aggregateId}
```

Examples:

```text
ws_123:run:run_456
ws_123:policy:pol_789
ws_123:approval:appr_111
```

Primary streams:

| Stream                  | Purpose                                                |
| ----------------------- | ------------------------------------------------------ |
| Workspace stream        | Workspace creation, mode changes, lock/unlock          |
| Provider stream         | Provider connection, capability detection, degradation |
| Tool manifest stream    | Tool import, manifest change, review                   |
| Agent stream            | Agent registration and pause/resume                    |
| Run stream              | One complete agent interaction                         |
| Decision stream         | Decision envelope validation                           |
| Policy stream           | Draft, validation, publication                         |
| Approval stream         | Human approval lifecycle                               |
| Authorization stream    | Single-use execution authorization                     |
| Execution stream        | Simulated or live execution state                      |
| Replay stream           | Replay jobs and outcomes                               |
| Incident stream         | Incident lifecycle                                     |
| Evidence export stream  | Evidence bundle lifecycle                              |
| Telegram binding stream | Telegram identity binding                              |

Cross-stream correlation uses:

```text
correlationId
causationId
runId
traceId
```

------

## 5. Event Categories

| Category        | Events                                                       |
| --------------- | ------------------------------------------------------------ |
| Workspace       | `WorkspaceCreated`, `WorkspaceModeChanged`, `WorkspaceLocked`, `WorkspaceUnlocked` |
| Provider        | `ProviderConnectionCreated`, `ProviderConnected`, `ProviderCapabilitiesDetected`, `ProviderDegraded`, `ProviderRecovered` |
| Tool manifest   | `ToolManifestImported`, `ToolManifestChanged`, `ToolManifestApproved`, `ToolFrozen`, `ToolBlocked` |
| Agent           | `AgentRegistered`, `AgentPaused`, `AgentResumed`, `AgentDisabled` |
| Run             | `RunCreated`, `RunStarted`, `RunCompleted`, `RunFailed`      |
| Tool call       | `ToolCallRequested`, `ToolCallCompleted`, `ToolCallFailed`, `ToolCallBlocked` |
| Market evidence | `MarketSnapshotCaptured`, `MarketSnapshotRejected`           |
| Decision        | `DecisionProposed`, `DecisionValidated`, `DecisionRejected`  |
| Policy          | `PolicyDraftCreated`, `PolicyValidated`, `PolicyImpactPreviewed`, `PolicyPublished`, `PolicyEvaluationStarted`, `PolicyEvaluated` |
| Approval        | `ApprovalRequested`, `ApprovalApproved`, `ApprovalRejected`, `ApprovalExpired`, `ApprovalRevoked` |
| Authorization   | `AuthorizationIssued`, `AuthorizationConsumed`, `AuthorizationExpired`, `AuthorizationRejected` |
| Execution       | `ExecutionRequested`, `ExecutionCompleted`, `ExecutionRejected`, `ExecutionUnknown` |
| Replay          | `ReplayRequested`, `ReplayStarted`, `ReplayCompleted`, `ReplayMismatchDetected` |
| Incident        | `IncidentCreated`, `IncidentAcknowledged`, `IncidentMitigated`, `IncidentResolved`, `IncidentEscalated` |
| Evidence        | `EvidenceExportRequested`, `EvidenceExportGenerated`, `EvidenceExportFailed`, `EvidenceExportDownloaded` |
| Telegram        | `TelegramBindingCreated`, `TelegramBindingConfirmed`, `TelegramBindingRevoked`, `TelegramNotificationSent`, `TelegramNotificationFailed` |

------

## 6. Core Payload Schemas

## 6.1 WorkspaceCreated

```ts
interface WorkspaceCreatedPayload {
  workspaceId: string;
  name: string;
  initialMode:
    | "safe_demo"
    | "approval_mode"
    | "guarded_autopilot"
    | "locked_investigation";
  createdBy: string;
}
```

------

## 6.2 WorkspaceModeChanged

```ts
interface WorkspaceModeChangedPayload {
  previousMode:
    | "safe_demo"
    | "approval_mode"
    | "guarded_autopilot"
    | "locked_investigation";

  newMode:
    | "safe_demo"
    | "approval_mode"
    | "guarded_autopilot"
    | "locked_investigation";

  reason: string;
  changedBy: string;
}
```

Security rule:

```text
Changing from safe_demo to a mode that permits live execution requires step-up authentication.
```

------

## 6.3 ProviderCapabilitiesDetected

```ts
interface ProviderCapabilitiesDetectedPayload {
  providerConnectionId: string;
  providerType: "bitget_agent_hub" | "custom_mcp" | "generic_rest";
  adapterVersion: string;

  capabilities: {
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
  };
}
```

Rule:

```text
Every capability is false until detected or explicitly configured.
```

------

## 6.4 ToolManifestImported

Aggregate: `tool_manifest`. Actor: `system`.

```ts
interface ToolManifestImportedPayload {
  toolManifestVersionId: string;
  providerConnectionId: string;
  manifestHash: string;
  normalizationVersion: string;

  tools: Array<{
    name: string;
    riskClass: ToolRiskClass;
    schemaHash: string;
  }>;
}
```

------

## 6.5 ToolManifestChanged

Aggregate: `tool_manifest`. Actor: `system`.

```ts
interface ToolManifestChangedPayload {
  toolManifestVersionId: string;
  providerConnectionId: string;

  previousManifestHash: string;
  manifestHash: string;

  added: ToolManifestEntry[];
  removed: string[];

  changed: Array<{
    name: string;
    previousSchemaHash?: string;
    schemaHash?: string;
    previousRiskClass?: ToolRiskClass;
    riskClass?: ToolRiskClass;
    sensitive: boolean;
  }>;
}

interface ToolManifestEntry {
  name: string;
  riskClass: ToolRiskClass;
  schemaHash: string;
}
```

Security rule:

```text
Changed trade-like, asset-movement, administrative, or unknown tools are frozen until review.
```

------

## 6.6 ToolFrozen

Aggregate: `tool_definition`. Actor: `system`.

```ts
interface ToolFrozenPayload {
  providerConnectionId: string;
  toolName: string;
  manifestHash: string;

  reasonCode:
    | "changed_sensitive"
    | "unknown_risk";
}
```

------

## 6.6.1 ToolBlocked

Aggregate: `tool_definition`. Actor: `system`.

```ts
interface ToolBlockedPayload {
  providerConnectionId: string;
  toolName: string;
  riskClass: ToolRiskClass;
  manifestHash: string;

  reasonCode:
    | "risk_class_default"
    | "operator_blocklist";
}
```

------

## 6.6.2 ToolManifestApproved

Aggregate: `tool_manifest`. Actor: `user`.

```ts
interface ToolManifestApprovedPayload {
  toolManifestVersionId: string;
  providerConnectionId: string;
  manifestHash: string;

  approvedBy: string;
  approvedAt: string;
}
```

Approval semantics:

```text
ToolManifestApproved releases changed_sensitive freezes back to the class default.
unknown_risk freezes persist across approval.
```

------

## 6.7 RunCreated

```ts
interface RunCreatedPayload {
  runId: string;
  workspaceId: string;
  agentId: string;
  providerConnectionId: string;

  mode:
    | "safe_demo"
    | "approval_mode"
    | "guarded_autopilot"
    | "locked_investigation";

  policyVersionId: string;
  toolManifestVersionId: string;
  traceId: string;

  source:
    | "mcp_gateway"
    | "web_guided_test"
    | "replay"
    | "api";
}
```

------

## 6.8 RunStarted

```ts
interface RunStartedPayload {
  runId: string;
  startedAt: string;

  initialUserIntent?: string;

  promptVersion?: string;
  modelProvider?: string;
  modelName?: string;
}
```

Privacy rule:

```text
initialUserIntent may be redacted or summarized based on workspace retention settings.
```

------

## 6.9 ToolCallRequested

```ts
interface ToolCallRequestedPayload {
  runId: string;
  toolName: string;
  providerConnectionId: string;
  toolDefinitionId: string;
  toolRiskClass:
    | "public_read"
    | "account_read"
    | "trade_like"
    | "asset_movement"
    | "administrative"
    | "unknown";

  requestRef: string;
  requestHash: string;

  argumentsRedacted: boolean;
  mcpRequestId?: string | number;
}
```

------

## 6.10 ToolCallCompleted

```ts
interface ToolCallCompletedPayload {
  runId: string;
  toolName: string;
  providerConnectionId: string;

  responseRef: string;
  responseHash: string;
  responseRedacted: boolean;

  durationMs: number;
  resultSummary?: string;
}
```

------

## 6.11 MarketSnapshotCaptured

```ts
interface MarketSnapshotCapturedPayload {
  runId: string;
  snapshotId: string;
  providerConnectionId: string;

  instrument: string;
  marketType: "spot" | "futures" | "tokenized_stock";

  capturedAt: string;
  expiresAt: string;

  sourceToolNames: string[];

  snapshotRef: string;
  snapshotHash: string;
}
```

------

## 6.12 DecisionProposed

```ts
interface DecisionProposedPayload {
  decisionId: string;
  runId: string;

  envelopeVersion: number;

  instrument: string;
  marketType: "spot" | "futures" | "tokenized_stock";

  action:
    | "open_long"
    | "open_short"
    | "buy"
    | "sell"
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

  decisionHash: string;
}
```

Rules:

```text
The thesis is a public explanation, not hidden chain-of-thought.
Financial and execution values (notional, quantity, leverage, limit price, stop loss, take profit) are decimal strings.
confidence is an advisory model score; it stays a number and is excluded from the decision hash and action digest.
The decision hash becomes part of the action digest.
```

------

## 6.13 DecisionValidated

```ts
interface DecisionValidatedPayload {
  decisionId: string;
  runId: string;

  validationResult: "valid";

  normalizedDecisionRef: string;
  normalizedDecisionHash: string;
}
```

------

## 6.14 DecisionRejected

```ts
interface DecisionRejectedPayload {
  decisionId?: string;
  runId: string;

  reasonCode:
    | "schema_invalid"
    | "missing_required_field"
    | "unsupported_action"
    | "missing_evidence"
    | "snapshot_rejected"
    | "numeric_parse_error";

  validationErrors: Array<{
    path: string;
    message: string;
  }>;
}
```

------

## 6.15 PolicyDraftCreated

```ts
interface PolicyDraftCreatedPayload {
  policyId: string;
  draftId: string;

  source:
    | "template"
    | "manual_yaml"
    | "manual_json"
    | "natural_language_draft";

  createdBy: string;

  draftRef: string;
  draftHash: string;
}
```

------

## 6.16 PolicyPublished

```ts
interface PolicyPublishedPayload {
  policyId: string;
  policyVersionId: string;
  version: number;

  publishedBy: string;

  sourceRef: string;
  sourceHash: string;

  compiledAstRef: string;
  compiledAstHash: string;

  previousActivePolicyVersionId?: string;
  becameActive: boolean;
}
```

Security rule:

```text
A model-generated policy draft cannot publish itself.
```

------

## 6.17 PolicyEvaluationStarted

```ts
interface PolicyEvaluationStartedPayload {
  evaluationId: string;
  runId: string;
  decisionId: string;

  policyVersionId: string;
  evaluatorVersion: string;

  evaluationInputHash: string;
}
```

------

## 6.18 PolicyEvaluated

```ts
interface PolicyEvaluatedPayload {
  evaluationId: string;
  runId: string;
  decisionId: string;

  policyVersionId: string;
  evaluatorVersion: string;

  outcome:
    | "allow"
    | "require_approval"
    | "block";

  matchedRules: Array<{
    ruleId: string;
    outcome: "allow" | "require_approval" | "block";
    explanation: string;
    expected?: unknown;
    actual?: unknown;
  }>;

  evaluationOutputHash: string;
}
```

Policy precedence:

```text
Any block rule -> block
Else any require_approval rule -> require_approval
Else allow
```

------

## 6.19 ApprovalRequested

```ts
interface ApprovalRequestedPayload {
  approvalId: string;
  runId: string;
  decisionId: string;
  policyEvaluationId: string;

  actionDigest: string;

  channelOptions: Array<"web" | "telegram" | "mcp_app">;

  expiresAt: string;

  summary: {
    instrument: string;
    action: string;
    notionalUsdt?: string;
    leverage?: string;
    policyOutcome: "require_approval";
  };
}
```

------

## 6.20 ApprovalApproved

```ts
interface ApprovalApprovedPayload {
  approvalId: string;
  runId: string;
  decisionId: string;

  actionDigest: string;

  approvedBy: string;
  approvalChannel: "web" | "telegram" | "mcp_app";

  approvedAt: string;
  expiresAt: string;
}
```

------

## 6.21 ApprovalRejected

```ts
interface ApprovalRejectedPayload {
  approvalId: string;

  rejectedBy: string;
  rejectionChannel: "web" | "telegram" | "mcp_app";

  reason?: string;
}
```

------

## 6.22 ApprovalExpired

```ts
interface ApprovalExpiredPayload {
  approvalId: string;
  expiredAt: string;
  actionDigest: string;
}
```

------

## 6.23 AuthorizationIssued

```ts
interface AuthorizationIssuedPayload {
  authorizationId: string;
  approvalId?: string;
  runId: string;
  decisionId: string;

  actionDigest: string;

  expiresAt: string;
  scope: "single_action";
}
```

Authorization rule:

```text
A require_approval outcome issues the authorization after ApprovalApproved, and approvalId references that approval.
An allow outcome auto-issues the authorization directly from the policy result, with no approvalId, so that no execution proceeds without a single-use authorization.
```

------

## 6.24 AuthorizationConsumed

```ts
interface AuthorizationConsumedPayload {
  authorizationId: string;
  approvalId?: string;
  runId: string;
  decisionId: string;

  actionDigest: string;

  consumedAt: string;
  executionId: string;
}
```

------

## 6.25 AuthorizationRejected

```ts
interface AuthorizationRejectedPayload {
  authorizationId?: string;
  approvalId?: string;

  runId: string;
  decisionId: string;

  attemptedActionDigest: string;
  expectedActionDigest?: string;

  reasonCode:
    | "missing_authorization"
    | "expired_authorization"
    | "already_consumed"
    | "action_digest_mismatch"
    | "workspace_locked"
    | "manifest_changed"
    | "policy_changed";
}
```

------

## 6.26 ExecutionRequested

```ts
interface ExecutionRequestedPayload {
  executionId: string;
  runId: string;
  decisionId: string;

  authorizationId?: string;

  adapterType:
    | "simulator"
    | "bitget_live"
    | "replay";

  actionDigest: string;
  idempotencyKey: string;

  requestRef: string;
  requestHash: string;
}
```

------

## 6.27 ExecutionCompleted

```ts
interface ExecutionCompletedPayload {
  executionId: string;
  runId: string;

  adapterType:
    | "simulator"
    | "bitget_live"
    | "replay";

  finalStatus:
    | "simulated"
    | "submitted"
    | "filled"
    | "partially_filled"
    | "cancelled";

  receiptRef: string;
  receiptHash: string;

  upstreamRef?: string;
  completedAt: string;
}
```

------

## 6.28 ExecutionRejected

```ts
interface ExecutionRejectedPayload {
  executionId?: string;
  runId: string;
  decisionId: string;

  reasonCode:
    | "policy_blocked"
    | "approval_required"
    | "authorization_missing"
    | "authorization_invalid"
    | "capability_unavailable"
    | "snapshot_stale"
    | "manifest_unapproved"
    | "workspace_locked";

  executionSent: false;
}
```

------

## 6.29 ExecutionUnknown

```ts
interface ExecutionUnknownPayload {
  executionId: string;
  runId: string;

  adapterType: "bitget_live";

  reasonCode:
    | "timeout_after_submit"
    | "connection_lost_after_submit"
    | "provider_status_unavailable"
    | "receipt_lookup_failed";

  upstreamRequestId?: string;

  reconciliationRequired: true;
  retryBlocked: true;
}
```

Security rule:

```text
ExecutionUnknown blocks automatic retry until reconciliation completes.
```

------

## 6.30 ReplayRequested

```ts
interface ReplayRequestedPayload {
  replayId: string;
  sourceRunId: string;

  replayType:
    | "exact"
    | "policy"
    | "agent"
    | "scenario";

  requestedBy: string;

  requestedPolicyVersionId?: string;
  requestedPromptVersion?: string;
  requestedModelName?: string;
}
```

------

## 6.31 ReplayCompleted

```ts
interface ReplayCompletedPayload {
  replayId: string;
  sourceRunId: string;

  replayType:
    | "exact"
    | "policy"
    | "agent"
    | "scenario";

  result:
    | "match"
    | "expected_difference"
    | "unexpected_difference"
    | "incomplete_evidence"
    | "tampered_bundle"
    | "unsupported_version";

  diffRef?: string;
  diffHash?: string;

  completedAt: string;
}
```

------

## 6.32 IncidentCreated

```ts
interface IncidentCreatedPayload {
  incidentId: string;

  type:
    | "policy_violation"
    | "manifest_changed"
    | "stale_market_data"
    | "duplicate_execution"
    | "approval_failed"
    | "provider_degraded"
    | "credential_scope_mismatch"
    | "replay_mismatch"
    | "secret_leak_detected"
    | "cross_workspace_access_attempt"
    | "execution_unknown";

  severity:
    | "info"
    | "warning"
    | "high"
    | "critical";

  summary: string;

  runId?: string;
  providerConnectionId?: string;

  relatedEventIds: string[];

  defaultAction:
    | "record_only"
    | "notify_operator"
    | "freeze_tool"
    | "freeze_provider"
    | "lock_workspace";
}
```

------

## 6.33 EvidenceExportGenerated

```ts
interface EvidenceExportGeneratedPayload {
  evidenceExportId: string;
  runId: string;

  generatedBy: "worker";

  exportRef: string;
  exportHash: string;

  redactionProfile:
    | "internal_full"
    | "developer_debug"
    | "public_demo";

  includedEventCount: number;
  includedObjectCount: number;
}
```

------

## 6.34 TelegramNotificationSent

```ts
interface TelegramNotificationSentPayload {
  notificationId: string;
  bindingId: string;
  workspaceId: string;

  notificationType:
    | "approval_request"
    | "blocked_action"
    | "manifest_changed"
    | "incident_alert"
    | "daily_summary";

  relatedRunId?: string;
  relatedApprovalId?: string;
  relatedIncidentId?: string;

  sentAt: string;
}
```

------

## 6.35 ApprovalRevoked

```ts
interface ApprovalRevokedPayload {
  approvalId: string;
  revokedBy?: string;
  revokedAt: string;
  reason?: string;
}
```

Revocation rule:

```text
ApprovalRevoked invalidates the backing approval. Any authorization that references this approvalId is projected to revoked, so a subsequent execution attempt is denied at the authorization guard with missing_authorization.
```

------

## 6.36 RunCompleted

```ts
interface RunCompletedPayload {
  runId: string;
  completedAt: string;
  executionId?: string;
}
```

------

## 6.37 RunFailed

```ts
interface RunFailedPayload {
  runId: string;
  failedAt: string;
  reasonCode: "orchestrator_error";
}
```

------

## 7. End-to-End Event Sequences

## 7.1 First-time onboarding

```text
WorkspaceCreated
ProviderConnectionCreated
ProviderConnected
ProviderCapabilitiesDetected
ToolManifestImported
ToolManifestApproved
PolicyDraftCreated
PolicyValidated
PolicyPublished
RunCreated
RunStarted
ToolCallRequested
ToolCallCompleted
MarketSnapshotCaptured
DecisionProposed
DecisionValidated
PolicyEvaluationStarted
PolicyEvaluated
AuthorizationIssued
ExecutionRequested
AuthorizationConsumed
ExecutionCompleted
RunCompleted
```

------

## 7.2 Read-only analysis

```text
RunCreated
RunStarted
ToolCallRequested
ToolCallCompleted
MarketSnapshotCaptured
ToolCallRequested
ToolCallCompleted
RunCompleted
```

Expected final status:

```text
completed
```

------

## 7.3 Approval-based simulated action

```text
RunCreated
RunStarted
MarketSnapshotCaptured
DecisionProposed
DecisionValidated
PolicyEvaluationStarted
PolicyEvaluated
ApprovalRequested
TelegramNotificationSent
ApprovalApproved
AuthorizationIssued
ExecutionRequested
AuthorizationConsumed
ExecutionCompleted
RunCompleted
```

Expected final status:

```text
completed
```

------

## 7.4 Dangerous action blocked

```text
RunCreated
RunStarted
MarketSnapshotCaptured
DecisionProposed
DecisionValidated
PolicyEvaluationStarted
PolicyEvaluated
ExecutionRejected
IncidentCreated
TelegramNotificationSent
RunCompleted
```

Expected final status:

```text
blocked
```

------

## 7.5 Tool manifest drift

```text
ToolManifestImported
ToolManifestChanged
ToolFrozen
IncidentCreated
TelegramNotificationSent
```

------

## 7.6 Replay

```text
ReplayRequested
ReplayStarted
ReplayCompleted
```

If mismatch occurs:

```text
ReplayMismatchDetected
IncidentCreated
```

------

## 7.7 Evidence export

```text
EvidenceExportRequested
EvidenceExportGenerated
EvidenceExportDownloaded
```

------

## 8. State Reconstruction

Projection state is derived from events.

## 8.1 Run projection

```ts
interface RunProjection {
  runId: string;
  workspaceId: string;
  agentId: string;
  providerConnectionId: string;

  mode:
    | "safe_demo"
    | "approval_mode"
    | "guarded_autopilot"
    | "locked_investigation";

  status:
    | "created"
    | "capturing"
    | "decision_ready"
    | "policy_evaluating"
    | "allowed"
    | "approval_required"
    | "blocked"
    | "executing"
    | "completed"
    | "failed"
    | "replayed";

  policyOutcome?: "allow" | "require_approval" | "block";
  approvalStatus?: ApprovalStatus;
  executionStatus?: string;

  startedAt?: string;
  completedAt?: string;

  lastEventId: string;
}
```

Reducer rules:

```text
RunCreated -> created
RunStarted -> capturing
DecisionValidated -> decision_ready
PolicyEvaluationStarted -> policy_evaluating
PolicyEvaluated allow -> allowed
PolicyEvaluated require_approval -> approval_required
PolicyEvaluated block -> blocked
ApprovalRequested -> approval_required
ApprovalApproved -> approval_required
ExecutionRequested -> executing
ExecutionCompleted -> completed
ExecutionRejected -> blocked
ExecutionUnknown -> executing (held for reconciliation; retry blocked, no terminal transition until reconciled)
RunCompleted -> completed
RunFailed -> failed
ApprovalRevoked -> blocked
ReplayCompleted -> replayed when projection is replay-specific
```

------

## 8.2 Approval projection

```text
ApprovalRequested -> pending
ApprovalApproved -> approved
AuthorizationIssued -> approved
AuthorizationConsumed -> consumed
ApprovalRejected -> rejected
ApprovalExpired -> expired
ApprovalRevoked -> revoked
```

------

## 8.3 Tool projection

The tool projection is materialized as `ToolInventoryView`:

```ts
interface ToolInventoryView {
  providerConnectionId?: string;
  manifestHash?: string;
  approvedManifestHash?: string;
  normalizationVersion?: string;

  tools: Array<{
    name: string;
    riskClass: ToolRiskClass;
    schemaHash: string;
    status: "active" | "blocked" | "frozen";
    visible: boolean;
    freezeReason?: "changed_sensitive" | "unknown_risk";
  }>;
}
```

Status defaults are re-derived by the projection from each tool's `riskClass`:

```text
asset_movement | administrative -> blocked
unknown                         -> frozen
otherwise                       -> active
```

Approval semantics:

```text
ToolManifestApproved releases changed_sensitive freezes back to the class default.
unknown_risk freezes persist across approval.
```

------

## 8.4 Incident projection

```text
IncidentCreated -> open
IncidentAcknowledged -> investigating
IncidentMitigated -> mitigated
IncidentResolved -> resolved
IncidentEscalated -> escalated
```

------

## 9. Database Design

## 9.1 `ledger_events`

```sql
CREATE TABLE ledger_events (
  id TEXT PRIMARY KEY,

  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,

  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,

  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  actor_type TEXT NOT NULL,
  actor_id TEXT,

  run_id TEXT,
  agent_id TEXT,
  provider_connection_id TEXT,
  policy_version_id TEXT,
  tool_manifest_version_id TEXT,

  trace_id TEXT,
  span_id TEXT,
  correlation_id TEXT,
  causation_id TEXT,
  idempotency_key TEXT,

  payload JSONB NOT NULL,

  payload_hash TEXT NOT NULL,
  previous_event_hash TEXT,
  event_hash TEXT NOT NULL,

  redaction_profile TEXT
);

CREATE INDEX idx_ledger_workspace_recorded
  ON ledger_events (workspace_id, recorded_at DESC);

CREATE INDEX idx_ledger_aggregate
  ON ledger_events (workspace_id, aggregate_type, aggregate_id, recorded_at ASC);

CREATE INDEX idx_ledger_run
  ON ledger_events (workspace_id, run_id, recorded_at ASC);

CREATE INDEX idx_ledger_correlation
  ON ledger_events (workspace_id, correlation_id, recorded_at ASC);

CREATE UNIQUE INDEX idx_ledger_event_hash
  ON ledger_events (event_hash);

CREATE UNIQUE INDEX idx_ledger_idempotency
  ON ledger_events (workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

`data-model.md` is the canonical schema for `ledger_events`. The definition above is illustrative; `workspace_id` carries a foreign key to `workspaces(id)` to enforce workspace scoping, and the full constraint and index set lives in `data-model.md`.

------

## 9.2 Projection tables

Projection tables are optimized views rebuilt from the ledger.

Recommended projections:

```text
workspace_projection
provider_projection
tool_inventory_projection
agent_projection
run_projection
approval_projection
execution_projection
incident_projection
replay_projection
evidence_export_projection
```

Projection tables may be updated in place.

The event ledger may not.

------

## 9.3 Object references

Large payloads should be stored in object storage and referenced from events.

```ts
interface ObjectRef {
  uri: string;
  hash: string;
  sizeBytes: number;
  contentType: string;

  redactionProfile:
    | "internal_full"
    | "developer_debug"
    | "public_demo";
}
```

Events should store:

```text
requestRef
responseRef
snapshotRef
receiptRef
diffRef
exportRef
```

not large raw payloads.

------

## 10. Hashing

## 10.1 Payload hash

```text
payloadHash = sha256(canonical_json(payload))
```

## 10.2 Event hash

```text
eventHash = sha256(canonical_json({
  id,
  workspaceId,
  aggregateType,
  aggregateId,
  eventType,
  eventVersion,
  schemaVersion,
  occurredAt,
  actorType,
  actorId,
  payloadHash,
  previousEventHash
}))
```

## 10.3 Canonical JSON rules

Canonicalization must define:

```text
sorted object keys
UTF-8 encoding
no insignificant whitespace
decimal values as strings
timestamps in ISO-8601 UTC
no undefined values
arrays preserve order
```

------

## 11. Idempotency

Commands that may be retried must carry idempotency keys.

Recommended format:

```text
{command}:{workspaceId}:{aggregateId}:{actionDigest}
```

Examples:

```text
execution:ws_123:run_456:dec_789:sha256_abc
approval-callback:ws_123:appr_789:telegram_update_111
manifest-refresh:ws_123:pc_456:sha256_manifest
```

The execution idempotency key binds both the run and the decision, so its canonical form is `execution:{workspaceId}:{runId}:{decisionId}:{actionDigest}`.

Behavior:

```text
If original command succeeded -> return existing result.
If original command is in progress -> return pending or conflict.
If original command failed safely -> return recorded failure.
Never execute a sensitive action twice.
```

------

## 12. Outbox Events

Domain events are not the same as integration messages.

Use a transactional outbox:

```text
write ledger event
write outbox message in same transaction
worker delivers notification or job
mark outbox delivered
```

Outbox schema:

```ts
interface OutboxMessage {
  id: string;
  workspaceId: string;

  messageType:
    | "telegram_notification"
    | "replay_job"
    | "evidence_export_job"
    | "telemetry_export"
    | "incident_alert";

  payload: unknown;

  status:
    | "pending"
    | "processing"
    | "delivered"
    | "failed"
    | "dead_letter";

  attempts: number;
  nextAttemptAt: string;

  createdAt: string;
  deliveredAt?: string;
}
```

Rules:

```text
Outbox delivery is at-least-once.
Consumers must be idempotent.
Outbox failure must not corrupt the event ledger.
Telegram delivery failure creates TelegramNotificationFailed.
```

------

## 13. Redaction and Privacy

Events should store summaries and references by default, not raw sensitive payloads.

Never store directly in event payload:

```text
API keys
secret keys
passphrases
full authorization headers
raw execution tokens
unredacted private account data
```

Use references:

```text
credentialRef
requestRef
responseRef
snapshotRef
receiptRef
```

Redaction profiles:

| Profile           | Purpose                                     |
| ----------------- | ------------------------------------------- |
| `internal_full`   | Workspace owner investigation               |
| `developer_debug` | Share with maintainers while hiding secrets |
| `public_demo`     | Hackathon, public issues, demo exports      |

------

## 14. Event Validation

Every emitted event must pass:

```text
envelope schema validation
payload schema validation
workspace authorization check
aggregate stream check
hash verification
redaction check
idempotency check when applicable
```

Malformed events must not be persisted.

Validation failures may produce operational logs, but not malformed ledger events.

------

## 15. Event Versioning

Compatible changes:

```text
adding optional fields
adding new event types
adding projection fields
```

Breaking changes:

```text
renaming fields
changing field meaning
changing required fields
changing hash inputs
changing event ordering guarantees
```

Breaking changes require:

```text
new eventVersion
migration notes
projection upgrader
replay compatibility test
```

Replay engine must declare supported event versions.

If unsupported:

```text
ReplayCompleted result = unsupported_version
```

------

## 16. OpenTelemetry Correlation

Each run maps to one OpenTelemetry trace.

Event envelope fields:

```text
traceId
spanId
```

Recommended span hierarchy:

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

Event-to-span mapping:

| Event                     | Span                         |
| ------------------------- | ---------------------------- |
| `RunStarted`              | `traceguard.run`             |
| `ToolCallRequested`       | `mcp.tools.call`             |
| `PolicyEvaluationStarted` | `traceguard.policy.evaluate` |
| `ApprovalRequested`       | `traceguard.approval.wait`   |
| `ExecutionRequested`      | `traceguard.execution.*`     |
| `ReplayStarted`           | `traceguard.replay`          |

------

## 17. UI Projection Requirements

## 17.1 Runs page

Requires:

```text
RunCreated
RunStarted
DecisionValidated
PolicyEvaluated
ApprovalRequested
ApprovalApproved
ExecutionCompleted
ExecutionRejected
RunCompleted
RunFailed
```

------

## 17.2 Run Detail page

The timeline should be reconstructed from:

```text
RunStarted
ToolCallRequested
ToolCallCompleted
MarketSnapshotCaptured
DecisionProposed
DecisionValidated
PolicyEvaluated
ApprovalRequested
ApprovalApproved
ExecutionRequested
ExecutionCompleted
EvidenceExportGenerated
```

Displayed as:

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

------

## 17.3 Tool Inventory page

Requires:

```text
ToolManifestImported
ToolManifestChanged
ToolManifestApproved
ToolFrozen
ToolBlocked
```

------

## 17.4 Replay and Diff page

Requires:

```text
ReplayRequested
ReplayStarted
ReplayCompleted
ReplayMismatchDetected
```

------

## 17.5 Incident page

Requires:

```text
IncidentCreated
IncidentAcknowledged
IncidentMitigated
IncidentResolved
IncidentEscalated
```

------

## 18. Evidence Bundle Construction

Evidence bundle is generated from ledger events plus referenced objects.

A valid run-level evidence bundle requires:

```text
RunCreated
RunStarted
all ToolCall events for the run
MarketSnapshotCaptured when used
DecisionProposed
DecisionValidated
PolicyEvaluationStarted
PolicyEvaluated
Approval events when applicable
Execution events when applicable
RunCompleted or RunFailed
```

Bundle manifest:

```ts
interface EvidenceBundleManifest {
  bundleVersion: number;
  workspaceId: string;
  runId: string;

  generatedAt: string;

  redactionProfile:
    | "internal_full"
    | "developer_debug"
    | "public_demo";

  includedEvents: Array<{
    eventId: string;
    eventType: string;
    eventHash: string;
  }>;

  includedObjects: Array<{
    ref: string;
    hash: string;
    sizeBytes: number;
  }>;

  bundleHash: string;
}
```

------

## 19. First Vertical Slice Event Contract

The first product slice must emit this sequence:

```text
WorkspaceCreated
ProviderConnectionCreated
ProviderConnected
ProviderCapabilitiesDetected
ToolManifestImported
ToolManifestApproved
PolicyDraftCreated
PolicyValidated
PolicyPublished

RunCreated
RunStarted
ToolCallRequested
ToolCallCompleted
MarketSnapshotCaptured
DecisionProposed
DecisionValidated
PolicyEvaluationStarted
PolicyEvaluated
ApprovalRequested
TelegramNotificationSent
ApprovalApproved
AuthorizationIssued
ExecutionRequested
AuthorizationConsumed
ExecutionCompleted
RunCompleted

RunCreated
RunStarted
MarketSnapshotCaptured
DecisionProposed
DecisionValidated
PolicyEvaluationStarted
PolicyEvaluated
ExecutionRejected
IncidentCreated
TelegramNotificationSent
RunCompleted

ReplayRequested
ReplayStarted
ReplayCompleted

EvidenceExportRequested
EvidenceExportGenerated
```

This sequence supports the hackathon story while remaining production-compatible.

------

## 20. Implementation Checklist

### Event infrastructure

```text
[ ] Define shared LedgerEvent type
[ ] Define event type registry
[ ] Add runtime schema validation
[ ] Add canonical JSON utility
[ ] Add payload hashing
[ ] Add aggregate-stream hash chaining
[ ] Add PostgreSQL ledger_events table
[ ] Add idempotency support
[ ] Add projection rebuild command
```

### Core event groups

```text
[ ] Workspace events
[ ] Provider events
[ ] Tool manifest events
[ ] Run events
[ ] Tool call events
[ ] Decision events
[ ] Policy events
[ ] Approval events
[ ] Authorization events
[ ] Execution events
[ ] Replay events
[ ] Incident events
[ ] Evidence export events
[ ] Telegram events
```

### Tests

```text
[ ] Event schema tests
[ ] Hash stability tests
[ ] Projection rebuild tests
[ ] Idempotency tests
[ ] Replay fixture tests
[ ] Evidence bundle verification tests
[ ] Redaction tests
```

------

## 21. Open Questions

- Should hash chaining be per aggregate stream or per full run stream for all run-related events?
- Should `ToolCallRequested` store normalized arguments inline for small payloads, or always use object references?
- What is the minimum event set required for a run to be considered replayable?
- Should Telegram notification events live in the approval stream or a separate notification stream?
- Should failed validation attempts be ledger events or operational logs?
- How should local-only raw evidence be represented in hosted projections?
- Should public demo exports include event hashes by default?
- Which event versions must be stable before the first public repository release?

------

## 22. Final Event Model Statement

TraceGuard's event model exists to make agent behavior durable, explainable, replayable, and auditable.

A trading agent may be non-deterministic.

The execution boundary cannot be.

The event ledger is where TraceGuard turns an agent's proposed action into a governed, reviewable, and replayable fact trail.