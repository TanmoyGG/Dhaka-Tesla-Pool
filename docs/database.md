# Database Design — Dhaka Tesla Pool (MVP)

> **Status:** Phases 2–6 complete. The schema described here is implemented in
> `apps/api/src/db/schema.ts`, migrated by `apps/api/drizzle/0000_*.sql` through
> `0005_*.sql`, and exercised by `apps/api/test/database.test.ts` plus the
> ride/pooling/driver/state suites. The ERD below reflects the **actual**
> schema: the Phase 3 Clerk adaptation (`users.clerk_user_id`, no `sessions`
> table, no password hashes), the Phase 4 idempotency key
> (`ride_requests.client_request_id`, migration 0003), the Phase 5 pooled-fare
> refresh (`fares.updated_at`, migration 0004), and the Phase 6 driver flow
> (`pools.accepted_at`, migration 0005). Everything else here is a record of
> the design decisions, invariants, and planned later-phase behavior (which is
> marked as such).

## 1. Design Goals

- Model the PRD's world faithfully: users, Teslas/vehicles + fixed capacity,
  ride requests, pools, pool membership, status/history, fares.
- Enforce invariants in the database where appropriate (constraints), not only
  in application code.
- Money as **integer paisa/poysha** (never floating-point).
- Support the six required test behaviors, including the concurrency case.
- `ride_status_history` + fare snapshots exist so history is **explainable**.
- Authentication is **not** the database's job: Clerk owns identity, and the
  app DB keeps only the mapping (`clerk_user_id`) and the authorization role
  (ADR-013). No passwords or sessions are stored.

## 2. Implementation Overview

- **Driver:** PostgreSQL 16, Drizzle ORM (schema in `src/db/schema.ts`).
- **Primary keys:** UUID v4, default `gen_random_uuid()` (PG >= 13 built-in).
- **Timestamps:** `timestamptz` (timezone-aware), default `now()`, stored UTC.
- **Enums (PostgreSQL-native):**
  - `user_role`: `PASSENGER`, `DRIVER`, `ADMIN`
  - `ride_status`: `REQUESTED`, `MATCHED`, `DRIVER_ARRIVED`, `STARTED`,
    `COMPLETED`, `CANCELLED`
  - `pool_member_status`: `ACTIVE`, `LEFT`
- **Money:** integer paisa in `*_paisa` columns; currency is a 3-char code
  (`BDT` default, uppercase; see §6).

## 3. Tables

### 3.1 `users`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | default `gen_random_uuid()` |
| `clerk_user_id` | text NOT NULL UNIQUE | Clerk identity mapping (ADR-013); never invented/guessed |
| `name` | text NOT NULL | CHECK non-empty |
| `email` | text NOT NULL UNIQUE | stored lowercase (CHECK `email = lower(email)`) |
| `role` | `user_role` NOT NULL DEFAULT `PASSENGER` | **authorization source of truth** — never from the client |
| `active` | boolean NOT NULL DEFAULT `true` | |
| `created_at` / `updated_at` | timestamptz NOT NULL DEFAULT `now()` | |

One table for both passenger and driver, distinguished by `role`. There is **no
password column**: Clerk stores credentials (password, OAuth, MFA) on its side;
the application database only keeps the verified-identity mapping and the
application role (see §6).

### 3.2 Why there is no `sessions` table

Phase 2 modeled an application-owned cookie `sessions` table for the originally
planned manual auth (Argon2id + opaque tokens). That design was replaced by
Clerk (**ADR-013**): Clerk owns the session lifecycle (cookie/JWT issuance,
refresh, revocation), and the API re-verifies every request with
`authenticateRequest()`. Migration `0001_*.sql` therefore **drops** `sessions`.
PostgreSQL is an application-data store, not an auth-session store; a second
session table would have reintroduced exactly the manual-auth surface the
decision removed (README "AI Usage" records the rejected suggestion).
The story cast used the original Phase 2 `sessions` only in the discarded
design; nothing depends on it today.

### 3.3 `vehicles`

The driver-owned Tesla with a **fixed capacity**.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | Jashim's Tesla is seeded as **Bullet** |
| `driver_id` | uuid NOT NULL → `users.id` | ON DELETE CASCADE |
| `name` | text NOT NULL | e.g. "Bullet"; CHECK non-empty |
| `capacity` | integer NOT NULL | CHECK `> 0`; MVP convention is 3 seats |
| `is_online` | boolean NOT NULL DEFAULT `false` | partial index `WHERE is_online` for matching |
| `created_at` / `updated_at` | timestamptz | |

Indexed on `driver_id`. A vehicle's current capacity is **not** authoritative for
history — pools snapshot it into `capacity_snapshot` (see §6.6).

### 3.4 `zones`

Predefined Dhaka geography — plain lat/long points, **no routing/geocoding**.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text NOT NULL UNIQUE | e.g. "Banani", "Gulshan 1" |
| `latitude` | double precision, CHECK `-90..90` | |
| `longitude` | double precision, CHECK `-180..180` | |
| `created_at` | timestamptz | |

### 3.5 `ride_requests`

A passenger's request: pickup zone, destination zone, number of seats, status.
The lifecycle enum is the PRD's `REQUESTED → MATCHED → DRIVER_ARRIVED → STARTED
→ COMPLETED (+ CANCELLED)`. See §5.2 for why "MATCHED/ACCEPTED" is stored as
`MATCHED`.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `passenger_id` | uuid → `users.id` | RESTRICT |
| `pickup_zone_id` | uuid → `zones.id` | RESTRICT; CHECK ≠ destination |
| `destination_zone_id` | uuid → `zones.id` | RESTRICT |
| `requested_seats` | integer NOT NULL | CHECK `> 0` |
| `status` | `ride_status` NOT NULL DEFAULT `REQUESTED` | |
| `client_request_id` | uuid NULL | **optional** client idempotency key (ADR-015); partial-unique-scoped, see below |
| `pool_id` | uuid → `pools.id` NULL | **nullable while unassigned**; CHECK "set ⇒ not REQUESTED" |
| `created_at` / `updated_at` | timestamptz NOT NULL | |
| `cancelled_at` | timestamptz NULL | CHECK: set exactly when `status = CANCELLED` |
| `completed_at` | timestamptz NULL | CHECK: set exactly when `status = COMPLETED` |

Indexed on `(passenger_id, created_at)` (history), `status` (matching), and
`pool_id` (pool lookup + FK). **Partial unique index
`ride_requests_client_request_id_key`** (migration 0003): at most one ride per
`(passenger_id, client_request_id)` when a key is supplied — this is the
idempotency backstop behind Phase 4's "retry replays the existing ride"
behavior (ADR-015; request 0001/0002 without a key may create a new ride,
documented MVP behavior). `pool_id` is a **display convenience**; the
authoritative membership is `pool_members` (§3.7).

### 3.6 `pools`

A set of matched ride requests being served by **one Tesla**.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `vehicle_id` | uuid → `vehicles.id` | RESTRICT |
| `driver_id` | uuid → `users.id` | RESTRICT; must equal the vehicle's driver (app-enforced) |
| `status` | `ride_status` NOT NULL DEFAULT `REQUESTED` | pool carries the same lifecycle |
| `capacity_snapshot` | integer NOT NULL | CHECK `> 0`; vehicle capacity copied at pool creation |
| `accepted_at` | timestamptz NULL | **added in migration 0005** (Phase 6); driver accept records the confirmation (ADR-019) |
| `created_at` / `updated_at` | timestamptz | |
| `started_at` | timestamptz NULL | CHECK: set only for `STARTED`/`COMPLETED` |
| `completed_at` | timestamptz NULL | CHECK: set exactly when `COMPLETED`; requires `started_at` |

**Partial unique index:** `pools_single_active_per_vehicle` — a vehicle can
have at most one pool in a non-terminal state (`NOT IN ('COMPLETED','CANCELLED')`).
This is a first-class capacity/concurrency invariant at the DB layer.

**Check `pools_accepted_progression`** (migration 0005, Phase 6): a pool that
has progressed (DRIVER_ARRIVED/STARTED/COMPLETED) must carry an
`accepted_at` (`accepted_at IS NOT NULL OR status NOT IN
('DRIVER_ARRIVED','STARTED','COMPLETED')`). Deliberately NOT
`accepted_at ⇒ status = MATCHED`: accept records the driver's confirmation
while the pool stays MATCHED, so progression and a legal `MATCHED →
CANCELLED` (Phase 5 semantics) both keep working.

**Partial index `driver_pools_accept_idx`** (migration 0005): covers the
progression/audit read (`WHERE accepted_at IS NOT NULL`).

### 3.7 `pool_members`

The **explicit proof of membership** — a passenger's request riding in a pool.
This table is the source of truth for occupied seats.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `pool_id` | uuid → `pools.id` | RESTRICT |
| `ride_request_id` | uuid → `ride_requests.id` | RESTRICT |
| `passenger_id` | uuid → `users.id` | RESTRICT |
| `seats` | integer NOT NULL | CHECK `> 0` (matched by the membership) |
| `status` | `pool_member_status` NOT NULL DEFAULT `ACTIVE` | `ACTIVE` = occupies seats |
| `joined_at` | timestamptz NOT NULL | |
| `left_at` | timestamptz NULL | CHECK: set exactly when `status = LEFT` |

Constraints:
- `UNIQUE (pool_id, ride_request_id)` — a request cannot join the same pool twice.
- **Partial unique** `pool_members_one_active_per_request` — a request has at
  most **one ACTIVE** membership (it can be in only one pool at a time).
- Index `(pool_id, status)` — this is what occupancy aggregates use.

### 3.8 `fares`

Individual, per-request **final fare snapshot** in integer paisa.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `ride_request_id` | uuid → `ride_requests.id` | RESTRICT; **UNIQUE** — one final fare per request |
| `base_fare_paisa` | integer NOT NULL | CHECK `>= 0` |
| `distance_charge_paisa` | integer NOT NULL | CHECK `>= 0` |
| `pool_discount_paisa` | integer NOT NULL | CHECK `>= 0` |
| `final_fare_paisa` | integer NOT NULL | CHECK `>= 0` **and** `= base + distance − discount` |
| `currency` | char(3) NOT NULL DEFAULT `BDT` | CHECK 3 uppercase letters |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | **added in migration 0004** (Phase 5) so a pooling recompute is auditable |

The formula `passengerFare = baseFare + distanceCharge − poolDiscount` is
enforced by a CHECK so stored history can never contradict the documented fare
model. **Implemented in Phase 4** (ADR-015, `apps/api/src/fare/`): the initial
estimated fare is written per seat at ride creation (the `fares` row is the
*current applied fare snapshot* — `pool_discount_paisa = 0` for a REQUESTED
ride). **Implemented in Phase 5** (`apps/api/src/rides/pooling/fare.ts`, ADR-017):
when a pool reaches ≥ 2 ACTIVE members each fare is recomputed in place via
`pool_discount = roundHalfUp(25%·(base+distance))`; joining, leaving
(cancelling), and forced-cancelling all rewrite derived values on the **same
row** (`fares.updated_at` bumped) — a lifecycle recompute, not parameter drift,
so history-immutability (`docs/requirements.md` §21.I) is preserved. Forced
cancellation produces a full refund **through the discount term**
(`discount = base + distance`, `final = 0`), so the CHECK keeps holding. Values
follow §21.D: `base = 3000 paisa`,
`charge = roundHalfUp(haversine × 1.3 × 1200) paisa/km`.

### 3.9 `ride_status_history`

Append-only journal of a request's lifecycle transitions.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `ride_request_id` | uuid → `ride_requests.id` | RESTRICT |
| `from_status` | `ride_status` NULL | null on the first recorded transition |
| `status` | `ride_status` NOT NULL | |
| `created_at` | timestamptz NOT NULL | |

CHECK `from_status IS NULL OR from_status <> status` (no self-transitions).
Index `(ride_request_id, created_at)` = chronological audit trail.

The **state machine that validates the *remaining* transitions** (REQUESTED →
MATCHED → DRIVER_ARRIVED → STARTED → COMPLETED/CANCELLED) is implemented in the
ride/pooling phases (8+). **Phase 4 already writes the first entry** — `NULL →
REQUESTED` — atomically with ride + fare creation (`src/rides/service.ts`). The DB
enforces the enum values and self-transition rule; it cannot derive transitions
from the current row, so writing history atomically with state changes is an
application control.

## 4. ERD

```mermaid
erDiagram
    users ||--o{ vehicles : "owns (driver)"
    users ||--o{ ride_requests : "submits (passenger)"
    users ||--o{ pools : "drives"
    users ||--o{ pool_members : "rides as passenger"
    vehicles ||--o{ pools : "operates"
    zones ||--o{ ride_requests : "pickup_zone"
    zones ||--o{ ride_requests : "destination_zone"
    pools ||--o{ pool_members : "contains"
    pools ||--o{ ride_requests : "assigns pool_id"
    ride_requests ||--o{ pool_members : "joins"
    ride_requests ||--o| fares : "pays (one final fare)"
    ride_requests ||--o{ ride_status_history : "records transitions"

    users {
        uuid id PK
        text clerk_user_id "unique, Clerk identity mapping"
        text name "not empty"
        text email "unique, lowercase"
        user_role role "PASSENGER | DRIVER | ADMIN"
        boolean active
        timestamptz created_at
        timestamptz updated_at
    }
    vehicles {
        uuid id PK
        uuid driver_id FK
        text name "e.g. Bullet"
        int capacity "fixed, > 0 (3-seat MVP)"
        boolean is_online
        timestamptz created_at
        timestamptz updated_at
    }
    zones {
        uuid id PK
        text name "unique"
        double latitude
        double longitude
        timestamptz created_at
    }
    ride_requests {
        uuid id PK
        uuid passenger_id FK
        uuid pickup_zone_id FK
        uuid destination_zone_id FK "!= pickup_zone_id"
        int requested_seats "> 0"
        ride_status status
        uuid pool_id FK "nullable until matched"
        timestamptz created_at
        timestamptz updated_at
        timestamptz cancelled_at
        timestamptz completed_at
    }
    pools {
        uuid id PK
        uuid vehicle_id FK
        uuid driver_id FK
        ride_status status
        int capacity_snapshot "vehicle capacity at creation"
        timestamptz created_at
        timestamptz updated_at
        timestamptz started_at
        timestamptz completed_at
    }
    pool_members {
        uuid id PK
        uuid pool_id FK
        uuid ride_request_id FK "unique (pool_id, ride_request_id)"
        uuid passenger_id FK
        int seats "> 0"
        pool_member_status status "ACTIVE | LEFT"
        timestamptz joined_at
        timestamptz left_at
    }
    fares {
        uuid id PK
        uuid ride_request_id FK "unique - one final fare"
        int base_fare_paisa ">= 0"
        int distance_charge_paisa ">= 0"
        int pool_discount_paisa ">= 0"
        int final_fare_paisa "= base + distance - discount"
        char currency "3 uppercase chars, default BDT"
        timestamptz created_at
    }
    ride_status_history {
        uuid id PK
        uuid ride_request_id FK
        ride_status from_status "null on first transition"
        ride_status status
        timestamptz created_at
    }
```

## 5. Design Decisions (schema)

### 5.1 Enums match the PRD lifecycle exactly
`ride_status` is a PostgreSQL enum type (not a text/varchar) so invalid states
are rejected by the database and the lifecycle reads clearly in `psql`.

### 5.2 "MATCHED/ACCEPTED" is stored as `MATCHED`
The PRD writes the single state as "MATCHED/ACCEPTED". It is modeled as one enum
value, `MATCHED`. A pooled request/pool in `MATCHED` has been accepted by the
driver; there is no separate "ACCEPTED" column or value. One value = one naming
scheme, no ambiguity in history rows. See also `docs/decisions.md` ADR-012.

### 5.3 `pool_id` on `ride_requests` is a convenience; `pool_members` is truth
The DB's source of truth for "this request rides in this pool" is `pool_members`
(which carries the same passenger, seats, and join/leave history). `ride_requests.pool_id`
is denormalized for the passenger-facing status view and is kept consistent by
the pooling service. The DB guards the obvious impossible value: a request with
`pool_id` set is never `REQUESTED`. **Phase 5** (`src/rides/pooling/service.ts`)
writes both together inside the create-and-match transaction, so the two can
never disagree at commit.

### 5.4 Membership history is preserved
`pool_members` rows are never deleted or overwritten (ON DELETE RESTRICT +
explicit `LEFT` status + `left_at`). "Who was in which pool when" always
remains answerable.

### 5.5 Occupied seats are derived, not cached
**There is no `available_seats` / `occupied_seats` column anywhere.** Occupied
seats for a pool are always computed as:

```sql
SELECT COALESCE(SUM(seats), 0)
FROM pool_members
WHERE pool_id = $1 AND status = 'ACTIVE';
```

Comparing that sum to `pools.capacity_snapshot` is the capacity check. This
avoids the classic cache-divergence bug where a cached counter drifts from the
truth. The DB still enforces the structural bounds (`seats > 0`, snapshots
positive, one active pool per vehicle, one active membership per request); the
**aggregate** occupancy vs. capacity check is transactional application logic
(§7) because it spans rows. **Implemented in Phase 5** (ADR-017): every claim
re-derives this sum inside a `SELECT … FOR UPDATE` on the pool row, and pool
**creation** races are settled with `INSERT … ON CONFLICT DO NOTHING RETURNING`
against `pools_single_active_per_vehicle`, followed by exactly one re-scan to
join the concurrent winner (§7).

### 5.6 `capacity_snapshot` preserves history
`pools.capacity_snapshot` copies `vehicles.capacity` at pool creation. If Bullet
is ever reconfigured, old pools still show the capacity that applied to them.
The app must set `capacity_snapshot = vehicle.capacity` when creating a pool
(cross-table, not a CHECK).

### 5.7 Delete policy: ride history is RESTRICT, infrastructure is CASCADE
Every ride-domain FK (`ride_requests`, `pools`, `pool_members`, `fares`,
`ride_status_history`) uses `ON DELETE RESTRICT`: ride data is history and must
stay explainable (`docs/requirements.md` §21.I); attempts to delete a user with
rides fail loudly instead of silently destroying history. `vehicles` are
user-owned infrastructure and use `ON DELETE CASCADE`.

### 5.8 Email uniqueness is case-insensitive by construction
Emails are stored lowercase (CHECK `email = lower(email)`) under a plain unique
index, so `Nusrat@Example.com` and `nusrat@example.com` cannot both exist
without a functional index. The app normalizes on write (later phases).

### 5.9 No generic "audit" table
The PRD marks audit **optional**. `ride_status_history` + fare snapshots already
make every ride explainable; a catch-all audit table would add a second,
redundant journal with no current consumer. Skipped until an actual need exists,
per the "no complexity without a reason" rule.

### 5.10 What the DB does NOT enforce (application boundary — documented)
These require cross-table or cross-row knowledge a simple SQL constraint cannot
express. The application enforces them in later phases; this list is the record:

- **Only a `DRIVER` owns a vehicle** — needs a users lookup; CHECK cannot
  reference another table. Enforced by the app when creating vehicles.
- **`pools.driver_id` equals `vehicles.driver_id`** — cross-table equality.
- **Occupancy never exceeds `capacity_snapshot`** — spans membership rows;
  enforced transactionally with row locking (see §7).
- **Valid state transitions** — depend on the previous state; enforced by the
  state machine and recorded in `ride_status_history`.
- **`requested_seats` ≤ vehicle capacity / ≤ `3`** — the MVP convention is a
  three-seat Tesla; the DB enforces positivity, matching logic enforces the cap.
- **`status` values other than enum members** — the enum handles this one; all
  *transition* legality is app-enforced once a journal row exists.
- **Role/authorization checks are never client-supplied** — a request
  body/query can never set or override identity/role; the API resolves them from
  the verified Clerk token + the `users` row (`docs/architecture.md` §3.2).

## 6. Constraints and Indexes (with rationale)

Every constraint and index in the migration exists for a reason; non-obvious
ones are explained inline in `src/db/schema.ts` and summarized here.

### CHECK constraints
| table | name | purpose |
|---|---|---|
| users | `users_email_unique`, `users_name_not_empty`, `users_email_lowercase` | login identity integrity; no empty/whitespace names; sane email uniqueness |
| vehicles | `vehicles_name_not_empty`, `vehicles_capacity_positive` | no blank labels; capacity is a positive integer |
| zones | `zones_name_not_empty`, `zones_latitude_range`, `zones_longitude_range` | reference data sanity (valid WGS84 bounds) |
| ride_requests | `ride_requests_seats_positive` | a request always asks for at least one seat |
| | `ride_requests_pickup_ne_destination` | pickup === destination is meaningless |
| | `ride_requests_cancel_timestamp` / `_complete_timestamp` | terminal state ⇔ its timestamp; impossible states rejected |
| | `ride_requests_single_terminal` | can't be both cancelled and completed |
| | `ride_requests_pool_requires_matched` | pooled requests have left REQUESTED |
| pools | `pools_capacity_snapshot_positive` | snapshot always meaningful |
| | `pools_started_timestamp` / `pools_complete_timestamp` / `pools_complete_requires_started` | started/completed timestamps only ever match the lifecycle; a pool can't complete without starting |
| pool_members | `pool_members_seats_positive` | a membership always takes ≥ 1 seat |
| | `pool_members_left_timestamp` | LEFT ⇔ `left_at` |
| fares | `fares_monetary_non_negative` | no negative money |
| | `fares_final_equals_formula` | stored fares always obey the documented formula |
| | `fares_currency_format` | 3 uppercase letter currency code |
| ride_status_history | `ride_status_history_no_same_transition` | no self-transitions in the audit journal |

### Unique constraints / indexes
| table | name | purpose |
|---|---|---|
| users | `users_email_unique` | one account per email |
| users | `users_clerk_user_id_unique` | **one app user per Clerk identity** (ADR-013) — prevents double registration and silent identity swaps |
| zones | `zones_name_unique` | deterministic, named geography |
| ride_requests | (none beyond PK) | requests are never unique by content |
| pools | `pools_single_active_per_vehicle` (**partial**) | a Tesla runs at most one active pool — capacity + concurrency integrity |
| pool_members | `pool_members_pool_request_unique` | no request twice in the same pool |
| pool_members | `pool_members_one_active_per_request` (**partial**) | a request in at most one active pool |
| fares | `fares_one_per_ride_request` | exactly one final fare per request |

### Plain indexes
| table | name | purpose |
|---|---|---|
| vehicles | `vehicles_driver_id_idx` | "my Teslas" |
| vehicles | `vehicles_is_online_idx` (**partial**) | matching scans only consider online Teslas |
| ride_requests | `ride_requests_passenger_history_idx` | passenger history (and passenger FK) |
| ride_requests | `ride_requests_status_idx` | wait for REQUESTED requests during matching |
| ride_requests | `ride_requests_pool_idx` | requests in a pool (+ pool FK) |
| pools | `pools_vehicle_idx`, `pools_driver_idx`, `pools_status_idx` | FK lookups + matching scans |
| pool_members | `pool_members_pool_status_idx` | **occupancy aggregation** `WHERE pool_id AND status` |
| pool_members | `pool_members_ride_request_idx` | FK enforcement + reverse lookup |
| pool_members | `pool_members_passenger_idx` | passenger ride history joins |
| ride_status_history | `ride_status_history_transitions_idx` | chronological audit + FK |

Deliberately **not** indexed (documented choice): `ride_requests.pickup_zone_id`
/ `destination_zone_id`. Zones are effectively immutable reference data; there is
no reverse query path, and a (never-occurring) zone delete only costs a scan on
the FK restriction.

## 7. Concurrency Strategy (implemented in Phase 5)

**What must hold:** Bullet has 1 seat left. Nusrat and Shirin both try to claim
it at nearly the same instant; both may read `occupied = 2`, and exactly one of
them may join. **Phase 5 implements this** in `apps/api/src/rides/pooling/
service.ts` (ADR-017) and proves it with real concurrent tests
(`test/pooling.test.ts`); §3.5 records why Phase 4 needed no locking (a
`REQUESTED` ride holds no pool/seats; the only cross-request race — same
`client_request_id` replayed twice — is settled by the partial unique index from
migration 0003).

**Implemented strategy — DB-backed transactional consistency, database as truth:**

1. `BEGIN` (default `read committed`).
2. `SELECT ... FOR UPDATE` on the **pool row** to serialize claims per pool, so
   the two concurrent claims queue instead of racing.
3. Recompute occupancy inside the transaction:
   `SELECT COALESCE(SUM(seats),0) FROM pool_members WHERE pool_id=$pool AND status='ACTIVE'`.
4. Assert `occupied + new.seats <= capacity_snapshot`; on violation the ride
   stays `REQUESTED` and the transaction commits as a no-op join (single-shot —
   no retry loop), later matching attempts can still find the seat freed.
5. Insert the `pool_members` row (and flip the request to `MATCHED`, with
   `pool_id` updated) in the **same transaction**.
6. Commit. The second claimant's `FOR UPDATE` only sees the committed state and
   correctly fails to join.

**Pool creation race** (two requests simultaneously claim a Tesla's first seat
when no active pool exists yet): the create uses
`INSERT INTO pools ... ON CONFLICT DO NOTHING RETURNING *`. The losing INSERT
waits for the winner's transaction to settle, then skips with an **empty**
result instead of aborting with SQLSTATE 23505 — and since the winner's commit
is a complete statement-level snapshot (READ COMMITTED), a single bounded
re-scan deterministically finds the winner's pool to join. Both passengers end
`MATCHED` in the same pool, occupancy exact.

**Lock ordering:** every transaction that writes both a ride row and a pool row
acquires the RIDE row lock first, then the POOL row lock second (create holds
the ride lock from its own INSERT; cancel/force-cancel `FOR UPDATE` the ride
first, then the pool). Consistent ordering ⇒ no deadlock cycle between match,
cancel, and force-cancel.

**Driver lifecycle ordering (Phase 6, ADR-020):** every driver transition
accepts an additional order — **VEHICLE rows `FOR UPDATE` (id-ascending) →
member RIDE rows `FOR UPDATE` (id-ascending) → POOL row `FOR UPDATE`**. The
vehicle lock is the shared serialization point between the automatch's Tesla
pick, the driver's offline toggle, and the lifecycle actions; rides-before-pool
keeps the global ride → pool order, so no cycle is possible with a passenger's
cancel/match. The availability toggle locks ONLY vehicle rows and COUNTs
non-terminal pools under that lock — it never waits on a pool row. This is what
makes "two concurrent arrivals → exactly one wins" and "offline toggle racing a
new booking" deterministic (both proven in `test/driver.test.ts`).
Completing a pool leaves the status terminal, which drops it out of
`pools_single_active_per_vehicle` — **the Tesla is freed for a new pool by the
same partial unique index** (no "release" action).

Why this is safe here:
- The **partial unique index** `pools_single_active_per_vehicle` already blocks a
  second active pool on the same Tesla, so all claims funnel through one pool row
  (the locked row).
- Occupancy is **derived** (no cached counter to corrupt).
- `pool_members` uniqueness prevents double-joining even in a racy window.

What would change at larger scale (documented, not built): when a pool row
becomes a hotspot, switch to a dedicated per-pool seat ledger (atomic
`UPDATE counters SET occupied = occupied + n WHERE ... RETURNING` or
`INSERT ... RETURNING` with a check) or move the counter onto the pool row with
`UPDATE ... WHERE occupied+n <= capacity_snapshot` as the atomic gate; read
replicas for every read except the claim; and eventually a queue/event for
latency isolation. These are deliberately deferred — see "Oi Tesla Goes Viral"
notes in `docs/requirements.md` §15. No Redis/mutex/queue is used or planned
(ADR-017).

## 8. Migrations and Seed

### Migration
- Schema → migration via `drizzle-kit generate` (`npm run db:generate`).
  `0000_whole_queen_noir.sql` created the Phase 2 schema (3 enums, 9 tables, all
  CHECK/unique/index/partial-index statements). Phase 3 added
  `0001_fluffy_lethal_legion.sql` (`ADD VALUE 'ADMIN'`, `DROP TABLE sessions
  CASCADE`, `ADD COLUMN clerk_user_id NOT NULL` + unique constraint) and
  `0002_greedy_ultimatum.sql` (`DROP COLUMN password_hash`). Phase 4 added
  `0003_fluffy_pixie.sql` (`ADD COLUMN client_request_id uuid` + the partial
  unique index `ride_requests_client_request_id_key` — ADR-015 idempotency).
  Phase 5 added `0004_spotty_harrier.sql` (**additive only**:
  `ALTER TABLE fares ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()`
  — ADR-017 auditability of the in-place pooling recompute). Phase 6 added
  `0005_powerful_johnny_storm.sql` (**additive only**, ADR-019):
  `pools.accepted_at` (driver accept confirmation) + CHECK
  `pools_accepted_progression` (a progressed pool must have been accepted)
  + partial index `driver_pools_accept_idx` (`WHERE accepted_at IS NOT NULL`).
  The pool/pool_members
  tables and their partial unique indexes already existed from 0000 (ADR-012), so
  no other schema change was needed for pooling.
  Generated SQL was reviewed and is committed **unmodified** — no manual edits
  unless a documented reason forces one.
- Apply with `npm run db:migrate` (uses `apps/api/drizzle/meta/_journal.json`
  so it is incremental and idempotent; re-running is a no-op).
- State: **applied successfully against the Docker PostgreSQL container**;
  `db:generate` reports no schema drift.
- Note: adding the Phase 3 NOT NULL column requires a fresh dev database
  (`DROP DATABASE dhaka_tesla_pool WITH (FORCE)` + `CREATE DATABASE`, then
  migrate + seed) — documented in the README.

### Seed (`npm run db:seed`)
Deterministic, **idempotent** (inserts with `ON CONFLICT DO NOTHING`, never
deletes). Contents (the canonical PRD cast — see `src/db/seed.ts`):

| kind | rows |
|---|---|
| users | Jashim Ahmed (DRIVER), Nusrat Haque, Rafiq Rahman, Shirin Islam |
| vehicle | **Bullet** — owned by Jashim, capacity 3, online |
| zones | Banani, Gulshan 1, Mohakhali, Dhanmondi, Mirpur, Uttara, Farmgate, Bashundhara |

IDs are fixed (deterministic) so tests and demos can reference Jashim/Bullet by
a stable UUID. Seeded `clerk_user_id` values are **documented development-only
placeholders** (`dev-only::seed::<email>`) — real Clerk identities start with
`user_`, and the resolver rejects the reserved prefix (defense in depth). Demo
logins arrive with the Clerk dashboard configuration.

First-request provisioning (ADR-014) keeps the identity mapping consistent
without manual steps: a verified Clerk identity with no `users` row is created
as `PASSENGER`/`active`, name = Clerk username, email = primary Clerk email
(lowercased), with `INSERT … ON CONFLICT (clerk_user_id) DO NOTHING RETURNING`
— the `users_clerk_user_id_unique` index makes concurrent first requests yield
exactly one row, and the losers re-read the winner. If the email is already
taken (`users_email_unique`), the INSERT aborts (`AUTH_PROVISION_FAILED`) and
the existing row is never rebound.

## 9. Database Commands

```bash
docker compose up db                # start PostgreSQL (persistent volume)
npm run db:check   -w @dhaka-tesla-pool/api   # connectivity: SELECT 1
npm run db:generate -w @dhaka-tesla-pool/api  # generate migration from schema
npm run db:migrate -w @dhaka-tesla-pool/api   # apply pending migrations
npm run db:seed   -w @dhaka-tesla-pool/api    # idempotent cast seed
```

## 10. Invariants (enforced, or app-enforced in a marked phase)

1. A ride request belongs to exactly one passenger — `passenger_id` FK. ✔ DB
2. Requested seats are positive — CHECK. ✔ DB
3. A pool belongs to exactly one Tesla — `vehicle_id` FK + one active pool per
   vehicle. ✔ DB
4. Membership seats are positive — CHECK. ✔ DB
5. A request cannot appear twice in the same pool — `UNIQUE(pool_id, ride_request_id)`. ✔ DB
6. Occupied seats are derived from ACTIVE memberships — no cached counter. ✔ By design
7. Occupied seats never exceed pool capacity — transactional `FOR UPDATE` +
   derived sum (**implemented in Phase 5**, `src/rides/pooling/service.ts`,
   ADR-017). ✔ App + DB
8. A completed/cancelled ride cannot move back to an earlier state — state
   machine (`src/rides/state.ts`) + `ride_status_history`; invalid moves raise
   `409 INVALID_STATE_TRANSITION` (**Phase 5 implemented the map for all
   transitions; driver-flow arms exercised in later phases**). ✔ App
9. Fare amounts cannot be negative — CHECK. ✔ DB
10. Foreign keys always valid — FKs + restrictive delete policy. ✔ DB
11. One app user per Clerk identity — `users.clerk_user_id` UNIQUE (ADR-013). ✔ DB
12. Authenticated requests map to one verified local user with an app role —
    bearer verification + `users.role` lookup (Phase 3, implemented). ✔ App + DB
13. A verified Clerk identity without a local row is provisioned exactly once as
    `PASSENGER` — `INSERT … ON CONFLICT (clerk_user_id) DO NOTHING RETURNING`
    + re-read (Phase 3.5, ADR-014). ✔ App + DB
14. Provisioning never steals another user's email — a `users_email_unique`
    conflict aborts with `AUTH_PROVISION_FAILED` instead of rebinding rows.
    ✔ App + DB
15. A ride request exists only together with its fare and its first status
    journal entry — created in one transaction (Phase 4, ADR-015). ✔ App
16. At most one ride per `(passenger, client_request_id)` when a key is
    supplied — partial unique index `ride_requests_client_request_id_key`
    (migration 0003); a retry replays the existing ride, never creates a new
    one. ✔ DB + App
17. A pool that has progressed (DRIVER_ARRIVED/STARTED/COMPLETED) must have
    been accepted — CHECK `pools_accepted_progression` (migration 0005); accept
    itself keeps the pool MATCHED and is idempotent (Phase 6, ADR-019). ✔ DB + App
18. A non-terminal pool keeps its Tesla online — the driver offline toggle is
    refused (`409 DRIVER_HAS_ACTIVE_POOL`) under the vehicle lock (Phase 6,
    ADR-019/020, requirements §21.J strict). ✔ App
19. A completed pool frees its Tesla for a new pool — terminal status drops the
    pool out of `pools_single_active_per_vehicle` (Phase 6, ADR-019). ✔ DB