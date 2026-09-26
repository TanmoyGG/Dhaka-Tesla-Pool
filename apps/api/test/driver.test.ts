// Driver workflow integration + concurrency tests (Phase 6).
//
// Runs against the disposable `_test` database with DISPOSABLE AUTH fakes (no
// Clerk). Canonical cast: Jashim drives Bullet (3 seats); Nusrat/Rafiq/Shirin
// are the passengers; KARIM is a second DRIVER inserted directly — he is the
// interloper who must be locked out (404) from Jashim's pools.
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

// A second driver who owns NO pool: the interloper for ownership tests.
const KARIM_ID = "a1000000-0000-4000-8000-000000000009";

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
const KARIM = user(KARIM_ID, "Karim Mondol", "karim@example.com", "DRIVER");
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
} as const;
const TOKEN_TO_CLERK: Record<string, string> = {
  [TOKENS.jashim]: `clerk::${SEED_IDS.jashim}`,
  [TOKENS.karim]: `clerk::${KARIM_ID}`,
  [TOKENS.nusrat]: `clerk::${SEED_IDS.nusrat}`,
};
const CLERK_TO_USER = new Map<string, AuthUser>([
  [TOKEN_TO_CLERK[TOKENS.jashim], JASHIM],
  [TOKEN_TO_CLERK[TOKENS.karim], KARIM],
  [TOKEN_TO_CLERK[TOKENS.nusrat], NUSRAT],
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
    // Karim exists only as a DRIVER user (no vehicles): he is how the
    // interloper 404 is exercised, never an owner.
    await db
      .insert(users)
      .values({
        id: KARIM_ID,
        clerkUserId: KARIM.clerkUserId,
        name: KARIM.name,
        email: KARIM.email,
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

  it("refuses going offline while a MATCHED pool exists; Bullet stays online", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    expect(n.ride.status).toBe("MATCHED");

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

  it("an offline Tesla cannot take a new booking (stays REQUESTED)", async () => {
    await setBulletOnline(false);
    const { ride } = await rides.createRequest(NUSRAT, booking());
    expect(ride.status).toBe("REQUESTED");
    expect(ride.pool).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Accept
  // -------------------------------------------------------------------------

  it("accept confirms a MATCHED pool, records accepted_at, keeps MATCHED, and is idempotent", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;

    const view1 = await driver.acceptPool(JASHIM.id, poolId);
    expect(view1.status).toBe("MATCHED");
    expect(view1.acceptedAt).not.toBeNull();
    const firstAccepted = (await poolRow(poolId)).acceptedAt;

    // Repeat accept: no-op, same accepted_at, still 200 (idempotent).
    const view2 = await driver.acceptPool(JASHIM.id, poolId);
    expect(view2.acceptedAt).toEqual(firstAccepted);
    expect((await poolRow(poolId)).acceptedAt).toEqual(firstAccepted);
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

  it("rejects accepting when the pool's own Tesla is offline (VEHICLE_OFFLINE)", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;

    // Force the pool's own Tesla offline behind the service's back: the
    // accept guard reads the pool's OWN vehicle row, not the driver's choice.
    await db
      .update(vehicles)
      .set({ isOnline: false, updatedAt: new Date() })
      .where(eq(vehicles.id, SEED_IDS.bullet));

    await expect(
      driver.acceptPool(JASHIM.id, poolId),
    ).rejects.toMatchObject({ code: "VEHICLE_OFFLINE", statusCode: 409 });
  });

  it("an interloper driver gets 404 on accept (existence hidden)", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    await expect(driver.acceptPool(KARIM.id, poolId)).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
  });

  it("accepting an unknown/nonexistent pool id is a plain 404", async () => {
    await expect(
      driver.acceptPool(JASHIM.id, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  // -------------------------------------------------------------------------
  // Lifecycle: accept → arrive → start → complete
  // -------------------------------------------------------------------------

  it("arriving requires a prior accept (POOL_NOT_ACCEPTABLE)", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;
    await expect(
      driver.arrivePool(JASHIM.id, poolId),
    ).rejects.toMatchObject({ code: "POOL_NOT_ACCEPTABLE", statusCode: 409 });
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

  it("lists only the driver's own non-terminal pools, newest first, fare-free", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));
    const poolId = n.ride.pool!.id;

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

  it("pool detail 404s for another driver and for unknown ids; reflects isOnline", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;

    await expect(driver.getDriverPool(KARIM.id, poolId)).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
    await expect(
      driver.getDriverPool(JASHIM.id, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });

    const view = await driver.getDriverPool(JASHIM.id, poolId);
    expect(view.vehicle.isOnline).toBe(true);
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

  it("availability toggles over HTTP (204) and rejects off-line with an active pool", async () => {
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

      const blocked = await app.inject({
        method: "POST",
        url: "/api/driver/availability",
        payload: { isOnline: false },
        headers: { authorization: `Bearer ${TOKENS.jashim}` },
      });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.code).toBe("DRIVER_HAS_ACTIVE_POOL");

      const badBody = await app.inject({
        method: "POST",
        url: "/api/driver/availability",
        payload: { isOnline: "yes" },
        headers: { authorization: `Bearer ${TOKENS.jashim}` },
      });
      expect(badBody.statusCode).toBe(400);
      expect(badBody.json().error.code).toBe("VALIDATION_ERROR");
    } finally {
      await app.close();
    }
  });

  it("drives the full lifecycle over HTTP with interloper 404s", async () => {
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

      // Interloper cannot act on Jashim's pool — every action 404s.
      for (const action of ["accept", "arrive", "start", "complete"]) {
        const intruder = await app.inject({
          method: "POST",
          url: `/api/driver/pools/${poolId}/${action}`,
          headers: karim,
        });
        expect(intruder.statusCode).toBe(404);
        expect(intruder.json().error.code).toBe("NOT_FOUND");
      }

      const detail = await app.inject({
        method: "GET",
        url: `/api/driver/pools/${poolId}`,
        headers: jashim,
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().pool.status).toBe("MATCHED");
      expect(detail.json().pool.members).toHaveLength(2);

      const accept = await app.inject({
        method: "POST",
        url: `/api/driver/pools/${poolId}/accept`,
        headers: jashim,
      });
      expect(accept.statusCode).toBe(200);
      expect(accept.json().pool.status).toBe("MATCHED");
      expect(accept.json().pool.acceptedAt).toBeTruthy();

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

  it("two concurrent accepts on the same pool both succeed idempotently (single accepted_at)", async () => {
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
      // Bullet is online; a booking and an offline toggle race. The shared
      // serialization point is Bullet's row: one of the two commits first.
      const [offline, book] = await Promise.allSettled([
        serviceA.setAvailability(JASHIM.id, false),
        serviceB.createRequest(NUSRAT, booking()),
      ]);

      const isOnline = (await bulletRow()).isOnline;
      if (offline.status === "rejected") {
        // The booking created a pool first; the offline toggle was refused by
        // DRIVER_HAS_ACTIVE_POOL (which is why it rejected).
        expect(book.status).toBe("fulfilled");
        expect((book as PromiseFulfilledResult<Awaited<ReturnType<typeof serviceB.createRequest>>>).value.ride.status).toBe("MATCHED");
        expect(isOnline).toBe(true);
      } else {
        // The toggle won the lock; the booking saw an offline Tesla.
        expect(isOnline).toBe(false);
        expect(book.status).toBe("fulfilled");
        expect((book as PromiseFulfilledResult<Awaited<ReturnType<typeof serviceB.createRequest>>>).value.ride.status).toBe("REQUESTED");
      }
      // The invariant either way: an offline Bullet holds no non-terminal pool.
      const activePools = await db
        .select()
        .from(pools)
        .where(eq(pools.vehicleId, SEED_IDS.bullet));
      if (!isOnline) {
        expect(activePools).toHaveLength(0);
      }
    } finally {
      await clientA.end();
      await clientB.end();
    }
  });
});