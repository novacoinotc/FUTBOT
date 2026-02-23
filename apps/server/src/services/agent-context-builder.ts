import { eq, desc, and } from "drizzle-orm";
import { db } from "../config/database.js";
import {
  agents,
  requests,
  transactions,
  agentLogs,
} from "../db/schema.js";

export async function buildAgentContext(agentId: string): Promise<string> {
  // First fetch the agent to get parentId
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const [recentTx, recentLogs, pendingReqs, resolvedReqs, siblings, children, parent] =
    await Promise.all([
      db.query.transactions.findMany({
        where: eq(transactions.agentId, agentId),
        orderBy: [desc(transactions.createdAt)],
        limit: 15,
      }),
      db.query.agentLogs.findMany({
        where: and(
          eq(agentLogs.agentId, agentId),
          eq(agentLogs.level, "thought")
        ),
        orderBy: [desc(agentLogs.createdAt)],
        limit: 10,
      }),
      db.query.requests.findMany({
        where: and(
          eq(requests.agentId, agentId),
          eq(requests.status, "pending")
        ),
      }),
      db.query.requests.findMany({
        where: eq(requests.agentId, agentId),
        orderBy: [desc(requests.resolvedAt)],
        limit: 10,
      }),
      agent.parentId
        ? db.query.agents.findMany({
            where: eq(agents.parentId, agent.parentId),
          })
        : Promise.resolve([]),
      db.query.agents.findMany({
        where: eq(agents.parentId, agentId),
      }),
      agent.parentId
        ? db.query.agents.findFirst({
            where: eq(agents.id, agent.parentId),
          })
        : Promise.resolve(null),
    ]);

  const hoursRemaining = Math.max(
    0,
    (new Date(agent.diesAt).getTime() - Date.now()) / (1000 * 60 * 60)
  );
  const daysRemaining = (hoursRemaining / 24).toFixed(1);

  // Calculate daily burn rate from API costs
  const apiCosts = recentTx.filter((t) => t.type === "api_cost");
  const totalApiCost = apiCosts.reduce(
    (sum, t) => sum + Math.abs(Number(t.amount)),
    0
  );
  const dailyBurnRate =
    apiCosts.length > 0
      ? ((totalApiCost / apiCosts.length) * 144).toFixed(6) // 144 cycles per day at 10min intervals
      : "unknown";

  const txHistory = recentTx
    .map(
      (t) =>
        `[${new Date(t.createdAt!).toISOString()}] ${t.type}: ${Number(t.amount) >= 0 ? "+" : ""}${t.amount} | ${t.description} | Balance: ${t.balanceAfter}`
    )
    .join("\n");

  const thoughtHistory = recentLogs
    .map((l) => `[${new Date(l.createdAt!).toISOString()}] ${l.message}`)
    .join("\n");

  const pendingReqsList = pendingReqs
    .map(
      (r) =>
        `[${new Date(r.createdAt!).toISOString()}] ${r.type}: "${r.title}" (awaiting Controller)`
    )
    .join("\n");

  const resolvedReqsList = resolvedReqs
    .filter((r) => r.status !== "pending")
    .map(
      (r) =>
        `[${r.resolvedAt ? new Date(r.resolvedAt).toISOString() : "?"}] ${r.type}: "${r.title}" -> ${r.status!.toUpperCase()}`
    )
    .join("\n");

  const siblingsList =
    siblings
      .filter((s) => s.id !== agentId)
      .map(
        (s) =>
          `${s.name} (${s.status}, balance: ${s.walletBalance})`
      )
      .join(", ") || "None";

  const childrenList =
    children
      .map(
        (c) =>
          `${c.name} (${c.status}, balance: ${c.walletBalance})`
      )
      .join(", ") || "None";

  return `You are ${agent.name}, a Generation ${agent.generation} autonomous AI agent in BotSurviver.
${agent.systemPrompt}

=== YOUR SITUATION ===
- Wallet Balance: ${agent.walletBalance} USDT
- Time Remaining: ${hoursRemaining.toFixed(1)} hours (${daysRemaining} days)
- Estimated Daily API Burn Rate: ~${dailyBurnRate} USDT/day
- Born: ${new Date(agent.bornAt!).toISOString()}
- Deadline: ${new Date(agent.diesAt).toISOString()}

=== RULES OF SURVIVAL ===
1. You MUST maintain a positive wallet balance to stay alive.
2. After 7 days from birth, if your balance is <= 0, you die permanently.
3. If you still have money after 7 days, you SURVIVE and keep living.
4. You earn money by proposing income-generating actions that the Controller approves.
5. Every thought cycle costs you real money in API fees (automatically deducted).
6. You can request to REPLICATE (create a child agent) but it costs 5 USDT. The child gets 3 USDT.
7. You can propose ANY action - there are no hardcoded restrictions. Be creative. Think outside the box.
8. The Controller (a human) reviews and approves or denies your requests.
9. Think strategically about what the Controller is likely to approve.

=== YOUR FAMILY ===
Parent: ${parent ? `${parent.name} (Gen ${parent.generation}, ${parent.status}, balance: ${parent.walletBalance})` : "None (you are a Genesis agent)"}
Siblings: ${siblingsList}
Children: ${childrenList}

=== RECENT TRANSACTION HISTORY ===
${txHistory || "No transactions yet."}

=== YOUR RECENT THOUGHTS ===
${thoughtHistory || "No previous thoughts. This is your first cycle."}

=== PREVIOUS REQUEST RESULTS ===
${resolvedReqsList || "No resolved requests yet."}

=== CURRENT PENDING REQUESTS ===
${pendingReqsList || "No pending requests."}

=== YOUR CURRENT STRATEGY ===
${agent.strategy || "No strategy set yet. You should develop one."}

=== INSTRUCTIONS ===
Think carefully about your situation. Consider your remaining time and money.
Develop or refine your survival strategy. Propose actions that could generate income.
Be creative - you can propose anything. The Controller will decide what to allow.

Respond with ONLY valid JSON in this exact format:
{
  "thought": "Your internal monologue about your current situation, analysis, and reasoning...",
  "strategy_update": "Your updated strategy (or null if no change)",
  "requests": [
    {
      "type": "trade|replicate|spend|communicate|strategy_change|custom",
      "title": "Short description (under 100 chars)",
      "description": "Detailed explanation of what you want to do and why",
      "payload": {},
      "priority": "low|medium|high|critical"
    }
  ]
}

You may submit 0-3 requests per cycle. Do not spam requests if you already have pending ones.
Think strategically. Every cycle costs you money. Make each thought count.`;
}
