# TraceGuard Data Model

**Document status:** Draft v0.3
**Product:** TraceGuard
**Category:** Trading Agent Safety Runtime
**Primary purpose:** Define the persistent data model for events, projections, policies, approvals, replay, and evidence.

------

## 0. Executive Summary

TraceGuard uses an **append-only event ledger** as the source of truth.

Projection tables are optimized read models for the UI. They may be updated in place, but they must be rebuildable from the ledger.

Large payloads live in object storage. Events store hashes and references.

Recommended initial stack:

```text
PostgreSQL
S3-compatible object storage
PostgreSQL transactional outbox
Redis optional for short-lived locks and tokens
```

Do not introduce Kafka, multiple databases, or early microservice-specific storage until scale demands it.

The data model serves one product promise:

```text
A developer must be able to prove later what the agent saw, proposed, triggered, got approved for, executed, blocked, replayed, and exported.
```

------

## 1. Design Goals

The data model must support:

```text
run reconstruction
policy replay
evidence export
approval audit
manifest drift review
cross-workspace isolation
idempotent execution
redaction and public demo export
future signed receipts or proof anchors
```

It must also support the hackathon vertical slice:

```text
Bitget tool import
market-data run
Decision Envelope
policy evaluation
Telegram approval
simulated execution
blocked dangerous action
replay
evidence export
```

The most important rule is:

```text
Runtime truth lives in ledger_events.
UI convenience lives in projections.
Large artifacts live in object storage.
```

------

## 2. Storage Layers

## 2.1 PostgreSQL

PostgreSQL is the system of record.

It stores:

```text
users
workspaces
workspace members
provider connections
tool manifests
tool definitions
agents
runs
ledger events
policy versions
policy evaluations
approval requests
execution authorizations
execution receipts
incidents
replay jobs
replay results
evidence exports
telegram bindings
outbox messages
```

Why PostgreSQL first:

```text
durable transactions
strong relational constraints
JSONB support for event payloads
simple local deployment
good enough for initial event ledger
easy backup and migration path
```

------

## 2.2 Object Storage

Object storage holds large or sensitive redacted payloads.

Examples:

```text
market snapshots
tool request payloads
tool response payloads
execution receipts
replay bundles
evidence exports
diff files
public demo bundles
```

Events and relational tables should store references, not huge payloads.

```text
event payload → requestRef / responseRef / snapshotRef
object storage → actual content
```

------

## 2.3 Redis

Redis is optional in v0.1.

Use Redis only for short-lived operational state:

```text
approval locks
rate limits
session cache
idempotency locks
short-lived polling state
```

Redis must not be the only source of truth for:

```text
approval records
authorization state
execution receipts
policy versions
event ledger
```

If Redis disappears, TraceGuard may become slower, but it must not forget whether an action was approved or executed.

------

## 2.4 Transactional Outbox

Instead of introducing Kafka early, use a PostgreSQL transactional outbox.

Pattern:

```text
begin transaction
insert ledger event
update projection
insert outbox message
commit

worker reads outbox
delivers Telegram / replay / evidence job
marks outbox delivered
```

Benefits:

```text
simple
reliable
transactionally consistent with domain events
no early distributed-system complexity
```

------

## 3. Core Entity Relationship

High-level relationship:

```text
Workspace
  ├─ ProviderConnection
  │    ├─ ToolManifestVersion
  │    │    └─ ToolDefinition
  │    └─ ProviderCapabilities
  │
  ├─ Agent
  │    └─ Run
  │         ├─ LedgerEvent
  │         ├─ DecisionEnvelope
  │         ├─ PolicyEvaluation
  │         ├─ ApprovalRequest
  │         ├─ ExecutionAuthorization
  │         ├─ ExecutionReceipt
  │         ├─ ReplayJob
  │         └─ EvidenceExport
  │
  ├─ PolicyVersion
  ├─ Incident
  ├─ TelegramBinding
  └─ OutboxMessage
```

Every user-owned table must include:

```text
workspace_id
```

This is non-negotiable.

------

## 4. Table: `users`

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Notes:

```text
Authentication provider details can be added later.
Do not overbuild enterprise identity in v0.1.
```

------

## 5. Table: `workspaces`

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  active_policy_version_id TEXT, -- FK to policy_versions(id) added in §15 (circular dependency)
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Allowed modes:

```text
safe_demo
approval_mode
guarded_autopilot
locked_investigation
```

Important constraints:

```sql
ALTER TABLE workspaces
  ADD CONSTRAINT chk_workspace_mode
  CHECK (mode IN (
    'safe_demo',
    'approval_mode',
    'guarded_autopilot',
    'locked_investigation'
  ));
```

------

## 6. Table: `workspace_members`

```sql
CREATE TABLE workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, user_id)
);
```

Initial roles:

```text
owner
operator
developer
viewer
```

Role semantics:

| Role      | Can approve?  | Can publish policy? | Can view evidence? |
| --------- | ------------- | ------------------- | ------------------ |
| owner     | yes           | yes                 | yes                |
| operator  | yes           | limited             | yes                |
| developer | no by default | draft only          | debug redacted     |
| viewer    | no            | no                  | read-only          |

------

## 7. Table: `provider_connections`

```sql
CREATE TABLE provider_connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  provider_type TEXT NOT NULL,
  transport TEXT NOT NULL,
  status TEXT NOT NULL,

  active_manifest_version_id TEXT,
  credential_ref TEXT,

  capabilities JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_workspace
  ON provider_connections (workspace_id, provider_type);
```

Provider types:

```text
bitget_agent_hub
custom_mcp
generic_rest
```

Transport types:

```text
stdio
streamable_http
rest
```

Statuses:

```text
pending
connected
degraded
frozen
disabled
```

Design decision:

```text
capabilities are stored as JSONB because provider capabilities may evolve faster than relational schema.
```

------

## 8. Table: `tool_manifest_versions`

```sql
CREATE TABLE tool_manifest_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id),

  provider_version TEXT,
  manifest_hash TEXT NOT NULL,
  normalization_version TEXT NOT NULL,

  review_status TEXT NOT NULL,

  generated_at TIMESTAMPTZ NOT NULL,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_manifest_hash_provider
  ON tool_manifest_versions (provider_connection_id, manifest_hash);

CREATE INDEX idx_manifest_workspace_status
  ON tool_manifest_versions (workspace_id, review_status, generated_at DESC);
```

Review statuses:

```text
pending
approved
rejected
superseded
```

Why manifest versions matter:

```text
Tool definitions are part of the execution boundary.
A policy decision is not fully reproducible unless we know which exact tool manifest was active.
```

------

## 9. Table: `tool_definitions`

```sql
CREATE TABLE tool_definitions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  manifest_version_id TEXT NOT NULL REFERENCES tool_manifest_versions(id),
  provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id),

  name TEXT NOT NULL,
  title TEXT,
  description TEXT,

  input_schema JSONB NOT NULL,
  output_schema JSONB,
  annotations JSONB,

  schema_hash TEXT NOT NULL,

  risk_class TEXT NOT NULL,
  status TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_tool_manifest_name
  ON tool_definitions (manifest_version_id, name);

CREATE INDEX idx_tool_workspace_risk
  ON tool_definitions (workspace_id, risk_class, status);
```

Risk classes:

```text
public_read
account_read
trade_like
asset_movement
administrative
unknown
```

Statuses:

```text
approved
frozen
blocked
needs_review
```

Design decision:

```text
Tool identity is scoped by provider connection and manifest version.
A tool named place_order in one provider is not equivalent to a tool named place_order in another provider.
```

------

## 10. Table: `agents`

```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  name TEXT NOT NULL,
  external_ref TEXT,

  prompt_version TEXT,
  model_provider TEXT,
  model_name TEXT,

  status TEXT NOT NULL DEFAULT 'active',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agents_workspace
  ON agents (workspace_id, status);
```

Statuses:

```text
active
paused
disabled
```

------

## 11. Table: `runs`

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  agent_id TEXT NOT NULL REFERENCES agents(id),
  provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id),

  mode TEXT NOT NULL,
  status TEXT NOT NULL,

  policy_version_id TEXT NOT NULL, -- FK to policy_versions(id) added in §15 (forward reference)
  tool_manifest_version_id TEXT NOT NULL REFERENCES tool_manifest_versions(id),

  trace_id TEXT NOT NULL,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_runs_workspace_time
  ON runs (workspace_id, created_at DESC);

CREATE INDEX idx_runs_status
  ON runs (workspace_id, status, created_at DESC);

CREATE INDEX idx_runs_agent_time
  ON runs (workspace_id, agent_id, created_at DESC);
```

Run statuses:

```text
created
capturing
decision_ready
policy_evaluating
allowed
approval_required
blocked
executing
completed
failed
replayed
```

Design decision:

```text
runs is a projection-like convenience table.
The event ledger remains the factual source.
```

------

## 12. Table: `ledger_events`

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

Hard rule:

```text
ledger_events is append-only.
```

Application code must never update existing ledger rows.

If a correction is needed, emit a compensating event.

------

## 13. Table: `object_refs`

```sql
CREATE TABLE object_refs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  object_type TEXT NOT NULL,
  uri TEXT NOT NULL,
  hash TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  content_type TEXT NOT NULL,

  redaction_profile TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_object_hash
  ON object_refs (workspace_id, hash);

CREATE INDEX idx_object_workspace_type
  ON object_refs (workspace_id, object_type, created_at DESC);
```

Object types:

```text
tool_request
tool_response
market_snapshot
decision_envelope
policy_source
compiled_policy_ast
execution_receipt
replay_bundle
replay_diff
evidence_export
```

Design rule:

```text
Events should store object refs and hashes, not large raw payloads.
```

------

## 14. Table: `decision_envelopes`

```sql
CREATE TABLE decision_envelopes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  run_id TEXT NOT NULL REFERENCES runs(id),

  envelope_version INTEGER NOT NULL,

  instrument TEXT NOT NULL,
  market_type TEXT NOT NULL,
  action TEXT NOT NULL,

  thesis TEXT NOT NULL,
  confidence NUMERIC,

  requested_notional_usdt TEXT,
  requested_quantity TEXT,
  requested_leverage TEXT,

  order_type TEXT,
  limit_price TEXT,

  stop_loss TEXT,
  take_profit TEXT,

  prompt_version TEXT,
  model_provider TEXT,
  model_name TEXT,

  normalized_ref TEXT,
  decision_hash TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_decision_run
  ON decision_envelopes (workspace_id, run_id);

CREATE INDEX idx_decision_instrument
  ON decision_envelopes (workspace_id, instrument, created_at DESC);
```

Important rule:

```text
decision_hash is part of Action Digest.
```

`confidence` is an advisory model score, not an execution parameter. It is stored as a numeric value and is deliberately excluded from `decision_hash` and the Action Digest, so a confidence change never invalidates an approval. The decimal-string convention applies only to financial and execution values (notional, quantity, leverage, limit price, stop loss, take profit).

------

## 15. Table: `policy_versions`

```sql
CREATE TABLE policy_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  policy_id TEXT NOT NULL,
  version INTEGER NOT NULL,

  source_format TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  source_hash TEXT NOT NULL,

  compiled_ast_ref TEXT NOT NULL,
  compiled_ast_hash TEXT NOT NULL,

  status TEXT NOT NULL,

  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_policy_version
  ON policy_versions (workspace_id, policy_id, version);

CREATE INDEX idx_policy_workspace_status
  ON policy_versions (workspace_id, status, created_at DESC);

-- At most one published version per (workspace, policy) at any time.
CREATE UNIQUE INDEX idx_policy_published_unique
  ON policy_versions (workspace_id, policy_id)
  WHERE status = 'published';

-- Deferred foreign keys: policy_versions is created after workspaces (§5) and
-- runs (§11), so these references are added here to avoid forward and circular
-- references at table-creation time.
ALTER TABLE workspaces
  ADD CONSTRAINT fk_workspace_active_policy_version
  FOREIGN KEY (active_policy_version_id) REFERENCES policy_versions(id);

ALTER TABLE runs
  ADD CONSTRAINT fk_run_policy_version
  FOREIGN KEY (policy_version_id) REFERENCES policy_versions(id);
```

Statuses:

```text
draft
validated
published
superseded
```

Why source and compiled AST both matter:

```text
source_ref helps humans review what was written.
compiled_ast_ref is what the deterministic evaluator executed.
Both must be hashable and replayable.
```

------

## 16. Table: `policy_evaluations`

```sql
CREATE TABLE policy_evaluations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  run_id TEXT NOT NULL REFERENCES runs(id),
  decision_id TEXT REFERENCES decision_envelopes(id),
  policy_version_id TEXT NOT NULL REFERENCES policy_versions(id),

  evaluator_version TEXT NOT NULL,
  outcome TEXT NOT NULL,

  matched_rules JSONB NOT NULL,

  input_hash TEXT NOT NULL,
  output_hash TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_policy_eval_run
  ON policy_evaluations (workspace_id, run_id);

CREATE INDEX idx_policy_eval_outcome
  ON policy_evaluations (workspace_id, outcome, created_at DESC);
```

Outcomes:

```text
allow
require_approval
block
```

------

## 17. Table: `approval_requests`

```sql
CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  run_id TEXT NOT NULL REFERENCES runs(id),
  decision_id TEXT NOT NULL REFERENCES decision_envelopes(id),
  policy_evaluation_id TEXT NOT NULL REFERENCES policy_evaluations(id),

  action_digest TEXT NOT NULL,
  status TEXT NOT NULL,

  requested_channels JSONB NOT NULL,

  expires_at TIMESTAMPTZ NOT NULL,

  approved_by TEXT REFERENCES users(id),
  approved_at TIMESTAMPTZ,

  rejected_by TEXT REFERENCES users(id),
  rejected_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_workspace_status
  ON approval_requests (workspace_id, status, expires_at);

CREATE INDEX idx_approval_action_digest
  ON approval_requests (workspace_id, action_digest);

CREATE INDEX idx_approval_run
  ON approval_requests (workspace_id, run_id);
```

Statuses:

```text
pending
approved
rejected
expired
revoked
```

------

## 18. Table: `execution_authorizations`

```sql
CREATE TABLE execution_authorizations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  approval_id TEXT REFERENCES approval_requests(id),

  run_id TEXT NOT NULL REFERENCES runs(id),
  decision_id TEXT NOT NULL REFERENCES decision_envelopes(id),

  action_digest TEXT NOT NULL,
  status TEXT NOT NULL,

  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_authorization_workspace_status
  ON execution_authorizations (workspace_id, status, expires_at);

CREATE INDEX idx_authorization_action_digest
  ON execution_authorizations (workspace_id, action_digest);
```

Statuses:

```text
issued
consumed
expired
revoked
```

Execution adapter must reject:

```text
expired authorization
consumed authorization
action digest mismatch
wrong workspace
wrong run
wrong decision
```

`approval_id` is nullable. A `require_approval` outcome sets `approval_id` to the approval that authorized the action. An `allow` outcome auto-issues the authorization directly from the policy result, so its `approval_id` is `NULL`. Either way a single-use authorization exists before execution, preserving the "no execution without authorization" invariant.

------

## 19. Table: `execution_receipts`

```sql
CREATE TABLE execution_receipts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  run_id TEXT NOT NULL REFERENCES runs(id),
  decision_id TEXT NOT NULL REFERENCES decision_envelopes(id),

  authorization_id TEXT NOT NULL REFERENCES execution_authorizations(id),

  adapter_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  action_digest TEXT NOT NULL,

  status TEXT NOT NULL,
  upstream_ref TEXT,

  request_ref TEXT NOT NULL,
  response_ref TEXT,
  receipt_ref TEXT,
  receipt_hash TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_execution_idempotency
  ON execution_receipts (workspace_id, idempotency_key);

CREATE INDEX idx_execution_run
  ON execution_receipts (workspace_id, run_id);

CREATE INDEX idx_execution_status
  ON execution_receipts (workspace_id, status, created_at DESC);
```

Statuses:

```text
simulated
submitted
filled
partially_filled
cancelled
rejected
failed
unknown
```

Important:

```text
unknown is a first-class execution status.
```

It prevents blind retries after ambiguous provider timeouts.

Every execution receipt references a single-use authorization, so `authorization_id` is `NOT NULL`. An `allow` outcome auto-issues a single-use authorization before execution exactly as an approved outcome does, so the invariant "no execution without authorization" holds for every path.

------

## 20. Table: `incidents`

```sql
CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  run_id TEXT,
  provider_connection_id TEXT,

  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,

  summary TEXT NOT NULL,
  related_event_ids JSONB NOT NULL DEFAULT '[]',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_incidents_workspace_status
  ON incidents (workspace_id, status, created_at DESC);

CREATE INDEX idx_incidents_run
  ON incidents (workspace_id, run_id);
```

Incident types:

```text
policy_violation
manifest_changed
stale_market_data
duplicate_execution
approval_failed
provider_degraded
credential_scope_mismatch
replay_mismatch
secret_leak_detected
cross_workspace_access_attempt
execution_unknown
```

Severities:

```text
info
warning
high
critical
```

Statuses:

```text
open
investigating
mitigated
resolved
escalated
```

------

## 21. Table: `replay_jobs`

```sql
CREATE TABLE replay_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  source_run_id TEXT NOT NULL REFERENCES runs(id),

  replay_type TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES users(id),

  requested_policy_version_id TEXT,
  requested_prompt_version TEXT,
  requested_model_name TEXT,

  status TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_replay_workspace_status
  ON replay_jobs (workspace_id, status, created_at DESC);

CREATE INDEX idx_replay_source_run
  ON replay_jobs (workspace_id, source_run_id);
```

Replay types:

```text
exact
policy
agent
scenario
```

Statuses:

```text
requested
queued
running
completed
failed
```

------

## 22. Table: `replay_results`

```sql
CREATE TABLE replay_results (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  replay_job_id TEXT NOT NULL REFERENCES replay_jobs(id),
  source_run_id TEXT NOT NULL REFERENCES runs(id),

  result TEXT NOT NULL,

  diff_ref TEXT,
  diff_hash TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_replay_results_job
  ON replay_results (workspace_id, replay_job_id);
```

Replay results:

```text
match
expected_difference
unexpected_difference
incomplete_evidence
tampered_bundle
unsupported_version
```

------

## 23. Table: `evidence_exports`

```sql
CREATE TABLE evidence_exports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  run_id TEXT NOT NULL REFERENCES runs(id),

  redaction_profile TEXT NOT NULL,

  export_ref TEXT,
  export_hash TEXT,

  status TEXT NOT NULL,

  requested_by TEXT NOT NULL REFERENCES users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_at TIMESTAMPTZ,
  downloaded_at TIMESTAMPTZ
);

CREATE INDEX idx_evidence_workspace_run
  ON evidence_exports (workspace_id, run_id);

CREATE INDEX idx_evidence_status
  ON evidence_exports (workspace_id, status, created_at DESC);
```

Redaction profiles:

```text
internal_full
developer_debug
public_demo
```

Statuses:

```text
requested
generating
generated
failed
downloaded
```

------

## 24. Table: `telegram_bindings`

```sql
CREATE TABLE telegram_bindings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  user_id TEXT REFERENCES users(id),

  telegram_user_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,

  status TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_telegram_binding
  ON telegram_bindings (workspace_id, telegram_user_id);

CREATE INDEX idx_telegram_workspace_status
  ON telegram_bindings (workspace_id, status);
```

Statuses:

```text
pending
confirmed
revoked
disabled
```

Telegram stores no exchange secrets.

------

## 25. Table: `outbox_messages`

```sql
CREATE TABLE outbox_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),

  message_type TEXT NOT NULL,
  payload JSONB NOT NULL,

  status TEXT NOT NULL,

  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX idx_outbox_pending
  ON outbox_messages (status, next_attempt_at);

CREATE INDEX idx_outbox_workspace
  ON outbox_messages (workspace_id, created_at DESC);
```

Message types:

```text
telegram_notification
replay_job
evidence_export_job
incident_alert
telemetry_export
```

Statuses:

```text
pending
processing
delivered
failed
dead_letter
```

------

## 26. Projection Strategy

Projection tables are read models.

Recommended projections:

```text
run_projection
tool_inventory_projection
approval_projection
incident_projection
replay_projection
dashboard_projection
```

Projection rebuild command:

```bash
traceguard projections rebuild --workspace ws_123
```

Rules:

```text
ledger remains source of truth
projections may be updated in place
projections must be rebuildable
replay must not depend only on projections
```

### 26.1 `run_projection`

Purpose:

```text
Fast Runs page and Run Detail summary.
```

Fields:

```text
run_id
workspace_id
agent_name
provider_type
instrument
action
mode
policy_outcome
approval_status
execution_status
started_at
completed_at
last_event_id
```

### 26.2 `tool_inventory_projection`

Purpose:

```text
Fast Tool Inventory page.
```

Fields:

```text
provider_connection_id
tool_name
module
risk_class
status
schema_hash
manifest_hash
last_reviewed_at
changed
```

### 26.3 `approval_projection`

Purpose:

```text
Fast pending approvals page.
```

Fields:

```text
approval_id
run_id
decision_id
action_summary
action_digest
status
expires_at
channels
```

------

## 27. Hashing

### 27.1 Payload Hash

```text
payloadHash = sha256(canonical_json(payload))
```

### 27.2 Event Hash

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

### 27.3 Object Hash

```text
objectHash = sha256(raw_object_bytes)
```

### 27.4 Canonical JSON Rules

```text
sort object keys
UTF-8
no insignificant whitespace
decimal values as strings
timestamps in ISO-8601 UTC
arrays preserve order
omit undefined
```

Hash stability is essential for Replay and Evidence Export.

------

## 28. Workspace Isolation

Every table that stores user data must include `workspace_id`.

Application rules:

```text
never fetch by resource ID alone
always include workspace_id predicate
all API routes resolve workspace first
all background jobs carry workspace_id
all object refs include workspace_id
all outbox messages include workspace_id
```

Security tests must include IDOR attempts.

Example bad query:

```sql
SELECT * FROM runs WHERE id = $1;
```

Example good query:

```sql
SELECT * FROM runs WHERE workspace_id = $1 AND id = $2;
```

------

## 29. Redaction Model

Redaction profiles:

| Profile           | Purpose                       |
| ----------------- | ----------------------------- |
| `internal_full`   | Workspace owner investigation |
| `developer_debug` | Share with maintainers        |
| `public_demo`     | Hackathon and public demo     |

Never store directly:

```text
API keys
secret keys
passphrases
raw authorization headers
unredacted execution tokens
```

Store references:

```text
credential_ref
request_ref
response_ref
receipt_ref
```

Public demo exports must redact:

```text
private account IDs
private balances
credential scopes
real private order IDs
Telegram user IDs
```

------

## 30. Retention

Suggested defaults:

| Data                         | Default retention      |
| ---------------------------- | ---------------------- |
| ledger events                | Long-term              |
| projections                  | Derived, rebuildable   |
| raw sanitized tool responses | 30 days                |
| public demo exports          | Until deleted          |
| evidence bundles             | Workspace-configurable |
| Telegram callback tokens     | Short-lived            |
| approval records             | Long-term              |
| secret values                | Never stored in ledger |

Retention should be policy-controlled later.

------

## 31. Transaction Patterns

### 31.1 Event + Projection

```text
begin transaction
insert ledger event
update projection
insert outbox message if needed
commit
```

### 31.2 Approval

```text
begin transaction
insert ApprovalRequested event
insert approval_requests row
insert outbox telegram_notification
commit
```

### 31.3 Approval Callback

```text
begin transaction
lock approval row
check status = pending
check expires_at > now()
update approval_requests
insert ApprovalApproved event
insert execution_authorization
insert AuthorizationIssued event
commit
```

### 31.4 Execution

```text
begin transaction
check authorization status
check action_digest
check idempotency key
insert ExecutionRequested event
insert execution_receipt
consume authorization
commit
```

### 31.5 Execution Completion

```text
begin transaction
update execution_receipt
insert ExecutionCompleted event
update run projection
commit
```

### 31.6 Outbox

Outbox delivery is at-least-once.

Consumers must be idempotent.

------

## 32. Idempotency

Sensitive commands must carry idempotency keys.

Recommended format:

```text
execution:{workspaceId}:{runId}:{decisionId}:{actionDigest}
approval-callback:{workspaceId}:{approvalId}:{telegramUpdateId}
manifest-refresh:{workspaceId}:{providerConnectionId}:{manifestHash}
```

Behavior:

```text
same idempotency key + success → return existing result
same idempotency key + pending → return pending
same idempotency key + unknown execution → require reconciliation
same idempotency key + mismatch → reject and create incident
```

------

## 33. First Vertical Slice Tables

For v0.1, implement at minimum:

```text
users
workspaces
workspace_members
provider_connections
tool_manifest_versions
tool_definitions
agents
runs
ledger_events
object_refs
decision_envelopes
policy_versions
policy_evaluations
approval_requests
execution_authorizations
execution_receipts
incidents
replay_jobs
replay_results
evidence_exports
telegram_bindings
outbox_messages
```

This supports:

```text
Bitget tool import
market-data run
Decision Envelope
policy evaluation
Telegram approval
simulated execution
blocked dangerous action
replay
evidence export
```

------

## 34. Migration Strategy

Use explicit SQL migrations.

Rules:

```text
no destructive migration without backup
event schema changes require version bump
projection tables may be rebuilt
hash input changes require major version
replay compatibility tests before release
```

Migration folder:

```text
packages/db/migrations
```

Suggested naming:

```text
0001_init_workspaces.sql
0002_provider_tools.sql
0003_runs_ledger.sql
0004_policy_approval_execution.sql
0005_replay_evidence.sql
0006_telegram_outbox.sql
```

------

## 35. Implementation Order

Implement schema in this order:

```text
1. workspaces, users, workspace_members
2. provider_connections, tool_manifest_versions, tool_definitions
3. agents, runs
4. ledger_events, object_refs
5. policy_versions, decision_envelopes, policy_evaluations
6. approval_requests, execution_authorizations
7. execution_receipts
8. incidents
9. replay_jobs, replay_results
10. evidence_exports
11. telegram_bindings, outbox_messages
```

Reason:

```text
Each layer depends on the previous one, and the first useful vertical slice needs provider → run → decision → policy → approval → execution → replay.
```

------

## 36. Test Requirements

### 36.1 Schema Tests

```text
all workspace-owned tables require workspace_id
foreign keys exist
unique indexes exist
check constraints exist
migrations apply cleanly
migrations roll forward from empty database
```

### 36.2 Ledger Tests

```text
append-only behavior
event hash stability
payload hash stability
aggregate stream ordering
idempotency uniqueness
projection rebuild from events
```

### 36.3 Security Tests

```text
cross-workspace IDOR blocked
public demo export redacts secrets
authorization reuse rejected
idempotency prevents duplicate execution
unknown execution prevents retry
```

### 36.4 Replay Tests

```text
exact replay loads required evidence
policy replay loads historical decision
tampered object hash fails verification
unsupported event version returns unsupported_version
```

------

## 37. Design Tradeoffs

### 37.1 Why Append-only Ledger?

Because TraceGuard must explain the past.

A mutable `runs` table cannot answer:

```text
what changed?
when did it change?
who approved it?
which policy was active?
which tool manifest was used?
```

The ledger can.

### 37.2 Why Not Kafka First?

Kafka is useful later, but premature now.

PostgreSQL outbox gives:

```text
transactional correctness
simpler local setup
lower operational complexity
enough reliability for v0.1
```

### 37.3 Why Object Storage?

Tool responses, snapshots, and evidence exports can become large.

Putting all raw payloads into event JSONB would make the ledger heavy and harder to manage.

### 37.4 Why Store Projections?

Rebuilding UI from raw events on every request is expensive and inconvenient.

Projections give speed while preserving ledger truth.

------

## 38. Final Statement

TraceGuard's data model is designed around one idea:

```text
The system must be able to prove what happened later.
```

That requires:

```text
append-only events
stable hashes
replayable object references
workspace isolation
idempotency
redaction boundaries
transactional outbox
projection rebuildability
```

A trading agent may be unpredictable.

TraceGuard's record of what happened cannot be.