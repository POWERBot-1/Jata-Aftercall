# Website Studio — hydration investigation (2026-10-12)

## Verified starting state / limits of historical evidence

- Repository `POWERBot-1/Jata-Aftercall`; branch `arena/7b28a123-jata-aftercall`; starting local/remote/PR HEAD **45e537c20ca2b5c78092f706c840fce8870d0fe8**, clean worktree, PR41 OPEN/DRAFT.
- Exact-head CI38214337060/job114695435397/runner068d914caa71d4881a3d2889fa55fcbd28869a9c SUCCESS; bot6119277469 verifies native2034 PASS+1 preserved expected, Website17/POS22, authenticated133, existing browser/HTTP358. No source reset/reconstruction or unrelated work discarded.
- Historical d72c7bc CI38212061750/job114688223495/bot6118943323 reports132 PASS/1 FAIL and ONE React418. Its old listener accumulated a message only, **no route, frame, seed, component stack or SSR snapshot**. Immediate page/stack logging was added in5f0a298; subsequent source-equivalent passes do not establish historical resolution.
- Attempted `gh run view38212061750 --job114688223495 --log`: exit1/EOF retrieving Actions logs from the restricted results host. The PR failure output remains accessible but still has no route/stack. Do not invent the original failing route or claim causal certainty.

## Reproduction BEFORE application edits

Actual source tree for the booking route:

`RootLayout → ProductThemeProvider → /b/[slug]/book/page.tsx → server loadStorefront/ownership decision → StorefrontShell → BookingClient`.

The unchanged BookingClient generated initial days in `useMemo` from `new Date()`, created **local midnight**, converted it with `toISOString().slice(0,10)`, then formatted labels on the client using local `toLocaleDateString`. SSR and hydration each independently repeated this calculation.

Controlled time **2026-10-12T06:24:00Z**:

| Execution | First rendered date label | Result |
|---|---|---|
|Actual component SSR, server UTC|Mon,12 Oct|Reference SSR|
|Same actual component, client Africa/Nairobi|Sun,11 Oct|Different initial HTML; local midnight converts to previous UTC date|
|Real Chromium153 mobile360×740, UTC control|Mon,12 Oct before/after|No recoverable errors|
|Real Chromium153 mobile360×740, Nairobi|Mon,12 Oct SSR → Sun,11 Oct client|React425 text mismatch, React418 hydration failures, React423 root client fallback|
|Server23:59:59Z, client00:00:01Z next day|Calendar advances independently|Different initial HTML even with identical timezone|

The browser fixture renders the **actual BookingClient and actual React/DOM**. Only Next Link is adapted to an `<a>` for isolation. It is not a native DB/authentication/production-Next or physical-device test. No app QA route/provider/mock payment was introduced. Scratch logs live under ignored `.cache/verification/phase2`.

Added the initial SSR equality regressions before fixing application source: **4 FAIL/2 PASS** on unchanged code. These fail for Nairobi/Kathmandu/Auckland and UTC-midnight rollover. This is a reproducible booking defect and a concrete root cause for that reproduction. **The unlocalized historical418 cannot conclusively be attributed to it.**

## Targeted fix / invariants

- `lib/experience/bookingCalendar.ts`: captures14 date-only choices on the server, deterministic UTC date keys and English/en-KE weekday/month labels; no client timezone/clock/ICU dependence. Invalid server dates fail safely; leap/day/year bounds tested.
- `app/b/[slug]/book/page.tsx` passes this serialized calendar to the existing client component after the unchanged server storefront/preview-ownership checks.
- `BookingClient` renders the exact supplied calendar and still submits the selected date key to the same server endpoint. No `suppressHydrationWarning`, client-only calendar placeholder, authentication mock or force click.
- Existing UTC deployment date-key convention retained. **No booking availability, past-time, capacity, deposit/payment, ownership, entitlement or publication rule changed.** Dates are still choices, not server-guaranteed availability; the server offers/validates slots as before.
- Browser date labels remain present in SSR/no-JS HTML; same accessible fields, pressed-state buttons, responsive layout and actual form submission retained.

## Regression evidence / commands

- `npx vitest run tests/unit/booking-hydration.test.ts`:12 PASS after fix (initial complete HTML parity across4 timezones and midnight, server HTML/form retained,14-day calendar/determinism/leap/year/invalid-clock tests).
- `CHROME_PATH=<actual Chrome> npm run test:browser:studio-hydration`:25 PASS,0 FAIL/SKIP. Six actual isolated component hydration cases (UTC/Nairobi/Kathmandu/New York/Auckland/midnight), SSR-readable dates/zero recoverable errors/exact labels/real selected-state interaction; negative control proves a genuinely different server label still triggers the detector. The negative control is confined to that fixture, never filters app errors.
- Local lint/types/syntax/whitespace PASS. Full local suite157 PASS/12 DB-e2e SKIP files;1979 PASS/108 DB-e2e SKIP/2087. Native local journey BLOCKED without the approved disposable database/native engine; not inferred from these tests.
- Existing required authenticated-cookie runner now uses a Nairobi visitor and adds **27 real Next SSR navigations** over retail/food/salon, UTC/Nairobi/New York, home/item/shop or booking; the3 booking visits require raw server HTML date labels exactly equal hydrated client labels. Its existing final zero-runtime/zero-forbidden-request gate is unchanged. Safe route/timezone/status diagnostics retained in results; no cookies/query payloads logged.
- CI runs the25-check isolated regression alongside the connected production/authenticated suite; missing Chrome is BLOCKED/exit2, never accepted as a passing skip. Exact native source/run/job/results are recorded in release evidence after normal push.

## Acceptance / next action

This fixes the **proven booking SSR clock/timezone defect**. Historical aggregate418 attribution remains OPEN unless more route-specific evidence identifies it; neither repeated green runs nor this similarity retroactively proves its source. Keep runtime failures mandatory and investigate any recurrence from its actual route/stack.

After native verification, proceed to advisory-by-advisory compatible remediation, then reusable business recipes. All108 master blocks/A–X/all7 stages remain mandatory. Storage DEFERRED; persistent originals/providers BLOCKED; no uploads/provider activation/provisioning/spending/production data, merge or production deployment.


## First native result / separate shop Server Component defect

Phase2 source **b670cd9e496ed8a205d6783bf7f0da16d85f12dc**, CI38216557166/job114702549703 **FAILED**, actual bot6119577130. Native167files2046 PASS+1 expected/2047, Website17/POS22/connected build PASS. Nairobi customer actual booking201/persisted service/owner board PASS after calendar fix. Additional real SSR probe identified `/b/[slug]/shop`500, not a hydration error: server ShopPage called `priceBandsFor` imported from `CatalogueClient` marked `"use client"`. Next logged “Attempted to call priceBandsFor() from the server … on the client”, digest1930353472. Authenticated117 PASS/1 FAIL; remaining SSR probes/final checks/downstream browser steps NOT RUN; exact cleanup/stop PASS.

Root cause established from actual route/server log BEFORE change. The pure existing price-band function is moved byte-for-byte to `lib/experience/catalogue.ts`; ShopPage imports it from the server-safe module, client component retains browsing behavior. No calculation/price authority/tenant/entitlement/commerce rule altered. New boundary regression fails before fix (1FAIL/3 arithmetic PASS), then all4 PASS; shared-module ownership/arithmetic/sparse/unpriced/input-immutability tests retained. Required shop SSR assertion is NOT removed. Fresh native correction-head required before Phase3 changes.


## Second native result / complete public card context

Correction d3d1076932ab2af8d9cd6b870abb633ea9e74d7a, CI38217116092/job114704332702 **FAILED**, actual bot6119670202. Shop pure-function boundary is cleared, but the same real route reveals its next existing defect: CatalogueClient passed an incomplete `{business,profile}` object to ItemCard via `as never`; ItemCard dereferenced missing `theme.treatment.cardStyle` (digest216805184). Actual route/compiled browser+server stacks identify this BEFORE change; not classified as the historical418. Nairobi booking/persistence still PASS; remaining SSR/final/downstream NOT RUN; cleanup PASS.

`ItemCardData` is now an explicit narrow public contract; server `itemCardDataFor` passes slug, category capabilities, category add CTA, and actual approved card style, without draft/owner/workspace data. CatalogueClient no longer casts incomplete data to`never`; ItemCard accepts that same safe contract, preserving full StorefrontData structural callers.4 actual component SSR/context tests cover retail/food/salon with real CartProvider (router context adapter), category-specific cart/booking labels and public-field isolation; other20 boundary/calendar tests retained. No theme hardcoding, private JSON serialization or price/tenant/payment policy change.


## Verified native closure of the reproduced defects

Phase2 db853d6/CI38218114522 SUCCESS, and dependency/recipe sourcea622a8c/CI38224011179 SUCCESS preserve the fixes. Actual native booking/calendar SSR timezone checks and full210-cookie journey plus25isolatedSSR PASS without suppression; all shop SSR routes now200 with actual typed card context. Source-local mismatch/root causes above are fixed with regressions; the original d72c7bc event still cannot be conclusively localized from its old aggregate log. Keep that historical qualification and retained runtime-error diagnostics, not a blanket “all hydration permanently fixed” claim.


## 2026-10-12 reproduction of the historical #418 with route and stack (issue stays OPEN)

CI38233198609 (source 47f0f6e, docs-only diff) FAILED the authenticated gate at `no uncaught browser runtime errors` with the first fully localized historical reproduction: `Minified React error #418; ... ?args[]=HTML&args[]=`, recorded at path `/dashboard/businesses/cmv530cuj0049vd5kzebco4vb/preview`, minified stack `4bd1b696-*.js` frames `rD`→`oq`→`ik`→`iu`→`iX` (React hydration internals), 230 passed/1 failed and all later required checks NOT RUN. The prior source-identical run 38232032118 passed 231/0, so the failure is **intermittent on identical source** and cannot be attributed to the docs-only diff. The recorded path is the top page; the draft-preview **iframe** (`/b/<slug>?preview=draft`, storefront home SSR+hydration) is the leading suspect frame. The runner now records every frame's path inside each pageerror payload so the next recurrence localizes exactly.

Elimination log this session (do not redo): `CartProvider` (state defaults + effect-gated localStorage), `PreviewClient` (all state default, versions fetched in effect, its `toLocaleString("en-KE")` only renders post-fetch), `RenderModeProbe`/`Track` (effects only), `DashboardNav`/`StudioTabs` (`usePathname`, deterministic), `ProductThemeProvider` (state default + effects; root `<html>` carries `suppressHydrationWarning` so its pre-paint boot-script attribute writes are suppressed), `StorefrontShell` is a **server** component (its `new Date().getFullYear()` footer cannot hydrate; it remains a minor server-TZ-vs-business-TZ cosmetic year risk, documented not changed), `ItemCard`/`Sections`/`FamilyComposition`/`ExperienceSite`/`EntitlementBanner` are server components (their `formatKES`/`formatDate` never hydrate), `ActionBar` is deterministic given props, `greetingFor()` has no callers, `lib/openingHours.ts` is pure.

Real render-nondeterminism defects found and fixed in this pass (candidates eliminated as defects even though not yet proven to be the #418 source): `ItemViewTracker` ran `trackEvent` **during render** behind a `typeof window` branch — now effect-gated with identical server/client render; `components/BusinessPage.tsx` formatted prices with default-locale `toLocaleString()` inside a `"use client"` render (server en-US vs browser locale is a genuine text-mismatch class) — now pinned to `toLocaleString("en-KE")`. Issue acceptance unchanged: **OPEN until reproduced AND resolved with sufficient evidence** — reproduction now exists (run 38233198609, route+stack+args recorded above); resolution requires either a green re-run of the exact gate after a proven root cause, or capture of the mismatching subtree (dev build or the new frame evidence). Never claim this historical issue is closed from green runs alone.


## M10 evidence pass — #418 semantics decoded, structural probe added, issue OPEN

Final-head run **38242804389 (b3522d4) SUCCESS** with the frame-capturing pageerror handler in place: **no #418 reproduction** — explicitly not proof of a fix. Decoded the error from the vendored React 19-canary development build: error 418 = `throwOnHydrationMismatch(fiber)` where `fromText` is false — the production URL args `HTML` + empty are `(fromText ? "text" : "HTML")` and the prod-stripped dev `describeDiff` output. The failure class is therefore **structural** (DOM node sequence / tag nesting / form-state markers), not text, locale or number formatting. Elimination extended this pass: `productThemeCss()` is pure/deterministic; the theme boot script only writes `data-jata-theme` on `<html>` (covered by `suppressHydrationWarning`). New deterministic regression net `tests/unit/hydration-structure-probe.test.ts` (10 cases, all green) enforces well-formed HTML nesting across every hydrated subtree of the recorded failure path: StorefrontShell + all section renderers for all 5 categories, every registered recipe presentation, item/enquiry/booking initial renders, and the dashboard preview chrome (StudioTabs/PreviewClient). Static invalid-nesting generators are thereby eliminated for these trees and any structural regression now fails the native suite deterministically. The runner's pageerror payload records all frame paths (34932c6) so the next intermittent recurrence identifies the offending frame immediately. Status remains **OPEN** (reproduced 38233198609; root cause not yet proven to a specific component); closure requires a demonstrated root cause + focused regression + green required gate — never from green runs alone.

## M10 recurrence — #418 reproduced with full evidence; throw path mapped to one React internal; issue OPEN

**Reproduced on run 38255056118 (a715fb2)** by the frame-capturing pageerror gate: `Minified React error #418, args[]=HTML&args[]=` with the exact route `/dashboard/businesses/<id>/preview` and the storefront iframe `/b/qa-food-<runId>` open (the `frames` field is an open-frame snapshot at error time, not stack-derived, so top-document vs iframe-document origin is not yet discriminated; the failure is a **food** fixture — the class is not salon-specific). The prod stack maps **exactly** onto the deterministic local build of chunk `4bd1b696-f785427dddbba9fb.js` (identical hash reproduced by `npx next build`):

- `rD` @35057 = `throwOnHydrationMismatch` — `Error(i(418,"HTML",""))` + `throw HydrationMismatchException`.
- `oq` @84561 = `beginWork`'s HostComponent hydration — the `canHydrateInstance` candidate search ending in `l||rD(n)`: **the client's expected host element had no matching server candidate at the hydration cursor** (tag/instance-level mismatch, not an attribute/text diff).
- `ik` @114677 = `performUnitOfWork`; `iu` @110725-110826 = the work loop — ordinary render plumbing, no app frames in prod.

This mapping **eliminates** the previously listed suspects as the throw source: the form-state-marker path (dev 7639 / prod `aT` @~57541 calls `rD` from a different site and only when `formState !== null`, and this app ships no `useActionState`/server-action forms), the Activity path (dev 9107) and the Suspense-replay paths (dev 9946/11106/11168) all record a `warnNonHydratedInstance` first and throw from their own call sites, and `diffHydratedProperties` (dev 4644) populates the dev diff root (our diffs are empty). The empty diff itself is explained: production strips `describeDiff` output, and in development `warnNonHydratedInstance` is skipped when `didSuspendOrErrorDEV` is set (a prior suspension in the same tree), leaving the diff root empty.

Intermittency characterization: the identical code passed 427/0 (including this very pageerror gate) on run 38253837414 and failed on 38255056118 — roughly 1 recurrence per 3 full fixture journeys — consistent with a **timing race at the hydration cursor** rather than a deterministic template difference. Remaining hypothesis set (narrowed): (a) the hydration cursor advancing past/onto the wrong node while a lazy `<Suspense>` section is still streaming; (b) a pre-hydration DOM mutation inside the same document (in-page script inserting nodes before React hydrates that region); (c) an unmatched comment/marker sequence early in the stream shifting `nextHydratableInstance`. **Precise unknown stage: which host node/tag is expected when the cursor misses, and in which of the two documents (top preview page vs iframe storefront) — prod bundles carry no fiber names, and the sandbox has no database to re-run the authenticated journey locally.** Next evidence (in place as of the follow-up commit): the runner's pageerror handler now captures a per-frame forensic DOM snapshot at error time (ready state, `[data-motion-recipe]`/`[data-motion-static]`/`[data-motion-probe]`/`[data-catalogue-layout]` marker counts, first 8 KB of each frame's `outerHTML`) alongside the mapped stack, so the next recurrence names the diverging host node and document directly. If that is still insufficient, the fallback is a dev-only diagnostic build that logs the failing fiber's tag/props and `nextHydratableInstance` at the `oq` throw (never the main line). Exact throw-path semantics now proven from the dev source: `beginWork` HostComponent hydration — `nextHydratableInstance` null or rejected by `canHydrateInstance`, with valid nesting (which is why the dev diff is empty — `warnNonHydratedInstance` only records a diff when `validateDOMNesting` returns a warning). Do not close the issue until the root cause is demonstrated with a focused regression and a green required gate. Passing runs never prove the fix.

### M10 recurrence #4–#5 with forensic DOM capture (runs 38260167147, 38261060443)

Runs 38255056118 (food), 38256987188 (retail), 38258619645 (salon), 38261060443 (retail) reproduce the defect at roughly 40% of complete journeys; 38253837414 passed 427/0 with the identical code — intermittent, never fixture-specific (salon/food/retail all seen), and always during a fresh `page.goto` of the owner draft-preview route (`/dashboard/businesses/<id>/preview`) while the storefront iframe hydrates. Run 38260167147 failed a different check (`professional: Desktop authenticated draft iframe/readable/noindex`, no detail) — the check now prints its measured state; it is plausibly a downstream symptom of #418 regenerating the iframe tree mid-measure, but that attribution is NOT proven.

The slimmed forensic snapshot (run 38261060443) captured the storefront frame at error time: `ready="complete"`, `motionRecipe:6` with `motionStatic:6` (the motion runtime's `reset()` had already stamped `data-motion-static="true"` on every `[data-motion-recipe]` target and set `data-render-mode="lite" data-motion-engine="static" data-motion-reason="owner-lite"` on `.eb-scope`), `motionProbe:1`, but **`catalogueLayout:0`** — the `[data-catalogue-layout]` subtree absent while the shell is complete, consistent with React's mismatch recovery having deleted the offending subtree and not yet re-rendered it. The top preview page was fully loaded dashboard chrome (23 scripts, no storefront markers) — as expected.

Two constraints keep the exact node unproven: (1) the pageerror handler snapshots asynchronously, landing inside React's delete-then-regenerate window; (2) the GitHub comment generator middle-truncates ~37 KB details (job logs are unreachable from the development sandbox — Azure blob redirect). Attribute mutations are formally excluded as the rejection cause: `canHydrateInstance` matches on node name only in non-root context, so `data-*` stamping cannot reject a candidate; the failure needs a node-level divergence (wrong tag/text at the cursor or an empty cursor). **Next diagnostic (registered, not yet run): a MutationObserver ring buffer installed via `evaluateOnNewDocument` (pre-hydration), dumped from the pageerror handler — it records every node insertion/removal in the storefront document through the hydration window and names the exact diverging operation.** Status stays OPEN; passing runs (38253837414) never prove the fix.

## M11 — pre-hydration MutationObserver ring buffer (Stage B) and reproduction log (Stage C)

**Stage B (commit b9f81e1):** the registered diagnostic is in place — `scripts/browser/hydration-mutation-probe.mjs` installs through `page.evaluateOnNewDocument` before any document script in every frame of each runner page (dashboard preview top document and the same-origin storefront iframe). It records child-list adds/removes plus a narrow attribute filter (`hidden`, `data-motion-*`, `data-render-mode`) in a bounded ring buffer (600 records, monotonic sequence), classifies each record's zone (catalogue / motion / preview / app) from stable markers, and freezes a structural snapshot (counts + bounded outline + last 30 records) **synchronously in `window.onerror`** before React's delete-then-regenerate recovery can overwrite the history. The runner's pageerror handler dumps per-frame probe state (compact; cross-origin frames reported as inaccessible, never bypassed) as `HYDRATION PROBE` log lines and in the error record. The probe never mutates observed DOM, captures no cookies/headers/form text, and exists only in test tooling. Focused tests (`tests/unit/hydration-mutation-probe.test.ts`, 7 cases) prove install-before-hydration ordering, monotonic bounded history, error-time freeze, attribute filter, no-DOM-mutation, cross-origin safety, dump compaction and runner wiring.

**Stage C attempt log** (fresh `page.goto` of `/dashboard/businesses/<id>/preview` per fixture; all fixtures sampled):

| # | commit | run | result | #418 |
|---|--------|-----|--------|------|
| 1 | b9f81e1 | 38266665715 | SUCCESS (427/0 journey) | not reproduced — passing run, not proof of fix |
| 2 | 35583e2 | 38268094019 | SUCCESS (427/0 journey) | not reproduced — passing run, not proof of fix |
| 3 | e8150ee | 38269201254 | SUCCESS (427/0 journey) | not reproduced — passing run, not proof of fix |
| 4 | 43a7226 | 38270264732 | SUCCESS (427/0 journey) | not reproduced — 4 consecutive passes vs ~50% historical rate; probe cost reduced (arms at readyState interactive, no parse-window overhead) before further sampling |
| 5 | 43bd129 | 38271714437 | SUCCESS (427/0 journey) | not reproduced — 5 consecutive passes with the lighter probe; starting A/B control runs with the probe disabled (`scripts/browser/hydration-probe.mode` = off) to test whether the instrument itself suppresses the race |
