"use client";

import useSWR from "swr";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp, TrendingDown, Server, Bot, Newspaper } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const SERVICE_COLORS: Record<string, string> = {
  claude_haiku: "hsl(210, 70%, 55%)",
  claude_sonnet: "hsl(280, 70%, 55%)",
  cryptopanic: "hsl(30, 70%, 55%)",
};

const SERVICE_ICONS: Record<string, typeof Bot> = {
  claude_haiku: Bot,
  claude_sonnet: Bot,
  cryptopanic: Newspaper,
};

export default function CostsPage() {
  const { data } = useSWR("costs", () => api.getCosts(), { refreshInterval: 60000 });

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading costs...</p>
      </div>
    );
  }

  const isNetPositive = data.net_pnl >= 0;

  // Pie chart data
  const pieData = data.by_service.map((s) => ({
    name: s.service,
    value: s.total_cost,
  }));
  pieData.push({ name: "VPS (daily)", value: data.vps_daily });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <DollarSign className="w-6 h-6" />
        Costs & Profitability
      </h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Trading PnL</CardTitle>
            {data.trading_pnl >= 0 ? (
              <TrendingUp className="w-4 h-4 text-green-400" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-400" />
            )}
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold font-mono ${data.trading_pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
              {data.trading_pnl >= 0 ? "+" : ""}${data.trading_pnl.toFixed(4)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">API Costs</CardTitle>
            <Bot className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono text-red-400">
              -${data.total_api_cost.toFixed(4)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">VPS (monthly)</CardTitle>
            <Server className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono">
              ${data.vps_monthly.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">
              ${data.vps_daily.toFixed(2)}/day
            </p>
          </CardContent>
        </Card>

        <Card className={isNetPositive ? "border-green-500/30" : "border-red-500/30"}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Net PnL</CardTitle>
            {isNetPositive ? (
              <TrendingUp className="w-4 h-4 text-green-400" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-400" />
            )}
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold font-mono ${isNetPositive ? "text-green-400" : "text-red-400"}`}>
              {isNetPositive ? "+" : ""}${data.net_pnl.toFixed(4)}
            </p>
            <p className="text-xs text-muted-foreground">After all costs</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Cost Breakdown Pie */}
        <Card>
          <CardHeader>
            <CardTitle>Cost Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {pieData.length > 0 && pieData.some(d => d.value > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, value }) => `${name}: $${value.toFixed(3)}`}
                  >
                    {pieData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={SERVICE_COLORS[entry.name] || `hsl(${index * 90}, 50%, 50%)`}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value) => [`$${Number(value).toFixed(4)}`, "Cost"]}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center pt-8">No cost data yet</p>
            )}
          </CardContent>
        </Card>

        {/* Service Details */}
        <Card>
          <CardHeader>
            <CardTitle>Cost by Service</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.by_service.map((service) => {
                const Icon = SERVICE_ICONS[service.service] || DollarSign;
                return (
                  <div key={service.service} className="p-3 rounded-lg bg-accent/50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4" />
                        <span className="font-medium">{service.service}</span>
                      </div>
                      <span className="font-mono font-medium">${service.total_cost.toFixed(4)}</span>
                    </div>
                    <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                      <span>{service.call_count} calls</span>
                      <span>{(service.total_tokens_in / 1000).toFixed(1)}K tokens in</span>
                      <span>{(service.total_tokens_out / 1000).toFixed(1)}K tokens out</span>
                    </div>
                  </div>
                );
              })}

              <div className="p-3 rounded-lg bg-accent/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4" />
                    <span className="font-medium">VPS (DigitalOcean)</span>
                  </div>
                  <span className="font-mono font-medium">${data.vps_monthly.toFixed(2)}/mo</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  2 vCPU, 4GB RAM, 48GB SSD
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent API Calls */}
      <Card>
        <CardHeader>
          <CardTitle>Recent API Calls</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recent_costs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No API calls recorded yet
                  </TableCell>
                </TableRow>
              ) : (
                data.recent_costs.slice(0, 30).map((cost) => (
                  <TableRow key={cost.id}>
                    <TableCell className="text-sm">
                      {new Date(cost.created_at).toLocaleTimeString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{cost.service}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{cost.purpose}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {cost.tokens_in + cost.tokens_out > 0
                        ? `${cost.tokens_in}/${cost.tokens_out}`
                        : "-"
                      }
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      ${cost.cost_usd.toFixed(6)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
