# MOTION-011 coverage matrix — 2026-10-31

**MOTION ACCEPTANCE BLOCKED — DO NOT MERGE OR DEPLOY.** This is an inventory, not proof. A row must not be marked PASS from a generic CI screenshot, SSR fixture, interception-only page, or source inspection. Each applicable route/family/publishing combination needs real application generation/persistence/rendering and browser evidence. No before/after recordings or independent six-viewport inspections have been produced for this task.

## Families

Each family requires generated draft preview and published render, motion and disabled/reduced-motion, all six viewports, interaction/queue checks and before/after recordings. Minimal intentionally uses motion none. Spatial, interactive-showroom and cardless-immersive also need their actual HTML/immersive fallback checked.

| Family | SSR fixture | Required real browser acceptance |
|---|---|---|
| cinematic | PASS (synthetic) | NOT TESTED |
| editorial | PASS (synthetic) | NOT TESTED |
| luxury | PASS (synthetic) | NOT TESTED |
| minimal | PASS (synthetic) | NOT TESTED |
| magazine | PASS (synthetic) | NOT TESTED |
| marketplace | PASS (synthetic) | NOT TESTED |
| product-first | PASS (synthetic) | NOT TESTED |
| storytelling | PASS (synthetic) | NOT TESTED |
| spatial | PASS (synthetic) | NOT TESTED |
| interactive-showroom | PASS (synthetic) | NOT TESTED |
| gallery | PASS (synthetic) | NOT TESTED |
| split-screen | PASS (synthetic) | NOT TESTED |
| fullscreen-media | PASS (synthetic) | NOT TESTED |
| scrollytelling | PASS (synthetic) | NOT TESTED |
| cardless-immersive | PASS (synthetic) | NOT TESTED |
| map-driven | PASS (synthetic) | NOT TESTED |
| catalog | PASS (synthetic) | NOT TESTED |
| portfolio | PASS (synthetic) | NOT TESTED |
| service-journey | PASS (synthetic) | NOT TESTED |
| experimental | PASS (synthetic) | NOT TESTED |

## Routes and publication states

| Actual route/path | Required browser evidence |
|---|---|
| `/b/[slug] — published Studio` | NOT TESTED |
| `/b/[slug]?preview=draft — authorized draft Studio` | NOT TESTED |
| `/b/[slug] — classic fallback` | NOT TESTED |
| `/b/[slug]/shop` | NOT TESTED |
| `/b/[slug]/item/[id]` | NOT TESTED |
| `/b/[slug]/checkout` | NOT TESTED |
| `/b/[slug]/book` | NOT TESTED |
| `/b/[slug]/booking/[id]` | NOT TESTED |
| `/b/[slug]/enquire` | NOT TESTED |
| `/b/[slug]/order/[reference]` | NOT TESTED |
| `/b/[slug]/ai — published entitled` | NOT TESTED |
| `/b/[slug]/ai?preview=true — authorized preview` | NOT TESTED |
| `/b/[slug]/ai — unavailable/denied (404 or redirect)` | NOT TESTED |
| `/b/[slug] — unavailable/not-found fallback` | NOT TESTED |

The list includes feature-gated routes: a 404 can be correct for an unsupported or inaccessible feature, but is not proof of its successful authorized state. Check navigation, pricing, focus, status and access without fabricating order/payment/AI outcomes. Not-found has no business theme or controller; verify its readable static fallback, not a false controller requirement.

## Per-row evidence required

- Actual generated document and authorized preview/publish path on a disposable database; include route, tenant and version identifiers without sensitive data.
- Real-browser SSR/no-JS and hydration; one controller, initialization state and safe fallback; eligible animation, maximum eight concurrent reveals, queue exit/re-entry, focus cancellation, teardown, owner Lite/none and OS reduced motion.
- Before/after interaction recordings and independently inspected screenshots at 320×568, 360×800, 390×844, 430×932, 768×1024 and 1366×768. Compare disabled motion to the baseline for layout, typography, colours, content, branding, dimensions and interactions.
- Local environment check: no Chromium/Chrome binary or local PostgreSQL server/client found. Native Prisma engine download failed previously due TLS. No real browser runs for these rows were completed in this work session. Existing CI visual captures cover other journeys and do not satisfy this matrix. A disposable CI browser/DB is available for existing workflows, but an actual comprehensive generation-and-recording harness and independent review remain to be built/executed.

## Completeness gate investigation

The `programme-completeness` job runs `scripts/admin/check-programme-readiness.mjs`; it correctly fails because every listed requirement in `docs/agents/PROGRAMME_READINESS.json` is NOT_TESTED and lacks recorded acceptance/evidence. The checker and its negative tests pass. The job cannot truthfully pass until the broader programme's requirements have actual evidence and independent acceptance. No status was promoted, no history modified, and no gate was bypassed. This is an unmet acceptance condition, not a checker malfunction.


## Exact-head evidence update — 2026-11-22

The earlier local-environment note above is historical and is superseded for the candidate listed here. Disposable CI now supplies exact-head Chrome/PostgreSQL evidence; it does not change the remaining independent-review requirements.

- Candidate: `b5706a1dbc3c3daa721d4c083b3818b875d06c2f`
- Motion isolated browser workflow: run `45042578553`
- Route artifact: `14762253885`; generated-family artifact: `14762941539`; historical baseline artifact: `14762048786`.
- A synthetic, disposable, published-and-entitled AI Front Desk route was exercised on six viewports in normal and OS reduced-motion modes: 12/12 HTTP 200; one motion probe per capture; normal mode `motion/eligible`, reduced mode `lite/reduced-motion`.
- The unentitled customer-facing AI route's HTTP 404 is intentional: `app/b/[slug]/ai/page.tsx` calls `notFound()` when the server-derived publication is not publicly operational. The earlier artifact's 12/12 404 observations are therefore expected fail-closed fallback behavior, not a missing-route defect. Authorized preview is separately observed at 12/12 HTTP 200 in that earlier run.
- The exact-head family artifact contains 480 observations across 20 families, six viewports, draft/published and normal/reduced states. All returned HTTP 200; measured horizontal overflow, hero-text/action-bar intersection and hero-CTA/action-bar intersection were each zero. The harness labels these rows `OBSERVED`; they are not a substitute for independent visual PASS.
- Route lifecycle evidence: reduced-motion cancellation, six preference transitions, eight-slot queue saturation/recovery, visibility exit/re-entry and route observer cleanup all report PASS. Queue stress used 17 targets, 8 initial active slots, 9 queued, maximum 8 active and all 17 completed.
- Historical baseline job completed and produced 12 legacy storefront captures; it is not a matched baseline for all 20 families, commerce routes or AI renderer states.

Full details and limitations: `docs/evidence/MOTION_011_EXACT_HEAD_EVIDENCE_2026-11-22.md`.

**Canonical MOTION-011 remains BLOCKED.** Independent review of the complete images/videos, matched historical/current comparisons, complete route/state coverage and broader owner-specification acceptance remain outstanding. No readiness status is promoted by this evidence update.
