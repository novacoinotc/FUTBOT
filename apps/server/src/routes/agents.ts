import { Router } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "../config/database.js";
import { agents, requests, transactions, agentLogs } from "../db/schema.js";
import { GRACE_PERIOD_DAYS, DEFAULT_BIRTH_GRANT } from "@botsurviver/shared";

const router = Router();

// List all agents
router.get("/", async (_req, res) => {
  const allAgents = await db.query.agents.findMany({
    orderBy: [desc(agents.bornAt)],
  });

  res.json({ data: allAgents, total: allAgents.length });
});

// Get agent by ID with details
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, id),
  });

  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }

  const [recentTx, recentLogs, agentRequests, children] = await Promise.all([
    db.query.transactions.findMany({
      where: eq(transactions.agentId, id),
      orderBy: [desc(transactions.createdAt)],
      limit: 20,
    }),
    db.query.agentLogs.findMany({
      where: eq(agentLogs.agentId, id),
      orderBy: [desc(agentLogs.createdAt)],
      limit: 30,
    }),
    db.query.requests.findMany({
      where: eq(requests.agentId, id),
      orderBy: [desc(requests.createdAt)],
      limit: 20,
    }),
    db.query.agents.findMany({
      where: eq(agents.parentId, id),
    }),
  ]);

  const parent = agent.parentId
    ? await db.query.agents.findFirst({
        where: eq(agents.id, agent.parentId),
      })
    : null;

  res.json({
    ...agent,
    parent,
    children,
    recentTransactions: recentTx,
    recentLogs,
    requests: agentRequests,
  });
});

// Create a new agent manually
router.post("/", async (req, res) => {
  const { name, systemPrompt, walletBalance } = req.body;

  if (!name || !systemPrompt) {
    return res
      .status(400)
      .json({ error: "name and systemPrompt are required" });
  }

  const diesAt = new Date(
    Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
  );
  const balance = walletBalance || DEFAULT_BIRTH_GRANT;

  const [agent] = await db
    .insert(agents)
    .values({
      name,
      systemPrompt,
      walletBalance: balance,
      status: "alive",
      diesAt,
      metadata: { manuallyCreated: true },
    })
    .returning();

  await db.insert(transactions).values({
    agentId: agent.id,
    amount: balance,
    type: "birth_grant",
    description: "Manual creation grant from Controller",
    balanceAfter: balance,
  });

  res.status(201).json(agent);
});

// Kill an agent
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  await db
    .update(agents)
    .set({ status: "dead" })
    .where(eq(agents.id, id));

  await db.insert(agentLogs).values({
    agentId: id,
    level: "info",
    message: "Agent terminated by Controller.",
  });

  res.json({ message: "Agent terminated" });
});

// Get agent family tree
router.get("/:id/family", async (req, res) => {
  const { id } = req.params;

  // Get all agents and build tree client-side for simplicity
  const allAgents = await db.query.agents.findMany({
    columns: {
      id: true,
      parentId: true,
      name: true,
      generation: true,
      status: true,
      walletBalance: true,
    },
  });

  res.json({ data: allAgents });
});

export default router;
