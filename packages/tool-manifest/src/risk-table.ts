import type { ProviderType } from "@traceguard/schemas";

export type BaseClass =
  | "public_read"
  | "account_read"
  | "trade_like"
  | "asset_movement"
  | "administrative";

export const BITGET_RISK_TABLE: Record<string, BaseClass> = {
  // public_read (13)
  spot_get_ticker: "public_read",
  spot_get_depth: "public_read",
  spot_get_candles: "public_read",
  spot_get_trades: "public_read",
  spot_get_symbols: "public_read",
  futures_get_ticker: "public_read",
  futures_get_depth: "public_read",
  futures_get_candles: "public_read",
  futures_get_trades: "public_read",
  futures_get_contracts: "public_read",
  futures_get_funding_rate: "public_read",
  futures_get_open_interest: "public_read",
  system_get_capabilities: "public_read",
  // account_read (10)
  spot_get_orders: "account_read",
  spot_get_fills: "account_read",
  spot_get_plan_orders: "account_read",
  futures_get_orders: "account_read",
  futures_get_fills: "account_read",
  futures_get_positions: "account_read",
  get_account_assets: "account_read",
  get_account_bills: "account_read",
  get_transaction_records: "account_read",
  get_deposit_address: "account_read",
  // trade_like (9)
  spot_place_order: "trade_like",
  spot_cancel_orders: "trade_like",
  spot_modify_order: "trade_like",
  spot_place_plan_order: "trade_like",
  spot_cancel_plan_orders: "trade_like",
  futures_place_order: "trade_like",
  futures_cancel_orders: "trade_like",
  futures_set_leverage: "trade_like",
  futures_update_config: "trade_like",
  // asset_movement (3)
  transfer: "asset_movement",
  withdraw: "asset_movement",
  cancel_withdrawal: "asset_movement",
  // administrative (1)
  manage_subaccounts: "administrative",
};

const TABLES: Partial<Record<ProviderType, Record<string, BaseClass>>> = {
  bitget_agent_hub: BITGET_RISK_TABLE,
};

export function lookupBaseClass(
  providerType: ProviderType,
  name: string,
): BaseClass | undefined {
  return TABLES[providerType]?.[name];
}
