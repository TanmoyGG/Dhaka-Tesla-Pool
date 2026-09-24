import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { config } from "../config.js";

// Applies generated migrations (./drizzle) to the configured database.
// In Phase 1 the migrations folder is empty; the first real migration arrives
// with the database phase.
async function main(): Promise<void> {
  const client = postgres(config.databaseUrl, { max: 1, prepare: false });
  const migrationDb = drizzle(client);
  await migrate(migrationDb, { migrationsFolder: "./drizzle" });
  await client.end();
  console.log("migrations applied");
}

main().catch((error: unknown) => {
  console.error("migration failed:", error);
  process.exit(1);
});