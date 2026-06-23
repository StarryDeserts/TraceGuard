# TraceGuard 提交描述（中文）

> 本文是面向 Bitget AI Base Camp S1 提交表单的中文项目描述，分为四部分，
> 分别对应评审的四个维度（论点深度 / 可运行性 / 完整度 / 创新性）。
> 仓库其余文档为英文（面向评审）；本文为中文提交副本。
> 英文对应内容见 [README.md](../README.md) 与 [demo-script.md](demo-script.md)。

## 一、项目简介与要解决的问题（论点）

**TraceGuard 是面向 Bitget Agent Hub 上 AI 交易 Agent 的 fail-closed（失败即关闭）安全运行时。** 参赛赛道：Trading Infrastructure（交易基础设施）。

Bitget Agent Hub 让 AI Agent 能通过 MCP 直接触达真实的交易工具。但**一旦 Agent 能够行动，一次幻觉式的工具调用就可能下出你从未想要的单**。现有方案要么是“只读模式”（粒度太粗、没有真正的交易治理），要么是直接放权（没有任何护栏）。

TraceGuard 坐在 Agent 与交易工具之间，把“下单”变成**结构上不可能**的操作——除非三件事同时成立：

1. 策略（policy）已通过；
2. 人类**针对那一笔确切的动作**做出了批准；
3. 该授权此前**尚未被花费**（单次使用）。

并且它把整条信任链记录为可重放的审计账本，让你能回溯“为什么”。一句话论点：**它治理的是 Agent 被允许如何使用交易工具，而不是决定交易什么**——这是一层运行时基础设施，不是交易策略、也不是又一个交易机器人。

## 二、技术实现与架构（完整度）

TraceGuard 把 `bitget-mcp-server` 包装为一个 **MCP 网关**，在工具真正可被调用之前完成治理：

- **清单指纹 + 风险分类**：导入上游工具清单并做哈希指纹，按 6 个风险类（`public_read` / `account_read` / `trade_like` / `asset_movement` / `administrative` / `unknown→冻结`）分类。资产转移类（`withdraw`、`transfer`、`cancel_withdrawal`、`get_deposit_address`）与管理类（`manage_subaccounts`）**默认即被阻断**。
- **Decision Envelope（决策信封）**：任何 trade-like 调用必须携带结构化的决策信封，裸调用直接被拒（`DECISION_ENVELOPE_REQUIRED`）。
- **单次授权 + burn-before-execute（先销毁后执行）**：人类批准后签发的授权是单次使用的，并在**执行结果返回之前就被消费**，因此即便上游不可确认，也没有可复用的授权残留可供重试。
- **fail-closed 执行**：实盘执行走能力门控的 `bitget_live` 适配器；上游报错即 `RunFailed`，绝不静默重试。
- **哈希链审计账本**：每个事件都带 `payloadHash` 与 `previousEventHash`，前后相连、防篡改、可确定性重放。

对外暴露六个受治理的生命周期工具：`start_run → record_decision → request_execution → check_approval → execute_authorized_action → finish_run`。核心账本与策略引擎是 provider 无关的，Bitget 是第一个集成。技术栈：TypeScript（Node ≥ 22.12）、pnpm workspace、vitest，严格 TDD。

## 三、可运行性与 Paper-Trading 证据（可运行性）

可运行性是评审的关键轴，TraceGuard 在 `live > paper > backtest > concept` 这把尺子上落在 **paper-trading 实证**这一档——而且开箱即跑，两条命令即可独立复现：

| 命令 | 网络 | 在屏幕上证明了什么 |
| ---- | ---- | ------------------ |
| `pnpm demo` | 离线 | 从只追加账本重放一次受治理的运行，打印脱敏后的完整 transcript（批准→模拟回执 / 拒绝→什么都没发出）。一条绿色 golden 测试证明 transcript 是运行时**生成**的，而非静态文件。 |
| `pnpm demo:live` | 在线 | 在**真实**的 `bitget-mcp-server --paper-trading` 前启动网关：指纹化实时清单、阻断资产转移类工具、放行一次**真实的 BTCUSDT ticker**、拒绝无信封的裸下单、对超策略决策 `POLICY_BLOCKED`。**仅用公开行情数据——无 API key、无私有端点、无资金。** |

**已附可验证证据**（已随仓库提交）：[`docs/superpowers/demo/live-paper-trading-evidence.md`](superpowers/demo/live-paper-trading-evidence.md) 配两份原始哈希链事件日志（[`live-events-happy.json`](superpowers/demo/live-events-happy.json) 18 个事件 / [`live-events-denied.json`](superpowers/demo/live-events-denied.json) 15 个事件）。实测实时清单为 **36 个工具 → 31 active / 5 blocked / 0 frozen**，清单哈希 `3a2999ec…`。审稿人可自行重放并逐字节比对。

## 四、创新点与诚实自评（创新性 + 完整度）

**创新点**：把交易安全做成一层**可重放的运行时**，而不是又一个策略/机器人。具体新颖之处包括——清单指纹 + 风险分级的默认阻断、强制 Decision Envelope、**burn-before-execute** 的单次授权语义、**结构上 fail-closed** 的执行路径、以及一条可确定性重放的哈希链审计账本。这些组合让“Agent 能不能下这一单”从一个运行期的偶发问题，变成一个可治理、可审计、可复盘的工程契约。

**诚实自评（不夸大）**：

- **真实**：治理（清单指纹、策略评估、单次审批、burn-before-execute、fail-closed 执行）、哈希链账本与确定性重放、凭证/订单体脱敏、Bitget 公开行情数据（在 `pnpm demo:live` 中经 `bitget-mcp-server` 获取）均为真实。
- **默认模拟**：订单执行默认走 `simulator` 适配器并明确标注为 simulated，绝不动用真实资金。
- **不声称**：未获 Bitget 官方背书；默认不下真实实盘单。Bitget Agent Hub 自身文档说明上游订单执行尚未完全实现——因此实盘 happy path 当前以 `RunFailed`（fail-closed）收尾，而非成交回执。**这恰恰是 TraceGuard 在执行无法确认时被设计产出的安全结果，且公开披露、绝不隐藏。**

**未来规划**：补齐实盘成交回执路径（待上游可用）、扩展策略 DSL 与多 provider 适配器、把审计账本对接外部 SIEM/合规导出。最强的定位不是“我们又做了个 AI 交易助手”，而是——**随着在 Bitget Agent Hub 上构建交易 Agent 越来越容易，开发者需要一层让 Agent 行为受策略约束、经人类批准、fail-closed、可重放、可审计的安全运行时。TraceGuard 就是这层运行时。**
