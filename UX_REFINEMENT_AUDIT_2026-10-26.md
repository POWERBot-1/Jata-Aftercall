# JATA AFTERCALL — Premium UX / UI / Product-Experience Refinement

**Date:** 2026-10-26
**Branch:** `arena/b8a138ba-jata-aftercall`
**Base:** `main` @ `540180602142f0923be85a50902d33b616d29ab0`
**Scope:** whole-application audit + a focused, test-locked refinement pass (terminology, design-token/dark-theme correctness, journey recovery screens, brand consistency).

---

## 1. How the audit was run

The real implementation was inspected, not screenshots: the App Router route tree (`app/`), the shared
primitives (`components/ui`, `components/workspace`), the generated-product layer (`components/storefront`,
`lib/experience`), the workspace feature flows (AI Front Desk, Website Studio, POS, Autopilot, subscription),
the global stylesheet (`app/globals.css`, ~5.2k lines) and the existing enforcement tests
(`tests/unit/design-system.test.ts`, `dashboard-ux.test.ts`, the homepage/landing content tests).

The codebase already carries a mature, **test-locked** design system — platform tokens (`--jata-*`), workspace
tokens (`--ws-*`, with a light default and a graphite `lime-spark` theme), generated-product tokens (`--eb-*`),
shared `Button/Card/Field/StatusPill/StateBlocks/ErrorState` primitives, DB-driven pricing with fallbacks,
Paystack verification gates, tenant isolation, and next-step guidance (`lib/nextAction.ts`). The refinement
therefore concentrates on **residual inconsistencies and dead-ends** rather than a ground-up redesign, and every
change preserves the locked contracts (plan keys, entitlement/payment gates, tenant boundaries, test assertions).

### Environment limitation (affects two checks only)

This sandbox has no outbound access to `binaries.prisma.sh`, so `prisma generate` cannot download its native
query engine and the generated client is a reduced stub. Consequences, both **pre-existing and independent of
this change set**:

* `tsc --noEmit` reports 4 errors, all inside **test** files that read Prisma engine internals
  (`Prisma.dmmf`, `PrismaClientKnownRequestError`, `BusinessUncheckedCreateInput`). Application/component/library
  code reports **zero** type errors.
* One unit test (`autopilot-phase1-hardening` Priority 1, which reads `Prisma.dmmf`) fails for the same reason.

A production build was nevertheless verified end-to-end (see §5): webpack **compiles successfully**, and with the
three engine-dependent test files set aside the full `next build` (compile + type-check + lint + page generation)
**completes with exit 0**. In CI/production the engine is present, `prisma generate` succeeds, and those four
errors do not occur.

---

## 2. Prioritised remediation register

Severity uses the brief's scale (Critical / High / Medium / Low). Every "Result" is from a command actually run.

| # | Issue (route / component) | Severity | Fix (files & behaviour) | Verification (commands actually run) | Result | Remaining risk |
|---|---|---|---|---|---|---|
| 1 | Split product naming: homepage/nav say **"Website Studio"** but owner-facing messages still said legacy **"Interactive Business"** — entitlement reasons, publish prompts, status help, next actions, AI quota label, checkout error, plan blurbs. Confusing terminology across the same journey. | High | Added one canonical source `lib/productNames.ts` (`WEBSITE_STUDIO_NAME`). Re-pointed **display copy only** to it in `lib/experience/entitlement.ts`, `lib/statusLabels.ts`, `lib/nextAction.ts`, `lib/ai/quota.ts`, `lib/studio/copilot.ts`, `lib/experience/validate.ts`, `app/api/checkout/route.ts`, `components/dashboard/{EntitlementBanner,PublishPanel,WebsiteHealth}.tsx`, `app/page.tsx`, `app/dashboard/subscription/page.tsx`. The stored plan **key `INTERACTIVE_BUSINESS` and all billing logic are untouched**. | `npx vitest run tests/unit/website-studio-naming.test.ts` (new, 14 tests); full unit suite; `experience-publish`, `dashboard-ux`, `status-labels`, homepage plan-card tests | **PASS** | None — key/logic unchanged; integration mocks use the key, not the label. |
| 2 | Hard-coded light-red notice palette `#fef2f2`/`#991b1b` copied into **three** AI Front Desk notices and hard-coded `#1a140d` stepper ink. These values do not re-point in the graphite theme → unreadable light box / wrong contrast on dark surfaces. | High | Introduced workspace semantic tokens `--ws-danger`, `--ws-danger-soft`, `--ws-danger-line`, `--ws-jade-line`, `--ws-on-amber` in **both** the default and `lime-spark` blocks of `app/globals.css`. Added a reusable, themed `WorkspaceNotice` (`components/workspace/WorkspaceUI.tsx`) and replaced all three inline notices + the stepper colour in `components/ai/AIFrontDeskWorkspace.tsx`. | `npx vitest run tests/unit/workspace-status-tokens.test.ts` (new, 9 tests); `ai-front-desk-journey` (31), `ai-front-desk-accessibility` (23) | **PASS** | None — role mapping (`error→alert`, else `status`) preserved and re-tested. |
| 3 | No root `app/not-found.tsx` and no `app/global-error.tsx`: unknown URLs fell through to the unstyled Next.js default 404 (a dead end), and a root-layout crash could blank the tab. Only the dashboard had an error boundary. | High | Added branded `app/not-found.tsx` (one h1, main landmark, skip link, real Home / Sign in / Pricing recovery actions, token-based, works without JS) and a self-contained `app/global-error.tsx` (own html/body, inline brand styling, **Try again** reset + **Go to home**, shows a digest but never the raw error). Re-built the business `app/b/[slug]/not-found.tsx` on shared tokens. | `npx vitest run tests/unit/recovery-screens.test.ts` (new, 5 tests); production `next build` | **PASS** | global-error styling is intentionally inline (it may render after the layout fails); brand palette kept in sync manually. |
| 4 | `EntitlementBanner` used fixed Tailwind palette (`border-emerald-200 bg-emerald-50 text-emerald-900`, amber/zinc) that does not adapt to the graphite theme. | Medium | Rewrote on `--ws-jade*` / `--ws-amber*` / `--ws-paper` / `--ws-line` tokens; adopted the Website Studio name; retained every state, CTA and the "content is untouched" reassurance. | `workspace-status-tokens.test.ts`; full unit suite; `next build` | **PASS** | None. |
| 5 | Publish/health message text used fixed `text-emerald-700`/`text-amber-700/800` classes — low-contrast on graphite. | Medium | Re-pointed success→`var(--ws-jade)`, warning→`var(--ws-amber-deep)` in `PublishPanel.tsx` and `WebsiteHealth.tsx` (error already used the token-based `jata-error`). The numeric health **score bar** keeps its categorical colour scale (colour + number, never colour-only). | `workspace-status-tokens.test.ts` (source guard); ESLint | **PASS** | None. |
| 6 | Hard-coded danger colours in shared workspace CSS: `.ws-shell .jata-btn-danger` (`#fef2f2/#991b1b/#b91c1c`) and `.ws-status[data-tone="danger"]` (`#dc2626`) — not theme-aware. | Medium | Moved both onto the new `--ws-danger*` tokens so they re-point for graphite. | `workspace-status-tokens.test.ts`; `next build` | **PASS** | None. |
| 7 | Metadata title casing inconsistency: two routes titled "Website studio" vs the brand "Website Studio". | Low | Set title `"Website Studio"` on `app/dashboard/studio/page.tsx` and `app/dashboard/businesses/[id]/page.tsx`. | `dashboard-ux` unique-title test; `next build` | **PASS** | None. |
| 8 | Stale top-of-file `eslint-disable @next/next/no-img-element` in `WorkspaceUI.tsx` (rule never fires there) reported as an unused directive. | Low | Removed the dead directive; `<img>` usage is retained and documented. | `npx eslint components/workspace/WorkspaceUI.tsx` (0 problems) | **PASS** | None. |

### Confirmed compliant during the audit (no change needed)

* **Homepage feature order & pricing** — `HOMEPAGE_PLAN_ORDER` is `MONTHLY (KES 149) → ANNUAL (KES 999/yr) → AI_BUSINESS_FRONT_DESK (KES 499) → INTERACTIVE_BUSINESS/Website Studio (KES 999/mo) → BUSINESS_POS (owner-only) → JATA_AUTOPILOT (owner-only, last)`, matching the brief's required 1–5 order. Prices/durations are DB-derived with canonical fallbacks; no invented prices. Locked by `homepage-plan-cards/homepage-business-pos/homepage-autopilot` tests.
* **Payment honesty** — no simulated success; Paystack verification, webhook signature/idempotency and entitlement gates intact (security suite green).
* **Design-system discipline** — `components/ui/*` remain free of hard-coded hex and raw zinc/white/black (`design-system.test.ts`). Remaining hex elsewhere is legitimate: categorical chart colours, owner colour-picker inputs, and the always-dark storefront preview banner.
* **Accessibility foundations** — skip links, one h1 per screen, visible focus, 44px touch targets, `prefers-reduced-motion`, labelled controls and status `role` wiring are present and test-covered.
* **States** — shared loading skeleton, empty states, offline badge and error boundary already exist; dashboard shell enforces a single nav, one `<main id="main">` and one toast surface.

---

## 3. Mobile, accessibility and performance considerations

* All new/rebuilt screens use the existing responsive token layout and `min-h-11` (44px) touch targets; the 404
  actions stack on a narrow viewport and sit inline on `sm+`.
* `WorkspaceNotice` keeps the screen-reader contract (`role="alert"` for an error, `role="status"` otherwise) that
  the prior inline block provided — asserted in both the new token test and the updated AI Front Desk tests.
* No new dependencies, no new network services, no animation added; the change set is CSS tokens + shared
  components + copy, so bundle/runtime cost is effectively neutral. Images were already lazy-loaded with
  width/height to avoid layout shift.

---

## 4. Files changed

**New (6):** `lib/productNames.ts`, `app/not-found.tsx`, `app/global-error.tsx`,
`tests/unit/website-studio-naming.test.ts`, `tests/unit/workspace-status-tokens.test.ts`,
`tests/unit/recovery-screens.test.ts`.

**Modified (20):** `app/globals.css`, `app/page.tsx`, `app/api/checkout/route.ts`,
`app/b/[slug]/not-found.tsx`, `app/dashboard/studio/page.tsx`, `app/dashboard/subscription/page.tsx`,
`app/dashboard/businesses/[id]/page.tsx`, `components/workspace/WorkspaceUI.tsx`,
`components/ai/AIFrontDeskWorkspace.tsx`, `components/dashboard/{EntitlementBanner,PublishPanel,WebsiteHealth}.tsx`,
`lib/{statusLabels,nextAction,productNames}.ts`, `lib/experience/{entitlement,validate}.ts`,
`lib/ai/quota.ts`, `lib/studio/copilot.ts`, and the two updated AI Front Desk test files.

No database migration, no schema change, no environment/infrastructure change, no deletion of a working feature.

---

## 5. Verification evidence (commands actually executed)

| Check | Command | Observed result | Status |
|---|---|---|---|
| Unit tests (full) | `npx vitest run tests/unit` | **1850 passed / 1 failed** — the 1 failure is the pre-existing Prisma-engine `dmmf` test (offline env). Baseline before changes was 1822 passed / same 1 failure; **+28 new passing tests, 0 regressions**. | PASS (1 BLOCKED by env) |
| Integration + security | `npx vitest run tests/integration tests/security` | **1094 passed, 12 skipped, 0 failed** (skipped files require a live Postgres). Covers tenant isolation, publish authorization, Paystack security, session revocation. | PASS |
| Type check | `npx tsc --noEmit` | Only the 4 pre-existing **test-file** Prisma-stub errors; **0 errors in app/components/lib** and in the new tests. | PASS (env-only failures) |
| Lint (build gate) | `npx eslint app components lib` | **0 errors**, 41 warnings — all pre-existing advisory `react-hooks/*` / stale-directive warnings documented in `eslint.config.mjs`. | PASS |
| Production build | `npx next build --webpack` (offline; engine-dependent test files temporarily set aside, then restored) | "✓ Compiled successfully", type-check + lint + route generation all pass, **exit 0**, full route table emitted incl. new 404/global-error. | PASS |
| Targeted feature tests | `vitest run` for design-system, landing/homepage, experience-publish, entitlement, dashboard-ux, status-labels, AI Front Desk journey/a11y, new suites | All pass. | PASS |
| Browser/Puppeteer & Postgres E2E | `test:browser:*`, `tests/e2e`, `tests/prisma` | Require a Chrome binary / live Postgres / Prisma engine unavailable in this sandbox. | NOT TESTED (env) |

The three temporarily-moved test files were restored immediately after the build; `git status` confirms no file
deletions remain and no config was weakened to obtain the green build.

---

## 6. Remaining risks and recommended follow-ups (not changed here)

1. **Password-recovery shell parity (Low).** Login/register use the rich two-panel `WorkspaceAuthShell`;
   `forgot-password`/`reset-password` use the simpler shared `PageShell`. Both use the same Field/Button
   primitives and platform palette, so this is visual parity rather than a defect; a dedicated, browser-tested
   pass is recommended before changing them (a Puppeteer recovery smoke exists but needs Chrome).
2. **`toneClass()` in `lib/statusLabels.ts` (Low).** Legacy Tailwind-class helper, now only referenced within its
   own module and pinned by an existing test; candidate for removal in a separate, test-updated change.
3. **Prisma engine in CI (Blocker for local full type-check only).** Restore network access to
   `binaries.prisma.sh` (or run in the normal CI environment) so `prisma generate` produces the full client; the
   four type errors and one unit failure then disappear with no code change.
4. Browser/responsive and E2E journeys should be re-run in an environment with Chrome + Postgres to add
   rendered-device evidence on top of the structural and unit evidence above.

## 7. Deployment readiness

* **Code completion:** ready for review — full unit/integration/security suites green (modulo documented env
  limits), production build compiles and generates all routes, no security/entitlement/tenant control weakened.
* **Merge / production deploy:** **not performed**, per the brief. Awaiting explicit owner approval. No production
  env vars, database, payment settings or infrastructure were touched.
