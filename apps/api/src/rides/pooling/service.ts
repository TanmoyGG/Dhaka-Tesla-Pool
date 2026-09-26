// Pooling service (Phase 5): deterministic matching + the seat-claim
// transaction that makes pool capacity race-safe without any distributed
// machinery (ADR-016/017, docs/database.md §5.5).
//
// Concurrency contract (the design that survives the Nusrat-vs-Shirin final
// seat race):
//   - Occupancy is DERIVED each claim from ACTIVE pool_members rows — there is
//     no cached available-seats counter to desync.
//   - A claim locks its candidate pool row with `SELECT ... FOR UPDATE`, then
//     re-derives occupancy UNDER the lock and only joins when
//     occupied + seats <= capacity_snapshot. The 1-seat capacity invariant
//     therefore holds on disk, not just in memory.
//   - Pool creation uses `INSERT ... ON CONFLICT DO NOTHING RETURNING` against
//     the partial unique index pools_single_active_per_vehicle. ON CONFLICT DO
//     NOTHING waits for any racing transaction on the same Tesla and then skips
//     with an EMPTY result, while our transaction stays alive (a plain INSERT
//     would abort the whole transaction with 23505). An empty result means a
//     concurrent winner is committed-visible, so we do ONE bounded re-evaluation
//     (re-scan + lock + capacity check + join) and stop — no retry loop.
//   - Lock protocol: every transaction that writes both a ride row and a pool
//     row acquires the RIDE row lock first, the POOL row lock second
//     (createRequest already holds the ride lock from its INSERT). Consistent
//     ordering ⇒ no deadlock between match, cancel, and force-cancel.
//   - Driver-flow hardening (Phase 6, ADR-019/020): the new-pool Tesla pick
//     takes the vehicle row `FOR UPDATE` so a match and a concurrent offline
//     toggle serialize on the vehicle row (a match can never land a pool on a
//     Tesla that just went offline); and a claim re-verifies the POOL is still
//     MATCHED under its row lock, so a lifecycle transition that committed
//     meanwhile cannot have a passenger grafted onto a trip that already left
//     MATCHED.
//   - Match order within a transaction: same pickup zone, all-pairs drop-off
//     spread <= POOL_DEST_SPREAD_KM, then fullest pool first
//     (occupiedSeats DESC, createdAt ASC, id ASC). See src/matching/rules.ts.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { AppDatabase } from "../../db/index.js";
import {
  poolMembers,
  pools,
  rideRequests,
  rideStatusHistory,
  users,
  vehicles,
  zones,
} from "../../db/schema.js";
import type { DbTransaction } from "../../db/types.js";
import {
  pickBestPool,
  type CandidatePool,
  type DropOffCandidate,
} from "../../matching/rules.js";
import { invalidTransitionReason, type RideStatus } from "../state.js";
import {
  RideNotFoundError,
  InvalidStateTransitionError,
  DriverHasActivePoolError,
  PoolNotFoundError,
  PoolNotAcceptableError,
  VehicleOfflineError,
} from "../errors.js";
import {
  recomputeActivePoolFares,
  refundFare,
  type RecomputePoolFares,
} from "./fare.js";

const destinationZone = alias(zones, "destination_zone");
const pickupZone = alias(zones, "pickup_zone");

interface MatchCandidate {
  ride: typeof rideRequests.$inferSelect;
  destinationPoint: { latitude: number; longitude: number };
}

// ---------------------------------------------------------------------------
// Driver hub views (Phase 6, ADR-019). Deliberately NO fares and NO other
// drivers' data: the driver sees who is riding with them (name, seats, zones)
// so they can run the trip — individual per-passenger fares stay off the
// driver surface (P9).
// ---------------------------------------------------------------------------

export interface DriverPoolMemberView {
  rideRequestId: string;
  passengerId: string;
  passengerName: string;
  pickupZoneId: string;
  pickupZoneName: string;
  destinationZoneId: string;
  destinationZoneName: string;
  seats: number;
}

export interface DriverPoolView {
  id: string;
  status: RideStatus;
  capacitySnapshot: number;
  // Occupancy of ACTIVE members, derived per read — no cached counter.
  occupiedSeats: number;
  vehicle: { id: string; name: string; capacity: number; isOnline: boolean };
  acceptedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // ACTIVE members only: a LEFT member is history, not a passenger on board.
  members: DriverPoolMemberView[];
}

// A read that can run on either the application handle or a transaction handle
// (both expose the same Drizzle select).
type PoolReadSource = Pick<AppDatabase, "select">;

function toDropOffCandidate(candidate: MatchCandidate): DropOffCandidate {
  return {
    pickupZoneId: candidate.ride.pickupZoneId,
    destinationZoneId: candidate.ride.destinationZoneId,
    destinationPoint: candidate.destinationPoint,
    requestedSeats: candidate.ride.requestedSeats,
  };
}

export interface PoolingServiceOptions {
  database: AppDatabase;
  // Injectable seam for the idempotence/rollback tests: substitute a recompute
  // that throws to prove the whole match transaction rolls back.
  recomputeFares?: RecomputePoolFares;
}

export interface PoolingService {
  // Match a ride inside an EXISTING transaction (createRequest's), so a match
  // failure rolls the ride + fare + history back with it. Returns true when the
  // ride is now MATCHED and a member of a pool.
  matchRide(tx: DbTransaction, rideId: string): Promise<boolean>;
  // Passenger-initiated cancellation (docs/requirements.md §21.B): frees the
  // seat, recomputes remaining fares in place, terminates an emptied pool.
  cancelRide(passengerId: string, rideId: string): Promise<void>;
  // Force (driver/admin) cancellation: same pool semantics PLUS a full refund —
  // the ride's fare is written back to zero via its discount term.
  forceCancelRide(rideId: string): Promise<void>;
  // Driver flow (Phase 6, ADR-019): online/offline and pool lifecycle. All
  // methods take the driver identity ONLY from the authenticated caller.
  // Going offline is refused while ANY of the driver's pools is non-terminal
  // (requirements.md §21.J, strict). Maps to 409 DRIVER_HAS_ACTIVE_POOL.
  setAvailability(driverId: string, isOnline: boolean): Promise<void>;
  // Confirmation of the pool automatched to this driver: records accepted_at
  // (MATCHED preserved, idempotent); requires the pool's Tesla online
  // (409 VEHICLE_OFFLINE) and the pool still MATCHED (409 POOL_NOT_ACCEPTABLE);
  // not-owned-or-unknown is a plain 404. Returns the driver hub view.
  acceptPool(driverId: string, poolId: string): Promise<DriverPoolView>;
  // Driver has arrived. Gated on acceptance (P2): arriving before accepting is
  // 409 POOL_NOT_ACCEPTABLE; a pool/ride that cannot move to DRIVER_ARRIVED is
  // 409 INVALID_STATE_TRANSITION. Transitions the pool and every MATCHED
  // member ride together, per-ride journaled.
  arrivePool(driverId: string, poolId: string): Promise<DriverPoolView>;
}

export function createPoolingService(
  options: PoolingServiceOptions,
): PoolingService {
  const { database } = options;
  const recomputeFares = options.recomputeFares ?? recomputeActivePoolFares;

  // The REQUESTED ride being matched, with its destination coordinates.
  async function loadMatchCandidate(
    tx: DbTransaction,
    rideId: string,
  ): Promise<MatchCandidate | null> {
    const [row] = await tx
      .select({
        ride: rideRequests,
        destination: destinationZone,
      })
      .from(rideRequests)
      .innerJoin(
        destinationZone,
        eq(destinationZone.id, rideRequests.destinationZoneId),
      )
      .where(and(eq(rideRequests.id, rideId), eq(rideRequests.status, "REQUESTED")))
      .limit(1);
    if (!row) return null;
    return {
      ride: row.ride,
      destinationPoint: {
        latitude: row.destination.latitude,
        longitude: row.destination.longitude,
      },
    };
  }

  // Every claimable pool right now: status MATCHED on a Tesla that is online
  // and driven by an active driver; occupancy and drop-off geometry are derived
  // from its ACTIVE members.
  async function loadCandidatePools(
    tx: DbTransaction,
  ): Promise<CandidatePool[]> {
    const poolRows = await tx
      .select({
        poolId: pools.id,
        capacitySnapshot: pools.capacitySnapshot,
        createdAt: pools.createdAt,
      })
      .from(pools)
      .innerJoin(vehicles, eq(vehicles.id, pools.vehicleId))
      .innerJoin(users, eq(users.id, pools.driverId))
      .where(
        and(
          eq(pools.status, "MATCHED"),
          eq(vehicles.isOnline, true),
          eq(users.active, true),
        ),
      );
    if (poolRows.length === 0) return [];

    const memberRows = await tx
      .select({
        poolId: poolMembers.poolId,
        pickupZoneId: rideRequests.pickupZoneId,
        destinationLatitude: destinationZone.latitude,
        destinationLongitude: destinationZone.longitude,
        seats: poolMembers.seats,
      })
      .from(poolMembers)
      .innerJoin(rideRequests, eq(rideRequests.id, poolMembers.rideRequestId))
      .innerJoin(
        destinationZone,
        eq(destinationZone.id, rideRequests.destinationZoneId),
      )
      .where(
        and(
          inArray(
            poolMembers.poolId,
            poolRows.map((row) => row.poolId),
          ),
          eq(poolMembers.status, "ACTIVE"),
        ),
      );

    const byPool = new Map<
      string,
      {
        pickupZoneId: string;
        destinationPoints: DropOffCandidate["destinationPoint"][];
        occupiedSeats: number;
      }
    >();
    for (const member of memberRows) {
      const entry = byPool.get(member.poolId);
      if (!entry) {
        byPool.set(member.poolId, {
          pickupZoneId: member.pickupZoneId,
          destinationPoints: [],
          occupiedSeats: 0,
        });
      }
      const current = byPool.get(member.poolId)!;
      current.destinationPoints.push({
        latitude: member.destinationLatitude,
        longitude: member.destinationLongitude,
      });
      current.occupiedSeats += member.seats;
    }

    return poolRows.flatMap((pool) => {
      const members = byPool.get(pool.poolId);
      // A MATCHED pool with zero ACTIVE members cannot exist in steady state
      // (an emptied pool is cancelled in the same transaction); skip defensively.
      if (!members || members.occupiedSeats === 0) return [];
      return [
        {
          id: pool.poolId,
          createdAt: pool.createdAt,
          capacitySnapshot: pool.capacitySnapshot,
          occupiedSeats: members.occupiedSeats,
          pickupZoneId: members.pickupZoneId,
          destinationPoints: members.destinationPoints,
        },
      ];
    });
  }

  // The single online, active-driven Tesla with no non-terminal pool.
  // Deterministic: name ASC, then id ASC.
  async function pickAvailableTesla(
    tx: DbTransaction,
  ): Promise<typeof vehicles.$inferSelect | undefined> {
    const [row] = await tx
      .select({ vehicle: vehicles })
      .from(vehicles)
      .innerJoin(users, eq(users.id, vehicles.driverId))
      .where(
        and(
          eq(vehicles.isOnline, true),
          eq(users.active, true),
          sql`not exists (select 1 from ${pools} where ${pools.vehicleId} = ${vehicles.id} and ${pools.status} not in ('COMPLETED', 'CANCELLED'))`,
        ),
      )
      .orderBy(asc(vehicles.name), asc(vehicles.id))
      .limit(1)
      // Phase 6: lock the chosen Tesla so a concurrent offline-toggle (which
      // also takes the vehicle row lock) cannot win between our eligibility
      // read and the pool INSERT (ADR-020).
      .for("update");
    return row?.vehicle;
  }

  async function claimSeatIn(
    tx: DbTransaction,
    candidate: MatchCandidate,
    poolId: string,
  ): Promise<boolean> {
    // The pool row lock serializes concurrent claims on this pool (ADR-017).
    const [lockedPool] = await tx
      .select()
      .from(pools)
      .where(eq(pools.id, poolId))
      .for("update");
    if (!lockedPool) return false;

    // Phase 6 hardening (ADR-020): the pool was listed as a candidate by a
    // PRIOR, lock-free read. Re-verify its status under the lock — a driver
    // transition (accept/arrive/start/complete) or an emptying cancel that
    // committed meanwhile must not let a passenger join a trip that already
    // left MATCHED.
    if (lockedPool.status !== "MATCHED") return false;

    const [occupancy] = await tx
      .select({
        occupied: sql<number>`coalesce(sum(${poolMembers.seats}), 0)::int`,
      })
      .from(poolMembers)
      .where(
        and(eq(poolMembers.poolId, poolId), eq(poolMembers.status, "ACTIVE")),
      );
    const occupied = occupancy?.occupied ?? 0;
    const fits =
      occupied + candidate.ride.requestedSeats <=
      lockedPool.capacitySnapshot;
    if (!fits) return false;

    // Membership + state machine + fare recompute, all inside the same lock.
    const now = new Date();
    await tx
      .update(rideRequests)
      .set({ status: "MATCHED", poolId, updatedAt: now })
      .where(eq(rideRequests.id, candidate.ride.id));
    await tx.insert(poolMembers).values({
      poolId,
      rideRequestId: candidate.ride.id,
      passengerId: candidate.ride.passengerId,
      seats: candidate.ride.requestedSeats,
      status: "ACTIVE",
    });
    await tx.insert(rideStatusHistory).values({
      rideRequestId: candidate.ride.id,
      fromStatus: "REQUESTED",
      status: "MATCHED",
    });
    await recomputeFares(tx, poolId);
    await tx
      .update(pools)
      .set({ updatedAt: now })
      .where(eq(pools.id, poolId));
    return true;
  }

  // Orchestration inside the caller's transaction.
  async function matchRide(tx: DbTransaction, rideId: string): Promise<boolean> {
    const candidate = await loadMatchCandidate(tx, rideId);
    if (!candidate) return false;

    // 1. Join the best eligible EXISTING pool when one fits. pickBestPool is
    //    deterministic: fullest first (occupied DESC), then created_at ASC,
    //    then id ASC (docs/requirements.md §21.A).
    const poolsNow = await loadCandidatePools(tx);
    const chosen = pickBestPool(poolsNow, toDropOffCandidate(candidate));
    if (chosen) {
      return claimSeatIn(tx, candidate, chosen.id);
    }

    // 2. Otherwise start a pool on an available Tesla. Deterministic pick
    //    (name, id), so concurrent requests for the same destination set race
    //    onto the same Tesla instead of scattering.
    const tesla = await pickAvailableTesla(tx);
    if (!tesla) return false;

    const [created] = await tx
      .insert(pools)
      .values({
        vehicleId: tesla.id,
        driverId: tesla.driverId,
        status: "MATCHED",
        capacitySnapshot: tesla.capacity,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      // A concurrent transaction won the Tesla first (its row is now
      // committed-visible — ON CONFLICT DO NOTHING waits on the racing INSERT).
      // Bounded re-evaluation: re-scan and join the winner's pool if it fits.
      const retryPools = await loadCandidatePools(tx);
      const retryPool = pickBestPool(retryPools, toDropOffCandidate(candidate));
      if (!retryPool) return false;
      return claimSeatIn(tx, candidate, retryPool.id);
    }

    return claimSeatIn(tx, candidate, created.id);
  }

  async function cancelRide(
    passengerId: string,
    rideId: string,
  ): Promise<void> {
    await database.transaction(async (tx) => {
      const [ride] = await tx
        .select()
        .from(rideRequests)
        .where(
          and(
            eq(rideRequests.id, rideId),
            eq(rideRequests.passengerId, passengerId),
          ),
        )
        .for("update")
        .limit(1);
      if (!ride) throw new RideNotFoundError();
      await cancelRideCore(tx, ride);
    });
  }

  async function forceCancelRide(rideId: string): Promise<void> {
    await database.transaction(async (tx) => {
      const [ride] = await tx
        .select()
        .from(rideRequests)
        .where(eq(rideRequests.id, rideId))
        .for("update")
        .limit(1);
      if (!ride) throw new RideNotFoundError();
      await cancelRideCore(tx, ride);
      // Full refund: write the fare back to zero via its discount term (all
      // fares CHECKs stay satisfied: final = base + distance - discount).
      await refundFare(tx, rideId);
    });
  }

  // Driver online/offline (Phase 6, ADR-019). Identity comes from the caller,
  // never the client. Going online simply flips the driver's Teslas; going
  // offline is REFUSED while any of the driver's pools is non-terminal
  // (requirements.md §21.J — a driver in an ACCEPTED..STARTED trip cannot duck
  // the work by flipping the switch).
  async function setAvailability(
    driverId: string,
    isOnline: boolean,
  ): Promise<void> {
    await database.transaction(async (tx) => {
      // Lock this driver's Tesla rows FOR UPDATE first (deterministic id
      // order): the shared serialization point with the match-time vehicle
      // lock and with the driver lifecycle transitions (ADR-020). No pool rows
      // are ever locked here, so this cannot deadlock against a match.
      await tx
        .select()
        .from(vehicles)
        .where(eq(vehicles.driverId, driverId))
        .orderBy(asc(vehicles.id))
        .for("update");

      const now = new Date();
      if (isOnline) {
        await tx
          .update(vehicles)
          .set({ isOnline: true, updatedAt: now })
          .where(eq(vehicles.driverId, driverId));
        return;
      }

      // Counted under the vehicle lock: a concurrent match creating a pool on
      // the same Tesla holds that vehicle row until its pool INSERT commits,
      // so this count can never miss a pool that is about to exist.
      const [active] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(pools)
        .where(
          and(
            eq(pools.driverId, driverId),
            sql`${pools.status} not in ('COMPLETED', 'CANCELLED')`,
          ),
        );
      if ((active?.count ?? 0) > 0) {
        throw new DriverHasActivePoolError();
      }
      await tx
        .update(vehicles)
        .set({ isOnline: false, updatedAt: now })
        .where(eq(vehicles.driverId, driverId));
    });
  }

  // -------------------------------------------------------------------------
  // Driver lifecycle (Phase 6, ADR-019/020).
  //
  // Lock order for every transition: driver's VEHICLE rows FOR UPDATE →
  // the pool's member RIDE rows FOR UPDATE → the POOL row FOR UPDATE. The
  // vehicle lock is the shared serialization point with a concurrent match or
  // offline toggle; rides-before-pool keeps the global ride → pool order so a
  // driver transition can never deadlock against a passenger cancel
  // (passenger cancels lock ride → pool). Every action runs on a COMMITTED
  // pool (READ COMMITTED), so it can never collide with the reconstructing
  // match that created it.
  // -------------------------------------------------------------------------

  // Lock the driver's Tesla rows in deterministic id order (and discard them —
  // the point is the lock, not the rows).
  async function lockDriverVehicles(
    tx: DbTransaction,
    driverId: string,
  ): Promise<void> {
    await tx
      .select()
      .from(vehicles)
      .where(eq(vehicles.driverId, driverId))
      .orderBy(asc(vehicles.id))
      .for("update");
  }

  // Lock a pool row and verify the caller owns it. The interloper 404s with
  // the exact same error as "does not exist" — an observer cannot tell the
  // difference (ride-isolation convention, applied to pools).
  async function lockOwnedPool(
    tx: DbTransaction,
    poolId: string,
    driverId: string,
  ): Promise<typeof pools.$inferSelect> {
    const [pool] = await tx
      .select()
      .from(pools)
      .where(eq(pools.id, poolId))
      .for("update");
    if (!pool || pool.driverId !== driverId) {
      throw new PoolNotFoundError();
    }
    return pool;
  }

  // The driver hub's pool + ACTIVE members view, read from either the
  // application handle or inside a transaction. Null when the pool is gone.
  async function loadDriverPoolView(
    source: PoolReadSource,
    poolId: string,
  ): Promise<DriverPoolView | null> {
    const [row] = await source
      .select({ pool: pools, vehicle: vehicles })
      .from(pools)
      .innerJoin(vehicles, eq(vehicles.id, pools.vehicleId))
      .where(eq(pools.id, poolId))
      .limit(1);
    if (!row) return null;

    const members = await source
      .select({
        rideRequestId: rideRequests.id,
        passengerId: users.id,
        passengerName: users.name,
        pickupZoneId: pickupZone.id,
        pickupZoneName: pickupZone.name,
        destinationZoneId: destinationZone.id,
        destinationZoneName: destinationZone.name,
        seats: poolMembers.seats,
      })
      .from(poolMembers)
      .innerJoin(rideRequests, eq(rideRequests.id, poolMembers.rideRequestId))
      .innerJoin(users, eq(users.id, poolMembers.passengerId))
      .innerJoin(pickupZone, eq(pickupZone.id, rideRequests.pickupZoneId))
      .innerJoin(
        destinationZone,
        eq(destinationZone.id, rideRequests.destinationZoneId),
      )
      .where(and(eq(poolMembers.poolId, poolId), eq(poolMembers.status, "ACTIVE")))
      .orderBy(asc(poolMembers.joinedAt), asc(poolMembers.id));

    return {
      id: row.pool.id,
      status: row.pool.status,
      capacitySnapshot: row.pool.capacitySnapshot,
      occupiedSeats: members.reduce((sum, member) => sum + member.seats, 0),
      vehicle: {
        id: row.vehicle.id,
        name: row.vehicle.name,
        capacity: row.vehicle.capacity,
        isOnline: row.vehicle.isOnline,
      },
      acceptedAt: row.pool.acceptedAt,
      startedAt: row.pool.startedAt,
      completedAt: row.pool.completedAt,
      createdAt: row.pool.createdAt,
      updatedAt: row.pool.updatedAt,
      members,
    };
  }

  // "Accept" is a CONFIRMATION of the pool the automatch already assigned to
  // this driver (ADR-016): it records accepted_at while the pool stays MATCHED
  // and is idempotent (a repeated accept is a harmless 200). The pool's OWN
  // Tesla must be online; a pool that already left MATCHED is not acceptable.
  async function acceptPool(
    driverId: string,
    poolId: string,
  ): Promise<DriverPoolView> {
    return await database.transaction(async (tx) => {
      await lockDriverVehicles(tx, driverId);
      const pool = await lockOwnedPool(tx, poolId, driverId);

      const [vehicle] = await tx
        .select()
        .from(vehicles)
        .where(eq(vehicles.id, pool.vehicleId))
        .limit(1);
      if (!vehicle?.isOnline) {
        throw new VehicleOfflineError();
      }
      if (pool.status !== "MATCHED") {
        throw new PoolNotAcceptableError(
          `pool ${poolId} is ${pool.status}; only a MATCHED pool can be accepted`,
        );
      }

      if (pool.acceptedAt === null) {
        const now = new Date();
        await tx
          .update(pools)
          .set({ acceptedAt: now, updatedAt: now })
          .where(eq(pools.id, pool.id));
      }

      const view = await loadDriverPoolView(tx, poolId);
      if (!view) throw new PoolNotFoundError();
      return view;
    });
  }

  // Driver has arrived. Gated on acceptance (P2): a pool the driver never
  // accepted cannot be "arrived at". Aggregate transition: the pool AND every
  // MATCHED member ride move to DRIVER_ARRIVED together, each ride journaled.
  async function arrivePool(
    driverId: string,
    poolId: string,
  ): Promise<DriverPoolView> {
    return await database.transaction(async (tx) => {
      await lockDriverVehicles(tx, driverId);
      // Ride rows before the pool row (global ride → pool lock order).
      const memberRides = await tx
        .select()
        .from(rideRequests)
        .where(
          and(eq(rideRequests.poolId, poolId), eq(rideRequests.status, "MATCHED")),
        )
        .orderBy(asc(rideRequests.id))
        .for("update");

      const pool = await lockOwnedPool(tx, poolId, driverId);
      if (pool.acceptedAt === null) {
        throw new PoolNotAcceptableError(
          "the driver must accept the pool before arriving",
        );
      }
      const reason = invalidTransitionReason(pool.status, "DRIVER_ARRIVED");
      if (reason) throw new InvalidStateTransitionError(reason);

      const now = new Date();
      await tx
        .update(pools)
        .set({ status: "DRIVER_ARRIVED", updatedAt: now })
        .where(eq(pools.id, pool.id));
      for (const ride of memberRides) {
        await tx
          .update(rideRequests)
          .set({ status: "DRIVER_ARRIVED", updatedAt: now })
          .where(eq(rideRequests.id, ride.id));
        await tx.insert(rideStatusHistory).values({
          rideRequestId: ride.id,
          fromStatus: "MATCHED",
          status: "DRIVER_ARRIVED",
        });
      }

      const view = await loadDriverPoolView(tx, poolId);
      if (!view) throw new PoolNotFoundError();
      return view;
    });
  }

  // Shared cancellation core. The ride row is already locked (ride-before-pool
  // lock order); cancelledAt/status/cancelled history are written here, and a
  // MATCHED ride's seat is freed with in-place fare recompute for the members
  // that remain (an emptied pool is cancelled).
  async function cancelRideCore(
    tx: DbTransaction,
    ride: typeof rideRequests.$inferSelect,
  ): Promise<void> {
    const reason = invalidTransitionReason(ride.status, "CANCELLED");
    if (reason) throw new InvalidStateTransitionError(reason);

    const now = new Date();
    await tx
      .update(rideRequests)
      .set({ status: "CANCELLED", cancelledAt: now, updatedAt: now })
      .where(eq(rideRequests.id, ride.id));
    await tx.insert(rideStatusHistory).values({
      rideRequestId: ride.id,
      fromStatus: ride.status,
      status: "CANCELLED",
    });

    if (ride.status === "MATCHED" && ride.poolId) {
      await freeSeatInPool(tx, ride.id, ride.poolId, now);
    }
  }

  // Remove the ACTIVE membership, recompute the remaining members' fares, and
  // terminate the pool when it becomes empty.
  async function freeSeatInPool(
    tx: DbTransaction,
    rideId: string,
    poolId: string,
    now: Date,
  ): Promise<void> {
    const [membership] = await tx
      .select()
      .from(poolMembers)
      .where(
        and(
          eq(poolMembers.rideRequestId, rideId),
          eq(poolMembers.status, "ACTIVE"),
        ),
      )
      .for("update")
      .limit(1);
    if (!membership) {
      throw new InvalidStateTransitionError(
        `ride ${rideId} is MATCHED but has no ACTIVE pool membership`,
      );
    }
    await tx
      .update(poolMembers)
      .set({ status: "LEFT", leftAt: now })
      .where(eq(poolMembers.id, membership.id));
    await recomputeFares(tx, poolId);

    const [remaining] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(poolMembers)
      .where(
        and(eq(poolMembers.poolId, poolId), eq(poolMembers.status, "ACTIVE")),
      );
    const activeCount = remaining?.count ?? 0;
    if (activeCount === 0) {
      await tx
        .update(pools)
        .set({ status: "CANCELLED", updatedAt: now })
        .where(eq(pools.id, poolId));
    } else {
      await tx
        .update(pools)
        .set({ updatedAt: now })
        .where(eq(pools.id, poolId));
    }
  }

  return {
    matchRide,
    cancelRide,
    forceCancelRide,
    setAvailability,
    acceptPool,
    arrivePool,
  };
}