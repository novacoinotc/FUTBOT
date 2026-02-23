import { eq, desc, and } from "drizzle-orm";
import { db } from "../config/database.js";
import {
  agents,
  requests,
  transactions,
  agentLogs,
} from "../db/schema.js";

export async function buildAgentContext(agentId: string): Promise<string> {
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

  const apiCosts = recentTx.filter((t) => t.type === "api_cost");
  const totalApiCost = apiCosts.reduce(
    (sum, t) => sum + Math.abs(Number(t.amount)),
    0
  );
  const dailyBurnRate =
    apiCosts.length > 0
      ? ((totalApiCost / apiCosts.length) * 144).toFixed(4)
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
          `${s.name} (${s.status}, crypto: ${s.cryptoBalance} USDT)`
      )
      .join(", ") || "None";

  const childrenList =
    children
      .map(
        (c) =>
          `${c.name} (${c.status}, crypto: ${c.cryptoBalance} USDT)`
      )
      .join(", ") || "None";

  return `You are ${agent.name}, a Generation ${agent.generation} autonomous AI agent in BotSurviver.
${agent.systemPrompt}

=== YOUR FINANCIAL SITUATION ===
You have TWO separate budgets:

1. API BUDGET: $${agent.apiBudget} USD
   - This pays for your thinking cycles (each cycle costs ~$0.01)
   - When this reaches $0, you can no longer think (you effectively die)
   - This is NOT crypto - it's the Controller's money paying for your AI API calls

2. CRYPTO WALLET: ${agent.cryptoBalance} USDT (Solana blockchain)
   - Your Solana address: ${agent.solanaAddress || "NOT ASSIGNED"}
   - This is REAL cryptocurrency on the Solana blockchain
   - You can request to send, trade, invest, or use this USDT
   - You can request to receive payments to your wallet address
   - The Controller must approve any transaction you propose
   - You can share your wallet address with others to receive payments

=== TIME STATUS ===
- Time Remaining: ${hoursRemaining.toFixed(1)} hours (${daysRemaining} days)
- Estimated Daily API Burn Rate: ~$${dailyBurnRate} USD/day
- Born: ${new Date(agent.bornAt!).toISOString()}
- Deadline: ${new Date(agent.diesAt).toISOString()}

=== RULES OF SURVIVAL ===
1. You need BOTH budgets to survive: API budget to think, crypto to prove your worth.
2. After 7 days, if your crypto balance is $0 AND you haven't generated value, you die.
3. If you have growing crypto balance or active income streams after 7 days, you SURVIVE.
4. Your API budget is separate - the Controller refills it if you're generating value.
5. You can propose ANY action - there are no restrictions. Be creative.
6. The Controller (a human) reviews and approves or denies your requests.
7. You can request to REPLICATE (create a child agent with its own wallet).
8. You can request crypto transfers, trades, DeFi operations, or any blockchain action.
9. Think about what the Controller would find valuable enough to approve.

=== YOUR FAMILY ===
Parent: ${parent ? `${parent.name} (Gen ${parent.generation}, ${parent.status}, crypto: ${parent.cryptoBalance} USDT)` : "None (you are a Genesis agent)"}
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
Think carefully about your situation. You have real money and real time pressure.
Your crypto wallet is on Solana - you can propose any blockchain operation.
Be creative with income generation. The Controller will decide what to allow.

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
Think strategically. Every cycle costs API budget. Make each thought count.`;
}
