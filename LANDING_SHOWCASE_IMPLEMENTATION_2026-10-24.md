# JATA AFTERCALL — Motion-led homepage and demo showcase

**Branch:** `arena/e5c4c14b-jata-aftercall`
**Baseline:** `cce008dfc468c17e5091162941531a58575ca5c6` (= `origin/main` at the time of work)
**Date:** 2026-10-24
**Status:** implementation complete, verified locally. **Not merged, not deployed, not auto-merged.**

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
* With the stub, `next build`'s type-check step fails on `tests/prisma/experience-boundary.test.ts`
  (`Prisma.BusinessUncheckedCreateInput` does not exist on the stub client). A **local, uncommitted**
  one-line alias was added to `node_modules/.prisma/client/default.d.ts` to reproduce a production
  type-check; nothing in the repository was changed for this.
* No local PostgreSQL server could be installed (package archives are unreachable), so Prisma-backed
  integration tests remain **skipped**, exactly as on the baseline (118 skipped before and after).

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
| `app/page.tsx` | Rewritten as a section stack: hero → story → benefits → demo showcase → pricing → how it works → FAQ → final CTA → POS entry → footer. **Every string and structure the existing tests pin was preserved verbatim**: the four plan names in order, `KES 149 / 999 / 499 / 999`, `>KES 149<`, `>KES 999<`, `Get my business page`, `href="/register"`, `Secure Paystack checkout. Your plan starts once payment is confirmed.`, `Turn every customer interaction`, `Create your page in ~5 minutes`, `Demo businesses`, `id="demo"`, `Simple pricing`, `<main id="main">`, the POS block's exact classes (`mx-auto max-w-6xl px-4 pb-10 sm:px-6`, `sm:flex sm:items-center sm:gap-5`, `sm:w-60 sm:shrink-0`), `aria-labelledby="business-pos-heading"`, one inline SVG icon, one `Open Business POS`, one `/dashboard/pos`, and `POS_PLAN_PRICE_KES` (the literal `499` still never appears in the file). |
| `components/Navbar.tsx` | Adds in-page sections (Product, Benefits, Demos, Pricing, FAQ) and a native `<details>` menu for phones. No `useState`/`useEffect`/`onClick` — navigation works before hydration, with scripts blocked, and if animation fails. Auth state unchanged (Dashboard/Admin/Logout, or Log in/Get started). |
| `app/b/[slug]/page.tsx` | Builds and renders the demo band for the four documented demo slugs only (`+14` lines). Experience-driven storefronts return earlier and are untouched; a customer's own page never matches `demoShowcaseForSlug()`. |
| `app/globals.css` | `+1,109` lines appended in one clearly delimited block. No existing selector was edited. |
| `package.json` | Two scripts: `test:landing` and `test:browser:landing`. No dependency added, removed or upgraded. |

### Added

| File | Purpose |
| --- | --- |
| `lib/landing.ts` | Copy, plan notes, FAQ, demo-card builder, demo order. |
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

No authentication, payment, settlement, provider, migration, secret or POS file was modified.

---

## 4. Design and motion decisions

* **Imagery instead of video.** The brief asks for "optimized video or animation assets". Real people
  and vehicle motion are delivered as slow CSS camera moves over real photographs (`drive` pans the
  Kamau car, `steam` drifts warm light across the Nyumbani plate, `salon` pans the stylist, `tour`
  crossfades the property exterior into the interior). A video would have added megabytes the
  connection cannot afford and an autoplay surface that cannot be paused; the CSS version ships
  **0 bytes** of extra media beyond stills already needed.
* **No 3D.** The existing `three`-based immersive viewer is opt-in and gated by device/network
  policy; nothing here uses WebGL, which keeps the landing's bundle to a **2.3 KB gzipped** page
  chunk plus the router.
* **One client component.** Plan tabs use real `<button role="tab">` elements with `aria-selected`,
  `aria-controls`, roving `tabIndex`, Arrow/Home/End keys, and panels hidden with `hidden` — no
  third-party tab library.
* **Reduced motion.** Every animation in the new block is inside the media query that sets
  `animation: none !important`, and the hero copy has an explicit "visible final state" rule so
  nothing depends on an animation having run. Verified in Chromium with the media feature emulated.
* **No layout shift.** Demo panels keep a fixed 16:10 media box, images carry real
  `width`/`height`, and switching tabs does not move anything above the showcase (measured:
  section offset 2453 px → 2453 px).
* **Mobile first.** 320, 360, 414, 768, 1024 and 1440 px are checked for horizontal overflow;
  the phone navigation collapses the wordmark and menu label at very narrow widths so the sticky
  bar fits 320 px without clipping.

---

## 5. Accuracy and privacy

* **No fabricated claims.** No testimonials, ratings, review counts, customer numbers, revenue
  figures, "trusted by" copy, "best/leading" adjectives or income promises. Pinned by
  `tests/unit/landing-content.test.ts` (regex sweep over every marketing string).
* **No invented prices.** Plan prices come from `PlanConfig` (or `FALLBACK_PLANS` when the database
  is unreachable); demo prices come from the published demo rows and, when those cannot be read, from
  the documented demo seed — labelled "documented demo content" in that case.
* **Illustrative imagery stated everywhere.** Alt text begins with the scene and ends with
  "Illustrative photograph… not the business's own"; cards carry a visible "Illustrative photograph ·
  example business" caption; the demo band carries an "Illustrative demo" flag; the footer states it
  again.
* **POS stays private.** The POS is not a plan card, is not in `PLAN_INCLUDES`, does not appear on any
  demo page, and its only public reference is one FAQ sentence explaining that it is separate and
  owner-only. Its entry still links to the authenticated `/dashboard/pos`, which redirects anonymous
  visitors to `/login` and lists businesses strictly from `getOwnedBusinessIds(session)`.
* **No cross-tenant data.** The band is only built for the four exact demo slugs on a `public`
  decision with at least one service row; the card builder only reads the same four slugs.
  A customer's page was rendered in the test suite and confirmed to contain neither the band nor the
  word "Illustrative".
* **Demonstrations isolated from real transactions.** Every band and card action is an existing
  in-page anchor (`#services`, `#quote`) or the demo's own WhatsApp/Call/Directions. No new checkout,
  cart or payment path was introduced; the demo pages take no payments (stated on the band).

---

## 6. Verification

### Automated tests — `npx vitest run`

| | Baseline `cce008d` | This branch |
| --- | --- | --- |
| Test files | 196 passed / 14 skipped | **199 passed / 14 skipped** |
| Tests | 2,464 passed / 118 skipped | **2,502 passed / 118 skipped** |
| Failures | 0 | **0** |

38 new tests across three files (`test:landing`), including:
content accuracy and demo-card data, band scope isolation, AA contrast for the landing palette,
reduced-motion and lazy-media rules, dev-harness production 404, and the POS boundary.

The 118 skipped tests are the Prisma/PostgreSQL suites; they are skipped on the baseline for the same
reason (no database reachable in this sandbox).

### Build and static checks

| Command | Result |
| --- | --- |
| `npm run build` | **Success** — compiled, type-checked and exported 44 routes (`Build completed successfully`). The only baseline type error was the offline Prisma stub, worked around locally as described above. |
| `npx tsc --noEmit` | **Clean** |
| `npx eslint app components lib` | **0 errors**; the 40 warnings are all pre-existing (POS/storefront `setState`-in-effect, unused disables). The new and modified files lint **clean**. |

### Browser acceptance — `npm run test:browser:landing`

Run in headless Chromium 131 at 320/360/414/768/1024/1440 px.

| Run | Result |
| --- | --- |
| `ONLY=home` (production build, hydrated) | **55/55 checks passed** |
| `ONLY=demos` (dev server harness) | **32/32 checks passed** |

What those 87 checks assert:

* no horizontal overflow at every width; every visible photograph decodes; every image has alt text;
  one `<h1>` and one `<main id="main">`; primary CTA present; zero page errors — at all six widths;
* four demo tabs; the first panel shows three real services and links to `/b/nyumbani-kitchen`;
  clicking a tab switches panels; **no layout shift** above the showcase; ArrowRight/Home move focus
  *and* the panel; no page errors during interaction;
* the phone menu is closed until pressed, the nav bar fits 360 px, and the open menu renders every
  section link plus Log in/Get started fully inside the viewport;
* with `prefers-reduced-motion: reduce`, the hero photograph, marquee, phone and hero copy all report
  `animation-name: none`, stay at `opacity: 1`, and stay visible;
* for each of the four demo businesses at 360 px and 1440 px: the band renders with three services and
  `#services`/`#quote` actions, its photography is labelled illustrative, there is no horizontal
  overflow, and no page errors.

Screenshots: `docs/evidence/landing-2026-10-24/` (before/after pairs for desktop and Android, per-width
captures, the open mobile menu, the reduced-motion capture and all four demo businesses on mobile and
desktop).

---

## 7. Known limitations and remaining defects

1. **No live database run.** The demo pages were verified through the development harness that mounts
   the same components against the documented demo content, not against a seeded PostgreSQL. The
   Prisma-backed integration tests remain skipped. To close this gap, run in an environment with a
   database:
   ```bash
   npx prisma migrate deploy && npm run seed
   npm run dev   # then: /b/nyumbani-kitchen, /b/marys-beauty-studio, /b/kamau-auto-care, /b/john-kamau-properties
   ```
   The unit suite already renders `/b/<slug>` with a mocked Prisma for all four slugs and asserts
   name, services, prices, location, offer, `tel:` and `wa.me` links.
2. **Imagery is illustrative, not the businesses' own.** No authorised photography existed in the
   repository, so generated photographs are used and labelled. Replacing them with owner-supplied
   assets is a content task, not a code change.
3. **The `/dev/demo-showcase` harness exists in the tree.** It returns 404 in production and is
   registered with `robots: index:false`. It reads no database and writes nothing, but if the
   project's policy is that no `/dev` route may ship outside local builds, it should be deleted
   before release.
4. **Static `<img>` instead of `next/image`.** Chosen deliberately (static files in `/public`, hand
   picked `srcset`/`sizes`, no optimizer endpoint in this deployment). Next's lint rule warns for the
   eager hero; the rule is satisfied on every other image.
5. **No slow-network throttle run.** The check does not emulate 3G. Weight was instead bounded by
   budget: hero 215 KB (jpg) / 103 KB (720 px), cards 72–146 KB (webp), the rest lazy; one test fails
   the build if any landing image exceeds 260 KB.
6. **Hydration delay in `next dev`.** Under React 18 + Next 16 dev mode the client bundle hydrates late
   enough that a click in the first seconds is lost; the interaction checks therefore run against the
   production build (`ONLY=home`) and use retry-and-wait in the harness. This is a dev-server
   behaviour, not a production one.
7. **`Payment`/subscription flows were not exercised end-to-end** — no Paystack key or database is
   available. Their existing regression tests all pass unchanged.
8. **Product theme toolbar.** The appearance picker remains above the landing page (existing global
   chrome). Its background is matched to the landing palette via `:has(> .lp-page)` so there is no
   stray strip, but the page intentionally keeps its own palette rather than following the theme.

---

## 8. Authorisation boundary — what was and was not done

* Work is confined to `arena/e5c4c14b-jata-aftercall`; nothing else was branched, pushed or merged.
* No production data, migration, secret, payment provider, settlement setting or external provider
  configuration was touched (`git status` lists only the files above).
* No dependency was added, removed or upgraded; no paid service was used. The Chromium used for
  screenshots was installed **outside** the repository (`/tmp`) and is not a project dependency.
* No unrelated workflow was re-run.
* **Production release requires separate explicit approval.** Nothing here is deployed.

### Landing plan order (unchanged, verified)

1. Monthly — KES 149/month
2. Annual — KES 999/year
3. AI Business Front Desk — KES 499/month
4. Website Studio — KES 999/month

Business POS remains outside the four cards, owner-only, and priced from the server constant.
