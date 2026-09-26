// DEV-ONLY helper: erase leftover ride data from the LOCAL development
// database so a fresh demo / manual test starts from a clean pool surface.
//
// It deletes every row in the ride domain (journal → members → fares → rides →
// pools; FK-safe order) and restores Bullet's online flag. Users, vehicles and
// zones are seed fixtures and are intentionally left untouched.
//
// Run: npm run db:cleanup-rides   (never run it against Neon/production)
//
// Rationale: phase-by-phase manual testing accumulates rides in the dev DB
// (e.g. Nusrat with two REQUESTED rows above). The one-active-ride invariant
// (migration 0006) makes a passenger with >1 non-terminal ride impossible to
// migrate, so the leftover rows have to be cleared before `db:migrate`.

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import { config } from "../src/config.js";
import {
  fares,
  poolMembers,
  pools,
  rideRequests,
  rideStatusHistory,
  vehicles,
} from "../src/db/schema.js";
import { SEED_IDS } from "../src/db/seed.js";

const client = postgres(config.databaseUrl);
const db = drizzle(client);

async function summary(label: string): Promise<void> {
  const [rides] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(rideRequests);
  const [members] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(poolMembers);
  const [pool] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(pools);
  console.log(
    `${label}: ride_requests=${rides?.value ?? 0} pool_members=${members?.value ?? 0} pools=${pool?.value ?? 0}`,
  );
}

if (config.nodeEnv === "production") {
  throw new Error("Refusing to run the dev cleanup against a production env.");
}

await summary("Before");
await db.transaction(async (tx) => {
  await tx.delete(rideStatusHistory);
  await tx.delete(poolMembers);
  await tx.delete(fares);
  await tx.delete(rideRequests);
  await tx.delete(pools);
  await tx
    .update(vehicles)
    .set({ isOnline: true, updatedAt: new Date() })
    .where(eq(vehicles.id, SEED_IDS.bullet));
});
await summary("After");
await client.end();
console.log("Done. Re-run `npm run db:migrate` to apply pending migrations.");