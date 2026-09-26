// Pooling integration + concurrency tests (Phase 5).
//
// Runs against the disposable `_test` database (created/dropped per run) using
// DISPOSABLE AUTH fakes (no Clerk). The canonical story cast is used
// throughout: Jashim drives Bullet; Nusrat books Banani → Mohakhali; Rafiq
// books Banani → Gulshan 1 (overlapping, not identical); Shirin races for
// Bullet's last seat. See AGENTS.md "PROJECT CONTEXT".
//
// Concurrency tests use TWO independent postgres connections (one per racing
// claim) so the two transactions genuinely run in parallel at the database —
// exactly the Nusrat-vs-Shirin final-seat scenario the PRD requires
// (docs/requirements.md §14/§15, ADR-017). Bullet's capacity can never exceed
// 3, whichever way the race is ordered.
//
// If the configured PostgreSQL is unreachable the suite is skipped (matching
// the database.test.ts convention).

import { and, eq, sql } from "drizzle-orm";
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
import { createPoolingService } from "../src/rides/pooling/service.js";
import {
  applyMigrations,
  isDatabaseReachable,
  resetTestDatabase,
} from "./database-utils.js";

const REACHABLE = await isDatabaseReachable(config.databaseUrl);
const describeDb = REACHABLE ? describe : describe.skip;

// Constraint-violation shape (drizzle wraps the PostgresError as .cause):
//   23505 = unique_violation.
function rejectionCode(code: string): { cause: { code: string } } {
  return { cause: { code } };
}

const Z = SEED_ZONE_IDS;

function passenger(id: string, name: string, email: string): AuthUser {
  return {
    id,
    clerkUserId: `user_2testPooling0000000000000${id.slice(0, 4)}`,
    name,
    email,
    role: "PASSENGER",
    active: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

const NUSRAT = passenger(SEED_IDS.nusrat, "Nusrat Haque", "nusrat@example.com");
const RAFIQ = passenger(SEED_IDS.rafiq, "Rafiq Rahman", "rafiq@example.com");
const SHIRIN = passenger(SEED_IDS.shirin, "Shirin Islam", "shirin@example.com");
// FAISA is a TEST-LOCAL fourth passenger (never in the seed cast — the seed has
// exactly three passengers). Inserted directly like driver.test.ts inserts
// KARIM, she is who grabs *Bullet's* last seat after Nusrat/Rafiq/Shirin filled
// it: under the one-active-ride rule (ADR-021) Nusrat may NOT book a second
// time, so a fourth claimer must be a distinct user.
const FAISA_ID = "a1000000-0000-4000-8000-000000000008";
const FAISA = passenger(FAISA_ID, "Faisa Akter", "faisa@example.com");

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
const BOOK_SHIRIN = {
  pickupZoneId: Z.banani,
  destinationZoneId: Z.mohakhali,
  requestedSeats: 1,
  clientRequestId: null,
};
const BOOK_DHANMONDI = {
  pickupZoneId: Z.banani,
  destinationZoneId: Z.dhanmondi,
  requestedSeats: 1,
  clientRequestId: null,
};
const BOOK_FAISA = {
  pickupZoneId: Z.banani,
  destinationZoneId: Z.gulshan,
  requestedSeats: 1,
  clientRequestId: null,
};

// Fake-auth tokens for the HTTP test (no Clerk, no network): tokens resolve to
// the SEEDED cast so every ride row satisfies the users FK.
const TOKENS = {
  nusrat: "tok-nusrat-pool",
  rafiq: "tok-rafiq-pool",
  shirin: "tok-shirin-pool",
} as const;
const TOKEN_TO_CLERK: Record<string, string> = {
  [TOKENS.nusrat]: `clerk::${SEED_IDS.nusrat}`,
  [TOKENS.rafiq]: `clerk::${SEED_IDS.rafiq}`,
  [TOKENS.shirin]: `clerk::${SEED_IDS.shirin}`,
};
const CLERK_TO_USER = new Map<string, AuthUser>([
  [TOKEN_TO_CLERK[TOKENS.nusrat], NUSRAT],
  [TOKEN_TO_CLERK[TOKENS.rafiq], RAFIQ],
  [TOKEN_TO_CLERK[TOKENS.shirin], SHIRIN],
]);

// ---------------------------------------------------------------------------
// Test database lifecycle
// ---------------------------------------------------------------------------

let testUrl: string;
let client: postgres.Sql<Record<string, never>>;
let db: ReturnType<typeof drizzle>;
let rides: RideService;

const booking = (
  overrides: Partial<typeof BOOK_NUSRAT> = {},
): typeof BOOK_NUSRAT => ({ ...BOOK_NUSRAT, ...overrides });

function wipeState(): Promise<unknown> {
  // Child tables first (FK order), keeping users/vehicles/zones seeded. The
  // app's live `db` handle is used so every test starts from a clean pool
  // state without recreating the database.
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

describeDb("pooling (Phase 5)", () => {
  beforeAll(async () => {
    testUrl = await resetTestDatabase(config.databaseUrl);
    await applyMigrations(testUrl);
    client = postgres(testUrl, { max: 1 });
    db = drizzle(client);
    await runSeed(db);
    // Faisa is a test-local fourth passenger (the three-seat cast fills the
    // pool with only three passengers alive at once under the one-active-ride
    // rule). Inserted directly, like driver.test.ts inserts KARIM.
    await db
      .insert(users)
      .values({
        id: FAISA_ID,
        clerkUserId: FAISA.clerkUserId,
        name: FAISA.name,
        email: FAISA.email,
        role: "PASSENGER",
        active: true,
      })
      .onConflictDoNothing();
    rides = createRideService(db);
  });

  beforeEach(async () => {
    await wipeState();
    await setBulletOnline(true);
  });

  afterAll(async () => {
    await client.end();
  });

  // -------------------------------------------------------------------------
  // Automatch + pooling behaviour
  // -------------------------------------------------------------------------

  it("always creates an unassigned wait pool, even with no online Tesla", async () => {
    // No Tesla being online no longer blocks a booking: every ride gets ONTO a
    // pool at create time (ADR-022). It becomes an UNASSIGNED wait pool that
    // some driver must accept — the offline fleet simply means nobody can
    // accept it yet.
    await setBulletOnline(false);
    const { ride } = await rides.createRequest(NUSRAT, booking());
    expect(ride.status).toBe("MATCHED");
    expect(ride.pool).toMatchObject({
      status: "MATCHED",
      capacitySnapshot: 3,
      occupiedSeats: 1,
      vehicleName: null,
      driverName: null,
    });
    expect(ride.fare.finalFarePaisa).toBe(5932);
  });

  it("automatches the first ride into a new UNASSIGNED wait pool", async () => {
    const { ride } = await rides.createRequest(NUSRAT, booking());
    expect(ride.status).toBe("MATCHED");
    // The pool waits for a driver: no vehicle, no driver, status MATCHED
    // (ADR-022). Once Jashim accepts it, the same pool gains Bullet.
    expect(ride.pool).toMatchObject({
      status: "MATCHED",
      capacitySnapshot: 3,
      occupiedSeats: 1,
      vehicleName: null,
      driverName: null,
    });
  });

  it("joins an overlapping ride into the same pool and recomputes BOTH fares", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const r = await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));

    expect(r.ride.pool?.id).toBe(n.ride.pool?.id);
    expect(r.ride.pool?.occupiedSeats).toBe(2);

    // Nusrat Banani → Mohakhali: 3000 + 2932 - 1483 = 4449 paisa.
    // Rafiq  Banani → Gulshan 1: 3000 + 1140 - 1035 = 3105 paisa.
    // (deterministic pinned values, see test/fare.test.ts).
    const [nusratFare] = await db
      .select()
      .from(fares)
      .where(eq(fares.rideRequestId, n.ride.id));
    const [rafiqFare] = await db
      .select()
      .from(fares)
      .where(eq(fares.rideRequestId, r.ride.id));
    expect(nusratFare?.poolDiscountPaisa).toBe(1483);
    expect(nusratFare?.finalFarePaisa).toBe(4449);
    expect(nusratFare?.baseFarePaisa).toBe(3000);
    expect(nusratFare?.distanceChargePaisa).toBe(2932);
    expect(rafiqFare?.poolDiscountPaisa).toBe(1035);
    expect(rafiqFare?.finalFarePaisa).toBe(3105);
  });

  it("never exceeds Bullet's capacity (sequential claims)", async () => {
    const first = await rides.createRequest(NUSRAT, booking());
    const second = await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));
    const third = await rides.createRequest(SHIRIN, booking(BOOK_SHIRIN));

    expect(first.ride.status).toBe("MATCHED");
    expect(second.ride.status).toBe("MATCHED");
    expect(third.ride.status).toBe("MATCHED");
    // The final booking's view reflects the settled pool: 3/3 seats taken.
    expect(third.ride.pool?.occupiedSeats).toBe(3);

    // 3/3 seats taken — a FOURTH passenger's 1-seat request cannot fit the
    // pool, so it starts its OWN unassigned wait pool instead of stalling
    // REQUESTED (the "always create a wait pool" model, ADR-022). (It is
    // FAISA who claims now: Nusrat already holds an ACTIVE ride and the
    // one-active-ride rule would reject her second booking with 409 before
    // pooling even runs — see the concurrency suite below.)
    const fourth = await rides.createRequest(FAISA, booking(BOOK_FAISA));
    expect(fourth.ride.status).toBe("MATCHED");
    expect(fourth.ride.pool?.status).toBe("MATCHED");
    expect(fourth.ride.pool?.occupiedSeats).toBe(1);
    expect(fourth.ride.pool?.id).not.toBe(first.ride.pool!.id);
    expect(fourth.ride.pool?.vehicleName).toBeNull();

    const [poolRow] = await db
      .select()
      .from(pools)
      .where(eq(pools.id, first.ride.pool!.id));
    expect(poolRow?.capacitySnapshot).toBe(3);
    expect(poolRow?.vehicleId).toBeNull();
    expect(poolRow?.driverId).toBeNull();
    // Occupancy is DERIVED from ACTIVE memberships; still 3, never 4.
    const seats = await db
      .select({
        occupied: sql<number>`coalesce(sum(${poolMembers.seats}), 0)::int`,
      })
      .from(poolMembers)
      .where(eq(poolMembers.poolId, first.ride.pool!.id));
    expect(seats[0]?.occupied).toBe(3);
  });

  it("gives a far drop-off its own wait pool instead of joining an incompatible one", async () => {
    const near = await rides.createRequest(NUSRAT, booking());
    const far = await rides.createRequest(SHIRIN, booking(BOOK_DHANMONDI));
    // Dhanmondi is outside POOL_DEST_SPREAD_KM from Mohakhali, so the far
    // request does not join Nusrat's pool — it becomes its own UNASSIGNED
    // wait pool (docs/requirements.md §21.M). Never stalls REQUESTED.
    expect(far.ride.status).toBe("MATCHED");
    expect(far.ride.pool?.status).toBe("MATCHED");
    expect(far.ride.pool?.occupiedSeats).toBe(1);
    expect(far.ride.pool?.id).not.toBe(near.ride.pool!.id);
  });

  it("a 2-seat ride claims two seats; a later 1-seat ride only fits with 3 free", async () => {
    const big = await rides.createRequest(NUSRAT, booking({ requestedSeats: 2 }));
    expect(big.ride.pool?.occupiedSeats).toBe(2);
    // Single member → no discount; total = 2 × 5932.
    expect(big.ride.fare.finalFarePaisa).toBe(5932);
    expect(big.ride.fare.estimatedTotalPaisa).toBe(11864);

    const rafiq = await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));
    expect(rafiq.ride.status).toBe("MATCHED");
    expect(rafiq.ride.pool?.occupiedSeats).toBe(3);

    // The two members now both get the 25 % pooled discount.
    expect(big.ride.fare.estimatedTotalPaisa).toBe(11864);
    const [bigFare] = await db
      .select()
      .from(fares)
      .where(eq(fares.rideRequestId, big.ride.id));
    expect(bigFare?.poolDiscountPaisa).toBe(1483);
    expect(bigFare?.finalFarePaisa).toBe(4449);

    // No seat left for a third in THIS pool — Shirin gets her own wait pool
    // (ADR-022: a claim that no longer fits never stalls REQUESTED).
    const shirin = await rides.createRequest(SHIRIN, booking());
    expect(shirin.ride.status).toBe("MATCHED");
    expect(shirin.ride.pool?.occupiedSeats).toBe(1);
    expect(shirin.ride.pool?.id).not.toBe(rafiq.ride.pool!.id);
  });

  it("a 3-seat request fills its wait pool; the next request gets its own", async () => {
    const full = await rides.createRequest(NUSRAT, booking({ requestedSeats: 3 }));
    expect(full.ride.pool?.occupiedSeats).toBe(3);
    expect(full.ride.fare.estimatedTotalPaisa).toBe(3 * 5932);

    const late = await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));
    expect(late.ride.status).toBe("MATCHED");
    expect(late.ride.pool?.status).toBe("MATCHED");
    expect(late.ride.pool?.occupiedSeats).toBe(1);
    expect(late.ride.pool?.id).not.toBe(full.ride.pool!.id);
  });

  // -------------------------------------------------------------------------
  // Cancellation rules (docs/requirements.md §21.B)
  // -------------------------------------------------------------------------

  it("cancelling the only member of an unassigned wait pool cancels the pool", async () => {
    // Every booking lands in a pool at create time (ADR-022), so a cancel
    // from a fresh wait pool frees its seat and, having no other members,
    // terminates the pool itself.
    const { ride } = await rides.createRequest(NUSRAT, booking());
    const poolId = ride.pool!.id;
    expect(ride.status).toBe("MATCHED");

    const cancelled = await rides.cancelRequest(NUSRAT, ride.id);
    expect(cancelled.status).toBe("CANCELLED");

    const history = await db
      .select()
      .from(rideStatusHistory)
      .where(eq(rideStatusHistory.rideRequestId, ride.id))
      .orderBy(rideStatusHistory.createdAt, rideStatusHistory.id);
    // REQUESTED + MATCHED are journaled inside the SAME create transaction
    // with identical timestamps, so their relative order is nondeterministic
    // (uuid id tiebreak) — assert the reached-state SET plus the cancellation
    // link (same convention as rides.test.ts).
    expect(history.map((h) => h.status).slice().sort()).toEqual(
      ["REQUESTED", "MATCHED", "CANCELLED"].sort(),
    );
    expect(history.find((h) => h.status === "CANCELLED")?.fromStatus).toBe("MATCHED");

    const [poolRow] = await db.select().from(pools).where(eq(pools.id, poolId));
    expect(poolRow?.status).toBe("CANCELLED");
  });

  it("cancelling a MATCHED ride frees its seat and recomputes the remaining fare", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const r = await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));
    const poolId = r.ride.pool!.id;

    await rides.cancelRequest(RAFIQ, r.ride.id);

    const [poolRow] = await db.select().from(pools).where(eq(pools.id, poolId));
    expect(poolRow?.status).toBe("MATCHED"); // not emptied -> stays alive
    // The membership row is retained for history but flipped to LEFT.
    const allMembers = await db
      .select()
      .from(poolMembers)
      .where(eq(poolMembers.poolId, poolId));
    expect(allMembers).toHaveLength(2);
    const active = allMembers.filter((m) => m.status === "ACTIVE");
    const left = allMembers.filter((m) => m.status === "LEFT");
    expect(active).toHaveLength(1);
    expect(left).toHaveLength(1);

    // Nusrat is the only ACTIVE member again => discount reverts to 0.
    const [nusratFare] = await db
      .select()
      .from(fares)
      .where(eq(fares.rideRequestId, n.ride.id));
    expect(nusratFare?.poolDiscountPaisa).toBe(0);
    expect(nusratFare?.finalFarePaisa).toBe(5932);
  });

  it("cancelling the last member terminates the pool", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;

    await rides.cancelRequest(NUSRAT, n.ride.id);

    const [poolRow] = await db.select().from(pools).where(eq(pools.id, poolId));
    expect(poolRow?.status).toBe("CANCELLED");
    const members = await db
      .select()
      .from(poolMembers)
      .where(eq(poolMembers.poolId, poolId));
    expect(members[0]?.status).toBe("LEFT");
  });

  it("rejects cancel after the ride is already terminal (409)", async () => {
    const { ride } = await rides.createRequest(NUSRAT, booking());
    await rides.cancelRequest(NUSRAT, ride.id); // ok -> CANCELLED

    await expect(
      rides.cancelRequest(NUSRAT, ride.id),
    ).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
      statusCode: 409,
    });
  });

  // -------------------------------------------------------------------------
  // Force-cancel (full refund)
  // -------------------------------------------------------------------------

  it("force-cancels with a full refund and recomputes the remaining passenger", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const r = await rides.createRequest(RAFIQ, booking(BOOK_RAFIQ));

    const pooling = createPoolingService({ database: db });
    await pooling.forceCancelRide(r.ride.id);

    const [rafiqFare] = await db
      .select()
      .from(fares)
      .where(eq(fares.rideRequestId, r.ride.id));
    // Full refund: base + distance fully reversed via the discount term,
    // final = 0 (all fares CHECKs stay satisfied).
    expect(rafiqFare?.poolDiscountPaisa).toBe(3000 + 1140);
    expect(rafiqFare?.finalFarePaisa).toBe(0);

    // Nusrat is alone again: no pooled discount.
    const [nusratFare] = await db
      .select()
      .from(fares)
      .where(eq(fares.rideRequestId, n.ride.id));
    expect(nusratFare?.finalFarePaisa).toBe(5932);
    expect(nusratFare?.poolDiscountPaisa).toBe(0);
  });

  it("force-cancelling the last member refunds and terminates the pool", async () => {
    const n = await rides.createRequest(NUSRAT, booking());
    const poolId = n.ride.pool!.id;

    const pooling = createPoolingService({ database: db });
    await pooling.forceCancelRide(n.ride.id);

    const [fare] = await db
      .select()
      .from(fares)
      .where(eq(fares.rideRequestId, n.ride.id));
    expect(fare?.finalFarePaisa).toBe(0);

    const [poolRow] = await db.select().from(pools).where(eq(pools.id, poolId));
    expect(poolRow?.status).toBe("CANCELLED");
  });

  // -------------------------------------------------------------------------
  // HTTP surface (cancel ownership = 404, terminal = 409)
  // -------------------------------------------------------------------------

  it("exposes the cancel endpoint over HTTP with ownership + state semantics", async () => {
    const app: FastifyInstance = buildApp({
      auth: {
        verifySession: async (token: string) => TOKEN_TO_CLERK[token] ?? null,
        resolveLocalUser: async (clerkId: string) =>
          CLERK_TO_USER.get(clerkId) ?? null,
        provisionLocalUser: async () => null,
      },
      rides: createRideService(db),
    });

    try {
      const nusrat = await rides.createRequest(NUSRAT, booking());
      const path = `/api/rides/${nusrat.ride.id}/cancel`;

      // Not the owner -> 404 (never reveals that the ride exists).
      const other = await app.inject({
        method: "POST",
        url: path,
        headers: { authorization: `Bearer ${TOKENS.shirin}` },
      });
      expect(other.statusCode).toBe(404);
      expect(other.json().error.code).toBe("NOT_FOUND");

      // The owner can cancel; response reflects the final CANCELLED state.
      const mine = await app.inject({
        method: "POST",
        url: path,
        headers: { authorization: `Bearer ${TOKENS.nusrat}` },
      });
      expect(mine.statusCode).toBe(200);
      expect(mine.json().ride.status).toBe("CANCELLED");

      // Cancelling a ride that is already CANCELLED is a 409 state-machine
      // violation (not a silent data write).
      const twice = await app.inject({
        method: "POST",
        url: path,
        headers: { authorization: `Bearer ${TOKENS.nusrat}` },
      });
      expect(twice.statusCode).toBe(409);
      expect(twice.json().error.code).toBe("INVALID_STATE_TRANSITION");
    } finally {
      await app.close();
    }
  });

  // -------------------------------------------------------------------------
  // Atomicity: a downstream failure rolls the whole match back
  // -------------------------------------------------------------------------

  it("rolls the create+match back when the fare recompute throws", async () => {
    const throwing = createPoolingService({
      database: db,
      recomputeFares: async () => {
        throw new Error("recompute failure injected by test");
      },
    });
    const brokenRides = createRideService(db, { pooling: throwing });

    const counts = async () =>
      Promise.all([
        db.select().from(rideRequests),
        db.select().from(fares),
        db.select().from(pools),
        db.select().from(poolMembers),
      ]).then((sets) => sets.map((s) => s.length));

    const before = await counts();
    await expect(brokenRides.createRequest(NUSRAT, booking())).rejects.toThrow();
    const after = await counts();
    // Nothing persisted: ride, fare, pool, membership all rolled back.
    expect(after).toEqual(before);
  });

  // -------------------------------------------------------------------------
  // Concurrency (the PRD's Nusrat-vs-Shirin final-seat race)
  // -------------------------------------------------------------------------

  it("lets exactly one concurrent claim take the final seat; the loser gets its own wait pool", async () => {
    // Pre-occupied pool: Nusrat books TWO seats (a single 2-seat ride).
    const n = await rides.createRequest(NUSRAT, booking({ requestedSeats: 2 }));
    expect(n.ride.pool?.occupiedSeats).toBe(2);

    // Two independent connections race for the pool's last seat concurrently:
    // Rafiq (Banani → Gulshan 1) vs Shirin (Banani → Mohakhali). Both routes
    // overlap the pool's occupants within POOL_DEST_SPREAD_KM, so both target
    // the SAME pool — exactly one may win the final seat. The loser never
    // stalls REQUESTED: it starts its own UNASSIGNED wait pool (ADR-022).
    const clientA = postgres(testUrl, { max: 1 });
    const clientB = postgres(testUrl, { max: 1 });
    const serviceA = createRideService(drizzle(clientA));
    const serviceB = createRideService(drizzle(clientB));

    try {
      const [a, b] = await Promise.all([
        serviceA.createRequest(RAFIQ, booking(BOOK_RAFIQ)),
        serviceB.createRequest(SHIRIN, booking(BOOK_SHIRIN)),
      ]);

      expect(a.ride.status).toBe("MATCHED");
      expect(b.ride.status).toBe("MATCHED");

      // The seat winner rides in the CONTESTED pool; the loser rides its own
      // 1-seat wait pool elsewhere (never ACCEPTED into the contested pool).
      const contender = a.ride.pool!.id === n.ride.pool!.id ? a : b;
      const loser = contender === a ? b : a;
      expect(contender.ride.pool!.id).toBe(n.ride.pool!.id);
      expect(loser.ride.pool!.id).not.toBe(n.ride.pool!.id);
      expect(loser.ride.pool?.occupiedSeats).toBe(1);

      // The contested pool still holds exactly 3 seats — never 4.
      const seats = await db
        .select({
          occupied: sql<number>`coalesce(sum(${poolMembers.seats}), 0)::int`,
        })
        .from(poolMembers)
        .where(eq(poolMembers.poolId, n.ride.pool!.id));
      expect(seats[0]?.occupied).toBe(3);

      // The loser holds NO ACTIVE membership in the contested pool — exactly
      // Nusrat + the seat winner ride there.
      const contestedMembers = await db
        .select()
        .from(poolMembers)
        .where(eq(poolMembers.poolId, n.ride.pool!.id));
      expect(contestedMembers).toHaveLength(2);

      // No pool anywhere exceeds the 3-seat capacity.
      const allPools = await db.select().from(pools);
      for (const pool of allPools) {
        const occupied = await db
          .select({
            n: sql<number>`coalesce(sum(${poolMembers.seats}), 0)::int`,
          })
          .from(poolMembers)
          .where(
            and(
              eq(poolMembers.poolId, pool.id),
              eq(poolMembers.status, "ACTIVE"),
            ),
          );
        expect(occupied[0]?.n).toBeLessThanOrEqual(pool.capacitySnapshot);
      }
    } finally {
      await clientA.end();
      await clientB.end();
    }
  });

  it("creates SEPARATE wait pools for two concurrent first-claims (accepted tradeoff)", async () => {
    // Empty state: no pool exists, both requests race to claim a seat at the
    // same moment. Neither finds an eligible pool, so EACH starts its own
    // UNASSIGNED wait pool. This is the documented, accepted tradeoff of
    // passenger-first matching (ADR-022): occupancy is always right and no
    // seat is ever double-booked, but two concurrent first-rides can briefly
    // form two pools where a cooperative driver pool could have joined them.
    const clientA = postgres(testUrl, { max: 1 });
    const clientB = postgres(testUrl, { max: 1 });
    const serviceA = createRideService(drizzle(clientA));
    const serviceB = createRideService(drizzle(clientB));

    try {
      const [a, b] = await Promise.all([
        serviceA.createRequest(NUSRAT, booking()),
        serviceB.createRequest(RAFIQ, booking(BOOK_RAFIQ)),
      ]);

      expect(a.ride.status).toBe("MATCHED");
      expect(b.ride.status).toBe("MATCHED");
      expect(a.ride.pool?.id).not.toBe(b.ride.pool?.id);

      const poolRows = await db.select().from(pools);
      expect(poolRows).toHaveLength(2);
      for (const pool of poolRows) {
        expect(pool.status).toBe("MATCHED");
        expect(pool.vehicleId).toBeNull();
        expect(pool.driverId).toBeNull();
        expect(pool.capacitySnapshot).toBe(3);
      }

      // Each wait pool holds exactly its own member; no pool can exceed its
      // capacity no matter how the race was ordered.
      for (const pool of poolRows) {
        const occupied = await db
          .select({
            n: sql<number>`coalesce(sum(${poolMembers.seats}), 0)::int`,
          })
          .from(poolMembers)
          .where(eq(poolMembers.poolId, pool.id));
        expect(occupied[0]?.n).toBe(1);
      }

      // Two separate single-member pools: no pooled discount in either.
      const faresN = await db
        .select()
        .from(fares)
        .where(eq(fares.rideRequestId, a.ride.id));
      expect(faresN[0]?.poolDiscountPaisa).toBe(0);
    } finally {
      await clientA.end();
      await clientB.end();
    }
  });

  it("races the SAME passenger on two connections without a key: one ride, one 409 (ADR-021)", async () => {
    // The strictest form of the one-active-ride rule: the same passenger
    // submits twice at once, no idempotency key, on two truly parallel
    // connections. The partial unique index
    // ride_requests_one_active_per_passenger is the arbiter: exactly one
    // booking persists, the loser surfaces 409 ACTIVE_RIDE_EXISTS (whether it
    // collides at the service pre-check or inside the transaction on the
    // index itself — both leave exactly one ride).
    const clientA = postgres(testUrl, { max: 1 });
    const clientB = postgres(testUrl, { max: 1 });
    const serviceA = createRideService(drizzle(clientA));
    const serviceB = createRideService(drizzle(clientB));

    try {
      const [a, b] = await Promise.allSettled([
        serviceA.createRequest(NUSRAT, booking()),
        serviceB.createRequest(NUSRAT, booking()),
      ]);

      const fulfilled = a.status === "fulfilled" ? a.value : b.status === "fulfilled" ? b.value : null;
      const rejected = a.status === "rejected" ? a : b;
      expect(fulfilled).not.toBeNull();
      expect(fulfilled!.ride.status).toBe("MATCHED");
      expect(rejected.status).toBe("rejected");
      expect(rejected.reason).toMatchObject({
        code: "ACTIVE_RIDE_EXISTS",
        statusCode: 409,
      });

      // Exactly ONE ride row for Nusrat — never two double-booked rides.
      const rows = await db
        .select()
        .from(rideRequests)
        .where(eq(rideRequests.passengerId, SEED_IDS.nusrat));
      expect(rows).toHaveLength(1);
    } finally {
      await clientA.end();
      await clientB.end();
    }
  });

  it("rejects a second ACCEPTED non-terminal pool per driver at the DB level", async () => {
    // A driver may hold at most one accepted non-terminal pool (ADR-022). Even
    // with application logic bypassed, the partial unique index
    // pools_single_accepted_per_driver must enforce it on disk. (Unassigned
    // wait pools carry driver_id NULL and never contend.)
    await rides.createRequest(NUSRAT, booking());
    const now = new Date();

    await expect(
      db.insert(pools).values({
        vehicleId: SEED_IDS.bullet,
        driverId: SEED_IDS.jashim,
        status: "MATCHED",
        capacitySnapshot: 3,
        acceptedAt: now,
      }),
    ).resolves.toBeDefined();

    await expect(
      db.insert(pools).values({
        vehicleId: SEED_IDS.bullet,
        driverId: SEED_IDS.jashim,
        status: "MATCHED",
        capacitySnapshot: 3,
        acceptedAt: new Date(),
      }),
    ).rejects.toMatchObject(rejectionCode("23505"));
  });
});