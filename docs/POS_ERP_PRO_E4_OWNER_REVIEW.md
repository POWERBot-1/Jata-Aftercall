# POS / ERP - PRO — E4 owner review package

**What this is.** Everything you need to decide three visual questions, and nothing that pretends to
decide them for you. The measurements are automated and reproducible; the three questions below are
yours, and each one is currently left at "as built" rather than at a default I invented.

**Head reviewed:** `a018bbe0ac57f4525aefbcff0e7ba9fd8bbd779a` (PR #71, base `main`).
**Status of E4:** **OPEN, waiting on you.** Not on a defect — the defects found are fixed.

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

## 2. The three design questions

Each one is a recorded observation, not a bug: nothing clips, overlaps or overflows, and the automated
results are identical under every option. My recommendation is stated so you can accept or reject it
rather than start from a blank page — but the decision is yours and the code currently stays at
"as built" until you answer.

### Q1 — Tablet layout at 768–900px (finding V5)

At 768×1024 the sidebar is replaced by the bottom bar, because the sheet switches to the single-column
layout under `max-width: 900px`. A 10-inch tablet therefore gets the phone experience.

| Option | What it looks like | Cost to build | Risk |
| --- | --- | --- | --- |
| **(a) Keep as built** — phone layout for the whole ≤900px range | Bottom bar at 768px too | zero | none |
| **(b) Move the breakpoint to 700px** | 768px tablets keep the sidebar, two columns | ~1 line + re-capture 24 images | low: the 768 captures would change, so the evidence has to be regenerated and re-reviewed |
| **(c) Phone layout + sidebar drawer at tablet widths** | Bottom bar stays, a drawer adds the full nav | a drawer component + focus handling + tests | medium: new interaction to make accessible and to test |

**My recommendation: (b).** It is the smallest change that gives a tablet a tablet layout, and the
768×1024 viewport you mandated is otherwise a phone screenshot with extra space.

### Q2 — KPI cards below 900px (finding V6)

Drafts / Waiting decision / Approved stack as three full-width cards on phones. Legible and tappable,
but on a 320px screen they push the requisition list below the fold.

| Option | What it looks like | Cost to build | Risk |
| --- | --- | --- | --- |
| **(a) Keep as built** — one tall card each | three rows | zero | none |
| **(b) Two columns from 360px** | 2 + 1, so two rows | one media query + re-capture | low |
| **(c) One compact row of three numbers, no card chrome** | a single strip | new component + tests | medium: changes the visual language for KPIs everywhere, not just here |

**My recommendation: (b).** It keeps the card language, removes one screenful of scrolling, and leaves
320px alone (where two columns would be too tight).

### Q3 — The phone identity block (finding V7)

On a 320px screen the `POS / ERP - PRO · plan · inbox · New campaign · Business POS` cluster wraps into
several rows above the page title, and the business name wraps to one word per line
("VISUAL / CHECK / 01DE…"). Nothing overlaps or clips, and the page title still comes first in reading
order after it — but it is the weakest area visually, at the three smallest widths.

| Option | What it looks like | Cost to build | Risk |
| --- | --- | --- | --- |
| **(a) Keep as built** | crowded but functional | zero | none |
| **(b) Move module label + plan badge into the page body at ≤430px** | header keeps business name + inbox only | markup + a media query + re-capture 12 images | low–medium: header markup is shared by every ERP page, so it needs a capture pass on all four screens |
| **(c) Shorten the module label to "ERP" below 430px** | one line less wrapping | one string + a media query | low |

**My recommendation: (c) first, and (b) only if the 320px screenshot still reads badly after it.** (c)
is a one-line change with no new structure; (b) touches every ERP page and deserves its own pass.
I have deliberately not applied either, because you have already corrected this product's visual
identity once and I am not going to guess a second time.

---

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

## 5. If you sign off

Reply with one of: `Q1 b, Q2 b, Q3 c` — or "keep all as built". Then E4 closes and the follow-up
change is a small, separately reviewed pass with its own re-capture. Until then E4 stays **OPEN** and
this product is not claimed as visually approved by you.
