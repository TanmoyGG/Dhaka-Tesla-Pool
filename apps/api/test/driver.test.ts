// Driver workflow integration + concurrency tests (Phase 6, ADR-019; Phase 9,
// ADR-022). Runs against the disposable `_test` database with DISPOSABLE AUTH
// fakes (no Clerk). Canonical cast: Jashim drives Bullet (3 seats);
// Nusrat/Rafiq/Shirin are the passengers. Pools are now born UNASSIGNED wait
// pools (driver_id NULL) in the driver lobby and "accept" is the first-wins
// assignment of a driver + Tesla (ADR-022). KARIM is the SEEDED DRIVER with
// Tesla 2 (online) — an equally eligible competitor who is the interloper on
// owned (accepted) pools (404). The no-Tesla `VEHICLE_OFFLINE` path (a DRIVER
// with no vehicles at all) is covered by a dedicated non-cast fixture, NOCAR.
// RAHIM is a seeded DRIVER with Tesla 3 (online), the honest competitor in
// the cross-driver accept race.
//
// Concurrency tests use two independent postgres connections so the racing
// transactions genuinely run in parallel at the database (same convention as
// pooling.test.ts / the PRD's Nusrat-vs-Shirin race). If the configured
// PostgreSQL is unreachable the suite is skipped.

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { buildApp } from "../src/app.js";
import { SEED_IDS, SEED_ZONE_IDS, runSeed } from "../src/db/seed.js";
import {
  fares,
  poolMembers,
  pools,
  rideRequests,
  rideStatusHistory,
  users,
  vehicles,
} from "../src/db/schema.js";
import type { AuthUser } from "../src/auth/identity.js";
import { createRideService, type RideService } from "../src/rides/service.js";
import { createDriverService, type DriverService } from "../src/driver/service.js";
import {
  applyMigrations,
  isDatabaseReachable,
  resetTestDatabase,
} from "./database-utils.js";

const REACHABLE = await isDatabaseReachable(config.databaseUrl);
const describeDb = REACHABLE ? describe : describe.skip;

const Z = SEED_ZONE_IDS;

// A non-cast DRIVER who owns NO Tesla at all: preserves the VEHICLE_OFFLINE
// assertion now that every seeded driver owns an online Tesla (ADR-022).
const NOCAR_ID = "a1000000-0000-4000-8000-000000000009";

function user(
  id: string,
  name: string,
  email: string,
  role: AuthUser["role"],
): AuthUser {
  return {
    id,
    clerkUserId: `user_2testDriver0000000000000${id.slice(0, 4)}`,
    name,
    email,
    role,
    active: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

const JASHIM = user(SEED_IDS.jashim, "Jashim Ahmed", "jashim@example.com", "DRIVER");
// Seeded DRIVER with Tesla 2 (online): an equally eligible competitor (ADR-022).
const KARIM = user(SEED_IDS.karim, "Karim Hossain", "karim@example.com", "DRIVER");
// A non-cast DRIVER owning no Tesla: the dedicated VEHICLE_OFFLINE fixture.
const NOCAR = user(NOCAR_ID, "Naim Chowdhury", "nocar@example.com", "DRIVER");
// Seeded DRIVER with Tesla 3 (online): the legitimate competitor in the
// cross-driver accept race — Jashim is not entitled to every pool.
const RAHIM = user(SEED_IDS.rahim, "Rahim Mia", "rahim@example.com", "DRIVER");
const NUSRAT = user(SEED_IDS.nusrat, "Nusrat Haque", "nusrat@example.com", "PASSENGER");
const RAFIQ = user(SEED_IDS.rafiq, "Rafiq Rahman", "rafiq@example.com", "PASSENGER");
const SHIRIN = user(SEED_IDS.shirin, "Shirin Islam", "shirin@example.com", "PASSENGER");

const BOOK_NUSRAT = {
  pickupZoneId: Z.banani,
  destinationZoneId: Z.mohakhali,
  requestedSeats: 1,
  clientRequestId: null,
};
const BOOK_RAFIQ = {
  pickupZoneId: Z.banani,
  destinationZoneId: Z.gulshan,
  requestedSeats: 1,
  clientRequestId: null,
};

const booking = (
  overrides: Partial<typeof BOOK_NUSRAT> = {},
): typeof BOOK_NUSRAT => ({ ...BOOK_NUSRAT, ...overrides });

// Fake-auth tokens (no Clerk, no network): resolve to the seeded cast.
const TOKENS = {
  jashim: "tok-jashim-driver",
  karim: "tok-karim-driver",
  nusrat: "tok-nusrat-driver",
  nocar: "tok-nocar-driver",
} as const;
const TOKEN_TO_CLERK: Record<string, string> = {
  [TOKENS.jashim]: `clerk::${SEED_IDS.jashim}`,
  [TOKENS.karim]: `clerk::${SEED_IDS.karim}`,
  [TOKENS.nusrat]: `clerk::${SEED_IDS.nusrat}`,
  [TOKENS.nocar]: `clerk::${NOCAR_ID}`,
};
const CLERK_TO_USER = new Map<string, AuthUser>([
  [TOKEN_TO_CLERK[TOKENS.jashim], JASHIM],
  [TOKEN_TO_CLERK[TOKENS.karim], KARIM],
  [TOKEN_TO_CLERK[TOKENS.nusrat], NUSRAT],
  [TOKEN_TO_CLERK[TOKENS.nocar], NOCAR],
]);

let testUrl: string;
let client: postgres.Sql<Record<string, never>>;
let db: ReturnType<typeof drizzle>;
let rides: RideService;
let driver: DriverService;

function wipeState(): Promise<unknown> {
  // Child tables first (FK order), keeping users/vehicles/zones seeded.
  return db.transaction(async (tx) => {
    await tx.delete(rideStatusHistory);
    await tx.delete(poolMembers);
    await tx.delete(fares);
    await tx.delete(rideRequests);
    await tx.delete(pools);
  });
}

async function setBulletOnline(online: boolean): Promise<void> {
  await db
    .update(vehicles)
    .set({ isOnline: online, updatedAt: new Date() })
    .where(eq(vehicles.id, SEED_IDS.bullet));
}

async function bulletRow(): Promise<typeof vehicles.$inferSelect> {
  const [row] = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.id, SEED_IDS.bullet));
  if (!row) throw new Error("Bullet missing from seed");
  return row;
}

async function poolRow(poolId: string): Promise<typeof pools.$inferSelect> {
  const [row] = await db.select().from(pools).where(eq(pools.id, poolId));
  if (!row) throw new Error(`pool ${poolId} missing`);
  return row;
}

async function historyOf(rideId: string): Promise<string[]> {
  const rows = await db
    .select({ status: rideStatusHistory.status })
    .from(rideStatusHistory)
    .where(eq(rideStatusHistory.rideRequestId, rideId))
    .orderBy(rideStatusHistory.createdAt, rideStatusHistory.id);
  return rows.map((row) => row.status);
}

describeDb("driver workflow (Phase 6)", () => {
  beforeAll(async () => {
    testUrl = await resetTestDatabase(config.databaseUrl);
    await applyMigrations(testUrl);
    client = postgres(testUrl, { max: 1 });
    db = drizzle(client);
    await runSeed(db);
    // Karim is seeded (SEED_IDS.karim, driving Tesla 2 online). NOCAR is the
    // only DRIVER with no vehicles at all: the dedicated VEHICLE_OFFLINE
    // fixture that exercises the no-Tesla reject (and not an owner anywhere).
    await db
      .insert(users)
      .values({
        id: NOCAR_ID,
        clerkUserId: NOCAR.clerkUserId,
        name: NOCAR.name,
        email: NOCAR.email,
        role: "DRIVER",
        active: true,
      })
      .onConflictDoNothing();
    rides = createRideService(db);
    driver = createDriverService(db);
  });

  beforeEach(async () => {
    await wipeState();
    await setBulletOnline(true);
  });

  afterAll(async () => {
    await client.end();
  });

  // -------------------------------------------------------------------------
  // Availability (online/offline, requirements.md §21.J)
  // -------------------------------------------------------------------------

  it("goes online/offline freely with no active pool", async () => {
    await setBulletOnline(false);
    await driver.setAvailability(JASHIM.id, true);
    expect((await bulletRow()).isOnline).toBe(true);

    await driver.setAvailability(JASHIM.id, false);
    expect((await bulletRow()).isOnline).toBe(false);
  });

  it("going offline is allowed while ONLY unassigned wait pools exist (none reserve Bullet)", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    expect(n.ride.status).toBe("MATCHED");
    expect((await poolRow(n.ride.pool!.id)).driverId).toBeNull();

    // A wait pool reserves NO driver and NO Tesla, so the strict offline rule
    // (ADR-019 §21.J) does not trip: Bullet can go offline freely.
    await driver.setAvailability(JASHIM.id, false);
    expect((await bulletRow()).isOnline).toBe(false);
  });

  it("refuses going offline while an ACCEPTED pool is active; Bullet stays online", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolId);

    await expect(
      driver.setAvailability(JASHIM.id, false),
    ).rejects.toMatchObject({
      code: "DRIVER_HAS_ACTIVE_POOL",
      statusCode: 409,
    });
    expect((await bulletRow()).isOnline).toBe(true);
  });

  it("refuses going offline mid-trip (STARTED) too", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolId);
    await driver.arrivePool(JASHIM.id, poolId);
    await driver.startPool(JASHIM.id, poolId);

    await expect(
      driver.setAvailability(JASHIM.id, false),
    ).rejects.toMatchObject({ code: "DRIVER_HAS_ACTIVE_POOL", statusCode: 409 });
    expect((await bulletRow()).isOnline).toBe(true);
  });

  it("allows going offline after the pool is terminal", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolId);
    await driver.arrivePool(JASHIM.id, poolId);
    await driver.startPool(JASHIM.id, poolId);
    await driver.completePool(JASHIM.id, poolId);

    await driver.setAvailability(JASHIM.id, false);
    expect((await bulletRow()).isOnline).toBe(false);
  });

  it("an offline Tesla no longer blocks a booking: the ride lands in an UNASSIGNED wait pool", async () => {
    await setBulletOnline(false);
    const { ride } = await rides.createRequest(NUSRAT, booking());
    // Matching never selects a Tesla, so an offline fleet cannot stall the ride
    // (ADR-022): it waits UNASSIGNED in the lobby for any online driver.
    expect(ride.status).toBe("MATCHED");
    const pool = (await poolRow(ride.pool!.id));
    expect(pool.driverId).toBeNull();
    expect(pool.vehicleId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Accept
  // -------------------------------------------------------------------------

  it("accept confirms a MATCHED pool: assigns driver + Tesla, records accepted_at, stays MATCHED, idempotent", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;

    const view1 = await driver.acceptPool(JASHIM.id, poolId);
    expect(view1.status).toBe("MATCHED");
    expect(view1.acceptedAt).not.toBeNull();
    expect(view1.vehicle).toMatchObject({
      id: SEED_IDS.bullet,
      name: "Bullet",
      capacity: 3,
      isOnline: true,
    });
    const pool = await poolRow(poolId);
    expect(pool.driverId).toBe(SEED_IDS.jashim);
    expect(pool.vehicleId).toBe(SEED_IDS.bullet);
    const firstAccepted = pool.acceptedAt;

    // Repeat accept: no-op, same accepted_at, still 200 (idempotent — the
    // owning driver's own row does not count as "another active pool").
    const view2 = await driver.acceptPool(JASHIM.id, poolId);
    expect(view2.acceptedAt).toEqual(firstAccepted);
    expect((await poolRow(poolId)).acceptedAt).toEqual(firstAccepted);
  });

  it("rejects accepting when every Tesla is offline (VEHICLE_OFFLINE)", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;

    // Bullet (Jashim's only Tesla) is offline: the lobby pool has no vehicle
    // of its own, so the accepting driver must supply an online one (ADR-022).
    await db
      .update(vehicles)
      .set({ isOnline: false, updatedAt: new Date() })
      .where(eq(vehicles.id, SEED_IDS.bullet));

    await expect(
      driver.acceptPool(JASHIM.id, poolId),
    ).rejects.toMatchObject({ code: "VEHICLE_OFFLINE", statusCode: 409 });
  });

  it("a driver with no Tesla cannot accept a wait pool (VEHICLE_OFFLINE)", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    // NOCAR is a non-cast DRIVER owning no Tesla at all — the lobby is open,
    // but he has no car to bring, so he can never win an accept (open
    // competition, ADR-022). Karim now owns Tesla 2 online (seeded cast).
    await expect(driver.acceptPool(NOCAR.id, poolId)).rejects.toMatchObject({
      code: "VEHICLE_OFFLINE",
      statusCode: 409,
    });
  });

  it("a second driver accepting an already-accepted pool gets POOL_ALREADY_ACCEPTED", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolId);

    // Rahim (Tesla 3, online) is an eligible competitor, but the pool is gone.
    await expect(driver.acceptPool(RAHIM.id, poolId)).rejects.toMatchObject({
      code: "POOL_ALREADY_ACCEPTED",
      statusCode: 409,
    });
  });

  it("a driver holding an ACCEPTED pool cannot accept a SECOND one (DRIVER_HAS_ACTIVE_POOL)", async () => {
    // Nusrat's 3-seat booking fills pool A to capacity, so Rafiq's (different)
    // booking cannot join it and starts its own pool B.
    const n = await rides.createRequest(NUSRAT, booking({ requestedSeats: 3 }));
    const poolA = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolA);

    const r = await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));
    const poolB = r.ride.pool!.id;
    expect(poolB).not.toBe(poolA);

    await expect(
      driver.acceptPool(JASHIM.id, poolB),
    ).rejects.toMatchObject({ code: "DRIVER_HAS_ACTIVE_POOL", statusCode: 409 });
  });

  it("rejects accepting a pool that already left MATCHED (POOL_NOT_ACCEPTABLE)", async () => {
    // Cancelled pools / running pools are not acceptable.
    const cancelled = await rides.createRequest(NUSRAT, booking());
    const cancelledPool = cancelled.ride.pool!.id;
    await rides.cancelRequest(NUSRAT, cancelled.ride.id);
    await expect(
      driver.acceptPool(JASHIM.id, cancelledPool),
    ).rejects.toMatchObject({ code: "POOL_NOT_ACCEPTABLE", statusCode: 409 });

    // After arrive the pool is DRIVER_ARRIVED, no longer acceptable.
    const moved = await rides.createRequest(NUSRAT, booking());
    const movedPool = moved.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, movedPool);
    await driver.arrivePool(JASHIM.id, movedPool);
    await expect(
      driver.acceptPool(JASHIM.id, movedPool),
    ).rejects.toMatchObject({ code: "POOL_NOT_ACCEPTABLE", statusCode: 409 });
  });

  it("accepting an unknown/nonexistent pool id is a plain 404", async () => {
    await expect(
      driver.acceptPool(JASHIM.id, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  // -------------------------------------------------------------------------
  // Lifecycle: accept → arrive → start → complete
  // -------------------------------------------------------------------------

  it("a driver cannot arrive on a pool they never accepted (404, ownership post-dates acceptance)", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    // The wait pool belongs to NOBODY (driver_id NULL) until accept assigns it.
    // Arriving before accepting therefore 404s exactly like any pool Jashim
    // does not own — ownership is established by acceptance alone (ADR-022).
    await expect(
      driver.arrivePool(JASHIM.id, poolId),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("moves the pool AND every member ride through DRIVER_ARRIVED together", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const r = await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));
    const poolId = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolId);

    const view = await driver.arrivePool(JASHIM.id, poolId);
    expect(view.status).toBe("DRIVER_ARRIVED");
    expect((await poolRow(poolId)).status).toBe("DRIVER_ARRIVED");

    const rideStatuses = await db
      .select({ id: rideRequests.id, status: rideRequests.status })
      .from(rideRequests)
      .where(eq(rideRequests.poolId, poolId))
      .orderBy(rideRequests.id);
    expect(rideStatuses).toHaveLength(2);
    expect(rideStatuses.every((row) => row.status === "DRIVER_ARRIVED")).toBe(true);

    // REQUESTED and MATCHED journal entries are written inside the SAME create
    // transaction with identical timestamps, so their relative order is not
    // deterministic; the SET of reached states is what matters.
    expect((await historyOf(n.ride.id)).slice().sort()).toEqual(
      ["REQUESTED", "MATCHED", "DRIVER_ARRIVED"].sort(),
    );
    expect((await historyOf(r.ride.id)).slice().sort()).toEqual(
      ["REQUESTED", "MATCHED", "DRIVER_ARRIVED"].sort(),
    );
  });

  it("runs the full lifecycle and completes every ride with timestamps + histories", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));
    const poolId = n.ride.pool!.id;

    const accepted = await driver.acceptPool(JASHIM.id, poolId);
    expect(accepted.status).toBe("MATCHED");
    expect(accepted.acceptedAt).not.toBeNull();

    const arrived = await driver.arrivePool(JASHIM.id, poolId);
    expect(arrived.status).toBe("DRIVER_ARRIVED");
    expect(arrived.acceptedAt).not.toBeNull();

    const started = await driver.startPool(JASHIM.id, poolId);
    expect(started.status).toBe("STARTED");
    expect(started.startedAt).not.toBeNull();

    const completed = await driver.completePool(JASHIM.id, poolId);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).not.toBeNull();

    const pool = await poolRow(poolId);
    expect(pool.status).toBe("COMPLETED");
    expect(pool.acceptedAt).not.toBeNull();
    expect(pool.startedAt).not.toBeNull();
    expect(pool.completedAt).not.toBeNull();

    // Every member ride reached COMPLETED with its own completed_at.
    const rideRows = await db
      .select()
      .from(rideRequests)
      .where(eq(rideRequests.poolId, poolId))
      .orderBy(rideRequests.id);
    expect(rideRows).toHaveLength(2);
    for (const ride of rideRows) {
      expect(ride.status).toBe("COMPLETED");
      expect(ride.completedAt).not.toBeNull();
      // REQUESTED + MATCHED share the create-transaction timestamp; the SET of
      // reached states is the deterministic assertion.
      expect((await historyOf(ride.id)).slice().sort()).toEqual(
        ["REQUESTED", "MATCHED", "DRIVER_ARRIVED", "STARTED", "COMPLETED"].sort(),
      );
    }
  });

  it("rejects illegal transitions with INVALID_STATE_TRANSITION", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolId);

    // arrive twice: DRIVER_ARRIVED -> DRIVER_ARRIVED is the same state.
    await driver.arrivePool(JASHIM.id, poolId);
    await expect(
      driver.arrivePool(JASHIM.id, poolId),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION", statusCode: 409 });

    // complete before start: MATCHED-completion is invalid... (pool is now
    // DRIVER_ARRIVED; still no path to COMPLETED).
    await expect(
      driver.completePool(JASHIM.id, poolId),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION", statusCode: 409 });
  });

  it("rejects starting before arriving and completing before starting", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolId);

    // MATCHED -> STARTED is not a legal step; arrival must come first.
    await expect(
      driver.startPool(JASHIM.id, poolId),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION", statusCode: 409 });

    await driver.arrivePool(JASHIM.id, poolId);
    await expect(
      driver.completePool(JASHIM.id, poolId),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION", statusCode: 409 });
  });

  it("an interloper is 404 on every lifecycle action", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;

    await expect(driver.arrivePool(KARIM.id, poolId)).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
    await expect(driver.startPool(KARIM.id, poolId)).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
    await expect(driver.completePool(KARIM.id, poolId)).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
  });

  it("completion frees Bullet for a brand-new pool", async () => {
    const first = await rides.createRequest(NUSRAT, booking());
    const firstPool = first.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, firstPool);
    await driver.arrivePool(JASHIM.id, firstPool);
    await driver.startPool(JASHIM.id, firstPool);
    await driver.completePool(JASHIM.id, firstPool);

    const second = await rides.createRequest(SHIRIN, booking());
    expect(second.ride.status).toBe("MATCHED");
    expect(second.ride.pool?.id).not.toBe(firstPool);

    // The terminal pool released Jashim: accepting the brand-new wait pool
    // succeeds (no DRIVER_HAS_ACTIVE_POOL) and reassigns Tesla Bullet.
    const accepted = await driver.acceptPool(JASHIM.id, second.ride.pool!.id);
    expect(accepted.vehicle?.id).toBe(SEED_IDS.bullet);
  });

  it("a passenger may STILL join a pool after it was accepted (acceptance keeps MATCHED)", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolId);

    // Rafiq's compatible booking rides along: the assigned pool is still
    // MATCHED, so the seat claim is legal (ADR-022, seat-claim contract §1-4).
    const r = await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));
    expect(r.ride.pool?.id).toBe(poolId);
    const members = await db
      .select()
      .from(poolMembers)
      .where(eq(poolMembers.poolId, poolId));
    expect(members).toHaveLength(2);
  });

  it("once the driver has ARRIVED a matching passenger gets their own wait pool", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolId);
    await driver.arrivePool(JASHIM.id, poolId);

    const r = await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));
    // The running trip is no longer joinable (claim re-checks status under the
    // lock); Rafiq starts his own UNASSIGNED wait pool instead (ADR-022).
    expect(r.ride.status).toBe("MATCHED");
    expect(r.ride.pool?.id).not.toBe(poolId);
    const pool = await poolRow(r.ride.pool!.id);
    expect(pool.driverId).toBeNull();
    expect(pool.vehicleId).toBeNull();
  });

  it("an emptied ACCEPTED pool is cancelled and frees the driver to accept again", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolId);

    // The only member cancels: the accepted pool empties → CANCELLED, which
    // releases the driver's single-active-accepted-pool slot (migration 0007).
    await rides.cancelRequest(NUSRAT, n.ride.id);
    expect((await poolRow(poolId)).status).toBe("CANCELLED");

    const second = await rides.createRequest(SHIRIN, booking());
    const accepted = await driver.acceptPool(JASHIM.id, second.ride.pool!.id);
    expect(accepted.vehicle?.id).toBe(SEED_IDS.bullet);
  });

  // -------------------------------------------------------------------------
  // Passenger cancel interplay (P8: DRIVER_ARRIVED is still cancellable)
  // -------------------------------------------------------------------------

  it("a passenger may cancel at DRIVER_ARRIVED; the remaining member's fare reverts", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const r = await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));
    const poolId = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolId);
    await driver.arrivePool(JASHIM.id, poolId);

    // Rafiq bails at the kerb after the driver arrived.
    const cancelled = await rides.cancelRequest(RAFIQ, r.ride.id);
    expect(cancelled.status).toBe("CANCELLED");

    // Pool still on the road with Nusrat; Rafiq LEFT, fare history preserved.
    expect((await poolRow(poolId)).status).toBe("DRIVER_ARRIVED");
    const members = await db
      .select()
      .from(poolMembers)
      .where(eq(poolMembers.poolId, poolId));
    const left = members.filter((m) => m.status === "LEFT");
    const active = members.filter((m) => m.status === "ACTIVE");
    expect(left).toHaveLength(1);
    expect(active).toHaveLength(1);

    // Nusrat is alone again → pooled discount reverts to the solo fare.
    const [nusratFare] = await db
      .select()
      .from(fares)
      .where(eq(fares.rideRequestId, n.ride.id));
    expect(nusratFare?.poolDiscountPaisa).toBe(0);
    expect(nusratFare?.finalFarePaisa).toBe(5932);
  });

  it("cancelling the last member at DRIVER_ARRIVED empties and terminates the pool", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolId);
    await driver.arrivePool(JASHIM.id, poolId);

    await rides.cancelRequest(NUSRAT, n.ride.id);
    expect((await poolRow(poolId)).status).toBe("CANCELLED");
  });

  it("a passenger CANNOT cancel once the trip has STARTED", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolId);
    await driver.arrivePool(JASHIM.id, poolId);
    await driver.startPool(JASHIM.id, poolId);

    await expect(
      rides.cancelRequest(NUSRAT, n.ride.id),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION", statusCode: 409 });
    expect((await poolRow(poolId)).status).toBe("STARTED");
  });

  // -------------------------------------------------------------------------
  // Driver hub reads (list / detail)
  // -------------------------------------------------------------------------

  it("lists only the driver's own ACCEPTED non-terminal pools, newest first, fare-free", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));
    const poolId = n.ride.pool!.id;

    // The UNASSIGNED wait pool does NOT belong to Jashim yet (driver_id NULL):
    // it lives in the lobby (getAvailablePools), not in a driver's hub list.
    expect(await driver.listDriverPools(JASHIM.id)).toEqual([]);
    expect(await driver.listDriverPools(KARIM.id)).toEqual([]);

    const lobby = await driver.getAvailablePools();
    expect(lobby).toHaveLength(1);
    expect(lobby[0]).toMatchObject({ id: poolId, status: "MATCHED", vehicle: null });

    await driver.acceptPool(JASHIM.id, poolId);

    const list = await driver.listDriverPools(JASHIM.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: poolId,
      status: "MATCHED",
      capacitySnapshot: 3,
      occupiedSeats: 2,
      vehicle: { id: SEED_IDS.bullet, name: "Bullet", capacity: 3, isOnline: true },
    });
    // Members: names + zones + seats, NO fare fields (P9).
    expect(list[0].members).toHaveLength(2);
    expect(list[0].members.map((m) => m.passengerName).sort()).toEqual([
      "Nusrat Haque",
      "Rafiq Rahman",
    ]);
    expect(list[0].members[0]).toMatchObject({
      pickupZoneName: "Banani",
      destinationZoneName: "Mohakhali",
      seats: 1,
    });
    expect(list[0]).not.toHaveProperty("fare");
    expect(list[0].members[0]).not.toHaveProperty("fare");

    // Another driver sees nothing.
    expect(await driver.listDriverPools(KARIM.id)).toEqual([]);
  });

  it("the hub list excludes COMPLETED pools (and ordering is deterministic)", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolId);
    await driver.arrivePool(JASHIM.id, poolId);
    await driver.startPool(JASHIM.id, poolId);
    await driver.completePool(JASHIM.id, poolId);

    expect(await driver.listDriverPools(JASHIM.id)).toEqual([]);
    // Pool view still available directly even after completion (history).
    const view = await driver.getDriverPool(JASHIM.id, poolId);
    expect(view.status).toBe("COMPLETED");
  });

  it("pool detail is owned-only: 404s for the unassigned pool, other drivers, and unknown ids", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;

    // Nobody owns the wait pool yet — even Jashim cannot fetch its detail
    // until he accepts it (ownership-hiding, same as any foreign pool).
    await expect(driver.getDriverPool(JASHIM.id, poolId)).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
    await expect(driver.getDriverPool(KARIM.id, poolId)).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
    await expect(
      driver.getDriverPool(JASHIM.id, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });

    await driver.acceptPool(JASHIM.id, poolId);
    const view = await driver.getDriverPool(JASHIM.id, poolId);
    expect(view.vehicle?.isOnline).toBe(true);
  });

  // -------------------------------------------------------------------------
  // HTTP surface (authorization + envelope)
  // -------------------------------------------------------------------------

  it("guards every driver route: 401 unauthenticated, 403 for passengers", async () => {
    const app: FastifyInstance = buildApp({
      auth: {
        verifySession: async (token: string) => TOKEN_TO_CLERK[token] ?? null,
        resolveLocalUser: async (clerkId: string) =>
          CLERK_TO_USER.get(clerkId) ?? null,
        provisionLocalUser: async () => null,
      },
      driver: createDriverService(db),
    });

    try {
      const noToken = await app.inject({
        method: "POST",
        url: "/api/driver/availability",
        payload: { isOnline: true },
      });
      expect(noToken.statusCode).toBe(401);
      expect(noToken.json().error.code).toBe("AUTH_UNAUTHENTICATED");

      const passenger = await app.inject({
        method: "POST",
        url: "/api/driver/availability",
        payload: { isOnline: true },
        headers: { authorization: `Bearer ${TOKENS.nusrat}` },
      });
      expect(passenger.statusCode).toBe(403);
      expect(passenger.json().error.code).toBe("FORBIDDEN");

      const pools = await app.inject({
        method: "GET",
        url: "/api/driver/pools",
        headers: { authorization: `Bearer ${TOKENS.nusrat}` },
      });
      expect(pools.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("availability toggles over HTTP (204) and rejects going offline with an ACCEPTED pool", async () => {
    const app: FastifyInstance = buildApp({
      auth: {
        verifySession: async (token: string) => TOKEN_TO_CLERK[token] ?? null,
        resolveLocalUser: async (clerkId: string) =>
          CLERK_TO_USER.get(clerkId) ?? null,
        provisionLocalUser: async () => null,
      },
      driver: createDriverService(db),
    });

    try {
      const online = await app.inject({
        method: "POST",
        url: "/api/driver/availability",
        payload: { isOnline: true },
        headers: { authorization: `Bearer ${TOKENS.jashim}` },
      });
      expect(online.statusCode).toBe(204);
      expect((await bulletRow()).isOnline).toBe(true);

      const n = await rides.createRequest(NUSRAT, booking());
      expect(n.ride.status).toBe("MATCHED");

      // An UNASSIGNED wait pool reserves no driver, so it does NOT block the
      // offline toggle (ADR-022) — unlike the pre-Accept model.
      const waitPoolOff = await app.inject({
        method: "POST",
        url: "/api/driver/availability",
        payload: { isOnline: false },
        headers: { authorization: `Bearer ${TOKENS.jashim}` },
      });
      expect(waitPoolOff.statusCode).toBe(204);
      expect((await bulletRow()).isOnline).toBe(false);
      await driver.setAvailability(JASHIM.id, true);

      // An ACCEPTED pool is the driver's own commitment: going offline trips
      // the strict rule (ADR-019 §21.J) → 409 DRIVER_HAS_ACTIVE_POOL.
      await driver.acceptPool(JASHIM.id, n.ride.pool!.id);
      const blocked = await app.inject({
        method: "POST",
        url: "/api/driver/availability",
        payload: { isOnline: false },
        headers: { authorization: `Bearer ${TOKENS.jashim}` },
      });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.code).toBe("DRIVER_HAS_ACTIVE_POOL");
      expect((await bulletRow()).isOnline).toBe(true);

      const badBody = await app.inject({
        method: "POST",
        url: "/api/driver/availability",
        payload: { isOnline: "yes" },
        headers: { authorization: `Bearer ${TOKENS.jashim}` },
      });
      expect(badBody.statusCode).toBe(400);
      expect(badBody.json().error.code).toBe("VALIDATION_ERROR");

      // The GET mirror returns the same state the toggle just produced.
      const snapshot = await app.inject({
        method: "GET",
        url: "/api/driver/availability",
        headers: { authorization: `Bearer ${TOKENS.jashim}` },
      });
      expect(snapshot.statusCode).toBe(200);
      expect(snapshot.json().availability).toEqual({ isOnline: true });

      const passengerGets = await app.inject({
        method: "GET",
        url: "/api/driver/availability",
        headers: { authorization: `Bearer ${TOKENS.nusrat}` },
      });
      expect(passengerGets.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("getAvailability mirrors the toggle state (all owned Teslas online)", async () => {
    await setBulletOnline(false);
    expect(await driver.getAvailability(JASHIM.id)).toEqual({ isOnline: false });
    await driver.setAvailability(JASHIM.id, true);
    expect(await driver.getAvailability(JASHIM.id)).toEqual({ isOnline: true });
    await driver.setAvailability(JASHIM.id, false);
    expect(await driver.getAvailability(JASHIM.id)).toEqual({ isOnline: false });
    await driver.setAvailability(JASHIM.id, true);
  });

  it("listDriverHistory returns COMPLETED pools newest first, never active ones", async () => {
    // Two completed trips...
    const n1 = await rides.createRequest(NUSRAT, booking());
    const poolA = n1.ride.pool!.id;
    for (const step of ["accept", "arrive", "start", "complete"] as const) {
      await driver[`${step}Pool`](JASHIM.id, poolA);
    }
    const n2 = await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));
    const poolB = n2.ride.pool!.id;
    for (const step of ["accept", "arrive", "start", "complete"] as const) {
      await driver[`${step}Pool`](JASHIM.id, poolB);
    }

    const history = await driver.listDriverHistory(JASHIM.id);
    expect(history).toHaveLength(2);
    // Newest completed first; both COMPLETED with the members projection.
    expect(history[0]!.id).toBe(poolB);
    expect(history[1]!.id).toBe(poolA);
    expect(history[0]!.status).toBe("COMPLETED");
    expect(history[0]!.completedAt).not.toBeNull();
    expect(history[0]!.occupiedSeats).toBe(1);
    expect(history[0]!.members[0]!.passengerName).toBe("Rafiq Rahman");

    // Active pools are NOT history.
    await rides.createRequest(SHIRIN, booking());
    expect(await driver.listDriverHistory(JASHIM.id)).toHaveLength(2);
  });

  it("exposes the completed-trip history endpoint over HTTP (403 for passengers)", async () => {
    const app: FastifyInstance = buildApp({
      auth: {
        verifySession: async (token: string) => TOKEN_TO_CLERK[token] ?? null,
        resolveLocalUser: async (clerkId: string) =>
          CLERK_TO_USER.get(clerkId) ?? null,
        provisionLocalUser: async () => null,
      },
      driver: createDriverService(db),
    });

    try {
      const n = await rides.createRequest(NUSRAT, booking());
      const poolId = n.ride.pool!.id;
      await driver.acceptPool(JASHIM.id, poolId);
      await driver.arrivePool(JASHIM.id, poolId);
      await driver.startPool(JASHIM.id, poolId);
      await driver.completePool(JASHIM.id, poolId);

      const res = await app.inject({
        method: "GET",
        url: "/api/driver/pools/history",
        headers: { authorization: `Bearer ${TOKENS.jashim}` },
      });
      expect(res.statusCode).toBe(200);
      const { pools: history } = res.json();
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe(poolId);
      expect(history[0].status).toBe("COMPLETED");

      const passenger = await app.inject({
        method: "GET",
        url: "/api/driver/pools/history",
        headers: { authorization: `Bearer ${TOKENS.nusrat}` },
      });
      expect(passenger.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("drives the full lifecycle over HTTP with interloper lockout", async () => {
    const app: FastifyInstance = buildApp({
      auth: {
        verifySession: async (token: string) => TOKEN_TO_CLERK[token] ?? null,
        resolveLocalUser: async (clerkId: string) =>
          CLERK_TO_USER.get(clerkId) ?? null,
        provisionLocalUser: async () => null,
      },
      driver: createDriverService(db),
    });

    try {
      const n = await rides.createRequest(NUSRAT, booking());
      await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));
      const poolId = n.ride.pool!.id;
      const jashim = { authorization: `Bearer ${TOKENS.jashim}` };
      const karim = { authorization: `Bearer ${TOKENS.karim}` };
      const nocar = { authorization: `Bearer ${TOKENS.nocar}` };

      // The wait pool is unclaimed. NOCAR (no Tesla at all) cannot compete
      // (VEHICLE_OFFLINE). KARIM (Tesla 2, online) is an eligible competitor,
      // but he has not been assigned the pool, so owned actions and detail
      // hide it from him (ownership-hiding 404).
      const nocarAcceptUnassigned = await app.inject({
        method: "POST",
        url: `/api/driver/pools/${poolId}/accept`,
        headers: nocar,
      });
      expect(nocarAcceptUnassigned.statusCode).toBe(409);
      expect(nocarAcceptUnassigned.json().error.code).toBe("VEHICLE_OFFLINE");
      for (const action of ["arrive", "start", "complete"]) {
        const intruder = await app.inject({
          method: "POST",
          url: `/api/driver/pools/${poolId}/${action}`,
          headers: karim,
        });
        expect(intruder.statusCode).toBe(404);
        expect(intruder.json().error.code).toBe("NOT_FOUND");
      }
      // The lobby (GET /pools/available) is open to every driver role.
      const lobby = await app.inject({
        method: "GET",
        url: "/api/driver/pools/available",
        headers: karim,
      });
      expect(lobby.statusCode).toBe(200);
      expect(lobby.json().pools.map((p: { id: string }) => p.id)).toContain(poolId);
      // But detail is owner-only → 404 for the interloper even here.
      const intruderDetail = await app.inject({
        method: "GET",
        url: `/api/driver/pools/${poolId}`,
        headers: karim,
      });
      expect(intruderDetail.statusCode).toBe(404);

      const accept = await app.inject({
        method: "POST",
        url: `/api/driver/pools/${poolId}/accept`,
        headers: jashim,
      });
      expect(accept.statusCode).toBe(200);
      expect(accept.json().pool.status).toBe("MATCHED");
      expect(accept.json().pool.acceptedAt).toBeTruthy();
      expect(accept.json().pool.vehicle).toMatchObject({
        id: SEED_IDS.bullet,
        name: "Bullet",
      });
      // Detail works for the owner after acceptance.
      const detail = await app.inject({
        method: "GET",
        url: `/api/driver/pools/${poolId}`,
        headers: jashim,
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().pool.members).toHaveLength(2);
      // The eligible competitor who did not win now loses the accept race.
      const karimAcceptAgain = await app.inject({
        method: "POST",
        url: `/api/driver/pools/${poolId}/accept`,
        headers: karim,
      });
      expect(karimAcceptAgain.statusCode).toBe(409);
      expect(karimAcceptAgain.json().error.code).toBe("POOL_ALREADY_ACCEPTED");

      const arrive = await app.inject({
        method: "POST",
        url: `/api/driver/pools/${poolId}/arrive`,
        headers: jashim,
      });
      expect(arrive.statusCode).toBe(200);
      expect(arrive.json().pool.status).toBe("DRIVER_ARRIVED");

      const start = await app.inject({
        method: "POST",
        url: `/api/driver/pools/${poolId}/start`,
        headers: jashim,
      });
      expect(start.statusCode).toBe(200);
      expect(start.json().pool.status).toBe("STARTED");

      const complete = await app.inject({
        method: "POST",
        url: `/api/driver/pools/${poolId}/complete`,
        headers: jashim,
      });
      expect(complete.statusCode).toBe(200);
      expect(complete.json().pool.status).toBe("COMPLETED");

      // Completed pools leave the hub list.
      const list = await app.inject({
        method: "GET",
        url: "/api/driver/pools",
        headers: jashim,
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().pools).toEqual([]);
    } finally {
      await app.close();
    }
  });

  // -------------------------------------------------------------------------
  // Concurrency (ADR-020: database-backed transactional consistency)
  // -------------------------------------------------------------------------

  it("two drivers race the same unassigned pool: exactly one wins, the loser gets POOL_ALREADY_ACCEPTED", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;

    const clientA = postgres(testUrl, { max: 1 });
    const clientB = postgres(testUrl, { max: 1 });
    const serviceA = createDriverService(drizzle(clientA));
    const serviceB = createDriverService(drizzle(clientB));

    try {
      const [a, b] = await Promise.allSettled([
        serviceA.acceptPool(JASHIM.id, poolId),
        serviceB.acceptPool(RAHIM.id, poolId),
      ]);
      const winners = [a, b].filter((r) => r.status === "fulfilled");
      const losers = [a, b].filter(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult[];
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0]!.reason).toMatchObject({
        code: "POOL_ALREADY_ACCEPTED",
        statusCode: 409,
      });

      // Exactly one driver_id and one vehicle assigned, set once.
      const pool = await poolRow(poolId);
      const winnerDriverId = pool.driverId;
      expect([SEED_IDS.jashim, SEED_IDS.rahim]).toContain(winnerDriverId);
      expect(pool.vehicleId).toBe(
        winnerDriverId === SEED_IDS.jashim ? SEED_IDS.bullet : SEED_IDS.tesla3,
      );
      expect(pool.acceptedAt).not.toBeNull();
    } finally {
      await clientA.end();
      await clientB.end();
    }
  });

  it("two concurrent accepts on the same pool by the same driver both succeed idempotently (single accepted_at)", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;

    const clientA = postgres(testUrl, { max: 1 });
    const clientB = postgres(testUrl, { max: 1 });
    const serviceA = createDriverService(drizzle(clientA));
    const serviceB = createDriverService(drizzle(clientB));

    try {
      const [viewA, viewB] = await Promise.all([
        serviceA.acceptPool(JASHIM.id, poolId),
        serviceB.acceptPool(JASHIM.id, poolId),
      ]);
      expect(viewA.status).toBe("MATCHED");
      expect(viewB.status).toBe("MATCHED");
      expect(viewA.acceptedAt).not.toBeNull();
      expect(viewB.acceptedAt).toEqual(viewA.acceptedAt);
      // Exactly one accepted_at timestamp in the DB, set once.
      expect((await poolRow(poolId)).acceptedAt).toEqual(viewA.acceptedAt);
    } finally {
      await clientA.end();
      await clientB.end();
    }
  });

  it("two concurrent arrivals: exactly one wins; the pool is DRIVER_ARRIVED once", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const r = await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));
    const poolId = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolId);

    const clientA = postgres(testUrl, { max: 1 });
    const clientB = postgres(testUrl, { max: 1 });
    const serviceA = createDriverService(drizzle(clientA));
    const serviceB = createDriverService(drizzle(clientB));

    try {
      const [a, b] = await Promise.allSettled([
        serviceA.arrivePool(JASHIM.id, poolId),
        serviceB.arrivePool(JASHIM.id, poolId),
      ]);
      const winners = [a, b].filter((r) => r.status === "fulfilled");
      const losers = [a, b].filter(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult[];
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0]!.reason).toMatchObject({
        code: "INVALID_STATE_TRANSITION",
        statusCode: 409,
      });

      expect((await poolRow(poolId)).status).toBe("DRIVER_ARRIVED");
      // Both rides reached DRIVER_ARRIVED exactly once (REQUESTED + MATCHED share
      // the create-transaction timestamp, so compare the reached-state SET).
      for (const rideId of [n.ride.id, r.ride.id]) {
        await expect((await historyOf(rideId)).slice().sort()).toEqual(
          ["REQUESTED", "MATCHED", "DRIVER_ARRIVED"].sort(),
        );
      }
    } finally {
      await clientA.end();
      await clientB.end();
    }
  });

  it("two concurrent completes: one wins, the pool is COMPLETED once, Bullet freed", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    await driver.acceptPool(JASHIM.id, poolId);
    await driver.arrivePool(JASHIM.id, poolId);
    await driver.startPool(JASHIM.id, poolId);

    const clientA = postgres(testUrl, { max: 1 });
    const clientB = postgres(testUrl, { max: 1 });
    const serviceA = createDriverService(drizzle(clientA));
    const serviceB = createDriverService(drizzle(clientB));

    try {
      const [a, b] = await Promise.allSettled([
        serviceA.completePool(JASHIM.id, poolId),
        serviceB.completePool(JASHIM.id, poolId),
      ]);
      const winners = [a, b].filter((r) => r.status === "fulfilled");
      const losers = [a, b].filter(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult[];
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0]!.reason).toMatchObject({
        code: "INVALID_STATE_TRANSITION",
        statusCode: 409,
      });
      expect((await poolRow(poolId)).status).toBe("COMPLETED");

      // Bullet freed: a fresh booking matches immediately after the race.
      const next = await rides.createRequest(SHIRIN, booking());
      expect(next.ride.status).toBe("MATCHED");
      expect(next.ride.pool?.id).not.toBe(poolId);
    } finally {
      await clientA.end();
      await clientB.end();
    }
  });

  it("offline toggle racing a booking never strands a pool on an offline Tesla", async () => {
    const clientA = postgres(testUrl, { max: 1 });
    const clientB = postgres(testUrl, { max: 1 });
    const serviceA = createDriverService(drizzle(clientA));
    const serviceB = createRideService(drizzle(clientB));

    try {
      // ADR-022 decoupled the two: matching never selects a Tesla, so the
      // booking lands in an UNASSIGNED wait pool no matter what. The offline
      // toggle is never blocked by it (unassigned pools carry driver_id NULL),
      // so BOTH succeed regardless of commit order — no serialization point,
      // no contingency branches.
      const [offline, book] = await Promise.all([
        serviceA.setAvailability(JASHIM.id, false),
        serviceB.createRequest(NUSRAT, booking()),
      ]);
      expect(offline).toBeUndefined();
      expect(book.ride.status).toBe("MATCHED");
      expect((await poolRow(book.ride.pool!.id)).vehicleId).toBeNull();

      // The invariant either way: Bullet is offline and holds no pool at all —
      // the wait pool references no Tesla by construction.
      await expect(bulletRow()).resolves.toMatchObject({ isOnline: false });
      const bulletPools = await db
        .select()
        .from(pools)
        .where(eq(pools.vehicleId, SEED_IDS.bullet));
      expect(bulletPools).toHaveLength(0);
    } finally {
      await clientA.end();
      await clientB.end();
    }
  });
});