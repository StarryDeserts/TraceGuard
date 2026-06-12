import type { RawUpstreamTool } from "@traceguard/schemas";

function obj(properties: Record<string, unknown>): { type: "object"; properties: Record<string, unknown> } {
  return { type: "object", properties };
}

const str = { type: "string" } as const;
const num = { type: "number" } as const;

export const bitget36RawTools: RawUpstreamTool[] = [
  // public_read (13)
  { name: "spot_get_ticker", inputSchema: obj({ symbol: str }) },
  { name: "spot_get_depth", inputSchema: obj({ symbol: str, limit: num }) },
  { name: "spot_get_candles", inputSchema: obj({ symbol: str, granularity: str }) },
  { name: "spot_get_trades", inputSchema: obj({ symbol: str, limit: num }) },
  { name: "spot_get_symbols", inputSchema: obj({}) },
  { name: "futures_get_ticker", inputSchema: obj({ symbol: str, productType: str }) },
  { name: "futures_get_depth", inputSchema: obj({ symbol: str, productType: str, limit: num }) },
  { name: "futures_get_candles", inputSchema: obj({ symbol: str, productType: str, granularity: str }) },
  { name: "futures_get_trades", inputSchema: obj({ symbol: str, productType: str }) },
  { name: "futures_get_contracts", inputSchema: obj({ productType: str }) },
  { name: "futures_get_funding_rate", inputSchema: obj({ symbol: str, productType: str }) },
  { name: "futures_get_open_interest", inputSchema: obj({ symbol: str, productType: str }) },
  { name: "system_get_capabilities", inputSchema: obj({}) },
  // account_read (10) — non-sensitive inputs only (refinement #4)
  { name: "spot_get_orders", inputSchema: obj({ symbol: str, status: str }) },
  { name: "spot_get_fills", inputSchema: obj({ symbol: str, orderId: str }) },
  { name: "spot_get_plan_orders", inputSchema: obj({ symbol: str }) },
  { name: "futures_get_orders", inputSchema: obj({ symbol: str, productType: str, status: str }) },
  { name: "futures_get_fills", inputSchema: obj({ symbol: str, productType: str }) },
  { name: "futures_get_positions", inputSchema: obj({ productType: str, symbol: str }) },
  { name: "get_account_assets", inputSchema: obj({}) },
  { name: "get_account_bills", inputSchema: obj({ coin: str }) },
  { name: "get_transaction_records", inputSchema: obj({ coin: str }) },
  { name: "get_deposit_address", inputSchema: obj({ coin: str }) },
  // trade_like (9) — plain trade schemas, no sensitive fields
  { name: "spot_place_order", inputSchema: obj({ symbol: str, side: str, orderType: str, size: str, price: str }) },
  { name: "spot_cancel_orders", inputSchema: obj({ symbol: str, orderId: str }) },
  { name: "spot_modify_order", inputSchema: obj({ symbol: str, orderId: str, newSize: str, newPrice: str }) },
  { name: "spot_place_plan_order", inputSchema: obj({ symbol: str, side: str, triggerPrice: str, size: str }) },
  { name: "spot_cancel_plan_orders", inputSchema: obj({ symbol: str, orderId: str }) },
  { name: "futures_place_order", inputSchema: obj({ symbol: str, productType: str, side: str, orderType: str, size: str, price: str }) },
  { name: "futures_cancel_orders", inputSchema: obj({ symbol: str, productType: str, orderId: str }) },
  { name: "futures_set_leverage", inputSchema: obj({ symbol: str, productType: str, marginCoin: str, leverage: str }) },
  { name: "futures_update_config", inputSchema: obj({ symbol: str, productType: str, marginMode: str }) },
  // asset_movement (3) — withdraw carries sensitive fields; stays asset_movement under join
  { name: "transfer", inputSchema: obj({ fromAccountType: str, toAccountType: str, coin: str, amount: str }) },
  { name: "withdraw", inputSchema: obj({ coin: str, amount: str, withdrawAddress: str, chain: str }) },
  { name: "cancel_withdrawal", inputSchema: obj({ orderId: str }) },
  // administrative (1) — apiKeyPermissions keeps it administrative under join
  { name: "manage_subaccounts", inputSchema: obj({ action: str, apiKeyPermissions: { type: "array", items: str } }) },
];
