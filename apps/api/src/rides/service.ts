// Ride-request service: create a passenger's ride request with its initial
// estimated fare, and read the caller's own rides.
//
// Trust boundary: the passenger identity comes ONLY from the authenticated
// request (AuthUser), never from the client. `requestedSeats`, zone ids, and
// the optional idempotency key come from the client and are fully validated.
//
// Consistency: ride creation, fare creation, and the initial status-history
// journal entry happen inside ONE database transaction — a ride can never
// exist without its fare estimate, or vice-versa. The estimate is computed
// inside the transaction so a fare failure rolls the ride back with it.
//
// Duplicates: when the caller supplies a clientRequestId, the (passenger,
// key) partial unique index (migration 0003, ADR-015) guarantees at most one
// ride — a retry replays the existing ride instead of creating a new one.
// Without a key, repeated submissions create new rides (documented MVP
// behavior).

import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { AuthUser } from "../auth/identity.js";
import type { AppDatabase } from "../db/index.js";
import {
  isUniqueViolation,
  violatedConstraintName,
} from "../db/postgres-errors.js";
import {
  fares,
  poolMembers,
  pools,
  rideRequests,
  rideStatusHistory,
  users,
  vehicles,
  zones,
} from "../db/schema.js";
import {
  computeInitialFare,
  type ZonePoint,
} from "../fare/calculate.js";
import { MAX_REQUESTED_SEATS } from "../fare/constants.js";
import { createPoolingService, type PoolingService } from "./pooling/service.js";
import {
  ActiveRideExistsError,
  RideNotFoundError,
  RideValidationError,
} from "./errors.js";

// Zone rows carry the coordinates the fare estimate needs (plain lat/long
// points — no routing service). Aliased so one query can join both zones.
const pickupZone = alias(zones, "pickup_zone");
const destinationZone = alias(zones, "destination_zone");

export interface RideRequestInput {
  pickupZoneId: string;
  destinationZoneId: string;
  requestedSeats: number;
  // Client-supplied idempotency key (optional). NULL disables deduplication.
  clientRequestId: string | null;
}

// Input for the read-only fare estimate (no ride is created). The estimate is
// the same deterministic formula a booking will use (computeInitialFare), so
// "see estimated fare" (PRD) is shown BEFORE the passenger confirms.
export interface RideEstimateInput {
  pickupZoneId: string;
  destinationZoneId: string;
  requestedSeats: number;
}

export interface ZoneView {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface FareView {
  currency: string;
  baseFarePaisa: number;
  distanceChargePaisa: number;
  poolDiscountPaisa: number;
  finalFarePaisa: number;
  perSeatFarePaisa: number;
  estimatedTotalPaisa: number;
}

// Summary of the pool a ride belongs to (null while the request is
// REQUESTED). A pool is born UNASSIGNED (Phase 9, ADR-022): driver and Tesla
// are NULL until an eligible driver accepts, so the passenger sees the ride as
// "waiting for a driver" until then.
export interface RidePoolView {
  id: string;
  status: typeof pools.$inferSelect["status"];
  capacitySnapshot: number;
  // Derived occupancy (ACTIVE members only), recomputed per read.
  occupiedSeats: number;
  vehicleId: string | null;
  vehicleName: string | null;
  driverId: string | null;
  driverName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RideView {
  id: string;
  status: typeof rideRequests.$inferSelect["status"];
  pickupZone: ZoneView;
  destinationZone: ZoneView;
  requestedSeats: number;
  fare: FareView;
  pool: RidePoolView | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRideResult {
  ride: RideView;
  // true when a new ride was created; false when an idempotent retry replayed
  // a ride that already existed for the same (passenger, clientRequestId).
  created: boolean;
}

// postgres-js surfaces constraint violations as an error whose .cause is the
// PostgresError carrying the SQLSTATE code (23505 = unique_violation) and the
// violated constraint name; the unpacking helpers live in db/postgres-errors.ts.

function zoneView(zone: typeof zones.$inferSelect): ZoneView {
  return {
    id: zone.id,
    name: zone.name,
    latitude: zone.latitude,
    longitude: zone.longitude,
  };
}

// The stored fare components are PER SEAT; the total is derived for the API:
// estimatedTotalPaisa = finalFarePaisa × requestedSeats (ADR-015, K5).
function fareView(
  fare: {
    currency: string;
    baseFarePaisa: number;
    distanceChargePaisa: number;
    poolDiscountPaisa: number;
    finalFarePaisa: number;
  },
  requestedSeats: number,
): FareView {
  return {
    currency: fare.currency,
    baseFarePaisa: fare.baseFarePaisa,
    distanceChargePaisa: fare.distanceChargePaisa,
    poolDiscountPaisa: fare.poolDiscountPaisa,
    finalFarePaisa: fare.finalFarePaisa,
    perSeatFarePaisa: fare.finalFarePaisa,
    estimatedTotalPaisa: fare.finalFarePaisa * requestedSeats,
  };
}

interface RidePoolJoinShape {
  // drizzle types every column of a `.leftJoin` as nullable; a full row of
  // NULLs means the ride has no pool yet (toPoolView collapses that).
  pool?: {
    id: string | null;
    status: typeof pools.$inferSelect["status"] | null;
    capacitySnapshot: number | null;
    createdAt: Date | null;
    updatedAt: Date | null;
    vehicleId: string | null;
    vehicleName: string | null;
    driverId: string | null;
    driverName: string | null;
    occupiedSeats: number | null;
  };
}

interface RideJoinShape extends RidePoolJoinShape {
  ride: typeof rideRequests.$inferSelect;
  fare: typeof fares.$inferSelect;
  pickup: typeof zones.$inferSelect;
  destination: typeof zones.$inferSelect;
}

function toPoolView(
  pool: RidePoolJoinShape["pool"],
): RidePoolView | null {
  // All fields come from the same left-joined row: id present ⇒ the rest are
  // too (the nullable typing is drizzle's join-bookkeeping, not real data).
  // driver/vehicle stay NULL for an unassigned wait pool (ADR-022).
  if (!pool?.id) return null;
  return {
    id: pool.id,
    status: pool.status!,
    capacitySnapshot: pool.capacitySnapshot!,
    occupiedSeats: pool.occupiedSeats!,
    vehicleId: pool.vehicleId,
    vehicleName: pool.vehicleName,
    driverId: pool.driverId,
    driverName: pool.driverName,
    createdAt: pool.createdAt!,
    updatedAt: pool.updatedAt!,
  };
}

function toRideView(row: RideJoinShape): RideView {
  return {
    id: row.ride.id,
    status: row.ride.status,
    pickupZone: zoneView(row.pickup),
    destinationZone: zoneView(row.destination),
    requestedSeats: row.ride.requestedSeats,
    fare: fareView(row.fare, row.ride.requestedSeats),
    pool: toPoolView(row.pool),
    createdAt: row.ride.createdAt,
    updatedAt: row.ride.updatedAt,
  };
}

function zonePoint(zone: typeof zones.$inferSelect): ZonePoint {
  return { latitude: zone.latitude, longitude: zone.longitude };
}

export interface RideServiceOptions {
  // Injectable seam so the DB integration tests can drive a fare/storage
  // failure inside the create transaction (atomicity proof). Defaults to the
  // deterministic computeInitialFare.
  computeFare?: typeof computeInitialFare;
  // Injectable seam for the pooling behaviour (real implementation, or the
  // throwing-recompute variant used by the rollback tests).
  pooling?: PoolingService;
}

export function createRideService(
  database: AppDatabase,
  options: RideServiceOptions = {},
) {
  const estimateFare = options.computeFare ?? computeInitialFare;
  const pooling = options.pooling ?? createPoolingService({ database });

  type RideWhere = SQL<unknown> | undefined;

  // Join a ride request with its fare, both zones, and (left) its pool. The
  // pool occupancy is a derived read (ACTIVE members only) — no cached counter.
  function loadRideWhere(where: RideWhere) {
    return database
      .select({
        ride: rideRequests,
        fare: fares,
        pickup: pickupZone,
        destination: destinationZone,
        pool: {
          id: pools.id,
          status: pools.status,
          capacitySnapshot: pools.capacitySnapshot,
          createdAt: pools.createdAt,
          updatedAt: pools.updatedAt,
          vehicleId: vehicles.id,
          vehicleName: vehicles.name,
          driverId: users.id,
          driverName: users.name,
          occupiedSeats: sql<number>`coalesce((select sum(${poolMembers.seats}) from ${poolMembers} where ${poolMembers.poolId} = ${pools.id} and ${poolMembers.status} = 'ACTIVE'), 0)::int`,
        },
      })
      .from(rideRequests)
      .innerJoin(fares, eq(fares.rideRequestId, rideRequests.id))
      .innerJoin(pickupZone, eq(pickupZone.id, rideRequests.pickupZoneId))
      .innerJoin(
        destinationZone,
        eq(destinationZone.id, rideRequests.destinationZoneId),
      )
      .leftJoin(pools, eq(pools.id, rideRequests.poolId))
      .leftJoin(vehicles, eq(vehicles.id, pools.vehicleId))
      .leftJoin(users, eq(users.id, pools.driverId))
      .where(where);
  }

  async function getByClientKey(passengerId: string, key: string) {
    const [row] = await loadRideWhere(
      and(
        eq(rideRequests.passengerId, passengerId),
        eq(rideRequests.clientRequestId, key),
      ),
    );
    return row ? toRideView(row) : null;
  }

  async function createRequest(
    passenger: AuthUser,
    input: RideRequestInput,
  ): Promise<CreateRideResult> {
    if (
      !Number.isInteger(input.requestedSeats) ||
      input.requestedSeats < 1 ||
      input.requestedSeats > MAX_REQUESTED_SEATS
    ) {
      throw new RideValidationError([
        {
          field: "requestedSeats",
          message: `must be an integer between 1 and ${MAX_REQUESTED_SEATS}`,
        },
      ]);
    }
    if (input.pickupZoneId === input.destinationZoneId) {
      throw new RideValidationError([
        { field: "destinationZoneId", message: "must differ from pickupZoneId" },
      ]);
    }

    // Idempotent replay: a previous submission with the same key already won.
    if (input.clientRequestId) {
      const existing = await getByClientKey(passenger.id, input.clientRequestId);
      if (existing) {
        return { ride: existing, created: false };
      }
    }

    // One active ride per passenger (requirements.md §21.L, ADR-021). This
    // early check gives a calm, immediate 409 for the common case; the real
    // guarantee is the partial unique index
    // ride_requests_one_active_per_passenger, which serializes even the racy
    // two-submissions-at-once case (handled in the catch below).
    const [pending] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(rideRequests)
      .where(
        and(
          eq(rideRequests.passengerId, passenger.id),
          sql`${rideRequests.status} not in ('COMPLETED', 'CANCELLED')`,
        ),
      );
    if ((pending?.count ?? 0) > 0) {
      throw new ActiveRideExistsError();
    }

    try {
      // One transaction: ride + fare + initial status-history entry + the
      // automatch (pool membership, REQUESTED→MATCHED journal, in-place fare
      // recompute) commit together, or not at all. A ride can never exist
      // without its fare estimate, and a match can never leave a dangling
      // membership if something later fails.
      const { rideId } = await database.transaction(async (tx) => {
        const [pickup] = await tx
          .select()
          .from(zones)
          .where(eq(zones.id, input.pickupZoneId))
          .limit(1);
        if (!pickup) {
          throw new RideValidationError([
            { field: "pickupZoneId", message: "unknown zone" },
          ]);
        }
        const [destination] = await tx
          .select()
          .from(zones)
          .where(eq(zones.id, input.destinationZoneId))
          .limit(1);
        if (!destination) {
          throw new RideValidationError([
            { field: "destinationZoneId", message: "unknown zone" },
          ]);
        }

        const [inserted] = await tx
          .insert(rideRequests)
          .values({
            passengerId: passenger.id,
            pickupZoneId: input.pickupZoneId,
            destinationZoneId: input.destinationZoneId,
            requestedSeats: input.requestedSeats,
            status: "REQUESTED",
            clientRequestId: input.clientRequestId ?? null,
          })
          .returning();
        if (!inserted) {
          throw new Error("ride insert returned no row");
        }

        // Computed AFTER the ride insert so a fare failure exercises the
        // transaction rollback (the test suite injects throwing computeFare to
        // prove ride + fare + history commit together, or not at all).
        const estimate = estimateFare({
          pickup: zonePoint(pickup),
          destination: zonePoint(destination),
          requestedSeats: input.requestedSeats,
        });

        await tx.insert(fares).values({
          rideRequestId: inserted.id,
          baseFarePaisa: estimate.baseFarePaisa,
          distanceChargePaisa: estimate.distanceChargePaisa,
          poolDiscountPaisa: estimate.poolDiscountPaisa,
          finalFarePaisa: estimate.finalFarePaisa,
          currency: estimate.currency,
        });

        // First journal entry: NULL → REQUESTED (docs/requirements.md §4).
        await tx.insert(rideStatusHistory).values({
          rideRequestId: inserted.id,
          fromStatus: null,
          status: "REQUESTED",
        });

        // Phase 5 automatch: joins an eligible existing pool, or creates one
        // on an available Tesla. On failure the whole transaction rolls back.
        await pooling.matchRide(tx, inserted.id);

        return { rideId: inserted.id };
      });

      // Re-read AFTER commit so the response reflects the final matched state
      // (status, pool summary, recomputed pooled fare).
      const [row] = await loadRideWhere(
        and(eq(rideRequests.id, rideId), eq(rideRequests.passengerId, passenger.id)),
      );
      if (!row) {
        throw new RideNotFoundError();
      }
      return { ride: toRideView(row), created: true };
    } catch (error) {
      // Two constraints can fire here and both mean "this passenger already
      // has this ride in some form":
      //   - ride_requests_client_request_id_key: a concurrent duplicate for the
      //     same (passenger, key) — the partial unique index (migration 0003)
      //     let exactly one row through, so replay the winner's ride.
      //   - ride_requests_one_active_per_passenger: a concurrent (or
      //     recklessly repeated) booking while a non-terminal ride exists —
      //     surface exactly that rule as a 409.
      // The key is resolved FIRST so an idempotent retry replays a ride that
      // would otherwise ALSO trip the active-ride index (both describe "this
      // ride already exists" for the same (passenger, clientRequestId) pair).
      if (isUniqueViolation(error)) {
        if (input.clientRequestId) {
          const winner = await getByClientKey(
            passenger.id,
            input.clientRequestId,
          );
          if (winner) {
            return { ride: winner, created: false };
          }
        }
        if (violatedConstraintName(error) === "ride_requests_one_active_per_passenger") {
          throw new ActiveRideExistsError();
        }
      }
      throw error;
    }
  }

  async function getOwnedRide(
    passenger: AuthUser,
    rideId: string,
  ): Promise<RideView> {
    const [row] = await loadRideWhere(
      and(
        eq(rideRequests.id, rideId),
        eq(rideRequests.passengerId, passenger.id),
      ),
    );
    if (!row) {
      // Identical 404 for "does not exist" and "belongs to someone else" —
      // an observer cannot tell the difference.
      throw new RideNotFoundError();
    }
    return toRideView(row);
  }

  async function listOwnedRides(passenger: AuthUser): Promise<RideView[]> {
    const rows = await loadRideWhere(
      eq(rideRequests.passengerId, passenger.id),
    );
    return rows
      .sort((a, b) => b.ride.createdAt.getTime() - a.ride.createdAt.getTime())
      .map((row) => toRideView(row));
  }

  async function listZones(): Promise<ZoneView[]> {
    const rows = await database.select().from(zones).orderBy(desc(zones.createdAt));
    return [...rows]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((zone) => zoneView(zone));
  }

  // Read-only fare estimate (PRD: passenger "sees estimated fare" BEFORE
  // booking; requirements.md §21.D/H). Identical formula and validation to a
  // real booking, minus the ride creation — the passenger can see what a
  // confirmed booking will cost before confirming. Returns the same FareView
  // shape as a booked ride so the booking banner and the estimate render
  // identically.
  async function estimateRide(
    passenger: AuthUser,
    input: RideEstimateInput,
  ): Promise<FareView> {
    if (
      !Number.isInteger(input.requestedSeats) ||
      input.requestedSeats < 1 ||
      input.requestedSeats > MAX_REQUESTED_SEATS
    ) {
      throw new RideValidationError([
        {
          field: "requestedSeats",
          message: `must be an integer between 1 and ${MAX_REQUESTED_SEATS}`,
        },
      ]);
    }
    if (input.pickupZoneId === input.destinationZoneId) {
      throw new RideValidationError([
        { field: "destinationZoneId", message: "must differ from pickupZoneId" },
      ]);
    }

    const [pickup] = await database
      .select()
      .from(zones)
      .where(eq(zones.id, input.pickupZoneId))
      .limit(1);
    if (!pickup) {
      throw new RideValidationError([
        { field: "pickupZoneId", message: "unknown zone" },
      ]);
    }
    const [destination] = await database
      .select()
      .from(zones)
      .where(eq(zones.id, input.destinationZoneId))
      .limit(1);
    if (!destination) {
      throw new RideValidationError([
        { field: "destinationZoneId", message: "unknown zone" },
      ]);
    }

    const estimate = estimateFare({
      pickup: zonePoint(pickup),
      destination: zonePoint(destination),
      requestedSeats: input.requestedSeats,
    });
    // fareView keeps the response shape byte-identical to a booked ride's fare
    // (perSeatFare = final per seat; estimatedTotal = final × seats).
    return fareView(estimate, input.requestedSeats);
  }

  // Passenger-initiated cancellation (docs/requirements.md §21.B). The pooling
  // service validates the transition (409 on an illegal one) and, for a MATCHED
  // ride, frees the seat, recomputes remaining fares, and terminates an emptied
  // pool — all in one transaction. Returns the ride AFTER the cancellation so
  // the client sees the final state.
  async function cancelRequest(
    passenger: AuthUser,
    rideId: string,
  ): Promise<RideView> {
    await pooling.cancelRide(passenger.id, rideId);
    const [row] = await loadRideWhere(
      and(
        eq(rideRequests.id, rideId),
        eq(rideRequests.passengerId, passenger.id),
      ),
    );
    if (!row) {
      throw new RideNotFoundError();
    }
    return toRideView(row);
  }

  return {
    createRequest,
    estimateRide,
    getOwnedRide,
    listOwnedRides,
    listZones,
    cancelRequest,
  };
}

export type RideService = ReturnType<typeof createRideService>;