// Shared API types — mirror the FastAPI Pydantic models in wealthguard_api.py.
// Keep this file in sync when backend models change.

export type AssetClass = 'equity' | 'bond' | 'etf' | 'mutual_fund' | 'crypto' | 'alternative' | string;
export type Currency = 'AUD' | 'USD' | 'JPY' | 'EUR' | 'GBP' | string;

export interface Holding {
  id: number;
  account_id: number;
  symbol: string;
  asset_name: string | null;
  shares: number;
  cost_basis_per_share: number | null;
  current_price: number | null;
  last_price_update: string | null;
  asset_class: AssetClass;
  sector: string | null;
  geography: string | null;
  target_allocation_percent: number | null;
  account_currency: Currency;
  native_currency: Currency | null;
  cost_basis_currency: Currency | null;
  value_usd: number;
  value_aud: number;
  cost_usd: number;
  cost_aud: number;
  // Legacy fields
  value_original: number;
  original_currency: Currency;
}

export interface Account {
  id: number;
  name: string;
  type: string | null;
  currency: Currency | null;
  institution: string | null;
  current_balance: number | null;
  current_balance_aud?: number;
  credit_limit?: number | null;
  apy?: number | null;
  opened_date?: string | null;
  is_active?: number | null;
}

export interface PortfolioSummary {
  total_value: number;
  total_cost: number;
  total_gain_loss: number;
  total_gain_loss_percent: number;
  total_value_aud?: number;
  total_value_usd?: number;
  total_cost_aud?: number;
  total_cost_usd?: number;
  holdings_count: number;
  last_updated: string | null;
}

export interface MarketQuote {
  symbol: string;
  name: string;
  price: number;
  price_aud: number | null;
  change: number;
  change_percent: number;
  currency: Currency;
  volume: number | null;
  sector: string;
  source: string;
}

export interface FxRate {
  from_currency: Currency;
  to_currency: Currency;
  rate: number;
  recorded_at: string;
  source?: string | null;
}

export interface NetWorthSnapshot {
  snapshot_date: string;
  net_worth: number;
  total_assets: number;
  total_liabilities: number;
}

export interface AlertRecord {
  id: number;
  symbol?: string;
  alert_type: string;
  severity: 'info' | 'warning' | 'critical' | string;
  message: string;
  current_price?: number | null;
  previous_price?: number | null;
  change_percent?: number | null;
  sent_at?: string;
  triggered_at?: string;
  acknowledged?: boolean;
}
