// Drizzle schema for Dhaka Tesla Pool — phases 2 (database design) + 3 (Clerk).
//
// Conventions:
// - All primary keys are UUIDs (default gen_random_uuid(), PG >= 13 built-in).
// - All timestamps are timezone-aware (`timestamptz`) UTC.
// - All money is integer paisa/poysha (never floating point).
// - Domain enums are PostgreSQL-native enum types for integrity + readability.
// - Ride-domain tables use ON DELETE RESTRICT: ride data is history and must
//   stay explainable (docs/requirements.md §21.I). vehicles are infrastructure
//   owned by a user and use ON DELETE CASCADE.
// - One naming for the PRD's lifecycle: "MATCHED/ACCEPTED" is stored as the
//   single enum value MATCHED (see docs/database.md §5.2).
// - Authentication is owned by Clerk (external identity provider). The local
//   `users` table keeps the application-level record: a `clerk_user_id` maps a
//   verified Clerk identity to the local user, and the application ROLE lives
//   here in PostgreSQL (the application source of truth for authorization).
//   There is no `sessions` table: Clerk owns the session lifecycle (ADR-013).
//
// What cannot be expressed as a simple SQL CHECK (documented, enforced by the
// application in later phases):
// - "only a USER with role=DRIVER owns a vehicle" — requires a cross-table
//   lookup; CHECK constraints cannot reference other tables.
// - "pools.driver_id equals vehicles.driver_id" — cross-table equality.
// - "pool occupancy never exceeds capacity_snapshot" — aggregate row overlap;
//   enforced transactionally (SELECT ... FOR UPDATE) in the pooling phase.
// - "valid ride-state transitions" — depends on the previous row; enforced by
//   the state machine (Phase 8) and recorded in ride_status_history.

import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  text,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "PASSENGER",
  "DRIVER",
  "ADMIN",
]);

export const rideStatusEnum = pgEnum("ride_status", [
  "REQUESTED",
  "MATCHED",
  "DRIVER_ARRIVED",
  "STARTED",
  "COMPLETED",
  "CANCELLED",
]);

export const poolMemberStatusEnum = pgEnum("pool_member_status", [
  "ACTIVE",
  "LEFT",
]);

// ---------------------------------------------------------------------------
// users — the application-owned user record.
//
// Clerk owns AUTHENTICATION (who you are: a verified Clerk identity).
// This table owns the APPLICATION record (role, active, and every ride-domain
// relationship): who the user is inside the product and what they may do.
// `clerk_user_id` is the non-null, unique mapping from a verified Clerk
// identity to this row. The role NEVER comes from the frontend or from Clerk —
// it is stored here in PostgreSQL (docs/database.md §6).
// ---------------------------------------------------------------------------
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Clerk's opaque user identifier (e.g. "user_2..."). Unique + indexed via
    // the unique constraint. Never invented/guessed: only a verified Clerk
    // session produces a value that the API will look up here.
    clerkUserId: text("clerk_user_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: userRoleEnum("role").notNull().default("PASSENGER"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // name cannot be empty (btrim covers whitespace-only names).
    check("users_name_not_empty", sql`length(btrim(${table.name})) > 0`),
    // Emails are stored lowercase so the unique index is case-insensitive by
    // construction; the app normalizes on write.
    check("users_email_lowercase", sql`${table.email} = lower(${table.email})`),
    unique("users_email_unique").on(table.email),
    // One local application user per Clerk identity and vice-versa. The
    // UNIQUE constraint creates the unique index the API uses to resolve a
    // verified Clerk userId to its application record.
    unique("users_clerk_user_id_unique").on(table.clerkUserId),
  ],
);

// ---------------------------------------------------------------------------
// NOTE: there is no `sessions` table. Phase 2 had an application-owned session
// table for the originally planned manual cookie authentication; that design
// was replaced by Clerk (ADR-013) and the table was dropped by migration 0001.
// Clerk owns authentication sessions; PostgreSQL is not an auth-session store.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// vehicles — the driver-owned, fixed-capacity Tesla.
// ---------------------------------------------------------------------------
export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Vehicle name/identifier, e.g. "Bullet".
    name: text("name").notNull(),
    // MVP Teslas are fixed-capacity (3 seats). Only "positive" is enforced here;
    // per the PRD "capacity must be positive" (a later phase reads it to build
    // the capacity_snapshot on pool creation).
    capacity: integer("capacity").notNull(),
    isOnline: boolean("is_online").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("vehicles_name_not_empty", sql`length(btrim(${table.name})) > 0`),
    check("vehicles_capacity_positive", sql`${table.capacity} > 0`),
    // driver's vehicle list (FK + "vehicles I own").
    index("vehicles_driver_id_idx").on(table.driverId),
    // matching: only consider Teslas that are online.
    index("vehicles_is_online_idx")
      .on(table.isOnline)
      .where(sql`${table.isOnline}`),
  ],
);

// ---------------------------------------------------------------------------
// zones — predefined Dhaka geography (plain lat/long points, no routing).
// ---------------------------------------------------------------------------
export const zones = pgTable(
  "zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("zones_name_not_empty", sql`length(btrim(${table.name})) > 0`),
    check("zones_latitude_range", sql`${table.latitude} between -90 and 90`),
    check(
      "zones_longitude_range",
      sql`${table.longitude} between -180 and 180`,
    ),
    unique("zones_name_unique").on(table.name),
  ],
);

// ---------------------------------------------------------------------------
// pools — one Tesla serving a set of matched ride requests.
// ---------------------------------------------------------------------------
export const pools = pgTable(
  "pools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // Carries the full PRD lifecycle REQUESTED → ... → COMPLETED/+CANCELLED.
    status: rideStatusEnum("status").notNull().default("REQUESTED"),
    // Snapshot of the vehicle capacity when the pool was created, so history
    // stays understandable even if the vehicle is reconfigured later.
    capacitySnapshot: integer("capacity_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // When the driver confirmed the auto-assigned pool (Phase 6, ADR-019).
    // Pools are born MATCHED (ADR-016); "accept" is a confirmation that records
    // when it happened, it does not change the status. Set while MATCHED and
    // never cleared: a pool that reaches DRIVER_ARRIVED/STARTED/COMPLETED must
    // have been accepted (CHECK pools_accepted_progression).
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "pools_capacity_snapshot_positive",
      sql`${table.capacitySnapshot} > 0`,
    ),
    // A pool that reaches the driver-flow states must have been accepted
    // first. CANCELLED is NOT guarded: a MATCHED pool may be cancelled without
    // ever being accepted (the MATCHED → CANCELLED arm stays legal), and a
    // cancelled trip no longer needs its acceptance marker (migration 0005).
    check(
      "pools_accepted_progression",
      sql`${table.acceptedAt} is not null or ${table.status} not in ('DRIVER_ARRIVED', 'STARTED', 'COMPLETED')`,
    ),
    // started_at is only ever set once the trip actually started.
    check(
      "pools_started_timestamp",
      sql`${table.startedAt} is null or ${table.status} in ('STARTED', 'COMPLETED')`,
    ),
    // COMPLETED must always carry its completion timestamp.
    check(
      "pools_complete_timestamp",
      sql`(${table.status} = 'COMPLETED') = (${table.completedAt} is not null)`,
    ),
    // A pool cannot complete without having started.
    check(
      "pools_complete_requires_started",
      sql`${table.status} <> 'COMPLETED' or ${table.startedAt} is not null`,
    ),
    // One active (non-terminal) pool per vehicle: exactly the integrity rule
    // that makes "occupied seats" a per-pool aggregate meaningful. See
    // docs/database.md §5.5 (concurrency) for how this composes with locking.
    uniqueIndex("pools_single_active_per_vehicle")
      .on(table.vehicleId)
      .where(sql`${table.status} not in ('COMPLETED', 'CANCELLED')`),
    index("pools_vehicle_idx").on(table.vehicleId),
    index("pools_driver_idx").on(table.driverId),
    index("pools_status_idx").on(table.status),
    // Driver-side "which of my pools have I accepted / am working" reads
    // (Phase 6, ADR-019); partial because accepted pools are the interesting set.
    index("driver_pools_accept_idx")
      .on(table.acceptedAt)
      .where(sql`${table.acceptedAt} is not null`),
  ],
);

// ---------------------------------------------------------------------------
// ride_requests — a passenger's request: pickup, destination, seats.
// ---------------------------------------------------------------------------
export const rideRequests = pgTable(
  "ride_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    passengerId: uuid("passenger_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    pickupZoneId: uuid("pickup_zone_id")
      .notNull()
      .references(() => zones.id, { onDelete: "restrict" }),
    destinationZoneId: uuid("destination_zone_id")
      .notNull()
      .references(() => zones.id, { onDelete: "restrict" }),
    requestedSeats: integer("requested_seats").notNull(),
    status: rideStatusEnum("status").notNull().default("REQUESTED"),
    // Client-supplied idempotency key (optional): lets a passenger retry a
    // "create ride" safely. Requests WITHOUT a key may create a new ride on a
    // repeated submission (documented MVP behavior, ADR-015).
    clientRequestId: uuid("client_request_id"),
    // Null while the request is unassigned; set when it joins a pool.
    poolId: uuid("pool_id").references(() => pools.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "ride_requests_seats_positive",
      sql`${table.requestedSeats} > 0`,
    ),
    // A pickup that equals its destination is a meaningless request.
    check(
      "ride_requests_pickup_ne_destination",
      sql`${table.pickupZoneId} <> ${table.destinationZoneId}`,
    ),
    // Terminal timestamps must not conflict: CANCELLED carries cancelled_at,
    // COMPLETED carries completed_at; a request cannot be both.
    check(
      "ride_requests_cancel_timestamp",
      sql`(${table.status} = 'CANCELLED') = (${table.cancelledAt} is not null)`,
    ),
    check(
      "ride_requests_complete_timestamp",
      sql`(${table.status} = 'COMPLETED') = (${table.completedAt} is not null)`,
    ),
    check(
      "ride_requests_single_terminal",
      sql`${table.cancelledAt} is null or ${table.completedAt} is null`,
    ),
    // A request assigned to a pool has moved past REQUESTED (membership is
    // only ever created at matching time, docs/requirements.md §21.C).
    check(
      "ride_requests_pool_requires_matched",
      sql`${table.poolId} is null or ${table.status} <> 'REQUESTED'`,
    ),
    // passenger history/recent-first and ownership scope.
    index("ride_requests_passenger_history_idx").on(
      table.passengerId,
      table.createdAt,
    ),
    // Idempotent ride creation: at most one ride per (passenger, key) when a
    // key is supplied (partial: NULL keys are ignored). See docs/decisions.md
    // ADR-015 — the service re-reads the winner's row on a unique conflict.
    uniqueIndex("ride_requests_client_request_id_key")
      .on(table.passengerId, table.clientRequestId)
      .where(sql`${table.clientRequestId} is not null`),
    // matching: scan for requests awaiting a driver.
    index("ride_requests_status_idx").on(table.status),
    // reverse lookup: which requests ride in this pool (FK support too).
    index("ride_requests_pool_idx").on(table.poolId),
  ],
);

// ---------------------------------------------------------------------------
// pool_members — the explicit join between a passenger's ride request and a
// pool. Occupied seats are derived ONLY from ACTIVE memberships here; there is
// no cached "available seats" column (docs/database.md §5.5).
// ---------------------------------------------------------------------------
export const poolMembers = pgTable(
  "pool_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    poolId: uuid("pool_id")
      .notNull()
      .references(() => pools.id, { onDelete: "restrict" }),
    rideRequestId: uuid("ride_request_id")
      .notNull()
      .references(() => rideRequests.id, { onDelete: "restrict" }),
    passengerId: uuid("passenger_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    seats: integer("seats").notNull(),
    status: poolMemberStatusEnum("status").notNull().default("ACTIVE"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (table) => [
    check("pool_members_seats_positive", sql`${table.seats} > 0`),
    // A member that left must carry its departure timestamp.
    check(
      "pool_members_left_timestamp",
      sql`(${table.status} = 'LEFT') = (${table.leftAt} is not null)`,
    ),
    // Invariant: a ride request cannot be added to the same pool twice.
    unique("pool_members_pool_request_unique").on(
      table.poolId,
      table.rideRequestId,
    ),
    // Invariant: at most ONE active pool membership per ride request.
    uniqueIndex("pool_members_one_active_per_request")
      .on(table.rideRequestId)
      .where(sql`${table.status} = 'ACTIVE'`),
    // occupancy aggregates: WHERE pool_id = ? AND status = 'ACTIVE'.
    index("pool_members_pool_status_idx").on(table.poolId, table.status),
    // FK support + reverse lookup from a request to its membership.
    index("pool_members_ride_request_idx").on(table.rideRequestId),
    // passenger's ride history joins.
    index("pool_members_passenger_idx").on(table.passengerId),
  ],
);

// ---------------------------------------------------------------------------
// fares — individual per-request fare snapshot (integer paisa/poysha).
// The formula passengerFare = baseFare + distanceCharge − poolDiscount is
// enforced here so stored history can never contradict the documented model;
// the service that computes these values arrives in later phases.
// ---------------------------------------------------------------------------
export const fares = pgTable(
  "fares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rideRequestId: uuid("ride_request_id")
      .notNull()
      .references(() => rideRequests.id, { onDelete: "restrict" }),
    baseFarePaisa: integer("base_fare_paisa").notNull(),
    distanceChargePaisa: integer("distance_charge_paisa").notNull(),
    poolDiscountPaisa: integer("pool_discount_paisa").notNull(),
    finalFarePaisa: integer("final_fare_paisa").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("BDT"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Set by the pooling service every time the fare row is recomputed in
    // place (join/leave/force-cancel), so the audit trail can tell WHO
    // recomputed a snapshot and WHEN (migration 0004, ADR-017).
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // No negative money anywhere in the fare row.
    check(
      "fares_monetary_non_negative",
      sql`${table.baseFarePaisa} >= 0 and ${table.distanceChargePaisa} >= 0 and ${table.poolDiscountPaisa} >= 0 and ${table.finalFarePaisa} >= 0`,
    ),
    // finalFare must always equal the documented formula.
    check(
      "fares_final_equals_formula",
      sql`${table.finalFarePaisa} = ${table.baseFarePaisa} + ${table.distanceChargePaisa} - ${table.poolDiscountPaisa}`,
    ),
    check(
      "fares_currency_format",
      sql`length(${table.currency}) = 3 and ${table.currency} = upper(${table.currency})`,
    ),
    // One final fare per ride request.
    unique("fares_one_per_ride_request").on(table.rideRequestId),
  ],
);

// ---------------------------------------------------------------------------
// ride_status_history — append-only journal of a request's lifecycle so the
// history of any ride can be audited. Populated by the state machine later;
// the DB alone cannot derive transitions, so write-then-move is an application
// control (documented, not duplicated in a trigger).
// ---------------------------------------------------------------------------
export const rideStatusHistory = pgTable(
  "ride_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rideRequestId: uuid("ride_request_id")
      .notNull()
      .references(() => rideRequests.id, { onDelete: "restrict" }),
    // Null on the first recorded transition.
    fromStatus: rideStatusEnum("from_status"),
    status: rideStatusEnum("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A transition to the same state is meaningless noise.
    check(
      "ride_status_history_no_same_transition",
      sql`${table.fromStatus} is null or ${table.fromStatus} <> ${table.status}`,
    ),
    // chronological audit trail (composite index also backs the FK).
    index("ride_status_history_transitions_idx").on(
      table.rideRequestId,
      table.createdAt,
    ),
  ],
);

// Re-exported convenience type of every table's row type (used by tests).
export type User = typeof users.$inferSelect;
export type RideRequest = typeof rideRequests.$inferSelect;