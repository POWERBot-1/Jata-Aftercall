# MOTION-011 exact-head evidence addendum — 2026-11-22

## Disposition

**PARTIAL EVIDENCE PASS — canonical MOTION-011 remains BLOCKED.**

This addendum records exact-head disposable CI evidence. It does not promote the canonical requirement to PASS, because independent visual review, complete route/state acceptance and the wider programme gate remain outstanding.

## Exact candidate and workflow

- Repository: `POWERBot-1/Jata-Aftercall`
- Candidate SHA: `b5706a1dbc3c3daa721d4c083b3818b875d06c2f`
- Pull request: #154 (draft; the evidence run is attached to this exact head)
- Workflow: Motion isolated browser evidence, run `45042578553`
- Browser: Chrome `157.0.8103.78`
- Capture job: `137270079460`
- Historical baseline job: `137270079263`
- Route evidence artifact: `14762253885`
- Generated-family evidence artifact: `14762941539`
- Historical baseline artifact: `14762048786`
- Partial evidence artifact: `14762054229`

Both jobs completed successfully. The artifacts are retained by GitHub and were downloaded and inspected during this phase.

## Authorized AI Front Desk journey

The route harness created a synthetic, disposable AI subscription and entitlement for `marys-beauty-studio`. The payment row was synthetic and local to the isolated PostgreSQL fixture. No Paystack/provider request or real payment was performed.

- Fixture publication/entitlement setup: PASS.
- Fixture restoration of the original Studio subscription: PASS.
- Customer-facing `/b/marys-beauty-studio/ai`: 6/6 viewport observations returned HTTP 200 with one motion probe, `renderMode=motion`, `reason=eligible`.
- OS reduced-motion: 6/6 viewport observations returned HTTP 200 with one motion probe, `renderMode=lite`, `reason=reduced-motion`.
- Viewports: 320×568, 360×800, 390×844, 430×932, 768×1024, 1366×768.

This closes the narrower evidence gap for a real authenticated, synthetic, published-and-entitled AI renderer journey on this candidate. It does not establish production entitlement or provider settlement.

## Unavailable/denied AI route semantics

The earlier 2026-11-17 artifact at SHA `358afc0f52e6a7a6bd24c7bf5ed53a3610f6cf69` recorded:
- Authorized owner preview `/b/nyumbani-kitchen/ai?preview=true`: 12/12 HTTP 200 observations (six viewports, normal/reduced preferences).
- Unentitled customer route `/b/nyumbani-kitchen/ai`: 12/12 HTTP 404 observations.

Source inspection of `app/b/[slug]/ai/page.tsx` confirms that non-operational, unpublished or unentitled public desks intentionally call `notFound()`. The 404 is the expected fail-closed customer fallback, not a missing route defect. A 404 does not prove the authorized LIVE journey; the separate synthetic LIVE journey above supplies that narrower evidence.

## Generated-family and motion evidence

The exact-head generated-family artifact contains 480 observations:
- 20 supported template families.
- Six viewports: 320×568, 360×800, 390×844, 430×932, 768×1024 and 1366×768.
- Draft and published states.
- Normal and reduced-motion preferences.
- 480/480 HTTP 200 observations.
- Zero horizontal overflow observations.
- Zero measured hero-text/action-bar intersections.
- Zero measured hero-CTA/action-bar intersections.
- One motion probe in each observation.
- All 480 observations are labelled `OBSERVED`, not independently reviewed visual PASS.

The route evidence artifact also records:
- Reduced-motion cancellation: PASS (2 running animations before, 0 after; observer disconnect and cancellation events recorded).
- Repeated preference transitions: PASS (six transitions).
- Eight-slot queue stress: PASS (17 targets; 8 started initially and 9 queued; maximum 8 active; all 17 completed).
- Visibility exit/re-entry recovery: PASS (hidden state cancels active motion; visible state resumes and completes remaining targets).
- Route-navigation observer cleanup: PASS (three route states, one active observer retained, prior observer disconnected).

## Historical comparison and remaining limitations

The historical baseline job completed successfully and produced 12 captures across six viewports and normal/reduced preferences for the legacy default published storefront. This is not a matched historical baseline for all 20 families, all commerce routes or the AI renderer.

Still outstanding:
- Independent image-by-image and video review of the complete 480-capture family matrix and route artifacts.
- Matched historical/current comparisons for identical routes, fixtures, families and states.
- Full published/preview/fallback/commerce route matrix, including all relevant AI states.
- Additional keyboard, focus, lifecycle and accessibility acceptance required by the complete owner specification.
- Canonical programme acceptance; the exact-head programme-completeness check still fails.

## Safety and authority

All evidence was generated in isolated CI with fictional data and disposable PostgreSQL. The synthetic AI payment was not a live charge. No production database, entitlement, customer record, payment, provider, secret, DNS, environment, merge or deployment was changed.

**Status rule:** retain MOTION-011 and RELEASE-001 as BLOCKED until the remaining canonical criteria and independent acceptance are satisfied. Do not alter the readiness checker or waive the programme gate.
