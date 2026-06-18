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
