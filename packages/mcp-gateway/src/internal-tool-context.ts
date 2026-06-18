import type { LedgerStore } from "@traceguard/event-ledger";
import type { ReconcileDeps } from "@traceguard/tool-manifest"; // { clock, newId, hash }
import type { Policy, ExecutionAdapterType } from "@traceguard/schemas";
import type { ExecutionAdapter } from "@traceguard/domain";
import type { CallAudit } from "./tool-call-events.js";
import type { DecisionCache } from "./decision-cache.js";

export interface RunContext {
  runId: string;
  mode: string; // WorkspaceMode value; "safe_demo" for the demo
  agentName?: string;
  intent?: string;
}

export interface ApprovalTtls {
  approvalSeconds: number; // default 900
  authorizationSeconds: number; // default 900
}

export interface InternalToolContext {
  store: LedgerStore;
  deps: ReconcileDeps;
  audit: CallAudit; // { workspaceId, runId, providerConnectionId }
  policy: Policy;
  adapters: Partial<Record<ExecutionAdapterType, ExecutionAdapter>>; // simulator + bitget_live
  run: RunContext; // mutated in place by start_run (agentName/intent/mode)
  cache: DecisionCache;
  ttls: ApprovalTtls;
}
