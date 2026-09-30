# Dhaka Tesla Pool

*Share a seat. Split the fare. Survive Dhaka traffic.*

A ride-pooling MVP for Dhaka. Battery-powered, three-seat "Teslas" (easy-bike
style, unaffiliated vehicles) carry multiple passengers between **predefined
Dhaka zones**. Passengers request a ride and get a deterministic fare estimate;
compatible requests share one Tesla, every passenger keeps an individual fare,
occupied seats never exceed capacity, and drivers claim pooled trips
first-wins, run them through a shared lifecycle, and collect cash at the end.

**Status: feature-complete MVP.** Passenger flow, driver flow, pooling,
fare model, ride lifecycle, Clerk authentication, and both web + API test
suites are implemented and green. Public deployment (Vercel/Render/Neon) is
**planned, not yet executed** — see [Deployment](#deployment). The final
six-minute demo video is [pending](#demo-video).

---

## Table of contents

- [Project overview](#project-overview)
- [The problem](#the-problem)
- [Core features](#core-features)
- [Actors and system concepts](#actors-and-system-concepts)
- [Complete application flow](#complete-application-flow)
- [Application screenshots](#application-screenshots)
- [Architecture](#architecture)
- [Database / ERD](#database--erd)
- [Technology stack](#technology-stack)
- [Project structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Environment variables](#environment-variables)
- [Local development setup](#local-development-setup)
- [Docker setup](#docker-setup)
- [Database migrations and seed](#database-migrations-and-seed)
- [Running the frontend and backend](#running-the-frontend-and-backend)
- [Running tests](#running-tests)
- [Demo / seed accounts](#demo--seed-accounts)
- [API overview](#api-overview)
- [Fare calculation](#fare-calculation)
- [Pooling and concurrency](#pooling-and-concurrency)
- [Authentication and security](#authentication-and-security)
- [Key engineering decisions](#key-engineering-decisions)
- [Known limitations](#known-limitations)
- [Future improvements](#future-improvements)
- [AI usage](#ai-usage)
- [Demo video](#demo-video)
- [Deployment](#deployment)
- [PRD traceability](#prd-traceability)
- [Documentation](#documentation)
- [License](#license)

---

## Project overview

Dhaka Tesla Pool matches ride requests onto shared three-seat Teslas. When two
passengers need roughly the same route (for example Nusrat going Banani →
Mohakhali and Rafiq going Banani → Gulshan 1), they are pooled onto the same
Tesla instead of taking two separate rides. Each passenger pays an individual
fare — cheaper than riding alone thanks to a **25% pool discount** — and the
driver collects the combined total in cash at the end.

The MVP is a **modular monolith**: a Next.js frontend, a Fastify REST API, and
PostgreSQL. Identity comes from **Clerk**; the application role and all
business rules live in the database and are enforced by the API. The whole
stack reproduces locally with **Docker Compose**.

## The problem

Nusrat needs to get from Banani to Mohakhali. Rafiq needs almost the same route
to Gulshan 1. Jashim's Tesla, Bullet, has three seats. Passengers should be
able to request a ride and share a Tesla when it makes sense; the driver needs
to see who is aboard and at which stage; each passenger sees only their own
fare and status; and history must stay explainable after the ride ends.

Getting this right means solving some genuinely tricky problems that the rest
of this README explains in detail:

- a **deterministic, hand-verifiable fare model** (integer paisa, never floats);
- a **documented matching rule** that decides which requests share a Tesla;
- a **database-backed concurrency story** for the full capacity last seat and
  for a pool being claimed by racing drivers (no Redis, no queues — real
  PostgreSQL transactions with row locks);
- an **explicit ride state machine** that rejects invalid transitions;
- and **ownership enforcement** so no user can touch another user's ride.

## Core features

**Passenger**

- Sign in/up with Clerk; role is granted by the project owner in the database.
- Book a ride between predefined Dhaka zones with a live, pre-booking fare
  estimate.
- See your *own* rides, status timeline, fare breakdown and history.
- Cancel while the trip is not yet started (REQUESTED / MATCHED /
  DRIVER_ARRIVED); cancellation frees the seat and recomputes the other
  passengers' fares.
- One active ride at a time (enforced by the database).
- "Paid cash" completion confirmation with your final fare.

**Driver**

- Online/offline switch for their Tesla fleet.
- Waiting-request **lobby** — claim an unassigned pool **first-wins**.
- Active-trip card with the next legal action right on the workspace:
  accept → arrive → start → complete.
- Pool detail with every passenger, their seats, route and **individual fare**,
  plus the **total to collect**.
- "Cash received" completion confirmation and a completed-trip history.
- The workspace map highlights the pool's shared pickup and **every distinct
  drop-off** (Nusrat to Mohakhali, Rafiq to Gulshan 1 — both shown).

**Platform**

- Always-dark, hand-written plain-CSS design system (no UI framework pulled in
  without a documented reason).
- REST API with 18 authenticated endpoints, Zod validation, and a typed error
  envelope.
- 8-table relational schema with database-enforced invariants (capacity,
  single active ride, single accepted pool per driver/vehicle, fare formula,
  timestamps).
- 250 tests: 170 API integration/unit tests + 80 web component tests.

## Actors and system concepts

| Concept | Meaning in the system |
|---|---|
| **Passenger** | A `users` row with `role = PASSENGER`. Books rides, views own fares/history, cancels while valid. |
| **Driver** | A `users` row with `role = DRIVER`. Owns Tesla(s), toggles online/offline, claims and drives pools. |
| **Tesla / vehicle** | A `vehicles` row owned by a driver, fixed **3-seat** capacity (`capacity = 3`), online/offline state. E.g. Jashim's **Bullet**. |
| **Zone** | A `zones` row — one of 8 predefined Dhaka areas with a plain lat/long point (Banani, Gulshan 1, Mohakhali, Dhanmondi, Mirpur, Uttara, Farmgate, Bashundhara). |
| **Ride request** | A `ride_requests` row: a passenger's pickup, destination, requested seats, status, and (once matched) its pool. |
| **Pool** | A `pools` row: a group of matched ride requests. Every pool starts **unassigned** (no driver/Tesla) and is claimed by a driver. |
| **Pool member** | A `pool_members` row linking a ride request to a pool with its seat count and an explicit ACTIVE / LEFT status. |
| **Fare** | A `fares` row per ride request: base fare, distance charge, pool discount, and final fare in integer paisa. |
| **Ride status history** | An append-only `ride_status_history` journal of every transition a ride went through. |

## Complete application flow

### Ride lifecycle (state machine)

The PRD lifecycle is stored as a single enum:
`REQUESTED → MATCHED → DRIVER_ARRIVED → STARTED → COMPLETED` (+ `CANCELLED`).
Implementation notes:

- `REQUESTED` is **transient-only**: the moment a ride is created it is
  auto-matched, so a persisted ride is almost always born `MATCHED` inside a
  pool.
- `MATCHED` covers the PRD's "MATCHED/ACCEPTED" — acceptance is a separate
  **first-wins claim** recorded on the pool row (`accepted_at`), not a new enum
  value.
- Transitions are implemented as one explicit map in
  [`apps/api/src/rides/state.ts`](apps/api/src/rides/state.ts); every state
  change goes through it, and an illegal move is rejected with
  `409 INVALID_STATE_TRANSITION`.

```mermaid
stateDiagram-v2
    [*] --> REQUESTED
    REQUESTED --> MATCHED : auto-match (transient state, rarely visible)
    REQUESTED --> CANCELLED : passenger cancels
    MATCHED --> DRIVER_ARRIVED : driver arrives
    MATCHED --> CANCELLED : passenger cancels
    DRIVER_ARRIVED --> STARTED : driver starts trip
    DRIVER_ARRIVED --> CANCELLED : passenger cancels
    STARTED --> COMPLETED : driver completes trip
    COMPLETED --> [*]
    CANCELLED --> [*]
```

### Passenger flow

```mermaid
flowchart TD
    A["Landing / sign-in with Clerk"] --> B["Role resolved from PostgreSQL → redirected to passenger workspace"]
    B --> C["Pick pickup zone, destination zone, seats<br/>live fare estimate + map pins"]
    C --> D["Book ride (auto-matched into an eligible pool<br/>or a brand-new unassigned wait pool)"]
    D --> E["Matched — see driver/Tesla when assigned,<br/>seat fill, fare breakdown, status timeline"]
    E --> F["Driver arrives → driver starts trip<br/>(polled at 5 s)"]
    F --> G["Completed — 'Paid cash' modal with final fare"]
    G --> H["Ride history"]
    E --> I["Cancel (REQUESTED/MATCHED/DRIVER_ARRIVED only)<br/>frees seat, recomputes remaining fares"]
```

### Driver flow

```mermaid
flowchart TD
    A["Sign-in → driver workspace"] --> B["Online/offline toggle (refused while an<br/>accepted pool is active)"]
    B --> C["Waiting-request lobby — unassigned MATCHED pools"]
    C --> D["Accept pool (first-wins claim)<br/>races another driver → 409 POOL_ALREADY_ACCEPTED"]
    D --> E["Active trip card on the workspace + map pins<br/>(shared pickup + every distinct drop-off)"]
    E --> F["Arrive → Start → Complete"]
    F --> G["'Cash received' modal: per-passenger fares + total collection"]
    G --> H["Back to the lobby — trip history updated"]
```

### Pooling flow

```mermaid
flowchart TD
    N["Nusrat books Banani → Mohakhali (1 seat)"] --> P["New unassigned wait pool (capacity 3, MATCHED)"]
    R["Rafiq books Banani → Gulshan 1 (1 seat)"] --> M{"Same pickup zone?<br/>drop-off spread ≤ 2.0 km?<br/>capacity available?"}
    M -->|"yes"| P
    M -->|"no (e.g. Bashundhara → Uttara)"| Q["Separate new wait pool"]
    P --> D["Driver claims the pool first-wins (Jashim + Bullet)"]
    D --> L["Shared lifecycle: arrive → start → complete"]
    L --> F["Individual fares preserved per passenger<br/>25% pool discount applied to each"]
```

### Screens: which URL does what

| URL | How to read it |
|---|---|
| `/` | Landing; signed-in users are redirected to their role's workspace |
| `/sign-in`, `/sign-up` | Clerk-managed auth (dark-themed, on this origin) |
| `/rides` | Passenger workspace: map + booking form, or active-trip banner |
| `/rides/[rideId]` | Ride details: timeline, pool, fare breakdown, cancel |
| `/rides/history` | The caller's ride history |
| `/driver` | Driver workspace: availability, active trip, or waiting-request lobby |
| `/driver/[poolId]` | Pool details: passengers + fares, total collection, next action |
| `/driver/history` | Completed trips |
| `/account` | Profile (identity from Clerk, role from the application DB) |

## Application screenshots

Captured from the local development build against the current implementation
(commit `53abeb3`). They live in [`docs/Screenshots/`](docs/Screenshots).

### Landing & authentication

| | |
|---|---|
| ![Landing page](<docs/Screenshots/Dhaka Tesla pool.png>) | The public landing page — brand wordmark, tagline, sign-in/sign-up CTAs. |
| ![Clerk sign-in](<docs/Screenshots/sign in-clerk.png>) | Sign-in screen, dark-themed via `@clerk/themes`. |
| ![Clerk sign-up](<docs/Screenshots/sign-up-clerk.png>) | Sign-up screen, dark-themed via `@clerk/themes`. |
| ![Account page](<docs/Screenshots/account page.png>) | The account page — Clerk identity plus the application role and status from PostgreSQL. |

### Passenger experience

| | |
|---|---|
| ![Passenger workspace](<docs/Screenshots/landing page of passenger.png>) | The passenger workspace after sign-in. |
| ![Ride selection (desktop)](<docs/Screenshots/ride-selection-pc.png>) | Ride selection on desktop — zones, seats, map. |
| ![Ride selection (mobile)](<docs/Screenshots/ride-selection-mobile.png>) | Ride selection on a narrow mobile viewport. |
| ![Booking with map selection (Banani to Mohakhali)](<docs/Screenshots/creating pool or ride with map selection(banani to mohakhali).png>) | Booking Banani → Mohakhali — pickup and destination pins selected on the map, live fare estimate. |
| ![Rafiq matched into the pool](<docs/Screenshots/another passenger booked(banani to gulshan1) and mathced with the pool previously created of (banani to mohakhali).png>) | Rafiq books Banani → Gulshan 1 and is **matched into the existing Banani → Mohakhali pool** — both passengers now share a Tesla. |
| ![Separate, non-matching ride](<docs/Screenshots/another user booked different ride at the same the(bashundhara to uttara).png>) | A second user books Bashundhara → Uttara — farther than the 2.0 km spread rule, so it stays its own pool. |
| ![Passenger completion — paid cash](<docs/Screenshots/after ride complete individual passenger see their fare and pop up for  paid cash.png>) | After the trip completes, the passenger sees their **individual final fare** with the "Paid cash" acknowledgment. |
| ![Passenger ride history](<docs/Screenshots/ride-history.png>) | The passenger's ride history with status, seat fill and fares. |

### Driver experience

| | |
|---|---|
| ![Waiting requests lobby](<docs/Screenshots/from driver view both rides showing in the waiting request.png>) | The driver's **waiting-request lobby** — both pooled rides shown, waiting for a first-wins accept. |
| ![Accepted pool with map](<docs/Screenshots/driver accept the pool of banani to mohakhali and gulshan 1(pickup and destination selected on map).png>) | Jashim accepts the pool — the workspace map highlights Banani as pickup and **both** Mohakhali and Gulshan 1 as destinations. |
| ![Pool details with fares](<docs/Screenshots/in the driver pool details both passenger's details and fare showing.png>) | Pool detail — both passengers' details and each passenger's fare, plus the total to collect. |
| ![Driver completion — cash received](<docs/Screenshots/after driver complete trip..showing total fare and pop up for cash receive.png>) | After the trip completes, the driver sees the total fare with the "Cash received" acknowledgment. |
| ![Waiting requests reappear](<docs/Screenshots/after completing a ride..driver can see the pending ride request again.png>) | Completion frees the driver — the next waiting request appears in the lobby again. |
| ![Driver trip history](<docs/Screenshots/driver trip history.png>) | The driver's completed-trip history with total collected per trip. |

## Architecture

A modular monolith. The browser talks only to the Next.js frontend, which
talks only to the Fastify API, which owns every business rule and talks to
PostgreSQL. The frontend never touches the database. Identity is delegated to
Clerk (external), and the map renders OpenStreetMap tiles read-only.

```mermaid
flowchart TB
    subgraph Browser["Browser"]
        P["Passenger / Driver"]
    end

    P --> WEB

    subgraph WEB["Frontend — apps/web (Next.js 15, React 19, TypeScript)"]
        UI["App Router pages</br>rides · driver · account · history"]
        Q["TanStack Query + API client"]
        MAP["Leaflet + OpenStreetMap</br>(visualization only)"]
        CW["@clerk/nextjs middleware + provider"]
    end

    subgraph CLERK["Clerk — external identity provider"]
        CLS["Sign-in / sign-up, sessions, tokens"]
    end

    CW <-->|"session tokens"| CLS

    subgraph API["Backend — apps/api (Node.js, Fastify 5, TypeScript)"]
        RT["18 REST endpoints under /api"]
        AU["Auth preHandler — @clerk/backend</br>verifies the bearer token"]
        SV["Services</br>rides · pooling · driver · fare · matching · state machine"]
        ORM["Drizzle ORM (postgres.js driver)"]
    end

    WEB -->|"Authorization: Bearer &lt;Clerk token&gt;"| API
    AU --> RT
    RT --> SV
    SV --> ORM
    ORM --> DB[("PostgreSQL 16</br>Docker locally · Neon at deploy")]

    MAP -.->|"map tiles (read-only)"| OSM["OpenStreetMap"]

    DOCKER["Docker Compose</br>web + api + db (local reproduction)"]
    DB -.-> DOCKER
```

Design boundaries:

- **Identity vs. authorization.** *Who you are* is Clerk's job. *What you may
  do* is the application's job: `users.role` lives in PostgreSQL and is resolved
  from the database on every request — never from the browser.
- **Backend owns the rules.** Capacity, matching, fares, lifecycle transitions
  and ownership are enforced in the API and the database, never trusted to the
  frontend.
- **Data integrity over polish.** State transitions are explicit
  (`ride_status_history`), money is integer paisa, and history stays
  explainable after a trip ends.

See [`docs/architecture.md`](docs/architecture.md) for the full design,
`docs/decisions.md` (ADRs) for every decision, and
[Pooling and concurrency](#pooling-and-concurrency) below for the consistency
strategy.

## Database / ERD

Eight tables. Key design choices:

- UUID primary keys, `timestamptz` timestamps (UTC), integer **paisa** money.
- PostgreSQL-native enums for role, ride status and pool member status.
- `ON DELETE RESTRICT` on the ride domain (history must stay explainable);
  `ON DELETE CASCADE` for a user's vehicles (infrastructure).
- No `sessions` table — Clerk owns sessions (ADR-013).
- Business invariants are enforced in the schema where an index/CHECK can carry
  them (see below), and transactionally in the pooling service where it cannot.

```mermaid
erDiagram
    users ||--o{ vehicles : "owns (driver_id)"
    users ||--o{ ride_requests : "books (passenger_id)"
    users ||--o{ pool_members : "rides in (passenger_id)"
    users ||--o{ pools : "drives (driver_id, nullable)"
    zones ||--o{ ride_requests : "pickup_zone_id"
    zones ||--o{ ride_requests : "destination_zone_id"
    ride_requests |o--|| pools : "belongs to pool (nullable)"
    pools ||--o{ pool_members : "contains"
    ride_requests ||--o{ pool_members : "has membership"
    ride_requests ||--o| fares : "has one fare (1:1)"
    ride_requests ||--o{ ride_status_history : "audit journal"
    vehicles |o--o| pools : "assigned on accept (nullable)"

    users {
        uuid id PK
        text clerk_user_id UK
        text name
        text email UK
        user_role role
        boolean active
        timestamptz created_at
        timestamptz updated_at
    }
    vehicles {
        uuid id PK
        uuid driver_id FK
        text name
        integer capacity
        boolean is_online
        timestamptz created_at
        timestamptz updated_at
    }
    zones {
        uuid id PK
        text name UK
        double latitude
        double longitude
        timestamptz created_at
    }
    pools {
        uuid id PK
        uuid vehicle_id FK "nullable"
        uuid driver_id FK "nullable"
        ride_status status
        integer capacity_snapshot
        timestamptz created_at
        timestamptz updated_at
        timestamptz accepted_at "nullable"
        timestamptz started_at "nullable"
        timestamptz completed_at "nullable"
    }
    ride_requests {
        uuid id PK
        uuid passenger_id FK
        uuid pickup_zone_id FK
        uuid destination_zone_id FK
        integer requested_seats
        ride_status status
        uuid client_request_id "nullable"
        uuid pool_id FK "nullable"
        timestamptz created_at
        timestamptz updated_at
        timestamptz cancelled_at "nullable"
        timestamptz completed_at "nullable"
    }
    pool_members {
        uuid id PK
        uuid pool_id FK
        uuid ride_request_id FK
        uuid passenger_id FK
        integer seats
        pool_member_status status
        timestamptz joined_at
        timestamptz left_at "nullable"
    }
    fares {
        uuid id PK
        uuid ride_request_id FK "unique"
        integer base_fare_paisa
        integer distance_charge_paisa
        integer pool_discount_paisa
        integer final_fare_paisa
        char currency
        timestamptz created_at
        timestamptz updated_at
    }
    ride_status_history {
        uuid id PK
        uuid ride_request_id FK
        ride_status from_status "nullable"
        ride_status status
        timestamptz created_at
    }
```

**Database-enforced invariants** (the schema, not the app, is the last line of
defense):

- Occupancy is never cached — it is derived from `SUM(seats)` over ACTIVE
  `pool_members` under a pool-row lock; there is no `available_seats` column.
- `fares.final_fare_paisa = base + distance − discount` (CHECK).
- One active (non-terminal) ride per passenger — partial unique index →
  `409 ACTIVE_RIDE_EXISTS`, race-safe.
- One **accepted** non-terminal pool per driver and per vehicle — partial
  unique indexes (ADR-022).
- `pools.accepted_at` required before the driver-flow states; COMPLETED must
  carry `completed_at` and a `started_at`; driver and vehicle are assigned
  together (all CHECKs).
- A cancellation timestamp and a completion timestamp can never both be set.

See [`docs/database.md`](docs/database.md) for the full catalog of
constraints, indexes, invariants and the concurrency write-up.

## Technology stack

Everything below is what the repository actually runs on (from the workspace
`package.json` files). For the *reason* behind each choice, see
[Key engineering decisions](#key-engineering-decisions) and
[`docs/decisions.md`](docs/decisions.md).

| Layer | Technology | What it does here | Why it fits |
|---|---|---|---|
| Frontend framework | **Next.js 15** (App Router), React 19, TypeScript 5.9 | Pages, route groups, layouts, `middleware.ts` route policy | Server/client hybrid, familiar App Router structure, easy Vercel target |
| Data fetching | **TanStack Query 5** | Server-state cache, 5 s polling while a trip is active, invalidation | Declarative loading/error/empty states and per-route invalidation |
| Forms & validation | **React Hook Form 7 + Zod 3** | Ride booking form, seat stepper, estimate gating | Typed schema on the client; the API re-validates with its own Zod schemas |
| Styling | **Hand-written always-dark plain CSS** (`app/globals.css`, ~1,500 lines) | Entire design system: tokens, components, responsive grid, Leaflet restyle | Deliberate deviation from Tailwind/shadcn (ADR-021 §4); no dependency without a reason |
| Map | **Leaflet 1.9 + OpenStreetMap tiles** | Zone pins, pickup/destination highlights, route fit | Free, works without a key, **visualization only** |
| Backend framework | **Fastify 5** + TypeScript, ESM | REST API, plugin-scoped routes, Pino logging | Fast, typed, the auth/role decorators slot into its hook lifecycle |
| API validation | **Zod** on the API | Strict request schemas; `400 VALIDATION_ERROR` with `details` | Same mental model as the frontend |
| ORM / DB driver | **Drizzle ORM 0.45 + postgres.js** | Schema, migrations, typed queries, transactions | Lightweight, SQL-native, gives us explicit `SELECT … FOR UPDATE` control |
| Database | **PostgreSQL 16** | The single source of truth (data + role + invariants) | Real transactions, row locks, partial unique indexes, enums, CHECKs |
| Auth | **Clerk** (`@clerk/nextjs` web, `@clerk/backend` API) | Sign-in/sign-up/sessions/tokens; API verifies bearer tokens | External identity provider — no passwords/sessions stored in-app (ADR-013) |
| Testing | **Vitest 4** (+ React Testing Library, jsdom) | 182 API tests (10 files), 128 web tests (21 files) | Fast, TS-native, real concurrent DB integration tests |
| Infra | **Docker + Docker Compose**, GitHub Actions CI | Reproducible `web + api + db` stack; `postgres:16-alpine` service | PRD requires reproducibility; compose is the fallback if free hosting is unavailable |
| Linting/type | **ESLint 9**, `typescript-eslint`, `tsc --noEmit` | `npm run lint`, `npm run typecheck` | Both run in CI |

## Project structure

```text
.
├── apps/
│   ├── web/                         # Next.js 15 frontend
│   │   ├── app/                     # App Router: layout, (auth), (main), middleware
│   │   │   ├── (auth)/              #   sign-in, sign-up (Clerk, dark-themed)
│   │   │   ├── (main)/              #   landing, rides, rides/[rideId],
│   │   │   │                        #   rides/history, driver, driver/[poolId],
│   │   │   │                        #   driver/history, account
│   │   ├── components/              # app-shell, role-gate, booking-area, ride-form,
│   │   │   │                        #   fare-breakdown, pool-info, status-timeline,
│   │   │   │                        #   ride/driver completion modals, driver/*, workspace/*
│   │   ├── lib/                     # api client, queries (hooks), types, format, rules
│   │   ├── test/                    # 80 Vitest + RTL tests (15 files)
│   │   └── app/globals.css          # the entire always-dark design system
│   └── api/                         # Fastify 5 REST API
│       ├── src/
│       │   ├── app.ts / server.ts   # Fastify bootstrap, error envelope, CORS
│       │   ├── config.ts            # env-driven config
│       │   ├── auth/                # Clerk verification, provisioning, role guards
│       │   ├── rides/               # routes + service + state machine + pooling
│       │   ├── driver/              # availability, lifecycle, hub routes
│       │   ├── fare/                # deterministic fare formula + constants
│       │   ├── matching/            # pool eligibility rule
│       │   └── db/                  # Drizzle schema, migrate, seed, check
│       ├── drizzle/                 # migrations 0000–0007 (+ meta)
│       ├── test/                    # 170 Vitest tests (9 files)
│       └── scripts/                 # dev-only helpers (incl. Clerk-ID mapping)
├── docs/
│   ├── reference/PRD.pdf            # primary source of truth (unmodified)
│   ├── requirements.md              # PRD interpretation
│   ├── architecture.md              # architecture (+ ADR-022 driver accept)
│   ├── database.md                  # schema, invariants, concurrency strategy
│   ├── decisions.md                 # ADR-style decision record
│   ├── development-plan.md          # phased implementation plan
│   ├── frontend-design.md           # frontend design specification
│   └── Screenshots/                 # UI walkthrough screenshots
├── .github/workflows/ci.yml         # lint → typecheck → test → build (with Postgres)
├── docker-compose.yml               # web + api + db, healthchecked
└── .env.example                     # every env var a fresh setup needs
```

## Prerequisites

- **Node.js ≥ 20** (developed and CI-tested on v24). Check: `node --version`
- **npm** (workspaces). Check: `npm --version`
- **Docker Desktop** for PostgreSQL and/or the full compose stack.
  Check: `docker --version` and `docker compose version`
- A free **Clerk** account (only needed for live sign-in/sign-up — the stack
  still boots without real keys; authenticated routes then return
  `AUTH_CONFIGURATION`).

## Environment variables

All variables are documented with placeholders in
[`.env.example`](.env.example) — copy it to `.env`. **Real secrets are never
committed**; `.env*` is git-ignored, except `.env.example`.

### Frontend (`apps/web`) — `.env` (browser + server)

| Variable | Purpose | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Browser-visible base URL of the API (e.g. `http://localhost:3001`) | You choose it |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Browser-safe Clerk key (required to build) | Clerk dashboard → API Keys |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` — keep Clerk flows on this origin | Fixed |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` | Fixed |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/` (role resolves the final redirect) | Fixed |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/` | Fixed |
| `NEXT_PUBLIC_CLERK_SIGN_OUT_FALLBACK_REDIRECT_URL` | `/` | Fixed |

### Backend (`apps/api`) — `.env` (server only)

| Variable | Purpose | Where to get it |
|---|---|---|
| `API_HOST` | Bind address (`0.0.0.0` inside Docker, `127.0.0.1` locally) | You choose it |
| `API_PORT` | API port (`3001`) | You choose it |
| `WEB_URL` | Web origin; the default authorized party + CORS domain | You choose it |
| `CLERK_SECRET_KEY` | **Server secret** — verifies bearer tokens. Never expose to the browser, never commit | Clerk dashboard → API Keys |
| `CLERK_PUBLISHABLE_KEY` | Publishable key passed to the Clerk client | Clerk dashboard |
| `CLERK_AUTHORIZED_PARTIES` | Comma-separated origins allowed to present tokens (CSRF/cookie-leak defence); defaults to `WEB_URL` | You choose it |

### Database & Docker (shared)

| Variable | Purpose | Where to get it |
|---|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/dhaka_tesla_pool` (used by the API for local runs; compose overrides host to `db`) | Your PostgreSQL / Neon |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Credentials for the compose Postgres container (`postgres` / `postgres` / `dhaka_tesla_pool` by default) | You choose them |

> The placeholders shipped in `.env.example` and `docker-compose.yml` are
> well-formed but deliberately **not** real Clerk keys (so secret scanners
> never misflag them). Everything boots with them, but authenticated flows
> need real keys from the [Clerk dashboard](https://dashboard.clerk.com).

## Local development setup

```bash
# 1. Clone the repository
git clone https://github.com/TanmoyGG/Dhaka-Tesla-Pool.git
cd Dhaka-Tesla-Pool

# 2. Install dependencies (npm workspaces)
npm install

# 3. Configure environment
cp .env.example .env        # edit with real Clerk keys for live auth

# 4. Start PostgreSQL (Docker)
docker compose up db

# 5. Apply migrations + seed the canonical cast
npm run db:migrate -w @dhaka-tesla-pool/api
npm run db:seed   -w @dhaka-tesla-pool/api
npm run db:check  -w @dhaka-tesla-pool/api   # "database connection OK"

# 6. Start the API (http://localhost:3001)
npm run dev -w @dhaka-tesla-pool/api

# 7. Start the web app (http://localhost:3000)
npm run dev -w @dhaka-tesla-pool/web

# 8. Open http://localhost:3000 — sign up, or map the seed cast to Clerk accounts
#    (see "Demo / seed accounts" below), then sign in.
```

Both `npm run dev` scripts load the repo-root `.env` automatically via Node's
`--env-file`, so no manual `export` is needed.

**Smoke test the API:**

```bash
curl http://localhost:3001/health
# {"status":"ok","service":"dhaka-tesla-pool-api", ...}
```

## Docker setup

The compose file builds three services with healthchecks, using the
**repository root** as the build context.

| Service | Image | Exposed port | Depends on |
|---|---|---|---|
| `db` | `postgres:16-alpine` | `5432` | — (volume `pgdata`) |
| `api` | `node:24-alpine` (multi-stage build of `apps/api`) | `3001` | `db` healthy |
| `web` | `node:24-alpine` (multi-stage build of `apps/web`) | `3000` | `api` healthy |

```bash
docker compose up --build    # start the whole stack (production builds)
docker compose down          # stop (keeps the DB volume)
docker compose down -v       # stop AND delete the DB volume (destructive)
docker compose logs -f api   # follow a service's logs
```

Notes:

- The stack needs **no real Clerk keys to boot** — compose falls back to
  invalid-but-well-formed placeholders; authenticated routes then return the
  documented `AUTH_CONFIGURATION` error. Put real keys in `.env`.
- The compose stack runs **production builds**; source changes need
  `docker compose up --build` again. For day-to-day development use the
  per-workspace `npm run dev` commands with `docker compose up db` for
  hot-reload PostgreSQL (this is the documented Windows-friendly workflow).
- `NEXT_PUBLIC_*` variables are baked into the browser bundle at **build
  time** (they are Docker `build args`), so change them in `.env` and rebuild.

## Database migrations and seed

Migrations are generated by Drizzle (`drizzle-kit`) and applied from
`apps/api/drizzle/` (migrations `0000`→`0007`):

```bash
npm run db:generate -w @dhaka-tesla-pool/api   # regenerate after schema edits
npm run db:migrate   -w @dhaka-tesla-pool/api  # apply pending migrations
npm run db:seed      -w @dhaka-tesla-pool/api  # idempotent seed
npm run db:check     -w @dhaka-tesla-pool/api  # connectivity smoke test
```

`db:seed` is fully idempotent (every insert uses `ON CONFLICT DO NOTHING`,
never deletes). Seed data is limited to the **canonical cast** — 7 users, 4
Teslas, 8 zones. No rides/pools/fares are seeded: the demo story (below) is
played live through the API.

> **If a migration adds a `NOT NULL` column to a populated table** (migration
> 0001 did), the local dev database must be recreated and re-migrated:

```bash
docker compose exec db psql -U postgres -c "DROP DATABASE IF EXISTS dhaka_tesla_pool WITH (FORCE);" -c "CREATE DATABASE dhaka_tesla_pool;"
npm run db:migrate -w @dhaka-tesla-pool/api
npm run db:seed    -w @dhaka-tesla-pool/api
```

CI and the `*_test` database always build fresh, so they are unaffected.

## Running the frontend and backend

| Task | Command (from repo root) |
|---|---|
| API (dev, hot reload) | `npm run dev -w @dhaka-tesla-pool/api` |
| Web (dev, hot reload) | `npm run dev -w @dhaka-tesla-pool/web` |
| API production build | `npm run build -w @dhaka-tesla-pool/api` → `npm run start -w @dhaka-tesla-pool/api` |
| Web production build | `npm run build -w @dhaka-tesla-pool/web` → `npm run start -w @dhaka-tesla-pool/web` |
| All workspaces | `npm run dev` / `npm run build` / `npm run start` |

## Running tests

```bash
npm test            # all workspaces (vitest run)
npm run typecheck   # tsc --noEmit for API + web
npm run lint        # ESLint for API + web
npm run build       # production build for API + web
```

The API suite runs its **database-integration tests against a disposable
`dhaka_tesla_pool_test` database** when PostgreSQL is reachable (the CI
workflow and the compose `db` service both provide one) and skips cleanly when
it is not. The auth tests use deterministic fakes for the Clerk boundary —
they never need a network or keys.

**Current suite:**

| Suite | Count | Files | Covers |
|---|---|---|---|
| API — Vitest | **170** tests | 9 | schema/database invariants, Clerk auth (fakes), fare formula pins, matching rule, state machine, pooling (incl. real concurrent last-seat + first-wins races), rides ownership, driver workflow, health |
| Web — Vitest + RTL | **80** tests | 15 | booking form, fare estimate gating, active-ride banner, cancellation, completion modals, driver workspace, pool actions, driver history, role gating, API client, nav rules, availability toggle |

The PRD's six required behaviors map to first-class tests:

1. **Bullet's capacity can never be exceeded** — `pooling.test.ts` concurrent
   last-seat claims (Rafiq vs Shirin), occupancy derivation under lock.
2. **Invalid ride state transitions are rejected** — `state.test.ts` +
   lifecycle arms in `rides.test.ts`/`driver.test.ts` (`409
   INVALID_STATE_TRANSITION`).
3. **Nusrat's and Rafiq's pooled fares calculate correctly** — `fare.test.ts`
   pins 3999 / 3977 paisa; driver views assert them over the wire.
4. **Users can't modify another user's ride** — `rides.test.ts` cross-user
   404s; owner-only routes; role guards (`403 FORBIDDEN`).
5. **Cancellation rules hold** — `pooling.test.ts` (seat freed, remaining
   fares recomputed, cancel-while-started refused).
6. **Two concurrent requests can't corrupt pool capacity** — real
   two-connection races in `pooling.test.ts` / `driver.test.ts`.

## Demo / seed accounts

The seed creates the canonical PRD cast. **No passwords are stored anywhere** —
authentication belongs to Clerk, and the seeded `users` rows carry a reserved
`dev-only::seed::<email>` placeholder that the API refuses to authenticate.

| User | Role | Clerk account needed for | Tesla |
|---|---|---|---|
| Jashim Ahmed (`jashim@example.com`) | DRIVER | the driver stories | **Bullet** (3 seats, online) |
| Karim Hossain (`karim@example.com`) | DRIVER | the cross-driver accept race | Tesla 2 (online) |
| Rahim Mia (`rahim@example.com`) | DRIVER | the cross-driver accept race | Tesla 3 (online) |
| Faruq Hasan (`faruq@example.com`) | DRIVER | the cross-driver accept race | Tesla 4 (online) |
| Nusrat Haque (`nusrat@example.com`) | PASSENGER | the primary passenger story | — |
| Rafiq Rahman (`rafiq@example.com`) | PASSENGER | the pooling story | — |
| Shirin Islam (`shirin@example.com`) | PASSENGER | the last-seat concurrency case | — |

**To play the cast with live Clerk identities:**

1. Create the seven accounts in a Clerk **Development** instance.
2. Map each real `user_...` id to the seeded row. A dev-only script does this
   for you (it updates only the seeded rows, never the role):

```bash
docker compose exec -T db psql -U postgres -d dhaka_tesla_pool -f - `
  < apps/api/scripts/map-cast-clerk-ids.sql
```

3. Sign in at `http://localhost:3000` as any of the seven.
4. Any **brand-new** Clerk identity is provisioned automatically on first
   request as a PASSENGER (ADR-014) — sign-up just works.

**Scripted story to demo end-to-end:**

1. **Nusrat** books **Banani → Mohakhali** — live estimate shown before
   confirming; the active-trip banner replaces the booking form.
2. **Rafiq** books **Banani → Gulshan 1** — matched into the same pool
   (drop-off spread ≈ 1.10 km ≤ 2.0 km rule); both see the 25% pool discount.
3. **Shirin** grabs Bullet's **last seat** — the capacity/concurrency case.
4. **Jashim** opens the driver workspace, goes online, sees the pool in the
   **Waiting requests** lobby, and **accepts** it first-wins.
5. Run **arrive → start → complete**; the driver sees per-passenger fares and
   the total collection; Nusrat/Rafiq each see their individual final fare.
6. A **non-matching** route (e.g. **Bashundhara → Uttara**) stays its own pool.

Reproducing this requires real Clerk Development keys. Without them the stack
still boots and the unauthenticated shape of every screen works; sign-in/up
and authenticated data require `CLERK_SECRET_KEY`/publishable keys.

## API overview

All API routes live under `/api` (except the public health probe `GET
/health`) and require an `Authorization: Bearer <clerk-token>` header; the web
client attaches it automatically. Errors use the envelope
`{ "error": { "code", "message", "details?" } }`. There are **18 endpoints**;
roles are enforced per route from the database role, never from the request.

| Endpoint | Policy | Purpose |
|---|---|---|
| `GET /health` | public | liveness probe |
| `GET /api/me` | any signed-in user | identity + role |
| `GET /api/zones` | any signed-in user | the 8-zone pick list (also feeds the map) |
| `POST /api/rides` | PASSENGER | create a ride; auto-match/pool; `201` new / `200` idempotent replay |
| `GET /api/rides/estimate` | PASSENGER | pre-booking fare estimate (read-only) |
| `GET /api/rides` | PASSENGER | the caller's own rides |
| `GET /api/rides/:rideId` | PASSENGER (owner) | one ride (404 for others') |
| `POST /api/rides/:rideId/cancel` | PASSENGER (owner) | cancel while REQUESTED/MATCHED/DRIVER_ARRIVED |
| `GET /api/driver/availability` | DRIVER | current online/offline state |
| `POST /api/driver/availability` | DRIVER | toggle fleet online/offline (204); refused while an accepted pool is active |
| `GET /api/driver/pools` | DRIVER (owner) | the driver's non-terminal accepted pools |
| `GET /api/driver/pools/available` | DRIVER | the **lobby** — every unassigned MATCHED pool (same for all drivers) |
| `GET /api/driver/pools/history` | DRIVER (owner) | completed trips (capped at 10) |
| `GET /api/driver/pools/:poolId` | DRIVER (owner) | one pool (404 if not theirs) with members + fares + earnings |
| `POST /api/driver/pools/:poolId/accept` | DRIVER | first-wins claim; `409 POOL_ALREADY_ACCEPTED` / `VEHICLE_OFFLINE` / `DRIVER_HAS_ACTIVE_POOL` |
| `POST /api/driver/pools/:poolId/arrive` | DRIVER (owner) | → DRIVER_ARRIVED (404 on unclaimed pools) |
| `POST /api/driver/pools/:poolId/start` | DRIVER (owner) | → STARTED |
| `POST /api/driver/pools/:poolId/complete` | DRIVER (owner) | → COMPLETED; frees the driver/Tesla |

The driver pool views include every passenger's **individual fare** and the
pool's total collection (`earnings`), sourced verbatim from the stored `fares`
rows.

## Fare calculation

The formula is deterministic and **hand-verifiable** — computed from the seed
zone coordinates, integer paisa throughout, with values pinned in tests

```text
roadKm = haversine(pickup, destination) × 1.3        // R = 6371 km; no routing
distanceChargePaisa = roundHalfUp(roadKm × 1200)     // 12 BDT/km, per seat
poolDiscountPaisa   = 0 before pooling
                    = roundHalfUp(25% × (base + distance)) once the pool has ≥ 2 ACTIVE members
finalFarePaisa      = 3000 + distanceCharge − poolDiscount       // base 30 BDT, per seat
estimatedTotalPaisa = finalFarePaisa × requestedSeats
```

The components are stored **per seat** in `fares`; the passenger's total is
`final × seats`. The 25% "share a seat, split the fare" pool discount is exact
in binary for the paisa sizes handled (0.25 is a power of two), so the
discount is deterministic.

### Worked examples (pinned in tests)

| Passenger | Route | Solo fare | Pooled fare (25% off) |
|---|---|---|---|
| Nusrat | Banani → Mohakhali | **5332 paisa** (BDT 53.32) | **3999 paisa** (BDT 39.99) |
| Rafiq | Banani → Gulshan 1 | **5303 paisa** (BDT 53.03) | **3977 paisa** (BDT 39.77) |

Nusrat: distance ≈ 1.49 km → road ≈ 1.94 km → charge 2332 → final 5332.
Rafiq: distance ≈ 1.48 km → road ≈ 1.92 km → charge 2303 → final 5303.
Pooled discount: `roundHalfUp(0.25 × 5332) = 1333` → 3999; `roundHalfUp(0.25 ×
5303) = 1326` → 3977.

- Two seats on Nusrat's route alone cost `2 × 5332 = 10664` paisa.
- The bank-verifiable values are pinned in `apps/api/test/fare.test.ts` from
  the seed coordinates, so any formula drift fails CI.
- Money is **always integer paisa** (`fares`), displayed with the BDT taka
  sign and two decimals (`formatPaisa`) — never recomputed in the UI.

See [`apps/api/src/fare/`](apps/api/src/fare) for the code and `docs/database.md`
for the invariants.

## Pooling and concurrency

Two races matter, and both are solved **inside PostgreSQL transactions with
row locks** — no Redis, no queues, no application mutexes (ADR-017/020/022).

### 1. The final-seat race (capacity can never be exceeded)

Canonical case from the PRD: Bullet has one seat left; **Nusrat and Shirin
claim it at the same time**.

`createRideRequest` runs its match inside a transaction and calls
`claimSeatIn`, the seat-claim **source of truth**:

```
SELECT … FOR UPDATE          -- lock the chosen pool row (the serialization point)
re-check pool status         -- terminal/closed pool → try the next candidate
derive occupancy             -- SUM(seats) over ACTIVE pool_members, under the lock
if capacity remains          -- admit the new member, write membership + fare + journal
else                         -- no eligible pool with room → start a NEW unassigned
                               MATCHED wait pool (INSERT … RETURNING)
```

Exactly one admission happens; the loser (or any request with no eligible
pool) lands `MATCHED` in its **own unassigned wait pool**. `REQUESTED` is
transient-only and capacity can never be exceeded — there is no cached
`available_seats` count to drift. The DB partial unique indexes on
`pool_members` additionally forbid two ACTIVE memberships per ride request and
duplicate memberships per (pool, request).

### 2. The first-wins driver accept race

Canonical case: **Jashim and Rahim both try to claim the same unassigned wait
pool at the same time.**

`acceptPool` serializes on the canonical lock order **vehicle → rides →
pool** (ADR-020):

```
lock the caller's VEHICLE rows          -- their fleet is the parallel unit
count owned active pools                -- excluding THIS pool (so re-accept is idempotent)
   active count > 0 → 409 DRIVER_HAS_ACTIVE_POOL
lock the contested POOL row             -- the first to get here wins
   driver_id already set by someone else → 409 POOL_ALREADY_ACCEPTED
   no online Tesla with capacity ≥ snapshot → 409 VEHICLE_OFFLINE
write driver_id + vehicle_id + accepted_at atomically
```

A second driver's accept returns `409 POOL_ALREADY_ACCEPTED`; a no-Tesla or
offline-Tesla driver gets `409 VEHICLE_OFFLINE`. The schema's partial unique
indexes (`pools_single_accepted_per_driver` / `_per_vehicle`) back this with a
second, non-bypassable guarantee.

### Invalid lifecycle transitions

An explicit transition map in `src/rides/state.ts` makes every move legal only
if it is declared. `REQUESTED→STARTED` or a second `complete` are rejected with
`409 INVALID_STATE_TRANSITION`, and every accepted move writes an append-only
`ride_status_history` row and its timestamp, so history is always explainable.

### Ownership

Passenger routes are scoped to the authenticated user (cross-user reads return
the same 404 as "does not exist"); driver routes are owner-only after accept
(an unclaimed pool is a 404 for everyone); roles are enforced per request from
the database.

### What changes at larger scale (future, not built)

- The pool row is a single hot serialization point. If a single Tesla becomes
  a hotspot under load, split per-pool**seat ledgers** or reservation rows and
  use `FOR UPDATE SKIP LOCKED`; move seats/occupancy to an append-only ledger
  so reads never lock.
- Multi-writer / cross-region adds a coordination layer; that (and a queue or
  event bus) is when Redis/Kafka-style infrastructure earns its keep — the MVP
  deliberately has none.
- The PRD's "Oi Tesla Goes Viral" bonus analysis (geospatial indexes,
  partition-by-status, eventual notification fan-out) is documented as
  reasoning in `docs/requirements.md` §15 and `docs/database.md` §7, and worked
  through in full in [`docs/scaling-plan.md`](docs/scaling-plan.md).

## Authentication and security

- **Identity is Clerk.** The web uses `@clerk/nextjs` (`middleware.ts` route
  policy + `ClerkProvider`); the API verifies every `/api` request with
  `@clerk/backend`'s `authenticateRequest` over the bearer token. No passwords
  or sessions are stored by the application (`sessions` table was removed,
  ADR-013).
- **Authorization is the database.** `users.role` (`PASSENGER` | `DRIVER` |
  `ADMIN`) and `users.active` are the application's source of truth, attached
  to `request.auth` on every request and enforced by `requireAuth()` /
  `requireRole([...])`. The role **never** comes from the body or from Clerk.
- **Provisioning is on-demand (ADR-014).** A valid Clerk identity with no
  local row is created on first request as a `PASSENGER`
  (`INSERT … ON CONFLICT (clerk_user_id) DO NOTHING RETURNING`, race-safe).
  `DRIVER`/`ADMIN` are never self-assignable. Reserved `dev-only::seed::…`
  placeholder ids are rejected (401).
- **User-scoped data.** Every authenticated query key embeds the Clerk
  `userId`; `SessionCacheSync` clears the TanStack cache when the user changes;
  cross-user ride reads 404 identically to missing rides.
- **Input validation.** Zod strict schemas on route bodies (unknown keys →
  400), zone ids validated, `pickup ≠ destination`, seats 1–3. Even so, the
  backend re-derives identity/role from the session.
- **Error envelope.** `{ error: { code, message?, details? } }` — codes like
  `ACTIVE_RIDE_EXISTS`, `POOL_ALREADY_ACCEPTED`, `FORBIDDEN`, `NOT_FOUND`.
- **Environment hygiene.** `CLERK_SECRET_KEY` is server-side only; only
  publishable keys reach the browser; `CLERK_AUTHORIZED_PARTIES` constrains
  which origins may present tokens; nothing is logged.

## Key engineering decisions

Every choice is recorded with alternatives and trade-offs in
[`docs/decisions.md`](docs/decisions.md) (ADRs 001–023). The highlights:

| Decision | Chosen | Alternative | Why / when to revisit |
|---|---|---|---|
| Architecture | Modular monolith (web + API + DB) | Microservices | One team, one domain, one deployable — simpler; split deploys only if load demands |
| Database | PostgreSQL 16 | SQLite/MySQL | Real transactions, row locks, partial unique indexes, enums, Neon free tier; revisit only for exotic scale |
| ORM | Drizzle + postgres.js | Prisma/Knex | SQL-native, lightweight, explicit `FOR UPDATE` control |
| Auth | Clerk (external IdP) | Self-hosted cookies | No password/session storage, battle-tested; revisit if self-host is required |
| UI styling | Hand-written plain CSS, always dark | Tailwind + shadcn/ui | No dependency without a reason (ADR-021 §4); revisit as the design surface grows |
| Geography | Predefined zones + lat/long points | Geocoding/routing | MVP needs no routing; OSRM/routing is a documented future step |
| Map | Leaflet + OSM, visualization only | Google Maps / paid tiles | Free and key-less; no traffic/GPS/E TA features in scope |
| Matching | Same pickup + drop-off spread ≤ 2.0 km, fullest pool first | Opaque ML / route-overlap rules | Deterministic and hand-checkable; revisit with real road-time routing |
| Fare | Integer paisa formula + 25% pool discount, stored per request | Float money / live pricing | PRD-mandated hand-verifiability; 0.25 is exact in binary |
| Pool creation | Unassigned MATCHED wait pool; driver claims first-wins | Reserve a Tesla at booking | Decouples booking from fleet availability (ADR-022) |
| Concurrency | PostgreSQL transactions + `FOR UPDATE` row locks | Redis locks / queues | Exactly one writer, one hot row; proven by concurrent tests (ADR-017/020) |
| Status refresh | 5 s polling, stopping at terminal state | WebSockets/SSE | Simplest correct approach for an MVP (ADR-021 §6); push later |
| Money collection | Cash acknowledgment (both roles) | Real payment gateway | PRD allows cash + simulated wallet; a gateway is a documented future step |
| Driver earnings visibility | Fares + total shown on the driver surface (commit `74e1d8f`) | Fare-free driver view (original P9) | The driver must see what they collect; sourced verbatim from stored fares |
| OSRM | **Intentionally deferred** | Real road-following routes | Straight-line ×1.3 is honest for the MVP; OSRM/Routing is a future improvement |

## Known limitations

Honest list of what the MVP intentionally does (and does not) do — none of
these are defects in the shipped scope, but a reviewer should know them:

- **Predefined zones, no geocoding or routing.** Geography is 8 fixed
  lat/long points; distances are great-circle × 1.3 — road-following routes
  (OSRM) are an explicit future enhancement, not an omission.
- **No live GPS / real-time Tesla tracking.** Positions are not tracked; the
  map visualizes zones, not vehicles in motion.
- **No real payment gateway.** Money is collected in cash; the passenger and
  driver completion modals are cash acknowledgments ("Paid cash" / "Cash
  received"). In-app balances don't exist.
- **5-second polling instead of push.** Status changes from *other* actors
  (the driver arriving, a new passenger joining) surface on the next poll —
  up to ~5 s of UI delay (ADR-021 §6).
- **Public OSM tile dependency.** The map needs network access to
  `tile.openstreetmap.org`; if it fails the app degrades gracefully with a
  "Live map unavailable" fallback while the controls stay usable.
- **Deployment not executed yet.** The target is Vercel (web) + Render (API) +
  Neon (Postgres), all free tier — see [Deployment](#deployment).
- **No Playwright E2E yet.** Browser-level coverage is component tests;
  full E2E is parked as future work (Phase 10).
- **Driver history is capped at 10 and shows completed (not cancelled) trips.**
  Documented MVP behavior.
- **Local multi-user demo steps.** Playing the full cast live requires real
  Clerk Development keys and the (documented) Clerk-ID mapping script.

## Future improvements

- **Road-following routes via OSRM** (or a paid routing provider) replacing the
  straight-line × 1.3 approximation, enabling true detour/time-based matching.
- **Live GPS / vehicle tracking** on the map.
- **Real-time updates** — WebSocket/SSE (or Server-Sent-Events) status push
  instead of 5 s polling, plus push notifications.
- **Real payment gateway** (bKash/Nagad/Stripe) consuming the stored fare rows.
- **Geospatial matching** — PostGIS and spatial indexes; the "Oi Tesla Goes
  Viral" scaling analysis in `docs/requirements.md` §15.
- **Larger-scale concurrency** — per-pool seat ledgers, `FOR UPDATE SKIP
  LOCKED` reservation rows, and an event/queue layer only when the pool row
  becomes a real hotspot.
- **Observability** — structured request tracing, metrics, richer health
  checks for deployed environments.
- **Playwright E2E** for the critical passenger/driver journeys.
- **Admin tooling** — the `ADMIN` role exists in the schema but no
  admin-only routes are built yet.

## AI usage

AI coding tools are explicitly allowed by the PRD and are used as a normal
engineering tool — never hidden. The PRD record, from the actual development
history:

- **Tool:** an AI CLI coding agent (opencode) used across the project for
  implementation, testing, docs, and verification. Every line of AI-assisted
  code was reviewed and is owned/explainable by the human engineer.
- **What it was used for:** the database schema/migrations/seed, the Clerk
  authentication wiring (middleware, Fastify auth plugin, provisioning), fare
  and pooling services, the state machine, both web surfaces, all tests, and
  this documentation.

**Accepted suggestions:**

- Enforce "one application user per Clerk identity" in the **database**
  (`users.clerk_user_id NOT NULL + UNIQUE`) and resolve identities from that
  unique index, instead of an application-level query.
- Provision application users lazily on the **first authenticated request**
  (`INSERT … ON CONFLICT (clerk_user_id) DO NOTHING`, ADR-014).
- Enforce "one active ride per passenger" with a **partial unique index**
  (`ride_requests_one_active_per_passenger`, migration 0006) that the service
  maps to `409 ACTIVE_RIDE_EXISTS` — the DB is the arbiter even under two
  concurrent bookings.
- Poll status **only while the trip is non-terminal** and stop at
  COMPLETED/CANCELLED, instead of polling forever.
- During the driver-accept rework, the agent found and fixed a real bug: the
  "one accepted pool per driver" pre-check counted the pool being re-accepted,
  so idempotent re-accept self-refused — fixed by excluding that pool
  (`id <> :poolId`).

**Rejected or modified suggestions (and why):**

- Keeping an application-owned `sessions` table alongside Clerk — rejected:
  Clerk owns the session lifecycle (ADR-013); a second session store would
  reintroduce the manual-auth surface the decision removed (`sessions` was
  dropped in migration 0001).
- Clerk **webhooks** or **email-binding** to create users — rejected: no event
  system needed yet, and email-binding would let anyone self-assign a seeded
  identity (including, with a crafted email, a DRIVER). On-demand provisioning
  stayed.
- A cached `available_seats` counter with optimistic `UPDATE … WHERE
  available >= n` and retries — rejected: a counter is a second, desyncable
  source of truth. Occupancy is derived from ACTIVE `pool_members` under a
  `SELECT … FOR UPDATE`.
- A Redis lock/`SETNX` gate for the last-seat race — rejected: the MVP has one
  writer and one hot row; PostgreSQL transactions prove the claim in
  concurrent tests (no unnecessary Redis per AGENTS.md).
- The original accept design kept accept-as-confirmation with only a read-only
  pools list — rejected during review: the first-wins lobby story needs a real
  claim. Final design makes `accept` assign `driver_id`/`vehicle_id`/
  `accepted_at` under vehicle → count → pool-row locks.

## Demo video

> **Demo video: Coming soon.**

The PRD requires a final video (max 6 minutes, e.g. Loom) covering the
problem, architecture/ERD, engineering decisions, a product tour (passenger +
driver + pooling + fares + status), one interesting edge case, and deployment
if available. This README section will be updated with the link when the video
is recorded.

## Deployment

**Not deployed yet.** The sections below describe the *planned* public demo
architecture and checklist; nothing is live. Replace `<VERCEL_URL>` and
`<RENDER_API_URL>` with the real hosts once the cloud resources exist.

### Planned deployment architecture (public demo, free tier)

```text
Browser → Vercel (Next.js, *.vercel.app)  →  Render (Fastify API)  →  Neon (PostgreSQL)
                    ↘ Clerk DEVELOPMENT instance (test keys, existing 7 demo users) ↙
```

> **This is a public testing/demo deployment, not a commercial production
> launch.** The existing Clerk **Development** instance is retained — no
> Production instance is created, cloned, or promoted, and `pk_test_…` /
> `sk_test_…` keys are used as-is. Clerk's Development banner is expected and
> acceptable. The free `*.vercel.app` domain is used (no custom domain). The
> trade-offs of this choice are recorded in [ADR-009](docs/decisions.md).
> The full plan is [docs/deployment-plan.md](docs/deployment-plan.md).

### Deployment checklist

**Frontend (Vercel):**
- Root Directory `apps/web`, Build `npm run build`, Node 24. Do **not** set
  `output: "standalone"` (that is only for self-hosted Docker).
- Build-time env: `NEXT_PUBLIC_API_URL` = `https://<RENDER_API_URL>`,
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (existing `pk_test_…`),
  `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `_SIGN_UP_URL` and the three
  `_FALLBACK_REDIRECT_URL` vars (all origin-relative).
- Server env: `CLERK_SECRET_KEY` (existing `sk_test_…`) for middleware/SSR.
- Never set `DATABASE_URL` on Vercel — the frontend never queries Postgres.

**Backend (Render):**
- Node, Root Directory *(blank)*, Build
  `npm ci && npm run build -w @dhaka-tesla-pool/api`, Start
  `node apps/api/dist/server.js`, **Health Check Path `/health`**.
- Set `NODE_ENV=production`, `DATABASE_URL` (Neon direct), `CLERK_SECRET_KEY`,
  `CLERK_PUBLISHABLE_KEY`, `CLERK_AUTHORIZED_PARTIES` = `https://<VERCEL_URL>`,
  `WEB_URL` = `https://<VERCEL_URL>`, `API_HOST=0.0.0.0`.
- **Do not set `API_PORT`.** Render injects `PORT` and the API honours it when
  `API_PORT` is absent (`apps/api/src/config.ts`).
- Do **not** add `npm test` to the build command: the test helper drops/creates
  a `_test` database.

**Database (Neon):**
- Free PostgreSQL **16** project, **direct** (non-`-pooler`) connection string.
- Run migrations and seed, then map the **existing Clerk Development** user IDs
  into the seeded rows with `apps/api/scripts/map-cast-clerk-ids.sql` (roles and
  vehicle ownership are preserved; only `clerk_user_id` is updated). Do this
  **before** any demo account signs in.
- `db:migrate` / `db:seed` do not load `.env`; export `DATABASE_URL` in the shell.

**Clerk (existing Development instance):**
- Add `https://<VERCEL_URL>` to the instance's **allowed origins** (keep
  `http://localhost:3000` for local dev). No redirect-URL entries are needed —
  `/sign-in` and `/sign-up` are same-origin relative paths.
- Public sign-up is enabled; **Sign-up with username** and **Require username**
  are enabled (the API provisions `users.name` from the Clerk username). New
  public users become **PASSENGER**. **Driver registration is intentionally
  unavailable** — driver testing uses the 4 demo driver accounts.

**Verification:**
- `GET <RENDER_API_URL>/health` returns ok; `GET <RENDER_API_URL>/` 404s.
- `GET <RENDER_API_URL>/api/zones` returns the 8 zones (real DB round-trip);
  `/api/me` without a token returns 401.
- Sign-in/sign-up round-trip works from the deployed web origin; no CORS errors.
- One end-to-end passenger + driver story plays against the deployed stack.

## PRD traceability

The PRD submission requirements map to the repository as follows
(`docs/reference/PRD.pdf` is the source of truth; `docs/requirements.md` is the
interpretation):

| PRD submission item | Status | Where it lives |
|---|---|---|
| Working MVP (passenger + driver + pooling + fares) | ✅ complete | this README, `apps/*`, tests |
| Docker / reproducible run | ✅ complete | `docker-compose.yml` + [Docker setup](#docker-setup) |
| `.env.example` | ✅ complete | [`.env.example`](.env.example) |
| Migrations | ✅ complete | `apps/api/drizzle/` 0000–0007 |
| Seed / demo data | ✅ complete | `apps/api/src/db/seed.ts` (canonical cast) |
| Architecture diagram | ✅ complete | [Architecture](#architecture) + `docs/architecture.md` |
| ERD | ✅ complete | [Database / ERD](#database--erd) + `docs/database.md` |
| Meaningful Git history | ✅ complete | `master` (feature-branch workflow, conventional commits) |
| Testing | ✅ complete | 182 API + 128 web tests; six required behaviors covered |
| README | ✅ complete | this file |
| AI usage | ✅ complete | [AI usage](#ai-usage) |
| Six-minute video | ⏳ pending | [Demo video](#demo-video) |
| Deployment | ⏳ planned (public demo, Clerk Development) | [Deployment](#deployment) + [docs/deployment-plan.md](docs/deployment-plan.md) |
| Concurrency explanation | ✅ complete | [Pooling and concurrency](#pooling-and-concurrency) |
| Engineering decisions | ✅ complete | [Key engineering decisions](#key-engineering-decisions) + ADRs |
| Known limitations | ✅ complete | [Known limitations](#known-limitations) |

## Documentation

- PRD (primary source of truth): [`docs/reference/PRD.pdf`](docs/reference/PRD.pdf)
- Requirements interpretation: [`docs/requirements.md`](docs/requirements.md)
- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Database design & concurrency strategy: [`docs/database.md`](docs/database.md)
- Decision record (ADRs): [`docs/decisions.md`](docs/decisions.md)
- Phased development plan: [`docs/development-plan.md`](docs/development-plan.md)
- Future scaling plan (PRD bonus "If Oi Tesla Goes Viral"): [`docs/scaling-plan.md`](docs/scaling-plan.md)
- Frontend design specification: [`docs/frontend-design.md`](docs/frontend-design.md)
- Screenshots: [`docs/Screenshots/`](docs/Screenshots)

## License

`UNLICENSED` — private project (see root `package.json`). No license grants
are implied.