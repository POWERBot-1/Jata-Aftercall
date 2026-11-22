# Website Studio pipeline and inheritance inventory — 2026-11-22

**Assessment type:** source inspection only. **MOTION-003 acceptance: PARTIAL / NOT COMPLETE.** No browser, database, visual, accessibility, performance, or production test was run for this inventory. It does not authorize publication or release.

**Inspected candidate:** `720ef87f8e309a166bbde739323503d76cb559a0` (PR #139 head).

## 1. Generation and editor path

The prompt-first Studio surface is `components/studio/openpage/WebsiteStudio.tsx`:

1. `POST /api/studio/openpage/understand` — authenticated session, tenant-scoped read guard, server-loaded business facts, deterministic requirements, and optional design-brief interpretation. Response is explicitly `saved: false`.
2. `POST /api/studio/openpage/generate` — authenticated session and tenant-scoped read guard; loads server-owned generation context; parses supported goal/personality/audience/density overrides; produces up to three candidates through `lib/openpage/generate.ts`; returns candidates for preview. Route comments and response explicitly state no draft, published snapshot, or business row is written.
3. `StudioPreview` renders each candidate using the existing `components/storefront/ExperienceSite`, with `trackViews={false}`. This avoids a second storefront renderer and avoids recording customer page views for owner previews.
4. `applyCandidate` moves the selected candidate into the local editor state. It does not itself save or publish.
5. `saveDraft` sends `PATCH /api/experience` with `expectedDraftVersion`. The API is authenticated, tenant-scoped, schema-validated and uses optimistic concurrency; a stale version is rejected rather than overwritten.
6. `PublishPanel` calls `POST /api/experience/publish`. The server rechecks entitlement, readiness, ownership and the exact draft version. Publication remains separate from generation and draft saving.

The integrated OpenPage flow therefore has three separate trust boundaries: preview-only generation, versioned draft persistence, and separately authorized publication.

## 2. Other Studio persistence surface

A second, per-website API surface exists under `app/api/studio/websites/**`:

- `GET/PUT /api/studio/websites/content` reads and saves a website's draft/published documents and revision metadata. PUT checks website edit access, validates the Experience document and records a versioned draft revision.
- `POST /api/studio/websites/publish` and rollback routes use per-website publication access and expected draft/published versions.

This is not the same client persistence path as the prompt-first OpenPage component, which saves through `/api/experience` and publishes through `/api/experience/publish`. Before changing shared inheritance or consolidating APIs, map which dashboard entry points still call each surface and preserve compatibility. Do not assume these routes are interchangeable.

## 3. Shared renderer and family inheritance

- `lib/experience/templateFamilies.ts` registers 20 families: cinematic, editorial, luxury, minimal, magazine, marketplace, product-first, storytelling, spatial, interactive-showroom, gallery, split-screen, fullscreen-media, scrollytelling, cardless-immersive, map-driven, catalog, portfolio, service-journey, experimental.
- `lib/experience/artDirector.ts` ranks and builds a deterministic art-directed Experience document using the registered family definitions and server-owned business signals. This is source logic, not proof that all 20 families work in real browsers.
- `components/storefront/ExperienceSite.tsx` resolves the family from the document and composes the hero, sections, family composition and commerce-aware storefront content.
- `components/storefront/StorefrontShell.tsx` supplies shared navigation, cart context, action bar and footer. It mounts `RenderModeProbe`.
- `RenderModeProbe` calls `attachStorefrontMotion` from `lib/experience/motionRuntime.ts`. The runtime scopes its observer to the storefront, loads `motion/mini` lazily, and applies render preference and OS/network/visibility safeguards.

The homepage preview uses the same ExperienceSite component, but this is not equivalent to proving published and draft routes, all template families, or commerce and booking journeys in a browser.

## 4. Public routes and inheritance boundary

The public home route is `app/b/[slug]/page.tsx`. It selects an authorized draft only for an eligible signed-in owner/member preview; public visitors receive the published document. The storefront loader resolves publication state and tenant-owned business/catalogue data.

Additional paths include:

- `/b/[slug]/shop`
- `/b/[slug]/checkout`
- `/b/[slug]/book`
- item, booking, enquiry and order-reference routes under `app/b/[slug]/**`

These routes use `StorefrontShell` and category-aware business data. They are separate page implementations and must each be tested for interaction, transaction state, keyboard/touch behavior and reduced-motion behavior. A shared shell alone does not prove that every child interaction has the required motion or state feedback.

## 5. Safe inheritance architecture — recommendation

1. Keep one shared Experience document schema, family registry and public renderer. Do not create copied template runtimes.
2. Keep motion preference resolution centralized: site-level preference may reduce motion, but must never override OS `prefers-reduced-motion`; explicit Lite/none modes remain no-motion.
3. Keep motion enhancement progressive: SSR content and all controls must work without the motion chunk, observer, or JavaScript.
4. Scope controllers to one storefront root; ensure observers/listeners/animations are disposed on unmount and route changes; enforce bounded concurrency and cancel queued work when targets leave view.
5. Keep business facts, prices, stock, availability, payment status and booking outcomes sourced from authoritative server data. Animation must not imply a transaction succeeded before the server confirms it.
6. Treat existing-site inheritance as a runtime update only where the site already uses the shared renderer. Do not assume classic fallback pages or separate commerce routes inherit ExperienceSite section choreography.
7. Preserve per-tenant document/theme/render preferences and versioned draft/published boundaries. Never mass-rewrite existing site documents as a motion rollout.

## 6. Evidence status and next acceptance

| Scope | Source evidence | Real acceptance status |
|---|---|---|
| 20 family registry and art direction | `templateFamilies.ts`, `artDirector.ts` | Source inspected; all 20 browser journeys NOT TESTED |
| Prompt-first understand/generate | OpenPage API routes and WebsiteStudio component | Source inspected; authenticated generation on disposable tenant NOT TESTED |
| Candidate preview | `StudioPreview` → `ExperienceSite`, view tracking disabled | Source inspected; browser preview NOT TESTED |
| Draft save | `PATCH /api/experience`, expected draft version | Source inspected; stale-write/tenant-isolation E2E NOT TESTED here |
| Publish | `POST /api/experience/publish`, server-side entitlement/readiness/version checks | Source inspected; disposable publish/rollback browser E2E NOT TESTED here |
| Per-website content API | `/api/studio/websites/content` | Source inspected; entry-point usage and compatibility NOT TESTED |
| Public home draft/live selection | `app/b/[slug]/page.tsx` and storefront loader | Source inspected; owner/visitor browser sessions NOT TESTED |
| Shop/checkout/booking/enquiry/order | `app/b/[slug]/**` | Source inspected; full transaction-state motion NOT TESTED |
| Reduced motion, keyboard, six viewports, before/after | Runtime and prior coverage matrix | NOT TESTED in this phase |
| Production existing-site inheritance | Shared renderer source only | NOT TESTED; no production access or publication performed |

Required viewports remain 320×568, 360×800, 390×844, 430×932, 768×1024 and 1366×768. Each family needs generated draft preview and published render evidence; transaction routes need their own actual journeys. Capture both default and OS reduced-motion states, keyboard focus, touch interaction, before/after recordings, and independently inspect every screenshot.

## 7. Explicit blockers

- No authorized disposable authenticated browser environment was exercised in this phase.
- No independent screenshot/recording evidence was captured or inspected.
- The 20 family list is source-level registry evidence, not 20 verified templates.
- The two Studio persistence surfaces need caller/entry-point mapping before any consolidation.
- No production existing-site inheritance, provider, payment, or publication behavior was tested.

**Disposition:** this inventory advances the source-level portion of MOTION-003 only. MOTION-002 universal inheritance and MOTION-004 runtime/transaction behavior remain IN PROGRESS / NOT TESTED. Do not mark programme completeness PASS, merge, or deploy from this document.


## 8. Existing executable coverage and exact browser-workflow reachability

A follow-up review found existing unit coverage that should be distinguished from the browser acceptance still outstanding:

- `tests/unit/experience-art-direction.test.ts` iterates all 20 `TEMPLATE_FAMILY_KEYS`, builds each explicit family, validates and serializes the document, and server-renders `ExperienceSite`. It asserts the selected family marker, owner facts, KES price, shop/contact links and absence of blank/hidden SSR content. This is meaningful all-family deterministic/SSR coverage; it is not browser interaction, screenshot, viewport, or published-route evidence.
- `tests/unit/storefront-motion.test.ts` exercises the finite recipe registry, SSR readability, lazy import, scope ownership, reduced-motion changes, Save-Data/network/visibility changes, cancellation, fallback behavior, focus handling and bounded reveal concurrency. Its own test description explicitly identifies the runtime doubles as unit doubles, not browser evidence.
- `package.json` exposes browser commands including `test:browser:motion`, `test:browser:families`, `test:browser:layout`, `test:browser:studio-authenticated` and `test:smoke:studio`. The presence of scripts is not evidence that they ran successfully on this commit.

The repository's `.github/workflows/motion-evidence.yml` contains a disposable PostgreSQL 16 + synthetic-fixture + production-build + Chrome capture path, with generated-family and route-behaviour artifacts. Its pull-request trigger is restricted to PRs targeting `main`; PR #139 targets `arena/subscription-payment-reconciliation`. Its other trigger is `workflow_dispatch`. The available GitHub connection in this session exposes workflow inspection and reruns, but no workflow-dispatch operation. Consequently this exact candidate has no motion-evidence workflow run. Do not infer a pass from the workflow's existence or from the unit suite.

The existing `candidate-rehearsal.yml` separately uses disposable PostgreSQL 18, but likewise triggers pull requests only when the target is `main`, or manual dispatch with an explicit full SHA. It has not run for this PR. PostgreSQL 16 migration/integration evidence remains distinct from PostgreSQL 18 acceptance.

**Reconciled status:** all-20-family deterministic generation/SSR and the motion controller's unit-double suite have source-level test coverage. Authenticated real-browser Studio flow, screenshots/recordings, six-viewport acceptance, and PostgreSQL 18 remain NOT TESTED for this candidate.
