# Frontend Design Specification — Dhaka Tesla Pool

> **Status:** design specification (source of truth for UX/design). Written
> *before* the frontend redesign is implemented. Nothing here is implemented
> yet; follow-up work builds against this document, the state machine and
> contracts in `docs/requirements.md`, and the architecture in
> `docs/architecture.md` / `docs/decisions.md` (ADR-021, ADR-022).
>
> Scope: passenger + driver **web application** (`apps/web`). Backend logic,
> database, and API contracts are untouched by this document. Where the spec
> needs a backend capability that does not exist yet, it is **flagged** in
> §11 — never silently redefined.

## Contents

1. Current state (what exists today)
2. Overall visual direction
3. Landing page
4. Authentication
5. Passenger experience
6. Driver experience
7. Navigation
8. Map
9. MVP scope / non-goals
10. State-driven UI philosophy
11. Implementation principles
12. Conflicts, gaps and assumptions (review before implementation)

---

## 1. Current state (what exists today)

Grounded inventory of `apps/web` (do not treat as finished design):

**Routes (App Router)**
| Path | Today |
|---|---|
| `/` | Landing — pitch, a numbered `<ol>` instruction block, sign-in/up CTAs |
| `/sign-in`, `/sign-up` | Clerk-managed pages |
| `/account` | Profile page (`useMe` + Clerk `UserButton`) |
| `/rides` | "Book a ride" — booking form + confirmed-booking banner + full ride history on one page |
| `/rides/[rideId]` | Ride detail with status timeline, pool info, fare breakdown, two-step cancel |
| `/driver` | "Driver hub" — availability toggle, waiting-request lobby, open pools, completed-trip history stacked vertically |
| `/driver/[poolId]` | Pool detail — status, passengers (no fares), single next action |

**Design system today (ADR-021 §4):** always-dark, hand-written plain CSS in
`apps/web/app/globals.css`, no Tailwind/shadcn. Tokens: `--bg #0d1117`,
`--panel`, `--border`, `--text #e6edf3`, **`--primary #2f81f7` (GitHub blue)**,
`--ok`, `--warn`, `--danger`. Responsive breakpoints only at
36/40/44 rem (container/row/nav tweaks). Clerk is themed via
`@clerk/themes` `dark` with the same blue variables.

**Key components to reuse as-is** wherever possible:
`RoleGate`, `LoadingState`/`ErrorCard`/`EmptyState` (`state-components.tsx`),
`StatusBadge`, `StatusTimeline`, `FareBreakdown`, `AvailabilityToggle`,
`PoolActions`, `MemberList`, `LobbyPoolCard` (Accept claim), `CancelRideButton`,
`describeApiError` (`lib/api.ts`), `formatPaisa` / `formatDateTime`
(`lib/format.ts`), the TanStack Query hooks in `lib/queries.ts`, and the type
mirror in `lib/types.ts`.

**No map yet.** No Leaflet/`@types/leaflet` dependency is installed. No
websockets/SSE — status is polled at 5 s and **stops at terminal status**
(ADR-021 §6). No payment UI, no modal, no hamburger/menu component exists.
`middleware.ts` protects `/account`, `/rides`, `/driver`; `/`, `/sign-in`,
`/sign-up` are public.

---

## 2. Overall visual direction

A night-city Dhaka ride share: **deep black** canvas, **white/off-white
typography**, one **lime/green accent**. Minimal, modern, polished mobility
app. Every screen answers one question; there are no filler cards, dashboards,
or intermediate pages.

### 2.1 Principles
- **One workspace per role.** The passenger sees a ride workspace; the driver
  sees a driver workspace. Nothing else competes for the primary screen.
- **Mobility-app density.** Big actionable targets, one prominent primary
  action per state, short copy, no walls of text.
- **Always dark.** No light mode (existing decision, ADR-021 §4); the accent
  change below is the only token-level visual change.
- **Data first.** Fares and statuses come from the API; the UI is a faithful
  renderer, never a calculator.
- **Quiet motion.** Fades / subtle transitions only; nothing bounces by
  default.

### 2.2 Color
Replace the current GitHub-blue `--primary` with a lime accent while keeping
the neutral near-black scale. Token proposal (update `globals.css`):

```css
:root {
  color-scheme: dark;
  --bg:            #0a0b0d;   /* near-black canvas            */
  --bg-elevated:   #101216;   /* panels / sheets              */
  --bg-raised:     #171a1f;   /* hover / nested panels        */
  --border:        #262a31;
  --border-strong: #343a44;
  --text:          #f6f7f9;   /* off-white                    */
  --muted:         #9aa3ae;
  --accent:        #b6f36b;   /* lime                         */
  --accent-hover:  #c7f98a;
  --accent-text:   #0a0b0d;   /* text ON accent (contrast)    */
  --accent-soft:   rgba(182, 243, 107, 0.14);
  --danger:        #ff5f56;
  --danger-soft:   rgba(255, 95, 86, 0.12);
  --ok:            #4ade80;
  --ok-soft:       rgba(74, 222, 128, 0.12);
  --warn:          #eab308;
  --warn-soft:     rgba(234, 179, 8, 0.12);
  --focus:         var(--accent);
  --radius:        0.75rem;
  --radius-sm:     0.5rem;
}
```

- Accent use: primary buttons, active nav, status highlights, "online" state,
  logo mark. **Never** for body text (contrast); use `--accent-text` on lime
  buttons.
- Semantic statuses stay distinct: `--ok` (online / ride in progress),
  `--warn` (waiting), `--danger` (cancel / errors) — same families as today,
  tuned to the palette.

### 2.3 Typography
- Keep the system stack (`--font`). Off-white `--text` body, `--muted` labels.
- Scale: `h1` app/workspace titles ~1.5 rem, state headings ~1.15 rem, primary
  action labels 1 rem/600, secondary/captions 0.85 rem.
- Prices always via `formatPaisa` (`৳` + paisa→BDT), never hand-joined.

### 2.4 Layout & responsiveness
- **Desktop (≥ 900 px):** full-height map + fixed-width (≈ 360–400 px) left
  control panel on the workspace routes.
- **Mobile (< 900 px):** map fills the viewport; content lives in a **bottom
  sheet** that can be pulled/interacted with and which collapses to a
  floating action dock to keep the map usable.
- Breakpoints: mobile-first `@media (min-width: 56rem)` for the desktop
  side-panel split. Current 36/40/44 rem rules are retained where useful.
- Max content width stays ~62 rem for the (rare) non-workspace pages (landing,
  account).

### 2.5 Motion
- **In:** opacity + 8–12 px translate (120–200 ms, ease-out) for sheets,
  overlays, state transitions.
- **Continuous:** only the landing title (see §3) and an "online pulse" dot.
- No skeleton definitions churn; use the existing `LoadingState` spinner.

### 2.6 Component vocabulary
Standardize on the existing pieces: `.card`, `.btn` (primary/secondary/ghost),
`.notice`, `.ridelist`, `.dl`, `StatusBadge`, `StatusTimeline`. New primitives
added only where required: bottom sheet, hamburger drawer, completion modal,
map layer. Add motion via a single reusable `FadeIn`/`Sheet` wrapper rather
than ad-hoc CSS.

---

## 3. Landing page

Purpose: pitch the product, get the user signed in, link the repo. Nothing else.

- **Animated "Dhaka Tesla Pool" title.** One subtle entrance animation
  (letter/word fade-up, ~600 ms, runs once). Styled as the wordmark —
  "Dhaka Tesla **Pool**" with `Pool` in `--accent`.
- **Tagline (one line):** *Share a seat. Split the fare. Survive Dhaka
  traffic.* — plus at most one short supporting sentence (e.g., "Three-seat
  Teslas. Predefined Dhaka zones. Every pooled seat pays 25% less.").
- **Sign-in / sign-up CTAs.** Two buttons: primary "Create an account" →
  Clerk `/sign-up`, secondary "Sign in" → Clerk `/sign-in`. **Exactly one
  auth control set on the page** (see §11 conflict: today the landing and the
  header both render sign-in/up when signed out).
- **GitHub link** in a corner (top-right, ghost icon+label). Never in the
  main content column.
- **Remove the numbered `<ol>` instruction block** currently in
  `app/page.tsx` (lines 28–33). Replace with the tagline + one-line
  explanation or an optional single-feature strip.
- **Post-login redirect is direct to the workspace.** After successful
  authentication, the role is resolved from the API and the user is sent
  straight to their workspace: **passenger → `/rides`, driver → `/driver`**.
  The landing page must **never** act as a post-login dashboard or an
  intermediate page — signed-in users are not shown the landing page at all
  (no role-aware quick-path toggle here).

---

## 4. Authentication

- **Keep Clerk.** `@clerk/nextjs` provider, middleware route policy, and the
  bearer-token API client are unchanged.
- **Retheme Clerk to the layout:** `appearance={{ theme: dark, variables: {
  colorPrimary: <accent>, colorBackground: <bg-elevated>,
  colorForeground: <text>, colorMutedForeground: <muted>, colorInput: <bg>,
  colorInputForeground: <text>, colorPrimaryForeground: <accent-text>,
  colorDanger: <danger>, borderRadius: ... } }}` in `app/layout.tsx` — exactly
  the pattern of ADR-021 §4, with the accent swapped blue→lime.
- **Auth pages own the whole flow (ADR-023).** `/sign-in` and `/sign-up`
  live in an `(auth)` route group with a centered layout and NO app navbar or
  duplicate auth controls. They render the **Clerk-hosted** `SignIn`/`SignUp`
  components using Clerk's catch-all App Router structure
  (`[[...sign-in]]`/`[[...sign-up]]`) with `routing="path"`, `path`,
  `signUpUrl`/`signInUrl`, and `fallbackRedirectUrl="/"`, so every step of the
  flow (including cross-links and sub-steps) stays on this origin — never the
  accounts.dev instance URLs. `NEXT_PUBLIC_CLERK_SIGN_IN_URL` /
  `NEXT_PUBLIC_CLERK_SIGN_UP_URL` and the fallback redirects are set in the
  environment so header buttons, OAuth callbacks, and sign-out resolve to the
  same local pages. Do not build custom auth forms.
- **Per-user query isolation.** Every authenticated TanStack key is scoped by
  the Clerk `userId`, and `SessionCacheSync` clears the query client whenever
  `userId` changes (logout included). A logout → login as another role can
  never flash the previous user's data or role-specific UI: the new user's
  queries start empty (loading frame) and are `enabled` only once an identity
  exists. The role is resolved from `/api/me` for the CURRENT session and the
  workspace redirect follows it.
- The header `UserButton` remains the account affordance once signed in.

---

## 5. Passenger experience

### 5.1 Shape
- **No post-login dashboard.** After successful authentication a passenger is
  redirected **directly to `/rides`** (never via the landing page) and lands
  in the **ride workspace**.
- The workspace has two modes, decided by the passenger's ride state:
  **book** (no active ride) and **live ride** (active ride exists). Everything
  else (history) lives behind secondary navigation (§7).
- Layout: desktop = map (right) + control panel (left); mobile = map (full)
  + bottom sheet with the panel content.

### 5.2 Book mode (no active ride)
Left panel / bottom-sheet content — reuse `RideForm` (`react-hook-form` +
Zod) and `useEstimateRide`:
- **Pickup zone** and **destination zone** — dropdown/buttons from
  `GET /api/zones` (source of zone coordinates; §8). Pickup defaults to null;
  pickup ≠ destination is validated client-side and by the API (strict Zod).
- **Seats** — stepper 1–3 (`MAX_REQUESTED_SEATS`), default 1.
- **Live fare preview** — `GET /api/rides/estimate`. Shown only while the
  form is valid; renders `FareView` (`FareBreakdown`): base, distance,
  25% pooled discount (only when it would apply — i.e., joining a pool with a
  rider already in it cannot be known pre-booking, so the preview shows the
  solo estimate; the discount copy states terms: "splits 25% when your ride
  shares a Tesla"). After booking, the real stored fare is authoritative.
- **Book action** — `useCreateRide` (idempotency key already handled in
  `lib/queries.ts`, ADR-015). On 201/200 the ride is already `MATCHED`
  (ADR-022) and the workspace flips to live-ride mode. Errors (409
  `ACTIVE_RIDE_EXISTS`, 400) render via `describeApiError`.

### 5.3 Live-ride mode (active ride exists)
The **primary screen** is the current ride, driven by polled `useRide`
(`GET /api/rides/:rideId`, 5 s, stops at terminal — ADR-021 §6). Left
panel / sheet shows, per status:

| Status (API) | What the passenger sees |
|---|---|
| `MATCHED`, pool not yet accepted (`driverName` null) | **"Matching you with a driver"** — searching/pool-matched state; pool seats filled, "waiting for a driver…" (`PoolInfo`); cancel still offered |
| `MATCHED`, accepted (`driverName` set) | **Driver assigned** — driver + Tesla names, pickup zone, "your driver is on the way" |
| `DRIVER_ARRIVED` | **Driver arrived** — "your Tesla is here", still cancellable (P8) |
| `STARTED` | **Ride in progress** — route panel, no cancel |
| `COMPLETED` | **Completion/payment** — flow to §5.4; then return to book mode |
| `CANCELLED` | Terminal notice + return to book mode |

- Status visuals reuse `StatusBadge` + `StatusTimeline`.
- **Cancel** stays the two-step `CancelRideButton`, only while the ride is in
  `CANCELLABLE_STATUSES` (REQUESTED/MATCHED/DRIVER_ARRIVED), mirroring
  `lib/types.ts`.
- **Fare display:** the stored per-seat fare and `estimatedTotalPaisa` from
  the API — never recomputed client-side.

### 5.4 Completion / payment modal
- On `COMPLETED`, show a **cash-payment modal**: total due (৳), the ride
  summary, and a single "Pay cash" acknowledgment button.
- **MVP assumption:** this is a client-side acknowledgment only — there is no
  payment endpoint or table (§11). "Pay cash" closes the modal and the
  workspace returns to **book mode** (§5.2) with the completed ride already in
  history.

### 5.5 History
- **Dedicated route `/rides/history`** (Phase 2), reached only from the header
  menu (§7). Fed by the existing `GET /api/rides`, rendered with `RideCard`.
  Tap-through to `/rides/[rideId]` (existing detail page, kept for
  deep-linking). History never appears on the `/rides` workspace.

---

## 6. Driver experience

### 6.1 Shape
- **No separate driver hub landing.** After successful authentication a
  driver is redirected **directly to `/driver`** (never via the landing page)
  and lands in the **driver workspace**.
- Desktop = map + left panel; mobile = map + bottom sheet (same skeleton as
  passenger, different panel content).

### 6.2 Head of workspace — availability
- `AvailabilityToggle` (existing) + `useDriverAvailability` true state.
- **Online:** accent-tinted "Online — accepting rides" with a subtle pulse dot.
- **Offline:** warn notice; the waiting-requests lobby is **hidden and its
  Accept actions removed**, with a "Go online to accept waiting ride
  requests" hint (matches the fix in `app/driver/page.tsx`). The backend is
  still the boundary: an offline accept is refused regardless of UI
  (`409 VEHICLE_OFFLINE`).

### 6.3 Waiting requests (lobby) — online only
- Polled `useAvailablePools` (`GET /api/driver/pools/available`, 5 s, stops
  when no active pools — ADR-022, driver-agnostic by construction).
- Lobby card = `LobbyPoolCard`, extended with **route line** (pickup →
  destination from member zones, drawn from `GET /api/zones` coordinates)
  and seat fill. Accept stays **inline first-wins**; a lost race renders
  `describeApiError(POOL_ALREADY_ACCEPTED)` and the refetch drops the pool.
- Keep the existing behavior where the pool detail page 404s for unclaimed
  pools — the claim lives on the lobby card.

### 6.4 Open / active pools (owned)
- Owned non-terminal pools from `useDriverPools` (`GET /api/driver/pools`).
- Each pool shows: Tesla (name/capacity/online), status, route,
  passengers + seats (`MemberList` — names, pickup/destination, seats),
  and — **once available** — per-passenger fare and total earnings
  (**§11; backend gap**). Update `pool-card.tsx` to surface the earnings
  line from the API field; never sum seats/estimates client-side.
- Active trip lifecycle: the single legal next action in the workspace via
  `nextPoolAction` / `PoolActions` — **accept → arrive → start → complete**
  (`accepted_at` discriminator for lobby vs owned, ADR-022 §6). Driver
  detail on `/driver/[poolId]` stays for deep-linking.

### 6.5 Completion / cash-received flow
- On `COMPLETED`, a **cash-received modal**: for each passenger the amount
  collected (from the API earnings field) and the total; a single "Cash
  received" acknowledgment completes the flow and returns the driver to the
  workspace. Same MVP assumption as §5.4: acknowledgment only, no payment
  write.

### 6.6 History
- **Dedicated route `/driver/history`** (Phase 2), reached only from the
  header menu (§7). Completed trips from the existing
  `GET /api/driver/pools/history` (**capped at 10 by the API** — UI shows the
  ten newest; see §11 note). No history section on the `/driver` workspace.

---

## 7. Navigation

- **Reworked (Phase 2).** The top-link nav in `AppShell` ("Driver hub / Book a
  ride / Account") is replaced by a **minimal hamburger** in the sticky header:
  brand left, the signed-in user's **identity centered**, hamburger right.
- The centered identity comes from Clerk's session object, preferring the
  **username** (`fullName` → primary email only as fallbacks) so short names
  like "Nusrat" or "Jashim" appear instead of full names.
- The hamburger opens a right-side **drawer** (dark/lime sheet, slide+fade,
  disabled under `prefers-reduced-motion`) whose items are **role-aware** via
  `lib/navigation.ts` — the PASSENGER/DRIVER/ADMIN sets never mix:
  - **PASSENGER:** Book a ride (`/rides`) · Ride history (`/rides/history`) ·
    Account (`/account`) · Sign out.
  - **DRIVER:** Driver workspace (`/driver`) · Trip history
    (`/driver/history`) · Account (`/account`) · Sign out.
  - **ADMIN:** both workspaces, both histories, Account, Sign out.
  - Role-unresolved sessions render only Account + Sign out (Phase 1
    isolation: another role's items can never flash).
  - The drawer closes on navigation, overlay click, or Escape; page scroll is
    locked while it is open.
- **Sign out lives in the menu** and uses Clerk's own flow
  (`useClerk().signOut()`); the env fallback redirect + `SessionCacheSync`
  query-clear perform the cleanup. The `UserButton` no longer appears in the
  header — `/account` keeps one for identity management.
- History is **removed from the workspaces** and reached only through the menu
  (dedicated routes — §5.5/§6.6).
- No hamburger icon while signed out — the landing page's GitHub link serves
  that corner and the auth pages keep their own layout.

---

## 8. Map

- **Keep maps in the MVP** as visualization only (ADR-007; requirements
  §21.G). Add `leaflet` + `@types/leaflet` — the only new runtime dependency
  this spec introduces.
- **Zone coordinates are the source of truth.** Draw geodata from
  `GET /api/zones` (mirror: `ZoneView`), which reads the seeded
  `zones` table — currently: **Banani** 23.7901, 90.40747 · **Gulshan 1**
  23.77978, 90.4166 · **Mohakhali** 23.7767, 90.4063 · **Dhanmondi**
  23.7461, 90.3761 · **Mirpur** 23.8072, 90.3646 · **Uttara** 23.8759,
  90.3795 · **Farmgate** 23.7561, 90.3906 · **Bashundhara** 23.8143,
  90.4316. Never hard-code coordinates in components.
- **Initial view:** Dhaka — center ≈ 23.79, 90.40, zoom ≈ 12; tiles from
  OpenStreetMap.
- **Markers:** pickup marker (accent) and destination marker on the zone
  coordinates of the current ride (passenger) / selected pool (driver);
  list of zone pins when empty.
- **Route:** a straight/accent polyline between pickup and destination as the
  reliable default. **Optional** static route via the public OSRM demo API as
  a progressive enhancement (draws the polyline between the two zone points).
- **Non-blocking rule (hard):** the map must never gate the app. If leaflet
  fails to load, tiles fail, or OSRM is unreachable, the workspace still
  renders fully (panel + actions); a `MapErrorCard`/fallback replaces only the
  map pane. No spinner that blocks the primary action because of the map.
- **Not in scope (ever, for MVP):** live GPS, real-time Tesla tracking,
  turn-by-turn, traffic-aware routing, live ETA (§9).

**Implemented (Phase 3, shared workspace skeleton):** `MapPane`
(`components/workspace/map-pane.tsx`) is the only module importing Leaflet and
is mounted via `next/dynamic(…, { ssr: false })` in the `/rides` page, so
Leaflet never executes during prerender. `leaflet/dist/leaflet.css` is a global
import in `app/layout.tsx` (safe App-Router spot for a node_modules stylesheet);
the dark restyles for popup/tooltip/zoom/attribution live in `app/globals.css`.
Zone pins use `L.divIcon` lime dots (no marker-image assets); coordinates come
only from `GET /api/zones`. `ResizeObserver` → 
`map.invalidateSize()` keeps the viewport correct across the desktop/mobile
grid switch. The initial view center ≈ 23.79, 90.40, zoom ≈ 12 and tiles from
OpenStreetMap. The workspace grid (`WorkspaceShell`) anchors to the exact
signed-in header height via `--app-header-height` +
`.site-header:has(.menu-button)` (globals.css); mobile stacks map-top
(@~40vh) over a scrolling panel, desktop puts the panel left
(`minmax(20rem, 26rem)`) and the map right (majority). Driver workspace
adoption is a later phase; the shell is role-agnostic. Rides use it now.

---

## 9. MVP scope / non-goals (explicit)

The MVP is deliberately **not** building:

- Live GPS / location permissions.
- Real-time driver or Tesla tracking on the map.
- Turn-by-turn navigation.
- Traffic-aware routing or live ETA.
- A real payment gateway (fares are integer paisa; completion is a cash /
  simulated acknowledgment — requirements §6, ADR-018).
- Dashboards, admin/reporting UIs beyond `/account`.
- Scheduling, ratings, chat/calls.
- Multi-city or route-geocoding; zones are predefined only (requirements §5).

---

## 10. State-driven UI philosophy

- The passenger and driver surfaces are each **one workspace that evolves
  with ride state** (requirements §4, `apps/api/src/rides/state.ts`) — not a
  page per phase.
- Passenger status → workspace mode: `null (no ride)` → book; creating →
  brief "searching" (REQUESTED is transient-only, ~instant); `MATCHED`
  (wait pool) → "matching you with a driver"; `MATCHED` (accepted) → driver
  assigned; `DRIVER_ARRIVED` → driver arrived; `STARTED` → in progress;
  `COMPLETED` → pay modal → book; `CANCELLED` → notice → book.
- Driver status → workspace section: offline → lobby hidden + go-online
  notice; online → lobby visible; owned `MATCHED` → accept-to-arrive; then
  arrive → start → complete → cash modal → lobby again.
- Reuse `StatusTimeline`/`StatusBadge` as the single visual vocabulary for
  "where am I in the state machine" on both surfaces.

---

## 11. Implementation principles

1. **Preserve backend/API/business logic.** No changes to fares, pooling,
   state machine, or availability semantics for frontend convenience.
2. **Reuse existing API contracts.** Use the hooks + types in `lib/`; the
   only **new backend capability** required is driver fare projection (§12-02)
   and it is additive, never a refactor of existing fields.
3. **Reuse components.** Build the new surfaces from the existing component
   inventory (§1); new primitives only where listed (§2.6).
4. **Fares come from the backend.** The UI renders `FareView` /
   driver-earnings fields verbatim; it never re-derives distance/discount.
5. **Responsive is mandatory.** Desktop panel split and mobile bottom sheet
   both pass (there is no desktop-only mode).
6. **Don't overengineer.** No state machines library, no new data layer, no
   TanStack Query changes.
7. **Incremental implementation.** Land in verified increments, each keeping
   the existing 44 web tests green and `npm run build -w @dhaka-tesla-pool/web`
   clean:
   1. Token swap (blue→lime) + Clerk retheme + landing simplification +
      GitHub link. **— done (Phase 1).**
   2. Hamburger/drawer navigation; move history out of the workspace.
      **— done (Phase 2).**
   3. Workspace skeleton (map + panel/sheet) with map non-blocking.
      **— done (Phase 3, map-only skeleton: `WorkspaceShell` + `MapPane`
      behind `/rides`; desktop panel-split + mobile map-top stacking. The
      mobile bottom-sheet behavior stays deferred — no gesture work yet.)**
   4. Passenger book/live/pay flow.
      **— Phase 4 (book-mode UX): segmented 1|2|3 seat stepper, route swap,
      live estimate card (FareView verbatim), zone-selection map feedback
      (pickup/destination pins + route fit), responsive form hierarchy. The
      live-ride workspace (§5.3) and completion/payment modal (§5.4) stay
      deferred.**
   5. Driver workspace (availability + lobby + open pools + cash flow) with
      earnings line once the API field exists.
8. **Document driver-facing map behavior** (markers/polyline pulls zone
   coords via `GET /api/zones`) in code comments referencing this spec.

---

## 12. Conflicts, gaps and assumptions (review before implementation)

The following were found while grounding this spec. None is silently
changed — each needs a conscious decision:

1. **Accent color conflicts with the shipped design system.** ADR-021 §4
   established GitHub-blue `--primary`. This spec requires a lime accent and
   therefore a **token + Clerk appearance change** (a deliberate visual
   direction decision, not a token renaming). ADR-021 §4's "switch later if
   the design surface grows" applies. **Assumption:** lime replaces blue
   everywhere in the app (not a secondary flavor).
2. **Driver fares/earnings is a backend gap (P9).** The spec (§6.4, §6.5)
   requires per-passenger fare and total earnings on the driver workspace,
   but `DriverPoolView`/`DriverPoolMemberView` deliberately carry **zero**
   fare fields ("individual per-passenger fares stay off the driver surface",
   `pooling/service.ts`). Fares exist only on the passenger surface. The UI
   will **not** compute them. Needs an **additive read-only backend field**
   (e.g., per-member fare + a `totalCollectedPaisa` on `DriverPoolView`,
   sourced from the already-stored `fares` rows) before those screens can
   show money. **Assumption:** this is accepted follow-up work; the passenger
   flow and §13 UI land without it, driver earnings render when the field
   ships.
3. **Landing is the single auth control set.** Signed-out visitors reach
   auth only from the landing CTAs; the reworked `AppShell` header (Phase 2)
   no longer renders a sign-in/up pair at all.
4. **`.page.tsx` has a numbered instruction block to remove**, and the
   passenger `/rides` page stacks booking + history; both are superseded by
   §3/§5/§7.
5. **Driver history cap.** `GET /api/driver/pools/history` returns at most
   10 pools (not client-configurable). The history drawer shows the newest
   10; no "load more" is spec'd for MVP. **Assumption:** acceptable; note in
   UI copy only.
6. **Map dependency.** `leaflet` + `@types/leaflet` are new dev/runtime
   deps (allowed by ADR-007). OSRM is a **public third-party network
   service** — used optionally for static route lines only, never a hard
   dependency; a straight polyline is the guaranteed fallback, and any
   failure is contained to the map pane (§8 non-blocking rule).
7. **Money stays integer paisa / BDT wire format.** UI formats via
   `formatPaisa`; completion modals acknowledge only — **no payment table or
   endpoint exists** (requirements §6 cash/ simulated wallet; ADR-018).
8. **Stale docs noticed (not changed here):** `README.md` "Known
   Limitations" still lists the two driver-UX bugs fixed in commit `e6fa0a1`
   (204 JSON parse; offline lobby visibility), and `docs/requirements.md` /
   `docs/architecture.md` still cite the pre-coordinate-update fare pins
   (5932 / 4140 paisa) from before commit `506971c`. These are documentation
   drift, outside this doc's scope, and should be corrected in a docs pass.
9. **"Searching" is a transient state.** Because `REQUESTED` is transient-only
   (ADR-022), the passenger's "searching" phase is effectively "booked into a
   wait pool, driver not yet claimed". The UI labels are phrased accordingly
   ("matching you with a driver") rather than inventing a synthetic
   searching state.
10. **App shell vs workspace.** Implemented (Phase 2): `AppShell` is now a
    minimal hamburger header with the signed-in user's identity centered (§7);
    the workspace, history, account, and sign-out action all live in the
    drawer. `/account` and the detail pages (`/rides/[rideId]`,
    `/driver/[poolId]`) stay reachable for deep-linking/history.
11. **Deviations from the earlier §7 draft (decided in the Phase 2 review).**
    The drawer omits the GitHub link (it stays on the landing corner), the
    `UserButton` was removed from the header (Account + Sign out live in the
    menu; `/account` keeps its own `UserButton` for identity management), and
    history is rendered on dedicated sub-routes `/rides/history` /
    `/driver/history` rather than a panel inside the drawer — so the drawer
    stays minimal and history stays deep-linkable behind the existing
    middleware/`RoleGate` protection.