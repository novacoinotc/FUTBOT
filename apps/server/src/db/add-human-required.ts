import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function addHumanRequiredType() {
  console.log("Adding human_required to request_type enum...");
  await sql`ALTER TYPE request_type ADD VALUE IF NOT EXISTS 'human_required'`;
  console.log("Done!");
}

addHumanRequiredType().catch(console.error);
