import { db } from "../config/database.js";
import { agentLogs, agents } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { replicateAgent } from "./replicator.js";
import { addIncome, deductExpense } from "./wallet.js";
import type { RequestType } from "@botsurviver/shared";

export async function processApprovedRequest(request: {
  id: string;
  agentId: string;
  type: RequestType;
  title: string;
  description: string;
  payload: Record<string, unknown>;
}) {
  switch (request.type) {
    case "replicate":
      return await replicateAgent(request.agentId, request.payload);

    case "trade": {
      const amount = Number(request.payload.expectedAmount || 0);
      if (amount > 0) {
        return await addIncome(request.agentId, amount, `Trade: ${request.title}`);
      }
      await db.insert(agentLogs).values({
        agentId: request.agentId,
        level: "info",
        message: `Trade approved: ${request.title}. Awaiting manual income entry.`,
      });
      return;
    }

    case "spend": {
      const amount = Number(request.payload.amount || 0);
      if (amount > 0) {
        return await deductExpense(
          request.agentId,
          amount,
          `Spend: ${request.title}`
        );
      }
      return;
    }

    case "communicate": {
      await db.insert(agentLogs).values({
        agentId: request.agentId,
        level: "info",
        message: `Communication: ${request.title} - ${request.description}`,
      });
      return;
    }

    case "strategy_change": {
      const newStrategy = (request.payload.newStrategy as string) || request.description;
      await db
        .update(agents)
        .set({ strategy: newStrategy })
        .where(eq(agents.id, request.agentId));
      return;
    }

    case "custom": {
      await db.insert(agentLogs).values({
        agentId: request.agentId,
        level: "info",
        message: `Custom request approved: ${request.title}`,
        metadata: request.payload,
      });
      return;
    }

    default:
      console.warn(`Unknown request type: ${request.type}`);
  }
}
