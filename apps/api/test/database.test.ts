// Database/schema-level integration tests.
//
// These tests run against a dedicated `<main_db>_test` database (created and
// dropped per run) and never touch the development data. They verify the
// schema across the Phase 2 (database design) and Phase 3 (Clerk auth
// adaptation) work: migration correctness, seed data, and that the important
// constraints actually reject bad rows.
//
// Drizzle query errors wrap the underlying PostgresError as `.cause`, so
// constraint violations are asserted as { cause: { code } }.
//
// If the configured PostgreSQL is not reachable (no Docker/Postgres), the
// whole suite is skipped so `npm test` still passes on machines without a DB.
// CI runs these tests against a Postgres service container.

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { isReservedClerkUserId, seedClerkUserId } from "../src/auth/identity.js";
import {
  createUserResolver,
  type UpsertLocalUser,
} from "../src/auth/user-resolver.js";
import { SEED_IDS, SEED_ZONE_IDS, runSeed } from "../src/db/seed.js";
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

// The one-active-ride partial unique index (migration 0006, ADR-021) forbids
// a passenger from holding two non-terminal rows even when rows are inserted
// DIRECTLY through the database, so every test starts from an empty ride
// surface (children first). Test-created vehicles (parent rows of test pools)
// are wiped too; the four seeded fleet vehicles (Bullet + Tesla 2/3/4) stay.
async function wipeRideSurface(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(rideStatusHistory);
    await tx.delete(poolMembers);
    await tx.delete(fares);
    await tx.delete(rideRequests);
    await tx.delete(pools);
    await tx
      .delete(vehicles)
      .where(
        sql`${vehicles.id} not in (${SEED_IDS.bullet}, ${SEED_IDS.tesla2}, ${SEED_IDS.tesla3}, ${SEED_IDS.tesla4})`,
      );
  });
}

describeDb("database schema (Phases 2 + 3)", () => {
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

  beforeEach(async () => {
    await wipeRideSurface();
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
        "users",
        "vehicles",
        "zones",
      ]),
    );
    // Clerk (ADR-013) owns sessions; the application never stores them.
    expect(names).not.toContain("sessions");
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

  it("seed inserts the story cast, the four-driver fleet, and the predefined zones", async () => {
    const seededUsers = await db.select().from(users);
    expect(seededUsers).toHaveLength(7);

    const jashim = seededUsers.find((u) => u.id === SEED_IDS.jashim);
    expect(jashim?.role).toBe("DRIVER");

    for (const castName of [
      "Nusrat Haque",
      "Rafiq Rahman",
      "Shirin Islam",
      "Karim Hossain",
      "Rahim Mia",
      "Faruq Hasan",
    ]) {
      expect(seededUsers.some((u) => u.name === castName)).toBe(true);
    }

    // Four DRIVER-role cast members with one three-seat Tesla each (the
    // driver-accept-selection story, ADR-022).
    const seededVehicles = await db.select().from(vehicles);
    expect(seededVehicles).toHaveLength(4);
    const bullet = seededVehicles.find((v) => v.id === SEED_IDS.bullet)!;
    expect(bullet.name).toBe("Bullet");
    expect(bullet.capacity).toBe(3);
    expect(bullet.driverId).toBe(SEED_IDS.jashim);
    expect(bullet.isOnline).toBe(true);

    expect(seededVehicles.find((v) => v.id === SEED_IDS.tesla2)?.driverId).toBe(
      SEED_IDS.karim,
    );
    expect(seededVehicles.find((v) => v.id === SEED_IDS.tesla3)?.driverId).toBe(
      SEED_IDS.rahim,
    );
    expect(seededVehicles.find((v) => v.id === SEED_IDS.tesla4)?.driverId).toBe(
      SEED_IDS.faruq,
    );

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

    // Seeded users carry reserved dev-only Clerk placeholders. These are never
    // treated as authenticated identities by the API (src/auth/user-resolver.ts)
    // and can never collide with real Clerk IDs (which start with "user_").
    for (const user of seededUsers) {
      expect(isReservedClerkUserId(user.clerkUserId)).toBe(true);
    }
    const nusratRow = seededUsers.find((u) => u.id === SEED_IDS.nusrat);
    expect(nusratRow?.clerkUserId).toBe(seedClerkUserId("nusrat@example.com"));
  });

  it("seed is idempotent (safe to re-run)", async () => {
    await runSeed(db);
    const seededUsers = await db.select().from(users);
    const seededZones = await db.select().from(zones);
    const seededVehicles = await db.select().from(vehicles);
    expect(seededUsers).toHaveLength(7);
    expect(seededZones).toHaveLength(8);
    expect(seededVehicles).toHaveLength(4);
  });

  it("rejects a duplicate email (users_email_unique)", async () => {
    await expect(
      db.insert(users).values({
        name: "Clone User",
        email: "nusrat@example.com",
        clerkUserId: "user_clone_email",
        role: "PASSENGER",
      }),
    ).rejects.toMatchObject(rejectionCode("23505"));
  });

  it("rejects empty user names", async () => {
    await expect(
      db.insert(users).values({
        name: "   ",
        email: "noname@example.com",
        clerkUserId: "user_no_name",
        role: "PASSENGER",
      }),
    ).rejects.toMatchObject(rejectionCode("23514"));
  });

  it("requires a clerk_user_id for every user", async () => {
    // Raw SQL on purpose: the type-level NOT NULL could hide an accidental
    // omission, so we ban it at the database with a direct (nullable) insert.
    await expect(
      db.execute(sql`
        insert into users (name, email, role)
        values ('No Clerk Identity', 'noclerk@example.com', 'PASSENGER')
      `),
    ).rejects.toMatchObject(rejectionCode("23502"));
  });

  it("enforces one application user per Clerk identity", async () => {
    const clerkUserId = "user_2zXxYyWwVvUuTtSsRrQqPpOoNnMm";
    await expect(
      db.insert(users).values({
        name: "First Mapping",
        email: "first-mapping@example.com",
        clerkUserId,
        role: "PASSENGER",
      }),
    ).resolves.toBeDefined();

    await expect(
      db.insert(users).values({
        name: "Second Mapping",
        email: "second-mapping@example.com",
        clerkUserId,
        role: "PASSENGER",
      }),
    ).rejects.toMatchObject(rejectionCode("23505"));
  });

  describe("first-request provisioning (users.clerk_user_id upsert, ADR-014)", () => {
    // The app-facing upsertLocalUser is a factory bound to the application
    // database. Here we inject the disposable _test database instead, so
    // nothing touches real development data. (db is assigned by the parent
    // suite's beforeAll, so this resolver is built lazily.)
    let upsertLocalUser: UpsertLocalUser;
    beforeAll(() => {
      upsertLocalUser = createUserResolver(db).upsertLocalUser;
    });

    it("provisions a PASSENGER/active user from a verified Clerk profile", async () => {
      const clerkUserId = "user_2provisionTest000000000001";
      const user = await upsertLocalUser(clerkUserId, {
        name: "Provisioned User",
        email: "provisioned@example.com",
      });
      expect(user).toMatchObject({
        clerkUserId,
        name: "Provisioned User",
        email: "provisioned@example.com",
        role: "PASSENGER",
        active: true,
      });

      const [row] = await db
        .select()
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId));
      expect(row?.role).toBe("PASSENGER");
      expect(row?.active).toBe(true);
      expect(row?.name).toBe("Provisioned User");
    });

    it("lowercases emails on provisioning (users.email CHECK constraint)", async () => {
      const clerkUserId = "user_2provisionTest000000000002";
      const user = await upsertLocalUser(clerkUserId, {
        name: "Mixed Case",
        email: "MixedCase@Example.com",
      });
      expect(user.email).toBe("mixedcase@example.com");
    });

    it("is idempotent: a repeated provisioning returns the same local user", async () => {
      const clerkUserId = "user_2provisionTest000000000003";
      const first = await upsertLocalUser(clerkUserId, {
        name: "Repeat User",
        email: "repeat@example.com",
      });
      const second = await upsertLocalUser(clerkUserId, {
        name: "Repeat User",
        email: "repeat@example.com",
      });
      expect(second.id).toBe(first.id);
      expect(second.role).toBe("PASSENGER");

      const rows = await db
        .select()
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId));
      expect(rows).toHaveLength(1);
    });

    it("keeps exactly one user row when two requests race for the same identity", async () => {
      // Two passengers (or two tabs / a retry loop) hitting the API at the same
      // moment for a brand-new identity: the unique index + CONFLICT DO NOTHING
      // must yield one row, both callers succeed, and both see the same user.
      const clerkUserId = "user_2provisionTest000000000004";
      const [a, b] = await Promise.all([
        upsertLocalUser(clerkUserId, {
          name: "Racer A",
          email: "racer-a@example.com",
        }),
        upsertLocalUser(clerkUserId, {
          name: "Racer B",
          email: "racer-b@example.com",
        }),
      ]);
      expect(a.id).toBe(b.id);
      expect(a.role).toBe("PASSENGER");

      const rows = await db
        .select()
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId));
      expect(rows).toHaveLength(1);
    });

    it("aborts with AUTH_PROVISION_FAILED when the email is already taken (no rebind)", async () => {
      // Nusrat@example.com already exists (seed). A DIFFERENT Clerk identity
      // must never silently capture that email: provisioning fails cleanly and
      // Nusrat's row is untouched.
      const clerkUserId = "user_2provisionTest000000000005";
      await expect(
        upsertLocalUser(clerkUserId, {
          name: "Email Squatter",
          email: "nusrat@example.com",
        }),
      ).rejects.toMatchObject({ code: "AUTH_PROVISION_FAILED" });

      const attempted = await db
        .select()
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId));
      expect(attempted).toHaveLength(0);

      const nusrat = await db
        .select()
        .from(users)
        .where(eq(users.email, "nusrat@example.com"));
      expect(nusrat).toHaveLength(1);
      expect(nusrat[0]?.clerkUserId).toBe(seedClerkUserId("nusrat@example.com"));
    });

    it("never provisions reserved seed placeholders", async () => {
      await expect(
        upsertLocalUser(seedClerkUserId("shirin@example.com"), {
          name: "Impostor",
          email: "impostor@example.com",
        }),
      ).rejects.toMatchObject({ code: "AUTH_PROVISION_FAILED" });

      const rows = await db
        .select()
        .from(users)
        .where(eq(users.clerkUserId, seedClerkUserId("shirin@example.com")));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe("Shirin Islam");
    });
  });

  it("looks up a seeded user by its verified clerk_user_id", async () => {
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.clerkUserId, seedClerkUserId("nusrat@example.com")));
    expect(row?.id).toBe(SEED_IDS.nusrat);
    expect(row?.role).toBe("PASSENGER");
  });

  it("adapts users for Clerk auth (no password hashes, unique clerk_user_id index)", async () => {
    const cols = await db.execute<{ column_name: string; is_nullable: string }>(
      sql`select column_name, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'users'
          order by ordinal_position`,
    );
    const columnNames = cols.map((c) => c.column_name!);
    expect(columnNames).toContain("clerk_user_id");
    expect(columnNames).toContain("role");
    // Passwords and sessions belong to Clerk, not the application DB.
    expect(columnNames).not.toContain("password_hash");
    expect(columnNames).not.toContain("password");
    const clerkCol = cols.find((c) => c.column_name === "clerk_user_id");
    expect(clerkCol?.is_nullable).toBe("NO");

    const idx = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes
          where schemaname = 'public' and tablename = 'users'`,
    );
    const indexNames = idx.map((i) => i.indexname!);
    expect(indexNames).toContain("users_clerk_user_id_unique");
    expect(indexNames).toContain("users_email_unique");
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
    // Unassigned wait pools are the pool-creation state now (ADR-022); the
    // CHECK under test is the ride-side one: poolId + status REQUESTED are
    // mutually exclusive (ride_requests_pool_requires_matched).
    const [pool] = await db
      .insert(pools)
      .values({
        capacitySnapshot: 3,
        status: "REQUESTED",
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

  it("allows two unassigned wait pools to coexist (driver/vehicle NULL are never unique-conflicting)", async () => {
    // A wait pool carries driver_id NULL and vehicle_id NULL. Multiple waiting
    // pools can coexist without ANY row-level conflict — this is what lets
    // several first-rides use their own lobby when no existing pool fits
    // (ADR-022). Nothing in matchRide depends on uniqueness for this insert.
    await expect(
      db.insert(pools).values({
        capacitySnapshot: 3,
        status: "MATCHED",
        driverId: null,
        vehicleId: null,
      }),
    ).resolves.toBeDefined();
    await expect(
      db.insert(pools).values({
        capacitySnapshot: 3,
        status: "MATCHED",
        driverId: null,
        vehicleId: null,
      }),
    ).resolves.toBeDefined();
  });

  it("allows exactly one ACCEPTED non-terminal pool per driver (partial unique index)", async () => {
    const acceptedAt = new Date();
    await expect(
      db.insert(pools).values({
        vehicleId: SEED_IDS.bullet,
        driverId: SEED_IDS.jashim,
        capacitySnapshot: 3,
        status: "MATCHED",
        acceptedAt,
      }),
    ).resolves.toBeDefined();

    // A second accepted non-terminal pool for the same driver is rejected at
    // the database (pools_single_accepted_per_driver) — a driver can only be
    // working one accepted pool at a time (ADR-022). A WAIT pool on top is
    // fine (driver_id NULL), so the acceptance below uses a different driver.
    await expect(
      db.insert(pools).values({
        vehicleId: SEED_IDS.tesla2,
        driverId: SEED_IDS.karim,
        capacitySnapshot: 3,
        status: "MATCHED",
        acceptedAt,
      }),
    ).resolves.toBeDefined();

    await expect(
      db.insert(pools).values({
        vehicleId: SEED_IDS.tesla3,
        driverId: SEED_IDS.jashim,
        capacitySnapshot: 3,
        status: "MATCHED",
        acceptedAt,
      }),
    ).rejects.toMatchObject(rejectionCode("23505"));
  });

  it("frees a driver once their accepted pool becomes terminal", async () => {
    const acceptedAt = new Date();
    await db.insert(pools).values({
      vehicleId: SEED_IDS.bullet,
      driverId: SEED_IDS.jashim,
      capacitySnapshot: 3,
      status: "COMPLETED",
      acceptedAt,
      startedAt: acceptedAt,
      completedAt: acceptedAt,
    });

    // The COMPLETED pool dropped out of the partial unique index, so Jashim
    // may accept again — a terminal pool marks the work finished.
    await expect(
      db.insert(pools).values({
        vehicleId: SEED_IDS.bullet,
        driverId: SEED_IDS.jashim,
        capacitySnapshot: 3,
        status: "MATCHED",
        acceptedAt: new Date(),
      }),
    ).resolves.toBeDefined();
  });

  it("rejects a partially assigned pool (driver without vehicle)", async () => {
    await expect(
      db.insert(pools).values({
        driverId: SEED_IDS.jashim,
        capacitySnapshot: 3,
        status: "MATCHED",
        acceptedAt: new Date(),
      }),
    ).rejects.toMatchObject(rejectionCode("23514"));
  });

  it("rejects an assigned pool without an accepted_at", async () => {
    await expect(
      db.insert(pools).values({
        vehicleId: SEED_IDS.bullet,
        driverId: SEED_IDS.jashim,
        capacitySnapshot: 3,
        status: "MATCHED",
      }),
    ).rejects.toMatchObject(rejectionCode("23514"));
  });

  it("rejects a duplicate membership of the same request in the same pool", async () => {
    const [pool] = await db
      .insert(pools)
      .values({
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
    // Both pools are UNASSIGNED wait pools (ADR-022): the second ACTIVE
    // membership is rejected by pool_members_one_active_per_request alone, for
    // the exact reason it matters — a passenger can ride in only one pool.
    const [poolA] = await db
      .insert(pools)
      .values({
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

  it("enforces the one-active-ride rule at the DB level (partial unique index, migration 0006)", async () => {
    const idx = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes
          where schemaname = 'public' and tablename = 'ride_requests'
            and indexname = 'ride_requests_one_active_per_passenger'`,
    );
    expect(idx).toHaveLength(1);

    // A first non-terminal ride for Nusrat is fine.
    await expect(insertRideRequest()).resolves.toBeDefined();
    // A SECOND non-terminal row for the same passenger is rejected at the
    // database itself — strictly stronger than the service pre-check.
    await expect(insertRideRequest()).rejects.toMatchObject(
      rejectionCode("23505"),
    );
    // A COMPLETED ride drops out of the partial index, so Nusrat can hold a
    // terminal row as history without colliding.
    await expect(
      insertRideRequest({ status: "COMPLETED", completedAt: new Date() }),
    ).resolves.toBeDefined();
    await expect(
      insertRideRequest({ status: "CANCELLED", cancelledAt: new Date() }),
    ).resolves.toBeDefined();
  });
});