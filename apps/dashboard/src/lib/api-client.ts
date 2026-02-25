const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || `API error: ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Status
  getStatus: () => apiFetch<BotStatus>("/api/status"),

  // Positions
  getPositions: () => apiFetch<PositionsResponse>("/api/positions"),

  // Trades
  getTrades: (params?: { pair?: string; status?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))
    ).toString();
    return apiFetch<TradesResponse>(`/api/trades${query ? `?${query}` : ""}`);
  },
  getTrade: (id: string) => apiFetch<TradeDetailResponse>(`/api/trades/${id}`),

  // Memory
  getMemory: (limit?: number) =>
    apiFetch<MemoryResponse>(`/api/memory${limit ? `?limit=${limit}` : ""}`),

  // Analytics
  getAnalytics: () => apiFetch<AnalyticsResponse>("/api/analytics"),

  // Params
  getParams: () => apiFetch<ParamsResponse>("/api/params"),

  // Costs
  getCosts: (since?: string) =>
    apiFetch<CostsResponse>(`/api/costs${since ? `?since=${since}` : ""}`),

  // Market
  getMarket: () => apiFetch<MarketResponse>("/api/market"),
};

// --- Types ---

export interface BotStatus {
  running: boolean;
  mode: "paper" | "live";
  started_at: string | null;
  uptime_minutes: number;
  pairs: string[];
  active_pairs: string[];
  analysis_cycles: number;
  market_regime: string;
  circuit_breaker: {
    active: boolean;
    reason: string;
    full_stop: boolean;
    stopped_for_day: boolean;
    paused_until: string | null;
    daily_start_equity: number;
    initial_equity: number;
  };
  ws_connected: boolean;
  last_deep_analysis: string | null;
  last_optimization: string | null;
  balance: number;
  total_equity: number;
  margin_used: number;
  free_margin: number;
  unrealized_pnl: number;
  open_positions: number;
  drawdown_pct: number;
  initial_balance: number;
  total_pnl: number;
  total_pnl_pct: number;
}

export interface Position {
  id: string;
  pair: string;
  direction: "LONG" | "SHORT";
  entry_price: number;
  current_price: number;
  quantity: number;
  leverage: number;
  margin_used: number;
  unrealized_pnl: number;
  stop_loss: number;
  take_profit: number;
  hold_time_minutes: number;
  opened_at: string;
}

export interface PositionsResponse {
  positions: Position[];
  balance: number;
  total_equity: number;
  margin_used: number;
  free_margin: number;
  unrealized_pnl: number;
  open_positions: number;
  drawdown_pct: number;
  initial_balance: number;
  total_pnl: number;
  total_pnl_pct: number;
}

export interface Trade {
  id: string;
  pair: string;
  direction: string;
  entry_price: number;
  exit_price: number | null;
  quantity: number;
  leverage: number;
  pnl: number;
  pnl_pct: number;
  entry_fee: number;
  exit_fee: number;
  margin_used: number;
  hold_time_minutes: number;
  opened_at: string;
  closed_at: string | null;
  entry_reasoning: string;
  exit_reasoning: string;
  entry_indicators: string;
  exit_indicators: string;
  market_regime: string;
  sentiment_score: number | null;
  status: "open" | "closed";
}

export interface TradesResponse {
  trades: Trade[];
  total: number;
  limit: number;
  offset: number;
}

export interface TradeDetailResponse {
  trade: Trade;
  memory: TradeMemory | null;
}

export interface TradeMemory {
  id: number;
  trade_id: string;
  pair: string;
  direction: string;
  pnl: number;
  pnl_pct: number;
  leverage: number;
  hold_time_minutes: number;
  market_regime: string;
  indicators_at_entry: Record<string, number>;
  sentiment_score: number | null;
  claude_reasoning: string;
  lesson_learned: string;
  tags: string[];
  created_at: string;
}

export interface MemoryResponse {
  memories: TradeMemory[];
  rules: LearnedRule[];
  stats: {
    total_memories: number;
    memories_with_lessons: number;
    winning_trades: number;
    losing_trades: number;
    active_rules: number;
    top_rules: { rule: string; confidence: number }[];
  };
}

export interface LearnedRule {
  id: number;
  rule: string;
  source_trades: string;
  confidence: number;
  times_applied: number;
  times_successful: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface AnalyticsResponse {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: number;
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
  pnl_by_pair: Record<string, { pnl: number; trades: number; wins: number }>;
  pnl_by_hour: Record<string, number>;
  daily_stats: DailyStat[];
}

export interface DailyStat {
  date: string;
  starting_balance: number;
  ending_balance: number;
  pnl_gross: number;
  pnl_net: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  total_fees: number;
  total_api_costs: number;
  max_drawdown_pct: number;
  best_trade_pnl: number;
  worst_trade_pnl: number;
  avg_hold_time_minutes: number;
  sharpe_ratio: number | null;
}

export interface ParamsResponse {
  current: Record<string, number>;
  history: ParamChange[];
}

export interface ParamChange {
  id: number;
  param_name: string;
  old_value: number;
  new_value: number;
  reasoning: string;
  performance_before: string;
  performance_after: string;
  reverted: number;
  created_at: string;
}

export interface CostsResponse {
  total_api_cost: number;
  by_service: {
    service: string;
    total_cost: number;
    total_tokens_in: number;
    total_tokens_out: number;
    call_count: number;
  }[];
  vps_monthly: number;
  vps_daily: number;
  trading_pnl: number;
  net_pnl: number;
  recent_costs: {
    id: number;
    service: string;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    purpose: string;
    created_at: string;
  }[];
}

export interface MarketResponse {
  snapshots: Record<string, MarketSnapshot>;
  summary: {
    total_pairs: number;
    bullish_pairs: number;
    bearish_pairs: number;
    neutral_pairs: number;
    fear_greed: number | null;
    timestamp: string;
  };
}

export interface MarketSnapshot {
  pair: string;
  price: number;
  change_1m: number;
  change_5m: number;
  change_1h: number;
  rsi_7?: number;
  rsi_14?: number;
  ema_9?: number;
  ema_21?: number;
  ema_50?: number;
  bb_upper?: number;
  bb_lower?: number;
  bb_pct?: number;
  macd_hist?: number;
  macd_signal?: string;
  vwap?: number;
  price_vs_vwap?: string;
  atr_14?: number;
  volume_delta_5m?: number;
  book_imbalance?: number;
  funding_rate?: number;
  sentiment?: { score: number; recent_news: string };
  fear_greed?: number;
  timestamp: string;
}
