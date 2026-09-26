# Development Plan — Dhaka Tesla Pool (MVP)

> Incremental implementation phases for the MVP. This is a *plan*; phases are
> implemented step-by-step in later prompts, on feature branches, never all at
> once. Tests and deliverables per phase are noted so a later engineer can
> verify each stage without guessing.

Each phase lists: **objective · deliverables · dependencies · risks · tests**
(tests that should eventually exist for that stage).

---

## Phase 0 — Repository and architecture (this phase)

- **Objective:** PRD understood, engineering foundation documented, git history
  begins meaningfully.
- **Deliverables:** `docs/reference/PRD.pdf`, `docs/requirements.md`,
  `AGENTS.md`, `docs/architecture.md`, `docs/database.md`, `docs/decisions.md`,
  `docs/development-plan.md`, `README.md`, `.env.example`, `.gitignore`,
  root `package.json` (npm workspaces), `docker-compose.yml` (DB-first),
  `.github/workflows/ci.yml` skeleton, `apps/` placeholders, `master` +
  `pre-release` branches.
- **Dependencies:** none.
- **Risks:** environment gaps (Docker Desktop not installed locally — needed
  from Phase 1); ambiguity unresolved (requirements §21).
- **Tests:** none yet (docs only).

## Phase 1 — Project infrastructure

> **Status: COMPLETE.** Scaffolds, full compose stack (web+api+db, healthchecks),
> Drizzle tooling, CI, and docs all verified on Windows (Docker Desktop 29.8.0,
> Docker Compose v5.5.1, Node 24.14.1).

- **Objective:** Reproducible scaffolding for both apps and CI.
- **Deliverables:** `apps/api` + `apps/web` real scaffolds (package.json, tsconfig,
  entrypoints with a health route/screen), `docker-compose.yml` full app stack,
  Postgres healthcheck + persistent volume, `.env.example` wired for compose,
  CI jobs wired to lint/typecheck.
- **Dependencies:** Phase 0; Docker Desktop installed locally.
- **Risks:** workspace hoisting quirks; Docker availability on machines.
- **Tests:** `GET /health` returns ok; `docker compose up` reaches the
  "everything up" state.
- **Verified commands:** `npm install`, `npm run typecheck`, `npm run lint`,
  `npm test`, `npm run build`, `npm run db:check`, `npm run db:migrate`,
  `docker compose up --build` (db/api/web all healthy).
- **Known follow-ups:** `drizzle-kit generate` currently yields 0 tables
  (schema arrives in Phase 2); `db:migrate` runs against an empty journal.

## Phase 2 — Database

> **Status: COMPLETE.** Full schema (9 tables, 3 enums), reviewed + committed
> migration, deterministic idempotent seed (cast: Jashim/Bullet/Nusrat/Rafiq/
> Shirin + 8 zones), and 21 schema-integration tests — all verified against the
> Docker PostgreSQL container on Windows. See `docs/database.md`.

- **Objective:** Schema, migrations, and seed data for the entities in
  `docs/database.md`.
- **Deliverables:** Drizzle schema for User, Session, Vehicle/Tesla, Zone,
  Ride Request, Pool, Pool Member, Fare, Ride Status History; initial migration;
  seed script using **Jashim/Bullet/Nusrat/Rafiq/Shirin**; DB-level constraints
  for capacity and state.
- **Dependencies:** Phase 1; DB protocol questions (docs/database.md §5)
  resolved (recorded in ADR-012).
- **Risks:** locking semantics for seat counts; constraints too loose to
  actually block overbooking.
- **Tests:** migration applies cleanly; seed runnable both in compose and
  locally; capacity/state constraints reject bad rows.
- **Verified commands:** `db:check`, `db:generate` (no schema drift),
  `db:migrate`, `db:seed` (twice — idempotent), `npm test` (21/21, against a
  disposable `_test` database), root `lint`/`typecheck`/`build`; `docker
  compose up` full-stack + config.
- **Concurrency note:** DB refuses a second active pool per vehicle already;
  the seat-claim transaction (`SELECT … FOR UPDATE` + derived occupancy) is
  implemented and tested in the pooling phase (`docs/database.md` §7).

## Phase 3 — Authentication (Clerk)

> **Status: COMPLETE.** The planned manual Argon2id/cookie-session phase was
> replaced by Clerk as identity provider (**ADR-013**; the rejected manual-auth
> suggestion is recorded in README "AI Usage"). Database adapted
> (`users.clerk_user_id` unique, `sessions` dropped, `password_hash` dropped,
> `ADMIN` role value), `@clerk/nextjs` frontend (sign-in/sign-up/account/
> middleware), `@clerk/backend` Fastify verification + local-user resolution +
> role guards (`requireAuth`/`requireRole`) + `GET /api/me` + first-request user
> provisioning (**ADR-014**, `provision.ts` `upsertLocalUser`), 23 auth tests +
> 29 database tests (incl. provisioning concurrency), full-stack compose
> validation — see `docs/architecture.md` §3.2/§3.4/§10 and
> `docs/decisions.md` ADR-013/ADR-014.

- **Objective:** Application users authenticate through Clerk; the API verifies
  every bearer token and resolves the local user + PostgreSQL role.
- **Deliverables:** `users.clerk_user_id` (NOT NULL UNIQUE) + generated
  migrations (`0001_*`, `0002_*`; `sessions` table and password hashes removed);
  `@clerk/nextjs` UI (`/sign-in`, `/sign-up`, protected `/account`,
  `middleware.ts` route policy, bearer `lib/api.ts`); Fastify auth plugin
  (`install.ts` — `request.auth`, `requireAuth`, `requireRole`), Clerk
  verification boundary (`provider.ts` via `@clerk/backend`), local user
  resolver (`user-resolver.ts`), `GET /api/me`; `/health` stays public.
- **Dependencies:** Phase 2.
- **Risks:** Clerk SDK surface change (Core 3 removed `SignedIn`/`SignedOut` —
  use `<Show>`); placeholder keys must be well-formed (build/runtime); dev-mode
  `auth.protect` rewrites to Clerk-hosted fallback → manual redirect used;
  `CLERK_SECRET_KEY` needed server-side at runtime.
- **Tests:** 401 unauthenticated; valid identity → local user; unknown Clerk
  user 403; wrong role 403; correct role accepted; body `userId` cannot
  override; invalid/expired/inactive/reserved identities rejected; `/health`
  public. 19 tests run against injected deterministic fakes (no network).
- **Verified:** api/web lint + typecheck, root lint/typecheck/test/build
  (42 tests with Postgres up — 23 DB + 19 auth), fresh-DB migrate/seed/check,
  `docker compose up --build` full stack healthy + route policy live
  (`/account` 307 → `/sign-in`), README/env/compose/CI updated, no `db:generate`
  drift.

## Phase 4 — Passenger ride requests

> **Status: COMPLETE** (branch `feature/passenger-ride-request`). Ride request
> creation, reads, and the zones pick-list are implemented at `/api/rides`,
> `/api/rides/:rideId`, `/api/zones`. **Fare estimation was pulled forward into
> this phase** (from Phase 7) because the request's initial fare must be
> returned in the same response (ADR-015). The initial per-seat estimate now
> lands in `fares` at creation (discount 0); Phase 7 becomes the **pooled-fare
> recompute** of that same row. Scope note: passenger-only — driver/ride
> management is Phase 6.

- **Objective:** Passenger can request a ride and see estimated fare/status.
- **Deliverables:** `POST /api/rides` (pickup, destination, seats, optional
  `clientRequestId`), `GET /api/rides`, `GET /api/rides/:rideId`,
  `GET /api/zones`; deterministic fare module (`final = 3000 + roundHalfUp(km ×
  1.3 × 1200) − 0` per seat); REQUESTED state only; idempotent replay (migration
  0003); one-transaction ride + fare + initial status journal row; Zod strict
  validation (K1); CORS POST; additive `details` on the error envelope.
- **Dependencies:** Phases 2, 3.
- **Risks:** fare formula drift vs. docs (mitigated by pinning Nusrat **5932** /
  Rafiq **4140** paisa in tests); zone validation (unknown zone id → 400).
- **Tests (implemented):** fare unit suite (7, `test/fare.test.ts`) + rides
  integration suite (22, `test/rides.test.ts`) — creation 201 / replay 200,
  per-seat × seats total, concurrent same-key replay, validation 400s, DRIVER
  403, cross-user 404, list isolation, atomic rollback on injected fare failure.

## Phase 5 — Pool matching

> **Status: COMPLETE** (branch `feature/matching-pooling`). The documented,
> deterministic matching rule (§21.A) and the full pool lifecycle are
> implemented, including the automatch, the state machine, the seat-claim
> concurrency design, and pooling fares. **Scope changes vs. the plan:**
> (1) the ride state machine (`src/rides/state.ts`) was pulled forward into
> this phase since automatching and cancellation are state transitions;
> (2) the **pooled-fare recompute** was pulled forward from Phase 7 — joining,
> cancelling, and force-cancelling rewrite the existing `fares` row in place
> (`fares.updated_at`, migration 0004), so Phase 7 now only owns the README
> worked example; (3) **there is no driver "accept" step in Phase 5** — matching
> happens at request time, so a pool is born `MATCHED` (ADR-016); driver-flow
> states (`DRIVER_ARRIVED → STARTED → COMPLETED`) are declared in the transition
> map and get endpoints in Phase 6.

- **Objective:** Documented matching rule (requirements §21.A) groups compatible
  requests into a pool on one Tesla.
- **Deliverables:** pure matching rule `src/matching/rules.ts` (same pickup zone
  + all-pairs drop-off spread ≤ **2.0 km** + capacity; fullest pool first —
  ADR-016); explicit transition map `src/rides/state.ts` (`409
  INVALID_STATE_TRANSITION` on illegal moves); auto-match inside the create-ride
  transaction; transactional seat claims (`SELECT … FOR UPDATE` pool row +
  derived occupancy; pool creation via `INSERT … ON CONFLICT DO NOTHING
  RETURNING` + one bounded re-scan — ADR-017); in-place pooled-fare recompute +
  full-refund forced cancel (`src/rides/pooling/fare.ts`); `POST
  /api/rides/:rideId/cancel` (ADR-018); migration 0004 (`fares.updated_at`,
  additive). No Redis/queues/mutexes.
- **Dependencies:** Phases 2, 3, 4.
- **Risks (realized by tests):** matching edge cases (Nusrat+Rafiq pool at
  ≈1.906 km spread; Banani→Dhanmondi at ≈4.6 km does not); last-seat race
  (Rafiq vs Shirin, exactly one wins); first-seat race (two concurrent claims
  coalesce onto ONE pool via ON CONFLICT); capacity never exceeded; empty-pool
  cancel → pool CANCELLED; ownership isolation (404) and illegal-state cancel
  (409).
- **Tests:** `test/matching.test.ts`, `test/state.test.ts`, `test/pooling.test.ts`
  (new) + `test/rides.test.ts`/`test/fare.test.ts` updates — full suite
  **122 passing**, including two true concurrency races on two independent
  database connections.

## Phase 6 — Driver flow

> **Status: COMPLETE** (branch `feature/driver-workflow`; merged, validation
> 152/152). Drivers get an online/offline switch and hands-on control of the
> pool the automatch assigned: **accept → arrive → start → complete**, plus a
> fare-free hub (their pools, members, seats, zones). **Scope changes vs. the
> plan:** (1) accept is a **confirmation** that records `pools.accepted_at`
> while the pool stays MATCHED (idempotent), not a reservation — automatch per
> ADR-016 stays the allocation, ADR-019; (2) the offline rule is **strict**
> (§21.J): refused while ANY pool is non-terminal (`409 DRIVER_HAS_ACTIVE_POOL`);
> (3) passenger cancellation is extended to stay legal through DRIVER_ARRIVED
> (P8); (4) migration 0005 (`pools.accepted_at` + CHECK
> `pools_accepted_progression` + partial index) — additive only.

- **Objective:** Driver online/offline, accepts a ride/pool, marks
  `ARRIVED → STARTED → COMPLETED`, sees seats/history.
- **Deliverables:** `apps/api/src/driver/` (routes + thin `DriverService`
  facade); `POST /api/driver/availability` (204); `GET /api/driver/pools`;
  `GET /api/driver/pools/:poolId`; `POST /api/driver/pools/:poolId/{accept,
  arrive,start,complete}` → pool view; driver lifecycle lock order **vehicle →
  rides → pool** (ADR-020); count-based busy-vehicle guard; deterministic
  vehicle-first serialization with the automatch/offline toggle.
- **Dependencies:** Phases 4, 5.
- **Risks:** state machine enforcement; driver seeing only their own vehicles
  (interloper = 404, existence hidden); deadlock-free lock ordering with the
  passenger cancel path (vehicle lock + ride-before-pool).
- **Tests:** `test/driver.test.ts` (new, 30 tests): full happy-path lifecycle
  with timestamps + per-ride journals; accept idempotency/idempotent-concurrent;
  `VEHICLE_OFFLINE`; `POOL_NOT_ACCEPTABLE` (accept-after-move, arrive-before-
  accept); illegal transitions (`arrive twice`, `start before arrive`,
  `complete before start`) → 409; interloper 404 on all four actions + detail;
  offline guard at MATCHED and STARTED; offline allowed after terminal; offline
  Tesla → new booking stays REQUESTED; completion frees Bullet for a fresh pool;
  P8 cancel at DRIVER_ARRIVED (seat freed, fare recomputed, emptied pool
  terminates) and refused at STARTED; hub list/detail semantics (own pools only,
  fare-free, ACTIVE members, ordering); HTTP role guards (401/403) and full
  lifecycle over HTTP; three true concurrency races (double accept → one
  `accepted_at`; double arrive → one winner; double complete → one winner +
  Tesla freed; offline-vs-booking invariant) on two independent connections —
  full suite **152 passing**.

## Phase 7 — Fare calculation

> **Status: fully absorbed by Phases 4 + 5.** The initial per-seat estimate
> (`final = 3000 + roundHalfUp(haversine × 1.3 × 1200) − 0`, ADR-015) is
> persisted at ride creation, and the **pooled-fare recompute** was pulled
> forward into Phase 5 (`src/rides/pooling/fare.ts`, ADR-017): when a pool holds
> ≥ 2 ACTIVE members, every member's fare row is updated **in place** with
> `poolDiscount = roundHalfUp(25%·(base + distance))`, `final = base + distance −
> poolDiscount`; leaving (cancel) and forced-cancel-with-full-refund recompute
> the same row too (`fares.updated_at`, migration 0004). The total a passenger
> pays remains per-seat × seats. **Remaining for this phase scope:** the worked
> by-hand pooled example (Nusrat + Rafiq → 4449 / 3105 paisa) lands in the README
> (deferred to Phase 12 docs, already pinned in tests).

- **Objective:** Correct, documented, hand-verifiable per-passenger fares.
- **Deliverables:** (done) pooled-fare recompute service updating the existing
  fare row; one-row-one-fare invariant (updated in place, never duplicated);
  (deferred) worked example (Nusrat, Rafiq pooled) in README.
- **Dependencies:** Phases 4, 5 (pooled trip needed).
- **Risks:** rounding choice (settled: **round-half-up**, ADR-015);
  distance-approximation constant (requirements §21.D/H, = 1.3).
- **Tests (implemented in Phase 5):** Nusrat 4449 / Rafiq 3105 paisa pinned in
  `test/fare.test.ts` + `test/rides.test.ts`; precision integer-based; snapshots
  stable; recompute rollback atomicity under an injected throwing recompute.

## Phase 8 — Concurrency / data integrity

> **Status: pulled forward and completed in Phase 5.** The seat-claim race was a
> first-class deliverable of the pooling phase (ADR-017), implemented in
> `apps/api/src/rides/pooling/service.ts` and proven by `test/pooling.test.ts`
> on two independent database connections. What remains for Phase 8's scope is
> driver-phase concurrency (busy-vehicle guards once Phase 6 adds ARRIVED/STARTED
> endpoints).

- **Objective:** Seat-claim race cannot corrupt capacity (Nusrat vs. Shirin).
- **Deliverables (done in Phase 5):** transactional seat allocation
  (`SELECT … FOR UPDATE` pool row + derived-occupancy recheck; pool creation via
  `INSERT … ON CONFLICT DO NOTHING RETURNING` + one bounded re-scan — no retry
  loop), documented approach and large-scale alternative (requirements §14,
  database.md §7). Chosen lock order: ride row → pool row (deadlock-free).
  No Redis/queues/mutexes; the database is the truth.
- **Dependencies:** Phases 5 (done), 6 (driver-phase residual).
- **Risks (settled):** deadlocks (consistent ride→pool lock order);
  choosing the right lock scope (pool row is the single per-Tesla
  serialization point thanks to `pools_single_active_per_vehicle`).
- **Tests (implemented):** required behavioral test #6 — Bullet pre-filled to 2
  seats, Rafiq and Shirin concurrently claim the last seat: exactly one MATCHED,
  one stays REQUESTED, occupancy stays 3; plus the first-pool race (both
  concurrent claims land in one pool).

## Phase 9 — Frontend UX

- **Objective:** Passenger + driver flows with proper loading/error/empty states.
- **Deliverables:** auth screens, ride request + fare display, status tracking,
  driver hub (online/offline, accept, lifecycle buttons), Zebra-style map
  visualization (Leaflet + OSM) showing zones/routes, history views.
- **Dependencies:** Phases 3–6 (API surfaces exist).
- **Risks:** state/caching consistency between TanStack Query and API;
  owner-isolation leaks in the UI.
- **Tests:** Playwright E2E — passenger books, driver accepts,
  passenger completion; wrong-account isolation (test #4); loading/error/empty
  states.

## Phase 10 — Testing amplification

- **Objective:** All required meaningful tests green; not coverage-chasing.
- **Deliverables:** Vitest unit + Fastify integration suite; Playwright E2E;
  the six required behaviors (requirements §14) as first-class tests.
- **Dependencies:** Phases 3–9.
- **Risks:** flaky concurrency tests; test seam in fare/matching modules.
- **Tests:** capacity (#1), transitions (#2), pooled fare by hand (#3),
  cross-user isolation (#4), cancellation rules (#5), concurrent claims (#6).

## Phase 11 — Docker / deployment

- **Objective:** `docker compose up` runs everything; public deployment.
- **Deliverables:** app Dockerfiles, compose wiring (migrations + seed on
  startup), `.env.example` complete, Vercel (web) + Render (api) + Neon (db)
  configs or reproducible Docker fallback; deployment URL in README.
- **Dependencies:** Phases 0–10.
- **Risks:** free-tier cold starts; CORS/cookie config between domains.
- **Tests:** clean checkout → `docker compose up` → health checks pass;
  deployed health + demo credentials work.

## Phase 12 — Documentation / video preparation

- **Objective:** README meets the PRD checklist; six-minute video recorded.
- **Deliverables:** full README (summary, features, screenshots/GIFs,
  architecture + ERD diagrams, stack, structure, env, setup, run/tests,
  credentials, deployment URL, API overview, decisions/trade-offs, limitations,
  next steps), AI Usage section, video link, bonus scaling note.
- **Dependencies:** Phases 0–11.
- **Risks:** video length; screenshots drift from actual UI.
- **Tests:** PRD submission-checklist self-audit passes.

---

## Working style (applies to every phase)

- One feature per branch: `feature/<feature-name>` → merge to `master` when it
  works. Cumulative features then flow to `pre-release`, then `release/v1.0.0`.
- Commits follow `docs/requirements.md` §12.
- Update `docs/` when implementation changes the architecture or data model.