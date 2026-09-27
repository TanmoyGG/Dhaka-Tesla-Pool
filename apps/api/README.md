# apps/api — Dhaka Tesla Pool API

Fastify 5 + TypeScript REST API (npm workspace `@dhaka-tesla-pool/api`).

## Current state

Fastify backend implementing the full MVP surface: Clerk bearer
authentication + first-request provisioning (`src/auth/`), ride requests with
deterministic fares (`src/rides/`, `src/fare/`), pool matching, lifecycle and
concurrency (`src/rides/pooling/`, `src/matching/`), and the driver flow —
online/offline switch, waiting-requests lobby with first-wins accept,
arrive/start/complete (`src/driver/`, ADR-022). Schema, migrations
(0000–0007), and the deterministic cast seed live in `src/db/` and `drizzle/`.
`GET /health` stays public; everything under `/api` verifies the bearer token.

## Scripts

```bash
npm run dev           # tsx watch (auto-loads repo-root .env)
npm run build         # tsc -> dist/
npm start             # node dist/server.js
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm test              # vitest run
npm run db:check      # SELECT 1 against DATABASE_URL
npm run db:generate   # drizzle-kit generate (schema diff -> migration)
npm run db:migrate    # apply ./drizzle migrations
```

See root [README.md](../../README.md) for full setup instructions.