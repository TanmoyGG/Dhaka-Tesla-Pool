# apps/web — Dhaka Tesla Pool frontend

Next.js 15 (App Router) + React 19 + TypeScript (npm workspace
`@dhaka-tesla-pool/web`).

## Current state (Phase 1)

- Minimal App Router foundation: `app/layout.tsx`, `app/page.tsx` (a phase-1
  status page — no business features), `app/globals.css`.
- Development server, production build, type check, and lint all work.

## Scripts

```bash
npm run dev           # next dev (http://localhost:3000)
npm run build         # next build
npm run start         # next start
npm run typecheck     # tsc --noEmit
npm run lint          # eslint (next/core-web-vitals)
```

Frontend tests (Vitest unit + Playwright E2E) arrive with the frontend
implementation phase, as planned in docs/development-plan.md.

See root [README.md](../../README.md) for full setup instructions.