# Mobile hero/action-bar remediation — v4 — 2026-11-22

## Evidence that triggered this correction

Motion isolated browser run `45035333185`, candidate SHA `e661df2255c4e61678e855a29d700c5f5a8d2d71`, generated 480 observations across the 20 Studio families, six viewports and normal/reduced-motion modes.

- 475/480 observations were recorded as OBSERVED.
- Five observations failed, all at 320×568.
- The affected generated families were Spatial (normal and reduced), Service Journey (reduced), and Experimental (normal and reduced).
- In each failure the fixed action bar began at y=399.8px and the hero CTA row ended at y=405.8px: approximately 6px of intersection.
- Hero heading geometry did not intersect the action bar; horizontal overflow was zero.
- Independent screenshot inspection confirmed the fixed action bar visibly covers the hero CTA row.

## Correction

For storefronts with a fixed action bar at widths up to 360px, increase bottom clearance on both standard hero content and split-hero grid from the prior action-bar height + safe-area + 2rem to +4rem. This gives an additional 32px of reserved clearance and is expected to move the centered hero content up enough to clear the 6px measured overlap. No desktop or wider-phone rule is changed.

A focused CSS contract test asserts both selectors and the new spacing declaration. The full real-Chrome generated-family matrix remains the acceptance test.

## Verification

- Exact-head CI pending.
- No visual acceptance claimed until the 480-observation rerun reports zero intersections and no horizontal overflow, and screenshots are independently inspected.
- No Studio family was published to a customer business; browser fixtures use the disposable database.
- No production deployment, merge or database mutation was performed.
