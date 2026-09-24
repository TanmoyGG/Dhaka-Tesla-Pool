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

- **Objective:** Reproducible scaffolding for both apps and CI.
- **Deliverables:** `apps/api` + `apps/web` real scaffolds (package.json, tsconfig,
  entrypoints with a health route/screen), `docker-compose.yml` full app stack,
  Postgres healthcheck + persistent volume, `.env.example` wired for compose,
  CI jobs wired to lint/typecheck.
- **Dependencies:** Phase 0; Docker Desktop installed locally.
- **Risks:** workspace hoisting quirks; Docker availability on machines.
- **Tests:** `GET /health` returns ok; `docker compose up` reaches the
  "everything up" state.

## Phase 2 — Database

- **Objective:** Schema, migrations, and seed data for the entities in
  `docs/database.md`.
- **Deliverables:** Drizzle schema for User, Session, Vehicle/Tesla, Zone,
  Ride Request, Pool, Pool Member, Fare, Ride Status History (audit optional);
  initial migration; seed script using **Jashim/Bullet/Nusrat/Rafiq/Shirin**;
  DB-level constraints for capacity and state.
- **Dependencies:** Phase 1; DB protocol questions (docs/database.md §5)
  resolved.
- **Risks:** locking semantics for seat counts; constraints too loose to
  actually block overbooking.
- **Tests:** migration applies cleanly; seed runnable both in compose and
  locally; capacity/state constraints reject bad rows.

## Phase 3 — Authentication

- **Objective:** Register/login/logout with role-based sessions.
- **Deliverables:** Argon2id hashing, session cookie lifecycle, passenger/driver
  roles, `GET /me`, auth middleware, role guard.
- **Dependencies:** Phase 2.
- **Risks:** cookie flags (HttpOnly/SameSite/Secure); CSRF on cookie auth.
- **Tests:** register→login→me→logout; wrong password rejected; expired/invalid
  session rejected; role guard denies cross-role access.

## Phase 4 — Passenger ride requests

- **Objective:** Passenger can request a ride and see estimated fare/status.
- **Deliverables:** `POST /rides` (pickup, destination, seats), status view,
  estimated fare computed by the fare module, REQUESTED state only.
- **Dependencies:** Phases 2, 3.
- **Risks:** fare formula drift vs. docs; zone validation.
- **Tests:** request creation validates zones/seats; estimated fare matches by-hand
  calculation.

## Phase 5 — Pool matching

- **Objective:** Documented matching rule (requirements §21.A) groups compatible
  requests into a pool on one Tesla.
- **Deliverables:** matching service, pool creation/join, `MATCHED/ACCEPTED`,
  explicit `pool_members`, seat accounting.
- **Dependencies:** Phases 3, 4.
- **Risks:** matching rule edge cases (Nusrat/Rafiq overlap but mismatch);
  one-active-pool-per-vehicle guarantee.
- **Tests:** Nusrat+Rafiq match; incompatible trips not matched; seats never
  exceed capacity on join.

## Phase 6 — Driver flow

- **Objective:** Driver online/offline, accepts a ride/pool, marks
  `ARRIVED → STARTED → COMPLETED`, sees seats/history.
- **Deliverables:** driver dashboard endpoints, accept, mark-arrived, start,
  complete; busy-vehicle guard; online/offline state.
- **Dependencies:** Phases 4, 5.
- **Risks:** state machine enforcement; driver seeing only their own vehicles.
- **Tests:** full happy-path lifecycle; invalid transitions rejected
  (e.g., STARTED before ARRIVED); offline driver cannot take new work; going
  offline with an active ride is blocked.

## Phase 7 — Fare calculation

- **Objective:** Correct, documented, hand-verifiable per-passenger fares.
- **Deliverables:** fare module implementing
  `passengerFare = baseFare + distanceCharge − poolDiscount` in integer
  paisa/poysha; fare snapshots persisted per passenger; worked example (Nusrat,
  Rafiq pooled) in README.
- **Dependencies:** Phases 4, 5 (pooled trip needed).
- **Risks:** rounding choice; distance approximation constant (requirements
  §21.D/H).
- **Tests:** Nusrat and Rafiq's pooled fares match the published by-hand example;
  precision is integer-based; snapshots are stable.

## Phase 8 — Concurrency / data integrity

- **Objective:** Seat-claim race cannot corrupt capacity (Nusrat vs. Shirin).
- **Deliverables:** transactional seat allocation (`SELECT … FOR UPDATE` +
  recheck + constraint), documented approach and large-scale alternative
  (requirements §14).
- **Dependencies:** Phases 5, 6.
- **Risks:** deadlocks; choosing the right lock scope.
- **Tests:** required behavioral test #6 — two concurrent claims on 1 remaining
  seat; exactly one succeeds; capacity intact.

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