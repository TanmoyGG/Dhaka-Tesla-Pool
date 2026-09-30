# Development Plan — Dhaka Tesla Pool (MVP)

> Incremental implementation phases for the MVP. This is a *plan* updated as
> work landed: phases are implemented step-by-step on feature branches, never
> all at once. **Phases 0–9 are complete**; Phase 10 (Playwright + test
> amplification) is open; Phase 11 (public deployment) is **complete** (live on
> Vercel/Render/Neon); Phase 12
> (documentation/video) is nearly complete: the README (incl. 18 screenshots in
> `docs/Screenshots/`) and AI Usage section are done, the viral-scale bonus
> note is delivered as [`docs/scaling-plan.md`](scaling-plan.md), and the demo
> **video** is recorded and linked from the README.
> Tests and deliverables per phase are noted so a later engineer can verify
> each stage without guessing.

Each phase lists: **objective · deliverables · dependencies · risks · tests**
(tests that should eventually exist for that stage).

---

## Phase 0 — Repository and architecture (complete)

> **Status: COMPLETE.** Everything below landed as the repo's foundation.

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
- **Known follow-ups:** resolved in Phase 2 — `drizzle-kit generate` produced
  the full schema (migrations `0000`–`0007`) and `db:migrate` runs against the
  populated journal.

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
- **Concurrency note:** the original per-vehicle single-active-pool index
  (`pools_single_active_per_vehicle`) was replaced by the ADR-022 per-accepted
  indexes; the seat-claim transaction (`SELECT … FOR UPDATE` + derived
  occupancy) is implemented and tested in the pooling phase
  (`docs/database.md` §7).

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
- **Risks:** fare formula drift vs. docs (mitigated by pinning Nusrat **5332** /
  Rafiq **5303** paisa in tests); zone validation (unknown zone id → 400).
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
> map and get endpoints in Phase 6. *(ADR-022 later reworked the driver
> "accept" step from a confirmation into a first-wins claim; the pool-creation
> path also became the plain `INSERT … RETURNING` wait-pool described there.)*

- **Objective:** Documented matching rule (requirements §21.A) groups compatible
  requests into a pool on one Tesla.
- **Deliverables:** pure matching rule `src/matching/rules.ts` (same pickup zone
  + all-pairs drop-off spread ≤ **2.0 km** + capacity; fullest pool first —
  ADR-016); explicit transition map `src/rides/state.ts` (`409
  INVALID_STATE_TRANSITION` on illegal moves); auto-match inside the create-ride
  transaction; transactional seat claims (`SELECT … FOR UPDATE` pool row +
  derived occupancy; pool creation via a plain `INSERT … RETURNING` of an
  unassigned wait pool — ADR-017, superseded in detail by ADR-022);
  in-place pooled-fare recompute +
  full-refund forced cancel (`src/rides/pooling/fare.ts`); `POST
  /api/rides/:rideId/cancel` (ADR-018); migration 0004 (`fares.updated_at`,
  additive). No Redis/queues/mutexes.
- **Dependencies:** Phases 2, 3, 4.
- **Risks (realized by tests):** matching edge cases (Nusrat+Rafiq pool at
  ≈1.103 km spread; Banani→Dhanmondi at ≈4.6 km does not); last-seat race
  (Rafiq vs Shirin, exactly one wins, the loser gets its own wait pool);
  first-seat race (two concurrent first-claims each open a **separate**
  unassigned wait pool — the accepted passenger-first tradeoff, ADR-022;
  occupancy always correct, no double-booked seat); capacity never exceeded;
  empty-pool cancel → pool CANCELLED; ownership isolation (404) and
  illegal-state cancel (409).
- **Tests:** `test/matching.test.ts`, `test/state.test.ts`, `test/pooling.test.ts`
  (new) + `test/rides.test.ts`/`test/fare.test.ts` updates — this phase's
  snapshot was the full suite at **122 passing** (the suite is now **182 tests
  across 10 files**), including two true concurrency races on two independent
  database connections.

## Phase 6 — Driver flow

> **Status: COMPLETE + PV2 review changes absorbed** (branch
> `feature/driver-workflow` merged; this phase's validation snapshot 152/152.
> **ADR-022 rework** on `feature/driver-accept-selection` — its snapshot
> **173/173**; the API suite is now **182 tests across 10 files**). Drivers get
> an online/offline switch and hands-on control of the pool they **claim
> first-wins from a lobby**: **accept → arrive → start → complete**, plus a
> hub (their pools, members, seats, zones, and — since commit `74e1d8f`,
> ADR-021 §3 — per-member fares and pool earnings; the earlier fare-free P9
> rule was relaxed). **Scope changes vs. the plan:**
> (1) pools are born **unassigned** (migration 0007 — `driver_id`/`vehicle_id`
> NULL); accept is a **first-wins claim** that assigns the driver/Tesla and
> records `pools.accepted_at` while the pool stays MATCHED (idempotent;
> losers → `409 POOL_ALREADY_ACCEPTED`), replacing ADR-016's automatch
> allocation — ADR-019/022; (2) the offline rule is **strict but narrowed**
> (§21.J): refused while any pool the driver **accepted** is non-terminal
> (`409 DRIVER_HAS_ACTIVE_POOL`); lobby wait pools never block the toggle;
> (3) passenger cancellation is extended to stay legal through DRIVER_ARRIVED
> (P8); (4) migrations 0005 + 0007 (`pools.accepted_at` + CHECK
> `pools_accepted_progression` + the wait-pool CHECKs/partial uniques) —
> 0007 is not additive (nullable columns, index swap).

- **Objective:** Driver online/offline, accepts a ride/pool, marks
  `ARRIVED → STARTED → COMPLETED`, sees seats/history.
- **Deliverables:** `apps/api/src/driver/` (routes + thin `DriverService`
  facade); `POST /api/driver/availability` (204); `GET /api/driver/pools`;
  `GET /api/driver/pools/available` (**lobby**, ADR-022); `GET /api/driver/
  pools/:poolId`; `POST /api/driver/pools/:poolId/{accept,arrive,start,
  complete}` → pool view; driver lifecycle lock order **vehicle → rides →
  pool** (ADR-020); **first-wins accept claim** with a count-based
  one-accepted-pool guard (`id <> :poolId` for idempotence) and capacity gate
  (`vehicle.capacity >= capacity_snapshot`); deterministic vehicle-first
  serialization with the accept claim/offline toggle.
- **Dependencies:** Phases 4, 5.
- **Risks:** state machine enforcement; driver seeing only their own vehicles
  (interloper = 404, existence hidden); deadlock-free lock ordering with the
  passenger cancel path (vehicle lock + ride-before-pool).
- **Tests:** `test/driver.test.ts` (reworked for ADR-022, 40 tests): full
  happy-path lifecycle with timestamps + per-ride journals; **lobby semantics**
  (`getAvailablePools()` driver-agnostic; held/accepted list split); **first-wins
  accept** — cross-driver race (Jashim vs Rahim, one winner + 409 loser),
  idempotent re-accept of an owned pool, `POOL_ALREADY_ACCEPTED` for a claimed
  pool, `VEHICLE_OFFLINE` for a driver with no Tesla (dedicated non-cast
  fixture) and for an offline fleet;
  `POOL_NOT_ACCEPTABLE` (accept-after-move); **arrive-before-accept → 404**;
  illegal transitions (`arrive twice`, `start before arrive`, `complete before
  start`) → 409; interloper 404 on all non-accept actions + detail; offline guard
  on **accepted** pools at MATCHED and STARTED, offline **allowed** with only
  unclaimed wait pools; offline Tesla → booking still succeeds into a wait pool;
  completion frees Bullet for a fresh pool; P8 cancel at DRIVER_ARRIVED (seat
  freed, fare recomputed, emptied pool terminates) and refused at STARTED; hub
  list/detail semantics (own accepted pools only, per-member fares + earnings,
  ACTIVE members, ordering); HTTP role guards (401/403) and full lifecycle over
  HTTP; true concurrency races (cross-driver accept → exactly one winner; double
  arrive → one winner; double complete → one winner + Tesla freed;
  offline-vs-booking decoupled — both succeed) on two independent connections —
  this phase's snapshot: full suite **173 passing** (now **182 across 10
  files**).

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
> by-hand pooled example (Nusrat + Rafiq → 3999 / 3977 paisa) is now published in
> the README **and** `docs/database.md` §3.8 (pinned in tests since Phase 4/5).

- **Objective:** Correct, documented, hand-verifiable per-passenger fares.
- **Deliverables:** (done) pooled-fare recompute service updating the existing
  fare row; one-row-one-fare invariant (updated in place, never duplicated);
  (done) worked example (Nusrat, Rafiq pooled) in the README and
  `docs/database.md` §3.8.
- **Dependencies:** Phases 4, 5 (pooled trip needed).
- **Risks:** rounding choice (settled: **round-half-up**, ADR-015);
  distance-approximation constant (requirements §21.D/H, = 1.3).
- **Tests (implemented in Phase 5):** Nusrat 3999 / Rafiq 3977 paisa pinned in
  `test/fare.test.ts` + `test/rides.test.ts`; precision integer-based; snapshots
  stable; recompute rollback atomicity under an injected throwing recompute.

## Phase 8 — Concurrency / data integrity

> **Status: completed in Phase 5 + Phase 6/8 follow-up.** The seat-claim race was a
> first-class deliverable of the pooling phase (ADR-017), implemented in
> `apps/api/src/rides/pooling/service.ts` and proven by `test/pooling.test.ts`
> on two independent database connections. Driver-phase concurrency (first-wins
> accept, one-accepted-pool-per-driver/Tesla) was completed with ADR-022
> (`test/driver.test.ts`). Pool creation no longer races on a shared vehicle
> slot — a request that cannot join an eligible pool **always creates its own
> unassigned wait pool** (`INSERT … RETURNING`, no conflict target), and the
> per-pool `FOR UPDATE` row lock still serializes every join.

- **Objective:** Seat-claim race cannot corrupt capacity (Nusrat vs. Shirin).
- **Deliverables (done in Phase 5):** transactional seat allocation
  (`SELECT … FOR UPDATE` pool row + derived-occupancy recheck; the loser of a
  concurrent claim lands in its own wait pool — no retry loop), documented
  approach and large-scale alternative (requirements §14, database.md §7).
  Chosen lock order: ride row → pool row (deadlock-free); driver transitions
  prepend the vehicle row lock (ADR-020) and the accept claim serializes
  cross-driver via the contested pool row (ADR-022). No Redis/queues/mutexes;
  the database is the truth.
- **Dependencies:** Phases 5 (done), 6 (done — ADR-022).
- **Risks (settled):** deadlocks (consistent ride→pool→vehicle lock order);
  choosing the right lock scope (the contested pool row is the single
  first-wins serialization point for accept; derived occupancy for capacity).
- **Tests (implemented):** required behavioral test #6 — Bullet pre-filled to 2
  seats, Rafiq and Shirin concurrently claim the last seat: exactly one MATCHED
  in the pool, occupancy stays 3, the loser is MATCHED in its own unassigned
  wait pool; plus the equal-route pool join and the cross-driver accept race.

## Phase 9 — Frontend UX

> **Status: complete** on `feature/passenger-ui` → `feature/full-ride-driver-ux`
> → the two redesigns `09a3824`…`53abeb3` (ADR-021). Passenger and driver flows
> are implemented in `apps/web`:
> always-dark plain-CSS design system with a lime accent (no Tailwind/shadcn
> pulled in — ADR-021 §4); Clerk sign-in/sign-up themed dark; role-aware nav +
> `RoleGate` pages
> (PASSENGER ↔ DRIVER, UX-only — the API stays the security boundary);
> passenger: book with a **live pre-booking estimate**
> (`GET /api/rides/estimate`, ADR-021 §2), active-trip banner + hidden booking
> form while a non-terminal ride exists (ADR-021 §1), 25%-shared-ride discount
> in the fare breakdown, state timeline, two-step cancel, completion modal
> showing the passenger's own fare; driver: online/offline
> toggle with true state, open pools + pool detail (member list, seats, zones,
> fares/earnings per `74e1d8f`), accept/arrive/start/complete actions,
> completed-trip history (`/driver/history`).
> State pages poll at 5 s and **stop at terminal status** (ADR-021 §6). The
> driver hub adds a **"Waiting requests" lobby** (`useAvailablePools()`, ADR-022)
> with an inline first-wins Accept button; passenger surfaces render
> "Waiting for a driver…" while a pool is unassigned. **128** Vitest + RTL tests
> across 21 files; `next build` clean. The Zebra-style **Leaflet + OSM map
> shipped** in the redesign (ADR-007 realized) — `MapPane` in the
> `WorkspaceShell` on `/rides` and `/driver`. Playwright E2E is still parked in
> Phase 10 — the six required
> behaviors are covered by the API suite (182 tests) plus the web unit tests.

- **Objective:** Passenger + driver flows with proper loading/error/empty states.
- **Deliverables:** auth screens, ride request + fare display, status tracking,
  driver hub (online/offline, accept, lifecycle buttons), map
  visualization (Leaflet + OSM) showing zones/routes, history views.
- **Dependencies:** Phases 3–6 (API surfaces exist).
- **Risks:** state/caching consistency between TanStack Query and API;
  owner-isolation leaks in the UI.
- **Tests:** (done) web unit/integration suite (80 tests at the time; the web suite is now **128
  tests across 21 files**). Playwright E2E —
  passenger books, driver accepts,
  passenger completion; wrong-account isolation (test #4 — covered at the API
  layer by `rides.test.ts` cross-user 404); loading/error/empty
  states (web) — **not yet started (Phase 10)**.

## Phase 10 — Testing amplification

> **Status: PARTIAL.** The API suite (**182 tests across 10 files**) and the web
> unit/integration suite (**128 tests across 21 files**) are green in CI; all six
> required behaviors (requirements §14) are first-class tests. **Playwright E2E
> has not been introduced** (no config, no dependency) — the remaining scope of
> this phase.

- **Objective:** All required meaningful tests green; not coverage-chasing.
- **Deliverables:** Vitest unit + Fastify integration suite; Playwright E2E;
  the six required behaviors (requirements §14) as first-class tests.
- **Dependencies:** Phases 3–9.
- **Risks:** flaky concurrency tests; test seam in fare/matching modules.
- **Tests:** capacity (#1), transitions (#2), pooled fare by hand (#3),
  cross-user isolation (#4), cancellation rules (#5), concurrent claims (#6).

## Phase 11 — Docker / deployment

> **Status: COMPLETE.** Docker/Compose is **done and shipped** — `docker compose
> up --build` runs the full web+api+db stack with healthchecks and a complete
> `.env.example`; verified on Windows. (Migrations and seed are **not** run by
> Compose on startup - run them manually first, as the Compose header and the
> "Local development setup" section both instruct.) **Public
> deployment (Vercel web + Render api + Neon db + the existing Clerk
> *Development* instance) is decided (ADR-009, ADR-023), fully planned in
> `docs/deployment-plan.md`, and executed** - live on the free tier at
> <https://dhaka-tesla-pool-demo.vercel.app> (web) and
> <https://dhaka-tesla-pool-av68.onrender.com> (api, `/health` returns ok),
> with Neon PostgreSQL 18 behind it.

- **Objective:** `docker compose up` runs everything; public deployment.
- **Deliverables:** app Dockerfiles, compose wiring (healthchecks; migrations +
  seed are run manually, not on startup), `.env.example` complete, Vercel (web)
  + Render (api) + Neon (db) + the existing Clerk *Development* instance
  configured through the provider dashboards (see `docs/deployment-plan.md`);
  deployment URL in README.
- **Dependencies:** Phases 0–10.
- **Risks:** free-tier cold starts; CORS/cookie config between domains.
- **Tests:** clean checkout → `docker compose up` → health checks pass;
  deployed health + demo credentials work. **Both halves verified** — local
  `docker compose`, and the live deployment at the HTTP level (`/health` ok,
  `/api` auth gate returning 401). Browser-level sign-in and the full
  passenger/driver story remain manual checks, scripted in
  `docs/deployment-plan.md` §17–§18.

## Phase 12 — Documentation / video preparation

> **Status: COMPLETE.** The root README is now the full PRD checklist (summary,
> features, screenshots, architecture + ERD, stack, structure, env, setup,
> run/tests, credentials, API overview, decisions/trade-offs, limitations, next
> steps) with an AI Usage section and a screenshots section, plus the live
> deployment URLs (Phase 11) and the demo video link. The written
> "viral-scale" bonus note (requirements §15) is delivered as
> [`docs/scaling-plan.md`](scaling-plan.md). The docs-consistency pass
> re-grounded all `docs/*.md` against the shipped code.

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