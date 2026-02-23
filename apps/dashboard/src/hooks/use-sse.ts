"use client";

import { useEffect, useState, useRef, useCallback } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface LiveEvent {
  id: string;
  type: string;
  agentId?: string;
  name?: string;
  status: string;
  message: string;
  thought?: string;
  requestType?: string;
  timestamp: string;
}

export function useSSE() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const counterRef = useRef(0);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`${API_URL}/api/events`);
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      // Reconnect after 5 seconds
      setTimeout(connect, 5000);
    };

    es.addEventListener("agent_activity", (e) => {
      const data = JSON.parse(e.data);
      counterRef.current += 1;
      setEvents((prev) => [
        {
          id: `evt-${counterRef.current}`,
          type: "agent_activity",
          agentId: data.agentId,
          name: data.name,
          status: data.status,
          message: data.message,
          thought: data.thought,
          requestType: data.requestType,
          timestamp: data.timestamp,
        },
        ...prev.slice(0, 49), // Keep last 50 events
      ]);
    });

    es.addEventListener("engine_status", (e) => {
      const data = JSON.parse(e.data);
      counterRef.current += 1;
      setEvents((prev) => [
        {
          id: `evt-${counterRef.current}`,
          type: "engine_status",
          status: data.status,
          message: data.message,
          timestamp: data.timestamp,
        },
        ...prev.slice(0, 49),
      ]);
    });
  }, []);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);

  return { events, connected };
}
