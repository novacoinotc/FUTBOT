export type LogLevel = "thought" | "info" | "warn" | "error";

export interface AgentLog {
  id: string;
  agentId: string;
  level: LogLevel;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
