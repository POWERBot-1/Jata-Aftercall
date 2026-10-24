# JATA AFTERCALL — Motion-led homepage and demo showcase

**Branch:** `arena/e5c4c14b-jata-aftercall`
**Baseline:** `cce008dfc468c17e5091162941531a58575ca5c6` (= `origin/main` at the time of work)
**Date:** 2026-10-24
**Status:** Pre-delivery verification checkpoint for the follow-up corrections. At this checkpoint, PR #55 was open and unmerged at head `f61e27278a75bf2297640017d4bc19d5bad57da3`, and the corrections below were local and uncommitted. See PR #55 for the delivery head and current CI. **Not deployed or merged; auto-merge was not used.**

---

## 1. Preflight

### Baseline verification

```
$ git rev-parse HEAD origin/main
cce008dfc468c17e5091162941531a58575ca5c6
cce008dfc468c17e5091162941531a58575ca5c6
```

The working branch was created from exactly the requested commit and `origin/main` had not moved.
No critical assets or dependencies were missing, so the work was **not** blocked.

### What already existed (inspected before changing anything)

| Area | Finding |
| --- | --- |
| Homepage | `app/page.tsx` — server-rendered, 233 lines, plain Tailwind blocks, no imagery, no motion. Plans read from the database and filtered by `publiclyListedPlans()`; the private POS has one separate entry fed by a server constant. |
| Navigation | `components/Navbar.tsx` — brand + auth links only; no in-page sections, nothing on a phone but two buttons. |
| Design system | `app/globals.css` (2,282 lines): `--jata-*` tokens, `.jata-btn`/`.jata-card`/`.jata-nav`, product themes (`lime-spark`, `emerald-ink`) re-pointing the legacy palette, storefront `--eb-*` tokens. Several existing reduced-motion blocks. |
| Motion tooling | `motion` v14 (`motion/react`) is installed and used by `components/ui/Reveal.tsx` and the storefront; the storefront's motion is CSS + a small scoped controller. No animation library was needed for the landing page. |
| Demo routes | `/b/[slug]` renders `ExperienceSite` when a published experience exists, otherwise the classic `components/BusinessPage.tsx`. Four demo slugs are documented in `lib/demoData.ts` and seeded from `prisma/seed.ts`. |
| Demo content | Nyumbani Kitchen (3 services, offer), Mary's Beauty Studio (3), Kamau Auto Care (3), John Kamau Properties (3). Prices are demo data, not customer data. |
| Business assets | **None.** The repository had no photography of the demo businesses (only `public/og.jpg` and a dev SVG). Demo pages are entirely typographic. |
| Tests pinning the old page | `tests/unit/homepage-plan-cards.test.ts`, `tests/unit/homepage-business-pos.test.ts`, `tests/unit/dashboard-ux.test.ts`, `tests/unit/pos-entitlement.test.ts`, `tests/unit/demo-data-restore.test.ts`, `tests/unit/business-page-contrast.test.ts`, `tests/unit/booking-time-display.test.ts`. |

Because there were no business-specific assets, the imagery in this change is **generated
illustrative photography**, labelled as illustrative in alt text, in a visible caption on every
card, and in the footer. No customer photographs, logos or listings were fabricated.

### Pre-existing sandbox limitations (not caused by this change)

* `prisma generate` cannot download its engine here (only npm/github/pypi hosts are reachable), so
  the build uses the repository's documented offline Prisma stub in `lib/db.ts`. The stub returns
  empty results, which is exactly the "database unavailable" path the homepage already handled.
* The offline Prisma stub lacks `Prisma.BusinessUncheckedCreateInput`; a **local-only** one-line alias
  remains in `node_modules/.prisma/client/default.d.ts` so TypeScript/build checks can run. This file
  is outside Git and is not part of the patch. `npm run build` still reports that the Prisma engine
  download is offline, then uses the documented fallback.
* `DATABASE_URL` and `DIRECT_URL` were unset during this gate. The build skipped its migration gate;
  no database, seed, restore, migration or production write was run. PostgreSQL-backed integration
  tests were skipped in this verification; see the current aggregate count in §6.

---

## 2. Proposed implementation (as executed)

1. A single content module (`lib/landing.ts`) holding every marketing string, plan note, FAQ entry
   and demo-card builder — so accuracy is testable without rendering React.
2. Server-rendered section components under `components/landing/`; **one** client component (the demo
   tab switcher). Everything else — hero drift, marquee, phone float, reveals — is CSS.
3. A demo-band module (`lib/demoShowcase.ts`) scoped to the four documented slugs, rendered by a
   server component (`components/storefront/DemoShowcaseBand.tsx`) at the top of `/b/<demo-slug>`.
4. A scoped CSS block appended to `app/globals.css` (`.lp-*`, `.jata-showcase*`) with its own palette
   so a saved product theme cannot make the page unreadable.
5. New tests for content accuracy, the band's scope boundary, motion/reduced-motion and the
   development harness, plus a browser check script for overflow, media, keyboard and reduced motion.

---

## 3. What changed

### Modified

| File | Change |
| --- | --- |
| `app/page.tsx` | Rewritten as a section stack: hero → story → benefits → demo showcase → pricing → how it works → FAQ → final CTA → separate public POS entry → footer. The four plan names/order and existing plan prices remain pinned; outcome-style hero copy was replaced with descriptive copy. Demo-card links now render only for eligible published, `ACTIVE` businesses with at least one active service. The POS entry remains outside the plan cards and links to `/dashboard/pos`. |
| `components/Navbar.tsx` | Adds in-page sections (Product, Benefits, Demos, Pricing, FAQ) and a native `<details>` menu for phones. No `useState`/`useEffect`/`onClick` — navigation works before hydration, with scripts blocked, and if animation fails. Auth state unchanged (Dashboard/Admin/Logout, or Log in/Get started). |
| `app/b/[slug]/page.tsx` | Builds demo-band data only for documented demo slugs and eligible businesses; applies active-service and active/unexpired-offer filters on the classic route. Experience-driven storefronts still return before the demo band; their public loader now hides inactive/expired offers independently. |
| `app/globals.css` | `+1,109` lines appended in one clearly delimited block. No existing selector was edited. |
| `package.json` | Two scripts: `test:landing` and `test:browser:landing`. No dependency added, removed or upgraded. |
| Follow-up corrections (`lib/demoContent.ts`, `lib/demoData.ts`, `lib/landing.ts`, `lib/demoShowcase.ts`, `lib/experience/storefront.ts`, `app/dev/demo-showcase/page.tsx`, `components/BusinessPage.tsx`, landing/storefront copy, metadata and analytics) | Mark synthetic listings/prices and imagery as fictional/illustrative; remove unsupported outcome/property/weekend claims; filter active services and active/unexpired offers on classic and Website Studio routes; gate demo destinations; use accepted analytics event names and accurate counters. |
| Tests, seed and local evidence (`prisma/seed.ts`, `scripts/browser/landing-showcase.check.mjs`, targeted unit/security tests, `docs/evidence/landing-2026-10-24/README.md`) | Update seeded demo disclosures and assertions; collect browser `pageerror`s; verify eligible-route/no-link behavior; label the earlier screenshot run as local historical evidence and record current check counts separately. |

### Added

| File | Purpose |
| --- | --- |
| `lib/landing.ts` | Copy, plan notes, FAQ, demo-card builder, demo order; updated to remove unsupported outcomes and property/weekend viewing claims and to gate demo destinations. |
| `lib/demoContent.ts` | Shared rules for clearly fictional demo labels and active-service / active-and-unexpired-offer filtering. |
| `lib/demoShowcase.ts` | Band configuration for the four demo slugs + a pure `buildDemoShowcase()` gate. |
| `components/landing/Hero.tsx` | Hero with CSS-only motion and a markup phone (no screenshot). |
| `components/landing/Sections.tsx` | Story acts, marquee, benefits grid. |
| `components/landing/DemoShowcase.tsx` | The only client component: WAI-ARIA tabs, roving focus, lazy panels. |
| `components/landing/FaqAndFooter.tsx` | `<details>` FAQ (no JS) and the footer sitemap. |
| `components/landing/Icons.tsx` | Inline SVG icon set (no icon dependency, no image request). |
| `components/storefront/DemoShowcaseBand.tsx` | The server-rendered cinematic band on the demo pages. |
| `app/dev/demo-showcase/page.tsx` | **Development-only** harness that renders the real band + real `BusinessPage` against `lib/demoData.ts`, so the demo pages can be reviewed without a database. Returns 404 in production. |
| `public/landing/*` | Eight generated illustrative photographs (webp + jpg, plus 720 px variants), largest 215 KB. |
| `scripts/browser/landing-showcase.check.mjs` | Browser acceptance check (overflow, media, keyboard, reduced motion, menu). |
| `tests/unit/landing-content.test.ts` | Claim/pricing accuracy, demo-card data, asset existence and weight. |
| `tests/unit/landing-motion.test.ts` | Palette contrast (AA), CSS-only motion, reduced motion, lazy media, dev-harness isolation. |
| `tests/unit/demo-showcase-band.test.ts` | Band scope: demo slugs only, public only, non-empty only; never on a customer page. |
| `docs/evidence/landing-2026-10-24/` | Before/after and per-viewport screenshots + reproduction notes. |

No authentication/session logic, checkout or payment-provider flow, settlement logic, schema/migration, secret, provider configuration or POS authorization/entitlement code was changed. Seed/restore edits are limited to demo fixtures and owner/payment overwrite guards, and neither script was run.

---

## 4. Design and motion decisions

* **Imagery instead of video.** The brief asks for "optimized video or animation assets". Real people
  and vehicle motion are delivered as slow CSS camera moves over real photographs (`drive` pans the
  Kamau car, `steam` drifts warm light across the Nyumbani plate, `salon` pans the stylist, `tour`
  crossfades the property exterior into the interior). A video would have added megabytes the
  connection cannot afford and an autoplay surface that cannot be paused; the CSS version ships
  **0 bytes** of extra media beyond stills already needed.
* **No 3D.** The existing `three`-based immersive viewer is opt-in and gated by device/network
  policy; this landing implementation does not use WebGL. No bundle-size claim is made for the
  follow-up corrections because a separate bundle measurement was not run in this gate.
* **One client component.** Plan tabs use real `<button role="tab">` elements with `aria-selected`,
  `aria-controls`, roving `tabIndex`, Arrow/Home/End keys, and panels hidden with `hidden` — no
  third-party tab library.
* **Reduced motion.** Every animation in the new block is inside the media query that sets
  `animation: none !important`, and the hero copy has an explicit "visible final state" rule so
  nothing depends on an animation having run. Verified in Chromium with the media feature emulated.
* **No layout shift.** Demo panels keep a fixed 16:10 media box, images carry real
  `width`/`height`, and switching tabs does not move anything above the showcase (measured:
  section offset 2432 px → 2432 px (local production build)).
* **Mobile first.** 320, 360, 414, 768, 1024 and 1440 px are checked for horizontal overflow;
  the phone navigation collapses the wordmark and menu label at very narrow widths so the sticky
  bar fits 320 px without clipping.

---

## 5. Accuracy and privacy

* **No unsupported outcome claims.** Removed claims implying guaranteed analytics coverage or business outcomes, along with unsupported property-viewing/weekend-viewing copy. No testimonials, ratings, review counts, customer numbers, revenue figures, "trusted by" copy, "best/leading" adjectives or income promises remain. Tests check the marketing copy and analytics wording.
* **Fictional demo data is explicit.** Demo business names, contacts, locations, service titles, offers and sample prices are synthetic examples, not current listings, quotes, promotions or availability. Landing cards and demo pages say so; generated imagery is separately labelled illustrative. Production plan prices still come from `PlanConfig` (or `FALLBACK_PLANS` when the database is unavailable).
* **Active content only.** Demo services require `isActive === true`; offers require `isActive === true`, a non-empty title and a null or future `validUntil`. The persisted Offer schema has no `validFrom`; no nonexistent field is assumed. Property examples do not show offers.
* **Illustrative imagery is disclosed.** Alt text identifies the photograph as illustrative and not the business's own; cards and the demo band show visible disclosure; the footer repeats it.
* **POS remains a separate public landing entry, not a plan.** A dedicated Business POS section links to `/dashboard/pos`; POS is not one of the four plan cards and is not included in `PLAN_INCLUDES`. The destination remains authenticated and owner-only, redirects anonymous visitors to `/login`, and lists businesses strictly from `getOwnedBusinessIds(session)`. The FAQ says POS is separate and owner-only.
* **Demo routes are gated.** Landing cards link only when the destination is an eligible published `ACTIVE` demo business with at least one active service. The demo band requires a documented demo slug, a public page decision and active service rows. A customer's page test confirms the band does not render there.
* **No new transaction path.** Demo actions use in-page anchors or existing WhatsApp/Call/Directions actions. No checkout/cart/payment path was added; the band states no payment is taken.

---

## 6. Verification — local pre-delivery worktree (not deployed)

The commands below were re-run against the follow-up source worktree before its delivery commit;
results are local checks, not PR/Actions results. `DATABASE_URL` and `DIRECT_URL` were unset, so the
build used the documented offline Prisma fallback and did not run a migration gate. No database or
production operation was performed. Browser results below are local checks, not production evidence;
no screenshots were generated in these runs (`SHOT_DIR` unset).

### Tests, lint, types and build

| Command | Exit | Verified result |
| --- | ---: | --- |
| `npm test` | **0** | 200 test files passed, 14 skipped; 2,517 tests passed, 118 skipped (2,635 total). PostgreSQL/E2E-gated tests are among the skips; expected stderr from simulated DB/provider failure paths did not fail the suite. |
| `npm run test:landing` | **0** | 3 files, 50/50 tests passed. |
| `npx vitest run tests/unit/demo-data-restore.test.ts tests/unit/homepage-plan-cards.test.ts tests/unit/homepage-business-pos.test.ts tests/unit/pos-entitlement.test.ts tests/security/pos-page-authorization.test.ts tests/security/referral-security.test.ts tests/unit/business-page-ai-link.test.ts tests/unit/storefront-preview-metadata.test.ts tests/unit/storefront-public-content.test.ts` | **0** | 9 files, 125/125 tests passed. Covers fictional identity/restore boundaries, active/inactive services and offers, expiry, fallback/link eligibility, four public plan prices/order, and the authenticated owner-only POS boundary. |
| `npm run typecheck` (`tsc --noEmit`) | **0** | Clean. |
| `npm run lint` | **0** | 0 errors; 36 warnings remain in the repository lint output. The changed app/component/lib, seed, browser and test files also passed the targeted ESLint command below with no diagnostics. |
| Targeted ESLint + `node --check scripts/browser/landing-showcase.check.mjs` | **0** | All modified app/component/lib, seed, restore/browser script and unit/security test files passed with no diagnostics. |
| `git diff --check` | **0** | No whitespace errors. |
| `npm run build` | **0** | Webpack production build compiled, type-checked and emitted 44 routes. Prisma engine download failed offline; the documented fallback ran. `DATABASE_URL` was unset, so migrations were skipped. |

Exact targeted lint/syntax command (exit **0**):

```sh
npx eslint --no-warn-ignored app/admin/page.tsx 'app/b/[slug]/page.tsx' app/dev/demo-showcase/page.tsx app/layout.tsx app/page.tsx components/BusinessPage.tsx components/landing/DemoShowcase.tsx components/landing/FaqAndFooter.tsx components/landing/Hero.tsx components/landing/Sections.tsx components/storefront/DemoShowcaseBand.tsx lib/demoContent.ts lib/demoData.ts lib/demoShowcase.ts lib/experience/contentAssist.ts lib/experience/storefront.ts lib/landing.ts prisma/seed.ts scripts/restore-demo-businesses.ts scripts/browser/landing-showcase.check.mjs tests/security/referral-security.test.ts tests/unit/demo-data-restore.test.ts tests/unit/demo-showcase-band.test.ts tests/unit/homepage-business-pos.test.ts tests/unit/landing-content.test.ts tests/unit/storefront-public-content.test.ts && node --check scripts/browser/landing-showcase.check.mjs
```

The full Vitest suite **did pass** as shown above. PostgreSQL-backed and E2E-gated cases are among the 118 skipped tests. This environment had no database configuration, so no live database result is claimed.

### Browser checks and startup evidence

| Command / run | Exit | Result |
| --- | ---: | --- |
| `LD_LIBRARY_PATH=/tmp/chromium-libs/lib CHROME_PATH=/tmp/chromium BASE_URL=http://127.0.0.1:3141 ONLY=home npm run test:browser:landing` | **0** | 58/58 checks passed against the local production build: 320–1440 px overflow, decoded/labelled images, one H1/main, links only for destinations marked available, tab interaction, navigation, reduced motion and zero page errors. |
| `LD_LIBRARY_PATH=/tmp/chromium-libs/lib CHROME_PATH=/tmp/chromium BASE_URL=http://127.0.0.1:3000 ONLY=demos npm run test:browser:landing` | **0** | 32/32 checks passed against the development-only showcase harness: all four fictional pages, mobile/desktop layout, anchors, illustrative-image labels and zero page errors. |
| Three repetitions of `LD_LIBRARY_PATH=/tmp/chromium-libs/lib CHROME_PATH=/tmp/chromium npm run test:browser:hydration-race` | **0 each** | Diagnostic only. Each run reproduced the expected synthetic #418/#423 negative arms with no uncaught errors; the synthetic control did not. Across 24 widened live `/login` attempts there were 0 #418/other errors; across 9 controls there were 0. This is not a real-database Journey pass. |

Before the production browser run, `npm run start -- -p 3141` logged `✓ Ready`, and a readiness
request to `/` returned HTTP 200. Before the demo run, the existing dev server on port 3000 returned
HTTP 200 for `/dev/demo-showcase?slug=nyumbani-kitchen`. The production server started for the
check was stopped afterwards. The offline database meant all four homepage demo cards were fallback
cards: the browser confirmed none linked to an unavailable `/b/<slug>` route. The direct browser
navigation to an eligible database-backed demo route was therefore **not exercised**; unit tests
cover the eligible-link branch.

A separate attempt to start a second dev server with `npm run dev -- -p 3142` exited **1** after
Next.js reported another dev server already running in this worktree (PID 7778 on port 3000). The
readiness request to 3142 exited **7** because that process had stopped. This was a duplicate-server
lock issue, not an application/browser failure; the existing port-3000 server was confirmed ready
before the demo browser suite ran.

### Initial failures corrected during this verification

The first `npm run test:landing` and focused `npx vitest run ...` invocation exited **1**, and the
first `npx tsc --noEmit` exited **2**, because of a missing comma in `lib/landing.ts`; the first
focused Vitest run also exposed a fixture referencing a nonexistent `h.tables.user`. The first
`npm run lint` exited **1** on that same parse error. Those local issues were fixed; all final reruns
above passed. These initial exits are not the current outcomes.

## 7. GitHub Actions on the exact PR head

Read-only inspection on **2026-10-24**: PR #55 is OPEN, head
`f61e27278a75bf2297640017d4bc19d5bad57da3`, base `main` at
`cce008dfc468c17e5091162941531a58575ca5c6`. At the pre-delivery checkpoint, these corrections
were not yet committed, so none of the checks below ran against the follow-up worktree.

| PR check on `f61e272…` | Classification | Evidence |
| --- | --- | --- |
| Exact candidate applies on disposable PostgreSQL 18 | **BLOCKED** (GitHub conclusion: failure) | Run `40043414368`, step 9. Check-run annotations say `RESULT: BLOCKED`, `BLOCKED the candidate adds migrations — no difference from the baseline — nothing to rehearse`, process exit 2. This is not evidence of a migration failure; no candidate migration diff applied to this PR. |
| Journey against a real database | **BLOCKED** (GitHub conclusion: failure) | Run `40043414437`, step 18, “Hydration 418 controlled race reproduction”. Database setup/migrations, native suites, §66 journey, POS journey, production build, authenticated HTTP/browser journey and booking SSR hydration step passed. Step 18 emitted `BLOCKED / NOT RUN: Navigation timeout of 30000 ms exceeded` and exited 2; later replay-cursor and storefront browser steps were skipped (**NOT TESTED**). Cross-tenant negative probes had `markerSeen:false` and positive controls `markerSeen:true`; they are not the failure. The bot comment attributes the run to `8aa45572cd80648f91a573a488e7c66cf2395894`, while Actions metadata says the run head was `f61e272…`; attribution mismatch retained. |
| D2 — build, audit and controls on the candidate tree | **PASS** | Run `40043414368`. |
| Failure paths actually fail | **PASS** | Run `40043414385`. |
| Migration target guard | **PASS** | Run `40043414437`. |
| Migrations + schema on PostgreSQL 18 | **PASS** | Run `40043414385`. |
| Production build path on PostgreSQL 18 | **PASS** | Run `40043414385`. |
| Release gate (aggregate) | **PASS** | Run `40043414385`. |
| Schema reconciliation proposal closes the drift | **PASS** | Run `40043414385`. |
| Static (install, generate, lint, typecheck, audit) | **PASS** | Run `40043414385`. |
| Vercel | **PASS** (check only) | PR check is green; the Vercel bot comment says deployment was skipped. No deployment is claimed. |
| Vercel Preview Comments | **PASS** | PR check is green. |

`gh pr checks 55` exited **1** because the two check runs above have GitHub failure
conclusions; it is not a passing gate. Candidate/Journey signed-log retrieval and the Journey
raw-order artifact download returned `EOF`; the classifications above use the check annotations and
bot diagnostic, not an unavailable archive. No workflow was manually rerun on this head.

### Hydration timeout triage (original PR head `f61e272…`)

Actions identifies the failing step as `npm run test:browser:hydration-race`; it is a controlled
diagnostic, not the preceding database-backed §66 or POS journey. The bot's only failure detail is
the generic 30-second navigation timeout. In `scripts/browser/hydration-race.check.mjs`, the
synthetic fixture's `page.setContent(..., { waitUntil: "networkidle0" })` is uncaught, whereas
actual production `/login` `page.goto` timeouts are caught and recorded in the diagnostic summary.
That makes the synthetic fixture's network-idle wait the likely timeout source, but the unavailable
stack trace means the exact call site is **not confirmed** and this does not establish an application
hydration defect.

To seek reproduction without rerunning Actions, the same local command was run three times against
the production build: all three exited **0**. Each reported 0 #418/other errors in its eight widened
`/login` attempts and 0 in its three controls; the synthetic arms reproduced expected #418/#423 with
no uncaught errors. The CI timeout was therefore not reproduced locally and remains a GitHub blocker,
not a pass. A normal push to the updated PR head will provide the next exact-head run; no manual
workflow rerun was requested.

## 8. Remaining limitations and risks

1. **No live/seeded database verification.** `DATABASE_URL` and `DIRECT_URL` were unset. The local
   homepage therefore used fallback cards, and the public `/b/<slug>` database-backed eligible
   destination was not navigated in a browser. Unit tests cover the conditional eligible-link path,
   demo identity, and the no-overwrite/owner/payment boundaries. Any database integration check must
   use an explicitly isolated non-production database; no production DB operation is authorized.
2. **Database-backed coverage remains unverified locally.** `npm test` passed 2,517 tests and
   reported 118 skips across the suite; PostgreSQL/E2E-gated coverage was not exercised because no
   database was configured. The 50 landing tests and 125 focused regression/security tests also
   passed as separate commands.
3. **CI evidence here is for the pre-delivery head only.** Candidate rehearsal is inapplicable
   without a migration diff (the required check is still red, not green); the real-database Journey
   job's hydration diagnostic was blocked by the timeout described in §7. Check PR #55 for normal
   Actions runs on the later delivery head; no manual workflow rerun was requested.
4. **Illustrative assets only.** Images are generated illustrations, not authorized photographs of
   the fictional demo businesses or actual property listings. Existing screenshots in
   `docs/evidence/landing-2026-10-24/` are local design evidence only, not production evidence; no
   screenshots were generated by the verification runs in §6.
5. **Payment/subscription E2E was not exercised.** No Paystack key, payment operation or database
   was used. The local POS regression/security suites passed, but no live payment path was tested.
6. **Hydration diagnostic scope.** The local `test:browser:hydration-race` run is a controlled
   production-build diagnostic with a synthetic mechanism arm; it does not replace the blocked
   real-database Journey and does not establish production behavior.
7. **No 3G/physical-device run.** Browser coverage used headless Chromium at the six listed viewport
   widths; it did not emulate a constrained network or physical handset.
8. **Development harness.** `/dev/demo-showcase` is explicitly guarded by `NODE_ENV === "production"`
   and declares `robots: index:false`; the current build lists the route, but this gate did not run a
   production HTTP check against that path.

## 9. Pre-delivery branch checkpoint, diff review and authorization boundary

The following state records the worktree immediately before delivery; it is historical, not the
post-push status:

* **Branch:** `arena/e5c4c14b-jata-aftercall`.
* **Local HEAD and remote branch head:** `f61e27278a75bf2297640017d4bc19d5bad57da3` (remote
  confirmed with `git ls-remote`).
* **PR #55:** OPEN, unmerged, head `f61e27278a75bf2297640017d4bc19d5bad57da3`, base `main` at
  `cce008dfc468c17e5091162941531a58575ca5c6`.
* The reviewed follow-up diff contained **26 modified tracked files and 2 untracked files**; nothing
  was staged, committed or pushed at that checkpoint. The delivery commit and current remote state
  are reported separately against PR #55.

Files in the pre-delivery worktree diff:

```text
LANDING_SHOWCASE_IMPLEMENTATION_2026-10-24.md
app/admin/page.tsx
app/b/[slug]/page.tsx
app/dev/demo-showcase/page.tsx
app/layout.tsx
app/page.tsx
components/BusinessPage.tsx
components/landing/DemoShowcase.tsx
components/landing/FaqAndFooter.tsx
components/landing/Hero.tsx
components/landing/Sections.tsx
components/storefront/DemoShowcaseBand.tsx
docs/evidence/landing-2026-10-24/README.md
lib/demoData.ts
lib/demoShowcase.ts
lib/experience/contentAssist.ts
lib/experience/storefront.ts
lib/landing.ts
prisma/seed.ts
scripts/browser/landing-showcase.check.mjs
scripts/restore-demo-businesses.ts
tests/security/referral-security.test.ts
tests/unit/demo-data-restore.test.ts
tests/unit/demo-showcase-band.test.ts
tests/unit/homepage-business-pos.test.ts
tests/unit/landing-content.test.ts
lib/demoContent.ts                         (untracked)
tests/unit/storefront-public-content.test.ts (untracked)
```

The final diff was reviewed. It changes public copy/demo identity and visibility, contact-action
analytics event names, and seed/restore demo fixtures and safety checks. It does **not** change
authentication/session logic, checkout/payment-provider or settlement logic, POS authorization or
entitlement logic, Prisma schema/migrations, secrets, dependencies, or provider configuration.
`prisma/seed.ts` was edited for fictional demo fixtures and the demo-owner/non-demo-payment
overwrite guard; the seed was not run. No production data, migration, payment, deployment, merge or
unrelated workflow operation occurred. The Business POS remains a separate landing entry, outside
all four plan cards, and its workspace remains authenticated and owner-only.

### Landing plan order (unchanged; current focused tests passed)

1. Monthly — KES 149/month
2. Annual — KES 999/year
3. AI Business Front Desk — KES 499/month
4. Website Studio — KES 999/month

Business POS remains outside the four cards, owner-only, and priced from the server constant.
