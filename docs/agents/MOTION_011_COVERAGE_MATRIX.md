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
