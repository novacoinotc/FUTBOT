import { eq } from "drizzle-orm";
import { db } from "../config/database.js";
import { agents, transactions, agentLogs } from "../db/schema.js";
import { sseManager } from "../lib/sse-manager.js";
import { generateWallet } from "./solana-wallet.js";

const REPLICATION_COST = 5;
const CHILD_API_BUDGET = "5";
const CHILD_CRYPTO_GRANT = "3";
const GRACE_PERIOD_DAYS = 7;

function generateAgentName(generation: number): string {
  const prefixes = [
    "Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta",
    "Iota", "Kappa", "Lambda", "Mu", "Nu", "Xi", "Omicron", "Pi", "Rho",
    "Sigma", "Tau", "Upsilon",
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

  // Check parent has enough crypto to fund the child
  if (Number(parent.cryptoBalance) < REPLICATION_COST) {
    throw new Error(
      `Insufficient crypto for replication. Need ${REPLICATION_COST} USDT, have ${parent.cryptoBalance}`
    );
  }

  // Deduct replication cost from parent's crypto
  const newParentCrypto = (
    Number(parent.cryptoBalance) - REPLICATION_COST
  ).toFixed(8);

  await db
    .update(agents)
    .set({ cryptoBalance: newParentCrypto })
    .where(eq(agents.id, parentId));

  await db.insert(transactions).values({
    agentId: parentId,
    amount: (-REPLICATION_COST).toFixed(8),
    type: "expense",
    description: "Replication cost for creating child agent",
    balanceAfter: newParentCrypto,
  });

  // Generate a new Solana wallet for the child
  const childWallet = generateWallet();

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
      apiBudget: CHILD_API_BUDGET,
      cryptoBalance: CHILD_CRYPTO_GRANT,
      solanaAddress: childWallet.address,
      solanaPrivateKey: childWallet.privateKey,
      status: "alive",
      diesAt,
      metadata: { parentName: parent.name },
    })
    .returning();

  await db.insert(transactions).values({
    agentId: child.id,
    amount: CHILD_CRYPTO_GRANT,
    type: "birth_grant",
    description: `Birth grant from parent ${parent.name}`,
    balanceAfter: CHILD_CRYPTO_GRANT,
  });

  await db.insert(agentLogs).values({
    agentId: parentId,
    level: "info",
    message: `Replicated! Child "${childName}" (Gen ${child.generation}) created. Wallet: ${childWallet.address}`,
    metadata: { childId: child.id, childName, childWallet: childWallet.address },
  });

  sseManager.broadcast({
    type: "agent_born",
    data: {
      agentId: child.id,
      name: child.name,
      generation: child.generation,
      parentId,
      parentName: parent.name,
    },
  });

  return child;
}
