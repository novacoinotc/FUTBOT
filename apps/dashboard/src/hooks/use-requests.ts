"use client";

import useSWR from "swr";
import { api } from "@/lib/api-client";

export function useRequests(params?: {
  status?: string;
  type?: string;
  agent_id?: string;
}) {
  const key = params
    ? `requests-${JSON.stringify(params)}`
    : "requests";

  return useSWR(key, () => api.getRequests(params), {
    refreshInterval: 5000,
  });
}
