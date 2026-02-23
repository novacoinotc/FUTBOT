export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface DashboardStats {
  totalAgents: number;
  aliveAgents: number;
  deadAgents: number;
  pendingAgents: number;
  totalEcosystemBalance: string;
  pendingRequestsCount: number;
  agentsByGeneration: Record<number, number>;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}
