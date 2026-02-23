import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(1),
  API_KEY: z.string().min(1),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  AGENT_CYCLE_CRON: z.string().default("*/10 * * * *"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  SOLANA_RPC_URL: z.string().optional(),
  // VM access for agents
  VM_HOST: z.string().optional(),
  VM_SSH_PORT: z.coerce.number().default(22),
  VM_SSH_USER: z.string().default("botadmin"),
  VM_SSH_PRIVATE_KEY: z.string().optional(), // base64-encoded private key
});

export const env = envSchema.parse(process.env);

// Parse CORS origins (comma-separated for multiple domains)
export const corsOrigins = env.CORS_ORIGIN.split(",").map((o) => o.trim());
