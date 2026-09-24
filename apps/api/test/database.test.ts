// Database/schema-level integration tests.
//
// These tests run against a dedicated `<main_db>_test` database (created and
// dropped per run) and never touch the development data. They verify the
// Phase 2 schema: migration correctness, seed data, and that the important
// constraints actually reject bad rows.
//
// Drizzle query errors wrap the underlying PostgresError as `.cause`, so
// constraint violations are asserted as { cause: { code } }.
//
// If the configured PostgreSQL is not reachable (no Docker/Postgres), the
// whole suite is skipped so `npm test` still passes on machines without a DB.
// CI runs these tests against a Postgres service container.

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { SEED_IDS, SEED_ZONE_IDS, SEED_PLACEHOLDER_PASSWORD_HASH, runSeed } from "../src/db/seed.js";
import {
  fares,
  poolMembers,
  pools,
  rideRequests,
  rideStatusHistory,
  users,
  vehicles,
  zones,
} from "../src/db/schema.js";
import {
  applyMigrations,
  isDatabaseReachable,
  resetTestDatabase,
} from "./database-utils.js";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const REACHABLE = await isDatabaseReachable(config.databaseUrl);
const describeDb = REACHABLE ? describe : describe.skip;

let testUrl: string;
let client: postgres.Sql<Record<string, never>>;
let db: ReturnType<typeof drizzle>;

// Constraint violation codes (PostgreSQL):
//   23505 = unique_violation, 23514 = check_violation, 23503 = foreign_key_violation
function rejectionCode(code: string): { cause: { code: string } } {
  return { cause: { code } };
}

async function insertRideRequest(overrides: Partial<typeof rideRequests.$inferInsert> = {}) {
  return db
    .insert(rideRequests)
    .values({
      passengerId: SEED_IDS.nusrat,
      pickupZoneId: SEED_ZONE_IDS.banani,
      destinationZoneId: SEED_ZONE_IDS.mohakhali,
      requestedSeats: 1,
      ...overrides,
    })
    .returning();
}

describeDb("database schema (Phase 2)", () => {
  beforeAll(async () => {
    testUrl = await resetTestDatabase(config.databaseUrl);
    await applyMigrations(testUrl);
    client = postgres(testUrl, { max: 1 });
    db = drizzle(client);
    await runSeed(db);
  });

  afterAll(async () => {
    await client.end();
  });

  it("migration creates all expected tables", async () => {
    const res = await db.execute<{ name: string }>(
      sql`select table_name as name from information_schema.tables
          where table_schema = 'public' order by table_name`,
    );
    const names = res.map((r) => r.name!);
    expect(names).toEqual(
      expect.arrayContaining([
        "fares",
        "pool_members",
        "pools",
        "ride_requests",
        "ride_status_history",
        "sessions",
        "users",
        "vehicles",
        "zones",
      ]),
    );
  });

  it("migration defines the full PRD lifecycle as a Postgres enum", async () => {
    const res = await db.execute<{ label: string }>(
      sql`select e.enumlabel as label
          from pg_enum e
          join pg_type t on t.oid = e.enumtypid
          where t.typname = 'ride_status'
          order by e.enumsortorder`,
    );
    expect(res.map((r) => r.label!)).toEqual([
      "REQUESTED",
      "MATCHED",
      "DRIVER_ARRIVED",
      "STARTED",
      "COMPLETED",
      "CANCELLED",
    ]);
  });

  it("seed inserts the story cast, Bullet, and the predefined zones", async () => {
    const seededUsers = await db.select().from(users);
    expect(seededUsers).toHaveLength(4);

    const jashim = seededUsers.find((u) => u.id === SEED_IDS.jashim);
    expect(jashim?.role).toBe("DRIVER");

    for (const castName of ["Nusrat Haque", "Rafiq Rahman", "Shirin Islam"]) {
      expect(seededUsers.some((u) => u.name === castName)).toBe(true);
    }

    const bullet = await db.select().from(vehicles);
    expect(bullet).toHaveLength(1);
    expect(bullet[0]!.name).toBe("Bullet");
    expect(bullet[0]!.capacity).toBe(3);
    expect(bullet[0]!.driverId).toBe(SEED_IDS.jashim);
    expect(bullet[0]!.isOnline).toBe(true);

    const seededZones = await db.select().from(zones);
    expect(seededZones).toHaveLength(8);
    const names = seededZones.map((z) => z.name);
    for (const zoneName of [
      "Banani",
      "Gulshan 1",
      "Mohakhali",
      "Dhanmondi",
      "Mirpur",
      "Uttara",
      "Farmgate",
      "Bashundhara",
    ]) {
      expect(names).toContain(zoneName);
    }

    // Seed password hashes are documented placeholders until the auth phase.
    expect(jashim?.passwordHash).toBe(SEED_PLACEHOLDER_PASSWORD_HASH);
  });

  it("seed is idempotent (safe to re-run)", async () => {
    await runSeed(db);
    const seededUsers = await db.select().from(users);
    const seededZones = await db.select().from(zones);
    expect(seededUsers).toHaveLength(4);
    expect(seededZones).toHaveLength(8);
  });

  it("rejects a duplicate email (users_email_unique)", async () => {
    await expect(
      db.insert(users).values({
        name: "Clone User",
        email: "nusrat@example.com",
        passwordHash: "x",
        role: "PASSENGER",
      }),
    ).rejects.toMatchObject(rejectionCode("23505"));
  });

  it("rejects empty user names", async () => {
    await expect(
      db.insert(users).values({
        name: "   ",
        email: "noname@example.com",
        passwordHash: "x",
        role: "PASSENGER",
      }),
    ).rejects.toMatchObject(rejectionCode("23514"));
  });

  it("rejects non-positive seats on a ride request", async () => {
    await expect(
      db.insert(rideRequests).values({
        passengerId: SEED_IDS.nusrat,
        pickupZoneId: SEED_ZONE_IDS.banani,
        destinationZoneId: SEED_ZONE_IDS.mohakhali,
        requestedSeats: 0,
      }),
    ).rejects.toMatchObject(rejectionCode("23514"));
  });

  it("rejects a request whose pickup equals its destination", async () => {
    await expect(
      db.insert(rideRequests).values({
        passengerId: SEED_IDS.nusrat,
        pickupZoneId: SEED_ZONE_IDS.banani,
        destinationZoneId: SEED_ZONE_IDS.banani,
        requestedSeats: 1,
      }),
    ).rejects.toMatchObject(rejectionCode("23514"));
  });

  it("accepts a valid ride request with default REQUESTED state", async () => {
    const [row] = await insertRideRequest();
    expect(row?.status).toBe("REQUESTED");
    expect(row?.poolId).toBeNull();
  });

  it("rejects impossible terminal timestamps on a request", async () => {
    await expect(
      db.insert(rideRequests).values({
        passengerId: SEED_IDS.nusrat,
        pickupZoneId: SEED_ZONE_IDS.banani,
        destinationZoneId: SEED_ZONE_IDS.mohakhali,
        requestedSeats: 1,
        status: "COMPLETED",
        completedAt: null,
      }),
    ).rejects.toMatchObject(rejectionCode("23514"));

    await expect(
      db.insert(rideRequests).values({
        passengerId: SEED_IDS.nusrat,
        pickupZoneId: SEED_ZONE_IDS.banani,
        destinationZoneId: SEED_ZONE_IDS.mohakhali,
        requestedSeats: 1,
        status: "CANCELLED",
        cancelledAt: null,
      }),
    ).rejects.toMatchObject(rejectionCode("23514"));
  });

  it("rejects a request in a pool that is still REQUESTED", async () => {
    const [vehicle] = await db
      .insert(vehicles)
      .values({
        driverId: SEED_IDS.jashim,
        name: "Bullet Test",
        capacity: 3,
      })
      .returning();
    const [pool] = await db
      .insert(pools)
      .values({
        vehicleId: vehicle!.id,
        driverId: SEED_IDS.jashim,
        capacitySnapshot: 3,
      })
      .returning();

    await expect(
      db.insert(rideRequests).values({
        passengerId: SEED_IDS.nusrat,
        pickupZoneId: SEED_ZONE_IDS.banani,
        destinationZoneId: SEED_ZONE_IDS.mohakhali,
        requestedSeats: 1,
        poolId: pool!.id,
        status: "REQUESTED",
      }),
    ).rejects.toMatchObject(rejectionCode("23514"));
  });

  it("allows exactly one active (non-terminal) pool per vehicle", async () => {
    const [pool] = await db
      .insert(pools)
      .values({
        vehicleId: SEED_IDS.bullet,
        driverId: SEED_IDS.jashim,
        capacitySnapshot: 3,
        status: "MATCHED",
      })
      .returning();
    expect(pool?.status).toBe("MATCHED");

    await expect(
      db.insert(pools).values({
        vehicleId: SEED_IDS.bullet,
        driverId: SEED_IDS.jashim,
        capacitySnapshot: 3,
        status: "REQUESTED",
      }),
    ).rejects.toMatchObject(rejectionCode("23505"));
  });

  it("rejects a duplicate membership of the same request in the same pool", async () => {
    const [vehicle] = await db
      .insert(vehicles)
      .values({
        driverId: SEED_IDS.jashim,
        name: "Bullet One",
        capacity: 3,
      })
      .returning();
    const [pool] = await db
      .insert(pools)
      .values({
        vehicleId: vehicle!.id,
        driverId: SEED_IDS.jashim,
        capacitySnapshot: 3,
        status: "REQUESTED",
      })
      .returning();
    const [request] = await db
      .insert(rideRequests)
      .values({
        passengerId: SEED_IDS.nusrat,
        pickupZoneId: SEED_ZONE_IDS.banani,
        destinationZoneId: SEED_ZONE_IDS.mohakhali,
        requestedSeats: 1,
        status: "MATCHED",
        poolId: pool!.id,
      })
      .returning();

    const member = {
      poolId: pool!.id,
      rideRequestId: request!.id,
      passengerId: SEED_IDS.nusrat,
      seats: 1,
    };
    await expect(db.insert(poolMembers).values(member)).resolves.toBeDefined();
    await expect(db.insert(poolMembers).values(member)).rejects.toMatchObject(
      rejectionCode("23505"),
    );
  });

  it("rejects a second ACTIVE membership across different pools (one active pool per request)", async () => {
    const [vehicleA] = await db
      .insert(vehicles)
      .values({
        driverId: SEED_IDS.jashim,
        name: "Bullet Alpha",
        capacity: 3,
      })
      .returning();
    const [vehicleB] = await db
      .insert(vehicles)
      .values({
        driverId: SEED_IDS.jashim,
        name: "Bullet Beta",
        capacity: 3,
      })
      .returning();

    const [poolA] = await db
      .insert(pools)
      .values({
        vehicleId: vehicleA!.id,
        driverId: SEED_IDS.jashim,
        capacitySnapshot: 3,
        status: "MATCHED",
      })
      .returning();
    const [request] = await db
      .insert(rideRequests)
      .values({
        passengerId: SEED_IDS.nusrat,
        pickupZoneId: SEED_ZONE_IDS.banani,
        destinationZoneId: SEED_ZONE_IDS.mohakhali,
        requestedSeats: 1,
        status: "MATCHED",
        poolId: poolA!.id,
      })
      .returning();
    await db.insert(poolMembers).values({
      poolId: poolA!.id,
      rideRequestId: request!.id,
      passengerId: SEED_IDS.nusrat,
      seats: 1,
    });

    const [poolB] = await db
      .insert(pools)
      .values({
        vehicleId: vehicleB!.id,
        driverId: SEED_IDS.jashim,
        capacitySnapshot: 3,
        status: "MATCHED",
      })
      .returning();
    await expect(
      db.insert(poolMembers).values({
        poolId: poolB!.id,
        rideRequestId: request!.id,
        passengerId: SEED_IDS.nusrat,
        seats: 1,
      }),
    ).rejects.toMatchObject(rejectionCode("23505"));
  });

  it("rejects memberships on foreign keys that do not exist", async () => {
    const nonExistent = "00000000-0000-0000-0000-000000000000";
    await expect(
      db.insert(poolMembers).values({
        poolId: nonExistent,
        rideRequestId: nonExistent,
        passengerId: SEED_IDS.nusrat,
        seats: 1,
      }),
    ).rejects.toMatchObject(rejectionCode("23503"));
  });

  it("rejects negative fare amounts", async () => {
    const [request] = await insertRideRequest();
    await expect(
      db.insert(fares).values({
        rideRequestId: request!.id,
        baseFarePaisa: -1,
        distanceChargePaisa: 0,
        poolDiscountPaisa: 0,
        finalFarePaisa: 0,
      }),
    ).rejects.toMatchObject(rejectionCode("23514"));
  });

  it("enforces the documented fare formula on stored rows", async () => {
    const [request] = await insertRideRequest();

    await expect(
      db.insert(fares).values({
        rideRequestId: request!.id,
        baseFarePaisa: 3000,
        distanceChargePaisa: 1200,
        poolDiscountPaisa: 0,
        // 5000 != 3000 + 1200 - 0
        finalFarePaisa: 5000,
      }),
    ).rejects.toMatchObject(rejectionCode("23514"));

    await expect(
      db.insert(fares).values({
        rideRequestId: request!.id,
        baseFarePaisa: 3000,
        distanceChargePaisa: 1200,
        poolDiscountPaisa: 1050,
        finalFarePaisa: 3150,
        currency: "BDT",
      }),
    ).resolves.toBeDefined();
  });

  it("enforces a single final fare per ride request", async () => {
    const [request] = await insertRideRequest();
    await db.insert(fares).values({
      rideRequestId: request!.id,
      baseFarePaisa: 3000,
      distanceChargePaisa: 1200,
      poolDiscountPaisa: 0,
      finalFarePaisa: 4200,
    });

    await expect(
      db.insert(fares).values({
        rideRequestId: request!.id,
        baseFarePaisa: 1000,
        distanceChargePaisa: 0,
        poolDiscountPaisa: 0,
        finalFarePaisa: 1000,
      }),
    ).rejects.toMatchObject(rejectionCode("23505"));
  });

  it("rejects same-state transitions in the status history", async () => {
    const [request] = await insertRideRequest();
    await expect(
      db.insert(rideStatusHistory).values({
        rideRequestId: request!.id,
        fromStatus: "REQUESTED",
        status: "REQUESTED",
      }),
    ).rejects.toMatchObject(rejectionCode("23514"));

    await expect(
      db.insert(rideStatusHistory).values({
        rideRequestId: request!.id,
        fromStatus: "REQUESTED",
        status: "MATCHED",
      }),
    ).resolves.toBeDefined();
  });
});