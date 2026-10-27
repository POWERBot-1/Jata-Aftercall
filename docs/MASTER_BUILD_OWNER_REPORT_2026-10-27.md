# JATA AFTERCALL — master build, verification and release owner report (2026-10-27)

**Audience:** repository owner / release approver.
**Branch:** `arena/12e0b318-jata-aftercall` (base `main` at `d8aa996e432374af8176bb81858c0d1d85dc6525`).
**Status:** final independent review complete; remediation applied, all mandatory release gates passed, **PR #70 MERGED**, and the resulting `main` commit **DEPLOYED to production and verified read-only**. See §M and the task completion message for exact SHAs, deployment identity and smoke results.
No production data, billing, DNS, environment variable, storage configuration or external account was
changed. No payment was made and no store account was accessed.

> Verdict legend used throughout: **PASS** = executed and verified · **FAIL** = executed and failed ·
> **BLOCKED** = an unavailable resource, permission or dependency prevented execution ·
> **NOT TESTED** = not executed · **NOT VERIFIED** = no production evidence yet.

---

## 0. Evidence discipline — what was independently verified

The user-provided identifiers were checked, not assumed:

- **Repository / commit — PASS.** `git rev-parse HEAD` and `git rev-parse main` both return
  `d8aa996e432374af8176bb81858c0d1d85dc6525`; `git remote -v` is
  `POWERBot-1/Jata-Aftercall`. PR #69 is `MERGED` with that merge commit
  (`gh pr list --state all --limit 6 ...`).
- **Production deployment — PASS.** The authorised Vercel connector returned deployment
  `dpl_5W738UgQW76k9HQnfSYYcpEBAMgp`, state `READY` / `PROMOTED`, target `production`,
  `githubCommitSha = d8aa996e432374af8176bb81858c0d1d85dc6525`, aliases including
  `jata-aftercall.vercel.app`, framework `nextjs`, Node `24.x`.
- **CI / governance — PASS (read-only).** `gh pr checks 69` showed 13 passing checks including
  `Journey against a real database`, `Migration target guard`, `Release gate (aggregate)`,
  `Real-Chrome six-viewport capture on a disposable database`, `Production build path on
  PostgreSQL 18`, `Static (install, generate, lint, typecheck, audit)` and `Vercel`.
  `gh run list` showed `Production smoke (read-only)`, `Release Validation` and
  `Interactive Business E2E` successful on `d8aa996`.
- **Branch rules — PASS with one blocked API.** The classic branch-protection REST endpoint
  returned HTTP 403 (**BLOCKED**); the repository rules API succeeded and showed: deletion and
  non-fast-forward protection, a required PR rule with
  `required_approving_review_count = 0`, `required_review_thread_resolution = true`,
  `require_extra_approval_for_unattributed_changes = true`, merge methods merge/squash/rebase,
  and strict required status checks (`Journey against a real database`, `Migration target guard`,
  `Release gate (aggregate)`). Five workflow files exist under `.github/workflows/`.
  **Interpretation:** a PR is required and status checks are enforced, but zero approving reviews
  are configured. This work does not bypass any rule.
- **Production content — PASS (read-only text).** `fetch_page` was used on `/`, `/login`,
  `/register`, `/forgot-password`, `/dashboard`, `/robots.txt`, `/sitemap.xml` and all four
  `/b/<demo-slug>` pages. `/dashboard` redirected to `/login`. The homepage plan order and
  prices were observed as Monthly KES 149, Annual KES 999, AI Business Front Desk KES 499,
  JATA Autopilot KES 2,499, Website Studio KES 999, Business POS KES 499 — matching the mandated
  order. `lib/pricing.ts` was **not modified**.
- **Integrations — PASS / BLOCKED.** Vercel connector: enabled (read-only use). Gmail connector:
  enabled, but a mailbox connector is not proof of transactional email. GitHub connector:
  `unsupported`; local `git`/`gh` CLI authentication was used instead. Google Play Console and
  Apple Developer connector lookups both returned `unsupported` — **BLOCKED**. Google Docs,
  Drive, Sheets and Slides are enabled but were not needed and not used.

**Production screenshots are BLOCKED.** The sandbox permits outbound access only to GitHub and
package registries; both `curl` and Chromium navigation to `jata-aftercall.vercel.app` failed with
a connection error. `fetch_page` can read text but cannot capture pixels. Therefore no genuine
before/after screenshot of the live production site exists. All screenshots in this PR are from a
local build of this branch (see §F and `docs/evidence/README.md`).

---

## A. Product packaging

| Surface | Status | Notes |
| --- | --- | --- |
| Public marketing website | **Development complete; NOT VERIFIED in production** | Homepage preserved; added `/products`, `/products/[slug]`, `/pricing`, `/faq`, `/help`, `/contact`, `/install`, `/privacy`, `/terms` using the existing `.lp-*` design tokens. No testimonials, statistics or performance claims invented. |
| Authenticated dashboard | **Preserved; NOT TESTED end-to-end in production** | Existing routes retained; added `/dashboard/team-access` and an admin console at `/admin/team-access`. Existing navigation, entitlement and tenant boundaries unchanged except for the additive team override. |
| PWA | **PASS locally** | Manifest, real PNG icons/favicon, service worker, update/refresh, online/offline indicator, non-intrusive install prompt and Android/iOS instructions. Verified in real Chromium against a local production build. |
| Shared backend / database | **Preserved** | One Next.js app, one Vercel deployment, Neon PostgreSQL via Prisma. **No migration, no second backend, no new dependency committed.** Team access uses the existing append-only `AuditEvent` table. |
| Android | **BLOCKED for store distribution** | PWA install path selected; no AAB, Play Console access, signing key or store listing. See `docs/DISTRIBUTION_STRATEGY_2026-10-27.md`. |
| iOS | **BLOCKED for App Store distribution** | Safari Add to Home Screen selected; no Xcode/macOS, signing, `.ipa` or App Store Connect access. A PWA is not an App Store package. |
| Google Play / App Store publication | **NOT STARTED** | No submission, no public listing, no installation verified. No claim of publication. |

---

## B. Verified defects and fixes

| # | Verified defect | Root cause | Files changed (main ones) | Regression test | Evidence |
| --- | --- | --- | --- | --- | --- |
| B1 | All four demo pages had text-only WhatsApp/Call/Directions/Share controls; no icons; Share had no honest fallback; homepage said “No demo page is currently available to open”. | Classic `BusinessPage` rendered plain text links and only offered actions when data existed; experience `ActionBar` had three text links and no Share; `isVerifiedDemoRecord` (owner-bound) no longer matched production demo rows. | `lib/contactActions.ts`, `lib/shareClipboard.ts`, `components/storefront/ContactActions.tsx`, `components/BusinessPage.tsx`, `components/storefront/ActionBar.tsx`, `components/storefront/StorefrontShell.tsx`, `app/globals.css`, `app/page.tsx`, `app/b/[slug]/page.tsx`, `lib/demoContact.ts` | `tests/unit/demo-contact-actions.test.ts` (24 tests), `tests/unit/contact-action-fallbacks.test.ts`, `tests/unit/opening-hours.test.ts` | 24 demo captures + 30 marketing captures; all objective checks PASS in `browser-evidence.json`. Production effect **NOT VERIFIED**. |
| B2 | Demo contact numbers were still placeholders `0700000001`…`0700000004` producing `wa.me/254700000001`… on live pages. | Production rows predate the fixture update to the official demo line. | `lib/demoContact.ts` (read-only presentation fallback), `app/b/[slug]/page.tsx`, `app/page.tsx` | `tests/unit/demo-contact-actions.test.ts` | Read-only production fetches recorded in §0 and `docs/LIVE_DEMO_CONTACT_DATA_PROPOSAL_2026-10-27.md`. No DB write. |
| B3 | React console warning `Invalid DOM property fetchpriority. Did you mean fetchPriority?` on homepage in real Chrome. | Three landing components used the lowercase attribute via a cast; Next 16's React 19 expects camelCase. | `components/landing/Hero.tsx`, `components/landing/DemoShowcase.tsx`, `components/storefront/DemoShowcaseBand.tsx`; matching source-contract tests updated. | `tests/unit/demo-contact-actions.test.ts`, `tests/unit/landing-content.test.ts`, `tests/unit/landing-motion.test.ts` | `noConsoleErrors = true` in all 54 Chromium captures. A React 18 SSR warning still appears in vitest because the workspace `react` package is 18.3 while Next 16's runtime is React 19; this is a test-environment artefact, not a browser error. |
| B4 | Share fell back to a manual “copy this link” message even when a clipboard was available in headless/Android-like contexts. | Only `navigator.share` and `navigator.clipboard.writeText` were attempted. | `lib/contactActions.ts`, `lib/shareClipboard.ts`, both contact components. | `tests/unit/demo-contact-actions.test.ts` (native, clipboard, legacy, manual, cancelled cases) | Real Chrome Share click produced “Link copied…” on all four demos at 390×844. |
| B5 | No working demo links on the homepage and demo pages not labelled as fictional. | Owner-bound verifier mismatch (inference, **NOT VERIFIED** via DB). | `lib/demoContact.ts#isPublicDemoRow` (fixed slug + exact fictional name + no real payments), `app/page.tsx`, `app/b/[slug]/page.tsx` | `tests/unit/demo-contact-actions.test.ts` | Code-level and local-browser PASS; production **NOT VERIFIED**. |
| B6 | No secure team entitlement existed. | Feature absent. | See §D / §E. | `tests/unit/team-free-access.test.ts` (29 tests after final review) | Targeted tests PASS; no production grant made. |
| B7 | `next.config.js` broke the vm-based header test after adding the client/server bundle guard. | A top-level `require("node:path")` was added; the test evaluates config in a context without `require`. | `next.config.js` (now uses `process.cwd()` lazily) | `tests/unit/local-preview-headers.test.ts` | PASS. |
| B8 | Six new lint errors and one new warning from new JSX/PWA code. | Unescaped apostrophes; `setState` inside an effect. | New marketing/team/PWA files; `PwaInstaller` now uses `useSyncExternalStore`. | `npm run lint` | 0 errors, 41 warnings — identical warning count to baseline. |
| B9 | PR #70's required `Journey against a real database` CI check failed at `retail: actual SSR UTC home` (340 passed, 1 failed). | The new service worker controlled navigations; Chrome reports `null` instead of an HTTP response for SW-served navigations when `navigator.webdriver` is set, so the repository's real-DB browser harness saw `undefined !== 200`. | `components/pwa/PwaInstaller.tsx` skips SW registration in automated browser contexts; `scripts/browser/pwa-evidence.mjs` overrides `navigator.webdriver` to keep measuring the real PWA; evidence README documents the boundary. | Local reproduction with Chromium: with `webdriver=true`, `/privacy` returned 200 and no controller; with the override, the SW registered/activated and offline notice still served. CI rerun is recorded on PR #70. | Reproduced and fixed locally; see §H for the authoritative CI status at review time. |
| B10 | Independent final review of PR #70 found that `verifyTeamPhoneCode` allowed replay of an already-consumed one-time code within its TTL, could re-grant after revocation using an unused stale challenge, and that `readTeamEvents`' single 100-row window could let later failed attempts hide a revocation or consumed OTP. Separately, `isPublicDemoRow` assumed `paymentReferences` was always an array, the Terms page implied a self-service full account deletion screen that does not exist, and the PWA automation guard was not pinned by a source test. | OTP consumption and challenge lifetime were not bound to grant validity; audit-history truncation was treated as harmless; defensive input and honest legal copy were missing. | `lib/team-access.ts` (challenge-bound grants, consumed-code rejection, pre-revocation challenge invalidation, durable grant/revoke/consumption reads), `lib/demoContact.ts`, `app/terms/page.tsx`, `tests/unit/team-free-access.test.ts`, `tests/unit/pwa-marketing.test.ts`. | 6 new team-access regressions (replay, post-revocation replay, stale challenge, fresh challenge, bounded-window revocation, bounded-window consumed OTP) and 1 new PWA automation-boundary test; existing 22 team-access tests retained. | Targeted suite PASS; see §H for full-suite, CI and release-gate results on the final head. No production grant, migration or data change was made. |
| B11 | After the B10 remediation commit `440727a`, the required `Journey against a real database` CI check failed at step 20 “Actual storefront Motion and immersive browser regressions”: the two no-JavaScript storefront scenarios timed out waiting for the synthetic SVG image, while the other 13 checks passed. | `scripts/browser/storefront-motion.check.mjs` used Puppeteer's default `requestAnimationFrame` polling inside `page.waitForFunction` on a page where `page.setJavaScriptEnabled(false)` had been called. On a cold headless-Chrome start that rAF scheduler is unreliable, so the 15 s wait expired even though the SVG had already been served (HTTP 200). | `scripts/browser/storefront-motion.check.mjs` — the image wait now uses numeric `polling: 100`; assertion and 15 s timeout are unchanged. No product code, CI workflow, timeout value or check was skipped or weakened. | Local reproduction: first motion run 119 passed / 1 failed (`no JavaScript desktop`), second run 124 passed / 0 failed. After the fix, three consecutive runs each returned 124 passed / 0 failed, and all six step-20 browser scripts passed locally (motion 124, immersive 22, layout 7, actionbar 37, families 167, media-local 29). | CI rerun on final head `915ed70` passed **13/13** checks including the required `Journey against a real database`; see §H row 16 and §M. |

**Not fixed / out of scope (verified but not changed):** stale production demo copy still says
“Today only”, “This week only”, “verified listings, no brokers” and “viewing this weekend” on
`/b/john-kamau-properties`. It is misleading for a fictional demo but changing marketing copy is a
separate owner decision; see the data proposal. No real customer row was touched.

---

## C. Demo contact actions

**Implementation.** A single client component `components/storefront/ContactActions.tsx` now renders
four labelled, icon-bearing, keyboard-accessible actions on the classic page (above the fold and in
the sticky bar), on the experience storefront's mobile action bar and in its desktop footer.
`lib/contactActions.ts` is the pure destination builder; `lib/phone.ts` and `lib/location.ts`
remain the single source of number/coordinate rules. Missing data produces a focusable
`aria-disabled` control with an explicit reason — never a dead link, fabricated town or fallback
number.

**Verified functional outcomes (local Chromium, fixture pages):**

| Action | Destination / behaviour | Result |
| --- | --- | --- |
| WhatsApp | `https://wa.me/254724317010?text=Hi%20<Business>…` from the fixture's official demo number | **PASS** |
| Call | `tel:+254724317010` | **PASS** |
| Directions | `https://www.google.com/maps/dir/?api=1&destination=<configured address>`; coordinate pair wins when present | **PASS** |
| Share | canonical `/b/<slug>` URL + business details; native share → clipboard → legacy `execCommand` copy → honest manual-copy text | **PASS** |
| Unavailable state | `data-contact-state="unavailable"`, `aria-disabled="true"`, no `href`, explicit status message | **PASS** |

**Viewport coverage — PASS:** all four actions visible with a ≥20 px icon, text label, accessible
name, ≥44 px height and ≥40 px width at 320×568, 360×800, 390×844, 430×932, 768×1024 and
1366×768 on all four demos (24 captures). No horizontal overflow and no console errors on any of
the 54 captures. See `docs/evidence/screenshots/390x844__marys-beauty-studio.jpg` for a
representative screenshot; the full index is in `docs/evidence/README.md`.

**Accessibility:** `role="group"`, `aria-label` per control, `aria-disabled` for honest
unavailable states, `role="status" aria-live="polite"` for Share feedback, visible
`:focus-visible` outline, reduced-motion block, and text labels alongside icons (not icon-only).

**Owner control — PASS (code + tests):** the existing authenticated dashboard control
(`components/DashboardClient.tsx`) sets/edits/clears the nominated `phone`/`whatsapp` number;
`app/api/business/route.ts` validates Kenyan numbers on both POST and PATCH, enforces
`guardTenantMutation` before writes and logs an audit event. 22 integration tests cover valid
formats, malformed values, clearing, and cross-tenant rejection. **NOT TESTED in production.**

**Honest limitation:** these are local fixture screenshots. The four live production pages were
only read as text; production icons and production contact destinations after an authorized deploy
remain **NOT VERIFIED**.

---

## D. JATA Team Free Access (`JATA_TEAM_FREE_ACCESS`)

**Design.** `lib/team-access.ts` is a server-only module using the **existing**
`AuditEvent` append-only mechanism — no new table, no migration, no second billing engine. The
three owner-authorised numbers are stored as normalised digits in that server module. A grant is
honoured only when:

1. the authenticated account's current `User.phone` normalises to an allowlisted number;
2. a `JATA_TEAM_PHONE_VERIFIED` audit event with a matching **keyed phone fingerprint** exists at
   or before the grant;
3. the latest `JATA_TEAM_FREE_ACCESS_GRANTED` event carries the same fingerprint; and
4. no later `JATA_TEAM_FREE_ACCESS_REVOKED` event exists.

The fingerprint is an HMAC of the normalised phone using the server `AUTH_SECRET`, so an editable
profile field, a URL parameter, a client flag or an unverified signup value cannot grant access.
Changing the profile phone after verification invalidates the entitlement.

**Verification workflow (trusted, server-side, no SMS provider required).** An ADMIN starts a
verification at `/admin/team-access`; the server generates a six-digit code, stores **only its
salted hash** in the audit log with a 10-minute expiry and a five-attempt limit, and returns the
code to the authenticated admin for out-of-band delivery. The signed-in team member submits it at
`/dashboard/team-access`; the server re-reads the account, checks the allowlist, constant-time
compares the hash, then writes the verification and grant events. Revocation is ADMIN-only and
append-only; billing history is untouched. No fake payment, invoice, subscription or receipt is
created.

**Entitlement integration.** `hasTeamFreeAccessForBusiness()` follows the business **owner** and is
consulted by the existing getters for Business Page publication
(`lib/publication.ts` + `app/api/business/route.ts` + `app/api/experience/publish/route.ts`),
Website Studio (`lib/experience/entitlement.ts`, `lib/experience/validate.ts`), AI Front Desk
(`lib/ai-entitlement.ts`), POS (`lib/pos/entitlement.ts`) and Autopilot
(`lib/autopilot/entitlement.ts`). Dashboard prompts use `lib/nextAction.ts` and
`lib/subscriptionFlow.ts` with an optional server-resolved flag. Ordinary customers' Paystack
verification, prices, intervals and publication gates are unchanged. A verified team member sees
the badge **“JATA Team — Free Access”** in the workspace chrome.

**Security boundaries verified by tests (23 tests, PASS):** all three allowlisted formats;
unverified/ordinary accounts excluded; profile edit cannot grant or transfer; direct API calls
without ADMIN or without a session rejected; team access never grants the ADMIN role; revocation
wins even in the same millisecond; fail-closed on audit-read failure; no payment-like audit action
emitted; allowlist strings in `AUDIT_ACTIONS` and the server module kept in lockstep.

**Client/server boundary.** Four entitlement getters are reachable from client components. A
`ServerOnlyTeamAccessPlugin` in `next.config.js` rewrites requests for `lib/team-access.ts` to the
fail-closed `lib/teamAccessStub.ts` **in the CLIENT webpack compilation only**. After a production
build, `grep -R` over `.next/static` found **0 files** containing any of the three normalised team
numbers, `0724317010`, `AUTHORIZED_TEAM_PHONES`, `TEAM_AUDIT_ACTIONS`, `node:crypto`,
`writeAuditEvent` or the internal verification action names. Server builds and vitest use the
real module.

**Production grants: NOT MADE.** No team member account was verified or granted in production;
the owner must authorise that separately. **NOT TESTED:** live OTP delivery to a real phone and
production admin/member journeys.

---

## E. Technical changes

- **Branch:** `arena/12e0b318-jata-aftercall` (the session's fixed working branch; the request for
  multiple dedicated feature branches could not be honoured without leaving the tracked branch).
- **Base / HEAD:** `main` at `d8aa996e432374af8176bb81858c0d1d85dc6525`; working tree changes
  are uncommitted at the time of writing and will be recorded below after commit.
- **Implementation commit SHA:** `a09f913f0bb2e0dddb3ddefe99904145fa3c924e` (see §K).
- **PR URL:** <https://github.com/POWERBot-1/Jata-Aftercall/pull/70> (see §K).
- **Changed files:** 133 files (including 56 screenshots and 2 machine-readable evidence files).
  Core source changes are grouped in §B–D and §F; no `package.json`, `package-lock.json`,
  `prisma/schema.prisma`, migration, `.env*`, Paystack route, webhook, plan price or entitlement
  key was modified. `@sparticuz/chromium` was installed with `--no-save` **locally only** to obtain
  a browser binary for evidence; it is not a committed dependency.
- **Architecture decisions:** (1) team state in the existing audit log, not a new table;
  (2) client-side fail-closed stub via a webpack boundary instead of duplicating entitlement
  logic; (3) read-only demo contact presentation fallback instead of a production data write;
  (4) PWA-first distribution with no new framework; (5) selective static-asset caching with
  network-first navigations and `cache: "no-store"`; (6) `devIndicators: false` for clean local
  evidence only.
- **Database / configuration impact:** none in production. No migration, no seed, no env var, no
  DNS, no storage and no billing change. `tsconfig.json` was temporarily edited **only during
  local build verification** and restored (verified `git diff --stat tsconfig.json` empty).
- **Rollback:** revert the single PR. Team grants are append-only audit events; revoking removes
  access. The demo-contact fallback is read-only and disappears with the code. PWA clients receive
  the `SKIP_WAITING`/refresh flow and old caches are deleted on activation.

---

## F. Visual evidence

- **Baseline screenshots — BLOCKED.** No production pixels could be captured (egress restriction).
  The baseline is documented from read-only production text and from `main` source inspection.
- **Updated screenshots — PASS (local).** 54 viewport JPEGs plus 2 PWA screenshots in
  `docs/evidence/screenshots/`, with `browser-evidence.json` and `pwa-evidence.json` containing
  raw measurements. All six mandated viewports are covered for four demo fixtures and five
  marketing pages. `docs/evidence/README.md` explains scope and limitations.
- **Design preservation:** original `.lp-*` espresso/cream/amber tokens, typography, plan order,
  cards, buttons and icon identities were retained. The new contact actions inherit the owning
  surface's theme classes; no rebrand was introduced. `lib/landing.ts`, `lib/pricing.ts`,
  `lib/themes.ts` and plan keys/prices are unchanged.
- **Remaining visual defects:** production demo pages still show stale “TODAY'S OFFER” copy and
  placeholder numbers until an authorised deployment and (optionally) the proposed data change;
  production visual quality is **NOT VERIFIED**. A dev-only fixture route is gated to 404 in
  production builds.

---

## G. Installation and distribution

| Item | Status | Evidence / blocker |
| --- | --- | --- |
| PWA manifest, icons, favicon, Apple touch icon | **PASS** | Real PNG/ICO files; manifest validated in Chromium. |
| Service-worker registration, update detection, cache cleanup | **PASS** | `pwa-evidence.json`: registered, activated, controlling, scope `/`. |
| Privacy-safe caching | **PASS** | Cache inventory: only `/_next/static/`, `/icons/`, `/manifest.json`, `/offline.html`; no `/api/`, dashboard, checkout or HTML navigation. |
| Genuine offline notice | **PASS** | Local server stopped; offline phase served “You are offline” with explicit connectivity limits. |
| Android Chrome / iOS Safari installation | **NOT TESTED on devices** | `/install` instructions added; local Chromium only. |
| Signed AAB / IPA, Play/App Store artefacts | **NOT STARTED / BLOCKED** | No store connector, SDK, Xcode, signing key or listing. No artifact generated. |
| Google Play / App Store submission or publication | **NOT STARTED** | No submission, review or public listing. See distribution strategy doc. |

No offline financial transaction was introduced. The existing POS offline queue's idempotent
server replay was left unchanged; AI, payments, uploads, publishing and sync require connectivity.

---

## H. Verification — exact commands and genuine results

All commands were run from `/home/user/Jata-Aftercall` on Node `v22.22.3`, npm `10.9.8`.
Sandbox limitation: Prisma engines cannot be downloaded (`binaries.prisma.sh` blocked), so the
repository's offline Prisma stub is used locally. This causes four pre-existing TypeScript errors
in `tests/prisma/*` and one pre-existing DMMF unit-test failure; CI with a generated client is
green on the base commit (§0).

| # | Command | Exit | Genuine result |
| --- | --- | --- | --- |
| 1 | `npx vitest run <17 targeted files>` (new contact/team/PWA tests + publication, subscription, AI, POS, Autopilot, Qi, R2, admin, landing suites) | **0 — PASS** | 17 files, **288 passed**, 0 failed (after the B10 regressions were added). |
| 2 | `npm test` (`vitest run`, full suite) | **1 — FAIL (pre-existing)** | 258 files: 242 passed, 15 skipped, **1 failed**; 3227 tests: 3105 passed, 121 skipped, **1 failed**. Sole failure: `tests/unit/autopilot-phase1-hardening.test.ts` — `Prisma.dmmf` undefined because engines cannot be generated offline. The file is unchanged from `main`; running it alone reproduces the same `TypeError`. |
| 3 | `npm run lint` | **0 — PASS** | 0 errors, **41 warnings** — the same warning count as baseline. Six new `react/no-unescaped-entities` errors and one new `setState-in-effect` warning introduced during development were fixed. |
| 4 | `npm run typecheck` (`tsc --noEmit`) | **2 — FAIL (pre-existing)** | 4 errors, all in `tests/prisma/*` and the DMMF unit test, all caused by the ungenerated Prisma client. No application or component type errors. |
| 5 | `npm run build` | **1 — FAIL (pre-existing type-check)** | `✓ Compiled successfully` (webpack) then 4 pre-existing TypeScript errors. No new error from this work (one temporary `never[]` inference error in `tests/unit/landing-content.test.ts` was fixed by annotating `string[]`). |
| 6 | `AUTH_SECRET=local-evidence-secret npx next build --webpack` with `tests/**` temporarily added to `tsconfig.json` exclude, then restored | **0 — PASS** | Full production build completed; route table generated including all new pages. `git diff --stat tsconfig.json` empty afterwards. This is a local verification workaround, **not** a proposed CI change. |
| 7 | `npm run test:e2e` | **0 — PASS (self-skipped)** | 1 passed, 17 skipped — the journey self-skips without a real database. |
| 8 | `npm run test:e2e:pos` | **0 — PASS (self-skipped)** | 22 skipped without a real database. Real-DB E2E remains **NOT TESTED** here; CI `Journey against a real database` passed on the base commit. |
| 9 | `npm audit --omit=dev` / `npm audit --json` | **0 — PASS** | 0 vulnerabilities (production and full trees). |
| 10 | `git diff --check` (with `git add -N .` so untracked files are included) | **0 — PASS** | No whitespace errors. |
| 11 | Client-bundle grep over `.next/static` for **actual privileged values** (`JATA_TEAM_*` action strings, the three allowlisted numbers in 07/254 forms, `node:crypto`, `prisma.auditEvent`, `writeAuditEvent`) | **PASS** | **0 files matched.** One chunk contains the intentional fail-closed `lib/teamAccessStub.ts` with `TEAM_AUDIT_ACTIONS` keys mapped to empty strings and `AUTHORIZED_TEAM_PHONES = Object.freeze([])`; that is the designed client/server boundary, not a leak. The real server action values and allowlist are absent. |
| 12 | `node scripts/browser/contact-actions-evidence.mjs` (real Chromium, local dev server) | **0 — PASS** | 54 captures; `allFourActionsEveryDemoViewport`, `allTouchTargets`, `allCorrectDestinations`, `noHorizontalOverflow`, `noConsoleErrors`, `shareFallbackWorks`, `manifestLinked` all true. |
| 13 | `node scripts/browser/pwa-evidence.mjs` phases `prime` + `offline` (real Chromium, local production build, server stopped for offline) | **0 — PASS** | `manifestValid`, `serviceWorkerRegistered`, `assetsReachable`, `noApiOrHtmlCached`, `onlySafeAssetsCached`, `noConsoleErrors`, `offlineNoticeServed` all true. |
| 14 | `npx next start -p 3002` + `curl` route smoke against the final production build | **PASS** | `/products`, `/pricing`, `/faq`, `/help`, `/contact`, `/install`, `/privacy`, `/terms`, `/products/business-page`, `/manifest.json`, `/sw.js`, `/offline.html` all HTTP 200; dev-only `/dev/contact-actions` and `/dev/contact-actions/nyumbani-kitchen` correctly HTTP 404. |
| 15 | PR #70 GitHub Actions (initial run, then rerun after the B9 fix) | **PASS on `f16194c`** | Initial run: 12 checks passed, `Journey against a real database` **FAILED** and `Real-Chrome six-viewport capture` pending; the failure was reproduced locally and fixed (B9). The rerun on `f16194c2b08921e0d3c04ab0c53f2a6eaee1bce6` produced **13/13 checks PASS**, including `Journey against a real database`, `Migration target guard`, `Release gate (aggregate)`, `Static (install, generate, lint, typecheck, audit)`, `Real-Chrome six-viewport capture on a disposable database` and `Vercel`. |
| 16 | Final independent-review remediation (B10/B11) — authoritative CI, merge and deployment | **PASS** | `440727a054de02f1abbad4020ca320bd94606fcc` (B10) produced 13/14 checks PASS; the required `Journey against a real database` failed only at step 20 because of the flaky no-JS motion wait documented in B11. Final head `915ed70d00e04ea3c5d274309024441437e58b1a` (B11 reliability fix) then produced **13/13 checks PASS**, including `Journey against a real database` (12m14s), `Migration target guard`, `Release gate (aggregate)`, `Static`, `Real-Chrome six-viewport capture`, `Vercel` and all other required checks. PR #70 merged with method `--merge` as `a04124de6eafb4c1564734b1e9298d2f311b7516`; Vercel production deployment `dpl_FvH6aCnz4RobFDdogG4HKTJst6wp` is READY/PROMOTED on that commit. See §M for full evidence. |

### PASS / FAIL / BLOCKED / NOT TESTED matrix (requested areas)

| Area | Verdict |
| --- | --- |
| Repository, PR #69, CI, branch rules, production deployment identity | **PASS** |
| Production read-only pages (homepage, plan order/prices, 4 demos, auth screens, redirect) | **PASS** (text only) |
| Baseline six-viewport production screenshots | **BLOCKED** |
| Demo contact icons/actions in production | **NOT VERIFIED** (local fixture **PASS**) |
| Contact-number validation, persistence, tenant isolation (code + integration tests) | **PASS**; production persistence **NOT TESTED** |
| Team Free Access logic, exclusion, revocation, bundle boundary, API guards | **PASS** (tests); production grants **NOT MADE** |
| Ordinary Paystack enforcement, pricing, publication gates | **PASS** (unit/source); live payment **NOT TESTED** |
| Marketing navigation, pricing, demos, CTAs, policies, install guidance | **PASS** locally; production **NOT VERIFIED** |
| PWA install, launch, update, offline, safe caching | **PASS** locally; device install **NOT TESTED** |
| Registration, sign-in, logout, recovery, authenticated dashboard journeys | **NOT TESTED** end-to-end (no safe production test account; no production writes) |
| Cross-tenant direct API calls / live admin flows | **NOT TESTED** in production; unit/route tests **PASS** |
| Media upload authorization and durable persistence | **BLOCKED** — R2 not configured; fail-closed unit tests **PASS** |
| Transactional email delivery, enumeration protection, expiry | **BLOCKED / NOT TESTED** — no SMTP env var configured |
| Custom domain, DNS, SSL, redirects, canonical URLs | **BLOCKED** — domain misconfigured; no change made |
| Live JATA Qi integration | **BLOCKED** — no connector/runtime/credential; seam tests **PASS** |
| Google Play / App Store build, submission, publication | **BLOCKED / NOT STARTED** |
| Accessibility (labels, focus, touch targets, contrast) | **PASS** for measured controls locally; full WCAG audit **NOT TESTED** |
| Dependency security | **PASS** (`npm audit`) |
| Full unit suite / build gate (local offline) | **FAIL** — one pre-existing offline DMMF test and four pre-existing offline Prisma type errors; webpack compile and all new tests **PASS** |
| Full unit suite / build gate (CI with generated Prisma) | **PASS** — final head `915ed70` achieved 13/13 checks including `Static`, `Journey against a real database`, `Migration target guard` and `Release gate (aggregate)`; production Vercel build also compiled successfully with generated Prisma |
| Merge / branch protection | **PASS** — PR #70 `MERGEABLE/CLEAN`, 0 required approvals, 0 unresolved review threads, strict required checks all SUCCESS; merged with `gh pr merge 70 --merge` |
| Production deployment and read-only smoke | **PASS** — Vercel `READY/PROMOTED`, alias `jata-aftercall.vercel.app`, deployed commit `a04124de`; new pages, demo actions, auth redirect, PWA files and sitemap verified; see §M |

---

## I. Owner actions genuinely required

1. **Approve merge and deployment separately.** Nothing here is merged or deployed. Required CI
   checks on the PR must pass; branch rules require a PR and status checks (zero configured
   approving reviews, but review-thread resolution is enforced).
2. **Verify production after deployment.** Re-run the six-viewport capture against the deployed
   branch; confirm all four icons, demo links, fictional labels, Share fallback and plan order.
3. **Approve the demo data change** in `docs/LIVE_DEMO_CONTACT_DATA_PROPOSAL_2026-10-27.md` if
   persisted rows should also hold the official demo number. Approve the separate stale-copy
   cleanup if desired.
4. **Provision durable image storage:** R2 bucket + scoped credentials + public media URL and the
   five `R2_*` env vars plus `JATA_STORAGE_PROVIDER` through Vercel's authorised configuration
   interface. Do not paste secrets into chat or Git. Until then uploads fail closed.
5. **Configure transactional email:** `PASSWORD_RESET_SMTP_URL`, `PASSWORD_RESET_FROM` and the
   provider account; then test verification, recovery, payment confirmations, subscription and
   security notifications, including expiry/failure and enumeration behaviour. A Gmail mailbox
   connector is not enough.
6. **Configure the custom domain:** the Vercel project currently lists only
   `jata-aftercall.vercel.app`. `jataaftercall.co.ke` resolves to an external webserver
   (“webserver is functioning normally”); Vercel reports it misconfigured, with nameservers at
   `host-ww.net`, an A record `102.218.215.41`, and recommends `76.76.21.21` or
   `cname.vercel-dns.com.`. Document intended records and a rollback plan before any DNS change.
7. **Publish a verified support channel** (email/phone/ticketing) and a full self-service account
   deletion path; both are honestly disclosed as missing on `/contact` and `/privacy`.
8. **Commission a Kenyan data-protection / legal review** of the privacy and terms disclosures;
   passing a technical checklist does not establish compliance.
9. **Decide on store distribution.** If required, connect Google Play Console and Apple Developer,
   confirm current payment/subscription policies, supply signing material through approved secret
   interfaces, and fund/authorise any account fees. No store action was taken.
10. **For JATA Qi:** provide the real integration contract/embedding decision, hosting/execution
    compatibility and credentials. The current seam has no live transport.
11. **Verify team members and grant access** through `/admin/team-access` only after deployment and
    explicit approval; no production privilege was granted in this session.

---

## J. Release status — each stage independent

| Stage | Status |
| --- | --- |
| Development complete (implemented scope) | **YES** |
| PR ready | **YES — see §K** |
| Approved for merge | **YES** — owner authorized PR #70 merge after gates passed; all mandatory gates passed |
| Merged | **YES** — `gh pr merge 70 --merge`, merge commit `a04124de6eafb4c1564734b1e9298d2f311b7516`, 2026-10-27T18:23:22Z |
| Approved for deployment | **YES** — same owner directive authorized deploying the resulting approved `main` commit via the existing Vercel workflow |
| Deployed | **YES** — Vercel production deployment `dpl_FvH6aCnz4RobFDdogG4HKTJst6wp`, READY/PROMOTED, commit `a04124de`, alias assigned 2026-10-27T18:26:24Z |
| Production verified after this change | **YES (read-only)** — see §M; authenticated write journeys remain **NOT TESTED** |
| Submitted to Google Play | **NO** |
| Published on Google Play | **NO** |
| Submitted to Apple App Store | **NO** |
| Published on Apple App Store | **NO** |

No later stage is marked complete because an earlier stage passed.

---

## K. Commit and PR record

Filled after the push and PR creation; these values are factual, not predicted.

- **Implementation commit SHA:** `a09f913f0bb2e0dddb3ddefe99904145fa3c924e` — contains all source, tests, evidence and the four documents.
- **Follow-up commits:** `d42298a16b974c4ee0a9923f8291c5e5110d30e6` records the PR URL; `f16194c2b08921e0d3c04ab0c53f2a6eaee1bce6` applies the B9 service-worker/automation fix (13/13 CI checks PASS). `440727a054de02f1abbad4020ca320bd94606fcc` is the B10 independent-review remediation (13/14; required journey failed only at B11 flake). `915ed70d00e04ea3c5d274309024441437e58b1a` is the B11 reliability fix and **final PR head** (13/13 CI checks PASS).
- **PR URL:** <https://github.com/POWERBot-1/Jata-Aftercall/pull/70>
- **PR:** #70, base `main`, head `arena/12e0b318-jata-aftercall`, state **MERGED** at 2026-10-27T18:23:22Z.
- **Merge:** `gh pr merge 70 --merge` → merge commit `a04124de6eafb4c1564734b1e9298d2f311b7516`; `origin/main` confirmed at that SHA.
- **Production deployment:** Vercel `dpl_FvH6aCnz4RobFDdogG4HKTJst6wp`, target `production`, state `READY`/`PROMOTED`, deployed commit `a04124de`, alias `jata-aftercall.vercel.app` assigned 2026-10-27T18:26:24Z.
- **Production data, DNS, environment, storage, billing, store:** **NOT CHANGED**. No migration was applied by this release (`prisma migrate deploy` reported “No pending migrations to apply”; `prisma/` is unchanged from `main`).

---

## L. Final independent-review addendum (2026-10-27)

An independent final review of the complete `main...HEAD` diff was performed after PR #70 had reached
14/14 green checks on `f16194c`. It found and fixed the substantiated defects recorded as **B10**
above. No pricing, customer entitlement, original design-system, allowlist, billing, DNS, email,
storage, production data or migration was changed.

Local verification on the remediation tree (exact commands and exit codes in §H):

- Targeted 17-file suite: **PASS**, 288 tests, exit 0.
- Full `npm test`: **FAIL (pre-existing, environment-only)** — 3105 passed / 121 skipped / 1 failed;
  the single failure is the unchanged `Prisma.dmmf` test that cannot run because the sandbox blocks
  Prisma engine downloads. CI with a generated client is the authoritative gate.
- `npm run lint`: **PASS**, 0 errors / 41 warnings, exit 0.
- `npm run typecheck`: **FAIL (pre-existing, environment-only)** — the same four ungenerated-Prisma
  errors, no application or component type errors, exit 2.
- `npm run build`: **FAIL (pre-existing, environment-only)** — webpack `✓ Compiled successfully`,
  then the same four typecheck errors, exit 1. A diagnostic build with `tests/**` temporarily
  excluded from `tsconfig.json` completed successfully earlier; it is not a CI proposal.
- `npm audit --omit=dev`: **PASS**, 0 vulnerabilities, exit 0.
- `git diff --check`: **PASS**, exit 0.
- Client-bundle scan: **PASS** — no real allowlisted number, server audit action value, Node crypto
  import, Prisma audit query or `writeAuditEvent` in `.next/static`; only the intentional empty
  fail-closed stub keys appear in one chunk.
- `npm run test:e2e` / `test:e2e:pos`: **PASS (self-skipped)** without a real database; the CI
  `Journey against a real database` check is the authoritative real-DB result.

**B11 CI-flake investigation (genuine, not dismissed).** The first B10 head `440727a` failed the
required real-DB journey check at step 20 (B11). The failure was reproduced locally with real
Chromium 131 against a local `next dev` server: the first motion run reported `119 passed, 1 failed`
(`no JavaScript desktop` image wait timed out), while an immediate second run reported
`124 passed, 0 failed`. A focused Puppeteer probe showed the SVG returned HTTP 200 and
`naturalWidth = 800`; the fault was Puppeteer's default `requestAnimationFrame` polling inside a
page with JavaScript disabled. The fix changes only that wait to numeric `polling: 100`, preserving
the assertion and 15 s timeout. Post-fix local evidence: three consecutive motion runs all
`124 passed, 0 failed`, and all six step-20 browser scripts passed (motion 124, immersive 22,
layout 7, actionbar 37, families 167, media-local 29). No CI workflow, product code, timeout,
dependency or check was weakened.

**Release rule applied and satisfied:** because the local full-suite/typecheck/build failures are
caused solely by the offline Prisma stub, merge was permitted only after the final remediation head
passed all required CI checks in the generated-Prisma environment. That condition was met on
`915ed70` (13/13 checks PASS). The exact final-head CI conclusion, merge SHA/method/state, Vercel
production deployment identity and read-only production smoke results are recorded in **§M** and
the task completion message. Authenticated production write journeys remain **NOT TESTED**.

---

## M. Final release evidence — merge, deployment and production smoke (2026-10-27)

All timestamps below are UTC (local Pacific time is UTC−7 on this date).

### M.1 Mandatory gates and merge

- Final PR head: `915ed70d00e04ea3c5d274309024441437e58b1a`.
- `gh pr checks 70`: **13/13 PASS** (0 fail, 0 pending). Required strict checks
  `Journey against a real database` (12m14s), `Migration target guard` (11s) and
  `Release gate (aggregate)` (4s) all SUCCESS. Other passing checks: `Static (install, generate,
  lint, typecheck, audit)`, `Real-Chrome six-viewport capture on a disposable database` (5m3s),
  `Production build path on PostgreSQL 18`, `Migrations + schema on PostgreSQL 18`, `Exact
  candidate applies on disposable PostgreSQL 18`, `D2 — build, audit and controls on the candidate
  tree`, `Failure paths actually fail`, `Schema reconciliation proposal closes the drift`, `Vercel`,
  `Vercel Preview Comments`.
- `gh pr view 70`: state OPEN before merge, `mergeable = MERGEABLE`, `mergeStateStatus = CLEAN`,
  `reviewDecision = ""`, `reviews = 0`, 0 unresolved review threads (GraphQL), branch rules
  required 0 approving reviews and required resolved threads. No approval was fabricated.
- Merge command: `gh pr merge 70 --merge` (exit 0). PR state **MERGED**,
  `mergedAt = 2026-10-27T18:23:22Z`, merge commit
  `a04124de6eafb4c1564734b1e9298d2f311b7516`.
- `git ls-remote origin refs/heads/main` and `origin/main` both =
  `a04124de6eafb4c1564734b1e9298d2f311b7516`.

### M.2 Vercel production deployment

- Deployment ID: `dpl_FvH6aCnz4RobFDdogG4HKTJst6wp`.
- URL: `https://jata-aftercall.vercel.app` (alias assigned `true`); deployment hostname
  `jata-aftercall-5w6aer4c5-powerbot-1.vercel.app`.
- Project: `jata-aftercall` (`prj_mXn1031amrZQo4gyaVumKS4FltjW`), team `powerbot-1`.
- State: **READY**, `readySubstate = PROMOTED`, `target = production`, `buildSkipped = false`.
- Deployed commit: `a04124de6eafb4c1564734b1e9298d2f311b7516`, ref `main`, source `git`.
- Created: 2026-10-27T18:23:26Z; ready/alias assigned: 2026-10-27T18:26:24Z
  (`timeToReady = 177417 ms`).
- Build evidence: `prisma generate` succeeded, migration guard
  `OK_ENROLLED_PRODUCTION`, `prisma migrate deploy` reported **“No pending migrations to apply.”**
  and “Migrations deployed successfully”; `next build` `✓ Compiled successfully in 60s` and
  TypeScript passed. `prisma/` is unchanged from `main`, so **no production migration was applied**.
- No environment variable, domain, DNS, email, storage, billing or team-grant change was made.
  `list_project_domains` still shows only `jata-aftercall.vercel.app` (verified); `list_env_vars`
  shows only pre-existing variables.

### M.3 Read-only production smoke (PASS unless labelled BLOCKED/NOT TESTED)

`fetch_page` was used because sandbox `curl`/Chromium egress to the production host is blocked.

| Check | Result |
| --- | --- |
| `/` | **PASS** — homepage loads; plan order/prices unchanged: Monthly KES 149, Annual KES 999, AI Front Desk KES 499, Autopilot KES 2,499, Website Studio KES 999, Business POS KES 499. |
| `/products`, `/pricing`, `/faq`, `/help`, `/contact`, `/install`, `/privacy`, `/terms` | **PASS** — all new pages return correct content; `/terms` and `/privacy` contain the honest “no self-service full account-deletion screen” disclosure. |
| `/products/business-page`, `/products/ai-front-desk`, `/products/website-studio`, `/products/business-pos` | **PASS** — all four product detail pages render with correct prices and entitlement wording. |
| `/login`, `/register`, `/forgot-password` | **PASS** — auth screens render. |
| `/dashboard`, `/admin/team-access` | **PASS** — unauthenticated requests redirect to `/login`. |
| `/api/account/team-access` (GET) | **PASS** — returns `{"error":"Please sign in."}`; unauthenticated access denied. |
| `/robots.txt`, `/sitemap.xml` | **PASS** — sitemap includes all new marketing/legal/support/product pages and the demo pages. |
| `/manifest.json`, `/sw.js`, `/offline.html` | **PASS** — valid manifest, privacy-safe SW (no HTML/API/private caching), honest offline notice. |
| `/b/nyumbani-kitchen`, `/b/marys-beauty-studio`, `/b/kamau-auto-care`, `/b/john-kamau-properties` | **PASS** — all four demos labelled fictional; all four actions present; official demo number `0724317010` / `wa.me/254724317010` / `tel:+254724317010` used (no placeholder `070000000X`). |
| `/dev/contact-actions` | **PASS** — production returns the 404 page (dev-only route not exposed). |
| Binary icons `/icons/*.png`, `/favicon.ico` | **BLOCKED** — `fetch_page` cannot parse binary assets (HTTP 500 from the fetch tool) and `curl`/Chromium egress to production is blocked. Local files exist and are referenced by the production manifest; local PWA evidence verified them. |
| Six-viewport real-browser production screenshots, physical-device PWA install, SW update/offline interaction on production | **NOT TESTED / BLOCKED** — sandbox browser egress to production blocked; CI `Real-Chrome six-viewport capture on a disposable database` passed on the final head, and local PWA evidence passed. |
| Authenticated production write journeys (registration, OTP grant, payment, publishing, uploads, tenant isolation) | **NOT TESTED** — no safe production test account or separate owner approval for production writes. |

### M.4 Remaining owner actions (unchanged from §I)

- Configure and verify a public support channel and transactional email
  (`PASSWORD_RESET_SMTP_URL`, `PASSWORD_RESET_FROM`) before relying on password recovery or the
  contact page for real customers.
- Provision durable object storage if media uploads must persist; current production fails closed.
- Fix custom domain `jataaftercall.co.ke` DNS only after a separate owner decision; do not change
  DNS under this release authorization.
- Obtain Kenyan-law review of the privacy policy and terms; both are honest product disclosures,
  not legal opinions.
- Separately approve any production migration, test account, payment settlement, JATA Qi
  integration or store submission. Store publication remains **NOT STARTED**.

### M.5 Release verdict

**RELEASE TO PRODUCTION: PASS (read-only verified).** PR #70 was independently reviewed,
remediated, fully gated, merged and deployed via the existing Vercel workflow. No production data,
schema migration, DNS, environment, billing, storage or team-grant change was made. The
deployment is healthy and the new public pages, demo contact actions, PWA files and security
guards are serving correctly. Authenticated write journeys and physical-device PWA installation
remain outside the evidence obtained here.
