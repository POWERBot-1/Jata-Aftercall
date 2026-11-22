# Website Studio and motion evidence review

Review status: **PARTIAL — findings recorded; full image/video review is not complete.**

## Evidence provenance

The inspected capture set was produced from candidate SHA `4cd6dd59b41a8f25e44820bf691a1394685bebc9`.

- Motion browser evidence workflow: [run 44167665424](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/44167665424)
- Website Studio authenticated acceptance: [run 44167665678](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/44167665678)
- Premium responsive screenshots: [run 44167665510](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/44167665510)
- Control denied-route screenshots: [run 44167665376](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/44167665376)

Downloaded artifacts reviewed:
- Motion baseline: `14366765984`
- 20-family capture matrix: `14366338059`
- Route screenshots: `14367505411`
- Route recordings: `14367496482`
- Control denied screenshots: `14365808994`
- Premium screenshots: `14366926671`

## Capture coverage verified from the manifests

1. The generated-family artifact contains 480 observations: 20 supported families × 6 viewport sizes × draft/published states × normal/reduced-motion preferences. All 480 rows were observed, and the recorded horizontal overflow value was zero.
2. The historical default storefront baseline contains 12 observations: 6 viewport sizes × normal/reduced-motion. The manifest records no page errors and zero horizontal overflow. This baseline is from the owner-named historical revision, not a same-head before/after capture.
3. The route-recording artifact contains 48 WebM recordings across four route states (classic, AI preview, AI denied, missing), six viewport sizes and normal/reduced-motion preferences.
4. The authenticated Website Studio acceptance run reports 530 passing assertions, including generation, draft/preview/publish behavior, six business verticals, synthetic tenant isolation and payment/order guard cases.
5. The Control denied-route artifact contains six viewport screenshots. It demonstrates the explicit all-DENY state; it does not demonstrate an authorized Control journey.

## Independent visual review findings

The following representative mobile and desktop captures, plus selected full-resolution frames, were visually inspected:

- **Cinematic template:** the primary hero action could render as a blank button. A shared CTA-label helper now trims generated/profile labels and supplies a category-aware fallback. A unit test and a generated-family browser assertion were added to prevent recurrence.
- **AI Front Desk preview:** the “Conversation” heading and “Answers from saved business data” label overlapped at a 390px viewport. The header now stacks on narrow screens and returns to a row layout at the small-screen breakpoint; a regression test was added.
- **Classic public storefront:** a fixed bottom action bar appears over content in a full-page recording frame. The component also renders a dedicated action-bar spacer; this capture alone does not establish a user-visible end-of-scroll obstruction, so no CSS change was made on this evidence.
- **Control:** the denied state is legible in the inspected contact sheet. No authorized route is available under the approved all-DENY policy.

## Remaining visual and motion acceptance

- The 480-image matrix has not been inspected image-by-image at full resolution. Contact sheets and representative full-resolution images were reviewed; that is not equivalent to the required exhaustive independent review.
- The 48 WebM recordings have not all been manually inspected. The capture manifest itself records manual inspection as not performed; only representative frames were reviewed.
- The 20-family and 48-recording artifacts predate the CTA and AI header corrections. The latest candidate must regenerate these artifacts and pass the new CTA assertion before the corrections can be accepted.
- The 48 recordings are route-state recordings, not a matched before/after recording pair for every family and application surface.
- Published AI Front Desk and complete commerce route coverage remain incomplete.
- Queue saturation, ordering, cancellation, visibility exit/re-entry and repeated-navigation cleanup require exact-head browser evidence. A dev-only 18-target queue fixture and browser test have been added; their result is pending.
- A previous-build Lite/reduced-motion comparison and the full owner-defined motion specification remain part of the outstanding acceptance.

## Disposition

This document records partial independent review and concrete corrections. It does **not** close ADMIN-015 or the broader MOTION requirements. Do not merge or deploy on the basis of these historical artifacts. The latest exact-head CI, regenerated screenshots/recordings, complete visual review and remaining programme gates must pass first.
