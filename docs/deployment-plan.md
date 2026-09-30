# Deployment Plan — Dhaka Tesla Pool (Public Demo Deployment)

> Implementation-specific plan for the **first public demo deployment** of the
> MVP, derived from a read-only audit of the repository.
>
> **Target:** Vercel (web) → Render (API) → Neon (PostgreSQL) + **Clerk
> Development instance**.
> **Status: DEPLOYED.** The public demo is live on the free tier:
>
> | Host | URL |
> |---|---|
> | Web (Vercel) | `https://dhaka-tesla-pool-demo.vercel.app` |
> | API (Render) | `https://dhaka-tesla-pool-av68.onrender.com` |
> | Health probe | `https://dhaka-tesla-pool-av68.onrender.com/health` |
> | Database | Neon PostgreSQL **18**, direct (non-pooled) |
>
> `<VERCEL_URL>` / `<RENDER_API_URL>` below are retained as **template
> placeholders** in the reproducible setup, configuration, and deployment
> sections (§6–§7, §9–§10, §13, §16). They are intentional, not unresolved
> gaps. The live values are in the table above and are used verbatim in the
> as-deployed verification steps (§17–§18).
> **Costs: free tier only** — never pay (AGENTS.md).
>
> ### This is a public testing/demo deployment, not a commercial production launch
>
> This is the single most important framing in this document:
>
> - **The existing Clerk *Development* instance is retained.** No Clerk
>   Production instance is created, cloned, or promoted.
> - **The existing 7 Clerk Development users are retained.** No second set of
>   Clerk users is created.
> - **Clerk Development keys (`pk_test_…` / `sk_test_…`) are used** as-is.
> - **Clerk's Development banner is expected and acceptable** for this build.
> - **The 7 canonical Clerk user IDs are mapped into the newly created Neon
>   database** using `apps/api/scripts/map-cast-clerk-ids.sql`. There is no
>   "production" ID migration — the same script already carries the correct IDs.
> - **Public sign-up is enabled.** New public users are provisioned as
>   **PASSENGER** (this is existing behaviour; see `auth/provision.ts` and
>   `auth/user-resolver.ts`).
> - **Driver registration is intentionally unavailable.** Driver testing uses the
>   4 public demo driver accounts, surfaced by the landing page's
>   "Credentials for Testing" modal.
> - Deployment uses the **free `*.vercel.app` domain**. No custom domain.
>
> Known trade-offs of the development-instance choice are recorded in
> `decisions.md` (ADR-009) and repeated in §15.

Every finding below is traced to a file and line so a later engineer can verify
it without guessing. Where the repository cannot settle a question (live
provider pricing, Vercel monorepo behaviour), that is called out explicitly
instead of being invented.

Related: [architecture.md](architecture.md) · [database.md](database.md) ·
[decisions.md](decisions.md) · [development-plan.md](development-plan.md) ·
[frontend-design.md](frontend-design.md) · [PRD.pdf](reference/PRD.pdf)

---

## 1. Verdict — can it be deployed as-is?

**Yes, after the approved one-line port change (already landed in
`apps/api/src/config.ts`).** Everything else is configuration plus manual cloud
setup.

| # | Item | Status |
|---|---|---|
| 1 | `apps/api/src/config.ts:39` read only `API_PORT`; Render injects `PORT`. The API would bind 3001 and Render's router could never reach it. | ✅ **Fixed** — `readPort(env.API_PORT ?? env.PORT, 3001)`, covered by `apps/api/test/config.test.ts` |
| 2 | Render's default health-check path is `/`; the API has **no `/` route** (only `/health`). The deploy would be marked unhealthy. | ⚠️ **Manual** — set Health Check Path to `/health` in the Render dashboard |
| 3 | Clerk **Production** instance + keys | ✅ **Not needed** — the existing Development instance is used (§9) |
| 4 | Clerk must issue session tokens for a `*.vercel.app` origin | ⚠️ **Manual** — add the origin to the Clerk instance's allowed origins (§9) |
| 5 | Public sign-up needs `username` (see §3) | ✅ **Done in Clerk** — Sign-up with username: enabled; Require username: enabled. **No application code change.** |
| 6 | Vercel monorepo root-directory/install behaviour is unverified against this npm-workspaces layout. | Medium — first attempt `apps/web`, documented fallback in §6 |
| 7 | `docs/development-plan.md` (Phase 11) claims Compose runs migrations + seed on startup; `docker-compose.yml` does not. | ✅ Corrected |

Schema, migrations, auth architecture, role model, provisioning, CORS, matching,
pooling, fares, ride lifecycle, and the build pipeline all need **no change**.

---

## 2. Target architecture

```mermaid
flowchart LR
  U["Browser (passenger / driver)"] -->|"HTML / JS"| V["Vercel — Next.js 15<br/>apps/web · *.vercel.app"]
  U -->|"HTTPS + Authorization: Bearer &lt;Clerk token&gt;"| R["Render — Fastify 5<br/>apps/api (Node) · dhaka-tesla-pool-av68.onrender.com"]
  U -->|"Clerk UI / session"| C["Clerk DEVELOPMENT instance<br/>pk_test_… / sk_test_…"]
  R -->|"postgresql:// (TLS, direct)<br/>max:1 connections"| N["Neon PostgreSQL 18<br/>free tier"]
  R -->|"token verification"| C
  R -->|"GET /health"| M["Render health check"]
```

Data flow is browser-originated: the browser loads the app from Vercel, holds
the Clerk session token, and calls the Render API **directly, cross-origin** —
Vercel does not proxy API traffic. **Vercel never talks to the database, and
the browser never talks to Neon.**

---

## 3. Current-state audit (what the repository actually says)

**Build/CI (green, Node 24).** `.github/workflows/ci.yml` runs
`npm ci` → `lint` → `typecheck` → `test` → `build` for both workspaces.
`apps/api` compiles TypeScript → `dist/server.js` (ESM / NodeNext).
`apps/web` → `.next`. Root `engines.node` is `>=20`; CI and both Dockerfiles
use Node 24.

**API routes (verified).** `health.ts:4` `/health` (public);
`auth/routes.ts:34` `/me`; `:68` `/zones`; `:60,74` `/driver/availability`;
`:80` `/driver/pools`; `:88` `/driver/pools/available`; `:95`
`/driver/pools/history`; plus ride routes at `:72,117`. **There is no `/` route** —
`/` returns 404, which is why the Render health path must be `/health`.

**Authentication (unchanged by this deployment).**
`auth/install.ts:92` adds a scoped `preHandler` returning
`401 AUTH_UNAUTHENTICATED` for a missing bearer token (`:93-103`), verifies the
token (`:107`), rejects reserved seed identities (`:120`), resolves the local
user, and first-request-provisions a `PASSENGER` from the verified Clerk profile
(`:131-137`). Role gates use `requireRole([...])` (`:179`). The auth scope is
registered **after** `healthRoutes` in `app.ts`, so `/health` stays public.

**Database.** `db/index.ts` → `postgres(config.databaseUrl, { max: 1 })` with
postgres.js's default `prepare: true`. `db/migrate.ts` uses
`{ max: 1, prepare: false }`. All `.for("update")` locking (pooling service
`claimSeatIn`) runs **inside** an explicit `database.transaction`, matching the
ADR-020 lock order (vehicle → rides → pool).

**Migrations 0000–0007.** `gen_random_uuid()` (core since PG13),
`ALTER TYPE ... ADD VALUE` (0001; transaction-safe on PG12+),
`DROP TABLE "sessions" CASCADE` (0001), and in 0007 `DROP INDEX` + partial
unique indexes + `CHECK` constraints. All standard PostgreSQL features (the
migrations are also exercised on `postgres:16-alpine` in Docker/CI) —
**Neon-compatible on the deployed PG 18**, no extensions required. Drizzle
records applied files in `drizzle.__drizzle_migrations`, so the sequence runs
once and re-runs are no-ops.

**Seed and identity mapping.** `db/seed.ts` is non-destructive
(`ON CONFLICT DO NOTHING`): 7 users (Jashim, Nusrat, Rafiq, Shirin, Karim,
Rahim, Faruq), 4 Teslas (all online), 8 zones, **no rides or pools**. Seeded
users carry the reserved placeholder `dev-only::seed::<email>`, which
`auth/identity.ts:20-22` and `auth/user-resolver.ts:65-67` reject outright.

Three code facts make the mapping the correct and only mechanism:

| Fact | Evidence | Consequence |
|---|---|---|
| `resolveLocalUser` queries **only** `WHERE clerk_user_id = $1` | `auth/user-resolver.ts:72` | No email lookup ever runs on the normal path |
| Provisioning fires **only** when that misses | `auth/install.ts:131-137` | Once the ID is mapped, provisioning never runs |
| The email conflict lives inside the provisioning `catch` | `auth/user-resolver.ts:121-129` | `users_email_unique` is structurally unreachable once mapped |

`vehicles.driverId` → `users.id` (the local UUID) with
`onDelete: "cascade"`, and `users.role` is a plain column — so updating
`clerk_user_id` **cannot** disturb roles or vehicle ownership. Only a `DELETE`
could cascade, and the mapping never deletes.

**Username requirement (already satisfied in Clerk).** `auth/provision.ts:43-46`
hard-requires `clerkUser.username` and throws `ProvisioningError` (→ `500
AUTH_PROVISION_FAILED`) if absent. `app/(auth)/sign-up/[[...sign-up]]/page.tsx:10-15`
renders `<SignUp />` with no `fields` prop, so the collected fields are governed
entirely by the Clerk instance's sign-up settings. The Clerk instance has
**Sign-up with username: enabled** and **Require username: enabled**, so public
sign-up provisions correctly. **No application code change is required or made.**

**Clerk routing.** The app uses path routing, not redirect/popup:
`app/(auth)/sign-in/[[...sign-in]]/page.tsx:14-18` passes `routing="path"` +
`path="/sign-in"`. The Clerk UI is therefore hosted on **our own origin**, which
is why no separate Clerk redirect-URL entries are needed (§9).

**Secrets.** Zero real secrets in tracked files. `.env` is git-ignored and
absent from history. The only `sk_live_` string in the repository is a *comment*
at `.env.example:26`; the `pk_test_` value decodes to
`placeholder.invalid.clerk.accounts.dev$` (Clerk's published dummy).
`.dockerignore` excludes `.env*`.

**Destructive landmines — must never run against a production `DATABASE_URL`:**

- `apps/api/test/database-utils.ts` — `DROP DATABASE ... WITH (FORCE)` /
  `CREATE DATABASE <db>_test`. **The Render and Vercel build commands must not
  include `npm test`.**
- `apps/api/scripts/cleanup-dev-rides.ts` — truncates the whole ride domain
  (guarded only by an exact `NODE_ENV === "production"` check).
- `apps/api/scripts/map-cast-clerk-ids.sql` — safe to **read and adapt**; it
  carries the demo instance's correct user IDs (§12).

**Environment loading (deployment-relevant).** `apps/api` `dev` uses
`node --env-file=../../.env`, but `start` is a plain `node dist/server.js` and
`db:migrate` / `db:seed` / `db:check` are plain `tsx`. **None of them load
`.env`**, so every production value must come from the platform's environment
or an exported shell variable.

---

## 4. The code change (approved, landed)

`apps/api/src/config.ts:39`

```ts
// before
port: readPort(env.API_PORT, 3001),

// after
port: readPort(env.API_PORT ?? env.PORT, 3001),
```

`readPort` (`config.ts:1-7`) is unchanged and still validates the 1–65535 range,
so an invalid value still throws rather than silently defaulting. Local
development keeps using `API_PORT` when present; on Render `API_PORT` is not
set, so the platform-injected `PORT` wins.

Covered by `apps/api/test/config.test.ts`: `PORT` fallback, `API_PORT`
precedence, the 3001 default, empty-string handling, and both rejected-input
cases (out-of-range, non-numeric).

**No other source change was made or is needed.** Verified unnecessary:
`next.config.mjs` (no `standalone` output needed on Vercel), the auth files,
the schema, migrations 0000–0007, CORS, the seed, and Clerk middleware.

---

## 5. No further code changes are required

Everything else for this deployment is configuration and documentation:

1. `README.md` — deployment section rewritten to the Clerk Development demo
   reality (§2 of the README checklist) once live URLs exist.
2. `docs/deployment-plan.md` — this document.
3. `docs/decisions.md` ADR-009 — the dev-instance decision and its trade-offs.
4. `docs/development-plan.md` Phase 11 — status and the corrected Compose note.
5. `docs/frontend-design.md` — the credentials modal (§6.6).

`render.yaml` and `vercel.json` are intentionally **not** added; the deployment
is configured through the provider dashboards.

---

## 6. Vercel — exact settings

| Setting | Value |
|---|---|
| Framework Preset | Next.js (auto-detected) |
| **Root Directory** | **`apps/web`** (first attempt) |
| Install Command | leave default (`npm install`) — see caveat |
| Build Command | `npm run build` |
| Output Directory | `.next` (default) |
| Node.js | 24 (matches CI/Docker; root `engines` is `>=20`) |
| Region | Singapore (`sin1`) — closest to Dhaka and to a Singapore Neon region |

**Caveat the repository cannot settle.** Root Directory `apps/web` means Vercel
installs *inside* that folder, bypassing the root `package-lock.json` and the
root `overrides: { "postcss": "^8.5.28" }` (a security fix). The build should
still succeed — `apps/web/package.json` declares all its own dependencies, and
modern Next.js uses prebuilt SWC binaries so no postinstall script is required.
**Watch the first Vercel build log.** If it fails during install, use the
documented fallback:

| Fallback setting | Value |
|---|---|
| Root Directory | repository root |
| Install Command | `npm ci` |
| Build Command | `npm run build -w @dhaka-tesla-pool/web` |
| Output Directory | `apps/web/.next` |

**Do NOT set `output: "standalone"` in `next.config.mjs`** — that is only for
self-hosted Docker. Vercel runs the Next.js runtime itself.

**Environment variables (Vercel) — Clerk Development keys:**

| Variable | Value | Scope |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<RENDER_API_URL>` | Public + **inlined at build** |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_test_…` (existing dev key) | Public + inlined at build |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` | Public (origin-relative) |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` | Public (origin-relative) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/` | Public (origin-relative) |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/` | Public (origin-relative) |
| `NEXT_PUBLIC_CLERK_SIGN_OUT_FALLBACK_REDIRECT_URL` | `/` | Public (origin-relative) |
| `CLERK_SECRET_KEY` | `sk_test_…` (existing dev key) | **Server-only** — required by `clerkMiddleware()`/SSR (cf. `docker-compose.yml:141`) |
| `NODE_VERSION` | `24` | Optional pin |

The `NEXT_PUBLIC_CLERK_*` routing values are **origin-relative paths**, identical
to `.env.example:43-47`, so they need no per-domain change.

**Vercel must NOT receive `DATABASE_URL`.** The frontend never queries
PostgreSQL; wiring a Neon–Vercel integration would place the database password
on a frontend project for zero benefit. **Do not connect a Neon integration.**

---

## 7. Render — exact settings

| Setting | Value |
|---|---|
| Service type | Web Service |
| Runtime | Node |
| Root Directory | *(blank — repository root)* |
| Build Command | `npm ci && npm run build -w @dhaka-tesla-pool/api` |
| Start Command | `node apps/api/dist/server.js` |
| **Health Check Path** | **`/health`** — mandatory; `/` returns 404 |
| Node.js | 24 |
| Instance | Free (`0.1 CPU`, 512 MB) |
| Region | Singapore (or India) |

**The build command must not include `npm test` or `npm run db:migrate`** — the
test helper issues `DROP DATABASE … CREATE DATABASE <db>_test`, which requires
`CREATEDB` on the Neon role and would fail the build. Migrations are run
manually (§11).

**Environment variables (Render) — Clerk Development keys:**

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon **direct** (non-pooled) connection string, TLS |
| `CLERK_SECRET_KEY` | `sk_test_…` (existing dev key) |
| `CLERK_PUBLISHABLE_KEY` | `pk_test_…` (existing dev key) |
| `CLERK_AUTHORIZED_PARTIES` | `https://<VERCEL_URL>` |
| `WEB_URL` | `https://<VERCEL_URL>` |
| `API_HOST` | `0.0.0.0` (or omit — `config.ts:38` already defaults to it) |
| `API_PORT` | **do not set** — let Render's `PORT` win (§4) |
| `PORT` | *injected by Render* |

`max: 1` is correct for a free instance: one process, one connection, no pool
sizing required. **Do not change `API_PORT` on Render** — setting it would
override the platform port and reintroduce the bug the fix removed.

---

## 8. Neon — exact configuration

| Setting | Value |
|---|---|
| Plan | Free |
| PostgreSQL version | **18** on the deployed Neon project (local Docker/CI stays on `postgres:16-alpine`) |
| Region | Singapore (or India) — nearest to Dhaka and to the Render/Vercel regions |
| Connection type | **Direct (non-pooled)** — host `ep-….neon.tech/dbname`, **not** `ep-…-pooler.…` |
| URL shape | `postgresql://USER:PASSWORD@HOST/DB?sslmode=require` |

**Why direct rather than pooled.** `db/index.ts` constructs
`postgres(url, { max: 1 })` with postgres.js's default `prepare: true`.
Prepared statements over a transaction-pooling proxy are the classic source of
"prepared statement already exists" errors. With `max: 1` there is no benefit to
pooling, so the direct endpoint is both safer and requires **zero** code change.
(Adopting `-pooler` later would require adding `prepare: false` to
`db/index.ts` and re-running the concurrency tests.)

Neon Free suspends after ~5 minutes idle (scale-to-zero) and has monthly compute
limits — see §15.

---

## 9. Clerk — exact configuration (Development instance)

**No Clerk Production instance is created, cloned, or promoted. The existing
Development instance and its existing 7 users are retained as-is.**

| Step | Action |
|---|---|
| 1 | Open the **existing Development** instance |
| 2 | **Settings → Allowed origins** — add `https://<VERCEL_URL>`. Keep `http://localhost:3000` for local development. |
| 3 | No redirect-URL entries are needed: `/sign-in` and `/sign-up` are same-origin relative paths (`routing="path"`). |
| 4 | Confirm **Sign-up with username: enabled** and **Require username: enabled** — required by `auth/provision.ts:43`. Already done. |
| 5 | Confirm public sign-up is enabled. New users are provisioned **PASSENGER**. |
| 6 | Reuse the existing `pk_test_…` and `sk_test_…` — do not create new keys. |
| 7 | For each of the 7 demo users, confirm the Clerk user ID still matches `apps/api/scripts/map-cast-clerk-ids.sql` and that the password matches the documented demo value. |

**Driver registration is intentionally unavailable.** Provisioning always
creates `PASSENGER` (`auth/user-resolver.ts:112`), and `DRIVER`/`ADMIN` are
database-only assignments (`auth/identity.ts:26`, `auth/provision.ts:16-18`).
Driver testing uses the 4 demo driver accounts, surfaced by the landing page's
"Credentials for Testing" modal.

**Expected and accepted:** Clerk's Development banner appears in the UI, and
Development instances carry vendor-side limits (MAU caps) and the risk that
resetting the instance would invalidate the 7 user IDs. The mapping is
re-runnable in that case (§18).

---

## 10. Environment variable matrix

| Variable | Local | Vercel | Render | Neon | Notes |
|---|---|---|---|---|---|
| `NODE_ENV` | `development` | `production` | `production` | — | Triggers the `cleanup-dev-rides` guard |
| `API_HOST` | `0.0.0.0` | — | `0.0.0.0` | — | Defaults to `0.0.0.0` |
| `API_PORT` | `3001` | — | **omit** | — | Render uses `PORT` |
| `PORT` | — | — | *injected by Render* | — | Honored by the §4 fix |
| `WEB_URL` | `http://localhost:3000` | — | `https://<VERCEL_URL>` | — | CORS + authorized-party fallback |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/dhaka_tesla_pool` | **never** | Neon direct URL | *source of truth* | The frontend has no DB access |
| `CLERK_SECRET_KEY` | `sk_test_…` (dev) | `sk_test_…` | `sk_test_…` | — | Server secret |
| `CLERK_PUBLISHABLE_KEY` | `pk_test_…` | `pk_test_…` | `pk_test_…` | — | Public-safe |
| `CLERK_AUTHORIZED_PARTIES` | *(blank)* | — | `https://<VERCEL_URL>` | — | Exact origins |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | `https://<RENDER_API_URL>` | — | — | **Inlined at build time** |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_test_…` | `pk_test_…` | — | — | **Inlined at build time** |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` | `/sign-in` | — | — | Origin-relative |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` | `/sign-up` | — | — | Origin-relative |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/` | `/` | — | — | Origin-relative |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/` | `/` | — | — | Origin-relative |
| `NEXT_PUBLIC_CLERK_SIGN_OUT_FALLBACK_REDIRECT_URL` | `/` | `/` | — | — | Origin-relative |
| `NODE_VERSION` | — | `24` | `24` | — | Matches CI |

**Clerk Development keys are identical across Vercel and Render** — the same
`pk_test_…` / `sk_test_…` pair. No `sk_live_` / `pk_live_` value is used
anywhere in this deployment.

---

## 11. Database migration procedure

Run **once**, from a clean machine, **before** the first deploy, using the
**direct** Neon URL. These scripts do **not** load `.env`, so `DATABASE_URL` must
be exported in the shell.

```powershell
$env:DATABASE_URL = "postgresql://USER:PASS@ep-….neon.tech/dhaka_tesla_pool?sslmode=require"

npm ci
npm run db:migrate -w @dhaka-tesla-pool/api
npm run db:check   -w @dhaka-tesla-pool/api   # expect: "database connection OK"
npm run db:seed    -w @dhaka-tesla-pool/api   # 7 users + 4 Teslas + 8 zones
```

`db/migrate.ts` runs the Drizzle migrator against `apps/api/drizzle` and records
applied files in `drizzle.__drizzle_migrations`, so 0000–0007 execute in order
exactly once and re-runs are no-ops.

**Pre-flight:** create a Neon branch or snapshot first. On a brand-new empty
database there is no data at risk, so 0001's `DROP TABLE "sessions"` and 0007's
`DROP INDEX` are harmless.

---

## 12. Seeding & Clerk ID mapping (the demo cast)

`db/seed.ts` is non-destructive (`ON CONFLICT DO NOTHING`) and creates **7 users
+ 4 online Teslas + 8 zones, with no rides or pools** — a clean start for the
demo database.

After seeding, map the **existing** Clerk Development user IDs to the seeded
rows. The repository already ships the correct IDs in
`apps/api/scripts/map-cast-clerk-ids.sql`; run its body against Neon (only the
`docker compose exec psql` wrapper changes, not the SQL). Each statement is
guarded by `clerk_user_id LIKE 'dev-only::seed::%'`, so it is idempotent and
can never clobber an already-mapped row.

```sql
UPDATE users SET clerk_user_id = 'user_3Jroqu6ifJ8mIwAr1YpAWWeML55'
 WHERE email = 'jashim@example.com' AND clerk_user_id LIKE 'dev-only::seed::%';
-- … repeat for nusrat, rafiq, shirin, karim, rahim, faruq
```

Verify:

```sql
-- MUST be 0
SELECT count(*) AS unmapped FROM users WHERE clerk_user_id LIKE 'dev-only::seed::%';
SELECT name, email, role, clerk_user_id FROM users ORDER BY email;
SELECT v.name, v.capacity, v.is_online, u.name AS driver
  FROM vehicles v JOIN users u ON u.id = v.driver_id ORDER BY v.name;  -- 4 rows, all online
```

**Ordering constraint:** the mapping must be applied **before any demo account's
first sign-in.** Creating a Clerk user touches only Clerk; only the first
authenticated API request touches the database. If a demo account signs in
before it is mapped, `resolveLocalUser` misses, provisioning attempts an insert,
`users_email_unique` is violated, and the request fails with
`500 AUTH_PROVISION_FAILED` — **without writing a partial row**
(`auth/user-resolver.ts:89-91`). The fix is simply to complete the mapping.

**Role and vehicle relationships are preserved by construction:** the mapping
touches only `clerk_user_id`; roles live on `users.role` and vehicles link via
`vehicles.driver_id → users.id`.

**No public driver registration.** New sign-ups are PASSENGER only; driver
testing uses the 4 demo driver accounts.

---

## 13. CORS & authorized parties

`app.ts` registers `@fastify/cors` with `origin: config.clerkAuthorizedParties`
and credentials **disabled** — correct, because authentication is a bearer token
in the `Authorization` header, not a cookie. The browser sends a preflight for
`Authorization` and the plugin answers it. Every `/api/*` route sits inside the
auth scope except `/health`.

- Set `CLERK_AUTHORIZED_PARTIES=https://<VERCEL_URL>` on Render. It
  simultaneously whitelists CORS and validates the Clerk token's `azp` claim
  (`auth/provider.ts:57`).
- **Vercel Preview deployments get unique origins** (`https://abc123.vercel.app`)
  and will be blocked by that list. For this demo, use the production domain
  only. If preview access is ever needed, add each preview origin as a
  throwaway Render env var (a Render restart per preview is painful).
- Never use a wildcard `*` — it would defeat the cookie-leak/CSRF defence this
  variable exists for.

---

## 14. Security review & secret classification

| Secret | Where it may live | Never |
|---|---|---|
| `CLERK_SECRET_KEY` (`sk_test_…`) | Render env, Vercel **server** env, local `.env` | Browser bundle, Git, Vercel public env |
| `DATABASE_URL` (Neon password) | Render env, local `.env` | **Vercel entirely**, browser, Git |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_test_…`) | Browser bundle, Vercel, Render | — (public by design) |
| `NEXT_PUBLIC_API_URL` | Browser bundle, Vercel | — (public by design) |
| **Demo account passwords** | Public by design — the "Credentials for Testing" modal | — (intentionally displayed) |

**Demo credentials are intentionally public.** This build is a public testing
project, so the landing page's "Credentials for Testing" modal displays the
three passenger and four driver demo logins with copy and show/hide controls.
They authenticate against a Clerk **Development** instance, carry no payment or
personal data, and grant nothing beyond a demo row in the demo database. This is
an accepted, documented trade-off of the free public demo (see `decisions.md`
ADR-009) — **not** an oversight.

Verified clean: no real keys in tracked files; `.env` never committed and absent
from history; `.dockerignore` excludes `.env*`; auth errors log
`error.message` only, never the token; `requireAuth` is registered app-wide
inside the auth scope; role gates protect every role-specific route;
`isReservedClerkUserId` blocks placeholder identities; capacity and ownership
are enforced in the service layer under `SELECT … FOR UPDATE` and are never
trusted from the client.

`NEXT_PUBLIC_*` values are **inlined at build time** — changing one requires a
Vercel rebuild/redeploy, not merely an environment edit.

---

## 15. Blockers, risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Clerk Development limits / MAU cap** | The demo degrades if heavily used | Acceptable for a public demo; upgrade path is unchanged (only hosting/keys change) |
| **Clerk dev instance reset invalidates the 7 user IDs** | Demo sign-in → 401 | Re-run `map-cast-clerk-ids.sql` with the new IDs; documented in §12/§18 |
| **Clerk Development banner in the UI** | Cosmetic | Expected and accepted for this build |
| **Render `PORT` ignored** (pre-fix) | Service unreachable | ✅ Fixed (§4) |
| **Health path `/` returns 404** | Render marks the deploy failed | Set `/health` (§7) |
| **Vercel domain not in Clerk allowed origins** | Sign-in fails / CORS blocked | Manual Clerk step (§9) |
| **Vercel build ignores the root lockfile/overrides** | Build failure, or a vulnerable transitive `postcss` | Watch the first build; fallback in §6 |
| **Preview origins blocked by CORS** | Preview deploys cannot call the API | Use the production domain only |
| **Render free spins down (~15 min idle)** | 30–50 s cold start; a demo may stall | "Ping" the API before recording; keep a tab open |
| **Neon Free scales to zero (~5 min idle)** | First query after idle pays wake latency | Combine with the above; keep demo actions back-to-back |
| **Render free monthly hours cap** | Service sleeps mid-month | Monitor usage in the dashboard |
| **Running `npm test` against the Neon URL** | `DROP DATABASE … CREATE DATABASE` | Build command excludes tests (§7) |
| **Public sign-up without a required username** | `500 AUTH_PROVISION_FAILED` | ✅ Clerk has "Require username" enabled (§9) |

Free-tier pricing and limits change over time and **cannot be verified from this
repository** — confirm current values in the Neon, Render, and Vercel dashboards
before publishing.

---

## 16. Deployment sequence

1. **Land the port fix.** Merge the `fix(api)` commit to `master`; local
   `lint && typecheck && test && build` are green.
2. **Create the Neon project** — Free, PostgreSQL 18, Singapore. Copy the
   **direct** connection string. Take a branch/snapshot.
3. **Run migrations and seed** against Neon (§11), then **map the existing Clerk
   Development IDs** (§12). Verify `unmapped = 0`. Do this **before** anyone
   signs in.
4. **Confirm the Clerk Development instance** — add `https://<VERCEL_URL>` to
   allowed origins once known (§9); re-verify the 7 user IDs and demo passwords.
5. **Create the Render service** (§7) with the environment from §10, **omitting
   `API_PORT`**. Deploy. Confirm `GET https://<RENDER_API_URL>/health` returns
   `{"status":"ok"}` and that `/` correctly 404s.
6. **Smoke the API early** (§17, tests 1–4) before touching the frontend, so
   backend problems stay isolated.
7. **Create the Vercel project** — note the assigned `https://<VERCEL_URL>`
   domain, set Root Directory `apps/web`, add the §6 variables using the now-known
   Render URL, and deploy. **Do not** set `DATABASE_URL`.
8. **Finalize the origin allow-list** — add the Vercel domain to the Clerk
   instance's allowed origins and to Render's `CLERK_AUTHORIZED_PARTIES` /
   `WEB_URL`. Redeploy Render if it changed.
9. **Run the full end-to-end smoke test** (§17) and production QA (§18).
10. **Update `README.md`** with the live URLs and mark the Deployment row ✅;
    close Phase 11 in `docs/development-plan.md`.

Steps 5 → 7 are ordered to break the circular dependency: the web build needs
the API URL inlined, and the API needs the web origin for CORS. Vercel assigns
the production domain at project import (before the first successful build), so
the domain is knowable early and only **one** Vercel deploy is required with the
correct `NEXT_PUBLIC_API_URL`.

---

## 17. Smoke tests

**API-only (after the Render deploy, before the frontend)** — run against the
live hosts from the status table at the top of this document:

```bash
API=https://dhaka-tesla-pool-av68.onrender.com
```

1. `curl -i $API/health` → `200` with `{"status":"ok","service":"dhaka-tesla-pool-api",…}`.
2. `curl -i $API/` → `404` (confirms no root route).
3. `curl -i $API/api/zones` → **`401 AUTH_UNAUTHENTICATED`**. *Every* `/api`
   route sits behind the Clerk `preHandler`, so an unauthenticated 401 is the
   **correct** result and proves the guard is installed. To prove the database
   round-trip instead, call it with a signed-in bearer token and expect the 8
   Dhaka zones. *A 500 here means the database is unreachable; `/health` alone
   will not catch it, because postgres.js connects lazily.*
4. `curl -i $API/api/me` → `401 AUTH_UNAUTHENTICATED`.

**Identity binding (the decisive test):** after signing in as Nusrat, copy the
bearer token from DevTools and call `/api/me`. Expect `"name":"Nusrat Haque"`,
`"role":"PASSENGER"`, and a **real `user_…` `clerkUserId`** — not
`dev-only::seed::`. A `500 AUTH_PROVISION_FAILED` here means the mapping was not
applied before first sign-in.

---

## 18. Production QA

1. Load `https://dhaka-tesla-pool-demo.vercel.app`; sign in as **Nusrat** →
   lands on `/rides`.
2. DevTools → Network: `onrender.com` calls return 200 with
   `Authorization: Bearer …`, **no CORS errors**.
3. Clerk keys are the **test** keys; the Development banner is visible and
   accepted.
4. **Nusrat** books Banani → Mohakhali; **Rafiq** books Banani → Gulshan 1 →
   one pool, correct split fares.
5. **Shirin** requests the same ride concurrently → exactly one wins the last
   seat; capacity never exceeded.
6. **Jashim** goes online, sees the pool in available pools, accepts it.
7. **Karim** and **Rahim** see the pool disappear (first-wins;
   `409 POOL_ALREADY_ACCEPTED`).
8. Lifecycle to `COMPLETED`; per-passenger fares preserved.
9. Passenger A cannot cancel passenger B's ride → `403`.
10. **Faruq** accepts a fresh unassigned pool as a second driver (proves
    `vehicles.driver_id` survived the ID mapping).
11. **Public sign-up** with a brand-new email → auto-provisioned as `PASSENGER`,
    lands on `/rides` (proves the Clerk username requirement is satisfied).
12. Sign out → sign in as **Nusrat** again → still PASSENGER, no duplicate row.
13. `SELECT count(*) FROM users;` grows by exactly 1 per new sign-up.
14. Map tiles render (OpenStreetMap, no API key).
15. Verify Neon has no `_test` database (nothing destructive ran).

---

## 19. Rollback

| Layer | Rollback |
|---|---|
| **Vercel** | Deployments → promote the previous deployment to Production (instant, no rebuild). |
| **Render** | Roll back to the previous successful deploy from the Events tab. |
| **Code** | `git revert` the `fix(api)` commit on `master`; redeploy both platforms. |
| **Identity mapping** | `UPDATE users SET clerk_user_id = 'dev-only::seed::'||email WHERE email IN (…)` — reverses cleanly; the guard prefix makes it safe. |
| **Clerk dev-instance reset** | Re-run `map-cast-clerk-ids.sql` with the new IDs; no redeploy needed. |
| **Database — schema** | Forward-only; restore the Neon branch/snapshot, or drop + recreate Neon and repeat steps 2–3. |
| **Database — data** | Neon branch restore or point-in-time recovery. No seed rollback needed: `db:seed` is `ON CONFLICT DO NOTHING` and inserts no rides. |
| **Clerk** | Remove the allowed origin to cut off access; rotate the dev `sk_test_…` if it leaked. |
| **Full teardown** | Delete the Vercel project, the Render service, and the Neon project. Nothing in the repository changes. |

---

## 20. Files that may / must not change

**Already changed (this branch):**

- `apps/api/src/config.ts` — the `PORT` fallback (§4)
- `apps/api/test/config.test.ts` — **new**, companion test
- `apps/web/components/credentials-modal.tsx` — **new**, demo credentials modal
- `apps/web/app/(main)/page.tsx` — landing-page trigger button
- `apps/web/app/globals.css` — credentials-modal styles (existing tokens only)
- `apps/web/test/credentials-modal.test.tsx` — **new**, modal tests
- `docs/deployment-plan.md`, `README.md`, `docs/decisions.md`,
  `docs/development-plan.md`, `docs/frontend-design.md` — documentation

**Must NOT change:**

- `apps/api/drizzle/0000`–`0007` — applied migrations are immutable once run
- `apps/api/src/db/schema.ts` — the invariants are correct
- The `claimSeatIn` / `acceptPool` locking logic — satisfies both concurrency cases
- `apps/api/src/auth/*` — the guard, reserved-ID block, and provisioning are correct
- CORS wildcard / credentials — it would weaken the authorized-parties design
- `apps/web/next.config.mjs` — no `standalone` output needed on Vercel
- `apps/api/package.json` start script — it matches the Dockerfile
- `apps/web/components/workspace/map-pane.tsx` — OpenStreetMap + attribution is correct

**Intentionally NOT added:** `render.yaml`, `vercel.json`, a custom domain, a
Clerk Production instance, any paid service, or any new authentication provider.
