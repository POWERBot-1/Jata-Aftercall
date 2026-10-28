# POS / ERP - PRO — visual review of the working screens

This is the human-review record behind blocker **E4**. It is deliberately separate from the automated
capture so the two cannot be confused: the script produces images and measurements, this document
records what a person saw in them, and what was done about it.

**What was reviewed.** The four screens a person actually works in during a procurement cycle:
the workspace home, the task board, requisitions and procurement.

**How the images were produced.** Real Chromium (HeadlessChrome 131.0.6778.0) against the production
build (`next start`) over real HTTP with real session cookies, on a disposable PostgreSQL database
seeded with fictional rows. Six owner-mandated viewports: 320×568, 360×800, 390×844, 430×932,
768×1024, 1366×768. Full-page JPEGs plus `evidence.json` and `summary.log` in
`.cache/verification/erp-visual/` (git-ignored; regenerate with `npm run test:erp:visual`).
**24 of 24 captures passed** their automated checks: HTTP 200, expected heading present, and
`scrollWidth − clientWidth = 0` at every viewport.

**Who reviewed.** The reviewing agent, not the owner and not a designer. That distinction matters and
is stated plainly: this closes the "has anybody actually looked at these screens" question, it does
**not** close the question of whether the owner likes them.

## Findings

| # | Finding | Viewports | Severity | Status |
| --- | --- | --- | --- | --- |
| V1 | **Duplicate sentence on the task board.** With no completed work, "Finished work stays here as evidence of who did what and when" printed twice in a row — once as the section sub-heading and again in the empty-state paragraph directly beneath it. | 768×1024, 1366×768 | Low (copy) | **Fixed.** The empty-state paragraph is now just "Nothing has been completed yet." A unit assertion counts the phrase so it cannot silently return (`tests/unit/erp-tasks-page.test.ts`). |
| V2 | **No horizontal overflow anywhere.** 0px at 320, 360, 390, 430, 768 and 1366 on all four screens, including the long requisition line list, the three-line purchase order and the twelve step setup checklist. | all | — | Pass, measured |
| V3 | **Requisitions is reachable and active.** The sidebar shows it under "Run the business" with the active state highlighted, next to Procurement. Before this pass it had no navigation entry at all — a product defect found by the page check, not by eye (see E14 / the navigation test). | 1366, 768 | Was High (unreachable) | **Fixed** in `lib/erp/navigation.ts` + `lib/erp/industryPacks.ts` |
| V4 | **Mobile bottom bar overlays the final content in a capture.** In a *full-page* screenshot the fixed bar is painted at its viewport position, which reads as "a nav strip in the middle of the page". It is a capture artifact of `position: fixed`, not a layout bug: in viewport screenshots the bar sits correctly at the bottom, and `padding-bottom: 92–96px` on `.erp-content` keeps the last card clear of it. | 320–768 | None | Explained, no change |
| V5 | **The ≤900px layout is the phone layout, including 768px tablets.** At 768×1024 the sidebar is replaced by the bottom bar. This is the stylesheet's deliberate breakpoint (`.erp-layout { grid-template-columns: 1fr }` under `max-width: 900px`), and it is coherent, but it means a 768px tablet gets a hamburger-and-bottom-bar experience rather than a two-column one. | 768 | Design call, not a defect | **Recorded for the owner** — see the open question below |
| V6 | **Each KPI is a full-width card on phones.** `.erp-grid-3` collapses to one column under 900px, so Drafts / Waiting decision / Approved stack as three tall cards. Legible and tappable, but it pushes real content well below the fold on a 320px screen. | 320, 360, 390, 430 | Design call | **Recorded for the owner** — see below |
| V7 | **The identity block is crowded on phones.** On a 320px screen the "POS / ERP - PRO / plan / inbox / New campaign / Business POS" cluster wraps into several rows above the page title, and the business name wraps to one word per line ("VISUAL / CHECK / 01DE…"). Nothing overlaps or clips, and the page title stays first in the reading order after it, but it is the weakest area visually. | 320, 360, 390 | Medium (visual hierarchy) | **Recorded** — not changed in this pass, because it is a design decision the owner has already corrected once (espresso/cream/amber). Changing it unilaterally would repeat that mistake. |
| V8 | **Money and status are unambiguous.** Every amount carries its currency, statuses are words ("Waiting for a decision", "In progress", "Ordered") not colours alone, and the requisitions footer states who may approve and that a requester cannot approve their own request. | all | — | Pass |

## What this does and does not close

* **Closes:** "has any human looked at these screens at the required viewports, with images and
  recorded findings, and were the defects found actually fixed?" — yes, with V1 fixed and V3 fixed.
* **Does not close:** aesthetic sign-off, brand approval, or the two design questions below. Those
  need the owner, not another automated pass.

## Open questions for the owner (no defaults invented)

1. **Tablet layout at 768–900px.** Options: (a) keep the current phone layout for the whole range;
   (b) move the single-column breakpoint to 700px so 768px tablets keep the sidebar; (c) keep the
   phone layout but show the sidebar as a drawer at tablet widths. Current behaviour is (a).
2. **KPI cards below 900px.** Options: (a) current stacked full-width cards; (b) two columns at
   360px and wider, so three figures take two rows instead of three cards; (c) a single compact row
   of three numbers with no card chrome. Current behaviour is (a).

Neither question changes any measured result above, and neither blocks the release assessment —
they are visual decisions, recorded as such.
