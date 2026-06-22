import type { ExecutionAdapter, ExecutionRequest, ExecutionResult } from "@traceguard/domain";
import type { LedgerStore } from "@traceguard/event-ledger";
import type { DecisionProposedPayload } from "@traceguard/schemas";

export interface UpstreamCallResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: unknown;
}

export interface UpstreamCaller {
  callTool(name: string, args: Record<string, unknown>): Promise<UpstreamCallResult>;
}

const BUY_ACTIONS: ReadonlySet<string> = new Set(["buy", "open_long"]);
const SELL_ACTIONS: ReadonlySet<string> = new Set(["sell", "open_short", "reduce", "close"]);

export function buildSpotOrderArgs(decision: DecisionProposedPayload): Record<string, string> {
  const side = BUY_ACTIONS.has(decision.action)
    ? "buy"
    : SELL_ACTIONS.has(decision.action)
      ? "sell"
      : undefined;
  if (side === undefined) throw new Error(`unmappable_action:${decision.action}`);

  const size = decision.requestedQuantity ?? decision.requestedNotionalUsdt;
  if (size === undefined) throw new Error("missing_order_size");

  const orderType = decision.orderType ?? "market";
  const args: Record<string, string> = {
    symbol: decision.instrument,
    side,
    orderType,
    size,
  };
  if (orderType === "limit" && decision.limitPrice !== undefined) {
    args.price = decision.limitPrice;
  }
  return args;
}

export function parseOrderId(result: UpstreamCallResult): string | undefined {
  const sc = result.structuredContent;
  const candidate = sc?.orderId ?? sc?.order_id ?? sc?.orderID;
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  if (typeof candidate === "number") return String(candidate);
  return undefined;
}

const DEFAULT_TIMEOUT_MS = 10_000;

class TimeoutError extends Error {
  constructor() {
    super("upstream_timeout");
    this.name = "TimeoutError";
  }
}

function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

async function findDecisionProposed(
  store: LedgerStore,
  workspaceId: string,
  runId: string,
  decisionId: string,
): Promise<DecisionProposedPayload | undefined> {
  const events = await store.read(workspaceId, runId);
  const event = events.find((e) => e.eventType === "DecisionProposed" && e.aggregateId === decisionId);
  return event?.payload as DecisionProposedPayload | undefined;
}

export interface BitgetLiveAdapterDeps {
  store: LedgerStore;
  client: UpstreamCaller;
  workspaceId: string;
  hash: (input: string) => string;
  timeoutMs?: number;
}

export function createBitgetLiveAdapter(deps: BitgetLiveAdapterDeps): ExecutionAdapter {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    adapterType: "bitget_live",
    async call(request: ExecutionRequest): Promise<ExecutionResult> {
      // Recover the order intent from the rich DecisionProposed event (Option A):
      // the digest-centric ExecutionRequest never carries the order body.
      const decision = await findDecisionProposed(deps.store, deps.workspaceId, request.runId, request.decisionId);
      if (decision === undefined) {
        // runId/decisionId are internal identifiers (not credentials or order
        // bodies), safe to surface; nothing downstream parses this message.
        throw new Error(`decision_intent_not_found: runId=${request.runId} decisionId=${request.decisionId}`);
      }

      // Pre-submit mapping failures throw -> orchestrator -> RunFailed -> EXECUTION_FAILED.
      const args = buildSpotOrderArgs(decision);

      let result: UpstreamCallResult;
      try {
        result = await raceWithTimeout(deps.client.callTool("spot_place_order", args), timeoutMs);
      } catch (err) {
        // The order may already be live: never retry, surface for reconciliation.
        // We deliberately do NOT try to tell a pre-connection throw (e.g.
        // "called before open", nothing sent) apart from a genuine post-submit
        // connection loss — misjudging a real loss as pre-submit would fail open
        // on a live order. Over-flagging reconciliation is the safe direction.
        return err instanceof TimeoutError
          ? { kind: "unknown", reasonCode: "timeout_after_submit" }
          : { kind: "unknown", reasonCode: "connection_lost_after_submit" };
      }

      // An explicit error result is a clean pre-submit reject (nothing was placed).
      if (result.isError === true) throw new Error("upstream_rejected");

      const orderId = parseOrderId(result);
      // Submitted but we cannot read the receipt: post-submit ambiguity, not a retry.
      if (orderId === undefined) return { kind: "unknown", reasonCode: "receipt_lookup_failed" };

      return {
        kind: "completed",
        finalStatus: "submitted",
        receiptRef: `receipt:bitget:${orderId}`,
        receiptHash: deps.hash(`receipt:bitget:${orderId}:${request.requestHash}`),
        upstreamRef: orderId,
      };
    },
  };
}
