import { sql } from "drizzle-orm";
import { db } from "./index.js";

// Connectivity check: runs `SELECT 1` against the configured database.
async function main(): Promise<void> {
  const rows = await db.execute<{ ok: number }>(sql`select 1 as ok`);
  console.log("database connection OK:", rows);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("database connection FAILED:", error);
  process.exit(1);
});