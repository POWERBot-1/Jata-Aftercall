# JATA AFTERCALL — authoritative owner building instructions

This is the cumulative owner specification, not evidence that a feature is complete. **Append-only:** preserve all prior entries and original wording; add corrections as a new sequential section referencing the superseded ID, the change, the approval and the reason. Never silently remove or reinterpret an instruction. If two instructions conflict, record both, stop the conflicting behavior and obtain clarification. The register starts on 2026-10-31; older project decisions and acceptance evidence remain in `docs/agents/OWNER_DECISIONS_AND_ACCEPTANCE.md`, `docs/agents/IMPLEMENTATION_STATUS.md`, `docs/agents/RELEASE_GATE_AND_RUNBOOK.md` and the prior PR history, which this document does not replace or silently supersede. The owner message of 2026-10-31 is the source for entries 001–012; summaries below do not waive any detail in that directive.

Status is one of **PENDING, IN PROGRESS, BLOCKED, IMPLEMENTED, VERIFIED**. Owner approval of the instruction is distinct from production, expenditure, provider, merge or deployment authorization. An entry is VERIFIED only with independent evidence for its acceptance criteria, including security and actual device/viewport evidence where applicable. Record implementation commits and evidence as appended updates; Git itself records the commit that introduced an entry without requiring a self-referential commit hash.

## 001 — ADMIN-001: cumulative instruction management
- **Date / approval / status:** 2026-10-31; owner-directed; IMPLEMENTED (initial register only), not independently VERIFIED.
- **Owner instruction:** “Create or maintain: `docs/ADMIN_BUILDING_INSTRUCTIONS.md`”; it is the cumulative, authoritative owner specification, updated whenever new requirements, corrections, clarifications, designs, security or operations instructions are supplied.
- **Purpose / function:** preserve earlier instructions; append sequential numbered entries and IDs with date, instruction, purpose, function, security/privacy, UX, data/integrations, tests, dependencies, status, evidence and commit. Preserve superseded decisions and explicitly flag conflicts. Do not equate documentation or code with verification.
- **Security/privacy / UX:** do not store credentials, administrator contacts or sensitive production data. Document is for maintainers, not a public admin navigation entry.
- **Affected:** this document; release/status documents; all future affected code, routes, models, integrations and tests. Existing Vercel/Neon architecture and product boundaries remain intact.
- **Acceptance:** a later instruction is appended without modifying prior entries; correction includes source ID, previous decision, change and authorization; review required on conflict. Verify original instructions and evidence links against their sources.
- **Dependencies/conflicts:** this conversation is tied to an existing PR branch; requests for a separate branch/PR cannot be followed in this session. Preserve existing open PR #77. **Evidence/commit:** this initial register; `git log --follow -- docs/ADMIN_BUILDING_INSTRUCTIONS.md` identifies the introducing commit. Status updates must be appended, not edited into this entry.

## 002 — ADMIN-002: release and implementation discipline
- **Date / approval / status:** 2026-10-31; owner-directed; IN PROGRESS.
- **Owner instruction:** inspect architecture, reuse working services, preserve functionality, avoid duplication, test unit/integration/security/E2E and responsive UI, and update this register and release/status evidence. Continue PR #77 blockers after establishing the register; keep it open and draft.
- **Purpose / function:** a change is reviewable, traceable and evidence-backed; report appended IDs, preserved requirements, files, status, tests, conflicts and actual SHAs each cycle.
- **Security/privacy / UX:** preserve tenant isolation, secure authorization and responsive accessible UX. No secret exposure, unapproved production changes, real payments, commissions, payouts or messages, spending, merge or deployment.
- **Affected:** PR #77, agent, financial, notification, reporting, shared design, `/control`, Vercel, Neon and Paystack. No automatic cron activation.
- **Acceptance:** explicit evidence per criterion on final candidate; no claim based on unrelated green CI. Dependencies: `docs/agents/RELEASE_GATE_AND_RUNBOOK.md`. **Evidence/commit:** previous candidate `c41b939974ca4f4cfcfdf0d130564fba60592783`; no additional PR #77 blockers resolved by this entry.

## 003 — ADMIN-003: dedicated administrative boundary and canonical route
- **Date / approval / status:** 2026-10-31; owner-directed; PENDING.
- **Owner instruction:** build an independently secured super-admin command centre at `https://jataaftercall.co.ke/control`, with its own sign-in interface, session/access control, admin navigation and audit; reuse existing identity infrastructure where suitable. No public navigation, ordinary-user access, front-end-only authorization or backdoor.
- **Purpose / function:** provide owner/authorized administrators a separate operational experience, not another public customer dashboard. Verify route conflicts before implementation; do not assume domain or DNS readiness.
- **Security/privacy / UX:** server-side checks for every operation; secure cookie scope and revocation; no admin data to public endpoints. Dedicated accessible, responsive graphite/white/restrained-lime console. Do not introduce a second identity database unnecessarily.
- **Affected:** prospective `app/control/**` and `/api/control/**`, existing `app/admin/**`, `lib/auth.ts`, `User`, session and audit models, Vercel custom domain. `/control` was absent from the inspected checkout; existing `/admin` checks `ADMIN`, not the requested distinct roles.
- **Acceptance:** anonymous, merchants and agents denied both route and APIs; explicitly authorized roles allowed; forged role, CSRF and session-revocation tests; actual HTTPS and canonical-domain checks without production change. **Dependencies/conflicts:** requested distinct role model and MFA need a safe entitlement/migration design; unrelated motion-only directive prohibits database/schema changes for motion, not necessarily for this separate console mandate. Separate-branch instruction conflicts with fixed session branch; use existing branch/PR. **Evidence:** Vercel project lists both apex and www as verified; apex config reports `misconfigured=false`; HTTPS, routing, redirects, cookie scope and authorized/unauthorized live access NOT TESTED. **Implementation commit:** none.

## 004 — ADMIN-004: scoped admin roles, security and governance
- **Date / approval / status:** 2026-10-31; owner-directed; PENDING.
- **Owner instruction:** support SUPER_ADMIN, PLATFORM_ADMIN, FINANCE_ADMIN, SUPPORT_ADMIN, SECURITY_ADMIN and READ_ONLY_AUDITOR with least-privilege module/action checks, stronger authorization for sensitive actions, MFA support, session expiry/revocation, rate limiting, suspicious-access/login monitoring, CSRF protection, sensitive-action confirmation and immutable audit.
- **Purpose / function:** record actor, action, timestamp, safe previous/new values, target, reason and outcome; public registration must never grant privileged roles.
- **Security/privacy / UX:** no client role trust or secret disclosure; require server-side permissions; preserve authentication and tenant boundaries; accessible confirmation and audit views.
- **Affected:** `prisma/schema.prisma`, existing auth/session and audit, role provisioning, admin routes, control APIs and tests. Existing roles and data must not be silently remapped.
- **Acceptance:** horizontal/vertical escalation, forged roles, direct API, unauthenticated, CSRF, revocation, MFA and immutable-audit tests; no unauthorized financial/config changes. **Dependencies:** safe migration, explicit scope and bootstrapping without a backdoor. **Evidence/commit:** no implementation yet; PENDING.

## 005 — ADMIN-005: operational overview and tenant oversight
- **Date / approval / status:** 2026-10-31; owner-directed; PENDING.
- **Owner instruction:** show real business/customer/merchant/agent, hierarchy, payment, MRR/ARR, subscription, trial, usage, AI, system, job and incident metrics; distinguish live, calculated, delayed and unavailable. Search/inspect tenants, ownership, subscriptions, onboarding, usage, incidents, AI/POS and payment history; suspend/reinstate with reasons.
- **Purpose / function:** usable, information-dense command centre with search, tables, filters, pagination, alert centre, status indicators and audit; every control must perform a real authorized action.
- **Security/privacy / UX:** no cross-tenant leakage or invented metrics; accessibility and 320×568 through 1366×768 layouts. Suspensions and reinstatements require authorized reasons and durable audit.
- **Affected:** prospective control views/APIs, Business, User, subscriptions, payment, AI, POS and audit models; reuse existing admin/tenant services. No production data accessed during implementation.
- **Acceptance:** authoritative-source verification, role/tenant isolation, action/audit tests and independent screenshots at all six owner-specified sizes. **Dependencies:** ADMIN-003/004; safe metric definitions and sources. **Evidence/commit:** none.

## 006 — ADMIN-006: agent, finance, payment and subscription oversight
- **Date / approval / status:** 2026-10-31; owner-directed; BLOCKED for full integration, independent safe engineering remains possible.
- **Owner instruction:** cover applications, eligibility, activation, reinstatement, attribution, abuse, hierarchy, sales, commission, ledger, Paystack verification, reconciliation, reversals, adjustments, notifications and audit. Distinguish test/live; financial changes require authorization, confirmation and immutable audit. Do not invent balances or commission policy.
- **Purpose / function:** centralized financial and agent oversight using authoritative payment and accounting records; report discrepancies instead of asserting success.
- **Security/privacy / UX:** agents see only permitted hierarchy and records; never reveal Paystack or webhook secrets or sensitive payment data. Subscription configuration is controlled, never silently mutates existing customers.
- **Affected:** `app/api/paystack/**`, `lib/agents/**`, agent/admin routes, payment, subscription, attribution and ledger models; existing pricing baselines: monthly KES 149, annual KES 999, AI Front Desk KES 499/month, Website Studio KES 999/month, Business POS KES 499/month, Autopilot KES 2,499/6,999/19,999. Inspect actual production configuration before presenting or changing prices; no production access authorized as part of implementation.
- **Acceptance:** authenticated synthetic event → authoritative attribution → idempotent accrual → reversal → reconciliation → scoped dashboard; duplicate/out-of-order and unauthorized-action tests. **Dependencies/conflicts:** owner states relevant decisions approved, but exact commission terms were not located in repository/PR/Drive; do not invent. Technical test fixtures must be explicitly labelled and cannot activate production. **Evidence:** `docs/agents/RELEASE_GATE_AND_RUNBOOK.md`; implementation of connected pipeline not demonstrated. **Implementation commit:** none for this directive.

## 007 — ADMIN-007: platform configuration, service and AI oversight
- **Date / approval / status:** 2026-10-31; owner-directed; PENDING.
- **Owner instruction:** centralize validated permissioned configuration and change history for feature flags, AI, WhatsApp/SMS, Paystack, email, reporting, POS, Studio, storage, auth and limits; monitor application, database, deployment, jobs, media, AI usage/limits/failures/consent and service health; offer scoped AI kill switches.
- **Purpose / function:** truthful service status, verified checks and last-success times; provide actionable controls only when actually implemented and authorized.
- **Security/privacy / UX:** secrets remain in existing secure stores, never in browser, logs or UI; no bypass of consent, caps, approvals or unrelated services. Display unavailable rather than simulated health.
- **Affected:** control APIs/views, existing feature-flag infrastructure, Vercel, Neon, Paystack, messaging, AI, POS, Studio, media and audit. No production configuration, DNS, billing or provider changes.
- **Acceptance:** server-side module/action authorization, confirmation/change-history tests, cross-tenant tests, kill-switch scope, health-source provenance and last-check verification. **Dependencies:** ADMIN-003/004; provider capabilities and explicit later activation. **Evidence/commit:** none.

## 008 — ADMIN-008: notification and communications oversight
- **Date / approval / status:** 2026-10-31; owner-directed; IN PROGRESS (existing foundations only).
- **Owner instruction:** monitor WhatsApp, SMS fallback, email, outbox, provider acceptance/rejection, retries, failures, correlation and Nairobi reporting; controlled retry and investigation; queued is not delivered.
- **Purpose / function:** reliable, auditable communication operations, without duplicate sends after uncertain outcomes.
- **Security/privacy / UX:** no recipient/secret exposure; no live provider or messages without authorization; statuses must be evidence-based and distinct.
- **Affected:** existing `lib/agents/admin-notification-*`, worker/callback/replay/admin routes, scheduler and integration adapters.
- **Acceptance:** synthetic provider lifecycle with callback authentication/deduplication, safe retry, dead-letter, operator recovery, concurrent/crash and uncertain-outcome tests; actual delivery claims need provider evidence. **Dependencies:** ADMIN-003/004 and provider authorization. **Evidence:** `docs/agents/IMPLEMENTATION_STATUS.md`; replay only confirmed no-message rejection within five lifetime attempts, UNKNOWN/exhausted remain unreplayed. **Implementation commit:** existing PR history; complete console not implemented.

## 009 — ADMIN-009: canonical domain and production boundaries
- **Date / approval / status:** 2026-10-31; owner-directed; IN PROGRESS.
- **Owner instruction:** canonical public domain `https://jataaftercall.co.ke`, administrative link `https://jataaftercall.co.ke/control`; `https://jata-aftercall.vercel.app` is deployment infrastructure, not advertised canonical URL. Inspect Vercel configuration and verify HTTPS, redirects, secure cookies and access separation; do not modify DNS, domain records, env vars or email DNS without separate approval.
- **Purpose / function:** trustworthy canonical access with explicit production verification and clear owner action if incomplete.
- **Security/privacy / UX:** no console in public navigation; cookie scope and access must be independently checked. No production settings or data changes.
- **Affected:** Vercel domains and routing, Next.js routes, auth/cookies. No new domain added or changed.
- **Acceptance:** independent HTTPS checks, authorized access and unauthorized denials on exact official URL, plus canonical redirect and cookie tests. **Evidence:** 2026-10-31 Vercel read-only project-domain list reports apex and www verified and apex domain configuration `misconfigured=false`; it does not establish live HTTPS, canonical redirects or `/control` security. No DNS/production changes made. **Dependencies:** domain ownership, route implementation and separate production-test authorization. **Implementation commit:** none for route.

## 010 — ADMIN-010: dedicated console acceptance and delivery
- **Date / approval / status:** 2026-10-31; owner-directed; PENDING.
- **Owner instruction:** deliver a functional—not mocked—console with actual data, audited changes, all modules and security tests. Independently inspect real screenshots at 320×568, 360×800, 390×844, 430×932, 768×1024 and 1366×768; report PASS/FAIL/BLOCKED/NOT TESTED, migrations/recovery, exact branch/SHA/PR and production verification separately.
- **Purpose / function:** independently verified operational readiness; all visible controls perform real authorized actions; no fabricated figures.
- **Security/privacy / UX:** protect payment, tenant, permission and session boundaries; responsive and accessible; no secrets or contact details.
- **Acceptance:** all functional, security, responsive and recovery criteria in the owner directive pass independently on the final candidate. **Affected:** all control implementation, tests, CI, screenshot artifacts and migration/recovery plans. **Dependencies/conflicts:** fixed Arena branch and existing PR #77 override request for a new branch/PR; no merge, deployment or production changes authorized. **Evidence/commit:** none for complete console; all six actual console screenshots NOT TESTED.

## FINTECH MOTION UI BUILDING INSTRUCTIONS

### 011 — MOTION-001: cumulative design and motion discipline
- **Date / approval / status:** 2026-10-31; owner-directed; PENDING.
- **Original owner instruction:** “The existing JATA AFTERCALL theme must remain intact. Do not redesign, recolour, rearrange, replace or restyle the existing application.” Motion must be “purposeful, restrained, smooth and consistent,” communicate real state and respect reduced-motion preferences. Do not invent major designs.
- **Purpose / function:** premium, trustworthy fintech interaction; original motion primitives for interaction, transitions, workflow, notifications, financial data and AI approval. Preserve static appearance, dimensions, tokens, layout, branding, content, business rules and authorization. No proprietary reference code or assets.
- **Security/privacy / UX:** authoritative figures only; never imply payment, commission, payout, AI action or transaction success without actual confirmation. Clearly distinguish pending, processing, confirmed, failed, reversed and unavailable; preserve accessibility, keyboard focus, screen readers and essential functionality with motion disabled. No new paid services or production modifications.
- **Affected:** shared UI/motion primitives, supported existing product modules, `motion` dependency already in package, accessibility and browser tests. Existing design tokens include graphite `#16181d` and lime `#b6ff2e` where currently used, not a mandate to recolour other surfaces.
- **Acceptance:** inspect existing design system, use existing primitives, test reduced-motion, keyboard, responsive and actual interaction recordings; verify no layout shifts and accurate numerical/transaction states. **Dependencies/conflicts:** console's requested graphite/white/lime design applies to a new independent console; existing surfaces remain visually unchanged. No schema/migration changes for the motion task without separate approval. **Evidence/commit:** architecture audit only; no universal engine or UI verification claimed.

### 012 — MOTION-002: universal Website Studio inheritance and verification
- **Date / approval / status:** 2026-10-31; owner-directed; PENDING.
- **Original owner instruction:** “Every website generated by JATA AFTERCALL Website Studio must inherit the shared motion engine automatically”; “Website Studio-generated websites must inherit the motion engine, not the JATA AFTERCALL colour palette or branding.” Existing sites receive updates only through supported regeneration/publishing, not silent production republishing.
- **Purpose / function:** shared runtime integrated into actual generation, preview, rendering and publishing paths; supported templates and future generated sites inherit appropriate navigation, form, card, gallery, booking and commerce feedback without copied template runtimes. Per-site preferences, if technically compatible, have safe defaults, tenant isolation and OS reduced-motion precedence. Preserve each site's design, subscriptions and publication gates.
- **Security/privacy / UX:** tenant-scoped validated settings; no fabricated prices, availability or payment success, no client authority over financial states. No production website republishing, migrations, new paid services or credentials. Prefer existing configuration and lightweight reusable runtime; stop if migration/production change is required.
- **Affected:** `lib/experience/{motionPolicy,motionRecipes,motionRuntime,renderMode,templateFamilies,workspace,document}.ts`, Studio preview/publish routes, generated-site renderer, templates, tests and documentation. Existing Lite/HTML and `motion` modes must remain functional; do not presume every template is already covered.
- **Acceptance:** test each supported family through actual generate/preview/publish without production publication; verify new/future inheritance, existing-site update mechanism, per-tenant isolation, brand preservation, desktop/mobile, forms/transactions, reduced-motion/off and screenshots/recordings. Any untested family is explicitly NOT TESTED. **Dependencies/conflicts:** detailed template and pipeline inventory, approved compatibility design, fixed session branch/PR. **Evidence:** existing motion runtime and `motion` dependency identified; universal inheritance NOT VERIFIED. **Implementation commit:** none for this directive.

## Append-only update template

Append a new sequential section containing: unique ID; date; exact owner instruction or durable source; approval; business purpose; functional, security/privacy, UI/UX and data/integration requirements; acceptance tests; dependencies and conflicts; status; evidence links; implementation commit; and, for a correction, the superseded ID and precise change. Never put credentials or private administrator contact details into the register.

### 013 — MOTION-003: phase-one inventory and baseline evidence
- **Date / approval / status:** 2026-10-31; owner-directed; IN PROGRESS.
- **Owner instruction:** before broad implementation, inspect the current branch, open PRs, design/motion infrastructure, modules, Website Studio generation, renderer, preview and publishing paths; establish baseline screenshots and report template coverage, blockers and safe inheritance architecture.
- **Purpose / function:** avoid duplicating the existing motion runtime or changing the established appearance; identify every supported template/path and preserve unrelated PR work.
- **Security/privacy / UX:** no production changes or customer site republishing; baseline images must show actual applications, preserve branding, accessibility and tenant isolation.
- **Affected:** `docs/agents/CONTROL_AND_MOTION_AUDIT.md`, Studio render/preview/publish paths, existing motion helpers and browser test infrastructure. No schema changes for motion without separate authorization.
- **Acceptance:** complete generation-path inventory, representative baseline screenshots, reuse plan, performance/reduced-motion tests and explicit NOT TESTED list. **Dependencies/conflicts:** existing open PRs #41/#42 and fixed PR #77 branch; no design changes or production publication authorized. **Evidence:** `docs/agents/CONTROL_AND_MOTION_AUDIT.md` documents initial source inspection; actual baseline screenshots and full path inventory remain NOT TESTED. **Implementation commit:** the introduction commit can be identified with `git log --follow -- docs/agents/CONTROL_AND_MOTION_AUDIT.md`.

## 014 — ADMIN-011: instruction integrity in CI
- **Date / approval / status:** 2026-10-31; owner-directed; IN PROGRESS.
- **Owner instruction:** integrate `scripts/admin/check-building-instructions.mjs` with CI; enforce unique sequential IDs, required fields, committed appends, validated corrections and retained superseded history; verify first introduction using actual Git history and test valid/invalid cases.
- **Purpose / function:** fail closed on malformed or destructive edits. Corrections are new append-only entries identifying an earlier requirement, the change, approval and retained original; prior text is not rewritten.
- **Security/privacy / UX:** no secret values in the register or logs. Error messages identify the failed requirement without revealing confidential information.
- **Affected:** register, `.github/workflows/admin-instructions.yml`, `scripts/admin/check-building-instructions.mjs`, `tests/admin/instruction-integrity.test.mjs`.
- **Acceptance:** full-history CI, valid append, attempted rewrite/restoration, malformed IDs/fields, invalid correction and uncommitted or shallow-history failure tests. **Dependencies/conflicts:** full Git history is required; Git cannot prove that a recorded instruction or approval faithfully represents the owner. **Evidence:** local full-history first introduction `c2a4ca337e879fdd9cd20ab1eda394d587846313`; five temporary-repository tests passed. Final-head CI pending. **Implementation commit:** use `git log --follow -- scripts/admin/check-building-instructions.mjs`; not independently VERIFIED.

## 015 — ADMIN-012: secure control implementation and route acceptance
- **Date / approval / status:** 2026-10-31; owner-directed; PENDING.
- **Owner instruction:** implement `/control` using existing identity and infrastructure, secure session/revocation, server-side resource permissions and tenant isolation; implement six requested roles only after confirming precise permissions. No production administrative writes or hidden bypass.
- **Purpose / function:** distinct real console, not a hidden page or role manipulated in the browser; MFA where supported by existing architecture.
- **Security/privacy / UX:** direct API, privilege-escalation, expiration, cross-tenant and unauthorized tests; protect private numbers and secrets; responsive, accessible interface.
- **Affected:** `app/control/**`, future control APIs, existing auth/session and audit infrastructure; role and provisioning models as required by a separately reviewed design.
- **Acceptance:** real authorized and denied sessions, security tests, route coverage and six-view genuine screenshots. **Dependencies/conflicts:** current roles are CUSTOMER/ADMIN; exact module/action permission boundaries and secure provisioning remain unspecified. Existing domain verification does not prove production `/control` availability. **Evidence/commit:** `docs/agents/CONTROL_AND_MOTION_AUDIT.md`; not implemented.

## 016 — ADMIN-013: connected agent and financial lifecycle
- **Date / approval / status:** 2026-10-31; owner-directed; BLOCKED for approved-policy activation, independent synthetic engineering remains possible.
- **Owner instruction:** registration through phone ownership, eligibility, activation, referral, verified payment, idempotent commission, reversal, reconciliation and Nairobi reports with abuse, hierarchy, notifications, scheduler recovery and >5,000-member coverage.
- **Purpose / function:** prove the connected authenticated journey with synthetic events and immutable evidence, not a collection of disconnected models.
- **Security/privacy / UX:** no real financial operations, message sending or false payment/verification status; protect tenant boundaries, consent and sensitive data.
- **Affected:** `app/api/agents/**`, `app/api/paystack/**`, `lib/agents/**`, existing ledger, referral, report, scheduler and notification models and tests.
- **Acceptance:** complete authenticated route E2E, duplicate/out-of-order/reversal/recovery tests and bounded large-report verification. **Dependencies/conflicts:** exact approved rates, events, attribution and reversal terms not located; do not invent or enable accrual/payouts. **Evidence/commit:** `docs/agents/RELEASE_GATE_AND_RUNBOOK.md`; connected journey remains incomplete.

## 017 — ADMIN-014: native migration and recovery
- **Date / approval / status:** 2026-10-31; owner-directed; IN PROGRESS.
- **Owner instruction:** use native Prisma and disposable PostgreSQL 18 to prove fresh install, supported upgrade, migration failure handling, rollback where supported, forward recovery, backup/restore, data integrity and application compatibility.
- **Purpose / function:** prove safe migration and recovery without relying on WASM/direct SQL alone.
- **Security/privacy / UX:** never use production databases or credentials; preserve financial and referral evidence.
- **Affected:** Prisma migrations, build/migration gates, CI rehearsal and release documentation.
- **Acceptance:** recorded native command evidence for each requested phase, including non-reversible migration strategy. **Dependencies/conflicts:** local native binary download was blocked; prior native CI covered fresh migration and failure control, not all recovery phases. **Evidence/commit:** prior candidate workflow; full acceptance NOT TESTED.

## 018 — ADMIN-015: actual responsive and security evidence
- **Date / approval / status:** 2026-10-31; owner-directed; PENDING.
- **Owner instruction:** capture genuine authorized and unauthorized control, registration, agent dashboard, financial state, motion and template-family browser journeys at 320×568, 360×800, 390×844, 430×932, 768×1024 and 1366×768; independently inspect every image and reduced-motion behavior.
- **Purpose / function:** prove real application usability, state integrity and accessibility, not static or intercepted mockups.
- **Security/privacy / UX:** synthetic test users and data only, no secrets or private administrator destinations; test clipping, overflow, keyboard, touch, readable status and motion.
- **Affected:** browser E2E scripts, actual app routes, screenshot artifacts and release documentation.
- **Acceptance:** six-view actual authenticated evidence and independent findings for each applicable surface. **Dependencies/conflicts:** the control route and complete connected journey are not implemented. **Evidence/commit:** existing general screenshots do not satisfy this requirement; NOT TESTED.

### 019 — MOTION-004: shared motion primitives and universal coverage
- **Date / approval / status:** 2026-10-31; owner-directed; PENDING.
- **Owner instruction:** build on existing Website Studio runtime to implement shared motion tokens/primitives and consistent interactions, financial/transaction states and template inheritance, preserving the original visual identity and authoritative financial facts.
- **Purpose / function:** consistent accessible interaction across actual supported modules and generated websites, without misleading status or unnecessary dependencies.
- **Security/privacy / UX:** reduced-motion, keyboard/touch and responsive support; no simulated financial success or tenant leakage; do not change layout, brand or production site settings.
- **Affected:** existing `lib/experience/motion*`, `components/storefront/**`, shared interaction components and actual Studio publishing paths; open PRs #41/#42 require overlap review.
- **Acceptance:** behavior and inheritance tests for every applicable surface and supported template family, genuine browser evidence and no static visual regressions. **Dependencies/conflicts:** `MOTION-001`–`MOTION-003`; no universal inheritance or full coverage claimed until verified. **Evidence/commit:** `docs/agents/CONTROL_AND_MOTION_AUDIT.md`; implementation not started for this directive.

## 020 — ADMIN-016: instruction integrity implementation evidence
- **Date / approval / status:** 2026-10-31; owner-directed continuation of ADMIN-011; IN PROGRESS.
- **Owner instruction:** implement and test committed, full-history CI validation for the authoritative instruction register without changing earlier owner decisions.
- **Purpose / function:** validate global and per-namespace numbering, required fields, committed appends, structurally referenced corrections and earlier-history retention; fail closed on shallow history.
- **Security/privacy / UX:** error text omits sensitive data; checks cannot authenticate owner statements or protect against Git history rewritten outside the available repository.
- **Affected:** `.github/workflows/admin-instructions.yml`, `scripts/admin/check-building-instructions.mjs`, `tests/admin/instruction-integrity.test.mjs`, `docs/ADMIN_INSTRUCTION_WORKFLOW.md`.
- **Acceptance:** node test suite passes in isolated Git fixtures; full-history CI checks exact committed state and reports first introduction; review original owner text manually. **Dependencies/conflicts:** full Git history; append-only correction does not permit destructive edits, preserving ADMIN-001. **Evidence:** six temporary-Git tests passed locally; full-history checker identifies introduction `c2a4ca337e879fdd9cd20ab1eda394d587846313`; final-head CI pending. **Implementation commit:** find with `git log --follow -- scripts/admin/check-building-instructions.mjs`.

## 021 — ADMIN-017: governance test placement and CI correction
- **Date / approval / status:** 2026-10-31; engineering correction under the owner-directed CI integration; IN PROGRESS.
- **Owner instruction:** preserve earlier requirements and make the instruction-integrity tests compatible with the existing CI test collection guard without weakening it.
- **Purpose / function:** the standalone Node test is located outside the Vitest `tests/` tree so both test runners can execute their intended suites.
- **Security/privacy / UX:** no production access or data; retain all integrity checks and original requirement text.
- **Affected:** `.github/workflows/admin-instructions.yml`, `scripts/admin/tests/instruction-integrity.test.mjs`, `docs/ADMIN_INSTRUCTION_WORKFLOW.md`.
- **Acceptance:** standalone tests, test-collection guard and all final-head CI pass. **Dependencies/conflicts:** the original ADMIN-011 and ADMIN-016 paths remain in historical entries; this appended update documents the move. **Evidence:** intermediate CI failed the repository collection guard on the former path. **Implementation commit:** locate via `git log --follow -- scripts/admin/tests/instruction-integrity.test.mjs`.
- **Correction of:** ADMIN-016
- **Change:** move the standalone Node test from `tests/admin/instruction-integrity.test.mjs` to `scripts/admin/tests/instruction-integrity.test.mjs`; no change to owner requirements or test assertions.
- **Approval:** owner directed CI compatibility and preservation of existing tests; this is an implementation-path correction, not a change to an owner decision.
- **Original retained:** ADMIN-016 is retained verbatim above; its original path records the initial implementation.

## 022 — ADMIN-018: current-role session enforcement
- **Date / approval / status:** 2026-10-31; owner-directed authorization hardening; IN PROGRESS.
- **Owner instruction:** enforce administrative permissions server-side, protect against privilege escalation, and support session expiration and revocation without treating existing ADMIN as the six console roles.
- **Purpose / function:** shared session verification reads the current account role as well as its session version; reject a token if its signed role differs from the current role, including demotion and promotion.
- **Security/privacy / UX:** fail closed for database errors and role mismatches; require sign-in after a role change; do not introduce administrative write operations or new privileges.
- **Affected:** `lib/auth.ts`, `tests/security/auth-session-revocation.test.ts`.
- **Acceptance:** security tests verify demotion and promotion, existing reset and failure behavior. **Dependencies/conflicts:** this check does not permanently revoke a token if a role is changed away and later restored; role-change provisioning must atomically increment sessionVersion for durable revocation. Six-role control authorization, MFA and audit remain incomplete. **Evidence:** focused security suites passed 10 tests locally; native Prisma generation/typecheck blocked locally by binary download TLS; exact-head CI must be checked. **Implementation commit:** find via `git log --follow -- lib/auth.ts`.

## 023 — ADMIN-019: realistic ERP session fixtures
- **Date / approval / status:** 2026-10-31; engineering correction for owner-directed authorization hardening; IN PROGRESS.
- **Owner instruction:** preserve working application functionality and test real server-side authorization without weakening security controls.
- **Purpose / function:** ERP HTTP and visual test fixtures sign the seeded account's actual database role rather than conflating account role with business ownership or ERP permissions.
- **Security/privacy / UX:** test-only synthetic accounts; tenant and ERP roles remain resolved by existing server-side checks.
- **Affected:** `scripts/erp/erp-pages.check.mjs`, `scripts/erp/tasks-page.check.mjs`, `scripts/erp/erp-visual.check.mjs`.
- **Acceptance:** real HTTP ERP checks and exact-head CI pass with current-role enforcement. **Dependencies/conflicts:** ADMIN-018 remains in force; no production operations. **Evidence:** intermediate interactive run 41209567044 passed typecheck and suites but failed ERP HTTP because the fixture used OWNER for CUSTOMER accounts; final-head run pending. **Implementation commit:** find via `git log --follow -- scripts/erp/erp-pages.check.mjs`.

## 024 — ADMIN-020: durable role-change session revocation
- **Date / approval / status:** 2026-10-31; owner-directed security hardening; IN PROGRESS.
- **Owner instruction:** enforce server-side permissions and session revocation, including privilege changes, without adding administrative write operations.
- **Purpose / function:** an atomic database trigger increments sessionVersion on any account-role change unless already incremented, and rejects version decreases; restoring a former role cannot revive an older JWT.
- **Security/privacy / UX:** role changes invalidate earlier sessions and require sign-in; integer overflow rejects the role change rather than reusing an old version. The change does not implement the six console roles, MFA, audit or provisioning.
- **Affected:** `prisma/migrations/20261124000000_user_role_session_revocation/migration.sql`, `tests/prisma/user-role-revocation-postgres.test.ts`, existing `lib/auth.ts` verification.
- **Acceptance:** PostgreSQL tests cover demotion, restoration, explicit increments, ordinary updates, rollback, saturation and rejection of version decreases; native migration and final-head CI must pass. **Dependencies/conflicts:** trigger cannot prevent a database superuser from bypassing it; controlled deployment and migration recovery remain required. Never run this migration against production under this directive. **Evidence:** shared-session unit tests passed locally; PostgreSQL tests skipped locally without a disposable database; CI pending. **Implementation commit:** find via `git log --follow -- prisma/migrations/20261124000000_user_role_session_revocation/migration.sql`.
