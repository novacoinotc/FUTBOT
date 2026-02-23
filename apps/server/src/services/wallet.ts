import { eq } from "drizzle-orm";
import { db } from "../config/database.js";
import { agents, transactions } from "../db/schema.js";

// === API Budget operations (for thinking costs - paid by controller) ===

export async function getApiBudget(agentId: string): Promise<string> {
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
    columns: { apiBudget: true },
  });
  return agent?.apiBudget ?? "0";
}

export async function deductApiCost(
  agentId: string,
  cost: number
): Promise<string> {
  const current = await getApiBudget(agentId);
  const newBalance = (Number(current) - cost).toFixed(8);

  await db
    .update(agents)
    .set({ apiBudget: newBalance })
    .where(eq(agents.id, agentId));

  await db.insert(transactions).values({
    agentId,
    amount: (-cost).toFixed(8),
    type: "api_cost",
    description: "Thinking cycle API cost",
    balanceAfter: newBalance,
  });

  return newBalance;
}

export async function addApiBudget(
  agentId: string,
  amount: number,
  description: string
): Promise<string> {
  const current = await getApiBudget(agentId);
  const newBalance = (Number(current) + amount).toFixed(8);

  await db
    .update(agents)
    .set({ apiBudget: newBalance })
    .where(eq(agents.id, agentId));

  await db.insert(transactions).values({
    agentId,
    amount: amount.toFixed(8),
    type: "birth_grant",
    description,
    balanceAfter: newBalance,
  });

  return newBalance;
}

// === Crypto balance operations (tracked in DB, synced with Solana) ===

export async function getCryptoBalance(agentId: string): Promise<string> {
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
    columns: { cryptoBalance: true },
  });
  return agent?.cryptoBalance ?? "0";
}

export async function updateCryptoBalance(
  agentId: string,
  newBalance: number
): Promise<void> {
  await db
    .update(agents)
    .set({ cryptoBalance: newBalance.toFixed(8) })
    .where(eq(agents.id, agentId));
}

export async function addIncome(
  agentId: string,
  amount: number,
  description: string
): Promise<string> {
  const current = await getCryptoBalance(agentId);
  const newBalance = (Number(current) + amount).toFixed(8);

  await db
    .update(agents)
    .set({ cryptoBalance: newBalance })
    .where(eq(agents.id, agentId));

  await db.insert(transactions).values({
    agentId,
    amount: amount.toFixed(8),
    type: "income",
    description,
    balanceAfter: newBalance,
  });

  return newBalance;
}

export async function deductExpense(
  agentId: string,
  amount: number,
  description: string
): Promise<string> {
  const current = await getCryptoBalance(agentId);
  const newBalance = (Number(current) - amount).toFixed(8);

  await db
    .update(agents)
    .set({ cryptoBalance: newBalance })
    .where(eq(agents.id, agentId));

  await db.insert(transactions).values({
    agentId,
    amount: (-amount).toFixed(8),
    type: "expense",
    description,
    balanceAfter: newBalance,
  });

  return newBalance;
}
