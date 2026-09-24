# AGENTS.md — Persistent Engineering Instructions

This file is the persistent instruction set for any coding agent working on this
repository. Read it before writing code.

## PROJECT CONTEXT

**Dhaka Tesla Pool** is a ride-pooling MVP for Dhaka. Battery-powered,
three-seat "Teslas" (easy-bike style, unaffiliated) carry multiple passengers
from predefined Dhaka zones. The tagline: *Share a seat. Split the fare.
Survive Dhaka traffic.*

The canonical story cast is used **consistently** in seed data, tests, demo,
and docs: **Jashim** drives his three-seat Tesla **Bullet**; **Nusrat** books
Banani → Mohakhali; **Rafiq** books Banani → Gulshan 1 (overlapping, not
identical); **Shirin** tries to grab Bullet's last seat moments later
(the concurrency case). Do not replace them with generic `user1/driver1`
placeholders.

## SOURCE OF TRUTH

- `docs/reference/PRD.pdf` — the **primary source of truth**.
- `docs/requirements.md` — the implementation-oriented interpretation of the PRD.
- If implementation conflicts with the PRD, **review the PRD before changing
  requirements**. Do not silently invent, remove, simplify, or reinterpret
  requirements. Flag ambiguities and propose assumptions in writing first.
- Subsequent docs (`architecture.md`, `database.md`, `decisions.md`,
  `development-plan.md`) record intent and reasoning; update them when
  implementation meaningfully changes.

## ENGINEERING PRINCIPLES

- Keep the MVP simple.
- Prefer understandable engineering over unnecessary abstraction.
- No premature microservices.
- No unnecessary Redis.
- No Kafka.
- No Kubernetes.
- No unnecessary queues.
- No unnecessary third-party services.
- Data integrity takes priority over visual polish.
- Backend must enforce business rules.
- Never trust frontend validation alone.
- Database constraints should enforce important invariants where appropriate.
- Important state transitions must be explicit.
- Concurrency must be considered.
- Every implementation decision should be explainable by the developer.
- Never introduce a dependency without a reason.
- AI is allowed but never hidden, and any AI-generated code must be fully
  understood by the engineer who owns it (see README "AI Usage" requirements).

## CURRENT PROPOSED STACK

> Current proposed choices — **not immutable requirements**. If a strong,
> PRD-specific reason to change arises, document the reason in
> `docs/decisions.md` before changing.

- **Frontend:** Next.js (App Router), React, TypeScript, Tailwind CSS,
  shadcn/ui, TanStack Query, React Hook Form, Zod, Leaflet + OpenStreetMap.
- **Backend:** Node.js, Fastify, TypeScript, REST API, Zod, Pino.
- **Database:** PostgreSQL, Drizzle ORM.
- **Authentication:** application-owned cookie-based sessions, Argon2id password
  hashing, role-based authorization (passenger / driver).
- **Testing:** Vitest, Fastify integration/API tests, Playwright for important
  end-to-end flows.
- **Infrastructure:** Docker, Docker Compose, GitHub Actions.
- **Deployment targets:** Vercel (Next.js frontend), Render (Node.js backend),
  Neon (PostgreSQL). Free tier only — never pay.

## ARCHITECTURE PRINCIPLES

Intended MVP architecture is a **modular monolith**:

```
Browser
  → Next.js (apps/web)
  → Node.js/Fastify API (apps/api)
  → PostgreSQL
```

- Do not introduce microservices.
- Keep business logic on the backend.
- The frontend must **not** directly access PostgreSQL.

## DATABASE PRINCIPLES

The database must properly model:
users, vehicles/Teslas (+ fixed capacity), ride requests, pools, pool membership,
ride status/history, fares, sessions, and optional audit information.

Important invariants (must be enforced):
- Pool capacity can never be exceeded.
- A passenger cannot modify another passenger's ride.
- Invalid ride state transitions must be rejected.
- Pool membership must be explicit.
- Individual passenger fares must be preserved.
- Historical ride information must remain explainable.

Money should be represented as **integer paisa/poysha**, never floating-point.

## RIDE STATE MACHINE

PRD lifecycle (see `docs/requirements.md` section 4):

```
REQUESTED
→ MATCHED/ACCEPTED
→ DRIVER_ARRIVED
→ STARTED
→ COMPLETED
(+ CANCELLED)
```

Implementation must make state transitions explicit and reject invalid ones.
Document and honor cancellation-validity assumptions (see requirements §21.B).

## CONCURRENCY

The system must handle two passengers simultaneously claiming the final
available seat (Nusrat vs. Shirin on Bullet's last seat). The MVP does **not**
require a distributed solution. Preferred design direction: **database-backed
transactional consistency** — PostgreSQL transactions with appropriate row
locking (`SELECT … FOR UPDATE` on pool/vehicle seat counts). Document the
approach and what would change at larger scale before implementing. Expect this
topic in evaluation (see `docs/requirements.md` §14, §15).

## GEOGRAPHY

- No real navigation/routing system.
- MVP uses **predefined Dhaka zones** (Banani, Gulshan, Mohakhali, Dhanmondi,
  Mirpur, Uttara, Farmgate, Bashundhara, …) with plain lat/long points.
- A free map visualization (Leaflet + OpenStreetMap) is allowed/preferred; it is
  for **visualization only**.
- A documented, consistently applied matching rule is required (proposal in
  `docs/requirements.md` §21.A).

## GIT WORKFLOW

- Long-lived branches: **`master`**, **`pre-release`**, **`release/v1.0.0`**.
- Feature branches: `feature/<feature-name>` (e.g. `feature/passenger-auth`,
  `feature/tesla-pooling`, `feature/driver-flow`).
- Do not develop everything directly on `master`.
- Use incremental, logical commits.
- Commit format: `<type>(<scope>): <short description>`
  with types `feat/fix/refactor/test/docs/chore/build`.

```text
feat(auth): add passenger login
feat(pool): enforce vehicle seat capacity
fix(pool): prevent pool overbooking
build(docker): add postgres compose service
test(pool): add concurrent seat allocation test
docs(readme): document architecture decisions
```

- Never use meaningless messages: `update`, `changes`, `fix`, `final`,
  `latest`, `working now`, `asdf`.
- Do not create fake micro-commits merely to produce history.

## AI USAGE

- AI coding agents are explicitly allowed by the PRD.
- Never hide AI usage.
- The README must eventually document: which AI tools were used, what for,
  at least one accepted AI suggestion, at least one rejected or modified AI
  suggestion, and why.
- The developer must understand all generated code.
- Do not generate code that cannot later be explained, debugged, redesigned, or
  modified.

## TESTS REQUIRED (per PRD)

Meaningful tests (not coverage-chasing) must cover:
1. Bullet's capacity can never be exceeded.
2. Invalid ride state transitions are rejected.
3. Nusrat's and Rafiq's pooled fares calculate correctly.
4. Users can't modify another user's ride.
5. Cancellation rules hold.
6. Two concurrent requests can't corrupt pool capacity.