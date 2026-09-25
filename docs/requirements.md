# Dhaka Tesla Pool — Requirements (PRD Interpretation)

> Faithful, implementation-oriented summary of `docs/reference/PRD.pdf`.
> The PRD is the primary source of truth. This document preserves the PRD's
> terminology and does not invent, remove, simplify, or reinterpret requirements.
> Anything not fully specified is listed under [Ambiguities and Assumptions](#6-ambiguities-and-assumptions).

**Source:** `docs/reference/PRD.pdf` — "Dhaka Tesla Pool — Share a seat. Split the fare. Survive Dhaka traffic."

---

## 1. The Product Problem

- Passengers in Dhaka want point-to-point rides and should be able to request a
  ride and, **when it makes sense**, share a three-seat, battery-powered Tesla
  with someone else.
- The driver needs to see **who is assigned to the ride** and **what stage it is at**.
- Each passenger sees only **their own fare and their own status**, never anyone else's.
- Once a ride wraps up, the system must hold enough history to **explain exactly what
  happened** later (e.g., in a dispute).
- Canonical story (used for seed data, tests, demo):
  - **Jashim** drives **Bullet**, his three-seat Tesla.
  - **Nusrat** books Banani → Mohakhali.
  - **Rafiq** books an overlapping-but-not-identical route: Banani → Gulshan 1.
  - **Shirin** tries to grab Bullet's last seat seconds later (the concurrency scenario).
- The cast must be used consistently and not replaced by generic `user1/driver1`
  placeholders.

## 2. Actors

- **Passenger** — Nusrat, Rafiq, Shirin.
- **Driver/Tesla** — Jashim, Bullet.
- **Ride/Pool** — the shared unit of work between passengers and a Tesla.

## 3. Functionality per Actor

### Passenger
- Sign up / sign in.
- Request a ride: pickup, destination, seats.
- See estimated fare.
- Track status: `waiting → matched → in progress → completed/cancelled`.
- View history; cancel **while valid**.

### Driver/Tesla
- Sign in; go **online/offline**.
- Own a Tesla with **fixed capacity**.
- See relevant requests; **accept** a ride/pool.
- Mark **arrival**, **start**, **complete** trip.
- See passengers/seats and ride history.

### Pool/Ride
- **Multiple requests may share one Tesla.**
- **Occupied seats never exceed capacity.**
- Each passenger gets an **individual fare**.
- Clear lifecycle; **obvious pool membership**.

## 4. Ride Lifecycle (state machine)

```
REQUESTED
→ MATCHED/ACCEPTED
→ DRIVER_ARRIVED
→ STARTED
→ COMPLETED
(+ CANCELLED)
```

- The PRD invites improvement **if the improvement can be explained**.
- Invalid state transitions must be rejected.
- **Phase 4 notes** (ADR-015): creating a ride request writes the initial
  journal entry `NULL → REQUESTED` into `ride_status_history`; a REQUESTED ride
  holds no pool and no seats (`REQUESTED` is a seat-hold-free state, so Phase 4
  needs no concurrency locking — the pooling phase adds it, requirements §14).
- **Phase 5 notes** (ADR-016/017): the full lifecycle is declared as an explicit
  state machine (`apps/api/src/rides/state.ts`) with a single transition map;
  every service state change goes through it and invalid moves raise
  `409 INVALID_STATE_TRANSITION`. Phase 5 exercises the automatically-matched
  `REQUESTED → MATCHED` and cancellation `{REQUESTED, MATCHED} → CANCELLED`
  arms. `DRIVER_ARRIVED → STARTED → COMPLETED` are declared in the map now and
  implemented with the driver flow (later phase).

## 5. Geography

- **Do not** fight map APIs or build real routing.
- Keep it simple: a predefined list of Dhaka areas
  (Banani, Gulshan, Mohakhali, Dhanmondi, Mirpur, Uttara, Farmgate, Bashundhara, etc.),
  plain lat/long points, or a lightweight free map.
- **Invent and document a matching rule** (e.g., same pickup zone or compatible routes)
  and apply it **consistently** to Nusrat and Rafiq's overlapping-but-not-identical trip.
- **Realized in Phase 5** (ADR-016): same pickup zone AND all-pairs drop-off
  spread ≤ **2.0 km** (`POOL_DEST_SPREAD_KM`), applied deterministically —
  fullest pool first, then `created_at`, then `id` (see §21.A).

## 6. Fare Model

- Document a **simple, testable** model, e.g.:

      passengerFare = baseFare + distanceCharge − poolDiscount

- **Implemented in Phase 4** (`apps/api/src/fare/`, ADR-015): the deterministic
  estimate is computed for a new ride request and stored per seat in `fares`
  integer paisa. Nusrat `Banani → Mohakhali` = **5932 paisa (BDT 59.32)**;
  Rafiq `Banani → Gulshan 1` = **4140 paisa (BDT 41.40)** — both pinned in
  `test/fare.test.ts` and `test/rides.test.ts`. Formula/rounding:
  `roundHalfUp(haversine × 1.3 × 1200)`; `final = base + distance − discount`
  derived, never independently rounded; a pool discount stays 0 for a
  single-member pool and is applied **in place** once a pool holds ≥ 2 ACTIVE
  members (Phase 5, ADR-017): `poolDiscount = roundHalfUp(25% of (base +
  distance))`, `final = base + distance − discount` — Nusrat lands at **4449
  paisa**, Rafiq at **3105 paisa** (both pinned).
- The evaluator must be able to **verify the calculation by hand** using Nusrat's
  and Rafiq's trip.
- Document **how money is stored** (integer paisa/poysha vs. decimal) and why.
- Payment: **cash** or **simulated TeslaPay wallet** — no real payment gateway needed.

## 7. Technical Scope & Mandated Stack

### Backend — Node.js
- API/resource design, auth, validation, business-logic placement, error handling,
  ride state transitions, pool capacity enforcement, data consistency, code
  organization, logging, basic security.
- REST / GraphQL / other — **explain your choice**.

### Frontend — React or Next.js
- Next.js (App Router) **recommended** for routing/SSR; plain React + router is fine.
- Correct flows/states, clear **loading / error / empty** states, reasonable component
  organization, API integration, usability.
- A simple, clean interface is enough.

### Database — relational store (candidate's choice)
- Postgres / MySQL / SQLite recommended given pooling/capacity needs.
- **Design the schema yourself**: users, Teslas/vehicles + capacity, ride requests,
  pools, pool membership, status/history, fare, optional payment/rating/audit.
- Proper relationships, constraints, indexes, types; be ready to explain every table.

### Docker
- Must run via **`docker compose up`**: app container(s), DB container, `.env.example`,
  migrations, seed data (**use Jashim/Nusrat/Rafiq**), health checks if possible.

### Deployment
- **Free/free-tier only. Do not pay.**
- If free backend hosting is unavailable, document the constraint and provide a
  reproducible Docker deployment.
- **Public deployment preferred.**

## 8. Technology Choice & Justification (for every non-mandated choice)

README must describe, for DB, ORM, auth, styling, tests, hosting:
1. What you picked and the **realistic alternatives**.
2. Why it fits a **ride-pooling MVP specifically**.
3. What would make you **switch** later.

> "A trendy stack you can't defend earns nothing extra."

## 9. AI Usage Policy

- AI (ChatGPT, Claude, Copilot, Cursor, docs, Stack Overflow) is **explicitly allowed**.
- **Never hide AI usage.** AI is a normal engineering tool.
- If AI writes it, **you still own it**: be ready to explain, debug, redesign, or modify
  any part live.
- README "AI Usage" section must state: which tools, what for, **one accepted
  suggestion**, **one rejected/changed suggestion** and why.
- Scoring is on **engineering understanding**, not "least AI used".

## 10. Architecture First

- Think the system through **before** implementing everything.
- Provide an **architecture diagram** (Mermaid / Excalidraw / draw.io / image) showing at
  minimum `Browser → Next.js/React → Node.js API → Database`, **plus an ERD**.
- Implementation should broadly match documented architecture; update docs if it changes.
- **Do not** introduce microservices, Kafka, Kubernetes, Redis, or queues **just to look
  advanced** — add complexity only when there is a reason.

## 11. Git Workflow (part of the assessment)

- Long-lived branches: **`master`**, **`pre-release`**, **`release/<version>`**,
  plus **`feature/*`** branches (e.g. `feature/passenger-auth`,
  `feature/tesla-pooling`, `feature/driver-flow`).
- Flow: build **one logical change** on its feature branch with **incremental commits** →
  merge into **master** when it works → once MVP features integrated, cut **pre-release**
  for integration fixes, docs, deployment checks → cut **release/v1.0.0** from pre-release
  as the version shown in the video/deployment.
- Inspectable, **meaningful history** is required. A perfect final repo with meaningless
  history is weaker than a good repo showing a real engineering journey.

## 12. Commit Message Rules

- Format: `<type>(<scope>): <short description>` with types
  `feat/fix/refactor/test/docs/chore/build`.
- One commit = one understandable logical change.
- **Never** use: `update`, `changes`, `fix`, `final`, `latest`, `working now`, `asdf`.
- Avoid fifty meaningless micro-commits purely to satisfy the rule.

Examples from the PRD:

```
feat(auth): add passenger login endpoint
feat(pool): enforce Bullet's seat capacity
fix(pool): prevent overbooking available seats
build(docker): add compose setup for api and postgres
```

## 13. README Requirements (minimum)

- Summary, problem statement, features implemented, screenshots/GIFs.
- Architecture diagram and ERD/database diagram.
- Tech stack, project structure, prerequisites.
- Environment variables (`.env.example`, **never real secrets**).
- Local setup, Docker instructions, migration/seed instructions.
- How to run frontend/backend and tests; **demo credentials**.
- Deployment URL, API overview, key decisions/trade-offs, known limitations, next improvements.
- **AI Usage** section and **demo video link**.

## 14. Testing (meaningful, not coverage-chasing)

Must cover at minimum:
1. **Bullet's capacity can never be exceeded.**
2. **Invalid state transitions are rejected.**
3. **Nusrat's and Rafiq's pooled fares calculate correctly.**
4. **Users can't modify another user's ride.**
5. **Cancellation rules hold.**
6. **Two concurrent requests can't corrupt pool capacity.**

### The Concurrency Problem (explicitly stated)
- Bullet has **1 seat left**; Nusrat and Shirin both try to claim it at nearly the same
  instant; both initially see one seat available.
- The MVP **doesn't need a distributed solution**, but the design must consider data
  consistency — document how it's handled now and what would change at larger scale.
- Expect this in the interview.

## 15. Bonus — "If Oi Tesla Goes Viral"

Without over-building the MVP, reason through scaling to **1M passengers / 100k drivers**:
load balancing, horizontal scaling, DB indexing/read replicas, caching, geospatial search,
queues/events, real-time communication, rate limiting, idempotency, observability, DB
contention, ride matching, retry/failure strategy, security, deployment strategy.
A diagram is encouraged; reasoning matters more than box count.

## 16. Six-Minute Final Video

Max 6 minutes, free tool (Loom or similar), linked prominently in README:
- **0:00–1:00** — your understanding of the problem, users, core idea in your own words
  (don't recite the PRD).
- **1:00–3:00** — how you engineered it: architecture, backend, frontend, database design,
  ride/pool lifecycle, one key decision, one trade-off; show the architecture/ERD.
- **3:00–6:00** — product tour: passenger flow, driver flow, shared-Tesla/pooling,
  fare/status, one interesting edge case, deployment if available.

## 17. Submission Checklist

- Public/evaluator-accessible repo with a **working MVP** (frontend + backend + database).
- Docker setup, `.env.example`, **no secrets committed**.
- Migrations and seed/demo data using the **story cast**.
- Architecture diagram **and** ERD.
- `master` / `pre-release` / `release/v1.0.0` branches with meaningful, incremental history.
- Tests for important behavior, self-explanatory README, deployment link if available.
- Six-minute video link, AI Usage section, viral-scale bonus if attempted.

## 18. Evaluation Criteria

- **Product understood** — understood the problem, sensible assumptions.
- **Process followed** — followed the instructions, git engineering, traceability.
- **Backend/DB** — API/state/validation design; modeling, constraints, integrity.
- **Frontend** — correct flows/states, integration, maintainability.
- **Docker/Deploy** — runs reliably elsewhere; **shipped, not just coded**.
- **Testing/Docs** — tested what's risky; another engineer can operate it.
- **Ownership** — can explain, defend, and change your own code.
- **Following instructions is a major, explicit part of the score.**

## 19. What NOT to Do (explicitly forbidden)

- Pay for infrastructure/services for this challenge.
- Commit API keys, passwords, tokens, or `.env` secrets.
- Submit a single giant "initial commit" containing the finished system.
- Push all feature development directly to master.
- Add technologies only to make the architecture diagram look impressive.
- Polish animations while core data integrity is broken.
- Hide AI usage, or include code you cannot explain.
- Strip the story cast out of seed data/tests/README in favor of generic placeholders.

## 20. Assumptions Are Allowed

- Some requirements are **intentionally not fully specified**. When unclear:
  **make a reasonable assumption, document it, implement it consistently, and be ready to
  explain it.**
- "Why did you assume that?" is how the evaluator learns how you think.

## 21. Ambiguities and Assumptions

The following PRD requirements are not fully specified. Each is quoted/paraphrased,
the ambiguity is explained, and one reasonable MVP assumption is proposed.
**Nothing here is final until confirmed.**

### A. Pool matching rule ("invent … a matching rule")
- PRD: "Invent and document a matching rule (e.g. same pickup zone or compatible routes), and apply it consistently to Nusrat and Rafiq's overlapping-but-not-identical trip."
- Ambiguity: No concrete rule is given; only examples.
- MVP assumption (finalized in Phase 5, ADR-016): **Same pickup zone AND
  all-pairs drop-off spread ≤ `POOL_DEST_SPREAD_KM` (2.0 km)**, where the
  spread is the maximum pairwise haversine distance among the given ride's and
  every ACTIVE pool member's destination points. An existing eligible pool is
  always preferred over creating a new one; the pool choice is fully
  deterministic (**fullest first** — `occupiedSeats DESC, created_at ASC, id
  ASC`) so concurrent requests converge on the same Tesla. Applied to the story:
  Nusrat (Banani → Mohakhali) and Rafiq (Banani → Gulshan 1) share a pool
  (spread ≈ 1.906 km); Banani → Dhanmondi does **not** (≈ 4.6 km from the pool).
  The rule is pure and unit-tested (`test/matching.test.ts`), with no routing
  engine — only predefined zone points (§5).

### B. Cancellation rules ("cancel while valid")
- PRD: "cancel while valid" (passenger).
- Ambiguity: What cancellations are valid, by whom, and under what state conditions?
- MVP assumption (finalized in Phase 5, ADR-016/017): A passenger may cancel
  their own ride while it is `REQUESTED` or `MATCHED`; cancellation is rejected
  for every other state (`409 INVALID_STATE_TRANSITION`) and for any ride the
  caller does not own (`404 NOT_FOUND`, never a leak). A `REQUESTED` cancel
  just terminates the request. A `MATCHED` cancel frees the seats by flipping
  the membership to `LEFT` (recorded with `left_at`), recomputes the remaining
  members' fares in place, and terminates the pool when it becomes empty. No
  `cancel_reason` column (the PRD only requires "cancel while valid" — a reason
  would be speculative UI). **Forced cancellation** (driver/admin action,
  `forceCancelRide`, no route yet) applies the same pool semantics plus a
  **full refund**: the cancelled ride's fare is written back to zero via its
  discount term (`final = base + distance − discount`, all CHECKs satisfied).
  This assumption supersedes the earlier draft that always required a recorded
  reason.

### C. Pool creation timing ("Multiple requests may share one Tesla")
- PRD: Pool is a first-class actor; a ride may contain multiple passengers.
- Ambiguity: Is a pool created when a passenger requests, or only when the driver accepts / when a second passenger matches?
- MVP assumption (finalized in Phase 5, ADR-016): A `REQUESTED` ride holds no
  seats until it is matched. Matching runs **inside the create-ride
  transaction** (ride + fare + history + membership commit together): the ride
  is either joined to the best eligible existing pool or placed into a newly
  created pool, and the ride becomes `MATCHED` with a committed membership —
  seats are only ever consumed by an ACTIVE membership. **Phase 5 has no driver
  "accept" step**: allocation happens at match time, so a pool begins life in
  `MATCHED` (`DRIVER_ARRIVED`/accept flows arrive with the driver phase).

### D. Exact fare parameters
- PRD: `passengerFare = baseFare + distanceCharge − poolDiscount`; must be hand-verifiable.
- Ambiguity: No values for baseFare, per-km charge, or poolDiscount.
- MVP assumption (**realized in Phase 4, ADR-015; discount realized in Phase 5, ADR-017**): Paisa (int) based:
  `baseFare = 3000 paisa (30 BDT)`, `distanceCharge = 1200 paisa/km (12 BDT/km)`,
  and for a pooled ride `poolDiscount = 25% of (baseFare + distanceCharge)`
  rounded **round-half-up** (deterministic; exact rule documented in ADR-015).
  Parameters are code constants (`apps/api/src/fare/constants.ts`), env-configurable
  later. Full formula and worked example published in README and docs/database.md.

### E. Driver ownership of vehicles ("Own a Tesla with fixed capacity")
- PRD: Driver owns a Tesla with fixed capacity.
- Ambiguity: One or many vehicles per driver?
- MVP assumption: A driver can own **one or more** Teslas (users ↔ vehicles 1:N), but for the MVP a driver operates one Tesla at a time (an active/selected vehicle). This keeps the schema honest without over-building.

### F. Session expiration policy
- PRD: Auth required; no policy specified.
- Ambiguity: Session lifetime and sliding vs. fixed.
- MVP assumption (**superseded by the Clerk decision, ADR-013**): Clerk is the
  identity provider and owns the session lifecycle (sign-in/sign-up UI,
  cookie/JWT issuance, refresh, revocation, expiry). The API keeps **no**
  session state — every authenticated request re-verifies the bearer token with
  `authenticateRequest()` (`apps/api/src/auth/provider.ts`) and resolves the
  local user + PostgreSQL role. Clerk's default session duration (~60 days, MSL
  sliding) applies to the web app; the API treats tokens, not sessions, as the
  unit of trust. Original assumption for the discarded manual auth: app-owned
  DB cookie sessions, fixed 7-day lifetime, invalidated on logout/password
  change, `HttpOnly`/`Secure` (prod)/`SameSite=Lax`.

### G. Map visualization behavior
- PRD: predefined list of Dhaka areas / lat-long points / lightweight free map; do not fight map APIs.
- Ambiguity: What exactly the map shows and how interactive it must be.
- MVP assumption: Map is **visualization only** (display of predefined zones + matched route markers). Static zone selection via dropdown/buttons rather than map picking; Leaflet + OSM renders zones and route polylines. No routing, geocoding, or dragging of pins.

### H. Route-distance approximation
- PRD: fare needs distanceCharge; no routing.
- Ambiguity: How to compute distance without a routing engine.
- MVP assumption (**realized in Phase 4, ADR-015**): Great-circle (haversine)
  distance between predefined zone lat/long points, multiplied by a documented
  road-factor constant (**1.3**) to approximate road distance. Deterministic and
  hand-checkable; implemented in `apps/api/src/fare/calculate.ts`.

### I. Ride-history immutability
- PRD: "hold onto enough history to explain exactly what happened."
- Ambiguity: Is history append-only / immutable?
- MVP assumption: Completed and cancelled rides are **presentation-immutable**: fares and status transitions are recorded as stored values (fare snapshots + status history table), never recomputed from later parameter changes. Fare parameters may change only for new rides. **Lifecycle recomputes during pooling are NOT parameter drift** (ADR-015/017): a fare's base/distance are frozen at creation, and only the *derived* discount/final are rewritten in place on a join/leave/force-cancel — the same row, `fares.updated_at` bumped, all CHECKs recomputed to hold.

### J. Driver going offline with active rides
- PRD: driver can go online/offline.
- Ambiguity: Behavior when a driver with an accepted/active ride goes offline.
- MVP assumption: A driver cannot go offline with an active (ACCEPTED → STARTED) ride; the API rejects the transition. Eventual behavior (auto-cancel vs. keep active) is documented and flagged for confirmation.

### K. Seats requested per passenger ("…seats" in request)
- PRD: "Request ride: pickup, destination, seats."
- Ambiguity: Can one passenger reserve >1 seat, and does each seat get its own fare?
- MVP assumption: A ride request declares a number of seats (1–3); passengerFare applies **per seat requested** (per-person fare is the unit documented/tested). Rarely used >1 in MVP but modeled correctly.

---

## 22. PRD Priorities Summary

| Category | Items |
|---|---|
| **Mandatory** | Node.js backend, React/Next.js frontend, relational DB, own schema (users/vehicles/requests/pools/membership/history/fare), `docker compose up`, migrations + cast seed data, fare model, state machine, capacity enforcement, per-passenger fares, auth, tests for the 6 required behaviors, architecture diagram + ERD, git workflow (master/pre-release/release + feature), commit format, README requirements, AI Usage section, video, .env.example, no secrets, no paying. |
| **Recommended** | Next.js App Router, Postgres, health checks, meaningful history, public deployment. |
| **Optional/Bonus** | Scaling analysis ("Oi Tesla goes viral"), traffic/weather/vehicle fare rules, payment/rating/audit tables, free-lightweight map visualization, deployment link. |
| **Forbidden/unwanted** | Paying for infra, committing secrets, single giant commit, all-dev-on-master, decorative tech stack (microservices/Kafka/K8s/Redis/queues without reason), animation-polish over data integrity, hiding AI, unexplained code, stripping the cast. |