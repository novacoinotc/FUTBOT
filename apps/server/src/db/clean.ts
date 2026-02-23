import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function clean() {
  console.log("Cleaning database...");

  // Drop everything in one shot using schema drop
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await sql`GRANT ALL ON SCHEMA public TO neondb_owner`;
  await sql`GRANT ALL ON SCHEMA public TO public`;

  console.log("Database cleaned! All tables, types, and objects removed.");
}

clean().catch((err) => {
  console.error("Clean failed:", err);
  process.exit(1);
});
