# Dhaka Tesla Pool

*Share a seat. Split the fare. Survive Dhaka traffic.*

## Status

**Initialization / architecture phase** — the engineering foundation is
established. **No application features are implemented yet.** Implementation
proceeds incrementally through feature branches (see Development Approach).

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

A modular monolith, per the PRD's "Architecture First" requirement:

```
Browser
  → Next.js (apps/web)
  → Node.js/Fastify API (apps/api)
  → PostgreSQL
```

The frontend never talks to PostgreSQL directly; all business rules live in the
API. See [docs/architecture.md](docs/architecture.md) for the diagram.

## Planned Technology Stack

> Proposed choices, recorded as ADRs in [docs/decisions.md](docs/decisions.md).
> Not immutable; any change is documented with a reason.

- **Frontend:** Next.js (App Router), React, TypeScript, Tailwind CSS,
  shadcn/ui, TanStack Query, React Hook Form, Zod, Leaflet + OpenStreetMap.
- **Backend:** Node.js, Fastify, TypeScript, REST, Zod, Pino.
- **Database:** PostgreSQL, Drizzle ORM, integer paisa/poysha money.
- **Auth:** application-owned cookie sessions, Argon2id, role-based (passenger/driver).
- **Testing:** Vitest, Fastify integration tests, Playwright E2E.
- **Infrastructure:** Docker, Docker Compose, GitHub Actions.
- **Deployment:** Vercel, Render, Neon — free tier only.

## Repository Structure

```
apps/
  web/        Next.js frontend (placeholder — scaffolded in Phase 1)
  api/        Fastify backend  (placeholder — scaffolded in Phase 1)
docs/
  reference/PRD.pdf   primary source of truth (unmodified)
  requirements.md     implementation-oriented PRD interpretation
  architecture.md     proposed architecture
  database.md         proposed entities/invariants
  decisions.md        ADR-style technology decisions
  development-plan.md phased implementation plan
.github/workflows/    CI skeleton
```

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

## AI Usage

AI coding tools are explicitly allowed by the PRD and will be used as a normal
engineering tool — never hidden. Per the PRD, this README will eventually
document which AI tools were used, for what, one accepted suggestion, and one
rejected or modified suggestion with reasons, once features are implemented.
The human engineer owns and must be able to explain every line of code.