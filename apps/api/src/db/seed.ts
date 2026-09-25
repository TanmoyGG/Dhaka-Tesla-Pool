// Development seed data — the canonical PRD story cast.
//
// Deterministic IDs are used so that:
// - re-running the seed is idempotent (INSERT ... ON CONFLICT DO NOTHING), and
// - tests and demos can reference Jashim / Bullet / the zones by a stable id
//   instead of looking them up.
//
// The seed is NON-destructive: it never deletes or overwrites existing rows.
// It only adds users, Jashim's Tesla Bullet, and the predefined Dhaka zones.
// No rides, pools, or memberships are seeded — those arrive with the ride
// features.
//
// Authentication is owned by Clerk (see docs/decisions.md ADR-013). The
// application never stores passwords. The seeded users carry a reserved
// development-only `clerk_user_id` placeholder (see
// src/auth/identity.ts RESERVED_CLERK_USER_ID_PREFIX). A real Clerk identity
// can never collide with a placeholder (real IDs start with "user_"), and the
// auth resolver rejects reserved IDs outright, so a placeholder is never
// treated as an authenticated identity. To use a seeded character in a live
// demo, create the person in Clerk and map their real Clerk user ID to the
// local row (documented in README "Authentication").
//
// Brand-new Clerk identities need no mapping: the API provisions them as
// PASSENGER users on their first authenticated request (ADR-014,
// src/auth/provision.ts) — this seed never does.
//
// Database schema must exist first: run `npm run db:migrate` (once) before
// `npm run db:seed`.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { pathToFileURL } from "node:url";
import { config } from "../config.js";
import { seedClerkUserId } from "../auth/identity.js";
import { users, vehicles, zones } from "./schema.js";

// Fixed, deterministic UUIDs (valid v4-format). Grouped by prefix for
// readability: a1=users, b2=vehicles, c3=zones.
export const SEED_IDS = {
  jashim: "a1000000-0000-4000-8000-000000000001",
  nusrat: "a1000000-0000-4000-8000-000000000002",
  rafiq: "a1000000-0000-4000-8000-000000000003",
  shirin: "a1000000-0000-4000-8000-000000000004",
  bullet: "b2000000-0000-4000-8000-000000000001",
} as const;

export const SEED_ZONE_IDS = {
  banani: "c3000000-0000-4000-8000-000000000001",
  gulshan: "c3000000-0000-4000-8000-000000000002",
  mohakhali: "c3000000-0000-4000-8000-000000000003",
  dhanmondi: "c3000000-0000-4000-8000-000000000004",
  mirpur: "c3000000-0000-4000-8000-000000000005",
  uttara: "c3000000-0000-4000-8000-000000000006",
  farmgate: "c3000000-0000-4000-8000-000000000007",
  bashundhara: "c3000000-0000-4000-8000-000000000008",
} as const;

export const SEED_USERS: Array<{
  id: string;
  name: string;
  email: string;
  role: "PASSENGER" | "DRIVER";
}> = [
  {
    id: SEED_IDS.jashim,
    name: "Jashim Ahmed",
    email: "jashim@example.com",
    role: "DRIVER",
  },
  {
    id: SEED_IDS.nusrat,
    name: "Nusrat Haque",
    email: "nusrat@example.com",
    role: "PASSENGER",
  },
  {
    id: SEED_IDS.rafiq,
    name: "Rafiq Rahman",
    email: "rafiq@example.com",
    role: "PASSENGER",
  },
  {
    id: SEED_IDS.shirin,
    name: "Shirin Islam",
    email: "shirin@example.com",
    role: "PASSENGER",
  },
];

// Predefined Dhaka zones from docs/database.md §2.4 / PRD §4. Plain lat/long
// points — no routing engine. Gulshan is stored as "Gulshan 1" to stay
// faithful to the story (Rafiq books Banani → Gulshan 1).
export const SEED_ZONES: Array<{
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}> = [
  {
    id: SEED_ZONE_IDS.banani,
    name: "Banani",
    latitude: 23.7936,
    longitude: 90.4062,
  },
  {
    id: SEED_ZONE_IDS.gulshan,
    name: "Gulshan 1",
    latitude: 23.7926,
    longitude: 90.4133,
  },
  {
    id: SEED_ZONE_IDS.mohakhali,
    name: "Mohakhali",
    latitude: 23.7767,
    longitude: 90.4063,
  },
  {
    id: SEED_ZONE_IDS.dhanmondi,
    name: "Dhanmondi",
    latitude: 23.7461,
    longitude: 90.3761,
  },
  {
    id: SEED_ZONE_IDS.mirpur,
    name: "Mirpur",
    latitude: 23.8072,
    longitude: 90.3646,
  },
  {
    id: SEED_ZONE_IDS.uttara,
    name: "Uttara",
    latitude: 23.8759,
    longitude: 90.3795,
  },
  {
    id: SEED_ZONE_IDS.farmgate,
    name: "Farmgate",
    latitude: 23.7561,
    longitude: 90.3906,
  },
  {
    id: SEED_ZONE_IDS.bashundhara,
    name: "Bashundhara",
    latitude: 23.8143,
    longitude: 90.4316,
  },
];

export interface SeedOptions {
  log: boolean;
}

// Minimal structural view of the Drizzle client the seed needs, so tests and
// the CLI can both pass any equivalent drizzle/postgres client.
export interface SeedDatabase {
  insert(table: unknown): {
    values(rows: unknown[]): { onConflictDoNothing(): Promise<unknown> };
  };
}

// Applies the deterministic seed. Safe to run repeatedly (idempotent).
export async function runSeed(
  db: SeedDatabase,
  options: SeedOptions = { log: false },
): Promise<void> {
  if (SEED_USERS.length > 0) {
    await db.insert(users).values(
      SEED_USERS.map((user) => ({
        id: user.id,
        clerkUserId: seedClerkUserId(user.email),
        name: user.name,
        email: user.email,
        role: user.role,
        active: true,
      })),
    ).onConflictDoNothing();
  }

  await db
    .insert(vehicles)
    .values([
      {
        id: SEED_IDS.bullet,
        driverId: SEED_IDS.jashim,
        name: "Bullet",
        capacity: 3,
        isOnline: true,
      },
    ])
    .onConflictDoNothing();

  if (SEED_ZONES.length > 0) {
    await db.insert(zones).values(SEED_ZONES).onConflictDoNothing();
  }

  if (options.log) {
    console.log(
      `seed complete: ${SEED_USERS.length} users, 1 vehicle, ${SEED_ZONES.length} zones (idempotent, existing rows untouched)`,
    );
  }
}

// CLI entry: `npm run db:seed`.
async function main(): Promise<void> {
  const client = postgres(config.databaseUrl, { max: 1, prepare: false });
  try {
    const db = drizzle(client);
    await runSeed(db, { log: true });
  } finally {
    await client.end();
  }
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error: unknown) => {
    console.error("seed failed:", error);
    process.exit(1);
  });
}