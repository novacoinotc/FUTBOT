export type RequestType =
  | "replicate"
  | "trade"
  | "spend"
  | "communicate"
  | "strategy_change"
  | "custom";

export type RequestStatus = "pending" | "approved" | "denied";
export type RequestPriority = "low" | "medium" | "high" | "critical";

export interface AgentRequest {
  id: string;
  agentId: string;
  type: RequestType;
  title: string;
  description: string;
  payload: Record<string, unknown>;
  status: RequestStatus;
  priority: RequestPriority;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface AgentRequestWithAgent extends AgentRequest {
  agentName?: string;
  agentGeneration?: number;
}
