# Website Studio — authenticated browser acceptance and resume audit

Updated 2026-10-12. **ENGINE INCOMPLETE.** This is a scoped acceptance register, not a replacement for the unchanged 108-block master specification or A–X gates.

First actual M7 execution PASS at source5f0a298/CI38212669278 (133 authenticated checks,2034 native +1 expected,17/22,358 fixture/HTTP). Earlier d72c7bc React418 remains an OPEN repeatability risk, NOT fixed by a logging-only pass. Latest qualified evidence and all failed diagnostics are retained in the release report.

## Read-only resume audit (reported before edits)

- Repository POWERBot-1/Jata-Aftercall; branch `arena/7b28a123-jata-aftercall`; remote/PR head **`c3bf39f51a873e56c707637c14d5f6353e532b06`**, OPEN/DRAFT PR41. No newer remote feature commit at audit.
- Restored local metadata initially pointed to baseline `77e35cec6a5726f569ab3febd3e7766300b14890`, with later tracked/untracked files appearing as changes. Direct SHA-1 Git-blob comparison of **all 687 remote files** found **zero differences/missing/extra visible files** against c3bf39f. After reporting the audit, fetched actual remote history, verified ancestry and advanced only the existing branch ref/index to c3bf39f. No working-file replacement, deletion, reset, stash, branch switch or user work loss.
- `f7bd361da2bbf868ef6dac6940ba1bb4879404fd` is a documentation checkpoint, not a new application implementation. Latest application implementation is M6 **`e9b1a1938c247eb54eb7cfd30fd8d47afc7c7be7`**. c3bf39f adds only the safe-pause report.
- Latest audit-time [CI38170669015](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/38170669015) SUCCESS; feature c3bf39f, runner **`bdd344da234be57629604187cc9a3dc773d19742`**, completed2026-10-11T20:09:46Z. Actual [comment6113217586](https://github.com/POWERBot-1/Jata-Aftercall/pull/41#issuecomment-6113217586): native **1952 PASS +1 expected failure /1953**, Website **17/17**, POS **22/22**, browser/HTTP **358 PASS**, no CI journey skips. [f7bd361 run38168849078](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/38168849078) independently confirms the same totals. Automatic Vercel **branch preview** SUCCESS, not production deployment.
- Release plan/report, all PR issue discussion (15 comments), PR body/review metadata and original Section80/A–X reviewed. Older M5 totals in the top PR body are historical; later M6 and c3bf39f summaries are authoritative for those commits. There is no current five-case Website/POS failure; the five/eight older failures and old conditional POS non-execution remain historical.
- Subscription gap is real: `tests/prisma/subscription-payment.test.ts:87` remains `it.fails`. `charge.failed` changes PENDING→FAILED; `activateSubscriptionForPayment` rejects FAILED (`PAYMENT_NOT_PENDING`), with transactional PENDING-only update; webhook catches this as503. Subscription verify returns stored FAILED before provider verification. Characterizations and the expected failure are not resolution. Terminal/retry/refund/idempotency policy requires separate authorization; no change in this milestone.

## Remaining mandatory stages and dependency-safe order

| Stage | Existing verified subset | Remaining acceptance | Dependencies / evidence gap |
|---|---|---|---|
|1 Foundation/Lite|Safe v1/v2, CAS/history/publication/tenant boundaries; classic/Lite fallback|Authenticated cookie/browser isolation, complete edit/preview/rollback/archive lifecycle, asset ownership and measured publication budgets|M7 addresses only the browser slice below; durable asset proof needs approved storage, all lifecycle cases still mandatory|
|2 Motion/recipes|Actual lazy Motion14.1.0; four finite primitives/live constraints;124 fixture browser checks|Complete reusable category-specific hero/product/content/service/gallery/location/commerce recipes, accessible touch/keyboard interactions, sliders/parallax/storytelling/choreography, full failures/budgets|Build on safe schema/renderer/owner approval; no duplicate GSAP without distinct reviewed need and payload proof; actual device evidence open|
|3 AI/diversity|20 real Lite geometries; deterministic semantic direction and owned-history gate|Grounded richer content/design reasoning, creative/brand controls, privacy-safe platform diversity, real quality/uniqueness tests|Independent registered recipe/content work possible; actual external AI quality needs authorized configured calls. Palette/name shuffle is not diversity|
|4 Image Studio|Local source/container/MIME/EXIF1–8/alpha/cancel preparation and29 pixel checks|Durable originals/separate derivatives/provenance/CDN, actual provider enhancement/consistency/role assignment, physical Android/HEIC/memory|Storage approval DEFERRED; provider-dependent acceptance BLOCKED. No new originals inline in Neon. Physical devices unavailable, not replaced by emulation|
|5 Immersive|Bounded embedded/static GLB safety and optional dev-only viewer/manual controls/fallback22|Authorable commerce-bound scenes/SKU assets/worlds/editor, compression/textures/animation, supported and justified WebGPU path, public progressive enhancement|Configuration/editor safeguards can be independent; production ingestion/tenant assets/public activation depend on approved durable storage; real GPU/device/network measurements open|
|6 Commerce/ASK JATA/POS|Real-DB handler Website17/POS22; payment/signature/amount/tenant tests|Actual authenticated browser owner/customer journeys across types, immersive→product/ASK JATA/order/booking/provider payment/POS; authorized retry policy|M7 proves a provider-free owner/customer slice only. No provider settlement, complete ASK JATA/POS browser or live-charge evidence|
|7 Adaptation/analytics|Finite lazy fallbacks, bundle entry measures, existing analytics|Measured runtime/mobile adaptation, privacy-safe performance events/history, publication/optimization/quality budgets and real CWV/device/network evidence|Build on stable recipe/render/customer baseline, use measured feedback, not UA names/hardware-only scores. Physical low/mid/modern Android and network conditions NOT RUN|

Cross-cutting: all original acceptance remains mandatory;Current2026-10-12 read-only audit reports19 advisories (16 high/3 moderate), including2 in the production dependency tree (source-map-js high/Next moderate); pinned narrow patches/call-site triage and Actions/runner drift remain mandatory; intended/inherited diff review and explicit merge/production authorization still required. No infrastructure/database replacement or paid service activation.

## Why M7 is next

Existing E2E files call handlers with mocked `getSession`/`next/headers`; customer payment uses non-production test settlement. They never navigate an authenticated Next browser, verify an actual HttpOnly cookie, load the dashboard/preview iframe, or operate the design/publish/booking UI. A green handler suite cannot close this gap. Proving the existing foundation through real HTTP/browser/native DB is independent of storage and a prerequisite for safely expanding category recipes.

## M7 gate — functional scope

`npm run test:browser:studio-authenticated` starts a temporary **production-mode Next HTTP server**, not a deployment. It uses actual register/login routes and server-issued cookies, actual APIs/UI and native Prisma against the disposable workflow database. No auth mocks, session-token signing/setCookie shortcuts, application QA endpoint or production payment bypass is introduced. The audit also reproduced/fixed home metadata selecting live SEO for an authorized published draft and throwing on experience-load failure: it now matches the existing renderer permission/draft preference and classic/noindex fallback, with8 focused unit cases; no permission/payment policy changes. Native gate later exposed service-only category readiness requiring Product rows for a Service catalogue: fixed without dummy products, preserving mixed commerce+booking/billing guards;15 category/negative tests and3 exact-reviewed-schema cases cover this. Failed-run diagnostics and current pending correction are retained in the release report.

Representative **retail, restaurant/food and salon** flows:

1. Actual HTTP registration; HttpOnly/Secure/SameSite cookie and JS invisibility; anonymous refusal.
2. Owned profile and catalogue writes through HTTP; safe structured v2 draft generation, registered composition, actual source IDs/prices.
3. Local existing decorative SVG URL only; **no media upload API, original binary, storage/provider operation**. All fixtures explicitly QA/synthetic.
4. Unpaid publish UI403/PAYMENT with no publication; real design UI edit/onBlur save and monotonic persisted revision; stale CAS409 with unchanged data.
5. Actual same-origin authenticated draft iframe at390/1280px width caps (actual responsive iframe viewport checked), noindex/readable/non-overflow, preview isolation; anonymous/foreign `?preview=draft` cannot see draft.
6. **Synthetic database entitlement fixture**, explicitly `providerVerified:false`, to exercise the server paid/entitlement/publish gate. NOT Paystack verification/settlement evidence. Reviewed UI publication, immutable version, actual live customer page, explicit Lite/no Motion/Three request and mobile no-JS catalogue/contact HTML.
7. Post-publication draft changes remain invisible to customers; published-version restore only changes draft/monotonic revision, never live.
8. Retail/food: actual mobile cart visibility and checkout navigation; real HTTP quote ignores forged client prices. **No order/payment initialization**, blocked by request allowlist; payment/provider acceptance NOT RUN.
9. Salon: actual browser slot selection, zero-deposit booking, persisted tenant/service/unpaid data, owner booking board via authenticated HTTP. No deposit/provider payment.
10. Cross-tenant read/edit/publish/history/booking refusal and unchanged foreign state; foreign dashboard not-found/noindex/no design leak; materially distinct rendered information architectures without palette/family-name scoring.
11. Expired entitlement refuses publication while preserving content; logout removes cookie/access, actual password-login UI restores only owned access; exact-ID cleanup; uncaught browser errors or prohibited requests fail the gate.

### Fail-closed test boundaries

- Requires `STUDIO_BROWSER_TEST_WRITE=1`, BOTH database URLs equal, exact loopback `jata:jata` PostgreSQL5432 `/jata_e2e` with only optional `schema=public`, known workflow auth secret, native client and production BUILD_ID/Chrome.
- Refuses remote/production/alternate databases, provider/storage credentials/configuration, `.env*` files (except non-loaded `.env.example`), native downloader/engine-less overrides. The harness chooses its own local origin/port; no caller-supplied deployment URL.
- Browser allows only that origin and explicit auth/editor/catalogue/quote/zero-deposit booking/analytics API methods. Media/image providers/checkout initialization/payment verification/admin mutations/external requests refused and counted as failures. No intercepted provider response presented as genuine acceptance.
- Tests do not alter application auth/payment/tenant policy. Direct Prisma writes are only labelled isolated entitlement fixtures and expiry; cleanup uses exact run-created IDs, never global/prefix deletion. Server/browser always stop; cleanup failure fails the gate.
- Missing prerequisites exit2 **BLOCKED/NOT RUN**, not a passing/skipped browser suite; CI treats that as a failed required gate.56 unit tests cover unsafe targets/credentials/loaded files/request methods and test-only/no-session-bypass boundaries, including ONLY GET on the existing server-owned/local-only history/health diagnostics; all their mutations stay blocked. Real cross-tenant refusal cases cover both newly allowed reads.

## A–X acceptance register (no gate waived)

These are audit assessments, NOT final certification. M7 fresh CI evidence is recorded in the release report after its source push.

| Gate | Current evidence and remaining gap |
|---|---|
|A Existing functionality|1952 native passes +known expected failure; Website17/POS22 at c3bf39f. All products/full authenticated/device regressions still required|
|B Structured experience|v1/v2/schema/API/20 Lite families verified; M7 tests real HTTP generation. Full recipe/business-type generation open|
|C AI design direction|Deterministic semantic policy/artDirection and safe provider boundaries; richer contextual AI and actual provider quality open|
|D AI appropriate composition|Content/intent-led20 families tested; full contextual AI and end-to-end semantic quality not certified|
|E Material diversity|20 actual fixture geometries; own-history gate, M7 representative information architecture check. Platform-wide privacy-safe diversity and real customer variety open|
|F Regeneration|Native API/editor preview/reviewed apply/history tested; richer controls and full authenticated regeneration UI cases remain|
|G Lite|SSR/family/motion guards tested; M7 actual business customer/no-JS slice. Complete device/commerce acceptance open|
|H Motion|124 real fixture checks/scoped lifecycle. Full recipe/choreography +actual authenticated Motion owner/device journey remains|
|I Immersive supported|Dev-only GLB22, public gateOFF. Production asset/public scenes/support/measured capability BLOCKED/open|
|J Immersive fallback|22 fixture context-loss/unsafe/preference tests; production and physical-device/world fallback still required|
|K Android photo upload|Local29 real codec pixels +mock legacy flow; physical phones and durable-original end-to-end NOT RUN/BLOCKED|
|L Image provider works|Abstraction/local representative artwork is not professional/product-consistent provider proof; actual configured calls BLOCKED|
|M Assign generated image roles|Existing owner asset/edit controls; actual provider→accept/reject→assign durable tenant asset journey BLOCKED|
|N Tenant real products|Native catalogue/price tests; M7 actual HTTP/browser/native IDs/prices. Full immersive SKU references/cross-asset proof open|
|O ASK JATA grounding|Existing tenant retrieval/entitlement tests; full actual data/authenticated browser and provider-assisted path not certified|
|P Commercial actions|Existing routes/contact links/order/booking tests; M7 actual cart/quote/zero-deposit booking and contact URLs. Live external intent/provider order/world journey open|
|Q Payment authority|Existing HMAC/reference/amount/currency/status/idempotency tests; expected FAILED-subscription retry gap unresolved. M7 synthetic entitlement is NOT payment proof|
|R POS intact|22 native handler cases +other POS suites; complete real browser/immersive/POS/provider journey open|
|S Paid publication|Native refusal/CAS/expiry tests; M7 actual cookie/UI/foreign/unpaid/expired slice. Full plan/provider publication lifecycle still required|
|T No giant mandatory download|Lazymini4876 B absent initially; measured entry sums only, real total payload/public asset/device budgets open|
|U Neon not binary store|Legacy inline derivatives remain. Owner DEFERRED object/CDN approval; immutable originals/separate derivatives BLOCKED. No inline-original substitute allowed|
|V Absolute isolation|Native/mock tenant/config/history/AI/POS tests; M7 real cookie/browser tenant slice. Asset/provider/public3D/complete all-role evidence open|
|W Low-end Android usability|360px touch/no-JS/emulated browser checks only. Physical representative low/mid/modern phones, slow/average/fast networks, memory/CWV NOT RUN|
|X Tested/pushed|Source5f0a298 actual M7 native133/2034+1 expected/17/22/358 PASS; earlier React418 repeatability still open. Engine-wide mandatory acceptance/security/inherited diff review not complete|

## Verification / reproduction / exact next action

CI `.github/workflows/interactive-business-e2e.yml` runs the required authenticated production browser gate after native migrations/seed/suites/connected build/isolation and before development fixture browsers. Success comments record actual counts and feature/runner SHAs; failure comments preserve its output. No workflow/fixture missing-dependency skip is accepted as green.

Local lint/types/full unit/mocked suites/schema validation/offline production build and existing browser regressions are separate evidence. Local native/authenticated DB journey is BLOCKED in this sandbox (no configured native database; restricted engine-download host). Do not set a production URL or bypass the boundary to manufacture local results. CI uses only the existing disposable Postgres service, never Neon/Vercel deployment secrets.

Exact next action: controlled SSR/navigation/seed reproduction with retained page/stack diagnostics; an earlier React418 remains unresolved despite TWO source-equivalent133/133 passes (5f0a298 CI38212669278; evidence-only58829dd CI38213614397). On recurrence, diagnose/fix/regress actual SSR mismatch, not suppress it. Current production dependency advisory pin/lock/call-site triage remains mandatory. After stable foundation, implement the next small registered **category-specific recipe** slice through existing versioned schema/renderer/editor, starting restaurant/menu +salon/service +retail/catalogue reusable interactions, with failure/reduced-motion/touch/no-JS/tenant/price tests and this authenticated gate as regression. Do not conflate the M7 test gate with delivery of those missing recipes or all of Section80. Physical Android/provider/complete payment/ASK JATA/POS/immersive journey gates remain open. Storage stays DEFERRED; no merge/production deploy/data changes authorized.


## M8 hydration regression / ordered follow-up

Phase1 read-only exact45e537c/current native results verified before edits. Actual BookingClient UTC-server/Nairobi-client mismatch reproduced BEFORE fix (serverMon12Oct→clientSun11Oct, real ChromeReact425/418/423;4 new unitFAIL). Root cause browser-local midnight→UTC key plus independent clock; BookPage now supplies deterministic server14-day calendar.12 unit/25 actual isolated-browser checks PASS; native runner adds Nairobi visitor and27 real SSR route/timezone checks +3 server/client booking-label equality checks. No hydration suppression, client-only HTML, app QA route or auth/slot/payment bypass. Historical unlocalized418 attribution remainsOPEN; current diagnostics/error gate retained. Details in WEBSITE_STUDIO_HYDRATION_INVESTIGATION.md. Native correction-head pending; after verification, complete advisory matrix/remediation before functional business-recipe slice. Provider/physical/full-engine gates unchanged.


## M8 verified hydration / scoped dependency gate

Phase2actual db853d6/CI38218114522 PASS:2054+1expected/Website17/POS22,163actual cookie/native (27SSR timezone visits+3calendar equality),25isolatedSSR,358otherbrowser/HTTP. Proven actual booking defect and2 shop SSR defects fixed, historicalunlocalized418 not retroactively attributed. Phase3 latest targeted dependency fixes reviewed per WEBSITE_STUDIO_DEPENDENCY_ADVISORIES.md: production0 PASS/full10highDEV FAIL,13compat regressions/exactCSSbytes unchanged; native correction-head pending. CI production gate is NOT full-security approval and prints residual full-audit failures. No storage/provider/engine completion claim; Phase4 recipe slice remains pending verification/gating decision if broader migration is necessary.


## M8 business recipe acceptance extension (pending native)

UserProceed authorizes recipe work with full10highDEV advisory gateOPEN/FAIL (production0nativePASS at7ad09de CI38220541803). Required real-cookie runner now verifies3 exact registeredv1 configs/defaultownedsource, rawunknown config400/no overwrite, actual owner checkbox saves/hide-show fields in390/1280private noindex preview, unchanged prices/no salon dummy products, reviewedJSON/version/history, public recipe/facts,360no-JS/no-overflow, stock/duration/search no-match/recovery and foreignrecipePATCH403. No provider payment claim from synthetic entitlement, no runtime/tenant/financial assertion removed.23 unit/schema/SSR cases/local2023PASS+108DBSKIP do not substitute for pending native. Scope/remainingcategory13/fullrecipe-world acceptance in WEBSITE_STUDIO_BUSINESS_RECIPES.md; alloriginal108/A–X/7stages/security/provider/device obligations retained.

## M8 Phase4/5 actual native acceptance (not full-engine certification)

Verified sourcea622a8c/CI38224011179/job114726938117/runner8ddbf8850a2eb537bc3921e36598295b362f422e/bot6120715247 SUCCESS. Native2090PASS+1expected/172files,Website17/POS22,authenticated210 (real owner recipe editing/private preview/customer controls +all old guards),isolatedSSR25,otherbrowserHTTP358; validation/generation/migrations/seed/connectedbuild/lint/types PASS. Production dependency0 PASS/full10highDEV FAIL. Historical aggregate418 not conclusively attributed; concrete booking defect fixed/regressed. First3 catalogue recipes accepted for this scoped evidence only; other13 categories/fullHero/world/provider/device/payment/ASK JATA/POS/completeSection80/A–X remain OPEN/BLOCKED/NOTRUN. M8_HANDOFF lists exact facts and next professional service/enquiry recipe. No merge/production/storage/provider authority change.

## M8 session recovery / recipe-layout acceptance extension (pending native)

Recovery verified: prior `arena/7b28a123-jata-aftercall` **a622a8c** (CI38224011179 SUCCESS 2090+1 expected/17/22/isolation9) fast-forwarded onto session branch `arena/8e301eea-jata-aftercall`; nothing discarded. Phase2 regressions (booking timezone/midnight 12, shop SSR boundary 4, shop rendering 4) PASS locally at recovered source; mandatory shop-route SSR assertion retained in the authenticated gate. Phase3 re-audit matches the recorded matrix exactly: production audit0 PASS/exit0, full audit FAIL 10 HIGH development rows/exit1 (braces/glob 7 + extract-zip/browser 3), targeted overrides only (`npm ls` 0). Full dependency-security acceptance stays **FAIL/OPEN**.

Recipe-layout slice adds registered structural presentations only (`retail-stock` product-grid/product-list, `food-menu` menu-list/menu-board, `salon-booking` service-list/service-grid) through the same raw-PATCH-before-normalization parser, CAS/ownership guards, exact reviewed publication/history and public/private renderers. New menu-board and service-grid geometries plus `data-recipe-presentation` are asserted by 10 unit/schema/SSR cases; monetary/option/cart/booking/enquiry/payment/entitlement rules unchanged and regression-proven (unregistered/foreign/authority layouts fail closed). Required cookie runner additionally exercises the real `Recipe layout` select per category, persisted config without publication, private preview presentation, and exact published public + no-JS 360px presentation with the alternate layout left set through publication. Local full 2032 PASS/69 DB-e2e SKIP/2101. Native correction-head result must be recorded from a green CI run before this extension counts as accepted. All A–X gates, storage DEFERRED, durable originals/provider activation BLOCKED, no merge/production deployment/data operations.

### Native result for the recipe-layout extension (verified head 431d9ba)

CI38232032118 SUCCESS on source431d9ba: native 2100 PASS+1 expected/2101, authenticated production HTTP/browser/DB **231/0** (recipe layout select saves, persisted configs, preview/public/no-JS exact presentations across retail/food/salon included), Website17/POS22/isolatedSSR25/Motion124/immersive22/layout7/families167/raster29/isolation9 all PASS. Production audit0 PASS; full audit10 HIGH dev FAIL printed (unchanged). A source-equivalent prior run (38231732932) hit a transient Puppeteer CDP crash in the dev-fixture families script after green authenticated/ native gates; final-head run re-passed that step 167/0 — recorded, not suppressed. Recipe-layout acceptance stands for this scoped evidence only; all A–X/7-stage/security/provider/device obligations remain.
## M9 professional enquiry gate extension (native pending)

Fourth real-owned professional fixture with quote/nonbookable Service +actual fixed consultation, not Product dummy. Required runner tests existing owner edit/recipe/guardedpreview/unpaid/publish/version/live/source fields, professional facets, actual request-only form201→native lead row→owner board, unchanged retry200/change409, anonymous/foreign/authority denial, no appointment/order/payment/marketing, no-JS contact and fixed zero-deposit booking via unchanged old route. Strict disposableDB/config/API write guards and final runtime/no-provider/media cleanup retained; `/api/storefront/enquiry` ONLYGET/POST explicitly permitted, appGET itself owner-guarded.5realDB tests localSKIPPED/91focus andfull2062PASS113DBskip not native acceptance; source-headCI pending. Four pre-fix routing FAIL recorded; no auth/price/availability/deposit guard weakened. Professional page requires real Service IDs; historicalold418 still unlocalized, storageDEFERRED/providersoriginalsBLOCKED/all108+7stages+A–X remain.
### M9 reconciliation / professional refusal path (2026-10-12)

Professional recipe source reconciled via cherry-pick **677b883** (of c3c9563a) with both sessions' runner checks retained (their professional fixture + the recipe-layout select/presentation checks); merged registry registers professional-enquiry layouts [service-list, service-grid]. Fix commit **34932c6** hardens the anonymous-draft refusal (404 before parsing; integration covers the exact DRAFT/null state; runner check now prints status/leads/error) and records frame paths in pageerror evidence. Native result for this reconciliation is CI **38239851857** (result recorded in the release report and PR #43 verification comment). The `professional: anonymous unpublished enquiry refused without a ledger write` check remains mandatory and unweakened; if it still fails, the new detail line localizes status-vs-ledger immediately. All other A–X/provider/security/device obligations unchanged.

M9 native result: CI **38240649221** (f2040f5) authenticated journey **329/0** including the professional refusal check (origin-guard fix), Website17/POS22/SSR25/Motion124/immersive22/layout7 all PASS; family script hit the known transient CDP `newPage` crash after 5 PASS (infra, not a check — same class as 38231732932), raster/isolation NOT RUN in that run; re-verified by the evidence-commit run below. Native 2147+1 expected/177 files.

M9 acceptance run: CI **38241827981 SUCCESS** on **07fe406** — complete gate including families 167/0 and raster 29/0 and isolation 9/0 (the transient `newPage` crash did not recur; one-retry guard in place). Authenticated 329/0 with the professional refusal check mandatory and passing. Scoped evidence only; provider/payment/device/full-engine/security obligations unchanged.

### M10 — final-head verification + technical-enquiry slice (2026-10-12)

Final-head CI for exact `b3522d4`: run **38242804389 SUCCESS** (native 2147+1 expected/177, authenticated 329/0, Website 17/POS 22/SSR 25/Motion 124/immersive 22/layout 7/families 167/raster 29/isolation 9). #418 did not reproduce in that run — recorded as a passing run only; the intermittent issue stays OPEN with the new structural-class evidence and the `hydration-structure-probe` regression net (10 cases). M10 adds the `technical-enquiry` recipe slice (explicit two-category enquiry set, 5th native fixture with QUOTE service + fixed consultation, request-type facet labels, ledger/refusal/no-JS checks generalized) — **native acceptance pending the verification run recorded on PR #43 for the M10 head**. All existing mandatory checks stay mandatory and unweakened; provider/security/device obligations unchanged.
