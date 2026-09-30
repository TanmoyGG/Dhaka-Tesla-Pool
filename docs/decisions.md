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

> **Status: decided and executed.** `docker compose up` runs the full stack
> locally, and the public demo is live on all three free-tier hosts:
> <https://dhaka-tesla-pool-demo.vercel.app> (web) and
> <https://dhaka-tesla-pool-av68.onrender.com> (API, `/health` returns ok),
> backed by Neon PostgreSQL 18. The plan and platform configuration are
> documented in `docs/deployment-plan.md`.

- **Decision:** Vercel (Next.js) → Render (Fastify API) → Neon (PostgreSQL),
  all free tiers; fallback to a reproducible Docker deployment if a free
  backend host is unavailable.
- **Alternatives:** Railway free tier, Fly.io, raw VPS (DigitalOcean droplets -
  not free), self-hosting.
- **Why now:** PRD: *free/free-tier only, do not pay; public deployment
  preferred.* These three fit the chosen stack with zero cost.
- **Trade-offs:** Free tiers sleep/cold-start; Neon free tier has compute
  limits; Render free instances spin down on idle.
- **Switch later if:** Free tiers become paid-only or reliability demands
  endurance servers (then code is unchanged; only hosting changes).

## ADR-023: Public demo runs on the Clerk *Development* instance

> **Status: decided.** See ADR-009 for the hosting decision. This ADR records
> the deliberate choice to publish the demo **without** a Clerk Production
> instance.

- **Decision:** The public demo deployment reuses the **existing Clerk
  Development instance**, its existing 7 demo users, and its `pk_test_…` /
  `sk_test_…` keys. No Production instance is created, cloned, or promoted, and
  no custom domain is purchased — the free `*.vercel.app` hostname is used.
- **Why:** This is a **free public testing/demo project**, not a commercial
  launch. A Production instance would add cost and operational surface for no
  benefit to a reviewer. Clerk's Development banner is expected and acceptable.
  The demo needs no data protection beyond what the development instance
  already provides, and the demo accounts hold no personal or payment data.
- **Consequences:** Clerk shows a Development banner in the UI. Development
  instances carry vendor-side limits (e.g. MAU caps) and are not a
  durability guarantee: **resetting the instance would invalidate the 7 Clerk
  user IDs** and break sign-in. That failure mode is documented and cheap to
  recover from — re-run `apps/api/scripts/map-cast-clerk-ids.sql` with the new
  IDs (`docs/deployment-plan.md` §12, §19); no redeploy is needed.
- **Credentials in the open:** the landing page's "Credentials for Testing"
  modal displays the 3 passenger and 4 driver demo logins. This is intentional
  and accepted for a public demo, not an oversight.
- **Role model unchanged:** public sign-up is enabled, and the API provisions
  every new identity as **PASSENGER** (`apps/api/src/auth/user-resolver.ts`).
  **DRIVER/ADMIN remain database-only** — there is no public driver
  registration, so driver testing uses the demo driver accounts.
- **Sign-up requires a username:** the API derives `users.name` from the Clerk
  username and fails provisioning without one
  (`apps/api/src/auth/provision.ts`), so the Clerk instance has *Sign-up with
  username* and *Require username* enabled. This is a Clerk **configuration**
  requirement, not application code.
- **Switch later if:** the project becomes a real commercial deployment — create
  a Clerk Production instance, publish new user IDs, and update the same two
  `CLERK_*` values on Render and Vercel. No application code changes.

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
- **Partial unique index** — `pool_members_one_active_per_request` (one active
  membership per request): a capacity/concurrency invariant the DB can express
  cheaply and must own. (The companion `pools_single_active_per_vehicle` index
  was **dropped by migration 0007** — ADR-022 wait pools are unassigned until a
  driver accepts; the current per-accepted-pool invariants are
  `pools_single_accepted_per_driver` / `pools_single_accepted_per_vehicle`.)
- **Delete policy: RESTRICT for the ride domain, CASCADE for user
  infrastructure** (`vehicles`). Ride history is not deletable
  (`docs/requirements.md` §21.I); vehicles are disposable with their
  user. (`sessions` was deliberately dropped in migration 0001 — ADR-013.)
  See `docs/database.md` §5.7.
- **Enforced fare formula as a CHECK** (`final = base + distance − discount`,
  all non-negative): stored history can never contradict the documented model.
  The computation is implemented (ADR-015/017) — this CHECK guards *stored*
  values against drift.
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
  poolDiscountPaisa   = 0 for the initial (unpooled) estimate       // set on pool join (ADR-017)
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
  `Banani → Mohakhali` = **5332 paisa** (BDT 53.32, Nusrat);
  `Banani → Gulshan 1` = **5303 paisa** (BDT 53.03, Rafiq).
  (Pooled with the 25% discount: Nusrat **3999**, Rafiq **3977** — ADR-017.)
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
  **PASSENGER-only** (`requireRole(["PASSENGER"])`); driver management of
  rides/pools arrived with the Phase 6 driver flow (ADR-019/020/022).
  `GET /api/zones` requires a session (any role). CORS now permits `POST` for
  the web form.
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
      member's destination point). Nusrat + Rafiq match (≈1.103 km); a Dhanmondi
      drop-off does not (≈4.6 km from the pool).
  3. `occupiedSeats + requestedSeats ≤ capacity_snapshot` (occupancy is derived
     from ACTIVE memberships — no cached counter).
  Pool choice among eligible candidates: **fullest first** (`occupiedSeats
  DESC`, then `created_at ASC`, then `id ASC`). An existing eligible pool always
  beats creating a new one; the new-pool Tesla pick is also deterministic
  (`name ASC, id ASC`, online + active driver + no non-terminal pool). Two
  concurrent first-seat requests therefore converge on the **same** pool
  (*historically true in Phase 5: the `pools_single_active_per_vehicle` unique
  index serialized the two inserts onto one vehicle/pool. Migration 0007
  dropped that index, so under ADR-022 two simultaneous first-claims instead
  each open their own unassigned wait pool — see `pooling.test.ts` "creates
  SEPARATE wait pools for two concurrent first-claims (accepted tradeoff)"*).
- **Why no driver "accept" in Phase 5:** the PRD lets us improve if explainable
  (requirements.md §4). Making matching part of create-ride keeps the very
  first transaction atomic (ride + fare + history + membership), avoids a
  separate accept endpoint with unhandled pending state, and makes the required
  concurrency scenario testable without a driver UI. `DRIVER_ARRIVED`/accept
  semantics arrive with the driver phase and are already declared in the state
  map (ADR-017/state.ts). **Superseded by ADR-022:** the driver phase reworked
  system-assigned automatch into an explicit first-wins accept; see the
  "Behavior changes" list there.
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
  becomes a detour/time rule). The "driver-accept step becomes product-required"
  trigger has **already fired** and was resolved by ADR-022 (first-wins claim —
  not a hold state; automatch became the unassigned-wait-pool design it
  describes there).

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
    because the accepted-pool indexes (`pools_single_accepted_per_driver` /
    `pools_single_accepted_per_vehicle`, migration 0007) bound accept; before
    accept a wait pool is unassigned (ADR-022), so every join still funnels
    through the locked pool row.
  - Pool **creation** since ADR-022 uses a plain `INSERT … RETURNING` with **no
    conflict target** — an unmatched request always creates its **own
    unassigned wait pool** (wait pools reference no vehicle), so a second seat
    never races the same Tesla at creation. (The pre-ADR-022 bullet below
    described `INSERT … ON CONFLICT DO NOTHING RETURNING` against the old
    `pools_single_active_per_vehicle` index — that creation path no longer
    exists; the current design is simpler and `REQUESTED` is transient-only.)
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
  rejected (409), pooled fares for Nusrat/Rafiq (3999/3977 paisa), ownership
  isolation (404), cancellation rules, atomic rollback when a join recompute
  throws, and two true concurrency races (last-seat claim; first-pool creation)
  from two independent database connections.
- **Alternatives rejected:** application-level mutex/lock (process-local, not
  safe across API instances); `INSERT … ON CONFLICT DO NOTHING` without the
  return-then-rescan step (silently leaves the loser REQUESTED forever); a
  cached `available_seats` column with optimistic update (would require retry
  loops and can still oversell); Redis locks (unnecessary infra, ADR-free
  violation of "do not decorate").
- **Switch later if:** the system grows to many API instances with hot-zone
  contention worth sharding. (The "a driver-accept step is added" trigger
  **already fired** — ADR-022 implements it as a first-wins claim reusing the
  same pool-row lock rather than a new hold state.)

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

## ADR-019: Driver workflow — availability switch + lifecycle (Phase 6)

> **Partially superseded by ADR-022.** The lifecycle route verbs, the
> `pools_single_active_per_vehicle` references, and the offline-switch
> narrowing in this ADR were updated below to the shipped behavior. Most
> notably, **accept is now a first-wins claim on an unassigned wait pool**, not
> a confirmation of a system-assigned pool (ADR-022 §5 lists every intended
> behavior change); and the driver surface **does show fares/earnings** since
> commit `74e1d8f` (ADR-021 §3).

- **Status:** Implemented in `apps/api/src/driver/` (routes + facade),
  `apps/api/src/rides/pooling/service.ts`, migration 0005, `POST
  /api/driver/*`; covered in `test/driver.test.ts`.
- **Decision:** give the driver an explicit **online/offline switch** and
  hands-on control of the assigned pool's lifecycle: accept → arrive → start →
  complete. Identity comes **only** from the authenticated request
  (`request.auth`), and every driver route is `requireRole(["DRIVER"])`
  (401 unauthenticated, 403 for passengers).
- **Accept = first-wins claim (changed by ADR-022):** a pool is born
  **unassigned** (`driver_id`/`vehicle_id` NULL); `accept`
  (`POST /api/driver/pools/:poolId/accept`) atomically writes
  `driver_id`/`vehicle_id`/`accepted_at` under the ADR-020 vehicle → count →
  pool-row lock order, and the pool **stays MATCHED**. Exactly one concurrent
  accept wins (`409 POOL_ALREADY_ACCEPTED` for the loser); a same-driver
  re-accept is idempotent (the active-pool count excludes `:poolId`); a pool
  whose driver has no online eligible Tesla is rejected (`409 VEHICLE_OFFLINE`).
  (Under pre-ADR-022 automatch this was a *confirmation* of a system-assigned
  pool — that path no longer exists.)
- **Lifecycle semantics (PRD §4):** `arrive` requires a prior accept
  (`409 POOL_NOT_ACCEPTABLE` otherwise, ADR-017's documented improvement);
  the *aggregate* (pool **and** every member ride together) moves
  MATCHED→DRIVER_ARRIVED→STARTED→COMPLETED, each ride journaled in
  `ride_status_history`, with pool `started_at`/`completed_at` and per-ride
  `completed_at` timestamps. Every step validates the state machine first —
  an illegal move (arrive twice, start before arrive, complete before start)
  is a `409 INVALID_STATE_TRANSITION`, never a silent write. Completing a pool
  drops it out of the accepted-pool partial indexes (status terminal, ADR-022)
  and thereby **frees the Tesla** for new matching — no separate "release"
  action.
- **Offline switch (strict §21.J, narrowed by ADR-022):** going offline while
  any of the driver's **accepted** pools is non-terminal is refused
  (`409 DRIVER_HAS_ACTIVE_POOL`). This is strict: a driver cannot duck an
  accepted trip by flipping the switch. Unassigned wait pools in the lobby do
  **not** block going offline (they have no owner). Going online merely flips
  the vehicle(s).
- **Driver surface shows fares/earnings (P9 relaxed, ADR-021 §3):** the driver
  hub lists member names, seats, and zone names plus each ACTIVE member's
  `fare` and the pool's `earnings.totalCollectedPaisa` (commit `74e1d8f`).
  Individual fares come from the stored `fares` rows — the driver surfaces the
  money the pool collects, never recomputing it (ADR-015). The earlier
  "no fares on driver surface" rule was deliberately relaxed in ADR-021 §3.
- **Passenger cancellation stays legal through DRIVER_ARRIVED (P8):** after
  the driver arrives but *before* the trip starts a passenger may still cancel
  (free up the seat, recompute remaining fares, or terminate a now-empty pool),
  honoring the PRD's cancellation-validity view; from STARTED onward
  cancellation is rejected (the trip is committed).
- **Migration 0005:** `pools.accepted_at TIMESTAMPTZ NULL` + CHECK
  `pools_accepted_progression` (`accepted_at IS NOT NULL OR status NOT IN
  ('DRIVER_ARRIVED','STARTED','COMPLETED')`) so a progressed pool can never
  lack an acceptance — while `MATCHED → CANCELLED` (Phase 5 semantics) stays
  fully legal. Partial index `driver_pools_accept_idx` covers the progression
  audit read. Migration 0007 later **added** the per-accepted-pool indexes
  `pools_single_accepted_per_driver` / `pools_single_accepted_per_vehicle`
  (binding the wait-pool model; ADR-022).
- **Why a thin `DriverService` facade:** driver routes get exactly the driver
  operations (availability + accept/arrive/start/complete + the read routes —
  nine total in `apps/api/src/driver/service.ts`) and cannot (by typing) reach
  the passenger-facing
  match/cancel/force-cancel surface. It is a narrowing, not an abstraction —
  all rules, locks, and errors live in the pooling service.
- **Alternatives rejected:** accept-as-reservation (MATCHED→"RESERVED" hold)
  — reintroduces unhandled pending-state handling and a second wait; GPS/QR
  "arrival proof" — out of MVP scope, adds hardware; a webhook push to the
  driver — the driver hub polls, matching everything else in README/AGENTS
  (no queues, no Redis).
- **Switch later if:** real routing/geo turns ARRIVAL into a verifiable event,
  or payment gates require the driver to confirm fares before starting.

## ADR-020: Driver lifecycle lock order — vehicle → rides → pool (Phase 6)

- **Status:** implemented across `apps/api/src/rides/pooling/service.ts`
  (`lockDriverVehicles`, `lockOwnedPool`, `byId`-ordered ride locks);
  exercised by `test/driver.test.ts` (concurrent accept/arrive/complete races,
  offline-vs-booking race).
- **Decision:** every driver lifecycle transition acquires locks in a fixed
  order: **driver's VEHICLE rows `FOR UPDATE` (id-ascending) → the pool's
  member RIDE rows `FOR UPDATE` (id-ascending) → the POOL row `FOR UPDATE`**.
  The availability toggle locks only vehicle rows and then COUNTs pools
  (never waits on a pool row). This keeps the whole system deadlock-free with
  the Phase 5 order:
  - Passengers (cancel/match) already take **ride → pool** (ADR-017), so the
    driver's rides-before-pool tail cannot cycle with them.
  - The **vehicle lock is the shared serialization point** for the driver: the
    automatch's Tesla pick (commit 2 of Phase 6) locks the same vehicle rows,
    so an offline toggle and a racing new-booking serialize on Bullet's row —
    a pool can never be created on a Tesla that is (committed) offline, and an
    offline toggle can never strand a pool on an offline Tesla
    (requirements §15, tested).
  - The availability toggle never locks pool rows, so it cannot deadlock with
    a transition that holds a pool row.
- **Why not a single pool-row lock only:** the driver's own offline/online
  transition needs the vehicle serialization the pool row does not mediate
  (a pool may not exist yet while a booking races it), and ownership checks on
  the pool alone would leave a race where two drivers of the same vehicle
  could act interleaved. Vehicle-then-pool is the one canonical order the
  data model supports.
- **READ COMMITTED is sufficient:** every transition acts on a pool that
  already committed (automatch committed its whole create+match transaction),
  so an action never needs to "see" an uncommitted pool. The recheck under the
  pool lock (status still the actionable state) is what makes the loser of a
  concurrent arrive/complete see a clean `409 INVALID_STATE_TRANSITION`
  instead of writing on stale state.
- **Tests:** two independent postgres connections race accept (both succeed
  idempotently, one `accepted_at`), arrive (exactly one wins), complete (one
  wins, Tesla freed), and offline-vs-booking (the invariant holds either way:
  an offline Bullet holds no non-terminal pool).
- **Switch later if:** the system grows to many API instances with one driver
  contested from multiple hot paths — then per-vehicle advisory locks or a
  reservation table (`FOR UPDATE SKIP LOCKED`) would spread the serialization
  point; the order documented here stays the ordering rule either way.

## ADR-021: One active ride per passenger, estimate endpoint, and the web UI (Phases 7–8)

- **Status:** implemented on `feature/full-ride-driver-ux` (branched from
  `feature/passenger-ui`). Backend additions in `apps/api` (migration 0006 +
  `rides`/`driver` routes); the full web UI in `apps/web` — this ADR launched the
  passenger UI, and the web app has since been redesigned twice (plain-CSS
  always-dark design system in §4; driver-workspace UX + Leaflet maps in the
  `09a3824`…`53abeb3` redesign). The web suite is now **128 Vitest + RTL tests
  across 21 files**, `next build` clean.

### 1. One active ride per passenger — database-enforced (requirements §21.L)
- **Decision:** partial unique index `ride_requests_one_active_per_passenger`
  on `ride_requests (passenger_id) WHERE status IN ('REQUESTED','MATCHED',
  'DRIVER_ARRIVED','STARTED')` (migration 0006). The create-ride service maps a
  constraint violation to `409 ACTIVE_RIDE_EXISTS` (`rides/errors.ts`); two
  concurrent bookings from the same passenger serialize on the index — exactly
  one wins (verified in `rides.test.ts`).
- **Why:** a passenger book/cancel/rebook flow (e.g., the Nusrat demo —
  book Banani→Mohakhali, cancel, rebook) needs a clear "occupied" signal; a DB
  constraint beats a read-check-then-write race and needs no transaction ritual.
  The frontend calls it `useRides().active` and hides the booking form — UX
  only; the security boundary is the backend 409.
- **Alternatives rejected:** application-level pre-check (racy — two toggles
  could both pass before writing); letting the frontend decide (never trust the
  client — AGENTS).

### 2. Read-only pre-booking estimate (`GET /api/rides/estimate`)
- **Decision:** a query route that runs the same deterministic fare
  (`estimateFare`, ADR-015) as a real booking but persists **nothing**.
  Response matches a booked ride's fare view so a confirmed booking renders
  identically. Motivation: PRD's "See estimated fare" precedes "Request a ride"
  — the passenger should see the number *before* committing. The web ride form
  shows a live preview while still offering idempotent commit.

### 3. Driver read surface (`GET /api/driver/availability`, `GET /api/driver/pools/history`)
- **Decision:** two read-only `DRIVER` routes feed the driver hub UI without
  widening the write surface: the current availability switch state (so the
  toggle renders true state), and terminal pools (so "previous trips" is
  renderable). The fare-free rule (P9) stated at the time was later relaxed
  for the driver hub by commit `74e1d8f`, which added per-passenger `fare`
  and pool `earnings` to the driver pool view (read from the stored `fares`
  rows, ACTIVE members only) — the driver surface shows the money it
  collects, still never recomputing it.
- **Alternative rejected:** reusing `GET /api/driver/pools` for both open and
  completed trips — the route's non-terminal semantics are part of the
  Phase 6 contract; a second read is cheaper than a semantics change.

### 4. Web app: plain-CSS always-dark design system (no Tailwind/shadcn pulled in)
- **Decision:** the web UI uses a hand-written componentized stylesheet
  (`apps/web/app/globals.css`) — design tokens, typographic scale, header/nav,
  cards, forms, badges, state timeline, driver member list — and forces the
  Clerk sign-in/sign-up into the same dark theme via `@clerk/themes` `dark`
  appearance (`appearance={{ theme: dark, variables: {...}, elements: {...} }}`,
  Clerk v7 API — `theme`, not `baseTheme`; variables keys are
  `colorPrimary/colorBackground/colorForeground/colorMutedForeground/colorInput/
  colorInputForeground/colorPrimaryForeground/colorDanger/borderRadius/fontFamily`).
  The palette has since evolved to a lime-accent always-dark scheme (`--accent
  #b6f36b`; the original GitHub-blue `--primary` token is gone —
  `docs/frontend-design.md` §2/§12 documents the spec).
- **Why now:** ADR-001 listed Tailwind + shadcn/ui for later, but AGENTS'
  "never introduce a dependency without a reason" applies the other way too —
  the MVP's surface (forms, cards, badges, a switch, a timeline, a member list)
  is small enough to style explicitly, and a design system this lean costs fewer
  moving parts than a toolchain. Server-side rendering compatibility and the
  always-dark product look (a night-city Dhaka ride share) are trivial with
  plain CSS. Git history + the two UX prior-art designs were the reference, not
  a new framework.
- **Switch later if:** the design surface grows (more roles, live map states) —
  Tailwind/shadcn remain the sanctioned path (ADR-001).

### 5. Role-aware navigation and gates are UX, not security
- **Decision:** the web app derives the role from `GET /api/me` (`useMe`) and
  redirects PASSENGER ↔ DRIVER between `/rides` and `/driver`; `RoleGate`
  wraps pages. This is presentation — the API still enforces
  `requireRole`/owner checks on every route (AGENTS: never trust frontend
  validation alone).

### 6. Polling, bounded and stopping at terminal
- **Decision:** ride/pool state pages poll TanStack Query refetchIntervals
  (5 s) **only while a trip is non-terminal**; once status is COMPLETED or
  CANCELLED the interval is cleared. No websockets/SSE, no queue — consistent
  with "no unnecessary infrastructure". Alternatives rejected: auto-refetch
  forever (waste on finished trips), and a manual refresh button alone (the MVP
  driver demo needs status to move without a click).

- **Web tests:** 128 Vitest + RTL tests across 21 files cover the rules helpers
  (describeApiError, isTerminal/isCancellable, formatPaisa/formatStatus,
  nextPoolAction), the two-step cancel button, active-ride gating of the
  booking area, shared-discount visibility, the availability toggle, driver
  pool actions, the role gates, the mobile panel resizer, sign-in demo
  auto-fill, and the redesigned driver-workspace and passenger-surfaces
  components.

## ADR-022: Unassigned wait pools + first-wins driver accept (Phase 6/8 follow-up)

- **Status:** implemented on `feature/driver-accept-selection` (backend
  migration 0007, `pooling`/`driver` services; web app shows the lobby).
  Reworks ADR-016/019's "system-assigned" driver pickup into an explicit
  driver **selection** step while keeping every passenger invariant intact.

### 1. Problem
- ADR-016/019¶12 assigned the matched pool to a driver/vehicle
  *inside the booking transaction* (an "automatch"); containership was
  implicit (the pool referenced the driver, but the driver never acted on
  the assignment). "Accept" was only a **confirmation** that mutated no
  driver state. Requirement gaps surfaced in review: (a) there was no
  workflow where an online driver *picks up* a waiting request; (b) the
  driver/vehicle actually assigned was invisible until until a join created
  the pool; (c) with assignment happening at booking time, "which driver
  gets it" could not be a decision, and evaluation asked for a believable
  driver-selection story (the driver opens a lobby and claims a request).

### 2. Decision: pools are born unassigned and are claimed first-wins
- A `REQUESTED` ride that cannot join an existing eligible pool **always
  creates a new pool**, but the pool is created **`MATCHED` with
  `driver_id`/`vehicle_id`/`accepted_at` NULL** — an *unassigned wait
  pool* sitting in every driver's lobby. Joining is **assignment-agnostic**:
  `loadCandidatePools` filters on `status = 'MATCHED'` only (no
  `driver_id IS NOT NULL` predicate), so a compatible ride joins an
  **unassigned wait pool or an already-claimed pool** alike — whoever
  eventually accepts the pool takes the whole group. `pooling.test.ts`
  "joins an overlapping ride into the same pool and recomputes BOTH fares"
  exercises the unassigned case.
- Assignment is now **`DRIVER accept = first-wins claim`**: any online
  driver with an eligible Tesla claims an unassigned pool atomically
  (`POST /api/driver/pools/:poolId/accept` — the lifecycle verbs are POST;
  some early ADR drafts wrote `PATCH`). `accept` records `driver_id`,
  `vehicle_id`, and `accepted_at` on the pool row; the first committed
  transaction wins (see §4), every later driver gets
  `409 POOL_ALREADY_ACCEPTED`. The pool itself stays `MATCHED` (per the
  passenger view nothing changed — ADR-016's `MATCHED` semantics preserved).
- **Lobby endpoint:** `GET /api/driver/pools/available` returns all
  unassigned `MATCHED` pools (newest first) — identical for every driver,
  driver-agnostic by construction (no `driverId` filter; ESLint rules
  forbid an unused parameter). The owned pools list (`GET /api/driver/pools`)
  now contains only pools the driver **accepted**; `driver_id` is a hard
  ownership key, and the lobby empty state is text, not a graceful-hunt.
- **Booking no longer depends on driver availability:** an offline fleet
  never blocks a ride — the request always lands in a wait pool. This is a
  deliberate change from ADR-019¶12 (offline-vs-booking race test now
  asserts both sides succeed).

### 3. DB invariants (migration 0007) — why they hold
- CHECK `(driver_id IS NULL) = (vehicle_id IS NULL)`: assignment is always
  all-or-nothing.
- CHECK `driver_id IS NULL OR accepted_at IS NOT NULL`: a driver cannot own
  an unaccepted pool (no accidental assignment without the acceptance step).
- Partial unique indexes `pools_single_accepted_per_driver` /
  `pools_single_accepted_per_vehicle` on `(driver_id)` / `(vehicle_id)`
  `WHERE driver_id IS NOT NULL`: a driver or Tesla can *own* at most one
  non-terminal pool. Replaces the old `pools_single_active_per_vehicle`
  (one active pool per vehicle) — the old index still holds transitively
  because accepted ⇒ active and a vehicle has ≤1 accepted pool.
- Passenger `REQUESTED` is now transient-only by construction: every
  request leaves creation inside an accepted-CAPACITY `MATCHED` pool
  (either an existing pool — claimed or unassigned — or a fresh wait pool).

### 4. Concurrency — still ADR-017, refitted
- The seat-claim transaction is **unchanged** (`claimSeatIn`: pool row
  `SELECT … FOR UPDATE`, status recheck, occupancy derived from ACTIVE
  members under the lock, exactly one winner; the last-seat loser becomes
  a new unassigned wait pool). AGENTS invariant #6 (concurrent requests
  never corrupt capacity) still holds; the whole Seat-claim design:
  `docs/database.md` §7.
- New accept transaction, fixed lock order **vehicle → pools → contested
  pool** (ADR-020 extended): lock the caller's VEHICLE rows `FOR UPDATE`
  (id-ascending); `SELECT count(*) FROM pools WHERE driver_id = :me AND
  status NOT IN ('COMPLETED','CANCELLED') AND id <> :poolId` — if this
  driver already owns another active pool, `409 DRIVER_HAS_ACTIVE_POOL`
  (the count **excludes the pool being re-accepted**, so idempotent
  re-accept of a pool you own returns 200 with the same `accepted_at`);
  verify `status = 'MATCHED'` and `driver_id IS NULL` (else
  `409 POOL_NOT_ACCEPTABLE` / `POOL_ALREADY_ACCEPTED`); then lock the
  contested POOL row `FOR UPDATE` and write `driver_id`/`vehicle_id`/
  `accepted_at`. Capacity rule: `vehicle.capacity >= pool.capacitySnapshot`.
- **First-wins is the serialization point:** the pool row lock makes two
  concurrent accepts of the same pool serialize — the second sees a
  committed winner and returns `POOL_ALREADY_ACCEPTED`. No distributed
  solution needed (fits "no unnecessary Redis"; see `requirements.md` §15
  and ADR-020's scale-out note).
- A race with a no-Tesla driver (a dedicated non-cast fixture; every seeded
  driver now owns an online Tesla) or an offline fleet yields
  `409 VEHICLE_OFFLINE` ("No online Tesla can carry this pool.").

### 5. Behavior changes vs ADR-016/019 (intended, tested)
- **arrive before accept:** an unassigned pool has no owner, so
  `POST …/arrive` → `404 NOT_FOUND` (ownership is defined by acceptance
  only; the `accepted_at` guard is defensive/dead under the CHECK).
- **offline toggle narrowed:** only **accepted** pools block going offline
  (`DRIVER_HAS_ACTIVE_POOL`); unassigned wait pools in the lobby never
  block it.
- **interloper 404 superseded by open competition:** any driver may
  attempt an accept; only the first wins. No "this pool is yours" 404 on
  the claim path.
- **Knock-on/indirect consequences:** `getAvailablePools()` no longer takes a
  `driverId`; the seeded cast gains Karim/Rahim/Faruq + Tesla 2/3/4 (all
  online) so the accept story (Jashim vs. Rahim race, Karim the eligible
  Tesla-2 competitor; the no-Tesla case is a dedicated fixture) is
  covered with canonical actors (tests use `SEED_IDS`).

### 6. Web UI (Phase 8 follow-up)
- Driver hub gains a **"Waiting requests" lobby**: `useAvailablePools()`
  polls `GET /api/driver/pools/available` (5 s, while any pool is
  non-terminal, ADR-021§6) and each lobby card offers an **Accept**
  button that fires the first-wins claim inline (the detail page 404s for
  unclaimed pools, so the claim must live on the lobby card). A lost race
  surfaces `POOL_ALREADY_ACCEPTED` with a refresh hint, and the refetch
  drops the pool.
- Passenger surfaces render the wait-pool state: `PoolInfo`/`RideCard`
  show "Waiting for a driver…" when `driver_id`/`vehicle_id` are NULL
  (`RidePoolView` assignment fields are `string | null`; driver types
  `vehicle?: {…} | null`). Owned-open-pools and detail pages use the
  assigned Tesla once present.

### 7. Alternatives rejected (briefly)
- **Keep system-assignment; add accept-as-confirmation (ADR-019 as-is):**
  leaves no driver-facing decision and cannot tell the "who claims it"
  story; also kept the offline-fleet-blocks-booking behavior that froze
  the booking path on availability.
- **Queue/assignment service (e.g., Redis stream or a workers pool):**
  violates "no unnecessary queues/Redis" for a single-node MVP; the pool
  row lock is simpler and correct.
- **Application-level "first-wins" via a `claimed_by` read-then-write:**
  racy - two accepts could both pass the check before writing; the DB
  transaction is the arbiter (AGENTS data integrity principle).

---

## ADR-024: Clerk-owned auth routing + per-user query isolation (web, follow-up)

- **Decision:** The sign-in/sign-up pages live in an `(auth)` route group with
  Clerk's catch-all App Router structure (`[[...sign-in]]`/`[[...sign-up]]`),
  rendered with `routing="path"`, `path`, `signUpUrl`/`signInUrl`, and
  `fallbackRedirectUrl="/"`; `NEXT_PUBLIC_CLERK_(SIGN_IN|SIGN_UP)_URL` and the
  fallback-redirect env vars default every Clerk surface (header buttons,
  OAuth callbacks, sign-out) to our own localhost routes. All authenticated
  TanStack queries are keyed by the current Clerk `userId`, and a
  `SessionCacheSync` component clears the query client whenever `userId`
  changes (logout included).
- **Why now:** Manual testing found (a) Clerk's internal links navigated to the
  accounts.dev instance URL instead of `/sign-in`/`/sign-up`; (b) the auth
  pages inherited the app navbar and duplicated the sign-in/up controls;
  (c) logout then login as the other canonical actor could briefly show the
  previous user's role-specific UI (e.g., Nusrat's passenger page after
  Jashim logged in) because the single, un-namespaced cache served stale data
  as fresh (`staleTime` 30 s).
- **Trade-offs:** Query keys gain a user segment everywhere, so mutations must
  invalidate by prefix (they already do). Role still cannot be resolved in the
  Clerk edge middleware (the role lives in PostgreSQL behind `/api/me`), so
  role blocking remains the `RoleGate` UX layer on top of backend 403s — but
  the redirect target is now always derived from the current session's `userId`
  and query state, never from cached data of a different user.
- **Switch later if:** We store role as Clerk session/session-cache metadata
  and can do middleware-level role redirects without a DB round-trip, or we
  adopt a server-side SSR data-fetching layer (e.g., React Query SSR) that
  re-derives identity per request.
