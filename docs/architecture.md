# Architecture — Dhaka Tesla Pool (MVP)

> Proposed architecture for the MVP. Current best-effort design, not final.
> Any material change must be documented here and in `docs/decisions.md`.

## 1. Overview

Dhaka Tesla Pool is built as a **modular monolith**: one Node.js API serving one
web frontend, sharing one PostgreSQL database, organized as an npm-workspaces
monorepo with two applications under `apps/`.

```
Browser
  → Next.js (apps/web) + Clerk (identity provider)
      └─ web authenticates the user with Clerk (ClerkProvider / middleware)
         and sends the Clerk session token to the API as
         Authorization: Bearer <clerk-session-token>
  → Node.js/Fastify API (apps/api)
      └─ verifies the token with @clerk/backend (authenticateRequest),
         resolves the local user via users.clerk_user_id, attaches request.auth
  → PostgreSQL
      └─ application data; users.role + users.active = authorization source
```

The frontend never talks to PostgreSQL directly; all business rules live in the
API. This matches the PRD's "Architecture First" section
(`docs/requirements.md` §10) and keeps the evaluatable surface simple.

**Identity vs authorization (ADR-013):** Clerk decides *who you are*
(authentication); the application decides *what you may do* (authorization),
with `role`/`active` stored in PostgreSQL and resolved per request from the
verified Clerk identity. There are no application passwords or sessions.

## 2. Architecture Diagram

```mermaid
flowchart LR
    subgraph Client
        B[Browser]
    end

    CLERK[Clerk - identity provider<br/>sessions, sign-in/sign-up UI, tokens]

    subgraph Web[apps/web - Next.js/React/Tailwind/shadcn]
        UI[React UI]
        CLRP[<@clerk/nextjs><br/>ClerkProvider + middleware]
        RF[React Hook Form + Zod validation]
        TQ[TanStack Query client state / caching]
        MAP[Leaflet + OpenStreetMap - visualization only]
        APIINT[API client layer - sends Bearer token]
    end

    subgraph Api[apps/api - Fastify]
        ROUTES[REST routes]
        VERIFY[Auth plugin<br/>@clerk/backend authenticateRequest<br/>+ resolve local user]
        AUTHZ[requireAuth / requireRole<br/>roles from PostgreSQL]
        VAL[Zod request validation]
        BC[Business logic / services<br/>ride state machine, pooling, fares]
        QRY[Drizzle queries + transactions<br/>row locking for seats]
        LOG[Pino logging / errors]
    end

    subgraph Data[PostgreSQL - Neon/local compose]
        DB[(PostgreSQL<br/>schema + constraints<br/>users.role / users.active)]
    end

    B --> CLERK
    B --> UI
    CLERK --> CLRP
    UI --> MAP
    UI --> RF
    UI --> TQ
    TQ --> APIINT
    APIINT --> VERIFY
    CLRP --> AUTHZ
    VERIFY --> AUTHZ
    VERIFY --> DB
    ROUTES --> VAL
    VAL --> BC
    BC --> QRY
    BC --> LOG
    QRY --> DB
```

## 3. Component Responsibilities

> Phase-1 note: the sections below describe the **target** architecture. As of
> Phase 1 the implemented surface is: minimal Next.js App Router app, Fastify
> app with `GET /health`, env config, Pino logging, JSON error envelope, and a
> Drizzle client + migration tooling. Everything not yet implemented is marked.

### 3.1 Frontend (`apps/web`)
- Phase 1: minimal App Router scaffold (`app/layout.tsx`, `app/page.tsx`
  status page), dev server, production build, tsc type check, ESLint.
- Phase 3 (complete): Clerk authentication UI — `ClerkProvider` in the root
  layout, `/sign-in` and `/sign-up` pages, a protected `/account` profile page,
  and `middleware.ts` route policy.
- Later phases: passenger and driver flows (request ride, status tracking,
  driver accept/arrive/start/complete).
- **Runs client-side form validation with Zod (via React Hook Form) but never
  relies on it** — it is UX-only (Phase 9).
- Uses TanStack Query for data fetching, caching, and loading/error/empty states
  (Phase 9).
- Leaflet renders predefined Dhaka zones and route polylines on OpenStreetMap —
  **visualization only**, no routing (Phase 9).
- Communicates with the API only through the API client layer
  (`apps/web/lib/api.ts`), which attaches the Clerk session token as a Bearer
  token using `NEXT_PUBLIC_API_URL`.

### 3.2 Backend (`apps/api`)
- Fastify REST API. Owns **all validation, authorization, and business logic**.
- Phase 1: application bootstrap (`src/app.ts`), server entry (`src/server.ts`),
  environment configuration (`src/config.ts`), Pino logging, JSON error
  envelope, `GET /health` liveness endpoint, and a Drizzle foundation
  (`src/db/`): client, `db:check`, `db:migrate`, empty schema.
- Phase 3 (complete): `src/auth/` — Clerk verification boundary
  (`provider.ts`: `@clerk/backend` `authenticateRequest` with
  `authorizedParties`), local user resolution (`user-resolver.ts`:
  `users.clerk_user_id`), the Fastify auth plugin (`install.ts`:
  `request.auth`, `requireAuth`, `requireRole`) plus the authenticated
  `GET /api/me` route (`routes.ts`). Everything under `/api` requires a valid
  bearer session; `/health` stays public.
- Phase 3.5 (complete): first-request user provisioning (`provision.ts` +
  `user-resolver.ts` `upsertLocalUser`): a verified Clerk identity with no
  local row is provisioned as `PASSENGER` on its first authenticated request,
  atomically (`INSERT … ON CONFLICT (clerk_user_id) DO NOTHING`). Webhooks are
  not used (ADR-014).
- Phase 4 (complete): `src/fare/` — deterministic fare estimation
  (`calculate.ts` `computeInitialFare`, `constants.ts`), and `src/rides/`
  (`service.ts` + `routes.ts` + `errors.ts`): `createRideRequest` inserts ride
  + fare + initial status journal row in one transaction, with optional
  `client_request_id` idempotent replay; a Zones reference list; PASSENGER-role
  reads scoped to the caller. Request/params validation on routes uses **Zod**
  (strict schemas); the JSON error envelope gains an additive `details` array
  (ADR-015).
- Phase 5 (complete): `src/matching/rules.ts` — pure, deterministic matching
  rule (same pickup zone + all-pairs drop-off spread ≤ 2.0 km + capacity;
  fullest pool first; ADR-016). `src/rides/state.ts` — the single-source
  transition map; invalid moves raise `409 INVALID_STATE_TRANSITION`
  (`src/rides/errors.ts`). `src/rides/pooling/` (`service.ts` + `fare.ts`) —
  transactional seat claims (`SELECT … FOR UPDATE` on the pool row + derived
  occupancy), `INSERT … ON CONFLICT DO NOTHING RETURNING` pool creation with a
  bounded re-scan, create-time auto-match (ride + membership + history commit
  together), in-place per-member pooled-fare recompute, passenger cancel
  (`POST /api/rides/:rideId/cancel`) and service-only forced-cancel with full
  refund (ADR-017/018). `src/db/types.ts` — structural `DbTransaction`.
  `fares.updated_at` added by migration 0004 (additive).

### 3.3 Database (PostgreSQL)
- Phase 1: PostgreSQL 16 in Docker Compose (healthcheck + persistent named
  volume); Drizzle migration runner verified against it.
- Phase 2 (complete): real schema implemented and migrated — `users`,
  `vehicles` (+ fixed capacity), `zones`, `ride_requests`, `pools`,
  `pool_members`, `fares`, `ride_status_history` (the Phase 2 `sessions` table
  was dropped in Phase 3, migration 0001). Invariants enforced with
  CHECK/unique/partial-unique constraints and sensible indexes; money is
  integer paisa/poysha; the lifecycle (`REQUESTED → MATCHED → DRIVER_ARRIVED →
  STARTED → COMPLETED (+ CANCELLED)`) is a PostgreSQL enum. Deterministic,
  idempotent seed with the PRD cast (Jashim/Bullet/Nusrat/Rafiq/Shirin).
  See [docs/database.md](database.md).
- Phase 3 (complete): `users.clerk_user_id` (NOT NULL, unique) maps a verified
  Clerk identity to the application user; `role` and `active` remain in
  PostgreSQL; seeded users get a reserved `dev-only::seed::` placeholder.
- Phase 4 (complete): `ride_requests.client_request_id` (uuid, nullable) with
  the partial unique index `ride_requests_client_request_id_key` (migration
  0003) backs idempotent ride creation; `fares` is now written at creation as
  the per-seat initial estimate (discount 0) — a snapshot the pooling phase
  recomputes in place when a ride joins a pool.
- Phase 5 (complete): `fares.updated_at` (migration `0004`, additive) audits
  the in-place pooling recompute; pools/pool_members and their partial unique
  indexes already existed (Phase 2, ADR-012), so pooling required **no** new
  table.
- Later phases: single source of truth for ride behavior; driver-flow
  transitions (`DRIVER_ARRIVED → STARTED → COMPLETED`) on the declared state
  map.
- Occupied seats are always **derived** from ACTIVE `pool_members` rows — there
  is no cached "available seats" counter. Concurrency approach documented in
  `docs/database.md` §7.

### 3.4 Route policy (Phase 3 + Phase 4 ride endpoints)

| Route | Policy | Enforcement |
|---|---|---|
| `GET /health` (API) | **Public** | No auth (registered outside the `/api` scope) |
| `/api/me` (API) | Signed-in user (any role) | Auth plugin preHandler (bearer token) + `requireAuth` |
| `POST /api/rides` (API) | `PASSENGER` | `requireAuth` + `requireRole(["PASSENGER"])` + strict Zod body |
| `GET /api/rides` (API) | `PASSENGER` (own rides only) | `requireAuth` + `requireRole(["PASSENGER"])` |
| `GET /api/rides/:rideId` (API) | `PASSENGER` (owner); 404 otherwise | `requireAuth` + `requireRole(["PASSENGER"])` + owner check |
| `POST /api/rides/:rideId/cancel` (API) | `PASSENGER` (owner); 404 or 409 otherwise | `requireAuth` + `requireRole(["PASSENGER"])` + owner/state checks (Phase 5) |
| `GET /api/zones` (API) | Signed-in user (any role) | Auth plugin preHandler (bearer token) + `requireAuth` |
| `/` , `/sign-in`, `/sign-up` (web) | **Public** | Clerk middleware (no protection) |
| `/account*` (web) | Signed-in user | Clerk middleware redirects to `/sign-in` |

Unauthenticated API requests fail closed with `401 AUTH_UNAUTHENTICATED`.
Role-protected routes add `requireRole([...])`; the role comes from the
PostgreSQL user row, never from the client (ADR-013/014/015). Unknown zone ids
on `POST /api/rides` are `400 VALIDATION_ERROR` (zone ids are form values, K8);
a ride id that does not exist — or belongs to another user — is a single
`404 NOT_FOUND` (no existence leak).

## 4. Boundaries

| Boundary | Held by | Why |
|---|---|---|
| **Authentication** | Clerk + API (bearer verification) | Clerk owns identity/sessions; the API re-verifies every token with `@clerk/backend` and resolves the local user. |
| **Authorization** | API (roles in PostgreSQL + owner checks) | A passenger must never modify another passenger's ride; roles/active live in the DB, never in the client. |
| **Business logic** | API services | Fare, pooling, and lifecycle must be testable in isolation; never trusted client-side. |
| **Database access** | API via Drizzle | Frontend never reaches PostgreSQL. |
| **Map** | Frontend (Leaflet + OSM) | Visualization only; no routing engine needed. |

## 5. Why a Modular Monolith (and not microservices)

- The MVP is one team, one domain, one deployable backend. Microservices would
  add network hops, contracts, and failure modes without any PRD benefit.
- The PRD explicitly warns against microservices/Kafka/Kubernetes/Redis/queues
  unless there is a *reason* (`docs/requirements.md` §10).
- The seam for later modular extraction is preserved: `apps/api` internals are
  organized by domain (auth, rides, pools, fares), so a future split into
  separate services would keep service boundaries intact.
- Single deployable simplifies `docker compose up`, free-tier hosting, and the
  "shipped, not just coded" requirement.

## 6. What Would Change at Larger Scale

Recording potential future changes (not implemented now — see bonus analysis in
`docs/development-plan.md` Phase 12 and `docs/requirements.md` §15):

- Split web/API into separate deploys (already separate apps in the monorepo).
- Read replicas + bigger indexes; move seat-allocation locking under contention
  analysis; queues for matching/notifications; cache hot reads.
- These are documented reasoning, not built into the MVP.

## 7. Deployment Topology (proposed)

```
Vercel (Next.js frontend)  →  Render (Fastify API)  →  Neon (PostgreSQL)
```

- Free tier only. If free backend hosting is unavailable, fall back to a
  reproducible Docker deployment (documented at that time).

## 8. Implementation Status (Phase 1)

Implemented and verified:

- Monorepo npm workspaces: `@dhaka-tesla-pool/api`, `@dhaka-tesla-pool/web`.
- Docker Compose full stack (web + api + db) with healthchecks, built and
  started via `docker compose up --build` on Windows.
- API `GET /health` (local and in-container), Pino logging, JSON errors.
- Drizzle/postgres.js client, `db:check` (`SELECT 1` -> ok), `db:migrate`
  (creates `drizzle.__drizzle_migrations`), `drizzle-kit generate` (empty schema).
- CI workflow: install → lint → typecheck → test → build.

## 9. Implementation Status (Phase 2)

Implemented and verified (schema, migration, seed, tests — see
[docs/database.md](database.md)):

- Full Phase 2 schema: 9 tables + 3 PostgreSQL enums, UUID PKs, tz-aware UTC
  timestamps, integer-paisa money, CHECK/unique/partial-unique constraints.
- Migration `apps/api/drizzle/0000_whole_queen_noir.sql` generated by
  `drizzle-kit`, reviewed, committed unmodified; applied cleanly to the
  container database and reapply is a no-op.
- Idempotent deterministic seed (`npm run db:seed`): Jashim (driver) + Bullet
  (capacity 3, online) + Nusrat/Rafiq/Shirin + 8 predefined Dhaka zones.
- Schema-integration tests (23 in `apps/api/test/database.test.ts`) verify
  migration, seed, unique-email, positive-seats, duplicate-membership, FK
  integrity, negative-fare and cyclic-state-history rejection, and more. They
  run per-suite against a disposable `<db>_test` database and skip when no
  PostgreSQL is reachable; CI provides a Postgres service.
- CI now runs the DB tests against a `postgres:16-alpine` service container.

## 10. Implementation Status (Phase 3 — Clerk authentication)

Implemented and verified (see [docs/decisions.md](decisions.md) ADR-013,
[docs/database.md](database.md) §6):

- Database adapted: `users.clerk_user_id` (NOT NULL, unique) added, `password`
  hash column removed, `sessions` table dropped, `user_role` gains `ADMIN`.
  Generated migrations `0001_fluffy_lethal_legion.sql` and
  `0002_greedy_ultimatum.sql` applied cleanly to a fresh dev database; no
  `db:generate` drift.
- Frontend: `@clerk/nextjs` (`ClerkProvider` in layout, `/sign-in`, `/sign-up`,
  protected `/account`, `middleware.ts` route policy, `lib/api.ts` bearer
  client).
- Backend: `@clerk/backend` verification boundary + local user resolution +
  Fastify auth plugin (`request.auth`, `requireAuth`, `requireRole`) +
  `GET /api/me`; `/health` public. First-request provisioning
  (`provision.ts`, `upsertLocalUser` in `user-resolver.ts`) materializes new
  Clerk identities as `PASSENGER` users atomically and fails closed with
  `AUTH_PROVISION_FAILED` on any provisioning error, including email-uniqueness
  conflicts (see [docs/decisions.md](decisions.md) ADR-014).
- Auth behavior tests (23 in `apps/api/test/auth.test.ts`) run with injected
  deterministic fakes (no network): unauthenticated, valid identity, local-user
  mapping, unknown identities (provisioned on first request), idempotent
  provisioning across requests, provisioning failure → `AUTH_PROVISION_FAILED`,
  expired/inactive/reserved identities, role reject/accept, body-supplied
  userId/role/name/email never trusted, `/health` public.
- Database tests (`apps/api/test/database.test.ts`, 29) cover the
  `users.clerk_user_id` upsert against a disposable `_test` database: PASSENGER
  creation, email lowercasing (constraint), idempotency, concurrent
  provisioning → exactly one row, email-taken → `AUTH_PROVISION_FAILED` with no
  rebind, reserved placeholders never provisioned.
- Full compose stack (`web` + `api` + `db`) builds and runs with healthchecks;
  route policy verified live (`/` 200, `/sign-in` 200, `/account` 307 →
  `/sign-in`, `/health` 200); unprovisioned Clerk yields the documented
  `AUTH_CONFIGURATION` error on authenticated routes.

Not yet implemented (later phases): ride/booking UI (web), driver flow
(`DRIVER_ARRIVED → STARTED → COMPLETED`), drivers, map visualization,
deployment to Vercel/Render/Neon. Pool matching, the ride state machine, and
pooled-fare recompute are implemented in Phase 5 (§12).

## 11. Implementation Status (Phase 4 — ride requests & fare estimation)

Implemented and verified (see [docs/decisions.md](decisions.md) ADR-015,
[docs/database.md](database.md) §3.5/§3.8/§7):

- **Fare module** (`apps/api/src/fare/`): deterministic initial estimate —
  `roundHalfUp(haversine × 1.3 × 1200)` + 3000 paisa base; stored per seat,
  total = final × seats; pool discount 0 until pooling. Nusrat
  Banani→Mohakhali 5932 paisa; Rafiq Banani→Gulshan 1 4140 paisa (pinned in
  tests).
- **Ride endpoints** (`apps/api/src/rides/`): `POST /api/rides` (201 new / 200
  idempotent replay via optional `client_request_id`), `GET /api/rides`,
  `GET /api/rides/:rideId`, `GET /api/zones` — all auth-aware.
- **Validation**: Zod strict schemas; unknown keys rejected; identity/role
  always from the verified session, never from the body.
- **Atomicity**: ride + fare + initial status journal row in one transaction;
  a concurrent duplicate `client_request_id` rolls back its INSERT (partial
  unique index) and replays the winner.
- **CORS** now permits `POST` (and preflight returns the actual allowed
  methods). Errors carry additive `details`.
- Tests: `test/fare.test.ts` (7) + `test/rides.test.ts` (22)
  — full suite 83/83 with `fileParallelism: false` (shared disposable test
  database). Migration 0003 applied to the Docker dev DB; `db:generate` reports
  no drift.

## 12. Implementation Status (Phase 5 — pool matching, lifecycle & concurrency)

Implemented and verified (see [docs/decisions.md](decisions.md) ADR-016/017/018,
[docs/database.md](database.md) §7, [docs/requirements.md](requirements.md) §21):

- **Matching** (`apps/api/src/matching/rules.ts`): pure, deterministic rule —
  same pickup zone + all-pairs drop-off spread ≤ 2.0 km + `occupied +
  requested ≤ capacity_snapshot`; best eligible pool = fullest → newest → stable
  id; an eligible pool always beats a new one; Tesla pick is also deterministic.
  Nusrat + Rafiq pool (spread ≈ 1.906 km); Dhanmondi does not (≈ 4.6 km).
- **State machine** (`apps/api/src/rides/state.ts`): single transition map for
  the whole PRD lifecycle; every service transition goes through `canTransition`;
  illegal moves surface as `409 INVALID_STATE_TRANSITION` (Fastify built-in
  error envelope). `REQUESTED → MATCHED` and cancellations are Phase 5-exercised;
  `DRIVER_ARRIVED → STARTED → COMPLETED` are declared and driver-phase-exercised.
- **Auto-match** (`src/rides/pooling/service.ts`): `createRideRequest` runs the
  match *inside its own transaction* — ride + fare + history + membership +
  pool_id commit atomically; a request either joins the best pool or starts a new
  `MATCHED` pool (no driver accept in Phase 5, ADR-016).
- **Seat-claim concurrency (ADR-017)**: occupancy is always derived
  (`SUM(seats) WHERE status='ACTIVE'`); a claim `SELECT … FOR UPDATE`s the pool
  row, re-derives under the lock, and only joins when the assertion passes;
  pool creation uses `INSERT … ON CONFLICT DO NOTHING RETURNING` plus exactly one
  bounded re-scan, so two concurrent first-seat requests end MATCHED in the
  **same** pool and two concurrent last-seat claims never exceed Bullet's 3
  seats. Lock order (ride → pool) is consistent across match/cancel/force-cancel,
  so no deadlock.
- **In-place pooled fare** (`src/rides/pooling/fare.ts`): ≥ 2 ACTIVE members ⇒
  every member's fare row recomputed in place (25% off base+distance, rounded
  half-up; `fares.updated_at` from migration 0004); solo pool stays at full fare.
  Nusrat 4449 / Rafiq 3105 paisa — pinned.
- **Cancellation** (`POST /api/rides/:rideId/cancel`): owner-only (404
  otherwise), legal in REQUESTED/MATCHED, else 409. MATCHED cancels flip
  membership to `LEFT`, recompute remaining fares, cancel an emptied pool.
  `forceCancelRide(rideId)` (service only, ADR-018) = cancel + full refund
  through the discount term (`final = 0`), CHECKs still hold. No `cancel_reason`.
- **Ride view** gained an additive `pool` object (id/status/vehicle/driver/
  capacitySnapshot/occupiedSeats) computed via a correlated ACTIVE-membership
  subquery — history of exactly the Phase 4 shape stays intact.
- **Validation/tests**: full suite **122/122** (8 files), root lint + typecheck +
  build (API + Next.js web) green; migration 0004 applied to the Docker dev DB;
  `db:generate` reports no drift; `docker compose config` valid. Concurrency is
  proven with two independent PostgreSQL connections, including the canonical
  race — Bullet pre-filled to 2 seats, Rafiq vs Shirin both claiming the last
  seat: exactly one MATCHED, one stays REQUESTED, occupancy always 3.
- Pending (later phases): driver accept/arrived/started/complete, payments,
  frontend pooling UX.