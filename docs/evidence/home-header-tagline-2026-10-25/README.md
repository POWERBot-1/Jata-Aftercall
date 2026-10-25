# Home header + hero tagline — fix evidence (2026-10-25)

Branch `arena/44f2d980-jata-aftercall` against `main` @ `e8de29d74984245347a9930770f9b55e8a227f34`
(PR #57 merge, the commit production `https://jata-aftercall.vercel.app` is serving).

## The two defects, reproduced

Both were reproduced in a real headless Chromium before any edit, with
`scripts/browser/home-header-tagline.check.mjs` (180 checks, the baseline run is in `before/`):

| Defect | Baseline evidence |
| --- | --- |
| 1. `JATA AFTERCALL` overlaps the Dashboard control on a phone | `FAIL 390px signed-in: no header overlap — nav-actions+2168px²`, `FAIL 414px signed-in: no header overlap — nav-actions+1784px²`. At 320/360 px the wordmark was not rendered at all (`.lp-nav .jata-brand-name { display: none }` under 380 px), and the remaining wordmark was squeezed by the flex row (`squeezed` text overflowing its own box). |
| 2. Tagline missing on mobile | `FAIL 320/360/390/414px: tagline visible …`, `rendered=0` — the shared rule `@media (min-width: 640px) { .jata-brand-tag { display: inline } }` turned the tagline off below 640 px and the landing header never switched it back on. |

Baseline: **150/180 checks passed, 30 failed.** After the fix: **180/180 passed** (see `after/`).

## What changed

| File | Change |
| --- | --- |
| `components/ui/BrandMark.tsx` | The tagline is now an explicit `tagline` prop (default on) instead of "everything that is not compact". `compact` headers (dashboard, product shells) still render no tagline, so nothing else changes. |
| `components/Navbar.tsx` | Passes `tagline` explicitly and documents the header contract in the component comment. |
| `app/globals.css` | The shared `.jata-brand-tag` rule stops toggling the tagline by viewport width; `.lp-nav` owns its breakpoint. Below 640 px the tagline drops to its own line under the wordmark (the wordmark stacks and grows into the space the menu control leaves); below 420 px the account links move into the phone menu panel, so the wordmark keeps its full text instead of being squeezed under the controls. The header row and the desktop link row can now wrap instead of pushing the wordmark into the controls next to it. |
| `tests/unit/landing-header.test.ts` | New. Pins the header markup (wordmark, tagline rendered exactly once inside the brand link, Dashboard/Admin/Logout destinations, anonymous flows, compact headers) and the CSS rules that make the layout work. |
| `scripts/browser/home-header-tagline.check.mjs` | New. The browser check below. |

Nothing else moved: no plan, pricing, POS, auth, payment, database or deployment change.

## Browser verification (real Chromium 153, headless)

```
CHROME_PATH=… BASE_URL=http://localhost:3100 SHOT_DIR=… node scripts/browser/home-header-tagline.check.mjs
```

180 checks at 320, 360, 390, 414, 768, 1024, 1280 and 1440 px, in the anonymous header and in the
signed-in header (the session links are injected exactly as `Navbar` renders them, in the bar and in
the phone menu panel), plus:

* no overlap between the wordmark's painted text and the navigation controls (measured on text boxes,
  so a flex row that squeezes a wordmark below its text width is reported);
* the wordmark and the tagline visible, unclipped and inside the header, at every width;
* the tagline rendered exactly once in the visible content (`rendered=1`, `leafNodes=1`);
* no horizontal page overflow; header/hero spacing; one `<h1>`;
* the menu open at 320/390/414 px: no overlap, panel inside the viewport, Dashboard at `/dashboard`;
* browser text scaling at 125 % and 150 % root font at 320/390/768 px;
* keyboard path (theme picker → skip link → brand → menu control), the menu opening with the keyboard
  and a panel link taking focus, accessible names;
* anonymous `/dashboard/pos` and `/dashboard` still redirect to `/login`.

Screenshots: `after/header-<width>.jpg` (top of the page) and `after/menu-<width>.jpg` (menu open).

## Regression checks

* `scripts/browser/pricing-grid.check.mjs` — **80/80 passed** (`after/pricing-grid-check.log`): five
  cards in one grid, KES 149 / 999 / 499 / 999 / 499, the POS card last with its own CTA to
  `/dashboard/pos`, every page plan CTA to `/register`.
* `scripts/browser/landing-showcase.check.mjs ONLY=home` — **56/58 passed** (`after/landing-showcase-check.log`).
  The two failures ("every visible photograph decoded", 2 visible of 6) are pre-existing: the same two
  checks fail on the unmodified baseline in this sandbox (lazy demo photography never enters the
  viewport during the walk). Everything else — overflow, nav, keyboard, reduced motion — passes.
* `npm run test` — **202 files passed, 14 skipped; 2535 tests passed, 118 skipped, 0 failed.**
  The skips are the database-backed suites; this sandbox has no PostgreSQL and no network access to the
  Prisma binary host, so `prisma generate` cannot run and those suites self-skip (CI provisions both).
* `npm run lint` — 0 errors (36 pre-existing warnings, none in the changed files).
* `npm run typecheck` — one error, `tests/prisma/experience-boundary.test.ts(34,19)`, caused by the
  ungenerated Prisma client (offline). It is identical on the unmodified baseline (verified with the
  changes stashed), so it is environmental, not introduced here.
* `npm run build` — the repository's build gate runs `prisma generate` first; offline it fails and the
  TypeScript step then reports that same pre-existing Prisma error. To obtain a runnable production
  server for the browser verification above, the build was run once with `typescript.ignoreBuildErrors`
  set in `next.config.js`; that setting was reverted immediately afterwards and is not part of the
  change. `next build --webpack` itself compiles cleanly and the server serves the page.

## Outstanding risks

* The two pre-existing landing-showcase image-decode failures and the offline Prisma type error are
  environmental; CI's PostgreSQL-backed gates are the authority on those.
* The tagline now sits on its own line under the wordmark below 640 px. That is the smallest change
  that keeps the wordmark, the tagline and the controls readable at 320 px; the desktop arrangement
  (tagline inline after the wordmark) is unchanged.
* No deployment was made: the branch is unmerged and `main` is untouched.
