# Homepage pricing grid — five plans in one grid (2026-10-25)

Owner request: the Business POS must sit in the **same** pricing grid as the four page plans. No
plan may be isolated in a separate section.

## What the code did before

`app/page.tsx` rendered the four page plans in the shared `.lp-plans` grid, then a **separate
Tailwind promotional `<section>`** (light card, lime button, `id="business-pos-heading"`) for the
Business POS. Measurements on `main` (`a04ecb7`) show how isolated that block was — and that it
looked like a different product, not a fifth plan:

| Width | Cards in the grid | Card width | The POS block's distance below the grid |
|---|---|---|---|
| 390px | 4 | 350px | **1970px** |
| 768px | 4 | 356.8px | **1519px** |
| 1280px | 4 | 273.2px | **1717px** |

## What it does now

One `.lp-plans` grid inside one `#pricing` section holds all five cards, in marketing order, each
built from the same eight card rows (name, badge, price, period, description, features, CTA, fine
print) and sharing those rows through `grid-template-rows: subgrid`:

| # | Plan | Price | Period | CTA |
|---|---|---|---|---|
| 1 | Monthly | KES 149 | per 30 days | `/register` |
| 2 | Annual | KES 999 | per year (365 days) | `/register` |
| 3 | AI Business Front Desk | KES 499 | per 30 days | `/register` |
| 4 | Website Studio (`INTERACTIVE_BUSINESS`) | KES 999 | per 30 days | `/register` |
| 5 | JATA AFTERCALL — Business POS (`BUSINESS_POS`) | KES 499 | per 30 days | `/dashboard/pos` |

Prices and periods are the stored `PlanConfig` rows (`prisma/seed.ts`) rendered through
`homepagePlanCards()` — the page holds no price literal.

## How the evidence was produced

* Headless Chromium 153 (`@sparticuz/chromium` binary + its AL2023 library set, since the sandbox
  image ships no browser and no NSS/NSPR), driven with the repo's `puppeteer-core`.
* `npm run dev` for both trees: the fixed branch on `:3000`, `main` (`a04ecb7`) on `:3001` from a
  detached `git worktree` sharing `node_modules`.
* Section crops taken after hiding the sticky site header and the dev overlay (page chrome, not
  content) and freezing animation, so the crops are reproducible and show page content only.
* Repeatable check: `CHROME_PATH=<chromium> BASE_URL=http://localhost:3000 npm run test:browser:pricing`
  — 80 assertions over the 8 brief widths (grid count, card count, stray cards, horizontal
  overflow, per-row card width, row alignment, order/price/period/CTA, POS last).

## Measured layout, fixed tree

| Width | Grid tracks | Cards per row | Card width (all equal) | Container | `scrollWidth` |
|---|---|---|---|---|---|
| 320px | 1 | 1+1+1+1+1 | 280px | 280px | 320 (= viewport) |
| 360px | 1 | 1+1+1+1+1 | 320px | 320px | 360 (= viewport) |
| 390px | 1 | 1+1+1+1+1 | 350px | 350px | 390 (= viewport) |
| 414px | 1 | 1+1+1+1+1 | 374px | 374px | 414 (= viewport) |
| 768px | 2 | 2+2+1 | 356.8px | 728px | 768 (= viewport) |
| 1024px | 2 | 2+2+1 | 464.8px | 944px | 1024 (= viewport) |
| 1280px | 6 (2 spans each) | 3+2 | 369.1px | 1136px | 1280 (= viewport) |
| 1440px | 6 (2 spans each) | 3+2 | 369.1px | 1136px | 1440 (= viewport) |

No horizontal overflow at any width, no card content outside its card, every card in a row the
same width, and the name/price/period/features/CTA rows start on the same line across a row.

## Files

* `before/pricing-*.jpg` — `main`'s four-card grid at 390, 768, 1280.
* `before/separate-pos-block-*.jpg` — the standalone POS block that sat below it.
* `after/pricing-*.jpg` — the fixed tree at 320, 390, 768, 1024, 1280, 1440.

## Not claimed

* Production (`https://jata-aftercall.vercel.app`) was **not** verified: this change is not merged
  or deployed. Nothing here describes production behaviour.
* The POS still switches on only from `PlanConfig` + confirmed payment inside the authenticated
  `/dashboard/pos` flow. The card is an entry point; an anonymous request to `/dashboard/pos`
  still redirects to `/login` (verified against the running server: `307` → `/login`).
