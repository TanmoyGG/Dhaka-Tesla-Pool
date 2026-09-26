// Pooling service (Phase 5): deterministic matching + the seat-claim
// transaction that makes pool capacity race-safe without any distributed
// machinery (ADR-016/017, docs/database.md §5.5). Phase 9 (ADR-022) decoupled
// driver assignment from matching: pools are born UNASSIGNED wait pools and an
// eligibly driver claims them atomically (accept). This file keeps BOTH
// concurrency domains:
//
// Passenger seat-claim contract (the critical invariant, unchanged by ADR-022):
//   - Occupancy is DERIVED each claim from ACTIVE pool_members rows — there is
//     no cached available-seats counter to desync.
//   - A claim locks its candidate pool row with `SELECT ... FOR UPDATE`, then
//     re-derives occupancy UNDER the lock and only joins when
//     occupied + seats <= capacity_snapshot. The 1-seat capacity invariant
//     therefore holds on disk, not just in memory.
//   - A passenger may join any MATCHED pool (assigned or not) while seats
//     remain; acceptance keeps the pool MATCHED, so a claim racing a driver
//     acceptance serializes on the same pool-row lock.
//   - Lock protocol: every transaction that writes both a ride row and a pool
//     row acquires the RIDE row lock first, the POOL row lock second
//     (createRequest already holds the ride lock from its INSERT). Consistent
//     ordering ⇒ no deadlock between match, cancel, and force-cancel.
//
// Driver-acceptance contract (Phase 9, ADR-022):
//   - Pools are created without a driver or Tesla (driver_id NULL, vehicle_id
//     NULL, status MATCHED, capacity_snapshot = 3). Automatch never reserves a
//     Tesla, so a wait pool cannot tie up a driver (requirements.md §21.M).
//   - Acceptance is the FIRST-WINS assignment of driver_id, vehicle_id and
//     accepted_at in ONE transaction. Lock order: the caller's VEHICLE rows
//     FOR UPDATE (id-ascending) → the POOL row FOR UPDATE. The pool-row lock
//     serializes the cross-driver race on the SAME pool (exactly one winner,
//     losers get 409 POOL_ALREADY_ACCEPTED); the vehicle lock serializes
//     accept against the offline toggle and against a same-driver second
//     accept on another pool. The partial unique indexes
//     pools_single_accepted_per_driver/vehicle (migration 0007) backstop the
//     "one active accepted pool per driver" invariant on disk.
//   - A driver may hold at most ONE accepted non-terminal pool; completing or
//     cancelling it (status terminal) frees the driver to accept again.
//   - Match order within a transaction: same pickup zone, all-pairs drop-off
//     spread <= POOL_DEST_SPREAD_KM, then fullest pool first
//     (occupiedSeats DESC, createdAt ASC, id ASC). See src/matching/rules.ts.

import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { isUniqueViolation } from "../../db/postgres-errors.js";
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
  PoolAlreadyAcceptedError,
  VehicleOfflineError,
} from "../errors.js";
import {
  recomputeActivePoolFares,
  refundFare,
  type RecomputePoolFares,
} from "./fare.js";

const destinationZone = alias(zones, "destination_zone");
const pickupZone = alias(zones, "pickup_zone");

// MVP Tesla capacity (PRD: three-seat battery "Teslas"). Every pool is born
// with capacity_snapshot = TESLA_CAPACITY and an accepting vehicle must have
// capacity >= that snapshot, so the pool can never grow beyond what its driver
// can carry (ADR-022).
const TESLA_CAPACITY = 3;

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
  // The assigned Tesla. NULL while the pool is an UNASSIGNED wait pool in the
  // driver lobby (ADR-022); set once a driver accepts.
  vehicle: {
    id: string;
    name: string;
    capacity: number;
    isOnline: boolean;
  } | null;
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
  // Driver flow (Phase 6, ADR-019); Phase 9, ADR-022 redefined accept. All
  // methods take the driver identity ONLY from the authenticated caller.
  // Going offline is refused while the driver holds an ACCEPTED non-terminal
  // pool (requirements.md §21.J, strict). Unassigned wait pools carry
  // driver_id NULL and so never block the toggle. Maps to
  // 409 DRIVER_HAS_ACTIVE_POOL.
  setAvailability(driverId: string, isOnline: boolean): Promise<void>;
  // Read-only snapshot of online state for the dashboard toggle: true when
  // every owned Tesla is online (mirrors what setAvailability produced).
  getAvailabilityForDriver(driverId: string): Promise<{ isOnline: boolean }>;
  // The driver lobby: every UNASSIGNED MATCHED pool (driver_id NULL) that is
  // waiting for an eligible driver to claim it, newest first. Identical for
  // every DRIVER-role caller — the lobby cannot be personalized, so it takes
  // no driver identity. No driver or Tesla is reserved by a wait pool
  // (ADR-022).
  getAvailablePools(): Promise<DriverPoolView[]>;
  // FIRST-WINS acceptance of an unassigned pool (ADR-022): atomically writes
  // driver_id, vehicle_id and accepted_at. Requires the caller to be a DRIVER
  // route (role guard), have an online Tesla with capacity for the pool, and
  // hold no accepted non-terminal pool (409 DRIVER_HAS_ACTIVE_POOL). Two
  // drivers racing the same pool: exactly one wins, the loser gets
  // 409 POOL_ALREADY_ACCEPTED. Re-accepting a pool this driver already accepted
  // is idempotent (200) while it stays MATCHED. A pool that left MATCHED is
  // 409 POOL_NOT_ACCEPTABLE; an unknown id is a plain 404. Returns the driver
  // hub view.
  acceptPool(driverId: string, poolId: string): Promise<DriverPoolView>;
  // Driver has arrived. Gated on acceptance (P2): arriving before accepting is
  // 409 POOL_NOT_ACCEPTABLE; a pool/ride that cannot move to DRIVER_ARRIVED is
  // 409 INVALID_STATE_TRANSITION. Transitions the pool and every MATCHED
  // member ride together, per-ride journaled.
  arrivePool(driverId: string, poolId: string): Promise<DriverPoolView>;
  // Trip on. Transitions the pool (started_at set) and every DRIVER_ARRIVED
  // member ride to STARTED together; invalid moves are 409
  // INVALID_STATE_TRANSITION.
  startPool(driverId: string, poolId: string): Promise<DriverPoolView>;
  // Trip finished. Transitions the pool (completed_at set) and every STARTED
  // member ride to COMPLETED together; frees the Tesla for new matching via
  // the partial unique index. Fares/occupancy are left untouched.
  completePool(driverId: string, poolId: string): Promise<DriverPoolView>;
  // Read surface for the driver hub.
  // Every non-terminal pool the driver owns, newest first (deterministic
  // created_at desc, id desc tiebreak). No fares, ACTIVE members only.
  listDriverPools(driverId: string): Promise<DriverPoolView[]>;
  // Completed-trip history: pools the driver COMPLETED, newest first (limited,
  // default 10). Same projection as listDriverPools; no fares.
  listDriverHistory(driverId: string, limit?: number): Promise<DriverPoolView[]>;
  // A single pool by id; anything that isn't the caller's pool is a plain 404
  // (existence hidden 1:1).
  getDriverPool(driverId: string, poolId: string): Promise<DriverPoolView>;
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

  // Every claimable pool right now: status MATCHED. A pool is claimable
  // whether or not a driver has accepted it (acceptance keeps MATCHED, and an
  // accepted driver cannot go offline while their pool is non-terminal, so
  // every MATCHED pool is ride-worthy); occupancy and drop-off geometry are
  // derived from its ACTIVE members. Unassigned wait pools are just as
  // claimable as assigned ones (ADR-022).
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
      .where(eq(pools.status, "MATCHED"));
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

    // 1. Join the best eligible EXISTING pool when one fits AND the claim wins.
    //    pickBestPool is deterministic: fullest first (occupied DESC), then
    //    created_at ASC, then id ASC (docs/requirements.md §21.A). A pool that
    //    was already accepted by a driver is equally eligible while it stays
    //    MATCHED. A failed claim means the pool filled (or left MATCHED)
    //    between the lock-free read and the row lock — never an error.
    const poolsNow = await loadCandidatePools(tx);
    const chosen = pickBestPool(poolsNow, toDropOffCandidate(candidate));
    if (chosen && (await claimSeatIn(tx, candidate, chosen.id))) {
      return true;
    }

    // 2. Otherwise (no eligible pool, or the claim lost to a concurrent seat
    //    grab) the request never stalls REQUESTED: it starts its own UNASSIGNED
    //    wait pool (approved "always create a wait pool" model, ADR-022). No
    //    driver or Tesla is selected here — driver_id NULL / vehicle_id NULL /
    //    status MATCHED, waiting in the driver lobby. capacity_snapshot is the
    //    MVP's fixed three-seat Tesla capacity; an accepting vehicle must
    //    satisfy it. This is the documented outcome for far drop-offs and for
    //    the loser of the final-seat race.
    const [created] = await tx
      .insert(pools)
      .values({
        driverId: null,
        vehicleId: null,
        status: "MATCHED",
        capacitySnapshot: TESLA_CAPACITY,
      })
      .returning();
    if (!created) return false;

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
  // offline is REFUSED while the driver holds an ACCEPTED non-terminal pool
  // (requirements.md §21.J — a driver in an ACCEPTED..STARTED trip cannot duck
  // the work by flipping the switch). Unassigned wait pools carry driver_id
  // NULL and so never block the toggle (ADR-022); they simply stop being
  // visible to this driver once offline, and no Tesla is reserved by them.
  async function setAvailability(
    driverId: string,
    isOnline: boolean,
  ): Promise<void> {
    await database.transaction(async (tx) => {
      // Lock this driver's Tesla rows FOR UPDATE first (deterministic id
      // order): the shared serialization point with accept and with arrivals
      // (every driver transition takes the vehicle lock first, ADR-020). No
      // pool rows are ever locked here, so this cannot deadlock against a
      // passenger match/cancel (ride → pool).
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

      // Counted under the vehicle lock: a concurrent acceptance holding a
      // vehicle row writes driver_id + accepted_at on its pool in the same
      // transaction, so this count can never miss a pool that is about to be
      // accepted (ADR-022).
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
  // Driver lifecycle (Phase 6, ADR-019/020; Phase 9, ADR-022).
  //
  // Lock order for every transition: driver's VEHICLE rows FOR UPDATE →
  // the pool's member RIDE rows FOR UPDATE → the POOL row FOR UPDATE. The
  // vehicle lock is the shared serialization point with accept and the offline
  // toggle; rides-before-pool keeps the global ride → pool order so a driver
  // transition can never deadlock against a passenger cancel (passenger
  // cancels lock ride → pool). Acceptance adds the cross-driver first-wins
  // serialization on the contested POOL row (ADR-022): after taking the
  // vehicle lock, the winner's pool-row lock blocks the loser's read of the
  // same row until acceptance commits, so exactly one driver ever sees it
  // UNASSIGNED. Every action runs on a COMMITTED pool (READ COMMITTED), so it
  // can never collide with the reconstructing match that created it.
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

  // The driver surface's pool + ACTIVE members view, read from either the
  // application handle or inside a transaction. Null when the pool is gone.
  // Vehicle is LEFT-joined and NULL for an UNASSIGNED wait pool (ADR-022);
  // the driver surface renders it as "waiting for a driver".
  async function loadDriverPoolView(
    source: PoolReadSource,
    poolId: string,
  ): Promise<DriverPoolView | null> {
    const [row] = await source
      .select({ pool: pools, vehicle: vehicles })
      .from(pools)
      .leftJoin(vehicles, eq(vehicles.id, pools.vehicleId))
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
      vehicle: row.vehicle
        ? {
            id: row.vehicle.id,
            name: row.vehicle.name,
            capacity: row.vehicle.capacity,
            isOnline: row.vehicle.isOnline,
          }
        : null,
      acceptedAt: row.pool.acceptedAt,
      startedAt: row.pool.startedAt,
      completedAt: row.pool.completedAt,
      createdAt: row.pool.createdAt,
      updatedAt: row.pool.updatedAt,
      members,
    };
  }

  // Pick the Tesla that will carry this pool from the driver's (already
  // vehicle-locked) fleet. Deterministic: name ASC then id ASC. Eligibility:
  // online AND capacity >= pool.capacity_snapshot — the pool must fit the
  // WHOLE ride, not just today's occupancy, or a later joiner could oversell
  // the car. capacity_snapshot is the born-with TESLA_CAPACITY, so in the MVP
  // this is capacity >= 3: a 2-seater cannot be accepted for a 3-seat pool.
  async function pickDriverVehicle(
    tx: DbTransaction,
    driverId: string,
    capacitySnapshot: number,
  ): Promise<typeof vehicles.$inferSelect | undefined> {
    const [row] = await tx
      .select({ vehicle: vehicles })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.driverId, driverId),
          eq(vehicles.isOnline, true),
          sql`${vehicles.capacity} >= ${capacitySnapshot}`,
        ),
      )
      .orderBy(asc(vehicles.name), asc(vehicles.id))
      .limit(1);
    return row?.vehicle;
  }

  // "Accept" is the FIRST-WINS assignment of an UNASSIGNED wait pool to this
  // driver (Phase 9, ADR-022): it atomically writes driver_id, vehicle_id and
  // accepted_at in one transaction, removing the pool from the driver lobby.
  // Re-accepting a pool this driver already accepted stays idempotent (200)
  // while it is MATCHED. A pool already accepted by ANOTHER driver is
  // 409 POOL_ALREADY_ACCEPTED (the loser of the race); a pool that left
  // MATCHED is 409 POOL_NOT_ACCEPTABLE; no online Tesla with capacity for the
  // pool → 409 VEHICLE_OFFLINE; already holding an accepted non-terminal pool
  // → 409 DRIVER_HAS_ACTIVE_POOL; unknown id → plain 404.
  async function acceptPool(
    driverId: string,
    poolId: string,
  ): Promise<DriverPoolView> {
    return await database.transaction(async (tx) => {
      // VEHICLE rows FOR UPDATE first (deterministic id order). Serializes
      // against the offline toggle: it re-reads the accepted-pool count under
      // the same vehicle lock, so an offline flip can never commit between our
      // eligibility read and our accepted-pool write (ADR-020).
      await lockDriverVehicles(tx, driverId);

      // A driver can hold at most one accepted non-terminal pool — the same
      // count setAvailability enforces on the offline path, checked under the
      // vehicle lock (migration 0007's partial unique index backstops it on
      // disk). Wait pools carry driver_id NULL and never count here. The pool
      // being (re-)accepted is EXCLUDED so an idempotent re-accept by the
      // owning driver is not blocked by its own row (ADR-022: re-accepting an
      // already-accepted pool is 200 while it stays MATCHED).
      const [active] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(pools)
        .where(
          and(
            eq(pools.driverId, driverId),
            sql`${pools.status} not in ('COMPLETED', 'CANCELLED')`,
            ne(pools.id, poolId),
          ),
        );
      if ((active?.count ?? 0) > 0) {
        throw new DriverHasActivePoolError();
      }

      // The contested POOL row lock is the first-wins point: the winner locks
      // it first, reads driver_id NULL, assigns itself and commits; when the
      // loser's SELECT ... FOR UPDATE unblocks it reads the committed
      // assignment and gets POOL_ALREADY_ACCEPTED. Exactly one winner.
      const [pool] = await tx
        .select()
        .from(pools)
        .where(eq(pools.id, poolId))
        .for("update");

      if (!pool) throw new PoolNotFoundError();
      if (pool.driverId !== null) {
        if (pool.driverId !== driverId) {
          throw new PoolAlreadyAcceptedError();
        }
        // Idempotent re-accept by the owning driver: harmless 200 while the
        // pool is still in a state this action accepts.
        if (pool.status !== "MATCHED") {
          throw new PoolNotAcceptableError(
            `pool ${poolId} is ${pool.status}; only a MATCHED pool can be accepted`,
          );
        }
        const existing = await loadDriverPoolView(tx, poolId);
        if (!existing) throw new PoolNotFoundError();
        return existing;
      }
      if (pool.status !== "MATCHED") {
        throw new PoolNotAcceptableError(
          `pool ${poolId} is ${pool.status}; only a MATCHED pool can be accepted`,
        );
      }

      const vehicle = await pickDriverVehicle(
        tx,
        driverId,
        pool.capacitySnapshot,
      );
      if (!vehicle) {
        throw new VehicleOfflineError();
      }

      const now = new Date();
      try {
        await tx
          .update(pools)
          .set({
            driverId,
            vehicleId: vehicle.id,
            acceptedAt: now,
            updatedAt: now,
          })
          .where(eq(pools.id, poolId));
      } catch (error) {
        // Backstop for the one-active-accepted-pool invariant: under the
        // vehicle lock a racing acceptance cannot pass the pre-check, but the
        // partial unique index is the final word — surface a raw 23505 as the
        // documented conflict instead of leaking SQL.
        if (isUniqueViolation(error)) {
          throw new DriverHasActivePoolError();
        }
        throw error;
      }

      const view = await loadDriverPoolView(tx, poolId);
      if (!view) throw new PoolNotFoundError();
      return view;
    });
  }

  // Driver has arrived. Gated on acceptance (P2), now via ownership: a pool the
  // driver never accepted belongs to NOBODY until it is assigned (driver_id
  // NULL), so it 404s exactly like a pool owned by another driver — ownership
  // is only established by acceptance (ADR-022). The acceptedAt-null guard is
  // defensive belt-and-braces: the assignment CHECK (migration 0007) makes
  // an owned-but-unaccepted pool impossible on disk. Aggregate transition: the
  // pool AND every MATCHED member ride move to DRIVER_ARRIVED together, each
  // ride journaled.
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

  // The trip is on. Aggregate transition: pool + every DRIVER_ARRIVED member
  // ride move to STARTED together (pool gets started_at), each ride journaled.
  async function startPool(
    driverId: string,
    poolId: string,
  ): Promise<DriverPoolView> {
    return await database.transaction(async (tx) => {
      await lockDriverVehicles(tx, driverId);
      const memberRides = await tx
        .select()
        .from(rideRequests)
        .where(
          and(
            eq(rideRequests.poolId, poolId),
            eq(rideRequests.status, "DRIVER_ARRIVED"),
          ),
        )
        .orderBy(asc(rideRequests.id))
        .for("update");

      const pool = await lockOwnedPool(tx, poolId, driverId);
      const reason = invalidTransitionReason(pool.status, "STARTED");
      if (reason) throw new InvalidStateTransitionError(reason);

      const now = new Date();
      await tx
        .update(pools)
        .set({ status: "STARTED", startedAt: now, updatedAt: now })
        .where(eq(pools.id, pool.id));
      for (const ride of memberRides) {
        await tx
          .update(rideRequests)
          .set({ status: "STARTED", updatedAt: now })
          .where(eq(rideRequests.id, ride.id));
        await tx.insert(rideStatusHistory).values({
          rideRequestId: ride.id,
          fromStatus: "DRIVER_ARRIVED",
          status: "STARTED",
        });
      }

      const view = await loadDriverPoolView(tx, poolId);
      if (!view) throw new PoolNotFoundError();
      return view;
    });
  }

  // Trip finished. Aggregate transition: pool + every STARTED member ride move
  // to COMPLETED together (pool gets completed_at, each ride gets its own
  // completed_at), ride histories journaled. Seats/membership and fares are
  // left untouched — the record must stay explainable (requirements §21.I).
  // status=COMPLETED drops the pool out of pools_single_active_per_vehicle,
  // freeing the Tesla for new matching.
  async function completePool(
    driverId: string,
    poolId: string,
  ): Promise<DriverPoolView> {
    return await database.transaction(async (tx) => {
      await lockDriverVehicles(tx, driverId);
      const memberRides = await tx
        .select()
        .from(rideRequests)
        .where(
          and(
            eq(rideRequests.poolId, poolId),
            eq(rideRequests.status, "STARTED"),
          ),
        )
        .orderBy(asc(rideRequests.id))
        .for("update");

      const pool = await lockOwnedPool(tx, poolId, driverId);
      const reason = invalidTransitionReason(pool.status, "COMPLETED");
      if (reason) throw new InvalidStateTransitionError(reason);

      const now = new Date();
      await tx
        .update(pools)
        .set({ status: "COMPLETED", completedAt: now, updatedAt: now })
        .where(eq(pools.id, pool.id));
      for (const ride of memberRides) {
        await tx
          .update(rideRequests)
          .set({ status: "COMPLETED", completedAt: now, updatedAt: now })
          .where(eq(rideRequests.id, ride.id));
        await tx.insert(rideStatusHistory).values({
          rideRequestId: ride.id,
          fromStatus: "STARTED",
          status: "COMPLETED",
        });
      }

      const view = await loadDriverPoolView(tx, poolId);
      if (!view) throw new PoolNotFoundError();
      return view;
    });
  }

  // Driver online/offline SNAPSHOT for the dashboard toggle (read-only; the
  // toggle itself is setAvailability/ADR-019). A driver is "online" when every
  // owned Tesla is online — the toggle sets them all at once, so the snapshot
  // must mirror exactly what the toggle last produced.
  async function getAvailabilityForDriver(
    driverId: string,
  ): Promise<{ isOnline: boolean }> {
    const rows = await database
      .select({ isOnline: vehicles.isOnline })
      .from(vehicles)
      .where(eq(vehicles.driverId, driverId));
    return {
      isOnline: rows.length > 0 && rows.every((vehicle) => vehicle.isOnline),
    };
  }

  // The driver lobby (Phase 9, ADR-022): every UNASSIGNED MATCHED pool
  // (driver_id NULL) still waiting for an eligible driver, newest first. No
  // driver or Tesla is reserved by a wait pool — this list is purely derived
  // state, so an accept just drops the pool out of it. Lock-free read; the
  // driver's own accepted pools show up via listDriverPools, not here.
  async function getAvailablePools(): Promise<DriverPoolView[]> {
    const rows = await database
      .select()
      .from(pools)
      .where(and(isNull(pools.driverId), eq(pools.status, "MATCHED")))
      .orderBy(desc(pools.createdAt), desc(pools.id));
    if (rows.length === 0) return [];
    const poolRows = rows.map((pool) => ({
      pool,
      // Unassigned by construction (driver_id NULL ⇒ vehicle_id NULL): the
      // lobby is the only surface where a pool has no vehicle at all.
      vehicle: null as typeof vehicles.$inferSelect | null,
    }));
    return hydratePoolViews(
      poolRows,
      await loadMembersForPools(poolRows.map((row) => row.pool.id)),
    );
  }

  // The driver hub's open pools: every accepted non-terminal pool this driver
  // owns, newest first (created_at then id desc, so ordering is deterministic
  // even without second-precision timestamps). Lock-free read.
  async function listDriverPools(driverId: string): Promise<DriverPoolView[]> {
    const poolRows = await database
      .select({ pool: pools, vehicle: vehicles })
      .from(pools)
      .innerJoin(vehicles, eq(vehicles.id, pools.vehicleId))
      .where(
        and(
          eq(pools.driverId, driverId),
          sql`${pools.status} not in ('COMPLETED', 'CANCELLED')`,
        ),
      )
      .orderBy(desc(pools.createdAt), desc(pools.id));
    if (poolRows.length === 0) return [];
    return hydratePoolViews(
      poolRows,
      await loadMembersForPools(poolRows.map((row) => row.pool.id)),
    );
  }

  // The driver hub's completed-trip history (PRD driver: "see history").
  // SAME projection as listDriverPools but restricted to COMPLETED pools,
  // most recently completed first — covers the MVP's trip-history need
  // without a separate source.
  async function listDriverHistory(
    driverId: string,
    limit = 10,
  ): Promise<DriverPoolView[]> {
    const poolRows = await database
      .select({ pool: pools, vehicle: vehicles })
      .from(pools)
      .innerJoin(vehicles, eq(vehicles.id, pools.vehicleId))
      .where(and(eq(pools.driverId, driverId), eq(pools.status, "COMPLETED")))
      .orderBy(desc(pools.completedAt), desc(pools.createdAt), desc(pools.id))
      .limit(limit);
    if (poolRows.length === 0) return [];
    return hydratePoolViews(
      poolRows,
      await loadMembersForPools(poolRows.map((row) => row.pool.id)),
    );
  }

  async function loadMembersForPools(poolIds: string[]) {
    if (poolIds.length === 0) return [];
    return await database
      .select({
        poolId: poolMembers.poolId,
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
      .where(
        and(
          inArray(poolMembers.poolId, poolIds),
          eq(poolMembers.status, "ACTIVE"),
        ),
      )
      .orderBy(asc(poolMembers.joinedAt), asc(poolMembers.id));
  }

  function hydratePoolViews(
    poolRows: {
      pool: typeof pools.$inferSelect;
      vehicle: typeof vehicles.$inferSelect | null;
    }[],
    memberRows: Awaited<ReturnType<typeof loadMembersForPools>>,
  ): DriverPoolView[] {
    const membersByPool = new Map<string, (typeof memberRows)[number][]>();
    for (const member of memberRows) {
      const list = membersByPool.get(member.poolId) ?? [];
      list.push(member);
      membersByPool.set(member.poolId, list);
    }

    return poolRows.map((row) => {
      const members = membersByPool.get(row.pool.id) ?? [];
      return {
        id: row.pool.id,
        status: row.pool.status,
        capacitySnapshot: row.pool.capacitySnapshot,
        occupiedSeats: members.reduce((sum, member) => sum + member.seats, 0),
        vehicle: row.vehicle
          ? {
              id: row.vehicle.id,
              name: row.vehicle.name,
              capacity: row.vehicle.capacity,
              isOnline: row.vehicle.isOnline,
            }
          : null,
        acceptedAt: row.pool.acceptedAt,
        startedAt: row.pool.startedAt,
        completedAt: row.pool.completedAt,
        createdAt: row.pool.createdAt,
        updatedAt: row.pool.updatedAt,
        members,
      };
    });
  }

  // A single pool for the driver hub by id. Ownership hides existence 1:1: a
  // pool that isn't the caller's responds exactly like one that doesn't exist
  // (404 NOT_FOUND, same envelope, no details leaked).
  async function getDriverPool(
    driverId: string,
    poolId: string,
  ): Promise<DriverPoolView> {
    const [owned] = await database
      .select({ id: pools.id })
      .from(pools)
      .where(and(eq(pools.id, poolId), eq(pools.driverId, driverId)))
      .limit(1);
    if (!owned) throw new PoolNotFoundError();
    const view = await loadDriverPoolView(database, poolId);
    if (!view) throw new PoolNotFoundError();
    return view;
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

    if (
      (ride.status === "MATCHED" || ride.status === "DRIVER_ARRIVED") &&
      ride.poolId
    ) {
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
    getAvailabilityForDriver,
    getAvailablePools,
    acceptPool,
    arrivePool,
    startPool,
    completePool,
    listDriverPools,
    listDriverHistory,
    getDriverPool,
  };
}