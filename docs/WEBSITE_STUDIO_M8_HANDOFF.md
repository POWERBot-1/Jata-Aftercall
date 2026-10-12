# JATA AFTERCALL — M8 verified continuation handoff

2026-10-12. **ENGINE INCOMPLETE / PR41 OPEN DRAFT / NOT MERGED / production NOT DEPLOYED.**

## 1. Starting and tested implementation identity

- Starting HEAD/remote/PR: **45e537c20ca2b5c78092f706c840fce8870d0fe8**, independently verified clean before source edits. CI38214337060 belongs to that exact commit; old results not attributed to newer work.
- Phase2 proven hydration/shop fixes: b670cd9 → d3d1076 → **db853d6fe4cc1ba8a9275859ab4e145435438264**, verified native CI38218114522 SUCCESS.
- Phase3 compatible security fixes: **7ad09de5220d05b787d18b9f17c576da177e62d8**, CI38220541803 SUCCESS, production audit0/full audit10HIGH DEV FAIL.
- Phase4 tested recipe source: **a622a8cce67d6775baddfdbe455950eea03db599**, exact remote/PR/worktree verified; [CI38224011179](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/38224011179)/job114726938117 SUCCESS, runner **8ddbf8850a2eb537bc3921e36598295b362f422e**, actual [bot6120715247](https://github.com/POWERBot-1/Jata-Aftercall/pull/41#issuecomment-6120715247).
- Documentation delivery/final HEAD identity and its exact-head CI are recorded on PR/handoff receipt, avoiding self-referential commit IDs. No force push or branch switch.

### Metadata reconciliation after the authorization pause

Local Git HEAD/index was restored to original77e35cec while all working files still matched7ad09de. Compared **all701 Git blob identities** with the pushed checkpoint: zero differences/missing/extra visible files, no user edits discarded. Remote already contained the newer verified recipe commit a622a8c. Restored only ref/index to verified7ad09de (no working-file overwrite), then ordinary **fast-forward** to that same-branch remote commit. All706 latest file blobs matched, clean/equal branch/remote. No reset, forced history rewrite, deletion or chat/transient source reconstruction; newer published recipe work preserved, not unnecessarily repeated. This local fast-forward is NOT a PR/main merge.

## 2. Exact changed source files and behavior

### Hydration and real catalogue SSR faults

- `lib/experience/bookingCalendar.ts`:14 deterministic server date keys/English labels, no client clock/timezone/ICU calculation.
- `app/b/[slug]/book/page.tsx`, `components/storefront/BookingClient.tsx`: server calendar supplied after unchanged storefront/ownership check; initial SSR and hydrated date buttons identical; server availability/capacity/past-time/payment rules untouched.
- `lib/experience/catalogue.ts`, `app/b/[slug]/shop/page.tsx`: unchanged tenant-derived price-band arithmetic moved out of a `use client` export; minimal complete public card-data contract/helper.
- `components/storefront/ItemCard.tsx`, `components/storefront/CatalogueClient.tsx`: typed complete card theme/CTA context instead of incomplete data cast to `never`; no draft/owner/workspace serialization.

### Reusable business recipe slice

- `lib/experience/businessRecipes.ts`: registered `retail-stock`, `food-menu`, `salon-booking` v1; exact category/section/version/detail parser; real Product vs Service source, no authority fields.
- `lib/experience/document.ts`, `lib/experience/schema.ts`, `lib/experience/variant.ts`: preserve only validated presentation config; explicit NEW v2 enrollment, old v1/v2 not silently enrolled; wrong category/version/executable/unknown config refused.
- `app/api/experience/route.ts`: raw recipe config checked after unchanged tenant/CAS checks and before normalization; unsupported data cannot vanish and be called a successful save.
- `components/storefront/BusinessCatalogue.tsx`, `components/storefront/Sections.tsx`, `components/storefront/CatalogueClient.tsx`, `app/b/[slug]/shop/page.tsx`: same config/data drives home, shop and draft preview; product grid/menu list/service list, real category details/facets/actions/options/enquiry, no dummy records.
- `components/dashboard/SectionEditor.tsx`: explicit recipe enable/disable and detail toggles, existing heading/layout/hide/move/save/revision UI retained.
- `app/globals.css`: static semantic responsive recipe layouts, optional existing media, useful no-photo treatment, wrapped coarse-pointer actions ≥44px; no mandatory animation/3D/SDK.

### Dependencies, regression tooling and guards

- `package.json`, `package-lock.json`: matching Next/ESLint15.5.27 patch; source-map-js1.2.2, scoped brace-expansion1.1.21/5.0.12, basic-ftp6.2.3, selector-parser7.1.6. React/Prisma/Motion/Tailwind/Puppeteer/Node-engine range retained,17 targeted lock path versions only.
- `.github/workflows/interactive-business-e2e.yml`: required production advisory gate, full audit actual FAIL status, native Prisma validation, isolated hydration regression; old no-skips/connected/cookie/runtime/browser gates retained.
- `scripts/browser/studio-authenticated.check.mjs`: Nairobi visitor,27 real SSR timezone/route probes +3 calendar equality checks, real recipe editor/preview/unsupported/foreign/no-dummy/no-JS/facet/search proof, final zero error/prohibited-request assertions intact.
- `scripts/browser/studio-hydration.check.mts`: actual component/React SSR→Chromium hydration across five timezones/midnight, interactive selection, fail-closed negative control; Link adapter confined to isolated fixture, not auth/native/provider proof.
- Tests added: `tests/unit/booking-hydration.test.ts`, `catalogue-server-boundary.test.ts`, `catalogue-rendering.test.ts`, `dependency-security-compat.test.ts`, `business-recipes.test.ts`, `business-recipe-rendering.test.ts`.
- Tests updated: `tests/unit/website-studio-master-spec.test.ts` retains exact reviewed Next pin +matching lint/lock checks; `experience-diversity-gate.test.ts` requires exact intended seeded food config and full equality for every other content field, no broad filtering/test disable.
- Documents added/updated: this handoff; release report/plan/browser acceptance; `WEBSITE_STUDIO_HYDRATION_INVESTIGATION.md`, `WEBSITE_STUDIO_DEPENDENCY_ADVISORIES.md`, `WEBSITE_STUDIO_BUSINESS_RECIPES.md`.

## 3. Hydration reproduction and root-cause evidence

Before app changes, real BookingClient SSR at2026-10-12T06:24Z rendered **Mon12Oct on UTC server** but **Sun11Oct in Nairobi client**; independent local-midnight→UTC conversion and independent clock generated different initial trees. Real Chromium153 mobile360×740 emitted425/418/423 and replaced the server calendar. New tests failed **4/6** before the fix; after server-snapshot fix all12 calendar/SSR tests and25 actual isolated browser checks PASS, including UTC-midnight rollover and a negative control.

Native added route probes also exposed separate real Shop500s: server calling client-exported priceBandsFor, then missing theme.treatment from unsafe incomplete context. Each actual server/browser stack/digest/root cause recorded before fix; pure shared helper and typed public context have regressions. Native real booking saves,210 authenticated checks and actual server/client labels subsequently pass.

**Historical d72c7bc's original aggregate418 remains unlocalized:** no route/stack/seed was captured at that time; Actions log download attempted/EOF. Do not claim these concrete reproductions conclusively identify that older event. Detailed attempts/limitations are retained in the investigation document, and runtime errors remain a mandatory gate.

## 4. Advisory-by-advisory status

Full19-row package/path/version/GHSA matrix: [WEBSITE_STUDIO_DEPENDENCY_ADVISORIES.md](WEBSITE_STUDIO_DEPENDENCY_ADVISORIES.md). Nineteen affected-package records include inherited parent rows, not19 independent CVEs.

| Status | Affected-package records |
|---|---|
|REMEDIATED (9)|next; source-map-js; brace-expansion (both locked majors); basic-ftp; get-uri; pac-proxy-agent; proxy-agent; postcss-selector-parser; postcss-nested|
|FAIL / OPEN (10 HIGH development-only)|braces; micromatch; fast-glob; chokidar; tailwindcss; @next/eslint-plugin-next; eslint-config-next; extract-zip; @puppeteer/browsers; puppeteer-core|

Production audit **PASS0/exit0**, full audit **FAIL10HIGH/exit1**, both printed by CI. Braces/extract-zip have no compatible patched leaf release; broad Tailwind4/Node22+Puppeteer migration not silently accepted. Trusted repository globs, no archive installs and explicit system Chrome reduce current reachability but are **mitigation, not remediation**. User authorized independent recipes by “Proceed” after this explicit sequencing decision; full-security release gate stays failed/open. No advisory waiver or broader migration authorized.

Scoped transitive-major FTP/selector overrides preserve consumed APIs. Minified Tailwind CSS before/after security changes is **byte-identical** SHA256ec5deb8d496853ab9eee299ede7711d16dccebe3d427a682b2747a81deacd9c3. Recipe CSS additions are intentional and separately tested, not falsely included in that prior equivalence claim. No audit-fix/force or unrelated version churn.

## 5. Regression and acceptance results

Actual source a622a8c CI38224011179:

| Status | Check | Result / qualification |
|---|---|---|
|PASS|Native target unit/integration/security suite|172 files;2090 PASS +1 preserved expected failure/2091,0 skipped; not every unit uses DB|
|PASS|Website Studio / POS native handler journeys|17/17 and22/22,0 skipped; complete provider/device lifecycle not certified|
|PASS|Production-cookie HTTP/native-DB browser|210 checks,0 failed/skipped; real registration/login/HttpOnly cookies/tenant/edit/preview/publication/history/customer controls/cleanup; entitlement SYNTHETIC, not provider settlement|
|PASS|Controlled actual-component hydration browser|25 checks; isolated Link adapter, not native/auth/device proof|
|PASS|Existing browser/HTTP regression|9 isolation+124Motion+167families+22immersive+7layout+29raster=358; synthetic/emulated/local fixtures qualified|
|PASS|Native Prisma/lint/types/schema validation/migrations/seed/connected production build|Pinned stack, disposable Postgres16/15 existing migrations; no production DB or new migration|
|PASS|Production dependency audit|0 findings/exit0|
|FAIL / OPEN|Full dependency audit|10HIGH development rows/exit1; release security not cleared|
|EXPECTED FAILURE / OPEN|Subscription FAILED-payment retry|One inherited `it.fails` remains; verified FAILED→success activation policy unresolved, not changed/approved|
|FAIL (pre-fix evidence retained)|Calendar/server-boundary regressions and first2 native Phase2 runs|4 calendar failures/real418; boundary1FAIL before fix; native117+1 Shop500s; final source fixed/proven, historical logs not erased|
|PASS / SKIPPED LOCAL|Recorded local full suite at recipe source|2023PASS/108DB-e2eSKIP/2131;162PASS/12SKIP files; not inferred as local native proof|
|BLOCKED LOCAL|Native DB/engine download|No approved local DB/native binary host; offline engine=none/WASM validation/build separated from native CI|
|BLOCKED|Persistent originals/storage/providers|Owner DEFERRED; no real upload/provider activation/provision/spend or inline-original substitute|
|NOT RUN|Physical Android/network/memory/CWV; actual provider/payment/complete ASK JATA/POS/world journeys|Emulation/mocks/synthetic entitlement do not close these gates|

Measured gzip entry sums: business116577/editor148767/home106841 B; Motion mini4876 B async, absent from initial entries, installed/locked14.1.0. Not total traffic or CWV/device measurement.

## 6. Completed recipe scope / remaining categories

| Category | Verified first slice |
|---|---|
|Retail|Real products, grid/list, brand/options/availability, search/category/price/stock, authoritative simple cart/options route, editable shared preview|
|Food|Real menu products, grouped list/grid, owner ingredients/portion/prep/extras, dish availability/search/filters/order/options, editable shared preview|
|Salon|Real services even with unrelated products, service list/grid, duration/staff/deposit facts, duration/search/category, booking or enquiry, NO dummy product/stock/cart requirement, editable shared preview|

These are **functional catalogue/menu/service recipe slices**, not complete category stacks/Hero/Product360/ServiceJourney/ASK JATA worlds. Other13 categories have existing profiles/generic behavior, no new registered recipe yet: beauty, fashion, electronics, automotive, realestate, furniture, fitness, creative, professional, hospitality, education, technical, other.

## 7. Outstanding gates / exact next task

Next independently testable implementation: registered **professional service/enquiry recipe** with actual Service-only rows, quote/contact/booking semantics, safe editable facts and same preview/publish/tenant/no-dummy/runtime/native-cookie acceptance. Extend remaining categories methodically; do not claim them complete from profile labels.

Parallel mandatory work: resolve the10 development advisory rows through reviewed upstream patches or separately approved CSS/toolchain migration; preserve historical hydration diagnostics; clarify authorized FAILED-subscription retry separately (no refund/cancel behavior invented). Full Hero/product/content/location/motion libraries, richer grounded AI/platform diversity, authorable commerce-bound worlds/media compression/justified WebGPU, measured adaptation/analytics/performance, physical Android/network/CWV and complete business-type/payment/ASK JATA/POS/immersive/Section80/A–X evidence remain open.

## 8. Safety confirmation

All108 master blocks0–107 and directive unchanged, SHA256 **3bae22f5e38e37b4b429cfc672818544a793457b6ac159de2cfd652429838e42**. All7 stages/A–X remain mandatory. Vercel/Next/Neon/Prisma/auth/tenant/POS/verified payment architecture preserved. No new schema/migration, live payment/refund/cancel policy, production data, new real upload, provider/CDN activation, paid provisioning/spending, merge or production deployment. Storage **DEFERRED**; originals/providers **BLOCKED**. PR41 stays OPEN/DRAFT; engine **INCOMPLETE**.


## M9 continuation (2026-10-12) — professional service & enquiry recipe reconciled

Branch progression: 47f0f6e (clean M8 acceptance) → **677b883** (cherry-pick of c3c9563a "Add durable professional enquiries and service-only request recipe" — durable ledger `lib/experience/enquiries.ts` on AIQualityEvent with idempotent replay/409 conflict, `/api/storefront/enquiry` GET/POST, `/b/[slug]/enquire` + EnquiryClient/EnquiryBoard, book-route request-only semantics, professional-enquiry registry recipe, runner professional fixture, 5 test files, WEBSITE_STUDIO_PROFESSIONAL_ENQUIRIES.md) → **34932c6** (refusal-path hardening: DRAFT/missing experience refuses 404 before document parsing with no ledger write — integration covers the exact runner draft state; runner check `professional: anonymous unpublished enquiry refused without a ledger write` now reports status/leads/error; pageerror evidence includes frame paths; ItemViewTracker render side effect and BusinessPage default-locale formatting fixed; registry tests updated for 4 recipes). Conflicts resolved keeping BOTH sessions' work (BusinessCatalogue keeps `recipeLayoutFor` + their enquire action; runner merges both check sets; docs keep both records; professional registry entry completed with listLayout/layouts).

Local gate at 34932c6: tsc 0, `next lint` 0, `npx vitest run --exclude tests/e2e` **2073 PASS + 74 DB-only SKIP / 177 files** (expected-failure subscription-retry test is inside the skipped DB set locally; CI native shows it as 1 expected fail). Native evidence: 38239851857 (34932c6) localized the refusal failure to the origin guard (status=403); **38240649221 (f2040f5) authenticated 329/0, native 2147+1 expected/177, Website17/POS22/SSR25/Motion124/immersive22/layout7 PASS**, families step crashed transiently at Puppeteer `newPage` (infra, one-retry guard added with the evidence commit; same class as 38231732932). Prior runs: 38232032118 SUCCESS at 431d9ba, 38233198609 FAILURE = first localized #418 reproduction at 47f0f6e docs-only, 38234955080 FAILURE at c3c9563a = the unpublished-enquiry check). Hydration #418: reproduced with route/stack/args (38233198609), elimination log in WEBSITE_STUDIO_HYDRATION_INVESTIGATION.md, issue **OPEN** until resolved with sufficient evidence. Security gate BLOCKED (10 HIGH dev-only, matrix in WEBSITE_STUDIO_DEPENDENCY_ADVISORIES.md); storage DEFERRED; originals/providers BLOCKED; PRs #41/#43 stay DRAFT; no production deploy/data operations; 108 master blocks untouched.
