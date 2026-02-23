import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../config/database.js";
import { transactions } from "../db/schema.js";
import { addIncome } from "../services/wallet.js";

const router = Router();

// List transactions
router.get("/", async (req, res) => {
  const agentId = req.query.agent_id as string | undefined;

  const allTx = await db.query.transactions.findMany({
    where: agentId ? eq(transactions.agentId, agentId) : undefined,
    orderBy: [desc(transactions.createdAt)],
    limit: 100,
  });

  res.json({ data: allTx, total: allTx.length });
});

// Manually add income to an agent (controller action)
router.post("/", async (req, res) => {
  const { agentId, amount, description } = req.body;

  if (!agentId || !amount || !description) {
    return res
      .status(400)
      .json({ error: "agentId, amount, and description are required" });
  }

  const newBalance = await addIncome(
    agentId,
    Number(amount),
    description
  );

  res.status(201).json({ agentId, newBalance, amount, description });
});

export default router;
