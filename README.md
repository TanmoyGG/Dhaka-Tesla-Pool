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
by 7 fare and 22 rides integration tests — full suite 83/83. See
[the API section](#api-phase-4) below and ADR-015.
Pooling/matching, the ride state machine, and drivers are later phases per
[docs/development-plan.md](docs/development-plan.md).

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

- **Frontend:** Next.js 15 (App Router), React 19, TypeScript. Tailwind CSS,
  shadcn/ui, TanStack Query, React Hook Form, Zod, and Leaflet + OpenStreetMap
  are added when the relevant frontend feature phase begins.
- **Backend:** Node.js, Fastify 5, TypeScript, REST, Pino. Zod validation is
  added with the rides/pools phases.
- **Database:** PostgreSQL 16 (Docker), Drizzle ORM (`postgres.js` driver),
  integer paisa/poysha money. Schema, enums, constraints and indexes are
  implemented; see [docs/database.md](docs/database.md).
- **Auth:** Clerk (`@clerk/nextjs` on the web, `@clerk/backend` +
  `authenticateRequest` on the API). Role-based authorization stays in
  PostgreSQL (`users.role`); no passwords or sessions are stored by the
  application. See [Authentication](#authentication) and ADR-013.
- **Testing:** Vitest (42 API tests: 23 database integration + 19 auth), Playwright E2E (later phase).
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
  web/        Next.js 15 App Router frontend (Phase 1 scaffold + Phase 3 Clerk)
              middleware.ts        Clerk route policy (Phase 3)
              app/sign-in|sign-up  Clerk-managed auth pages (Phase 3)
              app/account/         protected profile page (Phase 3)
              lib/api.ts           bearer-token API client (Phase 3)
  api/        Fastify 5 + Drizzle REST API (Phase 1 scaffold)
              src/db/schema.ts        schema (Phase 2 + Phase 3 clerk_user_id)
              src/db/seed.ts          idempotent cast seed (Phases 2 + 3)
              src/auth/               Clerk verification + authorization (Phase 3)
              drizzle/                generated migrations (Phases 2 + 3)
              test/database.test.ts   schema-integration tests (Phases 2 + 3)
              test/auth.test.ts       auth behavior tests (Phase 3)
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
`/sign-in` (its route policy is unchanged).

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
  sign-up pages, a protected `/account` page, and `middleware.ts` route policy
  (`/`, `/sign-in*`, `/sign-up*` public; `/account*` requires a signed-in user
  and redirects to `/sign-in`).
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

## API (Phase 4)

All `/api` routes require a Clerk session **bearer token**
(`Authorization: Bearer <token>`); the web client attaches it automatically
(`apps/web/lib/api.ts`). Errors use `{ error: { code, message, details? } }`.

| Endpoint | Policy | Notes |
|---|---|---|
| `GET /api/me` | any signed-in user | authenticated identity / role |
| `POST /api/rides` | `PASSENGER` | create a ride request with its initial fare estimate |
| `GET /api/rides` | `PASSENGER` | the caller's own requests, newest first |
| `GET /api/rides/:rideId` | `PASSENGER` (owner) | 404 for unknown/another user's ride |
| `GET /api/zones` | any signed-in user | pickup/destination pick-list (8 zones) |

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
- The human engineer owns and must be able to explain every line of code.