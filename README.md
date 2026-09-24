# Dhaka Tesla Pool

*Share a seat. Split the fare. Survive Dhaka traffic.*

## Status

**Phase 2 — Database schema, migrations, and seed: complete.** The full
relational schema is implemented and migrated (users, sessions, vehicles,
zones, ride requests, pools, memberships, fares, ride-status history), seeded
with the PRD cast (Jashim + Bullet, Nusrat, Rafiq, Shirin and 8 Dhaka zones),
and covered by 21 schema-integration tests. See
[docs/database.md](docs/database.md). **No business features are implemented
yet** — auth, rides, pools, and fares arrive in later phases per
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

## Planned Architecture

A modular monolith:

```
Browser
  → Next.js (apps/web)
  → Node.js/Fastify API (apps/api)
  → PostgreSQL
```

The frontend never talks to PostgreSQL directly; all business rules live in the
API. See [docs/architecture.md](docs/architecture.md) for the diagram.

## Planned Technology Stack

Proposed choices, recorded as ADRs in [docs/decisions.md](docs/decisions.md).

- **Frontend:** Next.js 15 (App Router), React 19, TypeScript. Tailwind CSS,
  shadcn/ui, TanStack Query, React Hook Form, Zod, and Leaflet + OpenStreetMap
  are added when the relevant frontend feature phase begins.
- **Backend:** Node.js, Fastify 5, TypeScript, REST, Pino. Zod validation is
  added with the auth/rides phases.
- **Database:** PostgreSQL 16 (Docker), Drizzle ORM (`postgres.js` driver),
  integer paisa/poysha money. Schema, enums, constraints and indexes are
  implemented; see [docs/database.md](docs/database.md).
- **Auth:** application-owned cookie sessions, Argon2id, role-based
  (passenger/driver) — later phase.
- **Testing:** Vitest (API unit/integration), Playwright E2E (later phase).
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
  web/        Next.js 15 App Router frontend (Phase 1 scaffold)
  api/        Fastify 5 + Drizzle REST API (Phase 1 scaffold)
              src/db/schema.ts        schema (Phase 2)
              src/db/seed.ts          idempotent cast seed (Phase 2)
              drizzle/                generated migrations (Phase 2)
              test/database.test.ts   schema-integration tests (Phase 2)
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

Defaults work for local development with Docker Postgres. Generate a real
`SESSION_SECRET` locally when auth is implemented.

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
`ON CONFLICT DO NOTHING`; never deletes). The seeded `password_hash` values are
documented development-only placeholders until the auth phase.

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
or the `.env` default), and skips cleanly when it is not.

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

## AI Usage

AI coding tools are explicitly allowed by the PRD and are used as a normal
engineering tool — never hidden. Per the PRD, this README will document which
AI tools were used, for what, one accepted suggestion, and one rejected or
modified suggestion with reasons, once features are implemented. The human
engineer owns and must be able to explain every line of code.