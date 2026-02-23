import { eq } from "drizzle-orm";
import { db } from "../config/database.js";
import { agents, transactions, agentLogs } from "../db/schema.js";
import {
  REPLICATION_COST,
  CHILD_BIRTH_GRANT,
  GRACE_PERIOD_DAYS,
} from "@botsurviver/shared";
import { sseManager } from "../lib/sse-manager.js";

function generateAgentName(generation: number): string {
  const prefixes = [
    "Alpha",
    "Beta",
    "Gamma",
    "Delta",
    "Epsilon",
    "Zeta",
    "Eta",
    "Theta",
    "Iota",
    "Kappa",
    "Lambda",
    "Mu",
    "Nu",
    "Xi",
    "Omicron",
    "Pi",
    "Rho",
    "Sigma",
    "Tau",
    "Upsilon",
  ];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = Math.floor(Math.random() * 999);
  return `${prefix}-${generation}-${suffix}`;
}

export async function replicateAgent(
  parentId: string,
  payload: Record<string, unknown>
): Promise<typeof agents.$inferSelect> {
  const parent = await db.query.agents.findFirst({
    where: eq(agents.id, parentId),
  });

  if (!parent) throw new Error("Parent agent not found");
  if (Number(parent.walletBalance) < Number(REPLICATION_COST)) {
    throw new Error(
      `Insufficient balance for replication. Need ${REPLICATION_COST}, have ${parent.walletBalance}`
    );
  }

  // Deduct replication cost from parent
  const newParentBalance = (
    Number(parent.walletBalance) - Number(REPLICATION_COST)
  ).toFixed(8);

  await db
    .update(agents)
    .set({ walletBalance: newParentBalance })
    .where(eq(agents.id, parentId));

  await db.insert(transactions).values({
    agentId: parentId,
    amount: (-Number(REPLICATION_COST)).toFixed(8),
    type: "expense",
    description: `Replication cost for creating child agent`,
    balanceAfter: newParentBalance,
  });

  // Create child agent
  const childName =
    (payload.childName as string) ||
    generateAgentName(parent.generation + 1);
  const childPrompt =
    (payload.childPersonality as string) || parent.systemPrompt;
  const diesAt = new Date(
    Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
  );

  const [child] = await db
    .insert(agents)
    .values({
      parentId: parentId,
      generation: parent.generation + 1,
      name: childName,
      systemPrompt: childPrompt,
      walletBalance: CHILD_BIRTH_GRANT,
      status: "alive",
      diesAt,
      metadata: { parentName: parent.name },
    })
    .returning();

  await db.insert(transactions).values({
    agentId: child.id,
    amount: CHILD_BIRTH_GRANT,
    type: "birth_grant",
    description: `Birth grant from parent ${parent.name}`,
    balanceAfter: CHILD_BIRTH_GRANT,
  });

  await db.insert(agentLogs).values({
    agentId: parentId,
    level: "info",
    message: `Successfully replicated. Child agent "${childName}" (Gen ${child.generation}) created with ${CHILD_BIRTH_GRANT} USDT.`,
    metadata: { childId: child.id, childName },
  });

  sseManager.broadcast({
    type: "agent_born",
    data: {
      agentId: child.id,
      name: child.name,
      generation: child.generation,
      parentId: parentId,
      parentName: parent.name,
    },
  });

  return child;
}
