import { Router } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db } from "../config/database.js";
import { agentLogs } from "../db/schema.js";
import type { LogLevel } from "@botsurviver/shared";

const router = Router();

router.get("/", async (req, res) => {
  const agentId = req.query.agent_id as string | undefined;
  const level = req.query.level as LogLevel | undefined;

  const conditions = [];
  if (agentId) conditions.push(eq(agentLogs.agentId, agentId));
  if (level) conditions.push(eq(agentLogs.level, level));

  const logs = await db.query.agentLogs.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(agentLogs.createdAt)],
    limit: 100,
  });

  res.json({ data: logs, total: logs.length });
});

export default router;
