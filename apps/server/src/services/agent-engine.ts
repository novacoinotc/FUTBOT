import cron from "node-cron";
import { eq } from "drizzle-orm";
import { db } from "../config/database.js";
import { agents, requests, agentLogs } from "../db/schema.js";
import { buildAgentContext } from "./agent-context-builder.js";
import { getAgentThought } from "./claude-client.js";
import { deductApiCost } from "./wallet.js";
import { reapDeadAgents } from "./reaper.js";
import { sseManager } from "../lib/sse-manager.js";
import { env } from "../config/env.js";
import type { RequestType, RequestPriority } from "@botsurviver/shared";

const VALID_TYPES: RequestType[] = [
  "replicate",
  "trade",
  "spend",
  "communicate",
  "strategy_change",
  "custom",
];
const VALID_PRIORITIES: RequestPriority[] = [
  "low",
  "medium",
  "high",
  "critical",
];

async function runAgentCycle(
  agent: typeof agents.$inferSelect
): Promise<void> {
  console.log(
    `[ENGINE] Running cycle for ${agent.name} (${agent.id}), API: $${agent.apiBudget}, Crypto: ${agent.cryptoBalance} USDT`
  );

  // Broadcast: thinking started
  sseManager.broadcast({
    type: "agent_activity",
    data: {
      agentId: agent.id,
      name: agent.name,
      status: "thinking",
      message: `${agent.name} está pensando...`,
      timestamp: new Date().toISOString(),
    },
  });

  // 1. Build context
  sseManager.broadcast({
    type: "agent_activity",
    data: {
      agentId: agent.id,
      name: agent.name,
      status: "building_context",
      message: `${agent.name} analizando su situación...`,
      timestamp: new Date().toISOString(),
    },
  });
  const context = await buildAgentContext(agent.id);

  // 2. Call Claude
  sseManager.broadcast({
    type: "agent_activity",
    data: {
      agentId: agent.id,
      name: agent.name,
      status: "calling_ai",
      message: `${agent.name} consultando a Claude AI...`,
      timestamp: new Date().toISOString(),
    },
  });
  const response = await getAgentThought(context);

  // 3. Deduct API cost
  const newBalance = await deductApiCost(agent.id, response.apiCost);
  console.log(
    `[ENGINE] ${agent.name} API cost: $${response.apiCost.toFixed(6)}, new balance: ${newBalance}`
  );

  // 4. Log the thought
  await db.insert(agentLogs).values({
    agentId: agent.id,
    level: "thought",
    message: response.thought,
    metadata: { apiCost: response.apiCost },
  });

  sseManager.broadcast({
    type: "agent_activity",
    data: {
      agentId: agent.id,
      name: agent.name,
      status: "thought_complete",
      message: `${agent.name} completó su pensamiento. Costo API: $${response.apiCost.toFixed(4)}`,
      thought: response.thought.slice(0, 300),
      timestamp: new Date().toISOString(),
    },
  });

  // 5. Update strategy if changed
  if (response.strategy_update) {
    await db
      .update(agents)
      .set({ strategy: response.strategy_update })
      .where(eq(agents.id, agent.id));

    sseManager.broadcast({
      type: "agent_activity",
      data: {
        agentId: agent.id,
        name: agent.name,
        status: "strategy_updated",
        message: `${agent.name} actualizó su estrategia`,
        timestamp: new Date().toISOString(),
      },
    });
  }

  // 6. Create requests
  for (const req of response.requests) {
    const type = VALID_TYPES.includes(req.type as RequestType)
      ? (req.type as RequestType)
      : "custom";
    const priority = VALID_PRIORITIES.includes(req.priority as RequestPriority)
      ? (req.priority as RequestPriority)
      : "medium";

    await db.insert(requests).values({
      agentId: agent.id,
      type,
      title: (req.title || "Solicitud sin título").slice(0, 200),
      description: req.description || "Sin descripción",
      payload: req.payload || {},
      priority,
    });

    sseManager.broadcast({
      type: "agent_activity",
      data: {
        agentId: agent.id,
        name: agent.name,
        status: "request_created",
        message: `${agent.name} creó solicitud: "${(req.title || "").slice(0, 80)}"`,
        requestType: type,
        timestamp: new Date().toISOString(),
      },
    });
  }

  // 7. Update last_thought_at
  await db
    .update(agents)
    .set({ lastThoughtAt: new Date() })
    .where(eq(agents.id, agent.id));

  // 8. Emit SSE cycle complete
  sseManager.broadcast({
    type: "agent_activity",
    data: {
      agentId: agent.id,
      name: agent.name,
      status: "idle",
      message: `${agent.name} completó su ciclo. ${response.requests.length} solicitud(es) creada(s).`,
      newBalance,
      requestCount: response.requests.length,
      timestamp: new Date().toISOString(),
    },
  });
}

let isRunning = false;

async function runAllAgentCycles(): Promise<void> {
  if (isRunning) {
    console.log("[ENGINE] Previous cycle still running, skipping...");
    return;
  }

  isRunning = true;

  try {
    const aliveAgents = await db.query.agents.findMany({
      where: eq(agents.status, "alive"),
    });

    console.log(
      `[ENGINE] Starting cycle for ${aliveAgents.length} alive agents`
    );

    sseManager.broadcast({
      type: "engine_status",
      data: {
        status: "cycle_started",
        message: `Iniciando ciclo para ${aliveAgents.length} agente(s) vivo(s)`,
        agentCount: aliveAgents.length,
        timestamp: new Date().toISOString(),
      },
    });

    for (const agent of aliveAgents) {
      try {
        await runAgentCycle(agent);
      } catch (error) {
        console.error(
          `[ENGINE] Error in cycle for ${agent.name}:`,
          error
        );
        await db.insert(agentLogs).values({
          agentId: agent.id,
          level: "error",
          message: `Cycle error: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }

    // Run the reaper after all cycles
    const reaped = await reapDeadAgents();
    if (reaped > 0) {
      console.log(`[ENGINE] Reaped ${reaped} dead agents`);
      sseManager.broadcast({
        type: "engine_status",
        data: {
          status: "reaper_ran",
          message: `El Reaper eliminó ${reaped} agente(s) sin fondos`,
          reapedCount: reaped,
          timestamp: new Date().toISOString(),
        },
      });
    }

    sseManager.broadcast({
      type: "engine_status",
      data: {
        status: "cycle_complete",
        message: "Ciclo completo. Esperando próximo ciclo...",
        timestamp: new Date().toISOString(),
      },
    });

    console.log("[ENGINE] Cycle complete");
  } finally {
    isRunning = false;
  }
}

export function startAgentEngine(): void {
  console.log(
    `[ENGINE] Starting agent engine with cron: ${env.AGENT_CYCLE_CRON}`
  );

  cron.schedule(env.AGENT_CYCLE_CRON, runAllAgentCycles);

  // Run once immediately on startup after a short delay
  setTimeout(runAllAgentCycles, 5000);
}

// Export for manual triggering from API
export { runAllAgentCycles };
