# JATA AFTERCALL — Workspace UI/UX transformation

**Branch:** `arena/321c76ed-jata-aftercall` · **Date:** 2026-10-25 · **Production:** https://jata-aftercall.vercel.app

This document records what was actually implemented in this pass, what was verified, what is
blocked, and what remains. It is written to be checked against the code, not instead of it.

---

## 1. What this pass changes

The public landing page already set a high visual standard (graphite ink, warm cream, amber
accent, serif display, documentary photography). Everything *behind* the sign-in screen did not
match it: plain text-first sections, default-looking cards, duplicated navigation, a dark AI
console rendered as its own full-screen app, and an account/setup flow on a bare page shell.

This pass builds a **workspace design system** that carries the landing page's identity through
every owner screen, and rebuilds the worst offenders on top of it.

### 1.1 Design foundation (`app/globals.css` → `ws-*` layer)

* A scoped token set on `.ws-shell` (never `:root`): `--ws-ink`, `--ws-cream`, `--ws-paper`,
  `--ws-solid`, `--ws-text`, `--ws-muted`, `--ws-line`, `--ws-amber`, `--ws-amber-deep`,
  `--ws-jade`, `--ws-display`, radii, three elevations, motion duration/easing.
* The shared `jata-*` primitives (`Card`, `Metric`, `StatusPill`, `Alert`, tables, buttons) are
  **bridged** onto the workspace palette, so every existing component inherits the new look
  instead of a parallel component set being introduced.
* Two variants of the same rules:
  * **Cream / gold** (light) — the brand's editorial palette.
  * **Graphite / amber** — the same tokens re-pointed for the `Lime Spark / Graphite` product
    theme, so the workspace follows the appearance the owner already chose. Only token values
    differ; no rule is duplicated.
* Components: `.ws-chrome` (account header), `.ws-rail` (section navigation), `.ws-hero`
  (photographic hero band), `.ws-biz` (business card with cover photograph), `.ws-stat`
  (metric tile), `.ws-next` (next-step callout), `.ws-action` (quick-action grid), `.ws-facts`,
  `.ws-timeline`, `.ws-editor` (progressive-disclosure editor), `.ws-plan` (plan card),
  `.ws-door` (per-business product door), `.ws-empty`, `.ws-auth` (split account shell),
  `.ws-skel` (loading).
* Accessibility floor: 44 px touch targets, visible 3 px amber focus rings, `aria-current` on the
  active section, semantic status colours that are never the only carrier of meaning, and a
  `prefers-reduced-motion` block that disables every workspace entrance/hover animation and the
  skeleton shimmer.

### 1.2 New reusable components

| File | Purpose |
| --- | --- |
| `lib/workspaceImagery.ts` | Category → photograph registry (2 sizes × WebP + JPEG), `safeImageUrl()` (https / site-relative / inline image only), `businessInitials()`, `categoryLabel()`, alias-aware `photoForCategory()`. |
| `components/workspace/WorkspaceUI.tsx` | `WorkspacePhotoImage`, `WorkspaceHero`, `WorkspaceHeroStat`, `WorkspacePanel`, `WorkspaceStat`, `WorkspaceSectionHead`, `WorkspaceEmpty`, `WorkspaceFacts`, `WorkspaceFact`, `WorkspaceSkeleton`. |
| `components/workspace/PlanCard.tsx` | One plan card, used by the subscription screen and the dev preview. Prices and periods are passed in from `PlanConfig`; the card can never invent one. |
| `components/workspace/WorkspaceDoor.tsx` | Shared per-business "door" row for Website Studio and Business POS. |
| `components/workspace/WorkspaceAuthShell.tsx` | Split account shell (login/register) and the `WorkspaceSetupShell` chrome for the add-a-business wizard. |

### 1.3 Imagery

`public/workspace/` (1.8 MB total, committed):

| Asset | Use |
| --- | --- |
| `hero-workspace*.{jpg,webp}` | Hero band on the dashboard, plans, studio, POS and AI screens (Nairobi at dusk — the same city the landing hero establishes). |
| `category-retail*`, `category-professional*`, `category-produce*`, `category-fitness*` | Category illustrations for shops, professional services, produce/food-adjacent and fitness businesses, plus the neutral fallback. |
| existing `/landing/*` photographs | Re-used (not duplicated) for food, beauty/salon, automotive/technical, property and interiors. |

Every photograph ships as a ~1200 px and a ~720 px file in both WebP and JPEG, declares
`width`/`height` (no layout shift), carries an honest alt text beginning "Illustrative photo…",
and is lazy-loaded unless it is the hero. **An owner's own cover/logo is preferred over the
category illustration**, and owner-supplied URLs pass through `safeImageUrl()` first.

### 1.4 Screens rebuilt

| Route | Before | After |
| --- | --- | --- |
| `/dashboard` (shell) | Light `jata-nav` bar with a second row of plain links; email + Home + Log out. | Graphite `.ws-chrome` header (brand, "Workspace" tag, account chip, Home, Log out) + single scrollable amber section rail with icons and `aria-current`. |
| `/dashboard` (overview) | `PageHeader` + a stacked list of long cards: pills, next step, plan row, referral, metrics, chart, eight buttons, three collapsible editors, unpublish. | Branded photographic hero with the owner's real totals (views / WhatsApp / calls / directions), primary actions, and a live/draft + recorded-responses line; then portfolio summary and comparison table (multi-business only); then one art-directed card per business with cover photograph or logo, status pills, one next step, five metric tiles, animated response chart, an icon quick-action grid, page/plan facts, a factual activity timeline, and progressive-disclosure editors. Empty state has its own artwork and the one action that fixes it. |
| `/dashboard/subscription` | Three plain white boxes; plan links as grey tiles. | Hero, business selector chips, plan cards with icon, badge, KES price and billing period read from `PlanConfig`, the shared `PLAN_INCLUDES` benefit lists, a "Your plan" marker, payment-method reassurance, subscription-status list and a payment history with status pills. |
| `/dashboard/studio` | Header + list of `jata-card` rows with plain pills. | Hero, then a photographic door per business (owner cover if present), state pills (Live/Draft, package, unpublished changes, published version), an explanatory line, and real links to the studio, live site, theme, photos and catalogue. A three-step "how publishing works" panel. |
| `/dashboard/pos` | Header + two-column link tiles. | Hero with the stored POS price (`POS_PLAN_PRICE_KES`) and lifecycle counts, photographic doors per business with lifecycle state and configure/open actions, plus a plain-language capability panel and the "separate product, payment-gated" note. |
| `/dashboard/ai` | Dark cockpit rendered as its own full-screen app with a duplicate navigation bar and a nested `<main>`. | Workspace hero (customer-view and configure actions, tenant-scoped business name), then the AI cockpit as a dark rounded panel without duplicate chrome. No AI data behaviour was changed. |
| `/dashboard/businesses/[id]` | Kicker, bold name, URL, tabs. | Category photographic hero with status meta, live/preview/publish actions, then the status pills and the existing studio tabs and panels. |
| `/login`, `/register` | Centered `PageShell` with a card. | Split shell: photographic brand panel with serif headline, three benefit points and the workspace palette; form card with the same primitives; referral invite rendered as a proper success alert. |
| `/onboarding` | `PageShell` (narrow-ish) around a wizard. | Setup chrome matching the workspace, wide reading column, draft/publish explanation. Wizard internals unchanged (they already have a stepper, autosave and validation). |
| `/dashboard/loading.tsx` | Generic text skeletons. | Hero, metric and business-card skeletons in the real proportions of the page. |
| `/dev/workspace-preview` | — | Development-only design preview (same `notFound()` convention as the four existing `/dev/*` previews) that renders the **real** components with clearly labelled synthetic fixtures, so the design can be reviewed at any viewport without a database. |

---

## 2. What did **not** change

* Prisma schema, migrations, database, environment variables and secrets.
* Authentication, session verification, tenant scoping, admin checks, subscription
  enforcement, payment verification, Paystack integration, POS capabilities and Website Studio
  persistence/publishing pipelines.
* Plan prices, durations, entitlements, checkout URLs (`getCheckoutUrl`), and the rule that the
  Business POS is private and payment-gated. The subscription screen reads everything from
  `PlanConfig` and `lib/landing`'s existing copy — a test fails if a KES figure is written into
  the page.
* The public landing page, the generated customer websites (`/b/[slug]`, storefront, checkout,
  receipts) and the POS/Studio editor internals. Those keep their own themes and their own
  `.eb-*` foundation.
* No metric, customer, conversation or payment is fabricated anywhere: the dashboard renders
  only values the server read (`getBusinessMetrics`, subscription row, last payment), and the
  chart says so when there is nothing to show.

---

## 3. Verification

### 3.1 Automated

| Check | Command | Result |
| --- | --- | --- |
| Unit/integration tests | `npx vitest run` | **205 files passed, 14 skipped; 2608 tests passed, 118 skipped, 0 failed** (before this pass: 201/211 files, 2581 passed, 4 failed — all four were source guards for markup this pass replaced, and were updated). |
| Lint | `npx eslint app components lib` | **0 errors**, 39 warnings (all pre-existing patterns: `react-hooks/set-state-in-effect`, unused eslint directives; the 5 new `<img>` warnings were removed by the repository's existing file-level disable convention with a written justification). |
| Typecheck | `npx tsc --noEmit` | Clean for all application code. One pre-existing failure remains in `tests/prisma/experience-boundary.test.ts` (`Prisma.BusinessUncheckedCreateInput` missing from the generated client) — reproduced identically on the base commit `2cae6cd`; it is caused by Prisma engines not being downloadable in this sandbox, not by this change. |
| Production build | `npx next build --webpack` | **Compiled successfully**, TypeScript finished, 44/44 static pages generated, all routes emitted. Run with the pre-existing Prisma-typed test file temporarily moved aside (same environment limitation as above); the file was restored immediately. |
| Render smoke test | `next dev` + `curl` | `/` 200, `/login` 200, `/register` 200, `/forgot-password` 200, `/dev/workspace-preview` 200; `/dashboard` and `/onboarding` correctly 307 → `/login` without a session. No server errors logged. |

New regression tests — `tests/unit/workspace-design.test.ts` (23 assertions) — enforce:

* every `--ws-*` token is defined, and the palette is **not** declared on `:root` (so customer
  sites cannot inherit it);
* the graphite variant exists for the theme the owner actually chose;
* the shared primitives are bridged onto the workspace palette;
* every photograph the registry can return exists on disk, in WebP **and** JPEG, with an honest
  alt text;
* `safeImageUrl()` rejects `javascript:`, protocol-relative and plain-`http` URLs;
* the dashboard, subscription, studio, POS and AI screens use the shared workspace primitives
  and the shared `StatusPill`;
* no KES price is hard-coded in the subscription screen;
* the dashboard cannot seed its own metrics;
* `/dev/workspace-preview` stays production-404 and clearly labelled as synthetic;
* no `alert()` or `location.reload()` returns to the workspace.

`tests/unit/design-system.test.ts` was updated where it asserted the *old* markup (the dashboard
page's `PageHeader`, the loading screen's `LoadingBlock`); its intent (shared primitives, single
`main` landmark, one toast surface, no raw enums) is preserved and extended.

### 3.2 Visual verification — status: **PASS** (rendered browser, 390 px + 1440 px)

Chromium runs in this sandbox through a locally supplied binary (`CHROME_PATH=/tmp/chromium` with
`LD_LIBRARY_PATH=/tmp/nssstub`), and `scripts/verification/workspace-screenshots.mjs` photographs
the **production build** against the disposable `jata_e2e` database: it registers synthetic owners
through the real `/register` and `/login` forms, provisions entitlement/website/POS data through the
application's own APIs, then captures every mission route at both widths.

Latest run: **148 screenshots, every capture HTTP 200, 0 structural flags** (no horizontal overflow
at 390 px or 1440 px, no broken images, no runtime or console errors, exactly one `<main>`).

| Group | Routes captured |
| --- | --- |
| Public | `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, the three seeded demo business pages |
| Storefront | published salon home / shop / book, published retail home / shop, published professional enquiry form |
| Account | `/onboarding` (signed-in owner, draft restored), `/dashboard`, `/dashboard/subscription`, `/dashboard/studio` |
| Business | `/dashboard/businesses/[id]` + `insights, items, orders, bookings, canvas, design, photos, preview, sections, theme` |
| POS | `/dashboard/pos`, `[businessId]` + `sell, products, inventory, sales, orders, customers, suppliers, staff, branches, settings, configure, plan, preview, appointments, menu, jobs, produce, projects, credit` |
| AI | `/dashboard/ai` (unentitled and entitled), cockpit tabs |
| Admin | `/admin`, `businesses`, `customers`, `payments`, `payments/wallet`, `plans`, `subscriptions` |

Defects found in this pass by looking at the renders, and fixed:

* **Storefront header clipped its own CTA on a phone.** A two-word primary action ("Book a
  consultation") could not fit beside the brand at 390 px and was cut by the screen edge. The
  header now drops the CTA below 640 px, where the fixed action bar already carries the same action
  in full (`app/globals.css`).
* **Duplicated catalogue count.** The shop header printed "3 products" and the grid printed
  "3 products" again; the grid line now speaks only when a filter or search has narrowed the list.
* **Priceless fixtures (harness bug, not app).** The storefront product API takes `basePriceKES`
  while the POS API takes `priceKES`; the harness sent the POS name to both, so the public
  catalogue rendered "Request a quote" instead of a price. Fixed in the harness; real prices and
  `ADD TO BASKET` now appear.
* **Two identical "Live" pills** on the studio business card (business state + experience state).
  The site-state pill is now rendered only when it adds information (hidden site, or disagreement
  with the business record).
* **Onboarding had no step illustration or step guidance** — added `components/onboarding/
  StepIllustration.tsx`: seven token-coloured SVG scenes (shopfront, phone, map pin, catalogue,
  swatches, plan card, launch) plus two "what this step needs" bullets, decorative and
  `aria-hidden`, styled by an `.ob-step` block that follows the active appearance.
* **Hero copy sat on the brightest part of the photograph.** The scrim ramps more gradually and the
  subtitle/meta opacities were raised for AA contrast.
* **Out-of-stock POS tiles** read "0 piece"; they now read "Out of stock" (still selectable, because
  the server — not the tile — is the oversell authority).

### 3.3 Functional regression suite

| Check | Result |
| --- | --- |
| `npx vitest run` (unit/integration) | **217 files, 2687 tests passed, 0 failed** with the disposable database attached; 205 files / 2609 tests with it detached (the difference is the Prisma-backed suites, which skip without a database) |
| `npm run test:e2e` / `test:e2e:pos` | 17 + 22 passed |
| `npm run test:browser:studio-hydration` | 25 passed, 0 failed |
| `npm run test:browser:studio-authenticated` | **436 passed, 0 failed**; hydration gate `M418 GATE PASS` (15/15 required samples) |
| `npx eslint app components lib` | 0 errors, 40 warnings (pre-existing patterns) |
| `npx tsc --noEmit` | clean |

## 4. Remaining work (not done in this pass)

1. **Checkout / receipt / storefront artwork.** The customer-facing storefront is theme-driven by
   the business's own document; it was deliberately not restyled beyond the header/CTA fixes above.
   `.pos-receipt` is pinned to white/black on purpose — it is a print artefact.
2. **Manual assistive-technology pass.** Keyboard order, focus rings, 44 px targets and a
   `prefers-reduced-motion` block are enforced in CSS and covered by unit tests, but no screen
   reader (VoiceOver/TalkBack) session was run; that needs a human with the device.
3. **Media upload pipeline.** The harness cannot exercise uploads (no storage provider in this
   sandbox) and writes a first-party image reference directly; the upload flow itself is unproven
   here.
4. **Public AI front desk route.** `/b/<slug>/ai` needs a business that is *published* (Interactive
   Business plan) *and* holds the AI package; those plans are mutually exclusive in the current
   plan matrix, so the harness cannot compose a fixture that satisfies both. The cockpit itself is
   captured on an AI-entitled account; the customer-facing route is **NOT TESTED** in the harness.
5. **Admin console pagination.** `/admin/businesses` lists every row on one page. Correct, but it
   will not stay usable as the table grows.

---

## 5. Release record

* **Branch:** `arena/321c76ed-jata-aftercall` — one PR (#60), no force-push, no replacement PR.
* **Evidence harness:** `scripts/verification/workspace-screenshots.mjs`. The temporary
  `.github/workflows/verification-artifacts.yml` used to shuttle screenshots out of CI was deleted,
  as was its `ci/verification-artifacts` branch — it was tooling, never part of the product.
* **Screenshots:** `.cache/verification/workspace-screenshots/` (git-ignored; 148 JPEGs and
  `report.md` with the per-route table).

Payment/provider behaviour was not exercised: this sandbox cannot reach Paystack, so the fixtures
hold a stored synthetic entitlement that is labelled as such, and no screen claims a provider
confirmed a payment.
