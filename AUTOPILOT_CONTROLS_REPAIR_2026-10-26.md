# JATA Autopilot — Interactive Controls Repair (2026-10-26)

**Scope:** Autopilot page (`/dashboard/autopilot`), Command Center
(`/dashboard/autopilot/[businessId]`), shared workspace chrome and the Appearance picker.
**Production status: NOT DEPLOYED.** This change is delivered as a pull request for owner review.

## How it was investigated

Every reported control was exercised with real mouse clicks in a headless Chromium against a
**production build** (`next build` + `next start`), desktop (1280×800) and mobile (390×844),
as an authenticated owner of two businesses ("Karis Farm", "Salon and Styles") served by the
repository's offline Prisma stub. Hit-testing (`document.elementFromPoint`), URL changes,
network traffic, console/page errors and resulting banners were recorded per control.

Two hypotheses were tested and **eliminated**: (1) a global hydration failure — hydration is
clean (zero console/page errors, `aria-current` applied); (2) Next 16 + React 18 — React 18 is
within Next 16.4.2's declared peer range. An early "dead clicks in production" reading turned
out to be a harness artifact of the page's smooth scrolling; with instant scrolling the full
click matrix passes. The defects below are the real, reproduced causes.

## Control inventory (before → after)

| Control | Before | Root cause | After |
| --- | --- | --- | --- |
| **Appearance** | FAIL | `.product-theme-toolbar` z-index 40 < sticky `.ws-chrome` z-index 60 → the open options panel rendered **under** the header; the first theme option was covered and taps hit the nav rail (hit-test returned `<nav class="ws-rail">` / `Subscription`) | PASS — toolbar rises to z-index 65 only while the picker is open (`:has([open])`); picker closes on select/Escape; both options hit-test SELF and switching applies + persists |
| **Hero "Open Command Center"** | FAIL | Always a same-page anchor (`#autopilot-businesses`): it only scrolled — and with **zero** businesses the target section is not rendered, so the button did literally nothing | PASS — 1 business: opens that business's Command Center (label matches entitlement); 0: "Add a business" → `/onboarding`; ≥2: truthfully labelled "Choose a business" |
| Overview / Subscription / AI Front Desk / Website Studio / Business POS / Autopilot (rail) | PASS ( destinations correct) | — | PASS; touch target raised 40px → 44px to match the documented contract |
| Add a business (rail) | PASS → `/onboarding` renders the 7-step creation flow | — | PASS (unchanged). Actual creation POST: **NOT TESTED** (requires a real database; the offline stub refuses writes by design) |
| Home | PASS → `/` | — | PASS (unchanged) |
| Log out | PASS — POST `/api/auth/logout` → 303 `/login`, session cookie cleared | — | PASS (unchanged) |
| Back to overview | PASS → `/dashboard` | In the sandbox the overview page itself errors on stub data (`b.payments[0]`); verified the Prisma query includes `payments`, so this is a stub-only artifact, not production behaviour | PASS (unchanged) |
| Preview Command Center — Karis Farm | PASS → `/dashboard/autopilot/<karis-id>`, heading "Karis Farm" | — | PASS (unchanged); tenant check (`assertBusinessRole`) untouched |
| Preview Command Center — Salon and Styles | PASS → `/dashboard/autopilot/<salon-id>` (no cross-business bleed) | — | PASS (unchanged) |
| Command Center: Emergency Pause / selects / Refresh / Queue / Approve-Reject-Rollback / Run command / Ingest / Consent / Activate (billing) | FAIL (feedback) | Every async handler used `try/finally` **without `catch`** — a rejected `fetch` (dropped connection) reset the button with no message; `refreshOverview` also swallowed HTTP failures; the config route's saved-config echo was ignored, so controls could look unchanged after a successful save | PASS — all handlers surface one honest network-error notice; owner-pressed Refresh reports failures; saved config is applied immediately from the server echo; voice dictation start failures show the typed-fallback guidance. Server-side behaviour, policy and billing gates untouched |
| Guard tiles / status pills / hero stats | INFORMATIONAL (not controls) | — | Unchanged — they carry no action affordance |

## Business-data & billing safeguards (unchanged, verified by inspection)

- No server code, API routes, `lib/autopilot/*` policy/entitlement, pricing, schema or env
  configuration was modified. Preview Mode still cannot execute live actions
  (`ENTITLEMENT_REQUIRED` for EXECUTE/AUTO_EXECUTE phases in `lib/autopilot/policy.ts`).
- The hero change only reuses the existing per-business route; the page still enforces
  `assertBusinessRole` tenant isolation. No new routes. No fabricated data: the config echo
  applied on pause/mode change is the server's own saved response.
- Authentication/session logic untouched (logout verified end-to-end in browser).

## Verification evidence

- **New browser check:** `npm run test:browser:autopilot-controls`
  (`scripts/browser/autopilot-controls.check.mjs`) — **18/18 PASS** on the production build
  (desktop + mobile): Appearance hit-tests, theme apply+persist+close, hero truthfulness,
  distinct per-business links, 44px rail targets, logout. Pre-fix run of the same probes
  failed the Appearance hit-test and theme selection on both viewports.
- **New unit tests:** `tests/unit/autopilot-controls-repair.test.ts` — **14/14 PASS**
  (stacking contract, hero branches, catch coverage, touch targets).
- **Full suite:** `npm test` → **2706 passed, 1 failed, 121 skipped**. The single failure
  (`Prisma.dmmf` in `autopilot-phase1-hardening.test.ts`) is pre-existing in this offline
  sandbox (no generated Prisma client — `binaries.prisma.sh` unreachable) and fails
  identically on unmodified `main`; it is unrelated to this change.
- **Lint:** `npm run lint` → 0 errors (40 pre-existing warnings).
- **Type-check / build:** `npm run build` compiles successfully; the type-check step fails
  only on the same three pre-existing offline-Prisma type gaps in test files. On Vercel,
  `prisma generate` runs and these resolve.
- **Mobile:** no horizontal overflow on the Autopilot pages (scrollWidth == clientWidth at
  390px); no click-blocking overlays remain on the audited surfaces.

## Not tested / owner actions

- Business **creation persistence**, Autopilot **checkout activation**, and all DB-backed
  write paths could not be executed here (no Postgres available in the sandbox; the stub
  rejects writes). They are unchanged by this PR; verify once after deployment with a real
  account. If production shows “plan record is not seeded” on Activate, run `npm run seed`
  against production (the seed defines the three Autopilot plans).
- Older Android WebViews were not available; verification used Chromium 153.
- Logout redirects to the configured `PUBLIC_BASE_URL` origin by design
  (`lib/url.ts getBaseUrl`); confirm that variable is the production domain in Vercel.

## Changed files

- `app/globals.css` — open-picker stacking (z 65 while open); rail links 44px.
- `components/ProductThemeProvider.tsx` — picker closes on select/Escape.
- `app/dashboard/autopilot/page.tsx` — truthful hero primary action per business count.
- `components/autopilot/AutopilotCommandCenter.tsx` — network-error surfacing, refresh
  reporting, config echo, dictation failure feedback.
- `tests/unit/autopilot-controls-repair.test.ts` — new regression tests.
- `scripts/browser/autopilot-controls.check.mjs` + `package.json` script — browser check.
- `AUTOPILOT_CONTROLS_REPAIR_2026-10-26.md` — this report.
