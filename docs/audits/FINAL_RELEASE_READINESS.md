# Final release readiness

**Verdict: NOT READY — do not promote or declare complete.**
**Assessment date:** 2026-10-31 UTC
**Code base inspected:** `044ca8a948cdc058a2b992a4e9a7d405d3b2c3c3` (PR #76 merge).
**Working branch:** `arena/115a62e1-jata-aftercall`.
**Scope note:** this final report reflects source inspection, current GitHub PR metadata, read-only Vercel control-plane responses, and connected Gmail correspondence. It is not a complete browser, native DB or payment-provider acceptance run.

## Executive summary

This checkout contains a broad Next.js/Prisma/PostgreSQL product surface: **123 page routes**, **141 API route handlers**, and **371 test files**. Static search matched 196 app/component files with interactive patterns. Those are repository scale indicators, not passed control-by-control functional tests.

Four reproducible issues were corrected safely: three stale public-domain references (QR fallback, PWA install instruction and `.env.example` guidance) plus a mobile marketing-navigation label visibly clipped in the existing 320×568 screenshot. The CSS now prevents nav labels shrinking and the marketing test suite pins the wrapping contract. A dedicated QR origin test was added. The fix has a passing real-Chrome six-viewport capture workflow on candidate code SHA `0cd537d5f273048ec8da8c6560be2342b9786eb1`; its artifact was generated but could not be downloaded for pixel review. On docs-only branch head `d799ac6ac701efc174d7908ee7f7e7da0227641d`, a repeated route-level motion-evidence job timed out on one observation; its screenshot/recording upload steps succeeded. The supported Vercel/Neon/Paystack architecture was preserved. No production DB, DNS, mail, environment, payment, storage or production deployment action was taken; Vercel automatically canceled the preview build under the existing ignored-build-step setting.

**Release remains blocked** because comprehensive financial/security/product acceptance is still incomplete, durable customer upload runtime is unverified, live official-domain state has conflicting DNS control-plane evidence, and PR #78 plus PR #77 have a failed `programme-completeness` check. The latest PR #78 motion-evidence rerun also timed out on one route observation. Do not infer readiness from merge status, Vercel `READY`, or a partial set of passing candidate workflows.

## Workstream verdicts

| Workstream | Status | Evidence / open item |
|---|---|---|
| A — Frontend/clickable controls | NOT TESTED | Static register covers main families; not every rendered control was clicked. |
| B — Backend/database | PARTIAL PASS / NOT FULL ACCEPTANCE | Disposable PostgreSQL migration/schema and candidate database journey workflows pass on code SHA `0cd537d`; production data, broad tenant/API/security acceptance and provider state are untouched/unproven. |
| C — Fintech/payments | NOT TESTED | Source and targeted test coverage exist; no provider/ledger end-to-end run. |
| D — Auth/security | NOT TESTED | Security suites exist; no live two-tenant direct API/session test this turn. |
| E — Website Studio/media | BLOCKED | Adapter/tests exist; durable storage config, upload persistence and publish runtime not proven. |
| F — POS | NOT TESTED | Significant test surface; no browser offline/reconnect/ledger reconciliation run. |
| G — UX/responsive/motion | PARTIAL / OPEN | Candidate real-Chrome six-viewport capture passes; latest route-level motion-evidence rerun timed out on one observation (artifacts uploaded). Pixels were not downloadable for review; full keyboard/reduced-motion/A11y/control coverage remains open. |
| H — Domain/Gmail | FAIL / BLOCKED | Gmail records and Vercel project metadata reviewed; apex DNS/name-server values conflict and email record repair unconfirmed. |
| I — Integration/independent QA | BLOCKED | Full-suite, disposable DB, migration/build, journey, six-viewport browser and static workflows pass on code SHA `0cd537d`; `programme-completeness` fails, and the later docs-only HEAD rerun has one route-level motion-evidence timeout. Not comprehensive customer acceptance. |

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
- On candidate code SHA `0cd537d5f273048ec8da8c6560be2342b9786eb1`, GitHub reports passing [static/typecheck](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941247), [full suite](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941345), [schema/types/unit/build](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941253), [disposable PostgreSQL migration](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941245), [DB journey and migration guard](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941278), [six-viewport real-Chrome capture](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941290), [motion capture](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941314), [schema reconciliation/build/failure-control](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941247), and [D2 build/audit](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941245). On later docs-only branch head `d799ac6ac701efc174d7908ee7f7e7da0227641d`, the same core jobs pass: [full suite](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41248309087), [static/build/schema](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41248309031), [database migrations](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41248309063), [journey](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41248309033), [six-viewport Chrome](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41248309066), and [schema/types/build](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41248309105). Two checks fail on that latest head: `programme-completeness` ([run 41248309100](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41248309100)) and [route-level motion capture](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41248309034), where a single motion observation exceeded a 10-second Puppeteer wait in `scripts/motion/route-behaviour-evidence.mjs`; generated screenshot/recording upload steps still passed. No release gate was weakened.
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