# Programme structural remediation execution plan — 2026-11-22

**Scope:** JATA AFTERCALL only. This is an execution map for the outstanding programme register on candidate base `39a3da09932772a65578b4d03249900870ba7c48` (PR #146). It is not a readiness attestation, owner-policy amendment, release authorization, or substitute for exact-head evidence.

## Non-negotiable controls

- Preserve the append-only owner instruction register and the strict programme-completeness gate. Never change a requirement to PASS without its own acceptance evidence.
- Preserve the owner-approved DENY decision for all 90 Control role × capability cells. Keep `CONTROL_ROLE_ACCESS_ENABLED=false`. No grants, positive-role tests, bootstrap identity, or privileged operator are created.
- No production merge/deploy, production SQL or migration, payment/refund/payout, entitlement mutation, scheduler activation, DNS/registrar change, provider activation, paid plan/resource, or secret disclosure.
- Use disposable PostgreSQL, synthetic records, isolated Preview only after its isolation contract is met, and test-only provider credentials. No customer or production records in fixtures.
- Report implementation status separately from evidence status: PASS / FAIL / BLOCKED / NOT TESTED. A code change is not VERIFIED until its required integration/browser/provider evidence passes.

## Current exact-head evidence snapshot

Candidate: `arena/mobile-hero-clearance-remediation-v3-20261122` at `39a3da09932772a65578b4d03249900870ba7c48`; PR #146 is OPEN / DRAFT / UNMERGED.

- Candidate migration rehearsal: PASS on disposable PostgreSQL 18.
- Full logical backup/restore: PASS on disposable PostgreSQL 18.
- D2 build, production dependency audit classification, migration-history/build assertions and Control 1–4 assertions: PASS.
- POS / ERP-PRO: PASS — Prisma schema, client generation, code-reference checks, typecheck, unit suite, offline production build, PostgreSQL clean install/upgrade/rollback/recovery and ERP PostgreSQL suites.
- Admin instruction integrity: PASS. Programme completeness: FAIL.
- Motion browser job 45031735854: historical source capture job PASS (12 captures, six viewports, normal/reduced motion); current candidate capture job was still running at last poll. No final candidate visual acceptance is claimed.
- Vercel Preview deployment `dpl_G7QPaZZ8HWHrzxvALuGmbG9UyUJp`: ERROR at preview-isolation gate. Missing `DATABASE_URL`, `DIRECT_URL`, `JATA_STAGING_DATABASE_HOST`, `AUTH_SECRET`, `NEXTAUTH_SECRET`, `PUBLIC_BASE_URL`, `NEXTAUTH_URL`. Do not weaken the gate or supply credentials without separate authorization.
- Readiness register snapshot: 47 requirements; 23 PASS, 21 BLOCKED, 3 NOT_TESTED. Outstanding IDs are itemized below. This count is not itself a release pass.

## Workstream A — engineering implementation that can proceed without new policy

### A1. ADMIN-005 — aggregate financial and operating metrics
Owner definitions are already recorded in `docs/agents/OWNER_AUTHORIZED_PROGRAMME_DECISIONS_2026-11-16.md`. Implement a server-only read model for:
- MRR and ARR from active, paid/settled subscriptions using immutable recurring-price snapshots; annual values divided by 12; exclude trials, pending, expired, cancelled, suspended, delinquent, one-time fees and unsupported/unknown pricing intervals.
- Gross settled cash, settled refunds and chargebacks separately, net cash by settlement date; exclude TEST/UNKNOWN environment, pending, failed, initiated and unreconciled records; do not estimate missing fees or taxes.
- Subscription counts by persisted lifecycle state.
- AI usage/cost, jobs and incidents only from authoritative persisted/provider sources. If no source exists, return UNAVAILABLE with source and last-check metadata, never a simulated healthy state or inferred cost.
- Reconciliation exceptions by immutable payment/provider identifiers; never auto-correct financial mismatches.
- Aggregate-first output and masked PII. No sensitive fields, amounts, or cross-tenant data are exposed through /control while the all-DENY matrix and runtime kill switch remain in force.
Acceptance: pure calculation tests, PostgreSQL integration fixtures for every status/environment/interval/refund case, idempotency/reconciliation tests, scope tests, and explicit route-denial tests. No payment or ledger writer.

### A2. ADMIN-007 — platform configuration, service and AI oversight
Build only a fail-closed technical foundation:
- Typed registry with schema validation, explicit owner-controlled defaults, versioned change records, actor/reason/correlation metadata and no secrets in the registry.
- Every feature flag defaults OFF; missing/invalid configuration resolves OFF or UNAVAILABLE, never ON.
- Kill switches are scoped by service/tenant and cannot silently disable unrelated services. AI stop controls must preserve consent, data retention, human handoff and audit.
- Health probes report source, observation time, last successful check and VERIFIED / FAILED / UNAVAILABLE. Do not infer provider health from configured credentials or deployment existence.
- No provider configuration mutation, secret read/write, or UI action is enabled. Existing all-DENY permissions remain effective; no new capability or wildcard is introduced.
Acceptance: server-side auth checks, invalid-config fail-closed tests, audit/change-history tests, cross-tenant isolation, kill-switch scope tests, stale-check tests and synthetic provider adapters. Live provider activation is separate.

### A3. ADMIN-015 — evidence and responsive acceptance
Complete the six-view evidence manifest for each applicable public, signed-in, ERP, AI, Studio and denied-Control route. Include route, state, viewport, motion preference, exact SHA, browser version, screenshot/recording checksum, page errors, overflow and overlap observations. Independent inspection must be recorded per artifact; generated screenshots alone are not acceptance.

### A4. Motion acceptance — MOTION-002/003/004/005/006/007/008/011/012/013/014/015/016/017/018
- Exercise actual generate → preview → publish paths for all 20 supported families, draft and published states, classic fallback, AI preview/denial, commerce routes, six viewports and normal/reduced/disabled motion. Do not republish existing customer sites.
- Match historical and candidate fixtures/routes/states where comparable. The owner-named historical baseline at `a28c1a46101ac90bbf28d374b4986b689196de8d` is legacy-default only (12 screenshots); it is not a matched baseline for the later 20 generated families.
- Capture real browser before/after recordings, route/state observations, queue saturation, visibility exit/re-entry, cancellation, preference changes, navigation/unmount cleanup and no duplicate observers.
- Independently inspect all final-head images and recordings. Record any unsupported or unobserved surface as NOT TESTED.
- Preserve reduced-motion behavior, keyboard access, transaction-state truth, no layout shift and no horizontal overflow.
Acceptance: exact-head workflow pass, machine-readable observation matrix, inspected artifacts and a requirement-by-requirement evidence manifest.

## Workstream B — mixed engineering plus explicit owner/provider dependency

### B1. ADMIN-006 and ADMIN-013 — commission lifecycle
Implement only policy-independent primitives and synthetic tests. Owner policy already defines first-touch, 30-day attribution, single-agent attribution, eligible first settled non-test subscription payment, exclusions, proportional/full reversal and append-only linkage. Numeric rate schedule is still NOT CONFIGURED; payout method, threshold, timing, hold, maker-checker and payee verification remain unapproved. Therefore:
- No accrual writer, payable balance, payout, rate default, or financial mutation.
- Test duplicate/out-of-order settlement, refund and chargeback event ingestion using synthetic fixtures only.
- Keep evaluator refusing accrual until a versioned numeric rate schedule and separate implementation authorization exist.
- Keep ADMIN-006/013 BLOCKED until both engineering acceptance and owner-controlled financial terms are complete.

### B2. ADMIN-009 — canonical domain
Engineering may implement and test an application-level canonical redirect only after verifying that it does not break callback, cookie, OAuth or preview hosts. DNS, nameservers, A/AAAA/CNAME, certificate provisioning and email DNS remain owner-controlled. Vercel metadata previously showed apex and www attached without canonical redirect; authoritative DNS/TLS and mail-auth checks remain NOT TESTED. No DNS/registrar edits.

### B3. ADMIN-010 — Control acceptance
Maintain and prove the denied journey, all 90 DENY cells, no grants, no sensitive data and six-view denied-state screenshots. Positive operator acceptance cannot pass under the current owner-approved all-DENY policy. Do not grant an operator or weaken the gate. Reopen only after a separate exact-cell ALLOW decision and provisioning/test authorization.

### B4. ADMIN-014 — recovery
Keep disposable PostgreSQL 18 migration and logical backup/restore evidence. Separately document and rehearse supported migration forward/rollback/recovery phases on disposable infrastructure. Neon provider-native restore parity has prior evidence, but historical PITR, schedule, RPO ≤15 minutes and RTO ≤4 hours remain unproven. Current plan/quotas do not support claiming scheduled snapshots. No paid plan upgrade, new paid resource, production restore or destructive test without approval.

## Workstream C — external integration and release prerequisites

### C1. Preview isolation
Preview must have a dedicated staging database host and URLs, test-only Paystack keys/webhook secret, isolated storage, non-production callback URLs and safe auth settings. The current exact-head Vercel build fails closed on seven missing isolation variables. Do not disable the guard, reuse production credentials/data, or populate environment values without separate owner approval.

### C2. Paystack sandbox
Run checkout → signature verification → idempotent webhook → settlement → entitlement → duplicate/out-of-order → refund → chargeback only with dedicated test keys, isolated database/storage and non-production callback. No live payer, charge, refund or payout.

### C3. TAPNET/Telnyx
Current Kenya market documentation is not proof of account eligibility, live +254 inventory, KYC approval or actual inbound PSTN. Continue written remote pre-review and pricing clarification only. No DID order, port, activation, funding, paid usage or live calls without explicit authorization.

### C4. Release
RELEASE-001 stays BLOCKED until each mandatory finding has a root-cause trace, fix, focused test and appropriate independent evidence; all programme requirements pass; Preview isolation and provider sandbox lifecycle pass; recovery and six-view browser evidence pass. No merge/deploy before the strict gate is green and a separate release authorization is given.

## Outstanding requirement ledger (authoritative status unchanged)

| Requirement | Current status | Principal next action | Dependency / boundary |
|---|---|---|---|
| ADMIN-005 | BLOCKED | Implement aggregate financial/operating read model and reconciliation tests | No Control exposure under all-DENY; no PII or unverified metrics |
| ADMIN-006 | BLOCKED | Synthetic event/reversal/reconciliation engineering only | Numeric rate schedule and payout authority absent |
| ADMIN-007 | BLOCKED | Build fail-closed config, health and scoped kill-switch foundation | No secrets/provider writes; all Control grants denied |
| ADMIN-009 | BLOCKED | App-level redirect analysis/tests; external HTTPS/DNS evidence | No DNS/registrar/certificate mutation |
| ADMIN-010 | BLOCKED | Complete denied-state six-view evidence and security tests | Positive operator path prohibited by all-DENY |
| ADMIN-013 | BLOCKED | Synthetic commission lifecycle/reversal tests | Rate schedule and payout policy not configured |
| ADMIN-014 | BLOCKED | Disposable recovery phases, timed drills, documented runbook | Historical PITR/snapshot schedule and plan decision absent |
| ADMIN-015 | BLOCKED | Full exact-head artifact inspection and six-view evidence | Positive Control journey remains denied |
| MOTION-002 | BLOCKED | Generate/preview/publish 20 families and all relevant routes | No customer republish |
| MOTION-003 | NOT TESTED | Matched baseline/performance/lifecycle comparison | Legacy-only baseline is not family-matched |
| MOTION-004 | NOT TESTED | Compare final screenshots against retained baselines | Complete independent visual review required |
| MOTION-005 | NOT TESTED | Keyboard/mobile/desktop motion inspection across all surfaces | No universal motion claim before coverage |
| MOTION-006 | BLOCKED | Matched before/after recordings and six-view captures | Independent review required |
| MOTION-007 | BLOCKED | Map §032 every requirement to source/test/browser evidence | Exact-head full coverage required |
| MOTION-008 | BLOCKED | Complete §032 lifecycle/accessibility/performance acceptance | No gate weakening |
| MOTION-011 | BLOCKED | Authenticated AI renderer and authoritative state journey | No live provider or customer data |
| MOTION-012 | BLOCKED | Full route/state matrix across family, preview, published, fallback and commerce | Synthetic isolated fixtures only |
| MOTION-013 | BLOCKED | Route-by-route evidence and inspection manifest | Exact-head artifact inspection |
| MOTION-014 | BLOCKED | Independently inspect all final-head screenshots/video | No screenshot-only acceptance |
| MOTION-015 | BLOCKED | Exact-head queue/re-entry/cancel/cleanup evidence | Prior queue stress on older SHA is not current-head proof |
| MOTION-016 | BLOCKED | Matched baseline, commerce/Studio coverage, recordings and six-view review | Same-fixture reproducibility required |
| MOTION-017 | BLOCKED | Capture identical route/state matrix on historical and final heads | Current legacy baseline is insufficient |
| MOTION-018 | BLOCKED | Inspect exact-head queue/cleanup artifacts | Prior clean suite does not prove browser lifecycle |
| RELEASE-001 | BLOCKED | Integrate every remediation, provider, security and evidence gate | No merge/deploy/production mutation |

## Execution order and stop conditions

1. Finish current exact-head motion capture; inspect its generated-family observations and screenshots before any CSS change.
2. Implement ADMIN-005 as a read-only, fail-closed server-side metrics slice; test it on disposable PostgreSQL while the Control runtime remains disabled.
3. Implement ADMIN-007's non-operational typed registry/health contracts and synthetic tests; no provider secrets or Control access.
4. Complete the motion route/state evidence matrix and independent artifact review.
5. Continue synthetic commission/reversal and disposable recovery testing; leave owner-controlled values and activation blocked.
6. Resolve Preview isolation only through explicit owner-authorized test-only configuration; rerun build and sandbox lifecycle.
7. Reconcile every exact-head result into the authoritative register with precise evidence. Keep RELEASE-001 BLOCKED until every prerequisite passes.

**Stop immediately** on a production resource, real customer data, secret, payment/provider action, paid resource, DNS mutation, positive Control permission, ambiguous financial source, or test that cannot guarantee isolation. Record the exact blocker; do not improvise a value or bypass.
