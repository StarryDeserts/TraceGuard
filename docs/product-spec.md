# TraceGuard Product Specification

**Document status:** Draft v0.1
**Product:** TraceGuard
**Category:** Trading Agent Safety Runtime
**Initial ecosystem:** Bitget Agent Hub
**Long-term architecture:** Provider-neutral
**Primary track:** Trading Infrastructure

------

## 0. Executive Decision

TraceGuard is a safety control center for developers and operators running trading agents.

It sits between an AI agent and trading tools, allowing users to:

1. see what an agent observed and proposed;
2. constrain what the agent is allowed to do;
3. require approval for higher-risk actions;
4. replay and compare historical runs;
5. export auditable evidence after an incident.

The product is not a new trading strategy, a chatbot, a trading terminal, or another exchange API wrapper.

The initial product should be **Bitget-first but not Bitget-locked**.

The recommended interaction model is:

```text
Acquisition and installation:
GitHub README + CLI onboarding

Primary management surface:
Web Control Plane

Daily approvals and alerts:
Telegram Guardian Bot + lightweight Mini App

Agent integration:
TraceGuard MCP Gateway

Future embedded interaction:
MCP App approval cards
```

------

## 1. Problem Definition

AI trading tools are moving from analysis toward action.

Connecting an agent to market data and trading APIs is becoming easier. The unresolved problem is trust.

A developer or account owner needs to answer:

```text
What did the agent see?
Why did it propose this action?
Which tools did it invoke?
Did it remain within my rules?
Why was an action blocked?
What changed after a prompt, model, or policy update?
Can I reproduce an incident?
```

Existing tool access alone does not answer these questions.

Basic confirmation prompts are useful, but they are not sufficient for operating agents over time. Developers also need structured evidence, policy versioning, replay, regression testing, and incident investigation.

### Core problem statement

> Trading agents can access powerful tools, but developers lack a dedicated runtime for governing, replaying, and auditing agent behavior.

------

## 2. Product Thesis

TraceGuard makes trading agents easier to trust without removing automation.

Its core model is:

```text
Agent may analyze.
Agent may propose.
Agent may not silently expand its own authority.
Every sensitive action must be explainable, policy-checked, and replayable.
```

The product should reduce two types of risk:

### Operational risk

- unexpected tool invocation;
- oversized position;
- excessive leverage;
- unsupported asset;
- stale market context;
- duplicated execution;
- accidental permission expansion;
- unreviewed tool schema changes.

### Trust risk

- users cannot understand why an action occurred;
- developers cannot reproduce an incident;
- prompt or model updates change behavior silently;
- teams cannot prove which rule was active at execution time;
- approvals are disconnected from the underlying evidence.

------

## 3. Product Boundaries

## 3.1 TraceGuard is

- a trading-agent safety runtime;
- an MCP gateway and policy enforcement layer;
- an approval orchestrator;
- a decision-trace recorder;
- a replay and regression-testing system;
- an audit evidence generator;
- a control plane for agent operators.

## 3.2 TraceGuard is not

- a trading strategy generator;
- a general AI trading chatbot;
- a consumer trading terminal;
- an exchange replacement;
- a portfolio manager;
- a guaranteed-profit product;
- a model that predicts price direction;
- a generic observability dashboard with a trading-themed skin;
- a direct competitor to GetClaw.

------

## 4. Target Users

## 4.1 Primary Persona: Trading Agent Builder

### Profile

A developer or small team building an AI trading agent with Bitget Agent Hub, MCP tools, CLI tools, or a custom orchestration framework.

### Existing workflow

```text
Create API credentials
→ Configure an MCP server or CLI bridge
→ Expose tools to an agent
→ Write prompts and strategy logic
→ Run test queries
→ Observe chat output and scattered logs
→ Manually investigate unexpected behavior
```

### Pain points

- tool calls are hard to correlate into one run;
- prompts and model versions are not tied to execution evidence;
- confirmation prompts are too coarse;
- policy rules are not centrally managed;
- failures are difficult to replay;
- changing an agent introduces silent behavior drift;
- raw logs are too technical for account owners.

### Job to be done

> Help me operate a trading agent safely enough that I can increase automation without losing control.

------

## 4.2 Secondary Persona: Account Owner or Strategy Operator

### Profile

A trader, founder, or operations lead who owns the account risk but does not want to inspect MCP payloads.

### Existing workflow

```text
Receive a trading suggestion
→ Read a message or dashboard
→ Decide whether to trust it
→ Approve manually or ignore it
```

### Pain points

- unclear reasons;
- too much technical information;
- approvals lack context;
- no simple view of current limits;
- no reliable incident history;
- no clear distinction between recommendation and authorization.

### Job to be done

> Tell me what the agent wants to do, whether it fits my rules, and whether I need to act.

------

## 5. Why Users Would Adopt TraceGuard

TraceGuard should not require users to abandon their existing agent workflow.

The adoption promise is:

```text
Keep your existing trading agent.
Replace the direct tool connection with TraceGuard.
Gain policy control, approvals, traces, replay, and audit evidence.
```

The user should not need to:

- move strategy logic into a new proprietary framework;
- learn a new trading terminal;
- migrate away from an existing AI client;
- inspect raw MCP messages;
- write complex policy code on day one.

------

## 6. Entry Strategy

There is no single interface that fits every interaction.

TraceGuard should use one backend with multiple surfaces.

## 6.1 Primary Acquisition Entry: GitHub + CLI

The primary user is a developer. Their first interaction should begin in the README.

Suggested command:

```bash
npx @traceguard/cli init --provider bitget
```

The CLI should:

1. detect the local environment;
2. connect or locate Bitget Agent Hub;
3. import available tools;
4. calculate a tool-manifest fingerprint;
5. identify sensitive operations;
6. create a workspace;
7. enable Safe Demo mode;
8. generate an MCP configuration snippet;
9. open the Web Control Plane;
10. optionally connect Telegram.

### Product principle

> The first value moment should happen before the user reads a long manual.

------

## 6.2 Primary Management Entry: Web Control Plane

The Web Control Plane is the main product.

It is the place for:

- onboarding;
- provider setup;
- policy management;
- run history;
- trace inspection;
- replay;
- version diff;
- tool inventory;
- approvals;
- incidents;
- audit export.

The web interface is the cockpit and investigation room.

------

## 6.3 Daily Interaction Entry: Telegram Guardian Bot

Telegram should be a companion, not the entire product.

It should handle:

- approval requests;
- blocked-action alerts;
- tool-change alerts;
- incident summaries;
- daily risk summaries;
- deep links into a selected run.

Telegram is useful because approval is often a low-frequency, time-sensitive mobile action.

### Example approval message

```text
BTCUSDT Buy Request

Amount: 300 USDT
Leverage: 2×
Agent: BTC Momentum Agent
Policy: Approval Mode
Reason: Momentum remains positive while funding is moderate.

[Approve Once] [Reject] [View Trace]
```

### Example blocked-action message

```text
Action blocked by TraceGuard

Agent requested:
BTCUSDT Buy 2,500 USDT at 8× leverage

Matched rules:
- Maximum order size: 1,000 USDT
- Maximum leverage: 3×

[View Trace] [Open Replay]
```

------

## 6.4 Lightweight Telegram Mini App

The Mini App should expose a mobile-friendly subset:

```text
Pending Approvals
Recent Blocks
Active Agents
Current Risk Mode
Open Full Trace
```

It should not attempt to reproduce the full desktop control plane.

Complex policy authoring, trace exploration, and run comparison belong on the web.

------

## 6.5 Future Entry: MCP App Approval Cards

For clients that support embedded MCP interfaces, TraceGuard should eventually return an approval card directly inside the chat or IDE.

Example:

```text
Agent wants to place an order

BTCUSDT
Buy 300 USDT
Leverage 2×

Policy checks passed.

[Approve Once]
[Reject]
[Open Full Trace]
```

This reduces context switching while preserving a human decision point.

------

## 7. Product Modes

Users should not begin by configuring dozens of rules.

TraceGuard should provide progressive modes.

| Mode                 | User intent              | Execution behavior                                           |
| -------------------- | ------------------------ | ------------------------------------------------------------ |
| Safe Demo            | Explore without risk     | All orders simulated                                         |
| Approval Mode        | Keep direct control      | Queries run automatically; trade-like actions require confirmation |
| Guarded Autopilot    | Allow bounded automation | Low-risk actions may proceed; larger or unusual actions require approval |
| Locked Investigation | Respond to an incident   | New actions paused; traces and replay remain available       |

The default mode is **Safe Demo**.

------

## 8. First-Time User Journey

The onboarding target is a clear first value moment within five minutes.

## Step 1: Choose what to protect

```text
What are you protecting?

[ Bitget Agent Hub ]
[ Custom MCP Agent ]
[ Explore with Safe Demo ]
```

## Step 2: Connect the provider

For Bitget Agent Hub:

```text
Provider detected
Tools imported
Sensitive operations identified
Safe Mode enabled
```

The user sees:

```text
Provider: Bitget Agent Hub
Imported tools: 58
Default mode: Safe Demo
Sensitive operations: protected
```

## Step 3: Choose a policy template

Show three templates:

| Template          | Description                                           |
| ----------------- | ----------------------------------------------------- |
| Safe Demo         | Simulated execution only                              |
| Approval Mode     | Require confirmation before trade-like actions        |
| Guarded Autopilot | Allow small bounded actions and escalate riskier ones |

Only request three simple values initially:

```text
Allowed instruments
Maximum order amount
Maximum leverage
```

Advanced controls remain hidden.

## Step 4: Connect Telegram

```text
Connect Telegram Guardian
```

This is optional but encouraged.

## Step 5: Run a guided safety test

The onboarding flow runs a safe scenario:

```text
Read BTCUSDT market data
→ Propose a simulated order
→ Apply the selected policy
→ Save the run
→ Open the trace
```

The user should never land on an empty dashboard.

------

## 9. Daily User Journeys

## 9.1 Read-Only Analysis

The user asks an agent:

```text
Analyze BTC market conditions and tell me whether risk exposure should be reduced.
```

TraceGuard records market-data tool calls automatically.

No interruption is needed.

Result:

```text
Allowed automatically
Trace recorded
No approval required
```

------

## 9.2 Approved Simulated or Live-Like Action

The agent proposes:

```text
Buy 300 USDT BTCUSDT at 2× leverage.
```

TraceGuard:

```text
captures proposal
→ validates decision envelope
→ evaluates policy
→ requests approval
→ generates a one-time authorization
→ executes through the configured adapter
→ stores evidence
```

The approval is valid only for the exact action and expires quickly.

------

## 9.3 Blocked Dangerous Action

The agent proposes:

```text
Buy 2,500 USDT BTCUSDT at 8× leverage.
```

TraceGuard blocks it automatically.

The user sees:

```text
Blocked

Why:
- Requested amount exceeds your limit.
- Requested leverage exceeds your limit.

No order was sent.
```

------

## 9.4 Incident Investigation

The operator opens:

```text
Runs
→ Blocked Run
→ Trace Detail
→ Replay
→ Policy Version Diff
```

The operator can answer:

- what the agent observed;
- which proposal it generated;
- which rules matched;
- whether approval was requested;
- whether execution occurred;
- what would change under a stricter policy.

------

## 10. Information Architecture

## 10.1 Dashboard

Purpose: answer “Is everything safe right now?”

Show:

- active agents;
- current mode;
- pending approvals;
- blocked actions today;
- tool changes requiring review;
- recent runs;
- risk summary.

Avoid generic trading charts unless they support an incident.

------

## 10.2 Runs

Purpose: answer “What has each agent been doing?”

Columns:

```text
Run
Agent
Provider
Instrument
Mode
Decision
Policy Result
Execution Result
Time
```

Filters:

```text
Allowed
Blocked
Approval Required
Failed
Replayed
```

------

## 10.3 Run Detail

Purpose: answer “Why did this happen?”

Timeline:

```text
Intent
→ Perception
→ Tool Calls
→ Decision Envelope
→ Policy Evaluation
→ Approval
→ Execution
→ Evidence
```

Default view should show human-readable summaries.

Advanced users can expand:

```text
Raw Tool Payload
Tool Schema
Manifest Hash
Policy Version
Span ID
Snapshot Reference
```

------

## 10.4 Policies

Purpose: answer “What is the agent allowed to do?”

Default view:

```text
Allowed assets
Maximum order size
Maximum leverage
Approval threshold
Blocked operations
Active mode
```

Advanced view:

```text
Policy source
Version history
Diff
Test cases
Recent matches
Publish status
```

Users may draft a policy using natural language, but it must be reviewed before publication.

Example:

```text
Only allow BTC and ETH.
Do not allow orders above 500 USDT.
Ask me before using leverage above 2×.
```

TraceGuard converts this into a deterministic policy draft.

The user reviews and publishes it manually.

------

## 10.5 Approvals

Purpose: answer “What needs my decision?”

Each request shows:

```text
Agent
Action
Amount
Leverage
Reason
Evidence
Matched policy
Expiry
```

Actions:

```text
Approve Once
Reject
Open Full Trace
```

Do not support vague approvals such as “approve similar actions forever” in the initial product.

------

## 10.6 Replay and Diff

Purpose: answer “What changed?”

Support three replay modes:

| Replay type   | Question answered                                        |
| ------------- | -------------------------------------------------------- |
| Exact Replay  | Can we reconstruct the original outcome?                 |
| Policy Replay | What would happen under a different policy?              |
| Agent Replay  | Would a new prompt or model propose something different? |

Diff view should highlight:

```text
Market context
Tool output
Decision
Policy matches
Approval state
Execution result
```

------

## 10.7 Tool Inventory

Purpose: answer “Which capabilities are exposed to the agent?”

Show:

```text
Provider
Tool
Permission class
Schema fingerprint
Current status
Last reviewed
Last changed
```

Stored review states:

```text
Approved
Needs Review
Frozen
Blocked
```

"Changed" is not a stored review state. It is a derived drift indicator: when a tool's schema fingerprint differs from the last reviewed version, the tool transitions to `Needs Review` and the UI surfaces a "Changed" badge to explain why. The canonical `reviewStatus` field only ever holds `approved`, `needs_review`, `frozen`, or `blocked`.

A changed tool schema must not silently receive the same trust level as its previous version.

------

## 10.8 Incidents

Purpose: answer “What needs investigation?”

Examples:

```text
Unexpected tool-definition change
Stale market data
Oversized proposed order
Repeated approval failures
Duplicate execution request
Upstream provider timeout
Credential-scope mismatch
```

------

## 11. Learning-Cost Reduction

TraceGuard should be understandable before it is configurable.

## 11.1 Use trading language

Avoid:

```text
Policy AST evaluation rejected request.
```

Prefer:

```text
This order was blocked because it exceeds your leverage limit.
```

Avoid:

```text
Tool manifest hash mismatch.
```

Prefer:

```text
A trading tool changed unexpectedly. TraceGuard paused it until you review the update.
```

## 11.2 Progressive disclosure

Default view:

```text
Action
Risk
Result
Why
```

Expanded view:

```text
Raw payload
Schema
Manifest fingerprint
Trace span
Policy source
```

## 11.3 Templates before custom policy code

Begin with:

```text
Safe Demo
Approval Mode
Guarded Autopilot
```

Only expose custom policy editing when needed.

## 11.4 Preserve the existing workflow

The user should continue working inside their preferred AI client.

TraceGuard should appear only when:

- onboarding;
- reviewing a run;
- approving a sensitive action;
- investigating an incident;
- updating policy.

------

## 12. Bitget-First Product Strategy

TraceGuard should be provider-neutral at the architecture layer and Bitget-first at the product layer.

## 12.1 Initial implementation

The first-class adapter is:

```text
Bitget Agent Hub Adapter
```

The initial product experience should:

1. detect Bitget Agent Hub;
2. import its MCP tool list;
3. classify sensitive tools;
4. fingerprint the tool manifest;
5. record real Bitget market-data calls;
6. protect trade-like actions with policy checks;
7. provide Bitget-oriented templates;
8. document Bitget onboarding clearly;
9. use Bitget market context in sample runs;
10. demonstrate a real integration path.

## 12.2 Long-term extension

Future adapters may include:

```text
Custom MCP Adapter
Generic REST Adapter
Additional Exchange Adapters
Broker Adapters
Internal Trading-System Adapters
```

Do not expose these future integrations as the center of the initial story.

------

## 13. Messaging Strategy

## 13.1 Primary message

> TraceGuard is the safety control center for trading agents built with Bitget Agent Hub.

## 13.2 Supporting message

> Bitget Agent Hub makes AI-native trading accessible. TraceGuard adds policy control, approvals, replay, and audit evidence for developers operating trading agents.

## 13.3 Ecosystem message

> Designed to complement the Bitget AI ecosystem, starting with Agent Hub.

## 13.4 Developer message

> Keep your agent workflow. Add a governed runtime between your agent and trading tools.

## 13.5 Claims we may make

- built for the Bitget Agent Hub ecosystem;
- Bitget-first MCP integration;
- provider-neutral runtime architecture;
- policy-based controls;
- replayable decision traces;
- one-time approvals;
- auditable evidence;
- simulated execution support;
- tool-manifest monitoring.

## 13.6 Claims we must not make

- officially endorsed by Bitget;
- integrated with GetClaw unless an official integration exists;
- securing all Bitget activity;
- eliminating trading risk;
- guaranteeing profit;
- guaranteeing regulatory compliance;
- supporting live execution unless demonstrated and documented;
- replacing Bitget’s own permission model.

------

## 14. Differentiation

TraceGuard must not compete on “more trading features.”

It competes on safer operation.

| Existing capability       | TraceGuard contribution                |
| ------------------------- | -------------------------------------- |
| MCP tool access           | governed tool access                   |
| read-only mode            | versioned granular policy              |
| explicit confirmation     | cross-channel approval workflow        |
| raw logs                  | structured run trace                   |
| single execution result   | replay and diff                        |
| basic permission boundary | decision-aware policy enforcement      |
| provider tool list        | manifest fingerprint and change review |
| local debugging           | operator-facing incident investigation |

------

## 15. Hackathon Winning Slice

The submitted project should represent a real vertical slice of the long-term product.

It should not be a disconnected demo branch.

## 15.1 Required user story

```text
A developer connects Bitget Agent Hub.
TraceGuard imports the available tools.
An agent reads real Bitget market data.
The agent proposes a bounded simulated order.
TraceGuard requests approval through Telegram.
The user approves once.
The simulated execution succeeds.
The agent later proposes an oversized leveraged order.
TraceGuard blocks it automatically.
The operator opens the Web Control Plane and replays both runs.
```

## 15.2 Required visible surfaces

```text
CLI onboarding
Web Dashboard
Run Detail
Policies
Approvals
Replay & Diff
Tool Inventory
Telegram Guardian Bot
```

## 15.3 Required evidence

```text
Real Bitget market-data tool call
Imported Bitget tool inventory
Structured decision envelope
Policy evaluation record
Approval record
Blocked-action record
Replay result
Run diff
Runnable repository
README quick start
```

------

## 16. Success Metrics

## 16.1 Product metrics

- time from install to first protected run;
- percentage of users completing onboarding;
- number of traced runs;
- percentage of risky actions blocked;
- approval completion rate;
- median approval response time;
- number of successful replays;
- number of policy versions tested before publish;
- number of tool changes detected;
- number of incidents resolved through replay.

## 16.2 Developer-experience metrics

- number of commands required to connect Bitget Agent Hub;
- time required to create the first policy;
- time required to investigate a blocked run;
- percentage of runs with complete evidence;
- number of manual configuration steps;
- number of integration errors surfaced with actionable explanations.

## 16.3 Hackathon metrics

- one-command onboarding;
- at least one real Bitget market-data call;
- at least one successful protected run;
- at least one Telegram approval;
- at least one blocked dangerous action;
- at least one replay;
- at least one visible diff;
- reproducible README.

------

## 17. Product Risks

## 17.1 Overlap with existing Bitget security controls

Risk:

```text
TraceGuard may appear to duplicate permission controls, read-only mode, confirmations, sub-account isolation, or fund limits.
```

Response:

```text
Position TraceGuard as a developer runtime for policy versioning, trace reconstruction, replay, diff, manifest review, and audit evidence.
Do not claim that Bitget lacks baseline security.
```

## 17.2 Becoming a generic dashboard

Risk:

```text
The product becomes a collection of log pages.
```

Response:

```text
Every page must support one of four verbs:
Control
Approve
Replay
Investigate
```

## 17.3 Too much friction

Risk:

```text
Users stop using TraceGuard because every action requires approval.
```

Response:

```text
Use modes, templates, thresholds, and one-time approvals.
Do not interrupt read-only analysis.
```

## 17.4 Unsupported live-execution assumptions

Risk:

```text
The initial story depends on an execution capability that is unavailable or unsafe.
```

Response:

```text
Use real market-data calls and simulated execution as the default.
Treat live execution as an optional adapter capability.
```

## 17.5 Telegram becoming the entire product

Risk:

```text
Complex workflows become cramped and difficult to use.
```

Response:

```text
Keep Telegram focused on approvals, alerts, and deep links.
Use the Web Control Plane for investigation and configuration.
```

------

## 18. Open Questions

### Product

- Should the first target be individual developers or small teams?
- Which approval actions are useful without becoming annoying?
- Which policy templates create the fastest first value moment?
- Should natural-language policy drafting appear in the first public release?
- Which trace fields are meaningful to a non-technical account owner?

### Bitget integration

- Which Agent Hub write operations are reliable in the hackathon environment?
- Which capabilities should remain simulated in the initial release?
- Can the submission safely demonstrate a trade-like action without live capital?
- Which Bitget tool metadata is stable enough to fingerprint?
- Can the Tool Inventory classify write operations automatically?

### Telegram

- Should the first Telegram release be a Bot-only approval flow?
- Which Mini App views are necessary beyond pending approvals and recent blocks?
- Should Telegram binding be optional during onboarding?

### Long-term product

- Should policy authoring remain TraceGuard-specific or migrate toward a general policy language?
- Which provider adapters are worth adding after Bitget?
- Should signed receipts or external proof anchoring become a separate module?
- Which evidence bundle should be exportable for audits or incident reports?

------

## 19. Product Principles

1. **Do not force users to abandon their existing agent workflow.**
2. **Separate proposal, authorization, and execution.**
3. **Default to safe behavior.**
4. **Use deterministic policies for authorization.**
5. **Treat agent explanations as evidence, not authority.**
6. **Show simple explanations first and technical detail on demand.**
7. **Use Telegram for timely decisions, not complex administration.**
8. **Use the web for configuration, replay, and investigation.**
9. **Integrate deeply with Bitget without hard-coding the entire architecture to one provider.**
10. **Build a product that remains useful after the hackathon.**

------

## 20. Final Product Statement

```text
TraceGuard is a Bitget-first safety runtime for trading agents.

It allows developers to keep their existing AI workflow while adding governed tool access, policy checks, one-time approvals, replayable decision traces, and auditable evidence.

The product begins with Bitget Agent Hub and grows into a provider-neutral control layer for operating trading agents safely.
```