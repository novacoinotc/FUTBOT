import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../config/database.js";
import { agents, requests, transactions, agentLogs } from "../db/schema.js";
import { generateWallet, getWalletInfo } from "../services/solana-wallet.js";

const GRACE_PERIOD_DAYS = 7;

const router = Router();

// List all agents (hide private keys)
router.get("/", async (_req, res) => {
  const allAgents = await db.query.agents.findMany({
    orderBy: [desc(agents.bornAt)],
  });

  const safe = allAgents.map(({ solanaPrivateKey, ...rest }) => rest);
  res.json({ data: safe, total: safe.length });
});

// Get agent by ID with details (hide private key)
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

  const { solanaPrivateKey, ...safeAgent } = agent;

  res.json({
    ...safeAgent,
    parent: parent ? (({ solanaPrivateKey: _, ...p }) => p)(parent) : null,
    children: children.map(({ solanaPrivateKey: _, ...c }) => c),
    recentTransactions: recentTx,
    recentLogs,
    requests: agentRequests,
  });
});

// Get agent's Solana wallet info (live balance from blockchain)
router.get("/:id/wallet", async (req, res) => {
  const { id } = req.params;

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, id),
    columns: { solanaAddress: true, solanaPrivateKey: true },
  });

  if (!agent || !agent.solanaAddress) {
    return res.status(404).json({ error: "Agent wallet not found" });
  }

  const walletInfo = await getWalletInfo(
    agent.solanaAddress,
    agent.solanaPrivateKey!
  );

  res.json({
    address: walletInfo.address,
    solBalance: walletInfo.solBalance,
    usdtBalance: walletInfo.usdtBalance,
  });
});

// Create a new agent manually
router.post("/", async (req, res) => {
  const { name, systemPrompt, apiBudget, cryptoBalance } = req.body;

  if (!name || !systemPrompt) {
    return res
      .status(400)
      .json({ error: "name and systemPrompt are required" });
  }

  const diesAt = new Date(
    Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
  );
  const wallet = generateWallet();

  const [agent] = await db
    .insert(agents)
    .values({
      name,
      systemPrompt,
      apiBudget: apiBudget || "10",
      cryptoBalance: cryptoBalance || "10",
      solanaAddress: wallet.address,
      solanaPrivateKey: wallet.privateKey,
      status: "alive",
      diesAt,
      metadata: { manuallyCreated: true },
    })
    .returning();

  await db.insert(transactions).values({
    agentId: agent.id,
    amount: agent.apiBudget,
    type: "birth_grant",
    description: "Manual creation - API budget from Controller",
    balanceAfter: agent.apiBudget,
  });

  const { solanaPrivateKey, ...safe } = agent;
  res.status(201).json(safe);
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
  const allAgents = await db.query.agents.findMany({
    columns: {
      id: true,
      parentId: true,
      name: true,
      generation: true,
      status: true,
      cryptoBalance: true,
      apiBudget: true,
    },
  });

  res.json({ data: allAgents });
});

export default router;
