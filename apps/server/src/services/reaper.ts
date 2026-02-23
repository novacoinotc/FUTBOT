import { and, eq, lte } from "drizzle-orm";
import { db } from "../config/database.js";
import { agents, agentLogs } from "../db/schema.js";
import { sseManager } from "../lib/sse-manager.js";

export async function reapDeadAgents(): Promise<number> {
  const now = new Date();

  // Find agents that are alive, past deadline, and have zero or negative balance
  const candidates = await db.query.agents.findMany({
    where: and(
      eq(agents.status, "alive"),
      lte(agents.diesAt, now),
      lte(agents.walletBalance, "0")
    ),
  });

  for (const agent of candidates) {
    await db
      .update(agents)
      .set({ status: "dead" })
      .where(eq(agents.id, agent.id));

    await db.insert(agentLogs).values({
      agentId: agent.id,
      level: "info",
      message: `Agent ${agent.name} has died. Final balance: ${agent.walletBalance} USDT. Deadline passed with insufficient funds.`,
      metadata: {
        finalBalance: agent.walletBalance,
        diesAt: agent.diesAt,
        generation: agent.generation,
      },
    });

    sseManager.broadcast({
      type: "agent_died",
      data: {
        agentId: agent.id,
        name: agent.name,
        generation: agent.generation,
        finalBalance: agent.walletBalance,
      },
    });

    console.log(`[REAPER] Agent ${agent.name} (${agent.id}) has died.`);
  }

  return candidates.length;
}
