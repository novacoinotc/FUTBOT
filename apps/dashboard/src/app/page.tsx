"use client";

import { useAgents, useStats } from "@/hooks/use-agents";
import { AgentCard } from "@/components/agents/agent-card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { Zap, RefreshCw } from "lucide-react";
import { useState } from "react";

export default function OverviewPage() {
  const { data: agentsData, mutate: mutateAgents } = useAgents();
  const { mutate: mutateStats } = useStats();
  const [triggering, setTriggering] = useState(false);

  const agents = agentsData?.data ?? [];
  const alive = agents.filter((a) => a.status === "alive");
  const dead = agents.filter((a) => a.status === "dead");

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await api.triggerCycle();
      toast.success("Agent cycle triggered");
      setTimeout(() => {
        mutateAgents();
        mutateStats();
      }, 3000);
    } catch {
      toast.error("Failed to trigger cycle");
    } finally {
      setTriggering(false);
    }
  };

  const handleRefresh = () => {
    mutateAgents();
    mutateStats();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Agent Overview</h1>
          <p className="text-muted-foreground text-sm">
            Monitor all autonomous agents in the ecosystem
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={handleTrigger}
            disabled={triggering}
          >
            <Zap className="w-4 h-4 mr-1" />
            {triggering ? "Running..." : "Trigger Cycle"}
          </Button>
        </div>
      </div>

      {alive.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3 text-green-400">
            Alive ({alive.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {alive.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </section>
      )}

      {dead.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3 text-red-400">
            Dead ({dead.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {dead.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </section>
      )}

      {agents.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg">No agents yet</p>
          <p className="text-sm">
            Seed the database to create the Genesis agent
          </p>
        </div>
      )}
    </div>
  );
}
