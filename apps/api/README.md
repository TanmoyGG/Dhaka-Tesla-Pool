# apps/api — Dhaka Tesla Pool API

Fastify 5 + TypeScript REST API (npm workspace `@dhaka-tesla-pool/api`).

## Current state (Phase 1)

- Application bootstrap (`src/app.ts`) and server entry point (`src/server.ts`).
- Environment configuration with sensible dev defaults (`src/config.ts`).
- Structured logging via Fastify's Pino logger.
- JSON error envelope for errors and unknown routes.
- `GET /health` liveness endpoint.
- Drizzle ORM foundation: client (`src/db/index.ts`), connectivity check
  (`npm run db:check`), migration runner (`npm run db:migrate`), empty schema
  (`src/db/schema.ts` — schema arrives in the database phase).

## Scripts

```bash
npm run dev           # tsx watch
npm run build         # tsc -> dist/
npm start             # node dist/server.js
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm test              # vitest run
npm run db:check      # SELECT 1 against DATABASE_URL
npm run db:generate   # drizzle-kit generate (needs schema, Phase 2+)
npm run db:migrate    # apply ./drizzle migrations
```

See root [README.md](../../README.md) for full setup instructions.