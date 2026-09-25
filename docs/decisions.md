# Decisions — ADR-Style Record

> Record of technology decisions for the Dhaka Tesla Pool MVP, in
> ADR-like format. Each entry states the decision, realistic alternatives,
> why it was chosen, trade-offs, and when we might switch.
>
> **Status note:** These are the *current proposed* choices. They are not
> immutable requirements. Nothing here is "final until validated"; a change
> requires a documented, PRD-specific reason and an update to this file.

---

## ADR-001: Next.js (App Router) for the frontend

- **Decision:** Next.js with the App Router, TypeScript, Tailwind CSS,
  shadcn/ui, TanStack Query, React Hook Form, Zod.
- **Alternatives:** Plain React + Vite + React Router.
- **Why now:** The PRD *recommends* Next.js App Router for routing/SSR and
  allows plain React. App Router gives clean file-based routing, server/client
  component boundaries, and fits the Vercel free-tier deploy target. One app,
  familiar conventions.
- **Trade-offs:** Heavier build concepts (server vs client), slightly more
  framework-specific behavior to learn. Latency between client and API is the
  same as plain React for our SPA-like flows.
- **Switch later if:** We find PRD-specific damage from Next's opinionation, or
  the deployment target changes and plain React is materially simpler.

## ADR-002: Fastify for the Node.js backend

- **Decision:** Node.js + TypeScript + Fastify, REST.
- **Alternatives:** Express, NestJS, Hono.
- **Why now:** Fastify is a fast, lightweight, well-typed HTTP framework with
  first-class schema (Zod via `@fastify/type-provider-zod`) and plugin system
  that suits a modular monolith. Express is fine but slower and less structured;
  NestJS is heavier (DI, decorators) than the MVP needs.
- **Trade-offs:** Smaller community than Express; plugin ecosystem narrower.
  Fastify's serialization/schema model nudges us toward explicit contracts,
  which we want.
- **Switch later if:** We need a full framework's batteries (e.g., NestJS
  modules) or team familiarity with Express becomes a decisive factor.

## ADR-003: REST over GraphQL

- **Decision:** Plain JSON REST with versioned, well-defined resources.
- **Alternatives:** GraphQL (Apollo); tRPC.
- **Why now:** The API surface is small and stable (auth, rides, pools, fares).
  REST is debuggable with curl, cache-friendly, and lets us document endpoints
  tersely. GraphQL adds query-planning and client-cache machinery the MVP does
  not need.
- **Trade-offs:** Over-fetching/under-fetching in principle; but with small,
  purpose-built endpoints this is negligible for us.
- **Switch later if:** Client data needs explode and per-route DTO churn outgrows
  what REST documents cleanly.

## ADR-004: PostgreSQL over MySQL/SQLite

- **Decision:** PostgreSQL (via Docker locally and Neon free tier later).
- **Alternatives:** MySQL, MariaDB, SQLite.
- **Why now:** PRD recommends a relational store; pooling + capacity + state +
  history is a relational problem. Postgres gives: `SELECT … FOR UPDATE`
  row-locking for the seat-claim concurrency case, check constraints, rich
  types, and Neon/Render free-tier hosting. SQLite can't model the same
  concurrency guarantees across processes; MySQL is fine but the tooling and
  locking story we want is cleanest in Postgres.
- **Trade-offs:** PostgreSQL must be run (Docker/Neon) rather than embedded;
  slightly more operational surface than SQLite.
- **Switch later if:** An operational reason (e.g., managed-service availability,
  licensing) outweighs the concurrency features.

## ADR-005: Drizzle ORM over Prisma

- **Decision:** Drizzle ORM (TypeScript, SQL-like, with migrations).
- **Alternatives:** Prisma, Kysely, raw `pg`.
- **Why now:** Drizzle is lightweight, declarative, and gives typed schema +
  queries without Prisma's client generation weight; plays well with
  transactions and raw SQL for `FOR UPDATE` locking. Keeps us close to SQL so
  every generated query is explainable.
- **Trade-offs:** Younger ecosystem than Prisma; fewer conveniences (no fancy
  client cache); migrations tooling is terse.
- **Switch later if:** Drizzle's DX blocks us, or we want Prisma's
  factories/seed ergonomics badly enough to accept its weight.

## ADR-006: Application-owned auth (cookies + Argon2id) — SUPERSEDED

- **Status:** Replaced by **ADR-013 (Clerk authentication)**. Kept here to
  record that the manual auth path was fully considered and why it lost.
- **Decision (original):** Our own session auth: Argon2id password hashes,
  random opaque session tokens stored in DB, `HttpOnly` `SameSite=Lax` cookies,
  role-based authorization (passenger/driver).
- **Alternatives considered:** Auth0/Clerk/Supabase Auth (external), JWT
  stateless.
- **Why now (original):** PRD asks us to *design auth ourselves* and justify the
  choice; the surface (email + password + role) is small. Server-side sessions
  are trivially revocable and keep password/session policy in our control, with
  no third-party dependency. Argon2id is the OWASP-recommended hash.
- **Why superseded / trade-offs:** We own security; we must get CSRF/cookie
  flags right; and email/password asks users to trust an MVP with credentials
  for zero product value. The PRD also lists "social login" and "session
  management *by a third-party identity provider*" as acceptable auth
  mechanisms. See ADR-013 for the full comparison.

## ADR-007: Leaflet + OpenStreetMap over Google Maps/Mapbox

- **Decision:** Leaflet on OpenStreetMap tiles for map visualization.
- **Alternatives:** Google Maps JS, Mapbox GL.
- **Why now:** PRD says *don't fight map APIs*; predefined zones + lat/long
  points. Leaflet + OSM is free, no API key, license-friendly, and fully
  visualization-only. Google/Mapbox need keys, quotas, and payment risk.
- **Trade-offs:** OSM tiles/UX are plainer; no turn-by-turn (we don't need it).
- **Switch later if:** We need paid-grade geocoding/routing/real-time traffic at
  scale.

## ADR-008: Docker + Docker Compose

- **Decision:** Docker and Docker Compose for local/portable run
  (`docker compose up`), final PRD requirement.
- **Alternatives:** Local-only processes, Vagrant.
- **Why now:** PRD *mandates* `docker compose up` runs the app + DB with
  migrations and seed data. Compose is the standard, lowest-friction way.
- **Trade-offs:** Docker Desktop is required locally (see environment findings);
  adds an infrastructure prerequisite.
- **Switch later if:** The mandated requirement is satisfied another
  reproducible way and Docker stops working for the team.

## ADR-009: Deployment strategy (free-tier only)

- **Decision:** Vercel (Next.js) → Render (Fastify API) → Neon (PostgreSQL),
  all free tiers; fallback to a reproducible Docker deployment if a free
  backend host is unavailable.
- **Alternatives:** Railway free tier, Fly.io, raw VPS (DigitalOcean droplets —
  not free), self-hosting.
- **Why now:** PRD: *free/free-tier only, do not pay; public deployment
  preferred.* These three fit the chosen stack with zero cost.
- **Trade-offs:** Free tiers sleep/cold-start; Neon free tier has compute
  limits; Render free instances spin down on idle.
- **Switch later if:** Free tiers become paid-only or reliability demands
  endurance servers (then code is unchanged; only hosting changes).

## ADR-010: Monorepo with npm workspaces

- **Decision:** Single repo; `apps/web` (Next.js) + `apps/api` (Fastify) under
  npm workspaces; shared config on a per-app basis (no forced code sharing yet).
- **Alternatives:** Two repos; Turborepo; pnpm workspaces; single app with BFF.
- **Why now:** One repo, one git history (PRD inspects history), one PRD story.
  npm workspaces suffice without extra orchestration (no Turborepo needed for
  two apps). Keeps "modular monolith" honest.
- **Trade-offs:** Root vs per-app dependency discipline; Node/npm workspace
  quirks (hoisting). No forced shared code package yet — avoid premature
  extraction.
- **Switch later if:** The build graph grows and we need a message-passing /
  caching tool (then Turborepo or move package manager), or apps really must
  diverge repositories.

## ADR-011: Version pinning for the Phase 1 toolchain (additions)

Decisions made while scaffolding the API/web workspaces. Supersedes none of the
above; documents *which version lines* were chosen and why.

- **TypeScript ^5.9** over TypeScript 7 (`tsgo`): TS 7 is the brand-new native
  compiler; its ecosystem/tooling support is still settling. 5.9 is fully
  supported by eslint plugins, tsx, drizzle-kit, and vitest. Upgrade TS 7 is a
  tracked later-phase task.
- **ESLint ^9 (flat config)** over ESLint 10: the 9.x maintenance line pairs
  cleanly with `typescript-eslint` 8 and `eslint-config-next` 15. ESLint 10 is
  new; upgrade later in one coordinated change.
- **Next.js 15.5.x + React 19** over Next 16: 15.5 is the maintained 15 line
  (dist-tag `backport`). Next 16's breaking changes (e.g., `next lint`
  removal, ESLint-10 pairing) are deliberately deferred so app scaffolding
  stays boring and explainable.
- **Vitest ^4** over Vitest 5: 4.x is well documented and stable; upgrade is a
  low-risk later change.
- **postgres.js (`postgres` pkg) as the Drizzle driver** over `pg`: promise-
  based, typed, lazy-connecting (API boots without DB), no separate @types
  package. `pg` is the alternative if connection-pool tuning demands it.
- **Node 24-alpine base images** to match the local dev runtime (Node 24);
  engines are `>=20`. Container base image is revisited at deployment.
- **PostCSS pin via root `overrides`** (`^8.5.28`): Next 15.5 declares a
  vulnerable `postcss@8.4.31`; the override surfaces a patched 8.5.x without
  moving to Next 16. API-compatible for Next's CSS pipeline (verified by
  `next build`).
- **Accepted risk:** `drizzle-kit` transitively pulls `@esbuild-kit/esm-loader`
  → esbuild < 0.24.3 (dev-time only, `npm audit` moderate). `npm audit fix
  --force` would downgrade drizzle-kit (breaking), so the risk is accepted and
  re-evaluated as tooling moves on.

## ADR-012: Phase 2 — database schema decisions

Decisions made while designing the implemented schema (`apps/api/src/db/schema.ts`
and `apps/api/drizzle/0000_*.sql`). Recorded so every table/constraint is
explainable; `docs/database.md` mirrors this in prose.

- **UUID PKs via `gen_random_uuid()`** over serial/BIGSERIAL: opaque
  identifiers never leak row counts or insertion order; PG >= 13 has the
  function built-in (no pgcrypto extension). Drizzle's `defaultRandom()` maps
  to it.
- **PostgreSQL-native enums** over `text` + app-level validation: invalid
  states are rejected by the DB itself and the lifecycle reads plainly in SQL.
  Cost: adding a value later requires `ALTER TYPE ... ADD VALUE` (migration),
  which is fine at this scale.
- **"MATCHED/ACCEPTED" → single enum value `MATCHED`**: the PRD's slash is one
  state; one name keeps history unambiguous (see `docs/database.md` §5.2).
- **`pool_members` is the membership source of truth; `ride_requests.pool_id`
  is a denormalized convenience** for passenger status views. Preserves history
  (a request can tell its whole pooling story from membership rows) while
  keeping the common reads cheap. App keeps them consistent.
- **No cached `available_seats` counter** — occupancy is always
  `SUM(seats) WHERE status = 'ACTIVE'` over `pool_members`. Avoids
  cache-counter divergence entirely; the concurrency phase adds `FOR UPDATE`
  + the derived sum inside one transaction (`docs/database.md` §7).
- **`pools.capacity_snapshot`** denormalizes vehicle capacity at creation so
  history survives vehicle reconfiguration. `docs/requirements.md` §21.I.
- **Two partial unique indexes** — `pools_single_active_per_vehicle` (one
  active pool per Tesla) and `pool_members_one_active_per_request` (one active
  membership per request): these are capacity/concurrency invariants the DB can
  express cheaply and must own.
- **Delete policy: RESTRICT for the ride domain, CASCADE for user
  infrastructure** (`sessions`, `vehicles`). Ride history is not deletable
  (`docs/requirements.md` §21.I); sessions/vehicles are disposable with their
  user. See `docs/database.md` §5.7.
- **Enforced fare formula as a CHECK** (`final = base + distance − discount`,
  all non-negative): stored history can never contradict the documented model.
  The *computation* is still a later phase — this only guards stored values.
- **One final fare per request (`UNIQUE ride_request_id`)**: matches the
  PRD's "each passenger gets an individual fare" snapshot model.
- **Lowercase-only email CHECK + unique index** instead of `citext`/functional
  index: no extension, one obvious convention, app normalizes on write.
- **Timestamp semantics as CHECKs** (e.g. `COMPLETED ⇔ completed_at IS NOT
  NULL`, pool can't complete without starting): impossible values rejected at
  the boundary, not silently normalized.
- **No generic audit table**: `ride_status_history` + fare snapshots already
  make every ride explainable; a second journal has no consumer (`docs/database.md` §5.9).
- **Deterministic seed IDs + idempotent `ON CONFLICT DO NOTHING`**: stable
  UUIDs for Jashim/Bullet/zones keep tests and demos reproducible; reseeding is
  a no-op. Seeded users carry a reserved `clerk_user_id` placeholder
  (`dev-only::seed::<email>`); real Clerk IDs (`user_…`) can never collide, and
  the auth resolver rejects reserved IDs outright (see ADR-013).
- **Migration files are generated, reviewed, committed unmodified.** No manual
  SQL edits without a documented reason.

**What is deliberately app-enforced (documented, not DB triggers):** driver-only
vehicle ownership, pool driver = vehicle driver, occupancy vs capacity (multi-row
transaction), and state-transition legality (state machine). Rationale:
CHECK constraints can't reference other tables, and triggers would duplicate the
service logic the PRD asks us to own — see `docs/database.md` §5.10 and §7.

## ADR-013: Clerk for authentication (Phase 3)

- **Status:** Supersedes **ADR-006**. Implemented in `apps/api/src/auth/`,
  `apps/web` (`@clerk/nextjs`, `middleware.ts`), migration 0001/0002, and
  `test/auth.test.ts`.
- **Decision:** Use **Clerk** as the identity provider. The application owns
  *authorization*: the role and active flag live in PostgreSQL
  (`users.role`), resolved per request from the verified Clerk identity via
  `users.clerk_user_id`. There is **no** application password store, no
  application session table, and no manual Argon2id/cookie implementation.
- **How identity flows (bearer tokens, not browser cookies at the API):**
  `Browser (Next.js, ClerkProvider) → Clerk (authenticates the user) → the web
  app sends the Clerk session token as `Authorization: Bearer <token>` →
  Fastify verifies it with `@clerk/backend` `authenticateRequest()` →
  `users.clerk_user_id` lookup → `request.auth.user` for role-based
  authorization. The API never trusts a `userId`/`role` from a request body —
  identity always derives from the verified token.
- **Alternatives:**
  1. **ADR-006 manual auth** (Argon2id + DB sessions + cookies): zero external
     dependency, full control, trivially revocable. Costs: we own password,
     session, CSRF, and cookie security for an MVP; email/password friction for
     a demo product whose PRD explicitly permits third-party session
     management and social login.
  2. **Auth0 / Supabase Auth / Firebase Auth**: same category as Clerk with no
     decisive win for this MVP (Clerk's Next.js + `@clerk/backend` story is the
     most direct fit for the chosen stack).
  3. **Stateless JWT (manual)**: avoids sessions but reintroduces revocation
     complexity and key management with none of Clerk's UI/session handling.
- **Why Clerk:** the PRD *requires us to consider* third-party auth and session
  management and to document the outcome; Clerk eliminates the highest-risk
  security surface (credential storage, session lifecycle, CSRF) while keeping
  authorization fully application-owned in PostgreSQL. The provider-agnostic
  injection boundary (`SessionVerifier` / `LocalUserResolver` in
  `src/auth/identity.ts`) keeps the auth flow testable without a network and
  swappable later. `npm audit`: 0 vulnerabilities introduced.
- **Trade-offs / recorded risks:** vendor dependency and dev-mode instance
  quirks; free tier has limits (Clerk free tier includes 10k MAU — fine for an
  MVP; revisit at scale). Server-side revocation of a Clerk session depends on
  Clerk's session lifecycle (acceptable: `authenticateRequest` re-validates
  every request). **Roles stay in PostgreSQL by design** — Clerk is an identity
  provider; *what* a user may do in the product is application policy, and
  keeping it here keeps the DB the source of truth and avoids role sync.
- **Why the seed uses reserved placeholders:** we never invent a real Clerk ID
  (would assume an identity that does not exist). Seeded characters get a
  reserved `dev-only::seed::<email>` value, which `isReservedClerkUserId()`
  rejects during auth and which cannot collide with real `user_…` IDs. Mapping
  a real Clerk user to a seeded character is a documented owner step (README).
- **Migration note (0001/0002, dev):** `clerk_user_id` is NOT NULL, so the
  upgrade path for an existing populated database is: recreate, then migrate,
  then seed (documented in README); the CI/test path always builds a fresh
  `_test` database.
- **Switch later if:** the product needs self-hosted identity, costs exceed
  budget, or we want full auth in-house — ADR-006's design remains the
  documented fallback.
## ADR-014: First-request user provisioning (Phase 3.5)

- **Status:** Implemented in `apps/api/src/auth/provision.ts`,
  `user-resolver.ts` (`upsertLocalUser`), `install.ts`, and covered in
  `test/auth.test.ts` + `test/database.test.ts`. Complements ADR-013.
- **Decision:** When a **verified** Clerk identity has no local application
  user (no `users.clerk_user_id` match), provision one atomically **on the
  first authenticated request** instead of requiring a manual mapping step.
  The Clerk profile is loaded **server-side** through the existing Clerk
  backend client (`getClerkClient().users.getUser`), and the application
  user is created from it:

  ```
  Clerk user ID     -> users.clerk_user_id   (identity key; never the username)
  Clerk username    -> users.name            (display value only)
  Clerk primary email -> users.email         (lowercased)
  new users         -> role PASSENGER, active true
  ```

  `DRIVER`/`ADMIN` stay database-only assignments; provisioning can never
  self-assign a privileged role.
- **Why on first request (not webhooks):** there is no external signup
  pipeline here for a webhook to wait on, no event bus to go stale, and no
  way for the API to fall behind a user who signs up and immediately hits the
  API. The user row materializes transactionally at the moment it is actually
  needed. The MVP has one synchronous request path and a single PostgreSQL
  writer; a webhook adds infrastructure without adding correctness.
- **Why not "bind seed email on signup":** auto-binding a Clerk account to a
  seeded character by *email* would let anyone self-assign a seeded identity
  (and with a specially chosen email, a DRIVER role). Provisioning creates
  NEW rows only; mapping a demo character to a real Clerk ID remains an
  explicit `users` UPDATE.
- **Concurrency & idempotency (required):** the write relies on the
  `users_clerk_user_id` unique index with
  `INSERT ... ON CONFLICT (clerk_user_id) DO NOTHING RETURNING`. Two
  concurrent first requests for the same identity yield **exactly one** row;
  the loser's empty `RETURNING` re-reads the winner. No explicit transaction
  or `SELECT FOR UPDATE` is needed - the single INSERT is the one atomic
  commit.
- **Email uniqueness (`users_email_unique`):** if the new identity's email
  belongs to another user, the INSERT hits a *different* unique constraint and
  aborts with `AUTH_PROVISION_FAILED` (500). Provisioning never rebinds or
  overwrites an existing row.
- **Failure semantics:** any provisioning failure (Clerk profile load, missing
  username/email, email conflict, lost race) surfaces as `AUTH_PROVISION_FAILED`
  (500) with **no partial row**; the request fails closed. Reserved
  `dev-only::seed::` placeholders are never provisioned (installation rejects
  them before provisioning; `upsertLocalUser` also guards). `AUTH_USER_NOT_FOUND`
  remains only as a defensive backstop for a provisionLocalUser that
  explicitly returns null.
- **Alternatives rejected:** Clerk/svix webhooks (event system + delivery
  retries, no consumer need yet, adds latency/ops surface); email-binding of
  seed rows (self-assignment/privilege escalation, above); provisioning via
  the management API on signup from Next.js (client-visible profile handling,
  split-brain between web and API). These remain documented fallbacks if
  signup-time hooks are ever required at larger scale.
- **Testability:** provisioning is the third injectable boundary
  (`AuthDependencies.provisionLocalUser`, `identity.ts`), so the auth suite
  tests behavior without Clerk or a network; the database suite injects the
  disposable `_test` database through `createUserResolver` to test the real
  upsert, race, email-conflict, and reserved-id paths against the schema.

## ADR-015: Ride requests, fare estimation, and idempotency (Phase 4)

- **Status:** Implemented in `apps/api/src/fare/`, `apps/api/src/rides/`,
  migration 0003, and covered in `test/fare.test.ts` + `test/rides.test.ts`.
- **Decision:** passengers create a ride request and receive its **initial
  estimated fare** together, computed deterministically from zone coordinates.
  No routing service is used — the MVP geography is predefined Dhaka zones with
  plain lat/long points (ADR-007).
- **Fare model (per seat, integer paisa — never floating point):**

  ```
  distanceKm          = haversine(pickup, destination)              // R = 6371 km
  roadKm              = distanceKm × 1.3                            // 2.4/twist factor, §21.H
  distanceChargePaisa = roundHalfUp(roadKm × 1200)                  // 12 BDT/km
  baseFarePaisa       = 3000                                        // 30 BDT flat
  poolDiscountPaisa   = 0 for a new (REQUESTED) ride                // pooling, later phase
  finalFarePaisa      = baseFare + distanceCharge − poolDiscount    // never rounded independently
  estimatedTotal      = finalFarePaisa × requestedSeats             // the API total
  ```

  Stored components in `fares` are **per seat** (K5); the total a passenger
  pays is derived in the API response. Rounding is deterministic
  **round-half-up** (K6) — banker's rounding only differs at exact .5
  boundaries and half-up is simpler to pin in tests. The database CHECK
  `final = base + distance − discount` is satisfied by construction because
  the final is derived, never independently rounded.
- **Fare row semantics (estimate now, final later):** the `fares` row is the
  *current applied fare snapshot*. At creation it holds the initial estimate
  with `pool_discount_paisa = 0`. When the request later joins a pool (pooling
  phase), the pool discount is computed and the **same row is updated in
  place** — one fare per request stays true, and this is a lifecycle recompute,
  not a reaction to parameter drift, so history-immutability (requirements
  §21.I) is preserved. No schema change was needed for this.
- **Worked examples (pinned in tests, from seed coordinates):**
  `Banani → Mohakhali` = **5932 paisa** (BDT 59.32, Nusrat);
  `Banani → Gulshan 1` = **4140 paisa** (BDT 41.40, Rafiq).
- **Atomicity:** ride request + fare + the initial status-history journal entry
  (`NULL → REQUESTED`, requirements §4) commit in **one PostgreSQL
  transaction** (`createRideRequest` in `src/rides/service.ts`). A ride can
  never exist without its fare or vice-versa; the test suite proves the
  rollback by injecting a failing fare computation after the ride insert.
  A REQUESTED ride holds **no seats** and has no pool, so no concurrency
  locking is needed in this phase — seat-claim concurrency belongs to the
  pooling phase (database.md §7).
- **Idempotency (K2):** an **optional** client-generated
  `client_request_id` lets a passenger retry "create ride" safely. At most one
  ride per `(passenger, client_request_id)` via a partial unique index
  (migration 0003). A retry with the same key replays the existing ride
  (HTTP 200 vs 201), including a concurrent race — the loser's INSERT hits the
  unique index, rolls back, and re-reads the winner. **No broader idempotency
  framework** was built; requests WITHOUT a key may create a new ride on a
  repeated submission — documented MVP behavior.
- **Validation (K1):** added **Zod** (aligned with the AGENTS.md proposed
  stack) for request-body and params validation on the API. Unknown body keys
  are rejected (`.strict()`) so a client cannot smuggle
  `passengerId`/`role`/`name`/`email` — identity always comes from the
  verified session (ADR-013/014). The error envelope gains an **additive**
  `details` array: `{ error: { code, message, details? } }`; all existing
  `{ code, message }` consumers are unaffected.
- **Zone ids are form values (K8):** an unknown zone id is a validation error
  (400 `VALIDATION_ERROR`, not 404) because the client must pick from the
  `GET /api/zones` list. A ride id that does not exist — or belongs to someone
  else — is a single 404 `NOT_FOUND` so observers cannot distinguish.
- **Authorization (K7):** Phase 4 ride-request and ride-read endpoints are
  **PASSENGER-only** (`requireRole(["PASSENGER"])`); DRIVER/ADMIN management of
  rides/pools is later-phase work. `GET /api/zones` requires a session (any
  role). CORS now permits `POST` for the future web form.
- **Alternatives rejected:** persisting the estimate only at pooling time
  (breaks "ride and fare are atomic" and the always-explainable fare);
  a separate estimate/final fare table or `is_final` flag (schema churn with no
  MVP gain); a full idempotency-key framework (keys on rides are the only
  retry-prone write today); storing total instead of per-seat components
  (would contradict the per-seat fare model, §21.K).

## ADR-016: Deterministic pool matching + lifecycle (Phase 5)

- **Status:** Implemented in `apps/api/src/matching/rules.ts` (pure rule),
  `apps/api/src/rides/state.ts` (state machine), `src/rides/pooling/service.ts`
  (orchestration), `POST /api/rides/:rideId/cancel`; migration 0004; covered in
  `test/matching.test.ts`, `test/state.test.ts`, `test/pooling.test.ts`.
- **Decision:** a single, fully deterministic matching rule resolves *all*
  pooling decisions, and the pool lifecycle is the explicit PRD state machine.
- **Matching rule (realizes requirements.md §5, §21.A):**
  1. Same `pickup_zone_id`.
  2. All-pairs drop-off spread ≤ **`POOL_DEST_SPREAD_KM` = 2.0 km** (max
     pairwise haversine distance among the candidate's and every ACTIVE
     member's destination point). Nusrat + Rafiq match (≈1.906 km); a Dhanmondi
     drop-off does not (≈4.6 km from the pool).
  3. `occupiedSeats + requestedSeats ≤ capacity_snapshot` (occupancy is derived
     from ACTIVE memberships — no cached counter).
  Pool choice among eligible candidates: **fullest first** (`occupiedSeats
  DESC`, then `created_at ASC`, then `id ASC`). An existing eligible pool always
  beats creating a new one; the new-pool Tesla pick is also deterministic
  (`name ASC, id ASC`, online + active driver + no non-terminal pool). Two
  concurrent first-seat requests therefore converge on the **same** pool.
- **Why no driver "accept" in Phase 5:** the PRD lets us improve if explainable
  (requirements.md §4). Making matching part of create-ride keeps the very
  first transaction atomic (ride + fare + history + membership), avoids a
  separate accept endpoint with unhandled pending state, and makes the required
  concurrency scenario testable without a driver UI. `DRIVER_ARRIVED`/accept
  semantics arrive with the driver phase and are already declared in the state
  map (ADR-017/state.ts).
- **State machine:** `RIDE_STATE_TRANSITIONS` is the single source of truth;
  `canTransition` rejects every invalid move and the service raises
  `409 INVALID_STATE_TRANSITION` instead of writing a bad row. A REQUESTED→
  MATCHED journal row is written at match time, NULL→REQUESTED at creation.
- **Cancellation (realizes §21.B):** passenger cancels only their own ride
  (not-the-owner = the same 404 as "does not exist"); legal while REQUESTED or
  MATCHED; MATCHED cancels flip the membership to `LEFT` (kept as history with
  `left_at`), recompute remaining fares, and cancel an emptied pool. No
  `cancel_reason` column — the PRD asks only for "cancel while valid". Forced
  cancellation (driver/admin service path, `forceCancelRide`) adds a full refund
  (ADR-017).
- **Alternatives rejected:** zone-prefix/route-overlap rules (opaque, not
  hand-checkable); driver-accept-before-hold (pending-state handling with no UI
  consumer in Phase 5); closest-first or random Tesla selection (non-determinism
  makes the required one-pool race flaky and the story unexplainable).
- **Switch later if:** real routing/geo becomes available (then the spread rule
  becomes a detour/time rule), or a driver-accept step becomes product-required
  (then automatch becomes "reserve while pending" — a separate hold state gains
  concurrency requirements that the current design deliberately avoids).

## ADR-017: Seat-claim transaction: `FOR UPDATE` + derived occupancy (Phase 5)

- **Status:** Implemented in `apps/api/src/rides/pooling/service.ts` +
  `pooling/fare.ts`; exercised by `test/pooling.test.ts` **including two
  concurrent last-seat claims** and the `ON CONFLICT DO NOTHING` first-pool
  race.
- **Decision:** Bullet's capacity is protected by a database-backed transactional
  claim — **no Redis, no mutexes, no queues, no distributed machinery**:
  - Occupancy is always **derived**: `SUM(seats) WHERE status = 'ACTIVE'` over
    `pool_members` (ADR-012). There is no cached available-seats counter to
    desync, so two readers can each see "one seat left" — the *claim*, not the
    read, is what must be safe.
  - A claim **`SELECT … FOR UPDATE` the pool row**, then re-derives occupancy
    under that lock and only joins when `occupied + seats ≤ capacity_snapshot`.
    The pool row is the single serialization point for a Tesla, which is correct
    because `pools_single_active_per_vehicle` guarantees at most one active pool
    per vehicle.
  - Pool **creation** uses `INSERT … ON CONFLICT DO NOTHING RETURNING` against
    that partial unique index. This is the subtle bit: a plain second INSERT on
    the same Tesla would abort the whole transaction with SQLSTATE 23505. With
    DO NOTHING the racing INSERT **waits** for the winner (committed or aborted)
    and then skips with an EMPTY result while our transaction stays alive — and
    because the winner's commit is a full statement-level snapshot (READ
    COMMITTED), a single re-scan deterministically finds the winner's pool to
    join. Bounded re-evaluation exactly once, then stop.
  - **Lock ordering (deadlock-free):** every transaction that writes both a ride
    row and a pool row acquires the RIDE row lock first, then the POOL row lock
    second. Matches already hold their ride lock from the create-INSERT; cancels
    take the ride lock first in their `FOR UPDATE` select. Consistent order ⇒ no
    cycle possible between match, cancel, and force-cancel.
  - Rationale for no cache/queue: the MVP has one writer (Postgres) and the race
    is one row. A cache would *add* a second source of truth; a queue would add
    latency + ops for a synchronous request path. What changes at scale: shard or
    partition claim hot-spots per zone, or move the same serialization into a
    geospatial index + `FOR UPDATE SKIP LOCKED` reservation table; Redis remains
    unnecessary until cross-region coordination forces it (requirements.md §15).
- **In-place fare recompute:** a join/leave/force-cancel recomputes EVERY ACTIVE
  member's fare row in place (`pool_discount = roundHalfUp(25%·(base+distance))`
  when members ≥ 2 else 0; `final = base + distance − discount`). Stored base /
  distance are frozen; only derived values and `fares.updated_at` (migration
  0004) are rewritten. This is a lifecycle recompute, not parameter drift
  (requirements.md §21.I, ADR-015).
- **Forced cancellation = full refund:** `forceCancelRide(rideId)` (service
  only; no route yet) reuses the cancellation core and additionally writes the
  ride's fare to zero BY the discount term (`discount = base + distance`,
  `final = 0`) — every `fares` CHECK stays satisfied. Documented as the full
  refund semantics the PRD implies; a payment gateway would consume this
  differently (later phase).
- **Migration 0004 (additive only):** `fares.updated_at`, so a recompute is
  auditable. Nothing else changed — the schema already carried the lockable
  tables, the capacity snapshot, and the partial unique indexes (ADR-012).
- **Tests (beta of the required 6 behaviors):** `test/pooling.test.ts` covers
  capacity-never-exceeded (sequential + concurrent), invalid transitions
  rejected (409), pooled fares for Nusrat/Rafiq (4449/3105 paisa), ownership
  isolation (404), cancellation rules, atomic rollback when a join recompute
  throws, and two true concurrency races (last-seat claim; first-pool creation)
  from two independent database connections.
- **Alternatives rejected:** application-level mutex/lock (process-local, not
  safe across API instances); `INSERT … ON CONFLICT DO NOTHING` without the
  return-then-rescan step (silently leaves the loser REQUESTED forever); a
  cached `available_seats` column with optimistic update (would require retry
  loops and can still oversell); Redis locks (unnecessary infra, ADR-free
  violation of "do not decorate").
- **Switch later if:** a driver-accept step is added (claim becomes "reserve
  pending accept" — still the same pool-row lock, just a new state); or the
  system grows to many API instances with hot-zone contention worth sharding.

## ADR-018: Cancellation routes and forced-cancel (Phase 5 follow-up)

- **Status:** `POST /api/rides/{rideId}/cancel` implemented in
  `apps/api/src/rides/routes.ts` (`PASSENGER`-only, returns the post-cancel
  ride). Forced-cancel currently has **no HTTP route** — it exists as the
  documented service path (`pooling.forceCancelRide`) used by tests and future
  driver/admin endpoints (deliberately: no driver flow in Phase 5, and an
  unexposed capability cannot be misused).
- **Decision:** cancellation is a state-machine transition exposed as a plain
  POST resource action. A `cancel_reason` field was explicitly **not** added:
  the PRD requires only "cancel while valid"; adding speculative reason UX is
  decoration. If a driver/admin force-cancel UI appears, the refund + reason
  semantics extend this service without a schema change.
