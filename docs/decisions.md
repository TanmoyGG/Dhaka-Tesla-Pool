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

## ADR-006: Application-owned auth (cookies + Argon2id)

- **Decision:** Our own session auth: Argon2id password hashes, random opaque
  session tokens stored in DB, `HttpOnly` `SameSite=Lax` cookies, role-based
  authorization (passenger/driver).
- **Alternatives:** Auth0/Clerk/Supabase Auth (external), JWT stateless.
- **Why now:** PRD asks us to *design auth ourselves* and justify the choice;
  the surface (email + password + role) is small. Server-side sessions are
  trivially revocable and keep password/session policy in our control, with no
  third-party dependency. Argon2id is the OWASP-recommended hash.
- **Trade-offs:** We own security; must get CSRF/cookie flags right. JWT would
  be stateless but adds revocation complexity. External auth adds cost/vendor
  lock-in and another moving part — forbidden-ish for a simple MVP.
- **Switch later if:** Product demands social login / SSO or strong MFA; then
  consider a managed provider.

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
  a no-op. Placeholder `password_hash` values until the auth phase.
- **Migration files are generated, reviewed, committed unmodified.** No manual
  SQL edits without a documented reason.

**What is deliberately app-enforced (documented, not DB triggers):** driver-only
vehicle ownership, pool driver = vehicle driver, occupancy vs capacity (multi-row
transaction), and state-transition legality (state machine). Rationale:
CHECK constraints can't reference other tables, and triggers would duplicate the
service logic the PRD asks us to own — see `docs/database.md` §5.10 and §7.