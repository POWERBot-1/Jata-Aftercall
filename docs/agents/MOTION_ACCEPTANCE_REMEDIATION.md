# Motion acceptance remediation — status and evidence

**MOTION ACCEPTANCE BLOCKED — DO NOT MERGE OR DEPLOY.** Starting PR head: `e7228e18d11aad5c130ddcdc1065f8c13b6639a4`.

| Acceptance area | Status | Direct evidence or exact remaining work |
|---|---|---|
| Queue stress, eight concurrent reveals, drain/re-entry | NOT TESTED | Isolated controller doubles exercise the limit, but they are not real application browser stress. Generate enough real sections and exercise simultaneous visibility and real interactions, with recorded start/finish events and exit/re-entry. |
| Cancellation, races and unmount | IN PROGRESS | The targeted Chrome check in this revision requests a live reduced-motion preference during a real preview animation, requires an actually running animation and checks disconnect/idle. Result is pending CI and does not cover pending import race, navigation or unmount. |
| Historical baseline visual preservation | BLOCKED | No same-fixture, six-viewport browser captures and recordings of the historical pre-motion application have been produced; owner-lite versus reduced-motion at a single candidate is not a historical baseline. Create a compatible isolated historical-build setup, compare and independently inspect. |
| Interactions across routes | NOT TESTED | [Earlier isolated route captures](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41230481396/artifacts/13053672197) are observations, not full interaction acceptance. Exercise keyboard, focus, forms, repeated navigation and business state without live transactions. |
| Published AI with motion enabled | NOT TESTED | Preview is captured; no real entitled AI publication fixture with compatible Studio settings has been demonstrated. Configure fictional readiness and entitlement on a disposable database and use real publication API; do not treat provider-free fixture as payment proof. |
| Complete commerce paths | NOT TESTED | Storefront, shop, item and checkout snapshots exist, not complete booking, enquiry, order/booking status and permitted interactions. Provision actual feature-compatible fictional fixtures through authorized application paths. |
| Independent visual inspection | BLOCKED | GitHub artifacts redirect to `productionresultssa*.blob.core.windows.net`, which is not permitted outbound from this workspace; `gh run download` for the exact starting-head route artifact returned EOF. One seeded 320×568 classic screenshot was reconstructed from GitHub check annotations in prior work, not all required screenshots or recordings. Obtain them through a permitted viewer or safe evidence channel and independently inspect; do not promote acceptance on the annotation alone. |
| Programme completeness | BLOCKED | The existing 39 records remain NOT_TESTED. Their individual acceptance work is listed in `REQUIREMENT_WORK_ASSIGNMENTS.md`. The 40th entry records this directive and is also NOT_TESTED. Passing the checker tests does not mean that programme acceptance is complete. |

Previous real-browser 20-family observations at `52db11589135a427ff5de1092559108491719bbf` are preserved in [run 41226990709](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41226990709); they are not a replacement for these acceptance areas. No production settings, payments, messages or publication are touched by these tests.

## MOTION-017 continuation from `b8442d1bd269fc6c4ee608ed6dd285126d2e0989`

- The [exact-starting-head Chrome run 41232051972](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41232051972) exercised a real draft preview at 390×844 with an active reveal: 4 animations started and were running, preference changed to reduced, then 0 were running, 4 cancel events and 1 observer disconnect were observed. Expected: reduced mode and no running animations; actual: reason `reduced-motion`, no running animations. This is one targeted check, not lifecycle or queue acceptance. The real-document repeated preference-transition extension is pending execution at the next head; it does not simulate re-entry or prove cleanup of every resource.
- The exact-starting-head 320×568 fictional classic image was independently viewed from annotation chunks; it shows the disclaimer, restaurant hero, fictional offer and contact bar. It is not a before/after comparison. Full artifacts including recordings could not be downloaded: the route artifact redirects to `productionresultssa10.blob.core.windows.net`, and the connection returned EOF. Other images/recordings were not independently reviewed.
- `a28c1a46101ac90bbf28d374b4986b689196de8d` is the parent of the first `motionRuntime.ts` commit, `4e60099`; it is a real historical source revision, not a historical screenshot. No compatible identical-fixture before/after screenshots or recordings have been created or inspected. Visual preservation remains BLOCKED.
- Route inventory includes `/b/[slug]` and its `shop`, `item/[id]`, `checkout`, `book`, `booking/[id]`, `enquire`, `order/[reference]` and `ai` routes; `/checkout`, its callback and mock route; `/store/order/[token]`; dashboard subscription, AI, business orders/bookings/items and POS routes; and admin payment/subscription routes. This inventory does not prove their interactions or state transitions. Published AI and complete commerce acceptance remain NOT TESTED.
- All prior requirement statuses and assignments are retained; `MOTION-017` is NOT_TESTED. The 41-record gate must remain failing until independently verified evidence exists. No worker parallelism was available in this session.

## MOTION-018 continuation from `4e0cc0e0d5fd8f9623c798233dd92cf3ec4e004a`

At the starting head [Chrome run 41233757079](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41233757079) reported PASS for targeted 390×844 preview reduced-motion cancellation (4 started and running, 4 cancellation events, 0 running afterward, 1 disconnect) and three subsequent preference cycles, all with 0 running. The latter does not demonstrate active re-entry, queue drain or lifecycle cleanup. One exact-starting-head fictional classic 320×568 screenshot was independently viewed from check-annotation chunks; 360×800 had only 2/11 chunks. The routes artifact `13054442821` redirected to `productionresultssa14.blob.core.windows.net` and returned EOF. No other image or recording was reviewed; it is not a historical comparison.

Native Prisma investigation and reproduction: see `docs/agents/LOCAL_TEST_ENVIRONMENT.md`. The earlier full local `npm test` had 297 passed / 29 failed / 22 skipped files and 3,495 passed / 1 failed / 206 skipped tests; an observed failure was missing `.prisma/client/default` after `npm ci --ignore-scripts`. Explicit generation failed when the official engine host could not be reached. Do not assume every failure was caused by the missing client. A preflight and separate exact-head CI full no-database suite were added; CI results are pending and DB-backed acceptance is not implied. All 41 prior statuses remain NOT_TESTED; MOTION-018 is NOT_TESTED. Queue, cleanup, baseline comparison, cross-route, published AI, commerce and full independent review remain open as above. Per-requirement direct evidence and ownership remain incomplete.


## Exact-head evidence refresh — 2026-11-20 (PR #126)

Candidate feature head: `07878f357830c599938939dce0e301727e54fcbb`; workflow: [Motion isolated browser evidence run 44748472374](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/44748472374). This run completed successfully and produced the following bounded evidence:

- Historical source revision `a28c1a46101ac90bbf28d374b4986b689196de8d`: **12** legacy storefront viewport/motion states captured in a disposable PostgreSQL 16 / Chrome 157 environment. This is a historical capture baseline, not a full 20-family or commerce baseline.
- Candidate after-capture: **480/480** family observations, zero capture failures, across 20 supported families × six viewport sizes × normal/reduced preferences.
- Real reduced-motion cancellation: **PASS** — four running animations cancelled, zero remained active, one observer disconnect, four cancellation events.
- Repeated preference transitions: **PASS** — six normal/reduced transitions settled in reduced mode with zero active animations.
- Eight-slot queue stress: **PASS** — 17 targets, eight concurrent animations maximum, nine queued initially, all 17 completed, maximum concurrency remained eight.
- Route/state matrix: **42 rows**, zero reported assertion errors; 30 normal-motion route rows and 12 lite/reduced-motion rows; 12 AI rows passed their initial constraints.
- A separate route/recording summary reported **48/48 observations**, zero observed failures and zero capture errors.

**Evidence limitations remain explicit.** The runner logged `MOTION_ENCODER_BLOCKED`: ffmpeg was unavailable and could not be installed within the deadline, and the workflow explicitly said no encoded recording evidence was claimed for that head. Artifact files are uploaded, but their images/recordings have not been independently inspected in this review environment. The baseline is only 12 legacy storefront states and is not a matched before/after comparison across all 20 families, routes, commerce states and viewports. A logged AnalyticsEvent fixture foreign-key error also occurred during the browser run; it did not appear in the workflow's reported assertion failures, but should be investigated before treating analytics behavior as accepted.

Artifacts (not independently inspected here):
- [Historical baseline artifact](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/44748472374/artifacts/14633129939)
- [Candidate family captures](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/44748472374/artifacts/14634019399)
- [Candidate route evidence](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/44748472374/artifacts/14634284157)
- [Partial capture package](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/44748472374/artifacts/14635275675)

**Disposition:** the isolated cancellation, repeated-preference, queue-capacity, 20-family capture and bounded route observations have exact-head PASS evidence. The overall motion acceptance remains **BLOCKED** pending encoded before/after recordings, matched historical comparisons, complete generated/published AI and commerce journeys, lifecycle/re-entry/cleanup coverage, and independent visual inspection of all required artifacts. No programme status is promoted by these partial results.


## Follow-up exact-head review — 2026-11-20, head `165ef68c2dda52f2d266445690e712b75623f5ec`

[Motion isolated browser evidence run 44749405477](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/44749405477) completed successfully on this feature head. It reproduced the 480/480 candidate observations, 42-row route/state matrix with zero assertion errors, real reduced-motion cancellation, six repeated preference transitions, eight-slot queue stress (17 targets, 8 active maximum, 9 initially queued, all 17 completed), and 48/48 route/state observations. The historical capture job again produced 12 legacy storefront viewport/motion states from the owner-named pre-motion revision.

I also inspected the six JPEG previews emitted directly into the exact-head CI job log. The visible sample showed rendered storefront/route content and action areas; I did not see an obvious clipped primary heading or horizontal overflow in those six samples. This is **sample-only visual review**: the six previews are not the full 480-image matrix and do not establish every viewport, family, route or state as visually accepted.

The runner again emitted `MOTION_ENCODER_BLOCKED`: ffmpeg was unavailable, and the workflow explicitly states that no encoded recording evidence is claimed for this head. The later 48/48 observation summary is not treated as a substitute for those required recordings. Uploaded full artifacts remain available from the run but have not been exhaustively inspected here.

**Updated disposition:** exact-head PASS for the bounded browser assertions and sample preview review; overall motion acceptance remains **BLOCKED** for encoded before/after recordings, same-fixture historical comparison across all families/routes/states, complete published AI and commerce interactions, lifecycle/re-entry/cleanup acceptance, and exhaustive independent visual inspection. No broad motion acceptance status is promoted.
