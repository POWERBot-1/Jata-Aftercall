# Website Studio (OpenPage foundation) — browser acceptance (2026-11-10)

Branch `arena/399f15c6-jata-aftercall`, based on `main` @ `089f8db` with PR #107's commits
cherry-picked into the branch history. No production data, deployment, payment configuration or plan
pricing was changed. The legacy Canvas / Website / classic editor tabs are intentionally still present.

## What this evidence proves — and what it does not

The browser run exercises the **real Website Studio client**, the **real deterministic OpenPage
generator**, the **real JATA `ExperienceSite` renderer** and the **real theme bridge** through
`/dev/website-studio-preview`, a development-only fixture route (404 in production). It walks the
whole owner journey: describe → understand → three layouts → choose → Theme → conversational
refinement → save draft → mobile preview → publication controls.

Only the five authenticated/server API calls are stubbed with `page.setRequestInterception`:
`POST /api/studio/openpage/understand`, `POST /api/studio/openpage/generate`,
`POST /api/studio/openpage/refine`, `PATCH /api/experience` and
`POST /api/experience/publish`. The sandbox has no database and no login, so the route handlers,
Prisma persistence, tenant resolution, draft-version concurrency and publication enforcement are
**not** exercised here. Those contracts are covered by vitest:

* `tests/integration/openpage-integration.test.ts` — 14 passed (adapter, requirements, generation,
  distinctness, dropped-block and unsupported-block handling, protected facts, refinement, theme bridge).
* `tests/integration/openpage-render.test.tsx` — 4 passed (real `ExperienceSite` render, customer
  logo/hero/gallery assets retained, `trackViews` disabled in the preview).
* `tests/integration/studio-experience-concurrency.test.ts` and the publish/schema suites — 122
  passed across 7 files (run against the repository's offline Prisma fallback where required).

Each generated candidate also carries the adapter's full `mapping.notices` records (code, message,
block id/type and severity). When anything was dropped or is unsupported, the compare screen exposes
"What was not imported, and why" instead of only a count. Nothing is discarded without a reason.

Not tested here: authenticated HTTP round-trips, real database writes, live `/b/[slug]` publication,
and Vercel deployment. No production site was published.

## Exact command

```bash
# Dev server (offline Prisma stub; no database)
npm run dev   # http://localhost:3000

# Chromium from @sparticuz/chromium, not a committed dependency
LD_LIBRARY_PATH=/tmp/awslib/lib:/tmp/nspr/lib \
CHROME_PATH=/tmp/chromium \
STUDIO_BASE_URL=http://localhost:3000 \
node scripts/browser/website-studio-openpage.check.mjs
```

Result (`check.log` is the verbatim run):

```
PASS: 3 layouts previewed, request/photo assets retained, refinement, save v4, mobile preview and publish controls exercised.
Evidence: docs/evidence/website-studio-openpage-2026-11-10
```

The harness fails on any page error or console error (Next dev's cross-origin HMR websocket message
is filtered out; the production build has no HMR client). It also asserts exactly three
`[data-studio-preview]` candidates and that the customer hero and gallery images survive generation.

## Captures

| File | What it shows |
| --- | --- |
| `01-requirements-understood.png` | "What JATA understood": Food & Restaurant category, menu-first layout plan, the sell goal and premium tone, plus the protected-facts policy. |
| `02-three-distinct-layouts.png` | Three real previews rendered by the customer storefront: Cinematic · Bistro, Marketplace · Modern Grill and Location-led · Street Food, with structure similarity 0% / 53% / 26%. Hero and gallery photography are present. |
| `03-theme-and-visual-refinement.png` | Editor stage after choosing a layout, Theme tab, "Street Food" approved theme selected and repainted live. |
| `04-editor-mobile-preview.png` | Mobile preview, a real 390 px page (previously the frame collapsed to half-width). |
| `05-publish-controls.png` | The 14-item publication checklist and the "Publish my website" control; the stubbed publish response reports "You're live" at `/b/choma-place`. |
| `check.log` | Verbatim output of the final browser PASS run. |
| `preview.log` | Verbatim post-build editor load check: HTTP 200, one live preview, 390 px mobile frame, save/publish/properties/theme controls present, 14 of 14 checklist items passing, no page errors. |
| `vitest.log` | Verbatim full-suite run: 4513 passed, 1 failed, 337 skipped (`vitest` exit 1, only the environmental Prisma failure). |
| `typecheck.log` | Verbatim `npx tsc --noEmit`: exactly the same three offline-Prisma errors (`tsc` exit 1). |
| `lint.log` | Verbatim `npm run lint`: 0 errors, 51 warnings (`eslint` exit 0). |
| `build.log` | Verbatim production build with `tests/**` temporarily excluded from TypeScript (`npm run build` exit 0). |

## Repository gates (same working tree)

| Gate | Result |
| --- | --- |
| `npx vitest run` | **exit 1**: 377 files passed / 1 failed / 38 skipped; **4513 tests passed, 1 failed, 337 skipped**. The single failure is `tests/unit/autopilot-phase1-hardening.test.ts` reading `Prisma.dmmf`, which is undefined because this sandbox cannot reach `binaries.prisma.sh` to generate the Prisma client. It is pre-existing and environmental (`vitest.log`). |
| `npm run lint` | **exit 0**: 0 errors, 51 pre-existing warnings (none in the files added here) (`lint.log`). |
| `npx tsc --noEmit` | **exit 1**: only the 3 offline-Prisma errors (`autopilot-constraints-and-concurrency.test.ts`, `experience-boundary.test.ts`, `autopilot-phase1-hardening.test.ts`); no errors in application code (`typecheck.log`). |
| `npm run build` | **BLOCKED by the environment**: `prisma generate` cannot download engines, so the TypeScript gate reports those same 3 test-only errors. The build compiles the application successfully before that step. Excluding `tests/**` from `tsconfig.json` for a local verification run only (restored immediately afterwards, same precedent as `docs/evidence/README.md`) produced a complete production build: **exit 0**, `✓ Compiled successfully in 23.5s`, `Finished TypeScript`, `[build] Build completed successfully` (`build.log`). |

No `ignoreBuildErrors`, no dependency change and no Prisma workaround was committed.
`package.json`, `package-lock.json`, `tsconfig.json` and `next-env.d.ts` are unchanged.

## Known cosmetic items (not regressions, not blockers)

* The fixture has a single category ("Grill"), so "Shop by category" renders an empty pill group in
  the candidate previews.
* Next 16 / React 18 prints the recurring `fetchPriority` prop warning during SSR. It predates this
  work and does not affect the acceptance flow.
* The publish checklist uses the existing `✅` / `⚠️` emoji. All 14 items in the run are passes (`preview.log`), but this
  headless Chromium has no emoji font, so the screenshot renders each pass mark as a hollow box. The
  server-backed `status: "pass"` values and the enabled publish button are the functional evidence.
* The inactive device-picker buttons in the editor are icon-only and nearly blend into the dark
  chrome at this capture scale. They remain keyboard-labelled and clickable; this is a polish item,
  not a functional failure.
