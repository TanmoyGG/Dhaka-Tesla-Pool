// Ride-request integration tests (Phase 4).
//
// These run against the disposable `_test` database (created and dropped per
// run, never touching dev data) with DISPOSABLE AUTH fakes — no Clerk, no
// network. The auth fakes resolve fixed tokens to the SEEDED story cast
// (Nusrat / Rafiq / Jashim) so every ride row satisfies the users FK.
//
// If the configured PostgreSQL is unreachable the suite is skipped, matching
// the database.test.ts convention.

import { type FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { buildApp } from "../src/app.js";
import { SEED_IDS, SEED_ZONE_IDS, runSeed } from "../src/db/seed.js";
import { fares, rideRequests, rideStatusHistory } from "../src/db/schema.js";
import { createRideService } from "../src/rides/service.js";
import type { AuthDependencies, AuthUser } from "../src/auth/identity.js";
import {
  applyMigrations,
  isDatabaseReachable,
  resetTestDatabase,
} from "./database-utils.js";

const REACHABLE = await isDatabaseReachable(config.databaseUrl);
const describeDb = REACHABLE ? describe : describe.skip;

const CLERK_NUSRAT = "user_2nusratRideIntegration00001";
const CLERK_RAFIQ = "user_2rafiqRideIntegration00001";
const CLERK_JASHIM = "user_2jashimRideIntegration00001";
const CLERK_INACTIVE = "user_2inactiveRideIntegration0001";

const ZONE_IDS = {
  banani: SEED_ZONE_IDS.banani,
  mohakhali: SEED_ZONE_IDS.mohakhali,
  gulshan: SEED_ZONE_IDS.gulshan,
};

function makeUser(overrides: Partial<AuthUser>): AuthUser {
  return {
    id: SEED_IDS.nusrat,
    clerkUserId: CLERK_NUSRAT,
    name: "Nusrat Haque",
    email: "nusrat@example.com",
    role: "PASSENGER",
    active: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const USERS_BY_CLERK_ID = new Map<string, AuthUser>([
  [CLERK_NUSRAT, makeUser({})],
  [
    CLERK_RAFIQ,
    makeUser({
      id: SEED_IDS.rafiq,
      clerkUserId: CLERK_RAFIQ,
      name: "Rafiq Rahman",
      email: "rafiq@example.com",
    }),
  ],
  [
    CLERK_JASHIM,
    makeUser({
      id: SEED_IDS.jashim,
      clerkUserId: CLERK_JASHIM,
      name: "Jashim Ahmed",
      email: "jashim@example.com",
      role: "DRIVER",
    }),
  ],
  [
    CLERK_INACTIVE,
    makeUser({
      id: SEED_IDS.shirin,
      clerkUserId: CLERK_INACTIVE,
      name: "Shirin Islam",
      email: "shirin@example.com",
      active: false,
    }),
  ],
]);

function makeFakeAuth(): Partial<AuthDependencies> {
  return {
    verifySession: async (token) => {
      switch (token) {
        case "tok-passenger":
          return CLERK_NUSRAT;
        case "tok-rafiq":
          return CLERK_RAFIQ;
        case "tok-driver":
          return CLERK_JASHIM;
        case "tok-inactive":
          return CLERK_INACTIVE;
        default:
          return null;
      }
    },
    resolveLocalUser: async (clerkUserId) =>
      USERS_BY_CLERK_ID.get(clerkUserId) ?? null,
    provisionLocalUser: async () => null,
  };
}

const AUTH = (token: string) => ({ authorization: `Bearer ${token}` });

let db: ReturnType<typeof drizzle>;
let client: postgres.Sql<Record<string, never>>;
let app: FastifyInstance;

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    pickupZoneId: ZONE_IDS.banani,
    destinationZoneId: ZONE_IDS.mohakhali,
    requestedSeats: 1,
    ...overrides,
  };
}

describeDb("ride requests (Phase 4)", () => {
  beforeAll(async () => {
    const testUrl = await resetTestDatabase(config.databaseUrl);
    await applyMigrations(testUrl);
    client = postgres(testUrl, { max: 1 });
    db = drizzle(client);
    await runSeed(db);
    app = buildApp({
      auth: makeFakeAuth(),
      rides: createRideService(db),
    });
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("requires a verified session for every /api route", async () => {
    for (const method of ["GET", "POST"]) {
      const res = await app.inject({ method, url: "/api/rides" });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: { code: "AUTH_UNAUTHENTICATED" } });
    }
    const zones = await app.inject({ method: "GET", url: "/api/zones" });
    expect(zones.statusCode).toBe(401);
  });

  it("exposes the predefined zones to an authenticated caller (sorted by name)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/zones",
      headers: AUTH("tok-passenger"),
    });
    expect(res.statusCode).toBe(200);
    const { zones } = res.json();
    expect(zones).toHaveLength(8);
    const names = zones.map((z: { name: string }) => z.name);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(
      expect.arrayContaining(["Banani", "Gulshan 1", "Mohakhali"]),
    );
  });

  it("creates Nusrat's ride with the correct REQUESTED state and estimated fare", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-passenger"),
      payload: createBody(),
    });
    expect(res.statusCode).toBe(201);
    const { ride } = res.json();

    expect(ride.status).toBe("REQUESTED");
    expect(ride.pickupZone.name).toBe("Banani");
    expect(ride.destinationZone.name).toBe("Mohakhali");
    expect(ride.requestedSeats).toBe(1);
    // Hand-computed estimate (ADR-015 §C, see test/fare.test.ts): BDT 59.32.
    expect(ride.fare).toEqual({
      currency: "BDT",
      baseFarePaisa: 3000,
      distanceChargePaisa: 2932,
      poolDiscountPaisa: 0,
      finalFarePaisa: 5932,
      perSeatFarePaisa: 5932,
      estimatedTotalPaisa: 5932,
    });

    // The DB row is a REQUESTED ride with no pool, owned by Nusrat.
    const [row] = await db
      .select()
      .from(rideRequests)
      .where(eq(rideRequests.id, ride.id));
    expect(row?.passengerId).toBe(SEED_IDS.nusrat);
    expect(row?.status).toBe("REQUESTED");
    expect(row?.poolId).toBeNull();
    expect(row?.clientRequestId).toBeNull();

    // Fare + first journal entry (NULL → REQUESTED) exist atomically.
    const [fareRow] = await db
      .select()
      .from(fares)
      .where(eq(fares.rideRequestId, ride.id));
    expect(fareRow?.finalFarePaisa).toBe(5932);
    const [historyRow] = await db
      .select()
      .from(rideStatusHistory)
      .where(eq(rideStatusHistory.rideRequestId, ride.id));
    expect(historyRow?.fromStatus).toBeNull();
    expect(historyRow?.status).toBe("REQUESTED");
  });

  it("scales the estimated total by the requested seats (stored components per seat)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-passenger"),
      payload: createBody({ requestedSeats: 2 }),
    });
    expect(res.statusCode).toBe(201);
    const { ride } = res.json();
    expect(ride.requestedSeats).toBe(2);
    expect(ride.fare.finalFarePaisa).toBe(5932);
    expect(ride.fare.estimatedTotalPaisa).toBe(11864);
  });

  it("replays an idempotent retry (same clientRequestId) instead of duplicating", async () => {
    const key = "91000000-0000-4000-8000-000000000001";
    const first = await app.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-passenger"),
      payload: createBody({ clientRequestId: key }),
    });
    expect(first.statusCode).toBe(201);
    const firstRide = first.json().ride;

    const retry = await app.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-passenger"),
      payload: createBody({ clientRequestId: key }),
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().ride.id).toBe(firstRide.id);
    expect(retry.json().ride.fare.finalFarePaisa).toBe(5932);

    // Exactly one ride + one fare + one journal row for the key.
    const rows = await db
      .select()
      .from(rideRequests)
      .where(eq(rideRequests.clientRequestId, key));
    expect(rows).toHaveLength(1);
  });

  it("creates a new ride per submission when no clientRequestId is given", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-rafiq"),
      payload: createBody({
        pickupZoneId: ZONE_IDS.banani,
        destinationZoneId: ZONE_IDS.gulshan,
      }),
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-rafiq"),
      payload: createBody({
        pickupZoneId: ZONE_IDS.banani,
        destinationZoneId: ZONE_IDS.gulshan,
      }),
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().ride.id).not.toBe(second.json().ride.id);
  });

  it("keeps one ride even when duplicate submissions race for the same key", async () => {
    const key = "91000000-0000-4000-8000-000000000002";
    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/rides",
        headers: AUTH("tok-passenger"),
        payload: createBody({ clientRequestId: key }),
      }),
      app.inject({
        method: "POST",
        url: "/api/rides",
        headers: AUTH("tok-passenger"),
        payload: createBody({ clientRequestId: key }),
      }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    const rows = await db
      .select()
      .from(rideRequests)
      .where(eq(rideRequests.clientRequestId, key));
    expect(rows).toHaveLength(1);
  });

  it("rejects an unknown zone id with 400 VALIDATION_ERROR", async () => {
    const unknown = "99999999-9999-4999-8999-999999999999";
    const res = await app.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-passenger"),
      payload: createBody({ pickupZoneId: unknown }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toEqual([
      { field: "pickupZoneId", message: "unknown zone" },
    ]);
  });

  it("rejects a request whose pickup equals its destination", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-passenger"),
      payload: createBody({ destinationZoneId: ZONE_IDS.banani }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details).toEqual([
      { field: "destinationZoneId", message: "must differ from pickupZoneId" },
    ]);
  });

  it.each([0, 4, 1.5, -1])("rejects invalid requestedSeats (%s)", async (seats) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-passenger"),
      payload: createBody({ requestedSeats: seats }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects malformed UUIDs and non-numeric seats", async () => {
    const badUuid = await app.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-passenger"),
      payload: createBody({ pickupZoneId: "not-a-uuid" }),
    });
    expect(badUuid.statusCode).toBe(400);

    const stringSeats = await app.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-passenger"),
      payload: createBody({ requestedSeats: "2" }),
    });
    expect(stringSeats.statusCode).toBe(400);
  });

  it("rejects unknown body fields (strict schema, defence against smuggling)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-passenger"),
      payload: { ...createBody(), passengerId: SEED_IDS.rafiq },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details[0].message).toContain("passengerId");
  });

  it("rejects a DRIVER with 403 FORBIDDEN (passenger-only)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-driver"),
      payload: createBody(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("rejects an inactive user with 403 AUTH_INACTIVE", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-inactive"),
      payload: createBody(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: "AUTH_INACTIVE" } });
  });

  it("isolates ride reads to the owner (404, never a 403 leak)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-passenger"),
      payload: createBody(),
    });
    const rideId = created.json().ride.id;

    const other = await app.inject({
      method: "GET",
      url: `/api/rides/${rideId}`,
      headers: AUTH("tok-rafiq"),
    });
    expect(other.statusCode).toBe(404);
    expect(other.json().error.code).toBe("NOT_FOUND");

    const owner = await app.inject({
      method: "GET",
      url: `/api/rides/${rideId}`,
      headers: AUTH("tok-passenger"),
    });
    expect(owner.statusCode).toBe(200);
    expect(owner.json().ride.id).toBe(rideId);
  });

  it("lists only the caller's own rides", async () => {
    const nusratBefore = await app.inject({
      method: "GET",
      url: "/api/rides",
      headers: AUTH("tok-passenger"),
    });
    const nusratCount = nusratBefore.json().rides.length;

    const mine = await app.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-passenger"),
      payload: createBody(),
    });
    void mine;

    const rafiqList = await app.inject({
      method: "GET",
      url: "/api/rides",
      headers: AUTH("tok-rafiq"),
    });
    const nusratList = await app.inject({
      method: "GET",
      url: "/api/rides",
      headers: AUTH("tok-passenger"),
    });

    const rafiqIds = rafiqList
      .json()
      .rides.map((r: { id: string }) => r.id);
    const nusratIds = nusratList
      .json()
      .rides.map((r: { id: string }) => r.id);

    // Rafiq sees only the two rides created earlier in this suite.
    expect(rafiqIds).toHaveLength(2);
    // Every Nusrat ride belongs to Nusrat; nothing of Rafiq's leaks in.
    for (const id of nusratIds) {
      expect(rafiqIds).not.toContain(id);
    }
    expect(nusratIds).toHaveLength(nusratCount + 1);
  });

  it("rejects a malformed rideId with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/rides/not-a-uuid",
      headers: AUTH("tok-passenger"),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for a well-formed but unknown ride id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/rides/99999999-9999-4999-8999-999999999999",
      headers: AUTH("tok-passenger"),
    });
    expect(res.statusCode).toBe(404);
  });

  it("rolls the ride back when fare creation fails (atomic ride+fare+history)", async () => {
    // A service whose fare compute always fails: the ride row is inserted
    // before the estimate runs, so a non-transactional design would leave an
    // orphaned ride. The transaction must roll it all back together.
    const broken = buildApp({
      auth: makeFakeAuth(),
      rides: createRideService(db, {
        computeFare: () => {
          throw new Error("fare engine failure injected by test");
        },
      }),
    });

    const [ridesBefore, faresBefore] = await Promise.all([
      db.select().from(rideRequests),
      db.select().from(fares),
    ]);

    const res = await broken.inject({
      method: "POST",
      url: "/api/rides",
      headers: AUTH("tok-passenger"),
      payload: createBody(),
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL_ERROR");

    // The failed creation added neither a ride nor a fare row.
    const [ridesAfter, faresAfter] = await Promise.all([
      db.select().from(rideRequests),
      db.select().from(fares),
    ]);
    expect(ridesAfter).toHaveLength(ridesBefore.length);
    expect(faresAfter).toHaveLength(faresBefore.length);

    await broken.close();
  });
});