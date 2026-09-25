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

import { and, desc, eq, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { AuthUser } from "../auth/identity.js";
import type { AppDatabase } from "../db/index.js";
import {
  fares,
  rideRequests,
  rideStatusHistory,
  zones,
} from "../db/schema.js";
import {
  computeInitialFare,
  type ZonePoint,
} from "../fare/calculate.js";
import { MAX_REQUESTED_SEATS } from "../fare/constants.js";
import { RideNotFoundError, RideValidationError } from "./errors.js";

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

export interface RideView {
  id: string;
  status: typeof rideRequests.$inferSelect["status"];
  pickupZone: ZoneView;
  destinationZone: ZoneView;
  requestedSeats: number;
  fare: FareView;
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
// PostgresError carrying the SQLSTATE code (23505 = unique_violation).
function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string } | undefined)?.code ??
    (error as { cause?: { code?: string } } | undefined)?.cause?.code;
  return code === "23505";
}

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

interface RideJoinShape {
  ride: typeof rideRequests.$inferSelect;
  fare: typeof fares.$inferSelect;
  pickup: typeof zones.$inferSelect;
  destination: typeof zones.$inferSelect;
}

function toRideView(row: RideJoinShape): RideView {
  return {
    id: row.ride.id,
    status: row.ride.status,
    pickupZone: zoneView(row.pickup),
    destinationZone: zoneView(row.destination),
    requestedSeats: row.ride.requestedSeats,
    fare: fareView(row.fare, row.ride.requestedSeats),
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
}

export function createRideService(
  database: AppDatabase,
  options: RideServiceOptions = {},
) {
  const estimateFare = options.computeFare ?? computeInitialFare;

  type RideWhere = SQL<unknown> | undefined;

  // Join a ride request with its fare and both zones in one query.
  function loadRideWhere(where: RideWhere) {
    return database
      .select({
        ride: rideRequests,
        fare: fares,
        pickup: pickupZone,
        destination: destinationZone,
      })
      .from(rideRequests)
      .innerJoin(fares, eq(fares.rideRequestId, rideRequests.id))
      .innerJoin(pickupZone, eq(pickupZone.id, rideRequests.pickupZoneId))
      .innerJoin(
        destinationZone,
        eq(destinationZone.id, rideRequests.destinationZoneId),
      )
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

    try {
      // One transaction: ride + fare + initial status-history entry commit
      // together, or not at all.
      const ride = await database.transaction(async (tx) => {
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

        // First journal entry: NULL → REQUESTED. The state machine records the
        // remaining transitions in a later phase (docs/requirements.md §4).
        await tx.insert(rideStatusHistory).values({
          rideRequestId: inserted.id,
          fromStatus: null,
          status: "REQUESTED",
        });

        return toRideView({
          ride: inserted,
          fare: {
            ...estimate,
            id: "unused",
            rideRequestId: inserted.id,
            createdAt: new Date(0),
          } as typeof fares.$inferSelect,
          pickup,
          destination,
        });
      });

      return { ride, created: true };
    } catch (error) {
      // Concurrent duplicate for the same (passenger, key): the partial unique
      // index (migration 0003) let exactly one row through; the loser rolls
      // back and replays the winner's ride.
      if (isUniqueViolation(error) && input.clientRequestId) {
        const winner = await getByClientKey(
          passenger.id,
          input.clientRequestId,
        );
        if (winner) {
          return { ride: winner, created: false };
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

  return {
    createRequest,
    getOwnedRide,
    listOwnedRides,
    listZones,
  };
}

export type RideService = ReturnType<typeof createRideService>;