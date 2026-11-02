# Fintech motion engine — Phase 1 audit and checklist (2026-11-01)

**Branch:** `arena/903a9fec-jata-aftercall` · **PR:** #79 · **Audited head:** `1a90b53` (implementation head `9eb6b94`).
**Status:** Audit only. No new product behaviour was added in this pass. Full acceptance is NOT claimed.

## 1. Environment (database-backed testing)

| Item | Finding | Verdict |
|---|---|---|
| Prisma query engine (`binaries.prisma.sh`) | Unreachable from sandbox (HTTP 000). `prisma generate` succeeds only with a stub engine path, so no authenticated, Postgres-backed route can run. | BLOCKED |
| Playwright browser CDN (`cdn.playwright.dev`) | Unreachable. Chromium runs via `@sparticuz/chromium` from the npm registry, outside the repository. | Workaround in place |
| GitHub Actions logs and artifacts | Log and artifact downloads fail (`results-receiver` EOF). Existing CI screenshots and recordings cannot be inspected here. | BLOCKED |
| Existing disposable-database CI | Workflows exist (`Real-Chrome six-viewport capture on a disposable database`, `Motion isolated browser evidence`); their outcome on `1a90b53` is not yet confirmed. | NOT TESTED |

## 2. Existing motion architecture (inventory)

- **Design tokens:** `--jata-dur-*`, `--jata-ease-*` in `app/globals.css`. Workspace tokens are `--ws-*` (`.ws-shell`).
- **Global reduced-motion rule:** last block of `app/globals.css`; enforced by `tests/unit/motion-system.test.ts`.
- **Primitives in place:** `components/ui/Reveal.tsx` (opacity/translate, `useReducedMotion`), `components/ui/AnalyticsChart.tsx` (chart animation disabled under reduced motion), `components/storefront/MotionReveal.tsx`, `jata-motion-entry`/`jata-motion-section`, `jata-dialog-in`, `jata-chart-in`, skeletons (`jata-skeleton`, `WorkspaceSkeleton`).
- **Storefront runtime:** `lib/experience/motionRuntime.ts` (`attachStorefrontMotion`) is a bounded controller. It loads `motion/mini` only on eligible intersection, caps active reveals at 8, honours reduced motion, Save-Data, slow connections, background tabs and low-resource devices (`lib/experience/motionPolicy.ts`), and leaves readable HTML if the library fails.
- **Owner preference:** `lib/experience/renderMode.ts` (`lite` / `motion`) and `RenderModeProbe`.
- **Added in PR #79:** `app/dashboard/template.tsx` and POS `template.tsx` (route enter), POS `loading.tsx`, `.ws-rail`/`.pos-nav-link` active and press feedback, overview stagger, POS cart line entry and quantity-total pulse, keyed order-state block in `OrderStatusPanel`.

## 3. Website Studio generation paths

- Generated sites render through the shared `ExperienceSite` renderer (`components/storefront/ExperienceSite.tsx`) from a `lib/experience/document.ts` document. `document.ts` maps `theme.treatment.motion` (`none` disables family motion) to the family motion setting.
- Storefront routes that use `attachStorefrontMotion` through `BusinessPage` and `StorefrontShell`: `/b/[slug]`, `/shop`, `/item/[id]`, `/checkout`, `/book`, `/enquire`, `/ai`, `/order/[reference]`, `/booking/[id]`.
- Earlier ledger rows record 480 family observations across 20 generated families (`docs/agents/MOTION_APPLICATION_EVIDENCE_LEDGER.md`). Those were observations, not accepted visual reviews.
- **Inheritance mechanism today:** a generated site inherits motion through the shared renderer and its `data-motion-recipe` attributes, not through per-template code. A new template inherits automatically only if it renders through `ExperienceSite`. Templates outside that renderer are not covered; this has not been enumerated template by template.
- **Not verified:** whether every family in `lib/experience/templateFamilies.ts` uses the shared renderer, and whether Website Studio exposes a per-site motion setting beyond the existing Lite/Motion preference and `treatment.motion`.

## 4. Application modules (from the repository, not the roadmap)

| Module | Route(s) | Motion status on `main` + PR #79 |
|---|---|---|
| Dashboard overview | `/dashboard` | Partial: entrance, stagger, route transition |
| POS dashboard, sell, sales, reports, payments | `/dashboard/pos/[id]/*` | Partial: route transition, cart line and total pulse |
| Checkout and order confirmation | `/b/[slug]/checkout`, `/order/[ref]` | Partial: keyed waiting→paid state |
| Website Studio | `/dashboard/studio`, `/dashboard/businesses/[id]/*` | Not changed; editor not evaluated |
| AI Front Desk | `/dashboard/ai`, `components/ai/AIFrontDeskWorkspace.tsx` | Not changed (1,445 lines) |
| Autopilot | `/dashboard/autopilot/*`, `components/autopilot/AutopilotCommandCenter.tsx` | Not changed (1,201 lines) |
| Subscription | `/dashboard/subscription`, `/pricing`, `/checkout` | Not changed |
| Registration, login, onboarding | `/register`, `/login`, `/onboarding` | Not changed |
| BOS / ERP | `/dashboard/erp/[id]/*` (inbox, messaging, approvals) | Not changed |
| Admin | `/admin/*` | Out of merchant scope; not changed |
| Control | `/control` | Excluded by policy; unchanged |

## 5. Implementation checklist (remaining work, in priority order)

1. Confirm `main` CI and the PR #79 CI state on the exact head; investigate each failing check. (Blocked for logs.)
2. Enumerate all Studio template families and classify each as `ExperienceSite` (inherits) or other (gap). Record in a test-backed inventory.
3. Add a per-site motion setting only if the existing `treatment.motion` and Lite/Motion controls are insufficient; no migration without approval.
4. Integrate shared primitives into AI Front Desk, Autopilot approvals, subscription activation and onboarding progress, using server-authoritative states only.
5. Establish the authenticated, disposable-database browser run (blocked: Prisma engine). Required for before/after evidence on every authenticated route.
6. Capture six-viewport before/after evidence and reduced-motion/keyboard evidence from real routes. Required by the directive; blocked until step 5.
7. Update the acceptance matrix with per-row verdicts. Do not promote any row without observed evidence.

## 6. Blocker summary

- **Primary:** No Prisma engine egress, so the authenticated, database-backed environment cannot run here. Blocks steps 4 (live verification), 5 and 6.
- **Secondary:** CI logs and artifacts are not downloadable. Blocks independent review of existing CI evidence.
- **Owner decision needed:** whether to allow `binaries.prisma.sh` for the sandbox, supply a pre-downloaded engine, or accept CI-artifact evidence. Approval is also needed for any new per-site motion setting that touches configuration.
