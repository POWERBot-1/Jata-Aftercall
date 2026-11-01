# Remediation register

> **Historical snapshot note (2026-10-31):** The initial table/counts below remain preserved as the bounded audit result at that time. The active, expanded remediation programme and current statuses are recorded in the appended traceability ledger; it supersedes only the old summary counts, not the original findings/evidence.

**Audit baseline:** `044ca8a948cdc058a2b992a4e9a7d405d3b2c3c3`. **Current code changes:** three stale public URL references and one narrow-screen marketing-nav clipping defect corrected; targeted QR-origin and CSS contract tests added. The table separates verified code fixes from open validation/owner blockers.

| ID | Priority | Finding | Evidence | Change / disposition | Verification / owner |
|---|---|---|---|---|---|
| D-01 | P2 | AI QR generator defaulted to unrelated `https://jata.co.ke`. | `lib/qr.ts` fallback on baseline. | Fixed fallback to `https://jataaftercall.co.ke`; added `tests/unit/qr-domain.test.ts` for fallback, explicit origin and env origin. | PASS: included in 4-file/47-test targeted Vitest run; no production QR generated. |
| D-02 | P2 | PWA install instructions displayed Vercel URL as the customer public address. | `app/install/page.tsx` baseline text. | Fixed customer-facing link to official domain; preserved Vercel operational reference elsewhere. | PASS: source-contract assertion included in 4-file/47-test targeted run; browser screen not tested in this turn. |
| D-03 | P2 | Environment template described `jata.link` as future domain while owner identifies `.co.ke` as official. | `.env.example` comment. | Updated documentation comment to official intended URL and existing Vercel reference. | Diff/source check; no env values changed. |
| D-04 | P2 | Marketing navigation links flex-shrank so the 320px screenshot visibly cut off the final “Install” label. | Existing browser artifact `docs/agents/evidence/landing-320x568.png`; desktop comparison `landing-1366x768.png`. | Fixed `.mk-nav a` with non-shrinking intrinsic flex sizing and added a mobile wrapping contract test in `tests/unit/pwa-marketing.test.ts`. | PASS: CSS contract is covered by the 4-file/47-test run; real-Chrome six-viewport capture passed on candidate SHA `0cd537d`. On intermediate docs-only HEAD `d799ac6`, one route-level motion observation timed out; its screenshot/recording uploads passed. The next report-only HEAD `e01e508` motion capture workflow passed. Artifact pixels could not be downloaded for visual review. |
| D-05 | P1 / owner blocker | Domain/DNS views conflict and mail repair remains unconfirmed. | Gmail registration/ticket records + read-only Vercel project/domain config; details in `DOMAIN_FORENSIC_AUDIT.md`. | No production change. Keep external URL claims blocked; owner follow up with HOSTAFRICA for authoritative records and mail test. | Owner approval/action; do not change nameservers or email records from this report. |
| V-01 | P1 / release blocker | Official-domain HTTPS/canonical/auth/payment/publish journeys not evidenced. | Vercel metadata is positive but inconsistent config; no live network tests. | Not remediated by code; all live checks explicitly NOT TESTED. | Owner/operator to validate from normal network; no production setting change authorized. |
| F-01 | P0 acceptance gate | Payment → subscription and complete POS settlement/refund/report reconciliation remain unproven. | Candidate SHA `0cd537d` disposable-DB migration/journey and full-suite CI pass; no full payment-provider lifecycle or POS ledger reconciliation. | Not claimed fixed; no real payments used. | Independent synthetic payment/POS tests with explicit reconciliation on a verified candidate. |
| S-01 | P0 acceptance gate | Cross-tenant/direct-API/session authorization not fully executed in this assessment. | Security test families exist; no current-turn isolated accounts run. | No security weakening or production data accessed. | Run negative API/security matrix before release. |
| M-01 | P1 launch gate | Durable customer image persistence/publication runtime remains unverified. | R2 adapter/test/docs exist; no configured storage service exercised. | No bucket credentials or production storage changed. | Owner-approved non-production storage and persistent upload/publish test. |
| U-01 | P2 acceptance gate | Exhaustive clickable-function, responsive, reduced-motion and accessibility browser evidence remains incomplete; generated post-fix screenshot pixels were not visually reviewed. | Static control source count + historical screenshot + passing candidate SHA `0cd537d` real-Chrome six-viewport workflow. | Fixed one documented nav clipping defect; six-viewport capture workflow passes, but artifact download is blocked by sandbox egress. | Review the generated artifact when accessible and complete keyboard/reduced-motion/A11y/control crawls. |
| CI-01 | P1 | `programme-completeness` fails on merged PR #77 and remains failing on PR #78 candidate SHA `0cd537d`; other candidate workflows pass. | GitHub runs [41246941250](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41246941250) and [PR #77 merge](https://github.com/POWERBot-1/Jata-Aftercall/commit/847459b50726f4202496283cbbb9fb1b620d10b8). | No gate weakened; PR #78 remains open and unmerged. | Review/resolve full programme checklist; re-run CI on a new candidate. |

## Count summary

- Reproduced and fixed source/UI defects: **4** (three stale URL references plus clipped 320px navigation).
- Application/style/config changes: `app/install/page.tsx`, `lib/qr.ts`, `app/globals.css`, `.env.example`; two test changes: `tests/unit/qr-domain.test.ts` and `tests/unit/pwa-marketing.test.ts`.
- Production/domain configuration changes: **0**.
- Critical/security/financial defects newly reproduced by this bounded audit: **0**; this does not mean those requirements pass. They remain untested and release-blocking until positive evidence exists.
- Open operational/acceptance items: **7** entries above (D-05, V-01, F-01, S-01, M-01, U-01, CI-01); grouped checklist items may contain multiple tests.

Priority counts are issue-register entries, not an exhaustive count of every untested requirement: P0=2 acceptance gates, P1=4 blockers, P2=5 findings/acceptance items (four source/UI fixes plus U-01). No open P0/P1 may be treated as cleared. No open P0/P1 may be treated as cleared.
---

## Active traceability ledger — remediation programme 043

**Current branch:** `arena/115a62e1-jata-aftercall`; verified starting HEAD `4ffaa9c86f86ba02ab759d5e8362d2e826f82ac8`. **Release verdict remains NOT READY.** Finding status describes implementation progress; evidence labels describe what has actually been executed. A source fix or test double is not production/integration/security/browser acceptance. Source families below map the findings in the ten audit reports; no failed/unverified item is removed or downgraded.

### P0 — domain, media, payments, financial integrity, authenticated tenant boundaries

#### DOM-01 — P1 release blocker — authoritative DNS and canonical URL
- **Source / affected:** `DOMAIN_FORENSIC_AUDIT.md`, `FINAL_RELEASE_READINESS.md`; `lib/url.ts`, `app/layout.tsx`, sitemap/robots, auth/reset and checkout/Paystack callback URL consumers; HOSTAFRICA and Vercel domain configuration.
- **Root cause / evidence:** No independently verified current zone or live HTTPS/canonical journey; HOSTAFRICA correspondence and Vercel apex/nameserver/IP responses conflict, while Vercel metadata also reports `required-change`. Root cause of the discrepancy is unknown until the owner supplies the authoritative zone export. Static QR/install/example URL corrections are already recorded as D-01–D-04 and do not resolve runtime configuration.
- **Implementation / acceptance:** Do not change DNS or production settings. Owner/operator compares authoritative HOSTAFRICA zone export with Vercel, then independently checks apex/www HTTPS, redirects, canonical metadata, auth/reset and payment callbacks on the intended domain.
- **Tests / evidence / status:** Existing D-01–D-04 targeted tests and CI evidence remain historical code-only evidence. Live DNS/TLS/callback **NOT TESTED**; status **BLOCKED** on owner/provider evidence. No DNS values are inferred.

#### MAIL-01 — P1 release blocker — domain mail routing and authentication
- **Source / affected:** `DOMAIN_FORENSIC_AUDIT.md`; auth password-reset and registration delivery services; SMTP/email configuration; HOSTAFRICA MX/SPF/DKIM/DMARC.
- **Root cause / evidence:** Support confirmation did not enumerate final MX/SPF/DKIM/DMARC values or verify mail delivery; the requested repair and current authoritative zone remain unconfirmed.
- **Implementation / acceptance:** No records are guessed or changed. Owner supplies the final zone export, explanation of nameserver changes and a controlled test-mail delivery/bounce result; confirm no disruption to site records.
- **Tests / evidence / status:** No current-turn send or DNS lookup. **BLOCKED**; production messages remain prohibited.

#### URL-01 — P1 — runtime canonical-origin consistency
- **Source / affected:** `lib/url.ts`, reset emails, QR generation, metadata/sitemap and deployment origin; Domain and Frontend–Backend audits.
- **Root cause / evidence:** Effective production origin depends on deployment values not inspected under the production-configuration boundary; intended URL is `https://jataaftercall.co.ke`, with `https://jata-aftercall.vercel.app` retained as operational reference.
- **Implementation / acceptance:** Preserve Vercel/Neon/Paystack. Verify effective origin in an approved non-production environment and assert every generated customer URL uses the expected host; no production environment edit is authorized.
- **Tests / evidence / status:** QR default/config tests exist; live deployment origin **NOT TESTED**. **BLOCKED** on owner-approved environment evidence.

#### URL-02 — P1 — payment-provider callback fallback consistency
- **Source / affected:** `lib/payments/config.ts` `publicBaseUrl`, M-PESA STK/C2B callback URLs and provider setup; `lib/url.ts`; domain/payment acceptance.
- **Root cause / evidence:** Callback origin had a separate resolver that used only `PUBLIC_BASE_URL`, `NEXTAUTH_URL`, then `http://localhost:3000`; unlike shared `getBaseUrl`, it ignored Vercel's stable production host when operator URL variables were absent. Production environment values were not inspected, so actual deployed impact is unverified.
- **Implementation / acceptance:** Changed the callback helper to use shared `getBaseUrl`, retaining explicit operator-origin precedence, stable Vercel fallback, and localhost only for local development. Added tests for generated STK/C2B URLs, explicit canonical override and local fallback. Live M-PESA callback delivery and official-domain DNS remain separate gates.
- **Tests / evidence / status:** Source and local unit test **PASS**; test-mode callback/HTTP and production configuration **NOT TESTED**. Code fix **IMPLEMENTED**, runtime acceptance **BLOCKED** on owner/provider evidence.

#### MEDIA-01 — P0 — durable customer-media availability and publication
- **Source / affected:** `MASTER_SYSTEM_FORENSIC_AUDIT.md`, `CUSTOMER_JOURNEY_ACCEPTANCE.md`, `CLICKABLE_FUNCTIONS_REGISTER.md`, `BACKEND_FUNCTION_INVENTORY.md`; `app/api/media/route.ts`, `lib/storage/**`, MediaAsset, Studio upload/preview/publish routes and public media reads; R2 integration.
- **Root cause / evidence:** No approved/configured durable provider is available in the inspected environment; upload route intentionally returns 503 before accepting image bytes. The fail-closed route is correct but means customer upload/retrieval/publication has no runtime acceptance evidence.
- **Implementation / acceptance:** Preserve fail-closed behavior. Owner authorizes a disposable non-production bucket/config; prove valid upload, persistent read after restart/relogin, tenant-safe public publication, quota/type/size failures, provider outage, cleanup and recovery. No storage credentials, costs or real customer uploads are authorized now.
- **Tests / evidence / status:** Adapter/route tests use fakes; exact-CI migration/journey/browser runs from earlier SHA do not prove a real bucket. Provider-backed runtime **NOT TESTED**; **BLOCKED** on owner configuration.

#### MEDIA-02 — P0 — durable object deletion and retry-safe cleanup
- **Source / affected:** `app/api/media/route.ts` DELETE (single asset and AI-generation bulk delete), `lib/storage/types.ts`, R2 adapter, `prisma/schema.prisma` MediaAsset and migration; media durable-upload integration and authorization tests.
- **Root cause / evidence:** Before this batch, durable uploads stored only the public URL and DELETE removed only Neon metadata; no provider/key identity was persisted or passed to `ObjectStorageProvider.remove`, leaving durable customer bytes orphaned. The same gap affected generation bulk deletion.
- **Implementation / acceptance:** Added nullable `storageProvider`/`storageKey` metadata; new durable uploads persist both but never return these internal fields in the asset select. Single/generation deletion validates tenant prefix and provider identity, removes bytes before metadata, retains rows and returns 503 on cleanup failure, and allows retry (R2 delete is idempotent). Added additive migration `20261125000000_media_storage_identity`; no production migration. Acceptance: tenant-owned bytes removed before row; cross-tenant/malformed key untouched; provider outage retains row; retry completes; bulk removal is tenant-scoped.
- **Tests / evidence / status:** PASS: focused media/storage/payment-callback/schema/quota suite — 18 files / 221 passed, 1 PostgreSQL test skipped because no approved disposable DB was configured. Fake-provider route tests cover single/bulk cleanup, retry, storage failure, tenant prefix and metadata non-exposure. The same broader run exposed a month-boundary race in an AI image quota fixture; the assertion was preserved and the fixture now freezes UTC time. Migration's disposable-PostgreSQL test is present but **NOT TESTED** locally; real R2/browser evidence **NOT TESTED**. Code status **IMPLEMENTED**; release acceptance remains **BLOCKED** by MEDIA-01 and migration/provider evidence.

#### MEDIA-03 — P1 — legacy asset cleanup without persisted provider identity
- **Source / affected:** Existing MediaAsset rows/objects created before MEDIA-02 and any external URL reference; Studio media deletion and provider lifecycle.
- **Root cause / evidence:** Prior schema held only URL/metadata. New columns are nullable and intentionally do not guess a provider/key for historical rows; no production DB or object inventory was read. A legacy row with null identity cannot be safely mapped to a provider object by current cleanup code.
- **Implementation / acceptance:** No broad backfill or inferred key. Before claiming legacy cleanup, owner/operator must inventory in a disposable/approved environment and prove exact URL-to-key mapping for the configured provider; preserve external references. Add a deterministic migration/backfill only if that evidence supports it.
- **Tests / evidence / status:** Migration explicitly preserves old rows as null; disposable test is present but skipped locally. Existence/volume of legacy provider-managed assets **NOT TESTED**; **BLOCKED** on safe inventory. Do not describe MEDIA-02 as fixing historical objects.

#### PAY-01 — P0 — verified payment to subscription/order lifecycle
- **Source / affected:** `FINTECH_MOTION_ACCEPTANCE.md`, `CUSTOMER_JOURNEY_ACCEPTANCE.md`, `FRONTEND_BACKEND_RECONCILIATION.md`; `/api/checkout`, `/api/paystack/verify`, payment/config services, subscription/entitlement models, checkout UI.
- **Root cause / evidence:** No current-turn isolated lifecycle reproduced from initiation through server-side verification to correct entitlement/order state; exact failure root cause is not established and no defect is claimed.
- **Implementation / acceptance:** Reproduce using provider mocks or approved Paystack test mode and disposable PostgreSQL; cover wrong amount/currency/reference/tenant, pending/declined/timeout/success, duplicate submit, cancel/expire; prove activation occurs only after authoritative verification and visible UI matches persisted state. Never charge real money.
- **Tests / evidence / status:** Existing unit/security/CI tests noted in audit reports; they are not a complete current-turn provider lifecycle. **PENDING** isolated reproduction and independent DB evidence.

#### PAY-02 — P0 — webhook authenticity, idempotency, ordering and failure recovery
- **Source / affected:** `/api/paystack/webhook`, `/api/payments/webhooks/paystack/*`, M-PESA callback routes, payment/webhook persistence and integration tests.
- **Root cause / evidence:** No current-turn duplicate, invalid-signature, delayed/out-of-order, transient-failure or replay integration trace on disposable infrastructure. Root cause remains unknown until matrix is executed.
- **Implementation / acceptance:** Preserve HMAC/provider verification and existing idempotency; test invalid signatures, altered payload, unknown reference, duplicate/out-of-order delivery, DB failure/retry and concurrent deliveries with synthetic events; assert one correct financial transition and no cross-tenant effects.
- **Tests / evidence / status:** Repository test families and earlier CI results are not the requested exact-SHA matrix. No real webhook/payment used. **PENDING**; no verification changes until reproduced.

#### FIN-01 — P0 — financial policy, commissions, refunds and reconciliation
- **Source / affected:** `FINTECH_MOTION_ACCEPTANCE.md`, backend inventory, existing `docs/agents/RELEASE_GATE_AND_RUNBOOK.md`; Paystack/M-PESA, Payment, POS/ERP sales/refunds/reports and agent commission ledger.
- **Root cause / evidence:** End-to-end ledger/report reconciliation was not executed; commission policy inputs (qualifying event, rate, reversals, payout schedule) must not be invented. The source records policy/acceptance gaps, not proof of a particular code defect.
- **Implementation / acceptance:** First obtain owner-approved financial/commission policy. With synthetic fixtures and disposable DB, independently reconcile gross, fees, refunds/reversals, stock/tender, reports, agent attribution and idempotency; assert totals and immutable evidence match. No accrual/payout behavior or schedule is enabled by this remediation without policy approval.
- **Tests / evidence / status:** Existing ledger/POS test families and prior candidate CI are partial code/test evidence. No exact-SHA financial reconciliation or policy acceptance. **BLOCKED** on policy and **PENDING** isolated reconciliation.

#### POS-01 — P0 — POS sale, offline recovery, refund and report integrity
- **Source / affected:** `CUSTOMER_JOURNEY_ACCEPTANCE.md`, `FINTECH_MOTION_ACCEPTANCE.md`, backend inventory; POS UI, `/api/pos/[businessId]/*`, offline queue/sync, tender, stock, refunds and reports.
- **Root cause / evidence:** No browser offline/reconnect and no current-turn independent ledger/report comparison. No newly reproduced defect; cause remains unestablished pending test.
- **Implementation / acceptance:** Use two synthetic tenants and disposable PostgreSQL; cover sale, duplicate retry, offline queue, reconnect conflict, payment/tender, refund/return, stock movement and report totals; prove retry cannot lose/duplicate money or stock and tenant B cannot read/mutate A.
- **Tests / evidence / status:** Historical test/CI families cover selected cases, not full browser/ledger acceptance. **PENDING**.

#### TEN-01 — P0 — authenticated tenant isolation across direct APIs
- **Source / affected:** `MASTER_SYSTEM_FORENSIC_AUDIT.md`, backend inventory, `FRONTEND_BACKEND_RECONCILIATION.md`; auth/session and tenant guards across Business, Media, AI, Studio, POS, ERP, orders/bookings, admin/agent APIs and models.
- **Root cause / evidence:** Existing targeted tests do not establish a complete route-by-route negative direct-API matrix on this candidate. No cross-tenant defect is newly asserted; uncovered routes/root causes remain unknown until execution.
- **Implementation / acceptance:** Build two disposable synthetic tenants and roles; for every sensitive API test anonymous, wrong tenant, viewer/staff, revoked session, wrong object ID and expired entitlement; assert no reads/writes/provider side effects. Preserve or strengthen authorization only.
- **Tests / evidence / status:** Existing `tests/security/**` coverage includes selected families; media authorization suite passed in this batch. Full endpoint matrix **NOT TESTED**; **PENDING**.

#### AUTH-01 — P0 — registration, session revocation, password recovery and role changes
- **Source / affected:** `BACKEND_FUNCTION_INVENTORY.md`, `CLICKABLE_FUNCTIONS_REGISTER.md`; `/api/auth/*`, account team access, password reset, session-version logic and frontend auth forms.
- **Root cause / evidence:** No current-turn isolated browser/email/session lifecycle; delivery depends on configured mail and role/session revocation must be independently proven. No defect newly reproduced.
- **Implementation / acceptance:** Synthetic users only; exercise register/login/logout, reset-token expiry/replay, mail-unavailable failure, role downgrade/revocation and direct API denial. No real customer message or production SMTP.
- **Tests / evidence / status:** Existing password/security tests are noted in prior reports; current candidate browser journey **NOT TESTED**. **PENDING** (mail integration separately BLOCKED by MAIL-01).

### P1 — journeys, controls, accessibility, integration and evidence recovery

#### JOURNEY-01 — P1 — all intended product/payment journeys
- **Source / affected:** `CUSTOMER_JOURNEY_ACCEPTANCE.md`, `CLICKABLE_FUNCTIONS_REGISTER.md`; marketing/pricing, account creation, checkout/entitlement and AI Front Desk, Studio, POS, Autopilot, subscription lifecycle.
- **Root cause / evidence:** Complete browser journeys were not run for monthly KES 149, annual KES 999, Front Desk KES 499/month, Studio KES 999/month, POS KES 499/month and Autopilot KES 2,499/6,999/19,999. Source catalogue is not production checkout evidence.
- **Implementation / acceptance:** Test each journey on isolated fixtures with provider mocks/test mode; verify pricing/duration, eligibility, success/pending/failure/expiry, UI-vs-database state and direct-route denial. Preserve these source prices; do not infer commissions.
- **Tests / evidence / status:** Prior CI DB journey was partial and no exact current browser journeys were captured. **PENDING**.

#### CONTROL-01 — P1 — visible controls have live, authorized backend effects
- **Source / affected:** `CLICKABLE_FUNCTIONS_REGISTER.md`, static 196-file count; all rendered buttons/links/forms, dialogs, filters, menus and toasts across marketing/dashboard/Studio/AI/POS/Autopilot/admin/agent.
- **Root cause / evidence:** Static source search is not a rendered-control crawl; dynamic lists and all loading/error/retry outcomes were not tested. Specific dead-control root causes are unknown until discovered.
- **Implementation / acceptance:** On test accounts, enumerate accessible name/route/handler/API/guard/effect/feedback per rendered control; reproduce and repair dead/misleading controls with an authorized backend or explicit unavailable state; add a focused regression for each confirmed defect.
- **Tests / evidence / status:** Existing register contains route families, not per-control browser proofs. Exhaustive crawl **NOT TESTED**; **PENDING**.

#### RECON-01 — P1 — frontend/backend route and status reconciliation
- **Source / affected:** `FRONTEND_BACKEND_RECONCILIATION.md`, `BACKEND_FUNCTION_INVENTORY.md`; 123 page routes and 141 API route files at audit baseline; all frontend mutations, service calls, guards, models and provider adapters.
- **Root cause / evidence:** No complete per-action chain from UI→request→guard→DB/provider→response→display was proven; routing/reachability failures are not assumed without reproduction.
- **Implementation / acceptance:** Trace each critical control and error path, compare API schemas/status codes with UI handling, test auth/tenant/entitlement/duplicate/timeout/retry and persistence after reload; fix root causes in bounded batches.
- **Tests / evidence / status:** Source inventory only plus selected earlier CI. Full reconciliation **NOT TESTED**; **PENDING**.

#### A11Y-01 — P1 — accessibility, keyboard and reduced motion
- **Source / affected:** `FINTECH_MOTION_ACCEPTANCE.md`, `CLICKABLE_FUNCTIONS_REGISTER.md`; shared navigation, forms, modals, dashboards, Studio, AI, POS, Autopilot and admin.
- **Root cause / evidence:** No exact-candidate route-wide keyboard/focus/contrast/screen-reader run or visually reviewed reduced-motion capture; presence of motion tokens/tests does not establish universal inheritance.
- **Implementation / acceptance:** Exercise keyboard-only focus order, labels/announcements, modal traps/Escape, contrast and prefers-reduced-motion; inspect all financial/money state animation and routes; remediate demonstrated failures and retain genuine browser traces.
- **Tests / evidence / status:** Prior CI capture workflows passed on earlier candidate heads; artifacts not visually reviewed. **NOT TESTED**; **PENDING**.

#### VIEW-01 — P1 — responsive behavior at six required viewports
- **Source / affected:** `FINAL_RELEASE_READINESS.md`, `FINTECH_MOTION_ACCEPTANCE.md`, `CLICKABLE_FUNCTIONS_REGISTER.md`; marketing and authenticated product route families at 320×568, 360×800, 390×844, 430×932, 768×1024 and 1366×768.
- **Root cause / evidence:** A narrow marketing-nav defect was previously reproduced and fixed (D-04); other viewport/layout defects are not established. Latest earlier CI capture did not make inspectable pixels available to this assessment.
- **Implementation / acceptance:** Capture and visually inspect all six sizes for every critical route, interaction, overflow, clipping, touch targets and error states; add reproducible fix/tests for actual findings.
- **Tests / evidence / status:** Earlier six-viewport workflow PASS on code SHA `0cd537d` and later report heads; artifact visual review **NOT TESTED**. **PENDING**.

#### BROWSER-01 — P1 — browser evidence and recovery
- **Source / affected:** `FINAL_RELEASE_READINESS.md`, `FINTECH_MOTION_ACCEPTANCE.md`, browser capture workflows, screenshot/trace artifacts for user journeys and failure/retry states.
- **Root cause / evidence:** GitHub artifact storage was unreachable from the sandbox; captures could not be downloaded for pixel review. This is an evidence access limitation, not a claim that capture failed.
- **Implementation / acceptance:** On a new tested head, retain exact SHA, command, screenshot/trace uploads and inspectable evidence; recover artifacts through an approved channel and inspect actual pixels/recordings; include retries, validation/provider failure and direct-API denial.
- **Tests / evidence / status:** Historical six-viewport and route-capture workflows PASS; current-turn browser capture **NOT TESTED**. **BLOCKED** on accessible evidence for visual acceptance.

#### ADMIN-01 — P1 — admin/agent journeys and completeness gate
- **Source / affected:** `BACKEND_FUNCTION_INVENTORY.md`, `CLICKABLE_FUNCTIONS_REGISTER.md`, `MERGED_PR_FORENSIC_REVIEW.md`; `/api/admin/*`, `/api/agents/*`, cron/scheduler routes, admin/agent pages, commission/reporting models; `scripts/admin/check-programme-readiness.mjs` and `docs/agents/PROGRAMME_READINESS.json`.
- **Root cause / evidence:** PR #77 was explicitly partial; `programme-completeness` failed on PR #78 at `4ffaa9c` (run 41250559664). The unchanged fail-closed checker requires every instruction ID to have `status: PASS`, an acceptance description and existing evidence files; all 43 entries, including new `RELEASE-001`, currently remain `NOT_TESTED`. This is incomplete acceptance, not a checker malfunction.
- **Implementation / acceptance:** Work the exact criteria using approved evidence and require the original completeness gate to pass without relaxed assertions. No admin mutation, scheduler or commission action in production.
- **Tests / evidence / status:** `node scripts/admin/check-programme-readiness.mjs` locally reports `NOT READY (43)` with all requirements `NOT_TESTED` (the expected conservative result). `node scripts/admin/check-building-instructions.mjs` cannot verify append-only history in this shallow clone. Latest remote sole failing check remains `programme-completeness`; a fresh exact-SHA CI is pending. Gate **BLOCKED** by unmet acceptance evidence; do not weaken or bypass.

#### ERP-01 — P1 — ERP reports, messaging and scheduler reachability
- **Source / affected:** `BACKEND_FUNCTION_INVENTORY.md`; `/api/erp/[businessId]/*`, report/notification/cron routes, ERP pages, consent/approval/tenant guards and notification persistence.
- **Root cause / evidence:** Inventory notes some scheduled/delivery features are disabled or incomplete and no scheduler was invoked; exact reachable functions and user-visible contract were not fully reconciled.
- **Implementation / acceptance:** Map each advertised function to an active authorized API or label it unavailable; test synthetic report results and default-off schedule/consent/approval behavior; prove no outbound provider call without explicit test configuration.
- **Tests / evidence / status:** No outbound message/scheduler was run. **PENDING**; provider-send acceptance **BLOCKED** by authorization/consent requirements.

#### INT-01 — P1 — external integrations and error recovery
- **Source / affected:** `BACKEND_FUNCTION_INVENTORY.md`, `CUSTOMER_JOURNEY_ACCEPTANCE.md`; Neon/PostgreSQL, Paystack/M-PESA, SMTP, R2, AI and messaging adapters, URL callbacks and cron.
- **Root cause / evidence:** No real provider/environment integration was called; adapter existence/test doubles do not prove configured runtime, timeout recovery, callback correctness or cost/safety properties.
- **Implementation / acceptance:** Use disposable DB and approved provider sandbox/fakes; prove config failure is explicit, credentials never leak, retries are idempotent, provider state matches DB/UI, and no unapproved cost/message/action occurs.
- **Tests / evidence / status:** Code/CI tests are partial; real integrations **NOT TESTED**. **BLOCKED** where owner config or provider approval is required; other mocks **PENDING**.

#### CI-01 — P1 release gate — programme completeness
- **Source / affected:** `MERGED_PR_FORENSIC_REVIEW.md`, `FINAL_RELEASE_READINESS.md`, PR #78 checks and `docs/agents/RELEASE_GATE_AND_RUNBOOK.md`.
- **Root cause / evidence:** `programme-completeness` failed on last verified PR #78 head `4ffaa9c86f86ba02ab759d5e8362d2e826f82ac8` (run 41250559664); detailed failed criteria have not yet been re-read during this remediation batch.
- **Implementation / acceptance:** Inspect workflow/check output and every referenced checklist item; address missing entries/evidence without suppressing the check, changing thresholds or claiming unsupported PASS; rerun exact candidate CI.
- **Tests / evidence / status:** Last observed **FAIL** at run 41250559664; no new CI run for current worktree yet. **BLOCKED** until exact criteria and new run are available.

## Current batch summary

- New reproduced defects: durable DELETE removed only MediaAsset metadata, leaving provider objects untracked; and the M-PESA callback origin resolver could fall back to localhost on Vercel unlike the shared URL resolver. Implemented provider/key persistence, tenant-validated cleanup-before-row deletion, retryable errors and an additive nullable migration; unified callback URL resolution with `getBaseUrl`, retaining explicit configuration precedence. These changes do not touch production configuration or enable a provider.
- Focused local evidence: **PASS** 221 tests across media/storage/payment callbacks/schema/quota and tenant authorization suites; a time-boundary-sensitive AI quota fixture was made deterministic without weakening its assertion. **NOT TESTED** disposable PostgreSQL migration (skipped without a local test DB), real R2, live callbacks, browser upload/publish, or visual artifacts.
- Code statuses must not be promoted to runtime PASS. Current release verdict: **NOT READY**; owner DNS/email/provider/policy dependencies and the completeness gate remain open.
