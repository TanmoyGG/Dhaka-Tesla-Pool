# apps/web — Dhaka Tesla Pool frontend

Next.js 15 (App Router) + React 19 + TypeScript (npm workspace
`@dhaka-tesla-pool/web`).

## Current state

Full MVP UI (ADR-021/022): Clerk sign-in/sign-up themed dark, role-aware
navigation, a passenger flow (book with a live pre-booking estimate,
active-trip banner, pooled-fare breakdown, two-step cancel), and a driver hub
(online/offline switch, waiting-requests lobby with first-wins accept,
arrive/start/complete, trip history). Always-dark plain-CSS design system in
`app/globals.css` — no Tailwind/shadcn (ADR-021 §4). Vitest + RTL tests cover
the rules helpers and key interaction flows (see [docs/decisions.md](../../docs/decisions.md)
ADR-021).

## Scripts

```bash
npm run dev           # next dev (http://localhost:3000; loads repo-root .env)
npm run build         # next build
npm run start         # next start
npm run typecheck     # tsc --noEmit
npm run lint          # eslint (next/core-web-vitals)
```

See root [README.md](../../README.md) for full setup instructions.