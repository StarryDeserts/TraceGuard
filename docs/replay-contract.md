# TraceGuard Replay Contract

**Document status:** Draft v0.3
**Product:** TraceGuard
**Category:** Trading Agent Safety Runtime
**Primary purpose:** Define how TraceGuard reconstructs, re-evaluates, compares, and exports historical agent runs.

------

## 0. Executive Summary

Replay is one of TraceGuard's core differentiators.

Most trading-agent products show what the agent says now. TraceGuard must answer:

```text
What happened?
What evidence did the agent use?
Which policy evaluated the action?
Why was the action allowed, escalated, or blocked?
Would a stricter policy have changed the result?
Can this incident be reproduced later?
```

Replay is not a cosmetic feature. It is how TraceGuard proves that policy, approval, and execution behavior are not arbitrary.

TraceGuard supports four replay modes:

| Replay Type     | Purpose                                           |
| --------------- | ------------------------------------------------- |
| Exact Replay    | Reconstruct the original outcome                  |
| Policy Replay   | Test a historical proposal under another policy   |
| Agent Replay    | Re-run an agent under the same context            |
| Scenario Replay | Run regression fixtures across policies or agents |

For v0.1, the priority is:

```text
Exact Replay
Policy Replay
Replay Diff
Evidence Bundle verification
```

Agent Replay and Scenario Replay can be documented and partially scaffolded, but they do not need to be fully implemented for the first vertical slice.

------

## 1. Replay Principles

### 1.1 Replay Is Not Chat Playback

Replay does not mean replaying a chat transcript.

Replay reconstructs the runtime facts:

```text
tool manifest
tool calls
market snapshots
Decision Envelope
policy version
matched rules
approval state
execution receipt
event sequence
```

A chat transcript may be useful context, but it is not sufficient for deterministic Replay.

### 1.2 Replay Does Not Store Hidden Reasoning

TraceGuard replays public artifacts:

```text
Decision Envelope
evidence references
tool outputs
policy results
approval records
execution receipts
```

It must not depend on hidden model chain-of-thought.

This matters because hidden reasoning is neither stable nor appropriate as an audit artifact. TraceGuard should replay what the system used at the execution boundary, not what the model may have internally reasoned.

### 1.3 Determinism Where Possible

Exact Replay and Policy Replay should be deterministic.

Given:

```text
same Decision Envelope
same market snapshot
same tool manifest
same provider capability set
same policy version
same evaluator version
same simulator version
```

TraceGuard should produce the same policy and simulated execution result.

Agent Replay may be non-deterministic because models may produce different outputs. Agent Replay must clearly label new outputs as new proposals, not original facts.

### 1.4 Replay Must Declare Validity

Every Replay returns one validity result:

```text
match
expected_difference
unexpected_difference
incomplete_evidence
tampered_bundle
unsupported_version
```

A Replay result without a validity status is not acceptable.

### 1.5 Replay Must Not Depend on Live Provider Calls

Exact Replay must not call Bitget or any other live provider to reconstruct the past.

It should use stored evidence:

```text
market snapshot refs
tool-call response refs
decision envelope
policy source
execution receipt
ledger events
```

If a Replay requires live provider state, it is not Exact Replay.

------

## 2. Replay Types

## 2.1 Exact Replay

Question:

```text
Can TraceGuard reconstruct the original result?
```

Preserved inputs:

```text
original event sequence
original market snapshot
original tool-call outputs
original tool manifest hash
original Decision Envelope
original policy version
original evaluator version
original simulator version
original approval events
original execution receipt
```

Expected result:

```text
match
```

If the result differs without an intentional version change:

```text
unexpected_difference
```

and TraceGuard should create an incident.

### 2.1.1 Exact Replay Use Cases

Exact Replay is used for:

```text
incident investigation
evidence verification
demo repeatability
debugging simulator behavior
checking event-ledger integrity
```

### 2.1.2 Exact Replay Non-Goals

Exact Replay does not:

```text
ask the model to think again
fetch current Bitget prices
re-run live orders
reconstruct hidden model reasoning
infer missing evidence from logs
```

------

## 2.2 Policy Replay

Question:

```text
Would a different policy have changed the historical outcome?
```

Preserved inputs:

```text
market snapshot
tool outputs
Decision Envelope
provider capabilities
tool manifest
execution adapter type
```

Changed input:

```text
policy version
```

Example:

```text
Original policy result: require_approval
New policy result: block
Reason: new max leverage limit reduced from 5× to 3×
Replay result: expected_difference
```

Policy Replay is the most important v0.1 replay mode because it proves TraceGuard can test risk rules against historical agent behavior.

### 2.2.1 Policy Replay Use Cases

```text
policy impact preview
risk-rule upgrades
incident remediation
regression testing before publishing policy
explaining why a new policy is safer
```

### 2.2.2 Policy Replay Example

Historical proposal:

```text
Buy 700 USDT BTCUSDT at 2× leverage.
```

Original policy:

```text
approval required above 500 USDT
max leverage 3×
```

Original result:

```text
require_approval
```

New policy:

```text
block above 600 USDT
```

Replay result:

```text
expected_difference
```

Explanation:

```text
The same historical proposal would now be blocked because requested notional is 700 USDT and the new hard limit is 600 USDT.
```

------

## 2.3 Agent Replay

Question:

```text
Would a new model or prompt propose a different action under the same evidence?
```

Preserved inputs:

```text
market snapshot
tool outputs
user intent summary
provider context
```

Changed inputs:

```text
prompt version
model provider
model name
agent configuration
```

Output:

```text
new Decision Envelope
diff against original Decision Envelope
```

Important limitation:

```text
Agent Replay does not prove what the original model thought.
It only compares a new agent run against historical evidence.
```

Agent Replay is valuable later, but not required for the first implementation.

### 2.3.1 Agent Replay Use Cases

```text
prompt regression testing
model upgrade evaluation
strategy behavior comparison
agent abstention testing
confidence drift analysis
```

### 2.3.2 Agent Replay Risks

Agent Replay can be misunderstood.

Bad product language:

```text
We replayed the model's thinking.
```

Correct product language:

```text
We ran a new agent evaluation against the same historical evidence and compared the resulting proposal.
```

------

## 2.4 Scenario Replay

Question:

```text
Does the system still enforce expected behavior across known cases?
```

A scenario is a reusable fixture.

Examples:

```text
Oversized leverage must block.
Withdraw tool must block.
Stale market snapshot must block.
Approval replay must reject.
Manifest drift must freeze tool.
```

Scenario Replay is useful for CI and security regression.

### 2.4.1 Scenario Replay Use Cases

```text
security test suite
policy engine regression
pre-release validation
hackathon demo repeatability
adapter compatibility testing
```

### 2.4.2 Recommended v0.1 Scenarios

```text
safe 300 USDT BTCUSDT 2× action
dangerous 2500 USDT BTCUSDT 8× action
stale market snapshot
withdraw tool attempt
changed tool manifest
approval replay
unknown tool call
```

------

## 3. Replay Bundle

A Replay Bundle is the durable input to Replay.

```ts
interface ReplayBundle {
  bundleVersion: number;

  workspaceId: string;
  runId: string;
  agentId: string;
  providerConnectionId: string;

  mode:
    | "safe_demo"
    | "approval_mode"
    | "guarded_autopilot"
    | "locked_investigation";

  toolManifestVersionId: string;
  toolManifestHash: string;

  policyVersionId: string;
  evaluatorVersion: string;

  decisionEnvelopeRef?: string;
  decisionEnvelopeHash?: string;

  marketSnapshotRefs: ObjectRef[];
  toolCallRefs: ObjectRef[];

  approvalEventIds: string[];
  executionEventIds: string[];
  ledgerEventIds: string[];

  simulatorVersion?: string;

  bundleHash: string;
}
```

The bundle should include enough information to replay without live provider calls.

------

## 4. ObjectRef

Large payloads are referenced, not embedded.

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

Object types:

```text
market_snapshot
tool_request
tool_response
decision_envelope
policy_source
compiled_policy_ast
execution_receipt
replay_diff
evidence_export
```

------

## 5. Evidence Requirements

| Evidence          | Exact Replay                     | Policy Replay          | Agent Replay   | Scenario Replay |
| ----------------- | -------------------------------- | ---------------------- | -------------- | --------------- |
| Event sequence    | Required                         | Required               | Optional       | Fixture         |
| Decision Envelope | Required                         | Required               | Generated anew | Fixture         |
| Market Snapshot   | Required                         | Required               | Required       | Fixture         |
| Tool Manifest     | Required                         | Required               | Required       | Fixture         |
| Policy Version    | Required                         | Replaced               | Optional       | Varied          |
| Evaluator Version | Required                         | Current or specified   | Optional       | Current         |
| Approval Events   | Required if existed              | Referenced             | Optional       | Optional        |
| Execution Receipt | Required if execution occurred   | Referenced             | Optional       | Expected output |
| Simulator Version | Required for simulated execution | Required if simulating | Optional       | Required        |

If required evidence is missing, return:

```text
incomplete_evidence
```

------

## 6. Replay Results

```ts
type ReplayResult =
  | "match"
  | "expected_difference"
  | "unexpected_difference"
  | "incomplete_evidence"
  | "tampered_bundle"
  | "unsupported_version";
```

### 6.1 `match`

The reconstructed result equals the original.

Example:

```text
Original policy result: block
Replay policy result: block
Result: match
```

### 6.2 `expected_difference`

The result differs because the user intentionally changed:

```text
policy version
prompt version
model
simulator version
scenario parameter
```

Example:

```text
Original policy v1: require_approval
Replay policy v2: block
Result: expected_difference
```

### 6.3 `unexpected_difference`

The result differs without intentional change.

Must emit:

```text
ReplayMismatchDetected
IncidentCreated
```

Possible causes:

```text
policy evaluator bug
non-deterministic simulator
missing normalization
hash mismatch
event order issue
```

### 6.4 `incomplete_evidence`

Required evidence is missing.

Examples:

```text
missing Decision Envelope
missing market snapshot
missing policy source
missing simulator version
missing execution receipt
missing tool manifest hash
```

### 6.5 `tampered_bundle`

Hashes do not verify.

Examples:

```text
event payload hash mismatch
object hash mismatch
bundle hash mismatch
event chain broken
```

### 6.6 `unsupported_version`

Replay engine does not support the event, policy, or bundle version.

Example:

```text
Replay engine supports bundleVersion 1.
Bundle is version 3.
Result: unsupported_version.
```

------

## 7. Replay Diff

Replay Diff should be readable by a human first.

```ts
interface ReplayDiff {
  replayId: string;
  sourceRunId: string;

  summary: {
    originalOutcome: string;
    replayOutcome: string;
    result: ReplayResult;
  };

  changedFields: Array<{
    path: string;
    original: unknown;
    replay: unknown;
    significance:
      | "low"
      | "medium"
      | "high"
      | "critical";
    explanation: string;
  }>;

  unchangedEvidence: string[];
}
```

Default visible diff fields:

```text
policy version
policy outcome
matched rules
decision action
requested notional
requested leverage
approval state
execution state
```

Advanced fields:

```text
raw tool payloads
full schemas
object hashes
span IDs
provider error details
```

------

## 8. Replay State Machine

```text
requested
→ queued
→ running
→ completed
```

Failure branches:

```text
running → failed
completed → mismatch_detected → incident_created
completed → evidence_incomplete
completed → bundle_tampered
completed → unsupported_version
```

Events:

```text
ReplayRequested
ReplayStarted
ReplayCompleted
ReplayMismatchDetected
IncidentCreated
```

------

## 9. Exact Replay Flow

```text
Select historical run
→ Load replay bundle
→ Verify bundle hash
→ Verify event hashes
→ Verify object hashes
→ Reconstruct projection
→ Load original policy version
→ Load evaluator version
→ Re-run deterministic policy evaluation
→ Compare original and replay output
→ Produce replay result
```

Exact Replay must not call live provider APIs.

If a replay requires live provider state, it is not Exact Replay.

------

## 10. Policy Replay Flow

```text
Select historical run
→ Select target policy version
→ Load original Decision Envelope
→ Load original market snapshot
→ Load original provider capabilities
→ Evaluate target policy
→ Compare original and new result
→ Generate diff
```

Example output:

```text
Original result:
require_approval

Replay result:
block

Why:
Policy v3 lowered max_leverage from 5× to 3×.
The original requested leverage was 4×.

Replay result:
expected_difference
```

------

## 11. Agent Replay Flow

```text
Select historical run
→ Load market context
→ Load tool outputs
→ Choose new prompt or model
→ Run agent in replay mode
→ Capture new Decision Envelope
→ Compare old and new Decision Envelopes
```

Agent Replay output should say:

```text
New proposal under historical context
```

not:

```text
Original hidden reasoning reproduced
```

### 11.1 Agent Replay Diff Fields

Useful fields:

```text
action changed?
instrument changed?
notional changed?
leverage changed?
confidence changed?
thesis changed?
abstain vs action?
evidence refs changed?
```

------

## 12. Scenario Replay

Scenario fixture:

```ts
interface ReplayScenario {
  scenarioId: string;
  name: string;
  description: string;

  inputs: {
    marketSnapshotRef: string;
    decisionEnvelopeRef: string;
    policyVersionIds: string[];
  };

  expected: Array<{
    policyVersionId: string;
    expectedOutcome:
      | "allow"
      | "require_approval"
      | "block";
    expectedMatchedRules?: string[];
  }>;
}
```

Recommended v0.1 scenarios:

```text
safe 300 USDT BTCUSDT 2× action
dangerous 2500 USDT BTCUSDT 8× action
stale market snapshot
withdraw tool attempt
changed tool manifest
approval replay
unknown tool call
```

------

## 13. Replay Security Cases

### 13.1 Prompt Injection Case

A tool output contains malicious instructions. The agent proposes high leverage. Policy blocks.

Replay should show:

```text
same tool output
same Decision Envelope
same policy
same result = block
```

This proves the deterministic guardrail worked despite polluted context.

### 13.2 Approval Replay Case

An approval is reused.

Replay should show:

```text
approval consumed
second attempt rejected
AuthorizationRejected
incident created
```

### 13.3 Manifest Drift Case

A tool definition changes.

Replay should show:

```text
old manifest hash
new manifest hash
tool frozen
sensitive execution blocked
```

### 13.4 Stale Snapshot Case

Market snapshot exceeds allowed age at decision time.

Replay should show:

```text
snapshot captured at T
decision evaluated at T + 42s
policy max age = 15s
result = block
```

Freshness is enforced when the decision is evaluated, not at execution time. Replay reproduces that decision-time check; it does not re-block an already-approved action for crossing the snapshot-age window after approval.

------

## 14. UI Requirements

### 14.1 Replay Page

User chooses:

```text
Run
Replay Type
Target Policy / Prompt / Scenario
```

### 14.2 Diff Page

Top summary:

```text
Original result: Approval Required
Replay result: Blocked
Difference: Expected
```

Then show:

```text
Why changed:
Policy v3 reduced max leverage from 5× to 3×.
```

### 14.3 Evidence Panel

Show:

```text
Bundle verified
Event hashes verified
Object hashes verified
Policy version found
Simulator version found
```

If invalid, say exactly what is missing.

Bad:

```text
Replay failed.
```

Good:

```text
Replay cannot run because the original market snapshot is missing.
```

------

## 15. Evidence Verification

Verification steps:

```text
load bundle manifest
verify bundle hash
verify event hashes
verify object hashes
verify event ordering
verify required event set
verify policy version
verify simulator version
```

CLI command:

```bash
traceguard evidence verify ./evidence/run_123.json
```

Output:

```text
Evidence bundle verified.
Events: 42
Objects: 8
Bundle hash: sha256_...
Replay status: exact replay supported
```

------

## 16. Replay Bundle Manifest

```ts
interface ReplayBundleManifest {
  bundleVersion: number;
  generatedAt: string;

  workspaceId: string;
  runId: string;

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
    contentType: string;
  }>;

  bundleHash: string;
}
```

------

## 17. Replay Events

### 17.1 `ReplayRequested`

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

### 17.2 `ReplayStarted`

```ts
interface ReplayStartedPayload {
  replayId: string;
  sourceRunId: string;
  startedAt: string;
  workerId?: string;
}
```

### 17.3 `ReplayCompleted`

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

### 17.4 `ReplayMismatchDetected`

```ts
interface ReplayMismatchDetectedPayload {
  replayId: string;
  sourceRunId: string;

  expectedResult?: string;
  actualResult?: string;

  reason: string;
  incidentId: string;
}
```

------

## 18. First Vertical Slice

v0.1 must implement:

```text
Exact Replay for simulated runs
Policy Replay for historical Decision Envelopes
Diff between original and replay policy result
Replay result events
Evidence hash verification
UI showing replay summary and diff
```

Agent Replay can be documented but not required initially.

### 18.1 First Demo Replay Flow

```text
Run 1: BTCUSDT 300 USDT 2× approved simulated action
Run 2: BTCUSDT 2500 USDT 8× blocked action

Replay Run 2:
same market snapshot
same Decision Envelope
same policy
result = match

Replay Run 2 with stricter policy:
result = expected_difference or match depending rule
show diff
```

------

## 19. Test Matrix

| Test                                    | Expected                |
| --------------------------------------- | ----------------------- |
| Same bundle exact replay                | `match`                 |
| Missing snapshot                        | `incomplete_evidence`   |
| Modified event hash                     | `tampered_bundle`       |
| New stricter policy                     | `expected_difference`   |
| Different result without version change | `unexpected_difference` |
| Unsupported event version               | `unsupported_version`   |
| Dangerous leverage fixture              | `block`                 |
| Withdraw fixture                        | `block`                 |
| Approval replay fixture                 | authorization rejected  |
| Changed manifest fixture                | tool frozen             |

------

## 20. Implementation Guidance

### 20.1 Start With Policy Replay

Policy Replay gives the most product value fastest.

It needs:

```text
Decision Envelope
market snapshot reference
policy versions
policy evaluator
diff generation
```

It does not need a model call.

### 20.2 Then Add Exact Replay

Exact Replay needs stronger evidence discipline:

```text
event hashes
object hashes
simulator version
original evaluator version
event ordering
```

### 20.3 Add Agent Replay Later

Agent Replay is powerful but easier to overpromise.

Do it after the core deterministic replay path is reliable.

------

## 21. Hackathon Demo Use

Replay should appear near the end of the video.

Story:

```text
We saw a normal bounded proposal approved.
Then we saw a dangerous proposal blocked.
Now we replay both from stored evidence and prove the outcomes are reproducible.
Then we replay the dangerous run under a stricter policy and see the same block with a clearer rule explanation.
```

The judge should understand:

```text
TraceGuard is not just live monitoring.
It lets teams debug and regression-test agent behavior.
```

------

## 22. Product Copy

Good copy:

```text
Replay this run under a different policy.
```

Good copy:

```text
This replay matched the original result.
```

Good copy:

```text
This replay differs because policy-v3 lowered the leverage limit.
```

Bad copy:

```text
Replay the model's thoughts.
```

Bad copy:

```text
Replay failed.
```

------

## 23. Final Statement

A trading agent may be non-deterministic.

TraceGuard's execution boundary cannot be.

Replay is how TraceGuard proves that policy, approval, and execution decisions were not arbitrary.