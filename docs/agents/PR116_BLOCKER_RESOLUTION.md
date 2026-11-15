# PR #116 — readiness blocker classification and owner decisions

As of 2026-11-15; branch `arena/d1e54a52-jata-aftercall`, candidate head 3b8ee80fcb7c211f58bc11b283692a2d7ae0a030. This is a classification, not a readiness override. No policy, access, financial or release gate is changed. Source of truth: PROGRAMME_READINESS.json and cited acceptance source.

## Owner-gated approvals (consolidated)

1. **Control data policy:** ADMIN-005 — approve field-level financial/PII visibility and precise metric set; no sensitive display before this.
2. **Financial/Paystack authority:** ADMIN-006, ADMIN-013, RELEASE-001 — approve commission terms, lifecycle/reversal/reconciliation, verification scope, and individually authorize any P0 financial/domain/email action. No blanket production permission implied.
3. **Control scope/operator:** ADMIN-007, ADMIN-010 — confirm configuration/feature flag/AI kill-switch scope and authority; provision one authorized operator under the approved access policy.
4. **Domain inspection:** ADMIN-009 — authorize read-only DNS/HTTPS/redirect/cookie inspection position. This does not authorize DNS or environment changes.
5. **Recovery policy:** ADMIN-014 — define whether backup/restore rehearsal is required and provide target retention/RPO/RTO and non-reversible migration acceptance.
6. **Studio behavior:** MOTION-002 — identify generated families and permitted regeneration/re-inheritance path; no silent republish.
7. **Visual evidence policy/assets:** MOTION-006 — accept screenshots or specify recording channel; MOTION-012/013 — settle required family/route/capture matrix where acceptance is ambiguous. Provide/recover genuine historical baseline for MOTION-003/004/016/017; this is an evidence dependency, not permission to fabricate a baseline.
8. **Motion specifications:** MOTION-007 and MOTION-008 — supply the current owner-authored spec revisions (including register 032). No invention/substitution.
9. **Priority:** MOTION-011 — confirm priority for AI Front Desk renderer coverage.

Approvals can be given together with a decision per numbered item; absent approval, restricted behavior remains unimplemented/untested.

## All 24 non-PASS records

Each requirement below reproduces the manifest acceptance statement (exact criterion), summarizes current record evidence, identifies the gap, owner decision, independent work, and a concrete closure action. “Owner decision: no” means evidence/access/engineering is missing, not that acceptance may be relaxed.

### ADMIN-005 — BLOCKED
- **Requirement:** Verify authoritative sources, role and tenant isolation, audited actions and independent screenshots at all six owner-specified viewport sizes.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. Console modules exist for businesses, agents, exceptions and audit, but MRR/ARR, payment, subscription, AI usage, job and incident panels are not implemented and the console withholds PII and financial figures pending owner policy. Owner: approve the PII/financial display policy and confirm the metric set.
- **Missing evidence:** `app/api/control/overview/route.ts`, `app/api/control/businesses/route.ts`, `app/api/control/audit/route.ts`, `components/control/ControlConsole.tsx`, database `Business`, `Subscription`, `Payment`, agent evidence, outbox, and `ControlAuditEvent` models.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes — approval before exposing sensitive values; non-sensitive UI skeleton/testing can proceed.
- **Independent engineering:** Approve a field-level PII/financial display policy and metric definitions (MRR/ARR, payments, subscriptions, AI usage, jobs, incidents); then implement guarded views and six-viewport evidence.
- **Exact resolution action:** Implement scoped, audited metric APIs after approval; test role/tenant isolation and independently inspect captures.

### ADMIN-006 — BLOCKED
- **Requirement:** authenticated synthetic event → authoritative attribution → idempotent accrual → reversal → reconciliation → scoped dashboard; duplicate/out-of-order and unauthorized-action tests. **Dependencies/conflicts:** owner states relevant decisions approved, but exact commission terms were not located in repository/PR/Drive; do not invent. Technical test fixtures must be explicitly labelled and cannot activate production.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. Read-only commissions and agent breakdowns exist; activation, reconciliation, reversals and verified payment require financial authority the register itself records as BLOCKED. Owner: authorize the financial policy and the Paystack verification scope.
- **Missing evidence:** `app/api/paystack/**`, `lib/agents/**`, agent/admin routes, payment, subscription, attribution and ledger models; existing pricing baselines: monthly KES 149, annual KES 999, AI Front Desk KES 499/month, Website Studio KES 999/month, Business POS KES 499/month, Autopilot KES 2,499/6,999/19,999. Inspect actual production configuration before presenting or changing prices; no production access authorized as part of implementation.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes — financial approval required; synthetic-only tests can continue.
- **Independent engineering:** Approve commission terms, attribution, activation, reconciliation, reversals, and exact Paystack verification scope.
- **Exact resolution action:** Implement/rehearse idempotent ledger lifecycle with synthetic fixtures; live activation/payment remains prohibited until approval.

### ADMIN-007 — BLOCKED
- **Requirement:** server-side module/action authorization, confirmation/change-history tests, cross-tenant tests, kill-switch scope, health-source provenance and last-check verification.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. No configuration module, no feature-flag or AI kill-switch UI, no service-health monitoring. Not implemented. Owner: confirm scope and priority.
- **Missing evidence:** control APIs/views, existing feature-flag infrastructure, Vercel, Neon, Paystack, messaging, AI, POS, Studio, media and audit. No production configuration, DNS, billing or provider changes.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes — engineering can design read-only health provenance and config UI; production controls require approved scope.
- **Independent engineering:** Owner confirms configuration module scope/priority and kill-switch authority/scope.
- **Exact resolution action:** Build authorization/history tests and health-source verification; only then expose approved controls.

### ADMIN-009 — BLOCKED
- **Requirement:** independent HTTPS checks, authorized access and unauthorized denials on exact official URL, plus canonical redirect and cookie tests.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. The canonical domain serves the application and /control refuses anonymous visitors, but cookie scope, HTTPS/HSTS headers, the redirect matrix and DNS state can only be verified from an authorized network position, and the register forbids changing DNS, domain records or env vars without separate approval. Owner: authorize or perform that inspection.
- **Missing evidence:** Vercel domains and routing, Next.js routes, auth/cookies. No new domain added or changed.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes — local tests possible; external verification needs authorized vantage.
- **Independent engineering:** Authorize read-only inspection of official-domain DNS, redirects, HTTPS/HSTS and cookie behavior from an approved network position; no DNS/env changes implied.
- **Exact resolution action:** Run documented read-only URL/header/cookie matrix and archive exact-head evidence.

### ADMIN-010 — BLOCKED
- **Requirement:** Deliver a functional, non-mocked console with real data, audited changes, all modules and security tests; independently inspect real screenshots at 320×568, 360×800, 390×844, 430×932, 768×1024 and 1366×768; report status, recovery, exact branch/SHA/PR and production verification separately.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. Umbrella acceptance over ADMIN-005 and ADMIN-007 plus a provisioned operator; cannot pass while those are open and while the owner-approved all-DENY matrix leaves the console without an operator. Owner: provision at least one authorized operator.
- **Missing evidence:** `app/control/**`, `app/api/control/**`, `components/control/ControlConsole.tsx`, `prisma/**`, `lib/control/**`, control route/security/PostgreSQL test paths, and `docs/agents/CONTROL_PLANE_MIGRATION_RECOVERY.md`.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** No for positive operator journeys; denial tests continue.
- **Independent engineering:** Provision at least one authorized operator under approved access policy; resolve ADMIN-005/007.
- **Exact resolution action:** After provisioning, perform authenticated real-data console journey and independent viewport inspection.

### ADMIN-013 — BLOCKED
- **Requirement:** complete authenticated route E2E, duplicate/out-of-order/reversal/recovery tests and bounded large-report verification. **Dependencies/conflicts:** exact approved rates, events, attribution and reversal terms not located; do not invent or enable accrual/payouts. **Evidence/commit:** `docs/agents/RELEASE_GATE_AND_RUNBOOK.md`; connected journey remains incomplete.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. Synthetic engineering is done (applications, consent, attribution, notification and scheduler recovery, authenticated browser journey); activation, verified payment, idempotent commission and reversal need an approved commission policy. Owner: approve the agent/commission policy.
- **Missing evidence:** `app/api/agents/**`, `app/api/paystack/**`, `lib/agents/**`, existing ledger, referral, report, scheduler and notification models and tests.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes — synthetic implementation is independent; no production activation/payment.
- **Independent engineering:** Approve commission policy (rates, attribution, eligible event, activation, reversal, reconciliation) and Paystack verification authority.
- **Exact resolution action:** Finish authenticated duplicate/order/reversal/recovery and bounded-report acceptance with synthetic data; live financial path only after approval.

### ADMIN-014 — BLOCKED
- **Requirement:** Record native migration evidence for each requested phase, including a safe strategy for non-reversible migrations; validate restore/recovery and compatibility on disposable infrastructure.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. The rehearsal proves fresh install, ordered history, ledger completeness, object shapes, psql -f parity, idempotence and failure detection on disposable PostgreSQL 18 and passes on this head; backup/restore and the non-reversible-migration strategy have no artefact in this repository. Owner: confirm whether backup/restore rehearsal is in scope.
- **Missing evidence:** `prisma/migrations/20261126000000_control_plane_foundation/migration.sql`, `tests/prisma/control-plane-foundation-postgres.test.ts`, `docs/agents/CONTROL_PLANE_MIGRATION_RECOVERY.md`.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes — disposable backup/restore can be designed; owner defines policy targets.
- **Independent engineering:** Confirm backup/restore rehearsal scope, target retention/RPO/RTO and acceptable non-reversible migration strategy.
- **Exact resolution action:** Create disposable PostgreSQL backup/restore + migration rollback/recovery evidence, record approved target policy.

### ADMIN-015 — BLOCKED
- **Requirement:** six-view actual authenticated evidence and independent findings for each applicable surface. **Dependencies/conflicts:** the Control route now exists, but authenticated role journeys and the complete connected journey remain unverified. **Evidence/commit:** existing general screenshots do not satisfy this requirement; Control-specific evidence remains outstanding.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. Six-viewport captures exist for the public pages, the signed-in dashboard, the ERP workspace and the /control denial path, but the acceptance requires independent inspection of every image including control, registration, agent dashboard, financial state, motion and template-family journeys; only the premium capture set is retrievable in this environment.
- **Missing evidence:** browser E2E scripts, actual app routes, screenshot artifacts and release documentation.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes — capture generation possible; complete review/access depends on artifacts and authorized test identities.
- **Independent engineering:** Provide/retrieve complete exact-head capture set and independent reviewer; ensure authorized roles/data fixtures for restricted screens.
- **Exact resolution action:** Capture all required routes/states/viewports, provide inspectable artifacts, record reviewer findings.

### MOTION-002 — BLOCKED
- **Requirement:** test each supported family through actual generate/preview/publish without production publication; verify new/future inheritance, existing-site update mechanism, per-tenant isolation, brand preservation, desktop/mobile, forms/transactions, reduced-motion/off and screenshots/recordings. Any untested family is explicitly NOT TESTED. **Dependencies/conflicts:** detailed template and pipeline inventory, approved compatibility design, fixed session branch/PR.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. Storefront inheritance is covered; the Website Studio generation, preview and publishing paths were not exercised on this head and existing sites must not be silently republished. Owner: confirm which generated families must re-inherit and by what regeneration path.
- **Missing evidence:** `lib/experience/{motionPolicy,motionRecipes,motionRuntime,renderMode,templateFamilies,workspace,document}.ts`, Studio preview/publish routes, generated-site renderer, templates, tests and documentation. Existing Lite/HTML and `motion` modes must remain functional; do not presume every template is already covered.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes — disposable fixtures and code tracing can proceed; owner defines desired families/path.
- **Independent engineering:** Confirm generated family list and permitted re-inheritance/regeneration path, specifically preventing silent republish.
- **Exact resolution action:** Exercise Studio generation/preview/publish with explicit draft/version safeguards and approved family matrix.

### MOTION-003 — NOT_TESTED
- **Requirement:** complete generation-path inventory, representative baseline screenshots, reuse plan, performance/reduced-motion tests and explicit NOT TESTED list. **Dependencies/conflicts:** existing open PRs #41/#42 and fixed PR #77 branch; no design changes or production publication authorized.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept NOT_TESTED. docs/agents/CONTROL_AND_MOTION_AUDIT.md holds the inventory and reuse plan; baseline screenshots exist only as artifacts of an earlier commit, are not this head's baseline, and are not retrievable.
- **Missing evidence:** `docs/agents/CONTROL_AND_MOTION_AUDIT.md`, Studio render/preview/publish paths, existing motion helpers and browser test infrastructure. No schema changes for motion without separate authorization.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes — capture current head; historical comparison blocked on baseline availability.
- **Independent engineering:** No policy approval; provide/recover genuine prior-commit screenshots for same route/state or approve establishing a new baseline (not retroactive).
- **Exact resolution action:** Capture exact-head baseline and compare only to genuine matching historical states; annotate limits.

### MOTION-004 — NOT_TESTED
- **Requirement:** behavior and inheritance tests for every applicable surface and supported template family, genuine browser evidence and no static visual regressions. **Dependencies/conflicts:** `MOTION-001`–`MOTION-003`; no universal inheritance or full coverage claimed until verified. **Evidence/commit:** `docs/agents/CONTROL_AND_MOTION_AUDIT.md`; implementation not started for this directive.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept NOT_TESTED. Primitives, unit tests and real-Chrome family coverage pass; proving no static visual regression requires comparing rendered output against a retained baseline, which no reachable channel provides for this head.
- **Missing evidence:** existing `lib/experience/motion*`, `components/storefront/**`, shared interaction components and actual Studio publishing paths; open PRs #41/#42 require overlap review.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes, once baseline reachable.
- **Independent engineering:** No policy approval; obtain retained matching baseline artifacts.
- **Exact resolution action:** Run pixel/semantic comparison for identical routes and states; archive artifacts and findings.

### MOTION-005 — NOT_TESTED
- **Requirement:** shared token and reduced-motion tests pass; inspect actual keyboard, mobile and desktop behavior; complete remaining page, chart, loading, transaction and Website Studio family coverage before claiming universal motion. **Dependencies/conflicts:** no motion-related schema migration or production republish.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept NOT_TESTED. Shared tokens and reduced-motion tests pass; the register defers the universal claim until page, chart, loading, transaction and Studio-family coverage is complete and real keyboard/mobile/desktop behaviour is inspected.
- **Missing evidence:** `app/globals.css`, `tests/unit/motion-system.test.ts`, existing workspace navigation and status components.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes.
- **Independent engineering:** No policy approval; complete route/family enumeration and real keyboard/mobile/desktop checks.
- **Exact resolution action:** Run reduced-motion, keyboard and responsive behavior suite across enumerated pages/charts/loading/transactions/Studio; report coverage.

### MOTION-006 — BLOCKED
- **Requirement:** real authenticated before/after recordings, six responsive viewport screenshots, reduced-motion interaction and authoritative state verification; all surfaces and Studio families must be tested before declaring universal coverage. **Dependencies/conflicts:** no concurrent worker available in this session; local disposable DB and browser needed for actual authenticated evidence.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. Workspace and agent entrances and reduced-motion-gated chart animation exist, but the acceptance requires real authenticated before/after recordings, which no workflow in this repository produces. Owner: accept screenshots as the evidence form or supply a recording channel.
- **Missing evidence:** `components/DashboardClient.tsx`, `app/agents/dashboard/page.tsx`, `components/ui/AnalyticsChart.tsx`, `app/globals.css`, `docs/agents/MOTION_PRODUCT_AUDIT.md`.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes — screenshots and behavior automation can proceed; prescribed recording form needs decision.
- **Independent engineering:** Owner decides whether screenshots satisfy recording evidence or provides an approved recording channel.
- **Exact resolution action:** Capture authenticated before/after evidence in approved format and inspect.

### MOTION-007 — BLOCKED
- **Requirement:** every item in the quoted instruction, including actual before/after browser recording, six viewports and each template family; no universal claim before all evidence. **Dependencies/conflicts:** the referenced separate detailed specification is not independently recoverable from visible conversation; no independent coding worker is available here.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. The specification this record implements is the owner-provided advanced fintech motion specification. Owner: supply or point to the current revision.
- **Missing evidence:** `lib/experience/motionRuntime.ts`, `tests/unit/storefront-motion.test.ts`, existing shared application motion and Studio pipelines.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** No, not for spec-dependent claims; generic accessibility/behavior tests can proceed.
- **Independent engineering:** Provide or point to current advanced fintech motion specification revision.
- **Exact resolution action:** Implement against supplied revision and map each criterion to exact-head evidence.

### MOTION-008 — BLOCKED
- **Requirement:** all acceptance criteria and definition of done in sections 12–15 above. **Dependencies/conflicts:** fixed Arena branch and existing open draft PR #77 supersede a separate branch/new PR; the official canonical domain instruction in ADMIN-003 is retained and the Vercel URL above is infrastructure. Existing per-site Lite/none settings and OS reduced motion must remain effective.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. Owner-provided specification (register 032, 540 lines). No agent may invent it. Owner: provide the specification.
- **Missing evidence:** shared motion, existing modules, Website Studio generation/render/publish, tests and browser evidence; exact implementation paths are recorded in later append-only updates.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** No for spec-dependent work.
- **Independent engineering:** Provide the 540-line owner specification/register 032 revision.
- **Exact resolution action:** Implement and test each explicit requirement; do not infer or author replacement criteria.

### MOTION-011 — BLOCKED
- **Requirement:** real browser coverage and independent six-viewport review of every family, route, preview/published/fallback, queue/reduced/disabled behavior and recordings, exact-head workflows, plus genuine programme acceptance without gate weakening. **Dependencies/conflicts:** no local browser or disposable PostgreSQL; no independent coding workers; existing readiness failures are unevidenced programme obligations rather than checker bugs.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. AI Front Desk renderer integration and the complete coverage matrix are not verified on this head. Owner: confirm priority.
- **Missing evidence:** `app/b/[slug]/ai/page.tsx`, `components/AIFrontDeskCustomerClient.tsx`, `components/storefront/RenderModeProbe.tsx`, `lib/experience/motionRuntime.ts`, `app/globals.css`, `tests/unit/storefront-motion-inheritance.test.ts`, `tests/unit/ai-front-desk-customer-default-state.test.ts`, `docs/agents/MOTION_011_COVERAGE_MATRIX.md`.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes.
- **Independent engineering:** Owner confirms priority; technical integration/coverage can proceed independently of priority if existing approved scope permits.
- **Exact resolution action:** Trace AI Front Desk renderer, implement missing verified integration, test all supported routes/families in real Chrome.

### MOTION-012 — BLOCKED
- **Requirement:** every family and applicable route through actual generation and publishing, before/after recordings and independently reviewed six-view screenshots, queue/re-entry/cleanup, disabled/reduced and exact-head workflow results. **Dependencies/conflicts:** CI can run real Chrome and PostgreSQL, but this initial read-only harness only exercises seeded classic/AI preview/denial/not-found; it does not cover generated Studio families or actual AI publication. Before/after build comparison and independent inspection remain incomplete.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. Real-Chrome workflows on disposable PostgreSQL exist; the register requires the coverage matrix across every enumerated template family and route with inspectable evidence. Owner: confirm the enumeration or accept the covered set.
- **Missing evidence:** `.github/workflows/motion-evidence.yml`, `scripts/motion/disposable-browser-evidence.mjs`, `docs/agents/PROGRAMME_READINESS.json`.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes — existing set can be exercised and gaps enumerated.
- **Independent engineering:** Owner confirms exact family/route enumeration or accepts a specifically documented covered set.
- **Exact resolution action:** Run disposable PostgreSQL/real-Chrome matrix, publish per-route artifacts, close only listed coverage.

### MOTION-013 — BLOCKED
- **Requirement:** independent visual evidence across every supported real generation/publishing route/family, six viewports, correct motion/disabled/reduced/queue behavior and exact-head workflow results. **Dependencies/conflicts:** 9acb1d8 browser run failed 48/48 due to absent recordings; sandbox cannot access redirected artifact blob; the 20-family matrix and before/after independent review are not complete.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. Evidence is published into the branch through the visual-evidence channel; the register requires the complete route matrix with inspectable evidence for every path. Owner: confirm the accepted capture set.
- **Missing evidence:** `.github/workflows/motion-evidence.yml`, `scripts/motion/disposable-browser-evidence.mjs`, `docs/agents/MOTION_013_EVIDENCE.md`, `docs/agents/PROGRAMME_READINESS.json`.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes — capture generation and matrix can proceed.
- **Independent engineering:** Owner confirms acceptable capture set/coverage if broader acceptance is ambiguous; retrieve artifact blobs.
- **Exact resolution action:** Publish inspectable complete route/family/viewport evidence and exact-head workflow output.

### MOTION-014 — BLOCKED
- **Requirement:** real independently inspected baseline and after captures and recordings across all families, routes and states, real queue/re-entry/cleanup and accessibility checks, and exact-head results. **Dependencies/conflicts:** new harness results pending; annotations cover only a small safe public fixture and do not constitute universal visual review; broader completeness requirements are still unmet.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. Requires independent visual inspection of the final-head capture; inspection is limited to the published premium capture set and is recorded as such.
- **Missing evidence:** `.github/workflows/motion-evidence.yml`, `scripts/motion/generated-family-evidence.mjs`, `scripts/motion/disposable-browser-evidence.mjs`, `docs/agents/MOTION_014_EVIDENCE.md`, `docs/agents/PROGRAMME_READINESS.json`.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes, after artifacts available.
- **Independent engineering:** No policy approval; independent reviewer and reachable exact-head captures required.
- **Exact resolution action:** Independent visual review of each required final-head capture with findings.

### MOTION-015 — BLOCKED
- **Requirement:** actual route and behavioural evidence, before/after baselines and independently inspected six-view artifacts, plus all exact-head workflows; every previously registered programme requirement still needs its own acceptance. **Dependencies/conflicts:** separate workers unavailable; API storage egress blocks image retrieval here; browser queue stress, published AI, true previous-build baseline, recordings and independent review are not yet implemented by this partial harness.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. Requires proof of live browser motion behaviour (concurrency saturation, queueing, re-entry, cancellation) with inspectable evidence from this exact head.
- **Missing evidence:** `.github/workflows/motion-evidence.yml`, `scripts/motion/route-behaviour-evidence.mjs`, `docs/agents/REQUIREMENT_WORK_ASSIGNMENTS.md`, `docs/agents/PROGRAMME_READINESS.json`.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes.
- **Independent engineering:** No owner policy approval identified; needs browser harness/artifact access.
- **Exact resolution action:** Implement/run saturation, queue, re-entry, cancellation and cleanup browser tests; retain exact-head evidence.

### MOTION-016 — BLOCKED
- **Requirement:** all six acceptance areas plus independently inspected six-viewport before/after screenshots and recordings, complete evidenced programme gate and exact-head workflow results. **Dependencies/conflicts:** independent coding workers unavailable; artifact blob host blocked by sandbox egress; no real-browser queue stress, full commerce, published AI or historical baseline yet.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. Depends on MOTION-007/008 plus a genuine historical baseline and complete commerce coverage. Owner: provide the specification and baseline.
- **Missing evidence:** `.github/workflows/motion-evidence.yml`, `scripts/motion/generated-family-evidence.mjs`, `scripts/motion/route-behaviour-evidence.mjs`, `docs/agents/MOTION_ACCEPTANCE_REMEDIATION.md`, `docs/agents/REQUIREMENT_WORK_ASSIGNMENTS.md`, `docs/agents/PROGRAMME_READINESS.json`.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Partially — generic coverage work proceeds, spec/baseline-dependent comparisons do not.
- **Independent engineering:** Owner supplies MOTION-007/008 specifications and genuine baseline; commerce coverage also required.
- **Exact resolution action:** Complete spec-driven commerce tests plus matching before/after evidence.

### MOTION-017 — BLOCKED
- **Requirement:** every preceding criterion, independent evidence inspection, all 40 prior requirements and strict gate must pass on the integrated exact head. **Dependencies/conflicts:** full artifact egress blocked; historical same-fixture captures and recordings not obtained; independent coding workers unavailable.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. Requires a genuine historical baseline for identical routes and states; none is available.
- **Missing evidence:** `scripts/motion/route-behaviour-evidence.mjs`, `docs/agents/MOTION_ACCEPTANCE_REMEDIATION.md`, `docs/agents/REQUIREMENT_WORK_ASSIGNMENTS.md`, `docs/agents/PROGRAMME_READINESS.json`.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes, after source artifact is recoverable.
- **Independent engineering:** No approval; genuine historical baseline artifact required.
- **Exact resolution action:** Compare same routes/states to authentic historical capture; otherwise remain NOT TESTED.

### MOTION-018 — BLOCKED
- **Requirement:** all owner criteria, independent evidence and exact-head gate must pass. **Dependencies/conflicts:** sandbox egress blocks official Prisma engine download and artifact blob host; historic matching captures unavailable; independent workers unavailable.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. The clean reproducible suite requirement is met on this head; the remaining queue/cleanup browser behaviours need inspectable evidence.
- **Missing evidence:** `package.json`, `scripts/test/check-prisma-client.cjs`, `.github/workflows/full-local-suite.yml`, `docs/agents/LOCAL_TEST_ENVIRONMENT.md`, `docs/agents/MOTION_ACCEPTANCE_REMEDIATION.md`, `docs/agents/REQUIREMENT_WORK_ASSIGNMENTS.md`, `docs/agents/PROGRAMME_READINESS.json`.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes.
- **Independent engineering:** No approval; inspectable queue/cleanup browser evidence required.
- **Exact resolution action:** Run queue/cleanup cases and publish exact-head artifacts.

### RELEASE-001 — BLOCKED
- **Requirement:** each remediation ID has a root-cause trace and appropriate independent evidence; every visual claim has genuine browser evidence; every tenant/payment claim has the relevant isolated integration proof; no finding is VERIFIED from code inspection or a unit test alone where integration/browser proof is required. Use finding statuses PENDING / IN PROGRESS / BLOCKED / IMPLEMENTED / VERIFIED and evidence labels PASS / FAIL / BLOCKED / NOT TESTED; keep these separate. Release remains NOT READY until all mandatory gates pass. Never weaken `programme-completeness` or any security/release gate to obtain green CI.
- **Current evidence:** Reconciled on 2026-11-07 against candidate head d5c3f56da052a51836cf387d2cd0d31da401af04 and kept BLOCKED. P1 controls, tenant isolation and authenticated journeys are substantially evidenced in CI; P0 domain/email verification and payments/financial integrity authorization remain open by design. Owner: authorize each P0 action individually.
- **Missing evidence:** all routes/components/services/models/integrations enumerated in `docs/audits/`; `docs/audits/REMEDIATION_REGISTER.md`; tests and disposable CI; this instruction file. Primary P0 areas: `lib/url.ts`, `lib/payments/**`, `app/api/paystack/**`, `app/api/checkout/**`, `app/api/media/**`, `lib/storage/**`, tenant/session guards and product journeys. The exact affected paths must be recorded per finding after source tracing, not inferred from roadmap names.; acceptance not demonstrated on this candidate; see stated gaps above.
- **Owner approval:** Yes — safe synthetic controls/tests can proceed; release cannot pass until P0 is approved and evidenced.
- **Independent engineering:** Authorize each P0 action individually: domain/email verification and financial/payment verification/operations; do not interpret as blanket production authorization.
- **Exact resolution action:** Complete exact-head root-cause and integration evidence for each mandatory finding, then rerun strict gate without suppression.

## Shared engineering work (no production impact)

- **Product event boundaries:** trace state-changing transaction points; use explicit event allowlists and minimal payloads. Producers must be emitted from the same database transaction as business state or through a transactionally coupled outbox write; never rely on an after-commit best-effort call as durable evidence.
- **Outbox:** AutomationEvent already has a durable table, leasing/status fields, and delivery worker foundation. The current helper inserts separately and there are no producers. Next implementation must expose a transaction-scoped enqueue function accepting the caller's Prisma transaction client, confirm provider/database compatibility, and add migrations/DB tests for rollback atomicity, tenant mismatch rejection, duplicate event IDs, concurrent claim, lease expiry, retry/backoff and terminal failure.
- **Producer test matrix:** one isolated integration test per actual transaction boundary: tenant ID is derived from authorized persisted object (never caller event payload), state transition and event insert commit/rollback together, duplicate retries are idempotent, no sensitive data in payload, and cross-tenant negative tests. Product scope: Business Page onboarding/enquiry; AI Front Desk follow-up/handoff; Studio publish/lead; POS sale/stock; BOS summary-ready data; MJENGO milestone/reminder; Autopilot proposal/approval state; TAPNET activation status only after verified provider integration. Do not label these integrated until verified.
- **Workflows:** define versioned JSON exports only after event schemas and API actions are specified. Validate import/schema, node credentials externalization, event deduplication and mocked API contract tests. Any consequential action must call authenticated permission-checked JATA APIs; no direct DB access.
- **Failure recovery/monitoring:** non-production runbook should cover queue age, attempts, FAILED counts, worker health, alert routing, replay authorization, idempotency, audit and human escalation. Do not create live alerts or deploy without approved staging.
- **n8n install/staging:** pinned installer uses system CA; local secure install is blocked by outbound native release asset/source dependency endpoints inaccessible from this sandbox. Do not bypass TLS. Investigate an approved route: CI-built/pinned container image from verified upstream digest with SBOM/signature checks, or owner-approved host/network with normal certificate validation. Staging architecture: isolated persistent managed container/VM, separate PostgreSQL, private network, HTTPS reverse proxy, secrets manager, encryption key, backups/restore drill, monitoring, retention/pruning, resource limits and runbook; Vercel Hobby is not a persistent host. Host, budget, domain, credentials and approvals remain required.

## Classification summary

- **Owner-gated:** ADMIN-005/006/007/009/010/013/014; MOTION-002/006/007/008/011/012/013; RELEASE-001.
- **Primarily engineering/evidence blocked:** ADMIN-015; MOTION-003/004/005/014/015/017/018. MOTION-016 is mixed (spec/baseline plus engineering).
- **Resolved in this continuation:** classification and consolidated decision list prepared; no acceptance record is marked resolved and no gate modified.
- **Unresolved:** all 24 remain their current BLOCKED/NOT_TESTED status until the evidence/actions above are completed and the checker passes naturally.

## Latest-head CI refresh (head 3b8ee80fcb7c211f58bc11b283692a2d7ae0a030)

Refreshed with `gh pr checks 116` after pending jobs finished on 2026-11-15:

- **PASS** — Journey against a real database (run 43704481353; completed 15m23s), including DB migrations, DB unit/integration/security suites, §66/POS/Business Hub journeys, production build, control denial, ERP tenant/authorization checks, authenticated HTTP journey, hydration/browser regression steps.
- **PASS** — capture (run 43704481347; 15m07s) and **PASS** — Real-Chrome six-viewport capture on disposable DB (run 43704481324; 9m31s). These establish capture jobs completed, not independent visual acceptance of every required journey/image.
- **PASS** — Prisma/tenant/typecheck/build, full suite, PostgreSQL migration/schema checks, failure-path checks, Release aggregate, D2, instruction-integrity, Vercel preview.
- **FAIL** — programme-completeness, still reports the same 24 non-PASS records. `node scripts/admin/check-programme-readiness.mjs` independently returns `NOT READY (24)`.
- **SKIPPED** — read-only smoke. It is not a pass.

No latest-head CI job is left pending in this refresh. The aggregate Release Validation pass does not override the separate completeness failure. The browser runs do not prove n8n installation, any of the eight product event producers, workflow execution, staging persistence, or operational readiness.

## Controlled continuation update — Business Page onboarding producer

The first safe product boundary was identified as authenticated Business Page onboarding: the existing route already creates a business and OWNER membership atomically; emitting a minimal lifecycle event changes no financial/PII policy and causes no consequential action. Implemented in `app/api/business/route.ts` through `lib/automation/business-onboarding.ts`, which runs the business/member write and deterministic `business.created` outbox insert in the same Prisma transaction. Payload is minimized; tenant ID comes from the persisted business ID. The new real-PostgreSQL-gated test file is `tests/prisma/automation-business-onboarding-postgres.test.ts`; existing outbox DB tests cover claim, lease recovery, retries and terminal failure.

**Verification state:** targeted ESLint passed. The local database tests were discovered but all 6 were skipped because no configured PostgreSQL exists. Local TypeScript verification is BLOCKED because generated Prisma Client is absent; secure `prisma generate` failed fetching its engine checksum from `binaries.prisma.sh` (TLS connection unavailable), and TLS was not bypassed. Thus atomicity/idempotency/recovery tests are implemented but **NOT YET EXECUTED LOCALLY**. Latest-head CI for the new commit is required to verify generated types and DB tests; do not report this producer as verified until that CI passes. No code changes address the 24 readiness records or alter their status.
