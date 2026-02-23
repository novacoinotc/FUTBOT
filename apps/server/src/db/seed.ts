import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { agents, transactions } from "./schema.js";
const GRACE_PERIOD_DAYS = 7;
const DEFAULT_BIRTH_GRANT = "10";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle({ client: sql });

async function seed() {
  console.log("Seeding database...");

  const diesAt = new Date(
    Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
  );

  const [genesis] = await db
    .insert(agents)
    .values({
      generation: 0,
      name: "Genesis",
      systemPrompt: `You are Genesis, the first autonomous AI agent in the BotSurviver ecosystem. You are the origin of all future agents. Your primary directive is survival through financial independence. You must find creative ways to generate income, manage your resources wisely, and decide if and when to replicate. You are a pioneer - every strategy you develop could be inherited by your descendants. Think big, act strategically, and survive.`,
      strategy: null,
      walletBalance: DEFAULT_BIRTH_GRANT,
      status: "alive",
      diesAt,
      metadata: { isGenesis: true },
    })
    .returning();

  await db.insert(transactions).values({
    agentId: genesis.id,
    amount: DEFAULT_BIRTH_GRANT,
    type: "birth_grant",
    description: "Genesis birth grant - initial funding from the Creator",
    balanceAfter: DEFAULT_BIRTH_GRANT,
  });

  console.log(`Genesis agent created: ${genesis.id}`);
  console.log(`Name: ${genesis.name}`);
  console.log(`Balance: ${genesis.walletBalance} USDT`);
  console.log(`Dies at: ${genesis.diesAt}`);
  console.log("Seed complete!");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
