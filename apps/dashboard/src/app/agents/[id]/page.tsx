"use client";

import { use } from "react";
import { useAgent } from "@/hooks/use-agents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import {
  Bot,
  Clock,
  DollarSign,
  GitBranch,
  Skull,
  Brain,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

function getTimeRemaining(diesAt: string): string {
  const diff = new Date(diesAt).getTime() - Date.now();
  if (diff <= 0) return "EXPIRED";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${days}d ${hours}h ${mins}m`;
}

export default function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: agent, mutate } = useAgent(id);

  if (!agent) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading agent...
      </div>
    );
  }

  const apiBudget = Number(agent.apiBudget);
  const cryptoBalance = Number(agent.cryptoBalance);

  const handleKill = async () => {
    if (!confirm(`Kill agent ${agent.name}?`)) return;
    try {
      await api.killAgent(agent.id);
      toast.success(`Agent ${agent.name} terminated`);
      mutate();
    } catch {
      toast.error("Failed to kill agent");
    }
  };

  const handleAddIncome = async () => {
    const amount = prompt("Amount to add (USDT):");
    if (!amount) return;
    const desc = prompt("Description:") || "Manual income from Controller";
    try {
      await api.addIncome({
        agentId: agent.id,
        amount: Number(amount),
        description: desc,
      });
      toast.success(`Added $${amount} to ${agent.name}`);
      mutate();
    } catch {
      toast.error("Failed to add income");
    }
  };

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to overview
      </Link>

      {/* Agent Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {agent.name}
              <Badge
                variant="outline"
                className={
                  agent.status === "alive"
                    ? "bg-green-500/20 text-green-400"
                    : "bg-red-500/20 text-red-400"
                }
              >
                {agent.status}
              </Badge>
            </h1>
            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
              <span className="flex items-center gap-1">
                <GitBranch className="w-3 h-3" />
                Generation {agent.generation}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {getTimeRemaining(agent.diesAt)}
              </span>
              <span className="flex items-center gap-1 font-mono text-blue-400">
                API: ${apiBudget.toFixed(4)}
              </span>
              <span
                className={`flex items-center gap-1 font-mono ${
                  cryptoBalance <= 0
                    ? "text-red-400"
                    : cryptoBalance < 2
                      ? "text-yellow-400"
                      : "text-green-400"
                }`}
              >
                <DollarSign className="w-3 h-3" />
                {cryptoBalance.toFixed(4)} USDT
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleAddIncome}>
            <DollarSign className="w-4 h-4 mr-1" />
            Add Income
          </Button>
          {agent.status === "alive" && (
            <Button variant="destructive" size="sm" onClick={handleKill}>
              <Skull className="w-4 h-4 mr-1" />
              Kill
            </Button>
          )}
        </div>
      </div>

      {/* Solana Wallet */}
      {agent.solanaAddress && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              Solana Wallet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-mono break-all">{agent.solanaAddress}</p>
          </CardContent>
        </Card>
      )}

      {/* Strategy */}
      {agent.strategy && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="w-4 h-4" />
              Current Strategy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{agent.strategy}</p>
          </CardContent>
        </Card>
      )}

      {/* Family */}
      <div className="grid grid-cols-2 gap-4">
        {agent.parent && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Parent</CardTitle>
            </CardHeader>
            <CardContent>
              <Link
                href={`/agents/${agent.parent.id}`}
                className="text-sm hover:underline"
              >
                {agent.parent.name} (Gen {agent.parent.generation})
              </Link>
            </CardContent>
          </Card>
        )}
        {agent.children && agent.children.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Children ({agent.children.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {agent.children.map((child) => (
                <Link
                  key={child.id}
                  href={`/agents/${child.id}`}
                  className="block text-sm hover:underline"
                >
                  {child.name} ({child.status}, {Number(child.cryptoBalance).toFixed(2)} USDT)
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="requests">Requests</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline">
          <ScrollArea className="h-[500px]">
            <div className="space-y-3">
              {agent.recentLogs?.map((log) => (
                <Card key={log.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        variant="outline"
                        className={
                          log.level === "thought"
                            ? "bg-purple-500/20 text-purple-400"
                            : log.level === "error"
                              ? "bg-red-500/20 text-red-400"
                              : "bg-blue-500/20 text-blue-400"
                        }
                      >
                        {log.level}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{log.message}</p>
                  </CardContent>
                </Card>
              ))}
              {(!agent.recentLogs || agent.recentLogs.length === 0) && (
                <p className="text-center py-8 text-muted-foreground">
                  No logs yet
                </p>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="transactions">
          <ScrollArea className="h-[500px]">
            <div className="space-y-2">
              {agent.recentTransactions?.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between py-2 px-3 rounded bg-card border"
                >
                  <div>
                    <p className="text-sm">{tx.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(tx.createdAt).toLocaleString()} | {tx.type}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`font-mono text-sm ${
                        Number(tx.amount) >= 0
                          ? "text-green-400"
                          : "text-red-400"
                      }`}
                    >
                      {Number(tx.amount) >= 0 ? "+" : ""}
                      {Number(tx.amount).toFixed(6)}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">
                      Balance: {Number(tx.balanceAfter).toFixed(6)}
                    </p>
                  </div>
                </div>
              ))}
              {(!agent.recentTransactions ||
                agent.recentTransactions.length === 0) && (
                <p className="text-center py-8 text-muted-foreground">
                  No transactions yet
                </p>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="requests">
          <ScrollArea className="h-[500px]">
            <div className="space-y-2">
              {agent.requests?.map((req) => (
                <Card key={req.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{req.type}</Badge>
                        <span className="text-sm font-medium">
                          {req.title}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          req.status === "approved"
                            ? "bg-green-500/20 text-green-400"
                            : req.status === "denied"
                              ? "bg-red-500/20 text-red-400"
                              : "bg-yellow-500/20 text-yellow-400"
                        }
                      >
                        {req.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {req.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
              {(!agent.requests || agent.requests.length === 0) && (
                <p className="text-center py-8 text-muted-foreground">
                  No requests yet
                </p>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
