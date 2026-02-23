"use client";

import useSWR from "swr";
import { api } from "@/lib/api-client";

export function useAgents() {
  return useSWR("agents", () => api.getAgents(), {
    refreshInterval: 15000,
  });
}

export function useAgent(id: string) {
  return useSWR(id ? `agent-${id}` : null, () => api.getAgent(id), {
    refreshInterval: 10000,
  });
}

export function useStats() {
  return useSWR("stats", () => api.getStats(), {
    refreshInterval: 10000,
  });
}
