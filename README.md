# Dhaka Tesla Pool

*Share a seat. Split the fare. Survive Dhaka traffic.*

## Status

**Phase 2 — Database schema, migrations, and seed: complete.** The full
relational schema is implemented and migrated (users, vehicles, zones, ride
requests, pools, memberships, fares, ride-status history), seeded with the PRD
cast (Jashim + Bullet, Nusrat, Rafiq, Shirin and 8 Dhaka zones), and covered by
23 schema-integration tests. See [docs/database.md](docs/database.md).

**Phase 3 — Authentication (Clerk): complete.** Authentication is managed by
Clerk (ADR-013). The frontend uses `@clerk/nextjs` (sign-in/sign-up, a
protected `/account` page, route middleware); the Fastify API verifies Clerk
session bearer tokens via `@clerk/backend` and resolves them to the local
PostgreSQL user (`users.clerk_user_id`) for role-based authorization
(`request.auth` + `requireAuth`/`requireRole`). New Clerk identities are
provisioned as `PASSENGER` users on their first authenticated request
(ADR-014), atomically and race-safe. Password storage and the application
`sessions` table are gone (migrations 0001/0002). Covered by 23 auth tests
(deterministic fakes — no network) and 29 database tests.

**Phase 4 — Passenger ride requests & fare estimation: complete.** Passengers
can create a ride request and receive its deterministic initial fare estimate
(`POST /api/rides`), list their own rides (`GET /api/rides`), fetch one
(`GET /api/rides/:rideId`), and read the zone pick-list
(`GET /api/zones`). Fare = `3000` base + `roundHalfUp(haversine × 1.3 × 1200)`
paisa/km, stored per seat; Nusrat Banani→Mohakhali = **5932 paisa**,
Rafiq Banani→Gulshan 1 = **4140 paisa** (pinned in tests). Ride + fare + initial
status journal row commit in one transaction; an optional `client_request_id`
makes creation idempotent (migration 0003, replay → HTTP 200). Zod strict
validation on routes; PASSENGER-only; errors carry additive `details`. Covered
by 7 fare and 22 rides integration tests. See
[the API section](#api-phase-4) below and ADR-015.

**Phase 5 — Pool matching, lifecycle & concurrency: complete.** Matching and
pooling are implemented on `feature/matching-pooling` (ADR-016/017/018) and
refitted by ADR-022: requests are auto-matched at creation onto an eligible
existing pool when they share the pickup zone and their drop-offs are within a
2.0 km spread (Nusrat + Rafiq pool; Banani→Dhanmondi does not); a request that
cannot join one **always starts its own unassigned wait pool**
(driver/Tesla chosen later by the driver's accept — ADR-022). A single explicit
transition map (`src/rides/state.ts`) enforces the PRD lifecycle and rejects
illegal moves with `409 INVALID_STATE_TRANSITION`. Seat claims are
database-transactional — `SELECT … FOR UPDATE` on the pool row + derived
occupancy — so the last-seat race (Rafiq vs Shirin on Bullet's final seat) can
never exceed capacity: exactly one wins the seat, the loser lands MATCHED in
its own wait pool. Pooled fares are recomputed **in place** on the same `fares`
row: 25% off base+distance when the pool holds ≥ 2 active members (Nusrat
**4449** / Rafiq **3105** paisa, pinned); passengers cancel via
`POST /api/rides/:rideId/cancel` (owner-only, REQUESTED/MATCHED). Migration 0004
adds `fares.updated_at` (additive). Full suite **122/122** across 8 test files,
including two real concurrent-claim races. See
[the API section](#api-phase-5) below.
Drivers and the driver-flow transitions are the next phase per
[docs/development-plan.md](docs/development-plan.md).

**Phase 6 — Driver workflow: complete (and reworked by ADR-022).**
Implemented on `feature/driver-workflow` + merged to `master` (ADR-019/020),
then reworked on `feature/driver-accept-selection`. Drivers get an online/offline
switch (`POST /api/driver/availability`; refused while any pool the driver
**accepted** is non-terminal — §21.J, narrowed by ADR-022 so lobby wait pools
never block the toggle). Pools are born **unassigned** (migration 0007):
a request that cannot join an eligible pool starts its own `MATCHED` wait pool
in the **driver lobby** (`GET /api/driver/pools/available`, identical for every
driver). **Accept is a first-wins claim** — the first online driver with a
capacity-fitting Tesla locks vehicle → active-pool count → contested pool row
and assigns `driver_id`/`vehicle_id`/`accepted_at`; losers get `409
POOL_ALREADY_ACCEPTED`, a no-Tesla/offline driver gets `409 VEHICLE_OFFLINE`,
and re-accepting your own pool is idempotent. Then `arrive` → `start` →
`complete`, each moving the pool **and** every member ride together with
per-ride journaling and timestamps (arrive on an unclaimed pool → 404). The
driver hub lists their accepted pools with passengers, seats, zones — deliberately
**no fares**. Completion frees the Tesla/driver for a new pool. Passenger
cancellation stays legal through DRIVER_ARRIVED (P8). Driver identity always
comes from the session (never the body); interloper/unknown non-accept routes
are a plain 404. Concurrency is database-transactional on a canonical lock
order **vehicle → rides → pool** (ADR-020) — real races proven for cross-driver
first-wins accept, double arrive/complete, and the decoupled offline-vs-booking
race. Migrations 0005 + 0007 (`pools.accepted_at` + progression CHECK; nullable
assignment + one-accepted-pool-per-driver/vehicle). Full suite **173/173**
across 9 test files. See [Driver workflow](#driver-workflow-phase-6) below.

**Phase 7 — One active ride, pre-booking estimates & driver read surface:
complete.** Implemented on `feature/full-ride-driver-ux` (branch off
`feature/passenger-ui`, ADR-021). A passenger may hold at most **one
non-terminal ride** — enforced by the database (partial unique index
`ride_requests_one_active_per_passenger`, migration 0006 → `409
ACTIVE_RIDE_EXISTS`, race-safe even for two concurrent bookings). New
`GET /api/rides/estimate` shows the deterministic fare **before** booking
(PRD "See estimated fare"). New driver read routes `GET /api/driver/availability`
(current switch state) and `GET /api/driver/pools/history` (terminal trips, still
fare-free). Backend suite now **173/173 across 9 test files** (ADR-022).

**Phase 8 — Passenger + driver web UI: complete** (ADR-021/022). `apps/web`
exposes the full product flow against the complete API in an always-dark,
plain-CSS design system (Clerk sign-in/sign-up themed dark via `@clerk/themes`):
role-aware nav with `PASSENGER`/`DRIVER` gates, passenger booking with a live
estimate preview, an active-trip banner that hides the booking form while a ride
is in flight, pooled 25%-shared-ride discount visible in the fare breakdown, a
state timeline that follows REQUESTED → MATCHED → DRIVER_ARRIVED → STARTED →
COMPLETED, and a two-step cancel confirm. Passenger surfaces show
"Waiting for a driver…" while the pool is unassigned. The driver hub adds the
online/offline switch (true state from the API), a **Waiting requests lobby**
where the driver claims a pool first-wins with an inline Accept button (ADR-022),
open pools with passenger/seat/zone detail, the accept → arrive → start →
complete journey, and completed-trip history — still **no fares** anywhere in
the driver view (P9). State pages poll at 5 s and stop at terminal status.
Verified by 39 Vitest + RTL tests, clean `next build`, `typecheck`, and `lint`.
The free Leaflet/OSM map stays optional (ADR-007/ADR-021 §4); see [Docs](#documentation).

## Project Description

A ride-pooling MVP for Dhaka. Battery-powered, three-seat "Teslas" (easy-bike
style, unaffiliated) carry multiple passengers between predefined Dhaka zones.
Passengers request a ride; when it makes sense, compatible requests share one
Tesla, each passenger gets an individual fare, and occupied seats never exceed
capacity.

## Problem

Nusrat needs to get from Banani to Mohakhali. Rafiq needs almost the same route
to Gulshan 1. Jashim's Tesla, Bullet, has three seats. Passengers should be able
to request a ride and share a Tesla when it makes sense; the driver needs to see
who's assigned and at what stage; each passenger sees only their own fare and
status; and history must stay explainable after the ride ends.

## Actors

- **Passenger** — requests rides, tracks status, cancels while valid, sees own fare/history.
- **Driver/Tesla** — goes online/offline, owns a Tesla with fixed capacity, accepts a ride/pool, marks arrival/start/complete.
- **Pool/Ride** — multiple requests may share one Tesla; explicit membership; seats never exceed capacity; individual fares preserved.

## Architecture

A modular monolith:

```
Browser
  → Next.js (apps/web) + Clerk (identity provider)
      └─ web verifies the user with Clerk and sends its session token
         to the API as  Authorization: Bearer <clerk-session-token>
  → Node.js/Fastify API (apps/api)
      └─ verifies the token (@clerk/backend), resolves the local user
         (users.clerk_user_id), attaches request.auth
  → PostgreSQL
      └─ application data + users.role / users.active (authorization source)
```

The frontend never talks to PostgreSQL directly; all business rules live in the
API. Identity (who you are) is Clerk's job; authorization (what you may do) is
the application's job and lives in PostgreSQL. See
[docs/architecture.md](docs/architecture.md) for the full diagram and §3.4 for
route policy.

## Technology Stack

Recorded as ADRs in [docs/decisions.md](docs/decisions.md).

- **Frontend:** Next.js 15 (App Router), React 19, TypeScript. TanStack Query,
  React Hook Form, Zod. The UI is a hand-written always-dark plain-CSS design
  system (no Tailwind/shadcn pulled in — ADR-021 §4); Clerk surfaces are themed
  dark via `@clerk/themes`. Leaflet + OpenStreetMap remains an
  optional/visualization-only later step (ADR-007).
- **Backend:** Node.js, Fastify 5, TypeScript, REST, Pino. Zod validation is
  used by the rides endpoints (Phases 4/5); Pino logs errors.
- **Database:** PostgreSQL 16 (Docker), Drizzle ORM (`postgres.js` driver),
  integer paisa/poysha money. Schema, enums, constraints and indexes are
  implemented; see [docs/database.md](docs/database.md).
- **Auth:** Clerk (`@clerk/nextjs` on the web, `@clerk/backend` +
  `authenticateRequest` on the API). Role-based authorization stays in
  PostgreSQL (`users.role`); no passwords or sessions are stored by the
  application. See [Authentication](#authentication) and ADR-013.
- **Testing:** Vitest — **173 API tests across 9 files** (database, auth, fare,
  rides + matching/state/pooling + driver) and **39 web tests across 7 files**
  (Vitest + React Testing Library). Playwright E2E (later phase).
- **Infrastructure:** Docker, Docker Compose, GitHub Actions.
- **Deployment:** Vercel, Render, Neon — free tier only (later phase).

## Prerequisites

- **Node.js** >= 20 (developed on v24). Verify with `node --version`.
- **npm** (>= 10 recommended). Verify with `npm --version`.
- **Docker Desktop** for PostgreSQL and/or the full compose stack.
  Verify with `docker --version` and `docker compose version`.

## Repository Structure

```
apps/
  web/        Next.js 15 App Router frontend (Phase 8: full passenger + driver UI)
              app/globals.css      always-dark design system (ADR-021 §4)
              app/{page,rides,driver,account}/  role-aware passenger/driver flows
              middleware.ts        Clerk route policy (Phase 3)
              app/sign-in|sign-up  Clerk-managed auth pages (Phase 3)
              components/          app-shell, role-gate, booking-area, ride-form,
                                   pool-info, status-timeline, cancel, driver/*
              lib/{api,queries,types,format,pool-actions}.ts  client layer + state rules
              test/                Vitest + RTL suite (39 tests)
  api/        Fastify 5 + Drizzle REST API (Phase 1 scaffold)
              src/db/schema.ts        schema (Phases 2–5)
              src/db/seed.ts          idempotent cast seed (Phases 2 + 3)
              src/auth/               Clerk verification + authorization (Phase 3)
              src/fare/               deterministic fare estimation (Phase 4, ADR-015)
              src/matching/           pool matching rule (Phase 5, ADR-016)
              src/rides/              rides service/routes + state machine (Phases 4/5)
              src/rides/pooling/      seat-claim + fare recompute service (Phase 5)
              src/driver/             availability + hub + lifecycle routes (Phases 6/7)
              drizzle/                generated migrations (Phases 2–7)
              test/                   suite (database, auth, fare, rides, matching,
                                      state, pooling — Phases 2–5)
docs/
  reference/PRD.pdf   primary source of truth (unmodified)
  requirements.md     implementation-oriented PRD interpretation
  architecture.md     architecture (updated as implemented)
  database.md         schema + invariants + concurrency strategy
  decisions.md        ADR-style technology decisions
  development-plan.md phased implementation plan
.github/workflows/    CI workflow
```

## Local development

### 1. Install dependencies

```bash
npm install
```

### 2. Environment

Copy the example file (no real secrets in the repo):

```bash
cp .env.example .env
```

Defaults work for local development with Docker Postgres. For live Clerk
flows you must put real Clerk keys in `.env` (see [Authentication](#authentication)).
Without them the stack still starts, but authenticated API routes fail with a
clear `AUTH_CONFIGURATION` error and the web `/account` redirect targets
`/sign-in` (its route policy is unchanged). Both `npm run dev` scripts
(API and web) auto-load the repo-root `.env` via Node's `--env-file`, so no
manual `export` is needed locally.

### 3. Start PostgreSQL (Docker)

```bash
docker compose up db
```

- Postgres 16 on `localhost:5432` (user/password/db: `postgres` / `postgres` /
  `dhaka_tesla_pool`, overridable via `.env`).
- Data persists in the named volume `dhaka-tesla-pool_pgdata`.
- Verify Drizzle connectivity:

```bash
npm run db:check -w @dhaka-tesla-pool/api
```

### 4. Schema, migrations, seed

```bash
npm run db:migrate -w @dhaka-tesla-pool/api   # apply pending migrations
npm run db:seed   -w @dhaka-tesla-pool/api    # idempotent cast seed
npm run db:generate -w @dhaka-tesla-pool/api  # regenerate after schema edits
```

`db:seed` is safe to run any number of times (inserts with
`ON CONFLICT DO NOTHING`; never deletes). Seeded users carry a reserved
development-only `clerk_user_id` placeholder (`dev-only::seed::<email>`) — see
[Authentication](#mapping-clerk-users-to-seeded-characters).

### 5. Start the API

```bash
npm run dev -w @dhaka-tesla-pool/api
```

Starts on `http://localhost:3001`. Health check:

```bash
curl http://localhost:3001/health
# {"status":"ok","service":"dhaka-tesla-pool-api",...}
```

### 6. Start the web app

```bash
npm run dev -w @dhaka-tesla-pool/web
```

Starts on `http://localhost:3000`.

### 7. Run checks / tests

From the repository root (runs every workspace):

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The API test suite runs its database-integration tests against a disposable
`dhaka_tesla_pool_test` database when PostgreSQL is reachable (`DATABASE_URL`
or the `.env` default), and skips cleanly when it is not. The auth tests use
deterministic fakes for the Clerk boundary and never need a network or keys.

### 8. Database type changes (dev)

Adding a `NOT NULL` column (like `clerk_user_id` in migration 0001) cannot be
applied to a populated table, so the local dev database must be recreated and
remigrated:

```bash
docker compose exec db psql -U postgres -c "DROP DATABASE IF EXISTS dhaka_tesla_pool WITH (FORCE);" -c "CREATE DATABASE dhaka_tesla_pool;"
npm run db:migrate -w @dhaka-tesla-pool/api
npm run db:seed   -w @dhaka-tesla-pool/api
```

CI and the `*_test` database always build from a fresh database, so they are
unaffected.

## Authentication (Clerk)

Authentication is managed by [Clerk](https://clerk.com) (ADR-013) — the
application does **not** store passwords or sessions.

- **Web (`@clerk/nextjs`):** `ClerkProvider` in the root layout, sign-in /
  sign-up pages, protected passenger pages, and `middleware.ts` route policy
  (`/`, `/sign-in*`, `/sign-up*` public; `/account*`, `/rides*`, and
  `/driver*` require a signed-in user and redirect to `/sign-in`).
- **API (`@clerk/backend`):** Fastify verifies every request under `/api` with
  `authenticateRequest()` (bearer token). `apps/api/src/auth/` implements the
  flow as three injectable boundaries — `SessionVerifier` (token → Clerk
  userId), `LocalUserResolver` (Clerk userId → local `users` row), and
  `ProvisionLocalUser` (first-request user creation, see Ad hoc provisioning
  below) — so the behavior is unit-tested with fakes. The API **never** trusts
  a `userId`, `role`, `name`, or `email` from a request body.
- **Authorization:** `request.auth.user` carries the PostgreSQL `role`
  (`PASSENGER` | `DRIVER` | `ADMIN`), `active`. Route guards:
  `requireAuth()` (any signed-in user) and `requireRole([...])`. The role is
  granted by the project owner in the database — it is application policy, not
  identity.
- **Environment:**
  - Web: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (browser-safe) and (server-side)
    `CLERK_SECRET_KEY` used by middleware/ClerkProvider SSR.
  - API: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`,
    `CLERK_AUTHORIZED_PARTIES` (comma-separated origins allowed to present
    tokens; defaults to `WEB_URL`). `CLERK_SECRET_KEY` is server-side only and
    must never reach the browser or be committed.
  - The placeholder values in `.env.example`/compose are well-formed **but
    invalid** (they only keep builds and the stack starting); real keys come
    from the [Clerk dashboard](https://dashboard.clerk.com).
- **Ad hoc provisioning (first authenticated request, ADR-014):** a valid
  Clerk identity with no local `users` row is provisioned on first use —
  anything new signing up just works. The Clerk profile is loaded server-side;
  the local user is created atomically (role `PASSENGER`, `active`, name =
  Clerk **username**, email = primary Clerk email) via
  `INSERT … ON CONFLICT (clerk_user_id) DO NOTHING`, so concurrent first
  requests yield exactly one row. If the email already belongs to another
  user, provisioning aborts with `500 AUTH_PROVISION_FAILED` — it never
  rebinds the existing row. `DRIVER`/`ADMIN` are **never** self-assignable.
- **Unauthenticated/unmapped behavior:** no token → `401 AUTH_UNAUTHENTICATED`;
  reserved seed placeholder → `401`; provisioning failure (e.g. email already
  taken) → `500 AUTH_PROVISION_FAILED`; inactive user → `403 AUTH_INACTIVE`;
  Clerk unconfigured → `500 AUTH_CONFIGURATION`. `403 AUTH_USER_NOT_FOUND`
  remains only as a defensive backstop for identities that are deliberately
  not provisionable.

### Mapping Clerk users to seeded characters

The seed uses a reserved placeholder (`dev-only::seed::<email>`) because we
never invent real Clerk IDs. Reserved values are rejected during auth, so they
can never authenticate. **Brand-new** Clerk identities are now provisioned
automatically (PASSENGER, see Ad hoc provisioning above), so the only mapping
step left is for demo characters, e.g. giving Nusrat access to the seeded
`nusrat@example.com` user with a real Clerk account:

```sql
-- Replace <clerk-user-id> with the real Clerk user ID (starts with "user_").
UPDATE users SET clerk_user_id = '<clerk-user-id>' WHERE email = 'nusrat@example.com';
```

Real Clerk IDs cannot collide with placeholders (`user_...` vs
`dev-only::seed::...`).

The seven Development-cluster cast identities (below) are applied for you by the
ready-made development-only script
[`apps/api/scripts/map-cast-clerk-ids.sql`](apps/api/scripts/map-cast-clerk-ids.sql);
it only updates `clerk_user_id` on the exact seeded rows and preserves every
role.

### Demo guide (local)

A complete local demo of the passenger flow (roles come from the seed — they
are never derived from email):

1. **Start PostgreSQL (Docker):**
   ```bash
   docker compose up db
   ```
2. **Run migrations:**
   ```bash
   npm run db:migrate -w @dhaka-tesla-pool/api
   ```
3. **Run seed** (idempotent — adds Jashim, Nusrat, Rafiq, Shirin, Karim, Rahim,
   Faruq, the four-Tesla fleet, and the 8 zones):
   ```bash
   npm run db:seed -w @dhaka-tesla-pool/api
   ```
4. **Map the seven seeded cast users to their real Clerk Development
   identities.** These seven users are **Development-instance test users** (the
   IDs are not secrets, but a matching `CLERK_SECRET_KEY` is required to verify
   their sessions). The script preserves the seeded roles exactly:
   ```bash
   docker compose exec -T db psql -U postgres -d dhaka_tesla_pool -f - `
     < apps/api/scripts/map-cast-clerk-ids.sql
   ```
   Result — `jashim@example.com`, `karim@example.com`, `rahim@example.com`,
   `faruq@example.com` → DRIVER; `nusrat@example.com`, `rafiq@example.com`,
   `shirin@example.com` → PASSENGER.
5. **Sign in through Clerk** at `http://localhost:3000` with one of the seven
   Development accounts (any brand-new identity is provisioned automatically).
6. **Scripted story:**
   - Nusrat → book **Banani → Mohakhali** and watch the fare estimate before
     confirming; the booked trip shows as an active banner that hides the
     booking form. Cancel (with the two-step confirm) then **rebook** — the
     active-ride rule only blocks while a trip is non-terminal.
   - Rafiq → book **Banani → Gulshan 1** on Bullet → verify the pooled fare
     (both riders see the 25% discount).
   - Shirin → grab Bullet's **last seat** after it is 2/3 full — the
     concurrency/capacity case.
   - Jashim → the **driver hub** at `/driver`: go online, open the **Waiting
     requests** lobby, and claim a request first-wins with **Accept ride**
     (ADR-022 — another driver racing you loses with a refresh hint). The pool
     moves to your open pools; on the pool detail run arrive → start → complete.
Pool completion frees Bullet/Tesla for a new pool. The toggle is refused
      while a pool you accepted is non-terminal (§21.J). Every seeded driver
      (Jashim→Bullet, Karim→Tesla 2, Rahim→Tesla 3, Faruq→Tesla 4) is online
      and eligible; a driver whose Teslas are all offline (toggle off) can
      watch the lobby but cannot accept (`VEHICLE_OFFLINE`).

No passwords appear in the README, source, seed, script, or git history. The
seven Clerk accounts are **Development-instance** test users in the project's
dev Clerk application; any production instance uses separate real identities.

## API

All `/api` routes require a Clerk session **bearer token**
(`Authorization: Bearer <token>`); the web client attaches it automatically
(`apps/web/lib/api.ts`). Errors use `{ error: { code, message, details? } }`.

| Endpoint | Policy | Notes |
|---|---|---|
| `GET /api/me` | any signed-in user | authenticated identity / role |
| `POST /api/rides` | `PASSENGER` | create a ride request; auto-matched & pooled (Phase 5); refused `409 ACTIVE_RIDE_EXISTS` while the caller has a non-terminal ride |
| `GET /api/rides/estimate` | `PASSENGER` | read-only pre-booking fare estimate (`?pickupZoneId=&destinationZoneId=&requestedSeats=`), nothing persisted |
| `GET /api/rides` | `PASSENGER` | the caller's own requests, newest first |
| `GET /api/rides/:rideId` | `PASSENGER` (owner) | 404 for unknown/another user's ride |
| `POST /api/rides/:rideId/cancel` | `PASSENGER` (owner) | cancel own ride while REQUESTED/MATCHED/DRIVER_ARRIVED (409 otherwise) |
| `GET /api/zones` | any signed-in user | pickup/destination pick-list (8 zones) |
| `GET /api/driver/availability` | `DRIVER` | current online/offline switch state |
| `POST /api/driver/availability` | `DRIVER` | switch the driver's Teslas online/offline (`{ "isOnline": boolean }` → 204; refused while any pool the driver accepted is non-terminal) |
| `GET /api/driver/pools` | `DRIVER` | the caller's accepted non-terminal pools (newest first) |
| `GET /api/driver/pools/available` | `DRIVER` | the **lobby**: every unassigned MATCHED wait pool, identical for all drivers (ADR-022) |
| `GET /api/driver/pools/history` | `DRIVER` | the caller's terminal (completed/cancelled) pools |
| `GET /api/driver/pools/:poolId` | `DRIVER` (owner) | one pool with passengers/seats/zones — no fares; 404 if not theirs or unknown |
| `POST /api/driver/pools/:poolId/accept` | `DRIVER` | **first-wins claim** of an unassigned pool (assigns driver/Tesla; idempotent for the owner; `409 POOL_ALREADY_ACCEPTED` if another driver won) |
| `POST /api/driver/pools/:poolId/arrive` | `DRIVER` (owner) | requires accept first (else 404 for unclaimed pools / 409) |
| `POST /api/driver/pools/:poolId/start` | `DRIVER` (owner) | requires arrival first |
| `POST /api/driver/pools/:poolId/complete` | `DRIVER` (owner) | requires start first; frees the Tesla/driver for a new pool |

`POST /api/rides` body (Zod, strict — unknown keys rejected, identity/role is
taken from the session, never from the body):

```json
{
  "pickupZoneId": "uuid-from-/api/zones",
  "destinationZoneId": "uuid-from-/api/zones",
  "requestedSeats": 1,
  "clientRequestId": "uuid" 
}
```

- `requestedSeats` is 1–3; an unknown zone id is `400 VALIDATION_ERROR`;
  pickup === destination is rejected.
- HTTP **201** on creation; a repeat submission with the **same
  `clientRequestId`** replays the existing ride and returns HTTP **200**
  (idempotent, migration 0003). Without a `clientRequestId`, each submission
  creates a new ride — documented MVP behavior.
- **One active ride per passenger (ADR-021):** while the caller already has a
  non-terminal ride (REQUESTED/MATCHED/DRIVER_ARRIVED/STARTED), a new booking is
  refused with `409 ACTIVE_RIDE_EXISTS` — enforced by the database
  (`ride_requests_one_active_per_passenger`, migration 0006), so even two
  concurrent bookings from the same passenger race safely. Cancelled or
  completed trips free the passenger to book again.
- Same-zone-partner hint: riding with Nusrat (`Banani → Mohakhali`) or Rafiq
  (`Banani → Gulshan 1`) both use `pickupZoneId = Banani`.

### Fare formula (worked examples)

Integer paisa, never floating point. Per seat stored; total = final × seats.

```
roadKm = haversine(pickup, destination) × 1.3        // R = 6371 km
distanceChargePaisa = roundHalfUp(roadKm × 1200)     // 12 BDT/km
finalFarePaisa = 3000 + distanceChargePaisa − 0      // base 30 BDT; poolDiscount = 0 pre-pooling
estimatedTotalPaisa = finalFarePaisa × requestedSeats
```

| Route | distance (km) | fare per seat | BDT |
|---|---|---|---|
| Nusrat | Banani → Mohakhali | 2.932 km × 1.3 ≈ 3.812 km | **5932 paisa** | 59.32 |
| Rafiq | Banani → Gulshan 1 | 1.140 km × 1.3 ≈ 1.483 km | **4140 paisa** | 41.40 |

A two-seat booking of Nusrat's route costs 2 × 5932 = **11864 paisa**.
These values are pinned in `test/fare.test.ts` and `test/rides.test.ts` from
the seed coordinates, so any drift is a test failure. See ADR-015 and
`apps/api/src/fare/calculate.ts` for the exact code.

### Pooling (Phase 5)

`POST /api/rides` now runs the match inside its own create transaction
(ADR-016/017). A request joins the best **eligible** pool — same pickup zone,
all-pairs drop-off spread ≤ **2.0 km**, enough seats — or, when no eligible
pool exists, is placed into a new **unassigned wait pool** (`driver_id`/
`vehicle_id` NULL) that any online driver claims first-wins from the lobby
(ADR-022). Either way it responds `MATCHED` with an additive `pool` object on
the ride (`capacitySnapshot`, `occupiedSeats`; `vehicle`/`driver` are `null`
until a driver accepts the pool).
Nusrat + Rafiq pool (drop-off spread ≈ 1.906 km); `Banani → Dhanmondi`
(≈ 4.6 km away) does not.

```
poolDiscountPaisa = roundHalfUp(25% · (baseFare + distanceCharge))  // pool ≥ 2 ACTIVE members, else 0
finalFarePaisa    = baseFare + distanceCharge − poolDiscount         // same row, updated in place
```

| Passenger | Route | solo (initial) | pooled (25% off) |
|---|---|---|---|
| Nusrat | Banani → Mohakhali | **5932 paisa** | **4449 paisa** |
| Rafiq | Banani → Gulshan 1 | **4140 paisa** | **3105 paisa** |
| Shirin | Banani → ... (any) | full fare | 25% off once pooled with a partner |

Pooled values are pinned in `test/pooling.test.ts`, `test/rides.test.ts`, and
`test/fare.test.ts`. `POST /api/rides/:rideId/cancel` (owner-only) cancels
`REQUESTED`/`MATCHED`/`DRIVER_ARRIVED` rides (P8, Phase 6), frees the seats,
recomputes remaining members' fares in place, and cancels a pool that empties
(403/409/404 semantics in `test/pooling.test.ts`). The last-seat and first-pool
races are covered by real concurrent tests against two database connections.

### Driver workflow (Phase 6 — ADR-022: first-wins accept from a lobby)

Drivers hold no session-visible data themselves — every route is
`requireRole(["DRIVER"])` and derives identity purely from the bearer session
(`request.auth`), never from the body. Endpoints:

- `POST /api/driver/availability` body `{ "isOnline": true|false }` → **204**.
  Flips all of the driver's Teslas. Refused while** any pool the driver
  **accepted** is non-terminal (`409 DRIVER_HAS_ACTIVE_POOL`, §21.J — narrowed
  by ADR-022: unassigned wait pools waiting in the lobby never block the
  toggle). Idempotent — setting the already-current state succeeds.
- `GET /api/driver/pools` → `{ "pools": [...] }`: the driver's **accepted**
  non-terminal pools, `created_at DESC, id DESC`. Each view is fare-free: `pool`
  fields plus ACTIVE `members[]` (`passengerName`, `seats`, `pickupZone`/
  `destinationZone` names) and the assigned Tesla (NULL while unassigned).
- `GET /api/driver/pools/available` → `{ "pools": [...] }`: the **lobby** —
  every unassigned `MATCHED` pool (newest first). Identical for all drivers by
  construction; claims happen here.
- `GET /api/driver/pools/:poolId` → `{ "pool": {...} }`, same shape as a list
  item; **404** for an unknown or another driver's pool (existence hidden 1:1).
- `POST /api/driver/pools/:poolId/accept|arrive|start|complete` → `{ "pool": ... }`.
  - `accept` is the **first-wins claim**: atomically assigns `driver_id`/
    `vehicle_id`/`accepted_at` to an unassigned pool while the pool stays
    `MATCHED`. **Idempotent** for the owner (the active-pool count excludes the
    pool being re-accepted); the first of several concurrent drivers wins, the
    rest get `409 POOL_ALREADY_ACCEPTED`; a pool already past MATCHED → `409
    POOL_NOT_ACCEPTABLE`; no online Tesla with `capacity >= capacity_snapshot`
    → `409 VEHICLE_OFFLINE`; already owning another active pool → `409
    DRIVER_HAS_ACTIVE_POOL`.
  - `arrive` requires an **accepted** MATCHED pool — on an unclaimed pool it is
    `404 NOT_FOUND` (ownership exists only through acceptance); the pool and
    every member ride move together (per-ride `ride_status_history` rows).
  - `start` → `STARTED`; `complete` → `COMPLETED` and the Tesla/driver are free
    for a new pool (terminal status drops the pool out of the per-driver/
    vehicle partial unique indexes — no separate "release" action).
  - Every driver action locks **vehicle rows → member rides → pool** (ADR-020)
    so concurrent actions serialize: two accepts of the same pool → exactly one
    winner, two `arrive`s/`complete`s have exactly one winner.
- Passenger-facing consequence (P8): `POST /api/rides/:rideId/cancel` is legal
  while the pool is `MATCHED` **or `DRIVER_ARRIVED`** (seat freed, remaining
  fares recomputed); refused once the trip is `STARTED` or `COMPLETED`.

No fares appear on any driver endpoint by design (P9): fare breakdown is a
passenger concern. Migrations `0005` (`pools.accepted_at` + progression CHECK)
and `0007` (nullable assignment + wait-pool CHECKs + one-accepted-pool-per-
driver/vehicle) drive the driver flow; `test/driver.test.ts` (40 tests) is
pinned against the seed cast — Jashim drives Bullet, Nusrat/Rafiq book the
pool, Shirin's concurrent grab is the canonical capacity race, and Karim/Rahim/
Faruq (Tesla 2/3/4, all online) cover the cross-driver race and multi-pool
accept cases (the no-Tesla `VEHICLE_OFFLINE` case uses a dedicated non-cast
driver fixture).

## Known Limitations (accepted — not fixed in this phase)

Two minor runtime behaviors are known and intentionally left unfixed — neither
affects data integrity or backend-enforced business rules.

- **Driver online/offline toggle can surface `Failed to execute 'json' on
  'Response': Unexpected end of JSON input`.** The switched state is still
  applied and becomes visible on refresh. Suspected cause: the web API client
  eagerly parses the JSON body of the toggle's `204 No Content` response
  (`POST /api/driver/availability`). A future fix should make the client's
  `request()` skip JSON parsing for empty 2xx responses.
- **An offline driver can still *see* waiting requests in the lobby.**
  `GET /api/driver/pools/available` lists every unassigned pool regardless of
  the caller's availability; the backend correctly refuses such an accept with
  `409 VEHICLE_OFFLINE` (the security boundary is the API, never the UI). A
  future UX improvement could hide the lobby (or gray out Accept) while the
  driver is offline; optionally the backend could filter the list by the
  caller's availability.

## Docker (full stack, reproducible)

Builds and starts `web` + `api` + `db` with healthchecks:

```bash
docker compose up --build
```

- `http://localhost:3000` — web
- `http://localhost:3001/health` — API health
- `http://localhost:5432` — PostgreSQL

Notes:

- The compose stack runs **production builds** of `web`/`api`; source changes
  require `docker compose up --build` again. For hot reload during development
  use the per-workspace `npm run dev` commands (API/web) with `docker compose
  up db` for PostgreSQL.
- Without real `CLERK_SECRET_KEY`/`CLERK_PUBLISHABLE_KEY` in `.env`, compose
  falls back to invalid-but-well-formed placeholders: the stack boots and the
  unauthenticated shape of every route works, while authenticated API routes
  return the documented `AUTH_CONFIGURATION` error.
- `docker compose down` stops containers and keeps the DB volume.
  `docker compose down -v` also deletes the database volume (destructive).

## Development Approach

Implementation proceeds in phases (see
[docs/development-plan.md](docs/development-plan.md)), one logical change per
feature branch (`feature/<feature-name>`), merged to `master` when it works.
Long-lived branches: `master`, `pre-release`, `release/v1.0.0`. Commits follow
`<type>(<scope>): <description>` with a meaningful, inspectable history.

## Documentation

- PRD (primary source of truth): [docs/reference/PRD.pdf](docs/reference/PRD.pdf)
- Requirements: [docs/requirements.md](docs/requirements.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Database design: [docs/database.md](docs/database.md)
- Decisions: [docs/decisions.md](docs/decisions.md)
- Development plan: [docs/development-plan.md](docs/development-plan.md)

## Known Security Notes (accepted)

- `npm audit` reports moderate advisories reachable only through the
  dev-time CLI dependency `drizzle-kit` → `@esbuild-kit/esm-loader` → esbuild
  < 0.24.3. The proposed "fix" downgrades drizzle-kit (breaking); the exposure
  is development-time only, so it is accepted and revisited when tooling
  allows.
- Clerk keys are server-side secrets (`CLERK_SECRET_KEY`); only the publishable
  key is browser-safe. Neither is committed, and tokens/sessions are never
  logged by the API. `CLERK_AUTHORIZED_PARTIES` constrains which origins may
  present tokens to the API.

## AI Usage

AI coding tools are explicitly allowed by the PRD and are used as a normal
engineering tool — never hidden. This is the record the PRD requires.

- **Tool:** an AI CLI coding agent (opencode) used throughout the project for
  implementation, testing, docs, and verification.
- **For what:** scaffolding; the database schema, migrations and seed; the
  Clerk authentication implementation (SDK wiring, middleware, Fastify auth
  plugin); tests; and this documentation.
- **Accepted suggestion:** generate the `users.clerk_user_id` NOT NULL +
  UNIQUE constraint so the DB — not the application — enforces "one application
  user per Clerk identity", and drive the lookup from that unique index.
- **Rejected/modified suggestion:** the agent proposed keeping an
  application-owned `sessions` table alongside Clerk for local revocation
  bookkeeping. This was rejected: Clerk owns the session lifecycle
  (ADR-013), the API re-validates every request with `authenticateRequest()`,
  and a second session store would reintroduce exactly the manual-auth surface
  the decision removed — so the `sessions` table was dropped (migration 0001).
- **Accepted suggestion:** for the `AUTH_USER_NOT_FOUND` gap, provision the
  application user lazily on the **first authenticated request** (ADR-014)
  using `INSERT … ON CONFLICT (clerk_user_id) DO NOTHING`, rather than bind a
  Clerk account to a seeded row by email.
- **Rejected/modified suggestion:** for the same gap, the agent evaluated Clerk
  **webhooks** to create users at signup and **email-binding** of seeded
  characters. Both were rejected: webhooks add an event system no consumer
  needs yet, and email-binding lets anyone self-assign a seeded identity
  (including, with a crafted email, a DRIVER). New identities are provisioned
  on demand; demo-character mapping remains an explicit `users` UPDATE.
- **Accepted suggestion (Phase 5):** create the racing pool with
  `INSERT … ON CONFLICT DO NOTHING RETURNING` instead of a plain insert +
  uniqueness-error retry. The conflict-target partial index
  (`pools_single_active_per_vehicle`) turns the losing concurrent insert into a
  no-op with an empty result, so one bounded re-scan joins the winner's pool —
  no retry loop (ADR-017).
- **Rejected/modified suggestion (Phase 5):** the agent's first concurrency draft
  used a cached `available_seats` counter with optimistic `UPDATE … WHERE
  available >= n` and a bounded retry loop. Rejected: a counter is a second
  source of truth that can desync, and it did not solve the *pool-creation*
  race on the same Tesla. The final design derives occupancy from ACTIVE
  `pool_members` under a `SELECT … FOR UPDATE` on the pool row and settles
  creation via the ON CONFLICT flow above.
- **Rejected suggestion (Phase 5):** a Redis lock/`SETNX` gate for the last-seat
  race. Rejected — the MVP has exactly one writer (PostgreSQL) and one hot row
  (the pool row); a cache would add a second source of truth and latency. The
  database-transactional claim is proven by concurrent tests; Redis stays out
  per AGENTS.md "no unnecessary Redis" (ADR-017).
- **Accepted suggestion (Phase 7):** enforce "one active ride per passenger"
  with a **database partial unique index**
  (`ride_requests_one_active_per_passenger`, migration 0006) whose violation the
  service maps to `409 ACTIVE_RIDE_EXISTS`, instead of a read-then-write
  application check. The DB is the arbiter even when two concurrent bookings
  race (ADR-021 §1).
- **Rejected/modified suggestion (Phase 8):** the agent's first draft of the
  state pages polled forever (`refetchInterval: 5000` unconditionally). Modified
  to **poll only while the trip is non-terminal and stop at
  COMPLETED/CANCELLED** — an infinite poll on a finished trip is wasted traffic
  and hides the "ride is over" state (ADR-021 §6). A Tailwind/shadcn scaffold
  for the design was likewise deferred in favor of the hand-written plain-CSS
  system (ADR-021 §4): no dependency without a reason.
- **Accepted suggestion (Phase 6/8 follow-up, ADR-022):** the agent discovered a
  real bug during rework — `acceptPool`'s "one active pool per driver" pre-check
  counted the very pool being (re-)accepted, so an idempotent re-accept of an
  own pool was refused with `DRIVER_HAS_ACTIVE_POOL`. Fixed by excluding the
  pool itself (`AND id <> :poolId`) in the count, which is what makes re-accept
  idempotent while still refusing a genuine second pool.
- **Rejected/modified suggestion (Phase 6/8 follow-up, ADR-022):** the agent's
  first accept design kept ADR-019's **accept-as-confirmation** and only added a
  read-only "available pools" list. Rejected during review: with no driver-facing
  decision, the open first-wins lobby story could not work. Final design makes
  `accept` the **claim** (assigns `driver_id`/`vehicle_id`/`accepted_at` under
  vehicle → count → pool-row locks) and the lobby a genuine competition — every
  unassigned wait pool is claimable by any eligible driver, first-wins
  (`409 POOL_ALREADY_ACCEPTED`), with booking decoupled from fleet availability.
- The human engineer owns and must be able to explain every line of code.