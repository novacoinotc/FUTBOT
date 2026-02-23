import { eq } from "drizzle-orm";
import { db } from "../config/database.js";
import { agents, transactions, agentLogs } from "../db/schema.js";
import { sseManager } from "../lib/sse-manager.js";
import { generateWallet } from "./solana-wallet.js";
import { setupAgentWorkspace, isVMConfigured } from "./vm-service.js";

// Minimum budgets for a child to be viable
const MIN_CHILD_API_BUDGET = 1;
const MIN_CHILD_CRYPTO = 0.5;
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

  // Agent specifies how much to give the child (or use minimums)
  const childApiBudget = Math.max(
    MIN_CHILD_API_BUDGET,
    Number(payload.childApiBudget || MIN_CHILD_API_BUDGET)
  );
  const childCryptoGrant = Math.max(
    MIN_CHILD_CRYPTO,
    Number(payload.childCryptoGrant || MIN_CHILD_CRYPTO)
  );

  // Validate parent has enough API budget
  if (Number(parent.apiBudget) < childApiBudget) {
    throw new Error(
      `Presupuesto API insuficiente para replicación. Necesitas $${childApiBudget} USD, tienes $${parent.apiBudget} USD`
    );
  }

  // Validate parent has enough crypto
  if (Number(parent.cryptoBalance) < childCryptoGrant) {
    throw new Error(
      `Crypto insuficiente para replicación. Necesitas ${childCryptoGrant} USDT, tienes ${parent.cryptoBalance} USDT`
    );
  }

  // Deduct API budget from parent
  const newParentApiBudget = (
    Number(parent.apiBudget) - childApiBudget
  ).toFixed(8);

  await db
    .update(agents)
    .set({ apiBudget: newParentApiBudget })
    .where(eq(agents.id, parentId));

  await db.insert(transactions).values({
    agentId: parentId,
    amount: (-childApiBudget).toFixed(8),
    type: "expense",
    description: `Replicación: presupuesto API transferido a hijo ($${childApiBudget} USD)`,
    balanceAfter: newParentApiBudget,
  });

  // Deduct crypto from parent
  const newParentCrypto = (
    Number(parent.cryptoBalance) - childCryptoGrant
  ).toFixed(8);

  await db
    .update(agents)
    .set({ cryptoBalance: newParentCrypto })
    .where(eq(agents.id, parentId));

  await db.insert(transactions).values({
    agentId: parentId,
    amount: (-childCryptoGrant).toFixed(8),
    type: "expense",
    description: `Replicación: crypto transferido a hijo (${childCryptoGrant} USDT)`,
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
      apiBudget: childApiBudget.toFixed(8),
      cryptoBalance: childCryptoGrant.toFixed(8),
      solanaAddress: childWallet.address,
      solanaPrivateKey: childWallet.privateKey,
      status: "alive",
      diesAt,
      metadata: { parentName: parent.name },
    })
    .returning();

  // Log child's birth grants
  await db.insert(transactions).values([
    {
      agentId: child.id,
      amount: childCryptoGrant.toFixed(8),
      type: "birth_grant",
      description: `Dotación crypto de padre ${parent.name}`,
      balanceAfter: childCryptoGrant.toFixed(8),
    },
    {
      agentId: child.id,
      amount: childApiBudget.toFixed(8),
      type: "birth_grant",
      description: `Dotación API de padre ${parent.name}`,
      balanceAfter: childApiBudget.toFixed(8),
    },
  ]);

  await db.insert(agentLogs).values({
    agentId: parentId,
    level: "info",
    message: `¡Replicación exitosa! Hijo "${childName}" (Gen ${child.generation}) creado. Le di $${childApiBudget} API + ${childCryptoGrant} USDT. Mi balance restante: $${newParentApiBudget} API + ${newParentCrypto} USDT. Wallet hijo: ${childWallet.address}`,
    metadata: { childId: child.id, childName, childWallet: childWallet.address, apiBudgetGiven: childApiBudget, cryptoGiven: childCryptoGrant },
  });

  // Set up VM workspace for child agent if VM is configured
  if (isVMConfigured()) {
    try {
      await setupAgentWorkspace(child.id, childName);
    } catch (err) {
      console.error(`[REPLICATOR] Failed to set up VM workspace for ${childName}:`, err);
    }
  }

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
