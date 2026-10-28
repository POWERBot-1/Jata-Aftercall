# POS / ERP - PRO — E4 owner review package

**What this is.** Everything you need to decide three visual questions, and nothing that pretends to
decide them for you. The measurements are automated and reproducible; the three questions below are
yours, and each one is currently left at "as built" rather than at a default I invented.

**Head reviewed:** `a018bbe0ac57f4525aefbcff0e7ba9fd8bbd779a` (PR #71, base `main`).
**Status of E4:** **DECISIONS IMPLEMENTED — awaiting owner eyes on the result.**

On 2026-10-28 the owner answered all three questions (`Q1 b`, `Q2 b`, `Q3 c`). They are implemented and
measured below. The only thing still open is whether the owner is satisfied with how they look, which no
amount of measuring can supply.

---

## 1. Where the screenshots are

| What | Where | Notes |
| --- | --- | --- |
| **ERP screens, six viewports (24 JPEGs + `evidence.json` + `summary.log`)** | GitHub artifact **`erp-visual-71`** — https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/40757475711/artifacts/12846977106 | 3.29 MB zip. Produced on a GitHub runner in run `40757475711` (job `123053227834`). Expires **2026-11-11**. Requires a GitHub sign-in to download. |
| Local copy of the same 24 images | `.cache/verification/erp-visual/` | git-ignored, 3.9 MB. Regenerate with `npm run test:erp:visual`. |
| Local browsable gallery | run `npm run test:erp:visual:gallery`, then open `.cache/verification/erp-visual/gallery.html` | Generated from `evidence.json`, so the numbers beside each image are the measured ones. |
| Storefront screenshots (not the ERP) | artifact `premium-screenshots-71` — https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/40757475711/artifacts/12845844465 | 13.2 MB, the existing public-shop evidence. |

If you would rather review the images inside the repository than download a zip, the real-Chrome
workflow has a label-gated publish: adding the `visual-evidence` label makes it commit its evidence to
the session branch. That is a transient channel, not a product change, and it is **not** switched on
by this package — say so and I will use it, or leave it off.

### What the automated pass guarantees

| Measurement | Result |
| --- | --- |
| Captures | **24/24** `ok: true` (4 screens × 6 viewports) |
| HTTP status | 200 on every capture |
| Expected heading present | yes on every capture |
| Horizontal overflow (`scrollWidth − clientWidth`) | **0px at every viewport, every screen** |
| Main column width | exactly the viewport at 320 / 360 / 390 / 430 / 768; 1312px at 1366 (sidebar visible) |
| Browser | HeadlessChrome 131.0.6778.0, real Chromium, production build over real HTTP |

Screens: **workspace**, **tasks**, **requisitions**, **procurement** — the four screens a person
actually works in during a procurement cycle. The setup checklist, orders, invoices and reports are
covered by the page checks (HTTP and authorisation) but were not part of this image set.

---

## 2. The three decisions, as implemented

| # | Decision | Approved | Implemented in | Measured evidence |
| --- | --- | --- | --- | --- |
| **Q1** | Tablet breakpoint moves from 900px to 700px, so 768px tablets keep the sidebar | option (b) | `app/erp.css` — the `@media (max-width: 900px)` block became `@media (max-width: 700px)` | sidebar live at 701px and above, bottom bar at 700px and below, at every captured width |
| **Q2** | KPI cards two-up from 360px | option (b) | `app/erp.css` — `.erp-grid-3` is `repeat(2, minmax(0,1fr))`; one column only below 360px | 2 columns at 360/390/430/700/768/1024/1366; 1 column at 320 |
| **Q3** | Below 430px the module label is `ERP` | option (c) | `app/dashboard/erp/[businessId]/layout.tsx` (two server-rendered spans) + `app/erp.css` (`.erp-label-short`) | short label visible at 320/360/390/430, full label at 700/768/1024/1366 |

### What the first capture caught (and was fixed)

The decisions were not the end of the work. The first 768×1024 capture of the **real shell** showed a
regression the decision itself created: with a 264px sidebar back at 768px, the topbar had too little
room, so "POS / ERP - PRO" broke over two lines and the action buttons wrapped onto a second row.

Two changes followed, both measured:

1. `.erp-topbar-title { white-space: nowrap }` — the label never breaks mid-word.
2. At **701–859px** the 264px rail becomes a **72px glyph strip** (brand mark + icon-only links, text
   hidden by CSS while the link's accessible name is unchanged); at **860–1024px** the rail narrows to
   212px with labels. At ≥1025px the full 264px rail is untouched.

The 768×1024 image now shows a single-row header, a glyph rail and two KPI columns.

### Viewport coverage

| Viewport | Nav mode | KPI columns | Module label | Overflow |
| --- | --- | --- | --- | --- |
| 320×568 | bottom bar | **1** (below the 360px rule) | `ERP` | 0px |
| 360×800 | bottom bar | 2 | `ERP` | 0px |
| 390×844 | bottom bar | 2 | `ERP` | 0px |
| 430×932 | bottom bar | 2 | `ERP` | 0px |
| 700×900 | bottom bar (the boundary) | 2 | `POS / ERP - PRO` | 0px |
| 768×1024 | **sidebar** (glyph rail) | 2 | `POS / ERP - PRO` | 0px |
| 1024×768 | **sidebar** (212px labelled) | 2 | `POS / ERP - PRO` | 0px |
| 1366×768 | **sidebar** (264px) | 2 | `POS / ERP - PRO` | 0px |

Two independent artifacts measure this, and they are not interchangeable:

| Artifact | What it proves | Where |
| --- | --- | --- |
| `npm run test:erp:visual` — real Next.js build, real database, real session | the **product**: every ERP screen at every width | CI step + artifact `erp-visual-71`; images also in the label-gated `verification/evidence` channel |
| `npm run test:erp:layout-fixture` — the two real stylesheets + the shell markup | the **stylesheet decisions** Q1/Q2/Q3 as a fast local loop, no database | `.cache/verification/erp-layout-fixture/` (8 viewports, viewport + full-page shots) |

The fixture is labelled a fixture everywhere. It can prove the CSS; only the real-app capture can prove
the product, so **CI's capture is the evidence of record for E4**.

## 3. What I am not asking you

* **Not** asking you to approve the espresso / cream / amber identity again — it is recorded as
  restored and the design guards pass (`docs/POS_ERP_PRO_VISUAL_REVIEW.md`, E10).
* **Not** asking you to accept any measured result — those are reproducible with the command in §4.
* **Not** asking for brand sign-off on screens outside this set (storefront, POS till, admin). The
  storefront has its own capture job and its own review history.

## 4. Reproducing any of it

```bash
# 24 captures + evidence.json + summary.log (needs Chrome, a built app, a disposable database)
CHROME_PATH=/path/to/chrome AUTH_SECRET=... DATABASE_URL=postgresql://... \
  ERP_PRO_ENABLED=true SHOT_DIR=.cache/verification/erp-visual npm run test:erp:visual
# then the browsable gallery
npm run test:erp:visual:gallery
```

Exit codes: `0` PASS, `1` FAIL, `2` BLOCKED (nothing captured — never counted as a pass).

## 5. What is still open

The three decisions are implemented and measured. What has **not** happened is the owner looking at the
resulting screens. Until that happens E4 stays **OPEN**, and nothing in this repository claims the
product is visually approved by you.

If the 320px phone header still reads badly with the short `ERP` label, the recorded next step is
option **(b)** from the original Q3 table — move the module label and plan badge into the page body below
430px. That is a larger change (it touches every ERP page's header markup) and it is **not** implemented;
it needs your decision, and this document is where it would be recorded.
