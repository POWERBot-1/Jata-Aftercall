# JATA AFTERCALL — Whole-Platform Assessment and Conclusive Remediation Plan

**Assessment date:** 2026-11-17  
**Repository:** `POWERBot-1/Jata-Aftercall`  
**Assessment candidate:** `remediation/owner-authorized-acceptance-v2-2026-11-16`  
**Recorded candidate SHA:** `276756e273c6151a494bc4e315d93aa9aee5c129`  
**Current release verdict:** **NOT READY**  
**Purpose:** Establish a single, evidence-led route to a complete, secure, tenant-safe, commercially operable JATA AFTERCALL platform.

> This is a remediation plan and current evidence assessment, not a claim that every module has been independently tested. It does not authorize production changes, payment activity, DNS/mail edits, spending, operator grants, provider activation, merge or deployment. Status labels distinguish source implementation from executed acceptance.

---

## 1. Executive decision

JATA AFTERCALL has a substantial implementation base and several successful exact-candidate CI and isolated staging checks. It is not yet a wholesome, production-accepted platform.

The strongest positive evidence on candidate `276756e273c6151a494bc4e315d93aa9aee5c129` includes:

- Release Validation, candidate migration rehearsal and POS/ERP verification completed successfully.
- Full no-database suite completed: 398 test files passed, 39 skipped; 4,694 tests passed, 343 skipped, zero failed.
- PostgreSQL 18 migration/schema reconciliation and disposable logical backup/restore passed.
- Website Studio authenticated browser acceptance and Interactive Business E2E completed successfully in CI.
- A separate Neon staging project and Preview deployment were established; isolated Paystack test-mode checkout, provider verification, signature rejection/acceptance, duplicate webhook idempotency and POS entitlement activation were recorded as PASS.
- The Preview environment was branch-scoped and isolated from Production.
- Production dependency advisory gate reported zero findings.

These results are meaningful but bounded. The exact-candidate workflow still has the programme-completeness failure. The full dependency-tree audit reports 16 high findings through the `picomatch` dependency chain. Some browser and visual jobs passed capture/automation but still require independent artifact review. Production DNS/TLS/mail, live payment configuration, real customer operations, recovery objectives and some product journeys remain unverified or blocked.

The readiness manifest currently contains **47 requirements: 23 PASS, 21 BLOCKED and 3 NOT_TESTED**. A PASS in one requirement does not override a related blocker or imply overall release readiness.

**Decision: retain the fail-closed release posture. Do not merge or promote this candidate to Production until all mandatory P0/P1 acceptance gates below are cleared on one integrated exact head.**

## 2. Severity and release policy

- **P0 — release blocker:** money, authentication, tenant isolation, data integrity, customer access, durable customer content or an unsafe production configuration.
- **P1 — launch-critical:** a core product journey, operational control, accessibility, domain/mail, integration, recovery or evidence gap that can make the platform unreliable or misleading.
- **P2 — quality / optimization:** non-critical usability, polish, performance or maintainability work that does not compromise the P0/P1 release boundary.

Finding status and evidence status are different:

- `PENDING`: work or acceptance has not been completed.
- `IMPLEMENTED`: a source change exists; this is not runtime proof.
- `VERIFIED`: the criterion-specific evidence has been independently accepted.
- `BLOCKED`: a named dependency, authorization or missing capability prevents completion.
- Evidence labels: `PASS`, `FAIL`, `BLOCKED`, `NOT TESTED`.

No test skip, unavailable artifact, source-only assertion, demo fixture, green build or successful Preview deployment may be promoted to a runtime PASS unless it proves the actual criterion.

## 3. Current critical findings

### P0 — money, security, data and customer access

1. **PAYMENT ENVIRONMENT ISOLATION / PRODUCTION PAYMENT READINESS — BLOCKED.** The Preview candidate has dedicated test-mode keys and passed a sandbox checkout/verification/webhook/entitlement journey. Earlier Vercel metadata showed shared Preview/Production key targeting and raised a suspected Production test-key risk. Production key mode has not been independently confirmed by a read-only Paystack/Vercel review. Do not accept live payments or change Production credentials until the merchant dashboard and Production target are independently verified. Never disclose or decrypt keys in evidence.
2. **FULL DEPENDENCY TREE — FAIL.** Candidate CI reports 16 high findings in the full dependency tree through the vulnerable `picomatch` chain; production-only advisory gate reports zero. Trace each path to its introducing package, determine whether it is reachable in shipped runtime/build tooling, and seek a supported patched upstream release or remove/replace the vulnerable dependency path. Do not force an unreviewed version override or fork when the advisory has no patched version. Record a time-bounded risk disposition only if remediation is demonstrably unavailable; the requested release policy otherwise requires a clean audit.
3. **TENANT ISOLATION — PARTIAL / PENDING.** Existing security suites and selected authenticated journeys pass, but the full direct-API negative matrix across Business Page, media, Website Studio, AI, POS, ERP/MJENGO, Autopilot, subscriptions, admin/agent and integrations has not been proven on the integrated candidate. Two synthetic tenants and multiple roles are required.
4. **PAYMENT AND FINANCIAL RECONCILIATION — PARTIAL / PENDING.** Preview sandbox checkout, verification, signature rejection, valid signed settlement, duplicate idempotency and POS entitlement activation passed. Complete amount/currency/reference/tenant mismatch, concurrency, out-of-order events, provider timeout, DB failure/retry, refund/chargeback, M-PESA, POS/ERP ledger, stock and reporting reconciliation remains required.
5. **MJENGO OS CUSTOMER ACCESS — FAIL REPORTED / NOT ACCEPTED.** Issue #115 documents a Production 404 in the actual customer workspace journey. Public product discovery, sign-in return URL, entitlement and operating workspace must be traced and verified. Homepage presence or a redirect to login is not acceptance. Preserve MJENGO OS at KES 2,000 / 30 days and keep it independent of Business POS at KES 499 / 30 days.
6. **MEDIA DURABILITY — PARTIAL.** MEDIA-02 added provider/key identity, tenant-validated cleanup, retry-safe deletion and an additive migration. MEDIA-01 still requires a real isolated storage provider upload → persistent read → tenant-safe publication → delete/retry journey. MEDIA-03 legacy assets must not be guessed or bulk-deleted; first inventory exact URL-to-object mappings.
7. **AUTHENTICATION / SESSION LIFECYCLE — PENDING.** Exercise registration, login, logout, reset-token expiry/replay, password reset mail failure, session revocation, role downgrade, expired entitlement and direct API denial with synthetic accounts. Do not create a privileged Control operator to satisfy a test.
8. **CONTROL SECURITY — POLICY-BOUND.** All 90 role × capability combinations remain DENY and `CONTROL_ROLE_ACCESS_ENABLED=false`. Keep the denied journey passing. Do not change this matrix or grant access as a shortcut. ADMIN-010 is blocked by the intentionally approved policy; any future exception needs a separate exact-cell decision.

### P1 — core journeys, operations and trust

9. **DOMAIN / DNS / TLS / CANONICAL ORIGIN — BLOCKED.** Vercel metadata shows apex and www attached/verified, but no redirect target. Independent public DNS, HTTPS/TLS, HSTS, canonical redirects, secure cookie scope and callback origin remain unverified. Do not edit HostAfrica, Vercel domains or DNS from this plan.
10. **MAIL AUTHENTICATION / DELIVERY — BLOCKED.** Obtain authoritative MX/SPF/DKIM/DMARC evidence and controlled delivery/bounce proof. Do not guess records or send real customer messages.
11. **WEBSITE STUDIO VISUAL ACCEPTANCE — PARTIAL.** Source corrections were committed for tenant-scoped demo media, hero/product placeholders, white-surface heading contrast and Cardless Immersive mobile title/action-bar clearance. The latest-head capture and complete independent image/video review remain outstanding. Existing 20-family × six-viewport × draft/published × normal/reduced-motion capture is evidence of breadth, not final visual sign-off. The current readiness ledger also leaves published AI and full commerce route coverage open.
12. **FINTECH MOTION / ACCESSIBILITY — BLOCKED.** Full owner specification exists. Implement and verify the actual module surfaces, motion lifecycle, reduced-motion, focus/keyboard, chart/loading/transaction states, reveal queue saturation/re-entry/cleanup, performance and route-state coverage. Capture workflows passing is not equivalent to visual or accessibility acceptance.
13. **ADMIN / FINANCIAL REPORTING — BLOCKED.** The owner-approved definitions exist, but reconciled implementation is missing. Implement aggregate-first, masked-PII dashboards from authoritative persisted data. MRR is active settled recurring value normalized monthly; ARR is MRR × 12 annualized run-rate, not cash received. Gross settled collections, refunds/chargebacks and net collections are separate. Do not estimate fees, tax, AI cost or job health.
14. **AGENT COMMISSIONS — BLOCKED BY POLICY INPUT.** Attribution and reversal governance is adopted (first-touch, 30 days, one agent, first settled non-test subscription payment, append-only reversals). Numeric rates and payout terms are deliberately NOT CONFIGURED. No accrual writer or payout path may activate until a versioned plan/product rate schedule and payout terms are separately approved.
15. **RECOVERY — PARTIAL.** Disposable PostgreSQL 18 logical backup/restore now passes schema, row-count and migration-ledger comparison. This is not Neon provider-native PITR acceptance. Upgrade rehearsal, rollback where supported, forward recovery, application compatibility, timed restore, independent backup and recovery proof remain outstanding. Targets: RPO ≤15 minutes for payment/subscription/ledger data and RTO ≤4 hours for core service, subject to provider capability.
16. **ALL CUSTOMER JOURNEYS / CONTROL CRAWL — NOT COMPLETE.** Static route inventories and selected browser journeys do not prove every rendered control. Map critical UI controls to API, authorization, database/provider effect, response and visible feedback; repair dead or misleading controls.
17. **EXTERNAL INTEGRATIONS — PARTIAL / BLOCKED.** n8n foundation is not a durable active automation service until isolated runtime, persistence, signing, deduplication, retries, dead-letter/manual review, tenant scoping and restart recovery pass. External MCP endpoint remains unverified (identity, protocol, auth, schemas, privacy and side effects); do not expose it to customers until a server-only allowlisted gateway and contract/security tests exist. M-PESA, mail, R2, AI and telephony require provider-specific test-mode evidence.
18. **ANDROID / PWA / DEVICE ACCEPTANCE — NOT TESTED.** Desktop Chrome and responsive screenshots are not native-device acceptance. Exercise supported Android/iOS browser and installed-PWA journeys, refresh/back/forward, deep links, camera/media permissions where relevant, offline/reconnect, notifications and checkout return.
19. **PROGRAMME COMPLETENESS — FAIL BY DESIGN.** Exact candidate workflow run 44151211804 shows instruction-integrity job PASS and programme-completeness job FAIL. The 47-ID manifest reports 21 BLOCKED and 3 NOT_TESTED. Do not relax the checker, suppress requirements or carry earlier PASS evidence forward.

## 4. Product-by-product acceptance map

| Product / surface | Current assessment | Required conclusive remedy |
|---|---|---|
| Business Page (KES 149 / 30 days; KES 999 / 365 days) | Core foundation exists; official-domain and complete checkout/publication acceptance remains pending | Create, edit, publish, share, analytics, subscription renewal/expiry and public customer action journeys; verify exact price/duration and tenant ownership |
| Website Studio (KES 999 / 30 days) | Authenticated browser and tenant/content CI pass; visual and full route/state acceptance remains partial | Finish OpenPage-only architecture acceptance; native blocks/variants/editor/document model/renderer; all family, draft/published, commerce and media states; visual review and tenant-safe publish/rollback |
| AI Business Front Desk (Starter 499, Standard 999, Pro 1,999, Voice 3,999 proposed tiers) | Code foundations exist; full channel/provider and voice runtime acceptance not established | Verify knowledge ingestion/versioning, grounded answers, lead/order/booking handoff, tenant isolation, escalation, consent, cost controls and channel delivery. Test WhatsApp, web chat, SMS and voice separately. Do not imply voice is live without telephony provider proof |
| Business POS (KES 499 / 30 days) | POS/ERP CI and isolated Neon sandbox entitlement evidence are positive | Complete two-tenant sales, tender, receipt, stock ledger, offline/reconnect, concurrent sale, refund, customer/supplier credit, permissions, report reconciliation and lapsed-entitlement browser journey |
| ERP PRO / BOS | ERP HTTP and selected browser/CI verification pass; complete live operational controls remain pending | Reconcile every advertised task, approvals, procurement, reports, notifications, audit trail and role guard to a persisted API effect; scheduled jobs must be observable and default-off absent consent |
| MJENGO OS (KES 2,000 / 30 days) | Product isolation and subscription tables were implemented in prior candidate work; customer 404 is recorded | Repair exact public → auth → entitlement → workspace route; test modules and CRUD with synthetic data; prove independence from Business POS and preserve legacy records |
| Autopilot (KES 2,499 / 6,999 / 19,999) | Offer/FAQ, execution and rollback test foundations exist; end-to-end provider and durable job acceptance incomplete | Prove schedule/trigger, tenant consent, preview/approval, idempotency, retry/backoff, cancellation, kill switch, dead-letter, audit, budget/rate limits and provider failure recovery; no unapproved outbound action |
| TAPNET | Partner/provider path not yet accepted as a launched service | Confirm licensed carrier/eSIM/SIM partner, regulatory and commercial model, KYC, coverage, activation lifecycle, billing/reconciliation, support and refunds. No activation, wallet funding, contract or volume/price commitment without separate approval |
| n8n automation | Integration foundation only | Separate durable staging runtime, encrypted credentials, HMAC ingress/egress, dedupe, retries, dead-letter, pause/resume, restart recovery and tenant isolation |
| MCP / external tools | Endpoint protocol and identity not verified | Verify initialize/tools/list/auth/TLS/data retention/side effects; implement server-only gateway with strict allowlist, schema validation, timeout, size cap, audit and deny-by-default destructive/financial/admin tools |
| Admin / Control / Agent | Deny policy is intentionally active; reporting and commission requirements open | Preserve all-DENY Control. Complete aggregate reporting, health/kill-switch visibility and commission governance without creating an unauthorized operator or enabling payout |

**TAWA / MJENGO POS compatibility:** a prior inspection of `POWERBot-1/TAWA` returned 404, so source compatibility and full migration are BLOCKED. Do not claim TAWA has been integrated. Any later import must preserve its functionality and data, remain a distinct MJENGO POS product at the approved KES 2,000 / month positioning, and not replace Business POS.

## 5. Target platform architecture and invariants

The target is one coherent platform with independently entitled products, shared trustworthy foundations and explicit service boundaries.

### Shared foundation

- **Identity:** one authoritative account/session system; explicit membership and role model; revocation and expiry enforced on every server boundary.
- **Tenancy:** every tenant-owned object has a business/tenant key and ownership check; no client-supplied tenant ID is trusted; cross-tenant negative tests cover reads, writes, exports, media and callbacks.
- **Product catalogue and entitlement:** canonical product/plan registry with exact amount, currency, duration, status, trial/grace/expiry/refund rules. Product entitlements are separate where products are independent (Business POS ≠ MJENGO OS ≠ ERP PRO).
- **Payments:** provider checkout is an initiation only. Server-side verification and signed, idempotent provider events are authoritative. Amount, currency, merchant, reference, tenant, plan and payment state are reconciled before entitlement changes.
- **Ledger:** immutable financial events; refunds, chargebacks, reversals and corrections append new entries. Reports reconcile to authoritative rows and provider identifiers.
- **Storage:** durable object identity is persisted; upload, read, publish and delete are tenant-scoped and retry-safe; media publication never relies on ephemeral local files.
- **Events/jobs:** durable queue state, retries, dedupe, idempotency keys, backoff, dead-letter/manual review, cancellation and audit; no hidden in-memory-only critical jobs.
- **Observability:** request/job/provider correlation IDs; structured redacted logs; health checks that test actual dependencies; actionable alerts and incident history.
- **Security:** least privilege, secure cookies, CSRF protections where applicable, rate limits, input/output validation, dependency scanning, secret isolation, audit trail and safe failure defaults.
- **Experience system:** consistent responsive design tokens, motion lifecycle, reduced-motion support, keyboard/focus behavior, accessible contrast and tested error/loading/empty states.
- **Release engineering:** immutable candidate SHA, reproducible lockfile, exact-head CI, migration rehearsal, artifact retention, signed evidence manifest, staged rollout and rollback/forward-recovery runbook.

### Non-negotiable invariants

1. No entitlement from checkout initiation or browser callback alone.
2. No payment/subscription state transition from an invalid signature, mismatched reference, amount, currency, merchant, plan or tenant.
3. Duplicate/replayed/out-of-order provider events cannot double-charge, double-credit, duplicate stock movement or duplicate commission.
4. No tenant can read, mutate, publish, delete or export another tenant's data.
5. No unpaid/expired/suspended entitlement may access a paid capability; no product may unlock another product accidentally.
6. No stock or balance changes without immutable movement/ledger records and actor attribution.
7. No AI or automation may silently change price, stock, payment, entitlement, schedule or send customer communications outside approved consent and policy.
8. No Control privilege or commission payout may be inferred from a default, UI toggle or test fixture.
9. No secret appears in browser bundles, logs, screenshots, artifacts, issues or generated reports.
10. No release gate is weakened to make the pipeline green.

## 6. Conclusive remediation sequence

Work in bounded branches/PRs against the isolated Preview and disposable environments. Integrate only after each workstream has exact-head evidence. The order below is dependency-aware.

### Phase 0 — Freeze and establish one source of truth

- Keep Production, DNS, live Paystack, production Neon and customer records unchanged.
- Identify one release candidate SHA and record all branch, PR, deployment, migration and workflow identifiers.
- Reconcile current product catalogue, price/duration, entitlements, routes, providers and environment targets into a versioned inventory.
- Preserve the all-DENY 90-cell Control policy and fail-closed programme gate.
- Produce a finding-to-source-to-test-to-evidence matrix; retire stale documents only through an auditable change, never by silently deleting a blocker.

**Exit:** candidate and inventory are reproducible; no conflicting or stale status is presented as current.

### Phase 1 — Close security and dependency risks

- Trace all 16 full-tree `picomatch` findings to exact package paths and versions.
- Prefer supported upstream remediation; remove unnecessary vulnerable dependencies or replace their parent package. If no patched upstream exists, document exploitability, reachability, runtime exposure, compensating controls and expiry date for a formal risk decision. Do not apply unsafe force overrides.
- Run production and full-tree audits, secret scanning, lockfile reproducibility and license checks on the same SHA.
- Execute the full authenticated two-tenant API matrix, session lifecycle, permission downgrade/revocation, rate-limit and webhook negative tests.
- Inspect storage, callback, redirect, file upload, export and server action boundaries.

**Exit:** zero unresolved critical/high exploitable findings or a separately authorized, documented risk exception; every P0 tenant/security test passes; no secret leak.

### Phase 2 — Complete payment, entitlement and financial integrity

- Use only dedicated Preview Paystack test keys and isolated Neon staging.
- Exercise checkout success, pending, decline, timeout, duplicate submit, wrong amount/currency/merchant/reference/tenant, invalid signature, malformed signature, duplicate and out-of-order events, concurrent webhook delivery, transient DB failure and retry.
- Verify the payment through Paystack's server API and signed webhook path; reconcile one immutable payment record and one correct entitlement transition.
- Test refunds/chargebacks and append-only reversals. Test M-PESA callbacks separately in an approved sandbox/mock.
- Reconcile subscription status, POS tender, stock movement, receipts, refunds, agent attribution and management reports from source records.
- Verify Production payment key mode read-only before any live collection; no Production key replacement or transaction in this programme.

**Exit:** every test case has exact request/event fixture, persisted before/after evidence, provider response, idempotency proof and independent reconciliation. No real-money event.

### Phase 3 — Complete data durability and recovery

- Run real Preview R2 upload, persistent retrieval after restart/relogin, public publication, tenant isolation, quota/type/size rejection, provider outage, deletion and retry.
- Inventory legacy media only through approved read-only evidence; backfill provider identity only when exact mapping is proven.
- Complete PostgreSQL 18 migration upgrade, rollback where supported, forward recovery and app compatibility rehearsal.
- Run Neon provider-native PITR/snapshot restore separately from logical pg_dump restore, without touching Production. Record elapsed time and data loss window.
- Verify encrypted independent backup, access separation, restore integrity and application smoke tests.

**Exit:** real provider storage journey passes; backup restore and provider-native recovery are independently evidenced against RPO ≤15 minutes / RTO ≤4 hours or a formally recorded provider limitation.

### Phase 4 — Repair customer product journeys

- **MJENGO OS first:** reproduce issue #115; trace exact route and entitlement; repair the root cause; test anonymous, ineligible, entitled and cross-tenant users; test direct URL, refresh, back/forward and installed PWA.
- Run the full Business Page journey at KES 149/30 days and KES 999/365 days.
- Run Website Studio create/edit/preview/pay/publish/version/rollback/publication and customer commerce journeys.
- Run POS sale/receipt/refund/stock/offline/reconnect/credit/report journeys.
- Run ERP/BOS tasks, approvals, procurement, notifications and reporting.
- Run Autopilot approval, execution, rollback, pause/stop, retry and dead-letter journeys.
- Run AI Front Desk knowledge, grounding, handoff, escalation and each supported channel; treat voice as separate until a real telephony provider test passes.
- Confirm product isolation, exact pricing/duration, subscription expiry and direct-route denial across all paid products.

**Exit:** every advertised module has a working route and complete user journey; no 404, dead control, misleading status, unintended cross-product entitlement or hidden provider dependency.

### Phase 5 — Complete Website Studio and platform-wide UX acceptance

- Re-capture all 20 supported Website Studio families on the latest candidate across six required viewport sizes, draft/published states and normal/reduced motion.
- Re-capture the historical baseline with comparable fixtures where a genuine comparison is possible; clearly label non-comparable legacy states.
- Independently inspect every required screenshot/recording, not only the dashboard or representative examples.
- Complete missing published AI, media, commerce, fallback, loading, empty and error states.
- Exercise reveal queue saturation, visibility exit/re-entry, interruption recovery, repeated route navigation, observer cleanup and no duplicate rendering.
- Run keyboard-only, focus order, screen-reader labels/announcements, modal behavior, contrast, touch targets, zoom and reduced-motion acceptance on all critical routes.
- Run real-device Android/iOS/PWA acceptance where supported.

**Exit:** visual, motion, accessibility and device acceptance reports are signed off against the exact candidate; capture-job success alone is insufficient.

### Phase 6 — Complete operations, reporting and integrations

- Implement ADMIN-005 reporting from authoritative payment/subscription/usage/job data using the adopted definitions and masking policy.
- Keep commission accrual and payout disabled until a versioned numeric rate schedule and payout terms are separately approved.
- Implement safe configuration registry, kill-switches and health visibility while respecting all-DENY Control access.
- Complete n8n isolated runtime and durable workflow tests.
- Verify MCP endpoint identity/protocol/auth/data/side effects before implementing a deny-by-default gateway.
- Verify mail delivery, domain canonical origin, DNS/TLS/HSTS/cookies and payment callback origin through authorized read-only checks and controlled non-production tests.
- Establish incident response, support escalation, refund handling, backup schedule, on-call ownership, cost monitoring and customer-facing status/maintenance behavior.

**Exit:** no advertised operational capability lacks a defined owner, monitored dependency, safe failure mode and verified customer-facing status.

### Phase 7 — Integrated exact-head release acceptance

- Merge workstreams into one candidate without carrying forward stale CI status.
- Run the complete no-database suite, full PostgreSQL 18 migration/recovery rehearsal, schema reconciliation, production build, typecheck, lint, dependency audits, secret scans, tenant/security matrix and all module journeys.
- Run real isolated Neon/Paystack/R2 journeys and provider-specific tests.
- Capture and independently inspect browser/device artifacts.
- Run the strict programme-completeness check; every mandatory requirement must be PASS with criterion-specific evidence.
- Confirm no unexpected migration, schema drift, environment drift, secret leak, unreviewed dependency or production-side effect.
- Prepare rollback/forward-recovery and staged deployment verification plan.

**Exit:** every required check is green on one exact SHA; all 47 readiness requirements are reconciled; programme-completeness passes without bypass; release owner authorizes the separate Production action.

## 7. Workstream ownership and evidence artifacts

Every remediation item must produce:

- Finding ID and severity.
- Exact root cause, affected source path and affected product journey.
- Source commit and candidate SHA.
- Regression test and the command/workflow that ran it.
- Environment identity (disposable PostgreSQL, isolated Neon Preview, provider sandbox, browser/device).
- Sanitized before/after evidence and artifact reference.
- Data/tenant/payment invariants checked.
- PASS/FAIL/BLOCKED/NOT TESTED evidence label.
- Independent reviewer and review date.
- Remaining limitations and next dependency.

Minimum durable artifacts:

- `docs/audits/REMEDIATION_REGISTER.md` — source finding ledger.
- `docs/agents/PROGRAMME_READINESS.json` — canonical requirement status.
- `docs/agents/OWNER_AUTHORIZED_PROGRAMME_DECISIONS_2026-11-16.md` — policy and authority boundaries.
- `docs/evidence/` — sanitized, immutable test and visual evidence.
- `docs/release/` — exact-candidate acceptance, release manifest and recovery plan.
- GitHub Actions — exact-SHA workflows and downloadable artifacts.

## 8. Release stop conditions

Stop and keep the release NOT READY if any of the following occurs:

- Any critical/high exploitable dependency or security finding is unresolved without an approved risk disposition.
- Any tenant-isolation, authentication, payment-signature, idempotency, ledger or entitlement test fails or is skipped.
- Any product's advertised route returns 404, loops, shows a blank state, grants an incorrect entitlement or has a dead critical action.
- Any customer asset is lost, cross-tenant accessible, not durably stored or cannot be safely deleted/retried.
- Payment, subscription, stock, refund, commission or report totals do not reconcile.
- Preview uses Production credentials/resources or Production uses sandbox credentials.
- Domain/mail/callback behavior is not independently verified where required for customer operations.
- Backup/restore and recovery acceptance is incomplete.
- Required visual, accessibility, mobile/device or browser evidence is missing or not independently reviewed.
- Programme-completeness fails, required evidence is missing, or the tested SHA differs from the candidate being considered for release.
- A requested step requires unapproved spending, plan upgrade, live transaction, production mutation, DNS/mail change, operator grant, provider activation or contract commitment.

## 9. Current evidence snapshot (2026-11-17)

| Area | Evidence | Verdict |
|---|---|---|
| Release Validation | Exact candidate workflow 44151211763, aggregate success | PASS |
| Candidate migration rehearsal | Workflow 44151211983, success | PASS |
| POS / ERP verification | Workflow 44151211767, success | PASS |
| Full no-database suite | Workflow 44151211768, success | PASS |
| Website Studio tenant/content acceptance | Workflow 44151212129, success | PASS for its automated scope |
| Interactive Business E2E | Workflow 44151212066, success | PASS for disposable PostgreSQL scope |
| Preview Neon + Paystack test mode | Dedicated staging DB and test keys; checkout, verification, signature, duplicate event and POS entitlement evidence | PASS for stated synthetic Preview scope |
| Disposable PostgreSQL 18 logical backup/restore | Schema, row counts and migration ledger reconciled | PASS for logical rehearsal only |
| Full dependency tree | 16 high findings through picomatch chain | FAIL |
| Production dependency advisory gate | Zero production findings reported | PASS for production-only scope |
| Programme completeness | Workflow 44151211804; instruction integrity PASS, completeness FAIL | FAIL |
| Readiness manifest | 47 requirements: 23 PASS, 21 BLOCKED, 3 NOT_TESTED | NOT READY |
| Website Studio latest visual matrix | Source corrections committed; latest captures and exhaustive independent review pending | BLOCKED |
| MJENGO OS customer 404 | Issue #115 records Production failure; current exact live retest not established | FAIL REPORTED / NOT VERIFIED FIXED |
| Production Paystack key mode | Suspected shared-target risk; no key decrypted or live transaction run | BLOCKED |
| Production DNS/TLS/mail | Vercel metadata only; authoritative external checks incomplete | BLOCKED |
| Neon provider-native PITR | Not separately rehearsed | NOT TESTED |
| TAWA compatibility | `POWERBot-1/TAWA` repository access returned 404 in prior inspection | BLOCKED |

Workflow run IDs are GitHub Actions evidence identifiers; inspect their artifacts and logs before relying on a detail beyond the scope stated here.

## 10. Final acceptance definition

JATA AFTERCALL is wholesome and releasable only when:

1. A Kenyan SME can discover, register, pay, configure, use, share and renew the relevant product without operator intervention for the normal path.
2. Every paid product unlocks exactly its own capability, for the correct tenant, price and period.
3. Customer data, payments, subscriptions, stock, media and business records are durable, recoverable, auditable and tenant-isolated.
4. AI, automation, messaging, voice, storage and payment integrations work against their real approved non-production providers and fail safely when unavailable.
5. All critical journeys work on supported desktop/mobile/PWA surfaces with accessible, responsive and truthful UI.
6. Owners/operators have accurate aggregate reporting, health visibility, incident and recovery procedures without unauthorized access to PII or financial controls.
7. Security and dependency risks are resolved or formally accepted through an authorized process.
8. The complete programme gate and all mandatory checks pass on the same immutable candidate SHA.
9. Production configuration, payment mode, domain, data migration, recovery and deployment are independently checked and separately authorized.

**Current conclusion: NOT READY.** The candidate has materially advanced, including isolated Neon/Paystack acceptance and successful core CI, but the remaining blockers are real and release-critical. Complete the phases above in order, preserve the existing customer data and product boundaries, and do not convert an implementation claim into a verified outcome without the required evidence.
