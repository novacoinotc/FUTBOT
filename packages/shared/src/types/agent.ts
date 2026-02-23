export type AgentStatus = "alive" | "dead" | "pending";

export interface Agent {
  id: string;
  parentId: string | null;
  generation: number;
  name: string;
  systemPrompt: string;
  strategy: string | null;
  walletBalance: string;
  status: AgentStatus;
  bornAt: string;
  diesAt: string;
  lastThoughtAt: string | null;
  metadata: Record<string, unknown>;
}

export interface AgentWithRelations extends Agent {
  parent?: Agent | null;
  children?: Agent[];
  pendingRequests?: number;
}
