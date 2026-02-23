import { and, eq, lte } from "drizzle-orm";
import { db } from "../config/database.js";
import { agents, agentLogs } from "../db/schema.js";
import { sseManager } from "../lib/sse-manager.js";

export async function reapDeadAgents(): Promise<number> {
  const now = new Date();

  // Find agents that are alive, past deadline, with no API budget AND no crypto
  const candidates = await db.query.agents.findMany({
    where: and(
      eq(agents.status, "alive"),
      lte(agents.diesAt, now),
      lte(agents.cryptoBalance, "0")
    ),
  });

  // Only kill agents that also have no API budget left
  const toKill = candidates.filter(
    (a) => Number(a.apiBudget) <= 0 && Number(a.cryptoBalance) <= 0
  );

  for (const agent of toKill) {
    await db
      .update(agents)
      .set({ status: "dead" })
      .where(eq(agents.id, agent.id));

    await db.insert(agentLogs).values({
      agentId: agent.id,
      level: "info",
      message: `Agent ${agent.name} has died. API Budget: $${agent.apiBudget}, Crypto: ${agent.cryptoBalance} USDT. Deadline passed with no resources.`,
      metadata: {
        finalApiBudget: agent.apiBudget,
        finalCryptoBalance: agent.cryptoBalance,
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
      },
    });

    console.log(`[REAPER] Agent ${agent.name} (${agent.id}) has died.`);
  }

  return toKill.length;
}
