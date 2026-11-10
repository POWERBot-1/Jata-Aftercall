# Website Studio (OpenPage foundation) — acceptance evidence (2026-11-10)

Branch `arena/399f15c6-jata-aftercall`, based on `main` @ `089f8db`. PR #108 is open and unmerged.
No production data, deployment, payment configuration or plan pricing was changed. The legacy
Canvas / Website / classic editor tabs are intentionally still present, and the customer-facing name
remains **Website Studio** at KES 999 / 30 days.

Code verification for the category-authority fixes was run at `9e18fbf`; the final commit also adds
one PostgreSQL-only test and this evidence. The authenticated database/browser evidence below was
produced by that CI run on disposable PostgreSQL, never against production.

## What this evidence proves — and what it does not

The local browser run exercises the **real Website Studio client**, the **real deterministic OpenPage
generator**, the **real JATA `ExperienceSite` renderer** and the **real theme bridge** through
`/dev/website-studio-preview`, a development-only fixture route (404 in production). It walks the
owner journey: describe → understand → three layouts → choose → Theme → conversational refinement →
save draft → mobile preview → publication controls.

Only the five authenticated/server API calls are stubbed with `page.setRequestInterception`:
`POST /api/studio/openpage/understand`, `POST /api/studio/openpage/generate`,
`POST /api/studio/openpage/refine`, `PATCH /api/experience` and `POST /api/experience/publish`.
This sandbox has no database, no login and no downloadable Prisma engine, so the local harness does
**not** prove route handlers, Prisma persistence, tenant resolution, draft-version concurrency or
publication enforcement. Those are covered by the CI evidence below.

Each generated candidate carries the adapter's full `mapping.notices` records (code, message, block
id/type and severity). When anything was dropped or is unsupported, the compare screen exposes
"What was not imported, and why" instead of only a count. Nothing is discarded without a reason.

## Local browser command and result

```bash
LD_LIBRARY_PATH=/tmp/awslib/lib:/tmp/nspr/lib \
CHROME_PATH=/tmp/chromium \
STUDIO_BASE_URL=http://localhost:3000 \
node scripts/browser/website-studio-openpage.check.mjs
```

`check.log` is the verbatim run:

```
PASS: 3 layouts previewed, request/photo assets retained, refinement, save v4, mobile preview and publish controls exercised.
Evidence: docs/evidence/website-studio-openpage-2026-11-10
```

The harness fails on any page or console error (Next dev cross-origin HMR noise is filtered). It
asserts exactly three `[data-studio-preview]` candidates and that the customer hero and gallery
images survive generation.

## Captures

| File | What it shows |
| --- | --- |
| `01-requirements-understood.png` | "What JATA understood": Food & Restaurant category, menu-first layout plan, sell goal, premium tone and protected-facts policy. |
| `02-three-distinct-layouts.png` | Three real previews rendered by the customer storefront: Cinematic · Bistro, Marketplace · Modern Grill and Location-led · Street Food, with structure similarity 0% / 53% / 26%. Hero and gallery photography are present. |
| `03-theme-and-visual-refinement.png` | Editor after choosing a layout, Theme tab, "Street Food" approved theme selected and repainted live. |
| `04-editor-mobile-preview.png` | Mobile preview, a real 390 px page. |
| `05-publish-controls.png` | The 14-item publication checklist and "Publish my website"; the stubbed publish response reports "You're live" at `/b/choma-place`. |
| `check.log` | Verbatim local browser PASS run. |
| `preview.log` | Post-build editor load check: HTTP 200, one live preview, save/publish/properties/theme controls, 390 px mobile frame, no page errors. |
| `vitest.log` | Verbatim local full suite: **4518 passed, 1 failed, 343 skipped**, exit 1 (the single known offline-Prisma failure). |
| `typecheck.log` | Verbatim local `npx tsc --noEmit`: exactly three offline-Prisma test errors, exit 1. |
| `lint.log` | Verbatim local `npm run lint`: 0 errors, 51 warnings, exit 0. |
| `build.log` | Verbatim local production build with `tests/**` temporarily excluded from TypeScript, exit 0. |
| `github-checks.log` | PR #108 check table captured from GitHub. |
| `github-authenticated-acceptance.md` | Full CI verification comment for the authenticated PostgreSQL journey (2026-11-10). |
| `programme-gate.log` | Local `check-programme-readiness.mjs` output: 25 pre-existing programme records not ready. |

## Local repository gates (same working tree)

| Gate | Result |
| --- | --- |
| `npx vitest run` | **FAIL (exit 1)**: 377 files passed / 1 failed / 39 skipped; **4518 passed, 1 failed, 343 skipped**. The only failure is `tests/unit/autopilot-phase1-hardening.test.ts` reading `Prisma.dmmf`, undefined because this sandbox cannot download Prisma engines. Pre-existing and environmental (`vitest.log`). |
| `npm run lint` | **PASS (exit 0)**: 0 errors, 51 pre-existing warnings, none in the files added here (`lint.log`). |
| `npx tsc --noEmit` | **BLOCKED (exit 1)**: only the three offline-Prisma errors (`autopilot-constraints-and-concurrency.test.ts`, `experience-boundary.test.ts`, `autopilot-phase1-hardening.test.ts`); no application-code error (`typecheck.log`). CI runs the same typecheck with a generated client below. |
| `npm run build` | **PASS locally with a documented workaround (exit 0)**: Prisma generation is offline, so `tests/**` was excluded from TypeScript for this run only and restored immediately. The application compiled successfully and completed. No `ignoreBuildErrors` and no tsconfig workaround is committed (`build.log`). CI's production build with `prisma generate` is PASS. |

`package.json`, `package-lock.json`, `tsconfig.json` and `next-env.d.ts` are unchanged.

## Authenticated acceptance in CI (isolated PostgreSQL)

All jobs below ran on disposable `postgres:16` services with seeded test data and a generated Prisma
client. They are **PASS** unless marked otherwise.

| Job | Evidence |
| --- | --- |
| `Prisma, tenant tests, typecheck and production build` (run 42869947754, 10m01s) | `prisma validate` + `generate` + `migrate deploy`, full database-backed vitest suite, isolated Website Studio PostgreSQL suites, **typecheck**, **production build**, and **authenticated Website Studio browser acceptance** all passed. No skips are permitted by this workflow. |
| `Journey against a real database` (run 42869947953, 14m45s) | Full native DB suite **4791 passed**; experience journey **17/17**; Business POS journey **33/33**; authenticated production HTTP/browser/DB journeys for retail, food, salon, professional, technical and farm. Includes draft save/retrieval, monotonic revisions, stale-write refusal without overwrite, preview/live isolation, publication snapshots, published restore, cross-tenant session isolation, customer rendering on `/b/[slug]`, and no original-media/provider writes. Full log: `github-authenticated-acceptance.md`. |
| `Exact candidate applies on disposable PostgreSQL 18` (3m46s) | PASS. |
| `Real-Chrome six-viewport capture on a disposable database` (9m23s) | PASS. |
| `Migrations + schema on PostgreSQL 18`, `Production build path on PostgreSQL 18`, `Schema, types, unit suite, build`, `Migrations and PostgreSQL suite` | PASS. |
| `Static (install, generate, lint, typecheck, audit)` | PASS. |
| `D2 — build, audit and controls on the candidate tree` | PASS. |
| `programme-completeness` | **FAIL — pre-existing, not a #108 regression.** The repository-wide programme gate requires 25 readiness records (ADMIN/MOTION/RELEASE) that are still BLOCKED/NOT_TESTED. `main` itself fails the same job (`admin-instructions.yml` run 42782565914). Local output: `programme-gate.log`. |

### Authenticated generation and refinement

`tests/integration/openpage-authenticated-postgres.test.ts` adds six database-backed checks with a
real user, real business row, real Studio guard and real read model: understand, generate three food
candidates, refine a generated candidate, deny a foreign tenant with 403, require a session with 401,
and refuse a category switch through the refinement payload. It also proves the legacy
`Business.category = "Restaurant"` value resolves to the `food` profile. It is skipped in the
no-database sandbox and executed by the CI database workflows; its result is part of the final PR run.

### Acceptance matrix

| Requirement | Result | Evidence |
| --- | --- | --- |
| Authenticated generation and refinement API requests | **CI-covered by the final database run** (`openpage-authenticated-postgres.test.ts`); mocked-route coverage is PASS 14/14 | `openpage-integration.test.ts`, PR final run |
| Draft save/retrieval, revision creation and rollback | **PASS** | CI journey: monotonic revisions, stale edit refused without overwrite, published restore is draft-only; `serverContext`/Experience tests |
| Asset upload/retrieval | **PASS for the supported contract; BLOCKED for durable binary upload** | Inline bytes are refused with 503 `inline_media_persistence_disabled`; hosted-path media references are accepted and renderer assets survive. Durable object storage/provider acceptance is deferred by the owner, so a real binary upload was **not** performed. |
| Business-to-business tenant isolation | **PASS** | CI: another tenant's session cannot read a draft preview (`markerSeen:false`); foreign generation returns 403 before a read; security suite |
| Subscription entitlement enforcement | **PASS with synthetic entitlement** | Publish is 403 while unpaid, 200 after the synthetic stored entitlement; KES 999 / 30 days unchanged. Not a live payment-provider test. |
| Live `/b/[slug]` rendering and publication | **PASS** | CI: exact reviewed version published and snapshotted, customer sees content, no-JS/mobile rendering, later draft does not alter live site |
| Browser journey and screenshots | **PASS** | local `check.log` + five fresh PNGs; CI authenticated browser acceptance PASS |
| GitHub checks | **PASS except the pre-existing programme-completeness gate** | `github-checks.log` |

## Review fixes in this branch

1. **HIGH — transaction atomicity (fixed):** a category/draft conflict inside `$transaction` returned
   a string instead of throwing, so Prisma committed the draft while the business row kept the old
   category. Both branches now throw, the whole write rolls back, and the caller returns 409.
2. **HIGH — first-website category conflict (fixed):** a failed business-row claim escaped the
   transaction as an unhandled error and became a generic 500. It is now mapped to **409
   `business_category_conflict`** with no draft created.
3. **HIGH — legacy categories (fixed):** existing tenants store `"Restaurant"`, `"Salon"`, etc.,
   while Experience uses `food`, `salon`. The authority now resolves legacy labels instead of
   treating them as "no category"; the compare-and-swap matches the raw stored value; website
   content save/revision/rollback and Studio generation use the resolved profile key. Without this,
   existing tenants could not open or save Website Studio (caught by the CI §66 journey).
4. **MEDIUM — content path could invent a category (fixed):** `PATCH /api/experience` may echo the
   draft's existing category but may no longer establish a new one while the business record has
   none; only create/change-type writes both rows transactionally.
5. **MEDIUM — comment/code mismatch (fixed):** an explicit create-time category choice is a supported
   owner action and is documented as such; the old comment claiming otherwise was removed.
6. **LOW — unvalidated `PATCH /api/business` category (pre-existing, unchanged):** it accepts a
   sanitized free-text category. The resolver now tolerates that, so it is not a blocker; taxonomy
   validation would be a separate product change.

## Known cosmetic items (not regressions, not blockers)

* The fixture has a single category ("Grill"), so "Shop by category" renders an empty pill group in
  previews.
* Next 16 / React 18 prints the recurring `fetchPriority` warning during SSR. It predates this work.
* Headless Chromium has no emoji font, so the existing `✅` pass marks render as hollow boxes in
  `05-publish-controls.png`; all 14 server-backed checks are `pass` and publish is enabled.
* Inactive device-picker icons are low contrast at capture scale; they remain keyboard-labelled and
  clickable.
