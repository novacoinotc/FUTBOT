import useSWR from "swr";
import { api, BotStatus, PositionsResponse } from "@/lib/api-client";

export function useStatus() {
  return useSWR<BotStatus>("status", () => api.getStatus(), { refreshInterval: 5000 });
}

export function usePositions() {
  return useSWR<PositionsResponse>("positions", () => api.getPositions(), { refreshInterval: 5000 });
}

// Keep old name for compatibility with Header
export function useStats() {
  return useStatus();
}
