# Final release readiness

**Verdict: NOT READY — do not promote or declare complete.**
**Assessment date:** 2026-10-31 UTC
**Code base inspected:** `044ca8a948cdc058a2b992a4e9a7d405d3b2c3c3` (PR #76 merge).
**Working branch:** `arena/115a62e1-jata-aftercall`.
**Scope note:** this final report reflects source inspection, current GitHub PR metadata, read-only Vercel control-plane responses, and connected Gmail correspondence. It is not a complete browser, native DB or payment-provider acceptance run.

## Executive summary

This checkout contains a broad Next.js/Prisma/PostgreSQL product surface: **123 page routes**, **141 API route handlers**, and **371 test files**. Static search matched 196 app/component files with interactive patterns. Those are repository scale indicators, not passed control-by-control functional tests.

Four reproducible issues were corrected safely: three stale public-domain references (QR fallback, PWA install instruction and `.env.example` guidance) plus a mobile marketing-navigation label visibly clipped in the existing 320×568 screenshot. The CSS now prevents nav labels shrinking and the marketing test suite pins the wrapping contract. A dedicated QR origin test was added. The fix has a passing real-Chrome six-viewport capture workflow on candidate code SHA `0cd537d5f273048ec8da8c6560be2342b9786eb1`; its artifact was generated but could not be downloaded for pixel review. On intermediate docs-only head `d799ac6ac701efc174d7908ee7f7e7da0227641d`, a repeated route-level motion-evidence job timed out on one observation; its screenshot/recording upload steps succeeded. A subsequent tested report-only head `e01e508f02afd9f6d11a52e5338d8411b7b096bd` passed the route-level motion capture workflow. The supported Vercel/Neon/Paystack architecture was preserved. No production DB, DNS, mail, environment, payment, storage or production deployment action was taken; Vercel automatically canceled the preview build under the existing ignored-build-step setting.

**Release remains blocked** because comprehensive financial/security/product acceptance is still incomplete, durable customer upload runtime is unverified, live official-domain state has conflicting DNS control-plane evidence, and PR #78 plus PR #77 have a failed `programme-completeness` check. An intermediate rerun timed out on one motion observation, but the latest full capture workflow on tested head `4ffaa9c86f86ba02ab759d5e8362d2e826f82ac8` passed. Do not infer readiness from merge status, Vercel `READY`, or a partial set of passing candidate workflows.

## Workstream verdicts

| Workstream | Status | Evidence / open item |
|---|---|---|
| A — Frontend/clickable controls | NOT TESTED | Static register covers main families; not every rendered control was clicked. |
| B — Backend/database | PARTIAL PASS / NOT FULL ACCEPTANCE | Disposable PostgreSQL migration/schema and candidate database journey workflows pass on code SHA `0cd537d`; production data, broad tenant/API/security acceptance and provider state are untouched/unproven. |
| C — Fintech/payments | NOT TESTED | Source and targeted test coverage exist; no provider/ledger end-to-end run. |
| D — Auth/security | NOT TESTED | Security suites exist; no live two-tenant direct API/session test this turn. |
| E — Website Studio/media | BLOCKED | Adapter/tests exist; durable storage config, upload persistence and publish runtime not proven. |
| F — POS | NOT TESTED | Significant test surface; no browser offline/reconnect/ledger reconciliation run. |
| G — UX/responsive/motion | PARTIAL / OPEN | Final report-only head real-Chrome six-viewport and route-level motion capture workflows pass; an intermediate run timed out once. Pixels were not downloadable for review; full keyboard/reduced-motion/A11y/control coverage remains open. |
| H — Domain/Gmail | FAIL / BLOCKED | Gmail records and Vercel project metadata reviewed; apex DNS/name-server values conflict and email record repair unconfirmed. |
| I — Integration/independent QA | BLOCKED | Full-suite, disposable DB, migration/build, journey, six-viewport browser, route-level capture and static workflows pass on application-code SHA `0cd537d` and latest report-only head `e01e508`; `programme-completeness` still fails on tested branch head `4ffaa9c`. Not comprehensive customer acceptance. |

## Issue totals (bounded findings only)

- Reproduced/fixed code/UI issues: **4** (P2): three stale URLs and one clipped narrow-screen marketing-nav label.
- Reproduced new P0 security/financial defects: **0**. This is **not** a P0 pass; critical checks remain untested.
- Open explicit acceptance/operational entries in remediation register: **7**; the count does not include every missing control-level browser test.
- Priority register entries: P0=2 acceptance gates, P1=4 blockers, P2=5 findings/acceptance items (four fixed code/UI findings plus a remaining browser-evidence gate). Status counts do not mean those gates were executed.

## Domain and Gmail

- Registration email dated 2026-10-08 establishes one-year HOSTAFRICA registration and due date 2027-10-08.
- HOSTAFRICA ticket #9761478 reports Vercel A/CNAME updates and then a generic “DNS updated successfully”; the owner subsequently asked for mail-record restoration/final zone details. Gmail evidence does not establish final MX/SPF/DKIM/DMARC values or successful delivery.
- Read-only Vercel project listing marks apex, www and the existing Vercel host verified/assigned, and lists a `READY`/`PROMOTED` deployment. Domain-config responses disagree on apex nameservers and A values and carry `ipStatus=required-change`; live HTTP/TLS was not tested.
- Domain report and owner follow-up steps: `DOMAIN_FORENSIC_AUDIT.md`. No DNS or production config changed.

## GitHub / PR evidence

PRs #58, #59, #63, #64, #65, #68, #69, #76 and #77 are `MERGED` per current GitHub metadata. PR #77 merge commit `847459b50726f4202496283cbbb9fb1b620d10b8` is described as partial/not release-ready; its `programme-completeness` check failed. PR #76 merge commit is the audit source baseline; read-only Vercel production listing reports it READY/PROMOTED. This work is on open PR [#78](https://github.com/POWERBot-1/Jata-Aftercall/pull/78). Its candidate code SHA `0cd537d5f273048ec8da8c6560be2342b9786eb1` passes full-suite, static/typecheck, disposable PostgreSQL, migrations/schema, journey, real-Chrome capture and build checks; `programme-completeness` remains failed. Vercel skipped/canceled the preview build via the pre-existing ignored-build-step rule. PR #78 remains open and unmerged. None of these statuses establishes full launch criteria.

## Exact code changes in this branch

- `lib/qr.ts`: default AI QR origin corrected from `jata.co.ke` to `jataaftercall.co.ke`.
- `app/install/page.tsx`: public install guidance now links to the official domain.
- `.env.example`: obsolete future-domain comment replaced; existing Vercel host remains labeled as operational reference.
- `app/globals.css`: prevents mobile marketing navigation labels from flex-shrinking into clipped text.
- `tests/unit/qr-domain.test.ts`: three tests for default, configured and explicit origins.
- `tests/unit/pwa-marketing.test.ts`: regression contract for intrinsic navigation label sizing and mobile wrapping.

## Verification performed in this workspace

- `npm ci --ignore-scripts --no-audit --no-fund`: PASS (578 packages installed; scripts intentionally skipped, so the generated Prisma client was absent).
- `npx vitest run tests/unit/qr-domain.test.ts tests/unit/pwa-marketing.test.ts tests/unit/url.test.ts tests/unit/homepage-plan-cards.test.ts`: PASS, 4 files / 47 tests.
- `npx eslint app/install/page.tsx lib/qr.ts tests/unit/qr-domain.test.ts tests/unit/pwa-marketing.test.ts`: PASS, no diagnostics.
- `npm run lint`: PASS, 0 errors / 49 warnings in unrelated existing files.
- `git diff --check`: PASS.
- Local `npm run typecheck` and `npm test` were blocked because `npm ci --ignore-scripts` left Prisma Client ungenerated; the Prisma engine download could not establish TLS from the sandbox. This is distinct from CI: the candidate's generated-client typecheck and full suite passed remotely.
- First PR candidate SHA `34a18a2bf7541688cab7d3941b4e5daf00be201f` exposed an ES2017-incompatible dotAll regex in the new marketing contract test. The test was corrected in candidate code SHA `0cd537d5f273048ec8da8c6560be2342b9786eb1`; the subsequent exact-SHA workflows pass apart from the completeness gate.
- On candidate code SHA `0cd537d5f273048ec8da8c6560be2342b9786eb1`, GitHub reports passing [static/typecheck](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941247), [full suite](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941345), [schema/types/unit/build](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941253), [disposable PostgreSQL migration](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941245), [DB journey and migration guard](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941278), [six-viewport real-Chrome capture](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941290), [motion capture](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941314), [schema reconciliation/build/failure-control](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941247), and [D2 build/audit](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941245). On intermediate docs-only branch head `d799ac6ac701efc174d7908ee7f7e7da0227641d`, core jobs passed but [route-level motion capture](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41248309034) timed out once on a 10-second Puppeteer wait; screenshot/recording uploads succeeded. On subsequent report-only head `e01e508f02afd9f6d11a52e5338d8411b7b096bd`, all relevant workflows passed except `programme-completeness`: [full suite](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41249475620), [static/build/schema](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41249475550), [database migration/rehearsal](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41249475548), [journey](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41249475588), [six-viewport Chrome](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41249475572), [schema/types/build](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41249475758), and [route-level capture](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41249475567) passed; `programme-completeness` failed ([run 41249475609](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41249475609)). On branch head `4ffaa9c86f86ba02ab759d5e8362d2e826f82ac8`, GitHub also passed [full suite](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41250559620), [static/typecheck/build/schema](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41250559666), [disposable DB and D2](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41250559607), [DB journey](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41250559685), [six-viewport browser](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41250559680), [schema/types/unit/build](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41250559627) and [route-level motion capture](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41250559679); `programme-completeness` remains the sole failing check ([run 41250559664](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41250559664)). No release gate was weakened.
- Vercel's preview check passed as a provider integration status, but the build was canceled by the existing ignored-build-step command for non-production branches. No preview site was built, no production deployment occurred. The successful Chrome screenshot artifact could not be downloaded from GitHub artifact storage because that host is outside the sandbox's allowed egress; therefore generated artifacts exist according to CI, but their pixels were not visually reviewed.
- The older PR #76 head SHA `b76428b83fe896376f39850f5ac9fa42ad4c8b69` checks remain historical only, not evidence for this candidate.

The exact tested application code is identified by SHA `0cd537d5f273048ec8da8c6560be2342b9786eb1`. Subsequent audit-document-only changes do not change runtime code.

## Required before any READY decision

1. Resolve HOSTAFRICA/Vercel DNS disagreement and verify preserved email routing and authoritative record export; test HTTPS/TLS externally.
2. On isolated fixtures, run exact-SHA tests: lint, typecheck, complete unit/integration/security, disposable native PostgreSQL migrations, and browser E2E.
3. Establish auth/session/direct API and two-tenant isolation, verified-payment activation and webhook idempotency, financial reconciliation, POS offline sync/refund reports, and subscription expiration gating.
4. Prove durable Studio media upload, persistence, access policy and publication with approved non-production storage.
5. Capture and inspect real browser screenshots/recordings at all six required sizes, reduced motion and accessibility states; crawl all critical controls and verify errors/retries.
6. Resolve the `programme-completeness` failures on PR #77 and current PR #78, or provide a superseding verified gate on a new exact candidate. No gate may be weakened.
7. Obtain separate owner approval for any production DNS/email/provider/environment/migration/deployment/storage change; none is authorized by this work.

The official domain is intended, not fully accepted. The existing Vercel reference remains valid operational context. JATA AFTERCALL remains separate from JATA Qi and TANYA-AI.
---

## Addendum — release remediation batch (2026-10-31)

The historical assessment above remains intact; this addendum supersedes its “no new P0 defect reproduced” statement for the current remediation worktree only.

- **P0 media cleanup defect reproduced by source/test contract:** durable upload persisted a public URL but not the provider identity/object key, and both single and generation DELETE paths removed only MediaAsset rows. This left managed object bytes without application cleanup and could strand storage/quota. New durable uploads now persist nullable `storageProvider`/`storageKey`; single and generation cleanup is tenant-prefix checked, provider-matched, attempted before metadata deletion, and returns a retryable 503 while retaining metadata when cleanup fails. The new additive migration `20261125000000_media_storage_identity` has not been applied to any database; production migration remains prohibited. Historical rows are not backfilled or claimed fixed.
- **P1 provider callback URL consistency fix:** `lib/payments/config.ts` had a separate M-PESA callback-origin fallback that stopped at localhost when `PUBLIC_BASE_URL`/`NEXTAUTH_URL` were missing on Vercel. It now shares `getBaseUrl` with canonical/auth/business URL consumers, preserving explicit origin precedence and using Vercel's stable production host as fallback. STK/C2B construction, explicit intended-domain override and local fallback are covered by tests. This does not verify production DNS or live callback delivery.
- **Focused evidence:** focused Vitest run across media upload/delete/version, storage/R2, payment webhook/security/journey/callback URL, tenant authorization, schema guards and AI image quota — **PASS: 18 files / 221 tests; 1 disposable-PostgreSQL test skipped** because no test DB was configured. ESLint on changed TypeScript files **PASS**. These are repository tests with fake provider behavior except the skipped DB migration test; not real R2, browser, production or live provider proof. The broad run found and fixed a UTC month-boundary race in a quota test fixture; its assertion remains unchanged.
- **Broader local suite:** `npx vitest run` — **FAIL / environment-blocked: 333 files passed, 1 failed, 35 skipped; 3,934 tests passed, 1 failed, 299 skipped**. The sole failure is `tests/unit/autopilot-phase1-hardening.test.ts` attempting `Prisma.dmmf` while the generated Prisma Client is unavailable. `npm ci` installed 578 packages, but Prisma engine download failed with a TLS connection error to `binaries.prisma.sh`; `npm run typecheck` likewise reports missing generated-client declarations. The independent month-boundary race in `tests/integration/studio-image-lab.test.ts` was corrected using fixed fake time; its assertion remains unchanged and all 17 tests now pass in the focused run. These local failures do not establish runtime defects, but a successful generated-client full suite/typecheck is still required on exact candidate CI.
- **Still open:** approved non-production durable provider and upload→persistent-read→publication run; legacy object inventory; domain DNS/TLS/mail; payment/webhook/financial and commission policy acceptance; complete direct-API tenant/session matrix; product journeys, POS reconciliation, control crawl, six-view visual review, accessibility/reduced-motion and accessible browser artifacts. The completeness-gate source confirms the gate requires recorded evidence for every instruction ID; local `check-programme-readiness` reports all 43 entries NOT_TESTED, and the building-instruction history check cannot verify the shallow clone. No gate was weakened. See the active traceability ledger in `REMEDIATION_REGISTER.md`.
- **Current evidence label:** media cleanup source/code **IMPLEMENTED**; fake-provider focused tests **PASS**; PostgreSQL migration / real provider / visual acceptance **NOT TESTED**; owner/provider dependencies **BLOCKED**. Overall release verdict remains **NOT READY**. No production config/data/provider/DNS/email action, production migration, deployment or merge occurred.
- The CI results quoted in the historical report ran on prior SHA `4ffaa9c86f86ba02ab759d5e8362d2e826f82ac8`; they do **not** test these current uncommitted changes. A new exact-SHA CI run is required after the authorized PR #78 update.
