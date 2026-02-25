"use client";

import { useStatus } from "@/hooks/use-agents";
import { Badge } from "@/components/ui/badge";
import { Wallet, TrendingUp, TrendingDown, Activity, ShieldAlert, Clock } from "lucide-react";

export function Header() {
  const { data: status } = useStatus();

  const pnl = status?.total_pnl ?? 0;
  const pnlPct = status?.total_pnl_pct ?? 0;
  const isProfit = pnl >= 0;

  return (
    <header className="h-14 border-b border-border bg-card flex items-center px-6 gap-6 sticky top-0 z-10">
      <div className="flex items-center gap-2 text-sm">
        <Wallet className="w-4 h-4 text-green-400" />
        <span className="text-muted-foreground">Equity:</span>
        <span className="font-mono font-medium">
          ${(status?.total_equity ?? 0).toFixed(2)}
        </span>
      </div>

      <div className="flex items-center gap-2 text-sm">
        {isProfit ? (
          <TrendingUp className="w-4 h-4 text-green-400" />
        ) : (
          <TrendingDown className="w-4 h-4 text-red-400" />
        )}
        <span className="text-muted-foreground">PnL:</span>
        <span className={`font-mono font-medium ${isProfit ? "text-green-400" : "text-red-400"}`}>
          {isProfit ? "+" : ""}${pnl.toFixed(2)} ({pnlPct.toFixed(2)}%)
        </span>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <Activity className="w-4 h-4 text-blue-400" />
        <span className="text-muted-foreground">Positions:</span>
        <Badge variant="secondary" className="bg-blue-500/20 text-blue-400">
          {status?.open_positions ?? 0}
        </Badge>
      </div>

      {status?.circuit_breaker?.active && (
        <div className="flex items-center gap-2 text-sm">
          <ShieldAlert className="w-4 h-4 text-red-400" />
          <Badge variant="secondary" className="bg-red-500/20 text-red-400">
            Circuit Breaker Active
          </Badge>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2 text-sm">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <span className="text-muted-foreground font-mono">
          {status?.mode === "paper" ? "PAPER" : "LIVE"} | {status?.market_regime ?? "..."}
        </span>
        <Badge
          variant="secondary"
          className={status?.ws_connected ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}
        >
          {status?.ws_connected ? "Connected" : "Disconnected"}
        </Badge>
      </div>
    </header>
  );
}
