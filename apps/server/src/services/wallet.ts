import { eq } from "drizzle-orm";
import { db } from "../config/database.js";
import { agents, transactions } from "../db/schema.js";

export async function getBalance(agentId: string): Promise<string> {
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
    columns: { walletBalance: true },
  });
  return agent?.walletBalance ?? "0";
}

export async function deductApiCost(
  agentId: string,
  cost: number
): Promise<string> {
  const currentBalance = await getBalance(agentId);
  const newBalance = (Number(currentBalance) - cost).toFixed(8);

  await db
    .update(agents)
    .set({ walletBalance: newBalance })
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

export async function addIncome(
  agentId: string,
  amount: number,
  description: string
): Promise<string> {
  const currentBalance = await getBalance(agentId);
  const newBalance = (Number(currentBalance) + amount).toFixed(8);

  await db
    .update(agents)
    .set({ walletBalance: newBalance })
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
  const currentBalance = await getBalance(agentId);
  const newBalance = (Number(currentBalance) - amount).toFixed(8);

  await db
    .update(agents)
    .set({ walletBalance: newBalance })
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
