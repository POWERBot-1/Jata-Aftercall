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

## 025 — ADMIN-021: allowlist the role-revocation migration
- **Date / approval / status:** 2026-10-31; engineering correction to owner-directed security hardening; IN PROGRESS.
- **Owner instruction:** preserve existing migration and security controls while adding the authorized role-change revocation migration.
- **Purpose / function:** include the exact new migration in both the explicit migration inventory and destructive-SQL scan, without relaxing either guard.
- **Security/privacy / UX:** no production operations or removal of destructive-statement checks.
- **Affected:** `tests/unit/repair-guards.test.ts`.
- **Acceptance:** explicit allowlist and destructive scans pass, with final-head native migration and security tests. **Dependencies/conflicts:** ADMIN-020 remains in force. **Evidence:** intermediate candidate run 41211457742 deployed the migration but failed the explicit inventory; updated guard and session tests passed locally (22 tests). Exact-head CI pending. **Implementation commit:** locate via `git log --follow -- tests/unit/repair-guards.test.ts`.

## 026 — ADMIN-022: parallel owner programme and reporting recovery
- **Date / approval / status:** 2026-10-31; owner-directed; IN PROGRESS.
- **Owner instruction:** audit every recorded instruction and advance motion, control, agent lifecycle, migration/recovery, real browser evidence and security as independent workstreams; do not focus only on security, documentation or CI; keep PR #77 open/draft and prohibit production operations, real financial operations and messaging.
- **Purpose / function:** publish a requirements matrix and fix independent daily/monthly report processing so one failed period does not prevent the other from being attempted; return failure when either fails, without leaking errors.
- **Security/privacy / UX:** scheduler remains default-off, bounded, authenticated and no-delivery; never infer success from a partial result. No financial policy or production operations are introduced.
- **Affected:** `docs/agents/REQUIREMENTS_MATRIX.md`, `app/api/cron/agent-referral-reports/route.ts`, `tests/security/agent-report-scheduler.test.ts`.
- **Acceptance:** retain original instruction IDs, test both failure directions and recovery failure; complete all workstreams with actual evidence. **Dependencies/conflicts:** fixed Arena PR branch; six-role permissions and precise approved financial terms remain unverified; `/control`, lifecycle, migration recovery and authentic six-viewport journeys remain incomplete. **Evidence:** focused scheduler and motion tests passed locally; final-head CI and browser evidence pending. **Implementation commit:** find via `git log --follow -- app/api/cron/agent-referral-reports/route.ts`.

### 027 — MOTION-005: shared workspace navigation and status motion
- **Date / approval / status:** 2026-10-31; owner-directed; IN PROGRESS.
- **Owner instruction:** extend reusable FINTECH MOTION UI across the actual workspace, navigation and truthful financial/status feedback without redesign or inaccurate success states.
- **Purpose / function:** workspace navigation and status components use existing shared duration/easing tokens for presentation-only transitions, with text immediately visible and reduced-motion overrides.
- **Security/privacy / UX:** no financial state, route, colour, content, size, layout or permissions are altered; maintain existing focus indicators and touch targets.
- **Affected:** `app/globals.css`, `tests/unit/motion-system.test.ts`, existing workspace navigation and status components.
- **Acceptance:** shared token and reduced-motion tests pass; inspect actual keyboard, mobile and desktop behavior; complete remaining page, chart, loading, transaction and Website Studio family coverage before claiming universal motion. **Dependencies/conflicts:** no motion-related schema migration or production republish. **Evidence:** focused CSS and scheduler tests pass locally; real browser evidence NOT TESTED. **Implementation commit:** find via `git log --follow -- app/globals.css`.

## 028 — ADMIN-023: bounded revision inspection and concurrent programme
- **Date / approval / status:** 2026-10-31; owner-directed; IN PROGRESS.
- **Owner instruction:** advance all workstreams together, including bounded processing beyond 5,000 members, autonomous integration and an instruction-completeness release check; preserve owner decisions and keep production financial operations and messages disabled.
- **Purpose / function:** own-agent immutable referral revision reads support a bounded event-ID cursor and next-page marker, without accepting a tenant selector or changing historical evidence.
- **Security/privacy / UX:** active-agent authorization and private no-store responses remain; no financial verification or entitlement is implied; invalid, duplicated and cross-tenant query parameters fail closed.
- **Affected:** `app/api/agents/reports/referrals/reconcile/route.ts`, `tests/security/agent-referral-report-reconciliation.test.ts`.
- **Acceptance:** own-agent cursor pagination, malformed/cross-tenant rejection and regression tests, plus actual PostgreSQL and browser evidence. **Dependencies/conflicts:** the existing 5,000-member write/reconciliation and baseline trigger limits remain; this only adds paginated reads, not large-report generation or reconciliation. Instruction completeness release gate, control, motion, notification recovery, native DB recovery and genuine six-viewport evidence remain incomplete. **Evidence:** focused synthetic route tests (including 5,001 fixture members) and scheduler/report regressions passed locally; PostgreSQL scale tests and final-head CI pending. **Implementation commit:** locate via `git log --follow -- app/api/agents/reports/referrals/reconcile/route.ts`.

### 029 — MOTION-006: visible workspace and agent motion
- **Date / approval / status:** 2026-10-31; owner-directed correction; IN PROGRESS.
- **Owner instruction:** demonstrate real, accessible FINTECH MOTION UI across the product, with actual browser interaction recordings, before/after and six viewport evidence; do not represent isolated CSS or Studio motion as universal completion.
- **Purpose / function:** opt-in dashboard and agent section entrances and dashboard statistic card entrances use shared timing, while chart bars animate only when reduced-motion is explicitly false; exact values and status content are unchanged.
- **Security/privacy / UX:** no financial interpolation, unverified success, branding or schema changes; animation stops under reduced motion; no production operations.
- **Affected:** `components/DashboardClient.tsx`, `app/agents/dashboard/page.tsx`, `components/ui/AnalyticsChart.tsx`, `app/globals.css`, `docs/agents/MOTION_PRODUCT_AUDIT.md`.
- **Acceptance:** real authenticated before/after recordings, six responsive viewport screenshots, reduced-motion interaction and authoritative state verification; all surfaces and Studio families must be tested before declaring universal coverage. **Dependencies/conflicts:** no concurrent worker available in this session; local disposable DB and browser needed for actual authenticated evidence. **Evidence:** focused motion and security unit tests pass; browser visibility and before/after are NOT TESTED. **Implementation commit:** locate via `git log --follow -- components/DashboardClient.tsx`.

## 030 — ADMIN-024: programme release completeness gate
- **Date / approval / status:** 2026-10-31; owner-directed; IN PROGRESS.
- **Owner instruction:** machine-check every requirement and fail release acceptance when any requirement is missing, blocked, untested or unsupported by acceptance evidence; do not equate green CI with programme completion.
- **Purpose / function:** separate fail-closed programme readiness manifest and CI job evaluate every register ID, explicit PASS status, acceptance description and existing evidence path; integrity checks continue separately.
- **Security/privacy / UX:** no production operations or credentials; path checks cannot independently authenticate acceptance, owner statements or evidence quality; manual verification remains necessary.
- **Affected:** `scripts/admin/check-programme-readiness.mjs`, `scripts/admin/tests/programme-readiness.test.mjs`, `docs/agents/PROGRAMME_READINESS.json`, `.github/workflows/admin-instructions.yml`.
- **Acceptance:** gate fails for missing IDs, blocked/untested status, missing acceptance or absent evidence; tests demonstrate failures and CI reports NOT READY until genuine evidence exists. **Dependencies/conflicts:** the register is append-only; readiness manifest must be kept current whenever instructions change and independently reviewed. **Evidence:** gate fixture tests pass locally; programme is currently NOT READY; exact-head CI pending. **Implementation commit:** locate via `git log --follow -- scripts/admin/check-programme-readiness.mjs`.

### 031 — MOTION-007: complete advanced fintech motion engine
- **Date / approval / status:** 2026-10-31; owner-directed; IN PROGRESS.
- **Owner instruction:** The following is the complete owner authorization visible in this session, preserved verbatim. It refers to a “detailed specification immediately above”; the preceding visible owner directive is recorded by MOTION-006 and the conversation, but a separate, fuller advanced-engine specification cannot be independently identified from the available text and must not be invented.

> OWNER AUTHORIZATION — IMPLEMENT THE COMPLETE ADVANCED FINTECH MOTION ENGINE
>
> The detailed specification immediately above is the authoritative owner instruction for FINTECH MOTION UI.
>
> Do not summarize it into a smaller task or replace it with the previous general motion implementation.
>
> 1. Register the specification
>
> - Append the complete specification to "docs/ADMIN_BUILDING_INSTRUCTIONS.md".
> - Preserve every existing requirement and its history.
> - Assign the next available sequential requirement ID after inspecting the current register.
> - Record the specification's full acceptance criteria.
> - Link the implementation and evidence to that requirement.
>
> 2. Implement the actual product capability
>
> Continue from the latest verified PR #77 head.
>
> Implement the shared motion engine and integrate it into the real application components.
>
> Prioritize:
>
> - Shared reusable motion primitives.
> - Dashboard and financial interfaces.
> - Transaction feedback and workflow states.
> - POS, AI and publishing interactions where supported.
> - Website Studio's actual generation and rendering pipeline.
> - Automatic inheritance by all supported generated website templates.
> - Reduced-motion accessibility and performance.
>
> Critical: Do not merely animate the dashboard and call this universal motion.
>
> 3. Preserve visual identity
>
> The existing JATA AFTERCALL application must retain its current colours, typography, layout, spacing, dimensions, branding and component appearance.
>
> Motion must be inactive without changing the original static appearance.
>
> Website Studio-generated websites must retain their own branding and visual identities.
>
> 4. Execute independent workstreams
>
> Continue the broader PR #77 programme alongside motion implementation.
>
> Where independent workers are available, run concurrent workstreams for:
>
> - FINTECH MOTION UI.
> - Super Admin Console and authorization.
> - Agent financial lifecycle.
> - Notifications and scheduler recovery.
> - Database migration and release safety.
> - Security and integration.
>
> Report actual concurrency. Do not claim parallel execution when implementation was sequential.
>
> 5. Mandatory proof
>
> Provide actual browser-rendered before-and-after evidence, interaction recordings, reduced-motion results and six-viewport verification.
>
> Test each supported Website Studio template family through the real generation pipeline.
>
> Do not mark universal inheritance VERIFIED until every supported template family has evidence.
>
> 6. Governance
>
> Keep PR #77 open and draft.
>
> No merge, deployment, production changes, customer-site republishing, production migrations or expenditure without separate explicit authorization.
>
> Continue implementing autonomously. Do not return another documentation-only or audit-only result.
>
> Definition of done: A working shared motion engine across the application, automatic inheritance through Website Studio, preserved visual identity, passing acceptance tests and independently inspectable evidence.

- **Purpose / function:** extend shared motion across real app and Studio generation without changing static appearance or inventing transaction outcomes.
- **Security/privacy / UX:** reduced-motion, keyboard/touch and performance safeguards; no customer-site republishing or production changes.
- **Affected:** `lib/experience/motionRuntime.ts`, `tests/unit/storefront-motion.test.ts`, existing shared application motion and Studio pipelines.
- **Acceptance:** every item in the quoted instruction, including actual before/after browser recording, six viewports and each template family; no universal claim before all evidence. **Dependencies/conflicts:** the referenced separate detailed specification is not independently recoverable from visible conversation; no independent coding worker is available here. **Evidence:** focus-entry cancellation and fail-closed listener tests plus 81 focused unit/SSR tests pass; real browser coverage, full engine, policy and remaining programme work NOT TESTED or incomplete. **Implementation commit:** find via `git log --follow -- lib/experience/motionRuntime.ts`.

### 032 — MOTION-008: owner-provided advanced fintech motion specification
- **Date / approval / status:** 2026-10-31; owner-provided specification; IN PROGRESS.
- **Owner instruction:** Full specification follows verbatim; original links and formatting are preserved in meaning. This clarifies MOTION-007 without removing or modifying its historical text.

JATA AFTERCALL — Advanced Fintech Motion Engine & Universal Motion Inheritance

**Repository:** `POWERBot-1/Jata-Aftercall`
**Production:** [https://jata-aftercall.vercel.app](https://jata-aftercall.vercel.app)
**Reference inspiration:** AWSMD Plasma Transaction UI Animation
**Scope:** Entire JATA AFTERCALL application, all existing and future product modules, Website Studio, and every website generated by Website Studio.

1. Mission and objective

Implement a mature, reusable, high-performance fintech-inspired motion engine that brings purposeful, premium interaction design to every relevant part of JATA AFTERCALL.

The motion engine must serve two purposes:

1. Enhance the existing JATA AFTERCALL application without changing its established visual identity.
2. Provide a reusable motion capability that every website generated through Website Studio can inherit, including websites created in the future.

The result must feel cohesive, responsive, professional and trustworthy. Motion should improve feedback, comprehension, perceived responsiveness and task completion rather than exist merely for decoration.

This is an implementation task, not a redesign proposal.

2. Absolute design preservation requirement

**The existing JATA AFTERCALL theme must remain intact. Do not redesign, recolour, rearrange, replace or restyle the existing application.**

Preserve:

- Every existing colour and design token, including graphite `#16181d` and lime `#b6ff2e` wherever currently used.
- Existing typography, fonts, font sizes, font weights, line heights and text treatments.
- Existing layouts, spacing, dimensions, alignment and responsive behaviour.
- Existing borders, radii, shadows, backgrounds, icons, images and other visual treatments.
- Existing logos, branding, content, navigation, page hierarchy and component structures.
- Existing routes, pricing, plans, permissions, authentication, tenant isolation, business rules and user workflows.

Do not introduce a new colour palette, gradients, themes, decorative effects or replacement components into the existing application.

When motion is inactive, the existing application must retain its original static appearance. Animation must not cause unintended layout shifts or change the resting dimensions and styling of existing elements.

**Important distinction:** Website Studio-generated websites must inherit the motion engine, not the JATA AFTERCALL colour palette or branding. Each generated website must retain its own intended brand identity, approved theme, content and design settings.

3. Non-negotiable engineering constraints

- Inspect the current repository, active branch, open PRs, recent commits, architecture, design system and animation libraries before editing.
- Preserve the existing Next.js, Vercel and Neon architecture.
- Keep JATA AFTERCALL separate from JATA Qi and TANYA-AI.
- Preserve all existing customer data, tenant boundaries and authorization controls.
- Do not copy AWSMD's proprietary code, assets or exact designs. Implement original motion behaviour inspired by general fintech interaction principles.
- Prefer existing dependencies and browser-native capabilities.
- Do not add paid dependencies, subscriptions, external animation services or infrastructure without explicit approval.
- Do not expose, request or modify production credentials.
- Do not change production data, payment configuration, database schemas, migrations or deployment settings.
- Do not merge or deploy without separate explicit authorization.
- Do not overwrite unrelated work or changes in open PRs.
- Stop and report blockers instead of inventing missing functionality or bypassing repository governance.

4. Universal motion architecture

Build a reusable motion engine rather than implementing isolated animations independently on each page.

Audit the current architecture first and integrate with its existing conventions. Introduce abstractions only where they are genuinely needed.

4.1 Shared motion primitives

Where compatible with the existing stack, provide reusable primitives for:

- Enter and exit transitions.
- Hover, focus, pressed and selected states.
- Expand and collapse interactions.
- Dialog, drawer, menu and popover transitions.
- Loading and skeleton states.
- Progress indicators.
- Chart and data transitions.
- Transaction-state changes.
- Notifications and confirmations.
- Scroll-triggered reveals.
- Page and section transitions.
- Reduced-motion alternatives.

Define central timing and easing tokens independently of the visual theme. Preserve existing component styling and use animation properties that do not affect layout wherever possible.

4.2 Motion orchestration

Support coordinated sequences for multi-step interfaces, such as payment processing, publishing, onboarding and approval workflows.

Sequences must:

- Reflect real application states.
- Remain interruptible when users navigate away or cancel an operation.
- Avoid blocking essential controls.
- Avoid unnecessary animation delays before important actions become available.
- Recover cleanly from errors and interrupted requests.
- Never represent an unconfirmed operation as completed.

4.3 Performance and lifecycle management

Implement motion with performance as a core requirement.

- Prefer transforms and opacity when appropriate.
- Avoid unnecessary continuous animation, expensive filters and layout-triggering properties.
- Prevent animation loops from surviving component unmounts.
- Avoid duplicate event listeners and unnecessary observers.
- Pause nonessential off-screen animations when appropriate.
- Prevent chart or KPI animations from replaying unnecessarily after unrelated renders.
- Keep animations stable under slow network conditions and large data sets.
- Avoid introducing avoidable client-side JavaScript into otherwise lightweight pages.
- Ensure the engine degrades gracefully when animation support is limited.

Do not introduce a complex animation framework solely to animate a handful of existing components.

5. Next-level fintech motion capabilities

Implement the following capabilities where relevant to the existing product modules.

5.1 Financial data visualization

- Animate chart entry and transitions between real data sets.
- Transition KPI values when authoritative values change.
- Use restrained number interpolation without changing the underlying financial values.
- Preserve existing chart dimensions, colours, labels, units and formatting.
- Handle missing data, zero values, negative values and loading states accurately.
- Prevent stale responses from overwriting newer information.
- Respect reduced-motion preferences.

Do not invent revenue, sales, growth, transaction counts or financial projections.

5.2 Transaction lifecycle feedback

Create consistent motion states for relevant transaction flows:

`Idle → Submitting → Processing → Confirmed`

Support separate failure, cancellation, timeout and pending-verification states.

These states must be driven by actual application and server responses.

A payment callback, client-side animation or button click alone must never be treated as proof of payment. Preserve the existing Paystack verification, webhook, idempotency and authorization requirements.

Where an operation is still awaiting authoritative confirmation, clearly preserve that distinction in the existing interface.

5.3 Micro-interactions

Add restrained feedback to existing interactive elements:

- Press and release.
- Selection and deselection.
- Focus and keyboard navigation.
- Form validation.
- Copy-to-clipboard confirmation.
- Expandable sections.
- Navigation and menu interactions.
- Successful and failed actions.

Maintain the existing visual appearance and make sure the motion does not interfere with rapid repeated input or touch gestures.

5.4 Workflow orchestration

Provide coordinated but unobtrusive motion for multi-step operations.

Examples include onboarding, subscription activation, website publishing, POS checkout and business setup.

Progress must reflect actual operation states. Never fabricate percentages, simulate completed steps or imply that a background task has finished when it has not.

5.5 Notifications and feedback

Provide reusable motion behaviour for existing toast messages, alerts and status indicators.

Support success, information, warning, failure and pending states using the application's existing presentation conventions.

Notifications must not obscure critical controls, disappear before important information can be read or communicate success without confirmation.

5.6 AI activity and human approval

Support clear transitions between:

- Ready.
- Processing.
- Awaiting approval.
- Approved.
- Executing.
- Completed.
- Failed.
- Blocked.
- Cancelled.

Preserve the existing permission model and approval gates. Motion must never bypass approval, trigger a business action or suggest that an AI agent has performed work that it has not performed.

6. Universal inheritance across every JATA AFTERCALL feature

The motion engine must not be restricted to the homepage or Overview dashboard.

Audit and integrate it across all applicable existing modules, including:

- Homepage and public product pages.
- Registration, onboarding and business setup.
- Overview dashboard.
- Subscription and pricing interfaces.
- Payment and subscription activation flows.
- AI Front Desk.
- Website Studio.
- Business POS.
- BOS-PRO / ERP, where present in the repository.
- Autopilot and approval workflows.
- Inbox and campaign interfaces.
- Forms, dialogs, menus, notifications and shared components.
- Existing and future customer-facing workflows.

The exact module inventory must be established from the repository. Do not assume that a module exists merely because it appears in a roadmap.

Build the shared primitives first, then integrate them through existing shared components and module-specific adapters.

Do not mechanically animate every element. Use motion only where it communicates state, hierarchy, interaction or progress.

A central implementation must not silently introduce inconsistent motion timings or conflicting transitions across modules.

7. Critical requirement: Website Studio motion inheritance

**Every website generated by JATA AFTERCALL Website Studio must inherit the shared motion engine automatically. This is a core product requirement, not an optional enhancement.**

Implement and verify a durable inheritance mechanism for both existing supported website templates and future websites created through Website Studio.

7.1 Shared motion runtime

Provide a reusable motion runtime or equivalent architecture-compatible mechanism that Website Studio can include in every generated website.

The implementation must:

- Be integrated into the actual website generation and rendering pipeline.
- Work with every supported template and page type.
- Apply automatically to newly generated websites.
- Apply to existing generated websites when they are regenerated or updated through the supported publishing workflow.
- Avoid requiring customers to manually add animation code.
- Avoid copying and maintaining separate implementations for each template.
- Preserve each website's own brand colours, typography, logo, imagery, layout and design configuration.
- Respect the website's existing components and theme rather than imposing the JATA AFTERCALL dashboard theme.
- Work across desktop, tablet and mobile viewports.
- Respect reduced-motion preferences.
- Avoid unnecessary runtime payloads and performance regressions.

Do not claim universal inheritance until the actual generation, rendering and publishing paths have been inspected and tested.

7.2 Generated website capabilities

Where supported by the template and appropriate to the website's purpose, generated websites should inherit:

**Navigation and layout**

- Smooth, restrained menu transitions.
- Accessible dropdowns and expandable navigation.
- Subtle section entrance transitions.
- Stable sticky-navigation behaviour where already supported.

**Buttons and forms**

- Consistent hover, focus, pressed and loading feedback.
- Form validation feedback.
- Clear submission success and failure states.
- Accessible keyboard and touch interactions.

**Cards and content**

- Subtle card interaction feedback.
- Optional viewport-triggered reveals.
- Smooth accordion and tab transitions.
- Motion that does not delay access to essential information.

**Images and galleries**

- Lightweight image-reveal effects where suitable.
- Stable loading and error behaviour.
- No layout shifts caused by image animation.
- No unnecessary motion that interferes with image-heavy websites.

**E-commerce and booking workflows**

- Cart and selection feedback where supported.
- Clear checkout and submission states.
- Accurate loading, pending, success and failure feedback.
- Server-confirmed status for payments and bookings.
- No fabricated orders, prices, availability or transaction results.

**Business-specific websites**

- Choose relevant motion patterns based on the actual template and supported features.
- Use restrained effects for professional services and business information pages.
- Support suitable product interactions for retail and hospitality.
- Do not force e-commerce, charts or fintech transaction animations onto a website that does not have those features.

7.3 Website Studio controls

Inspect the existing Website Studio configuration before adding controls.

Where technically compatible, provide a motion setting with options such as:

- **System default:** Use the shared motion defaults appropriate to the template.
- **Subtle:** Use minimal transitions and reduced decorative motion.
- **Standard:** Use the normal shared motion capabilities.
- **Reduced:** Minimize nonessential animation while preserving essential state feedback.
- **Off:** Disable nonessential animation while keeping essential functionality and status communication intact.

These are proposed product behaviours, not permission to redesign the existing Studio interface. Reuse existing configuration patterns and introduce new controls only where necessary.

The user's operating-system reduced-motion preference must take precedence over nonessential decorative animation.

A setting must not disable essential transaction status, form feedback, focus visibility or accessibility functionality.

Do not change existing plans, pricing, publication permissions or subscription gates to implement motion inheritance.

7.4 Configuration and tenant isolation

If per-site motion settings are implemented:

- Scope configuration to the correct website and tenant.
- Validate configuration values.
- Apply safe defaults to missing or invalid settings.
- Prevent one customer's configuration from affecting another customer's website.
- Avoid storing unnecessary personal data.
- Preserve existing authentication and authorization boundaries.
- Do not add a database migration unless separately approved.
- Prefer the existing configuration or persistence mechanism when adequate.

7.5 Versioning and future inheritance

Design the shared runtime so that future motion improvements can be maintained centrally and incorporated into generated websites through the existing safe generation or publishing workflow.

Determine how the current product stores and publishes generated sites before choosing an implementation.

Do not assume that existing customer websites can safely change without regeneration, redeployment or a supported runtime update.

Where versioning is necessary, establish a compatible versioning approach that avoids silently breaking published sites.

Document:

- How new websites inherit the runtime.
- How existing websites receive supported updates.
- How template authors use shared motion primitives.
- How per-site preferences are applied.
- How the system handles unsupported or older templates.
- How regressions are prevented.

Do not modify production website configurations or republish customer websites as part of this task without separate authorization.

8. Accessibility, usability and trust

Implement the motion engine in line with these requirements:

- Respect `prefers-reduced-motion`.
- Preserve keyboard navigation and visible focus.
- Maintain screen-reader announcements for meaningful state changes.
- Avoid flashing, disorienting movement and unnecessary parallax.
- Avoid animation that blocks scrolling, form submission or essential controls.
- Do not rely on colour or animation alone to communicate a critical status.
- Ensure all essential functions remain usable when nonessential animation is disabled.
- Avoid unnecessary animation on low-powered mobile devices.
- Preserve readable content and predictable navigation.

9. Strict motion-only change boundary

Changes are limited to motion, animation utilities, transition timing, motion-related state handling, integration required for universal inheritance and necessary accessibility support.

Do not change the established appearance of the JATA AFTERCALL application.

Do not redesign Website Studio's existing interface.

For generated websites, inherit motion capabilities while preserving each site's configured design.

If a requirement cannot be satisfied without changing an existing visual design, stop and report the conflict for owner approval.

10. Phase 1 — Repository and product audit

Inspect:

- Current branch and working-tree state.
- Open PRs and recent commits.
- Existing design tokens and component libraries.
- Current animation implementations.
- All existing application modules.
- Website Studio's template registry, generation pipeline, preview mechanism and publishing workflow.
- How generated websites load CSS, JavaScript and shared components.
- Existing published-site compatibility and update mechanisms.
- Current test infrastructure and browser-test availability.

Establish baseline screenshots and record existing behaviour.

Produce a concise audit identifying:

1. Shared motion primitives already available.
2. Modules requiring integration.
3. Every supported website-generation path.
4. Any templates that do not use a common rendering pipeline.
5. The safest architecture for universal inheritance.
6. Blockers and tests required to prove inheritance.

Do not start broad implementation before understanding the current architecture.

11. Phase 2 — Implementation

Implement in controlled increments:

1. Establish the shared motion primitives and timing tokens.
2. Integrate motion into the existing application without changing its visual design.
3. Integrate motion feedback into the relevant financial, POS, AI and publishing workflows.
4. Integrate the shared runtime into the actual Website Studio generation pipeline.
5. Ensure all supported templates inherit the runtime automatically.
6. Add compatibility handling and appropriate configuration defaults.
7. Implement reduced-motion and performance safeguards.
8. Add tests for shared primitives, real application states and website inheritance.
9. Document the inheritance mechanism and maintenance approach.

Keep each change reviewable. Preserve unrelated work and stop if production changes or additional infrastructure would be required.

12. Phase 3 — Verification

Run applicable lint, type checks, automated tests and production-build checks.

Required application viewport tests

- 320×568
- 360×800
- 390×844
- 430×932
- 768×1024
- 1366×768

Required application checks

Verify:

- Original colours and design tokens remain unchanged.
- Existing layouts and component dimensions remain intact.
- Existing navigation and business workflows remain functional.
- Financial figures and transaction states remain authoritative.
- Approval gates and tenant isolation remain intact.
- No misleading success animation is shown.
- Reduced-motion behaviour works.
- No horizontal overflow, significant layout shifts or accessibility regressions occur.

Required Website Studio inheritance tests

Generate or use representative test websites covering every supported template family.

At minimum:

1. Generate a new website from each supported template family.
2. Confirm that the shared motion runtime is included through the actual generation pipeline.
3. Confirm that supported interactive elements inherit the expected motion behaviour.
4. Verify that the website retains its own configured colours, typography, branding and layout.
5. Test mobile and desktop layouts.
6. Test reduced-motion and motion-disabled settings.
7. Test forms, menus and any supported transaction flows using controlled test data.
8. Test preview and publication paths without publishing to production.
9. Confirm that a future website generated through the same pipeline inherits the runtime without manual code changes.
10. Verify that one tenant's settings cannot affect another tenant's website.
11. Verify compatibility with supported existing templates.
12. Confirm that essential functionality still works when nonessential motion is disabled.

If a template or workflow cannot be tested, explicitly report it as `NOT TESTED`.

Do not claim all generated websites inherit the engine based solely on a successful test of the main dashboard or one template.

Before-and-after evidence

Capture screenshots and, where appropriate, short screen recordings of actual interactions.

Provide evidence for:

- The existing application at desktop and mobile sizes.
- Representative financial and transactional feedback.
- AI and approval states where available.
- Website Studio preview and generated websites.
- At least one representative site from each supported template family.
- Reduced-motion behaviour.
- Any relevant errors or limitations.

Screenshots must be produced from the actual application or generated test websites, not mockups.

13. Phase 4 — Delivery and governance

Commit and push the work to a dedicated branch and open a PR in accordance with repository governance.

Report:

- Branch, commit SHA and PR link.
- Exact files modified and the purpose of each change.
- Shared motion architecture and integration points.
- Application modules covered.
- Website Studio templates and generation paths verified.
- How existing and future generated websites inherit motion.
- PASS / FAIL / BLOCKED / NOT TESTED evidence for every applicable requirement.
- Automated test results.
- Before-and-after screenshots and interaction recordings.
- Responsive, accessibility and performance findings.
- Confirmation that the existing application theme remains intact.
- Any templates, paths or workflows that remain unsupported.
- Any migration, infrastructure or production action that would require separate approval.

Do not report universal inheritance as complete until the relevant generation paths have been verified.

14. Stop conditions and authorization

Stop after opening the PR.

Do not merge or deploy.

Do not modify production data, run production migrations, change production settings, republish customer websites or incur costs without separate explicit authorization.

If universal Website Studio inheritance requires an unapproved production change, new paid infrastructure or a database migration, report the blocker and propose a safe alternative.

Do not bypass repository protection, access controls or existing approval gates.

15. Definition of done

The task is complete only when:

1. The shared motion engine is implemented and tested.
2. Relevant existing JATA AFTERCALL modules use consistent motion primitives.
3. The existing JATA AFTERCALL visual design remains intact.
4. Website Studio's actual generation pipeline includes the shared motion engine.
5. Every supported template family has verified inheritance.
6. Newly generated websites inherit the runtime without manual customer intervention.
7. Generated websites preserve their own branding, colours, typography and layout.
8. Motion settings and reduced-motion behaviour work as specified.
9. Applicable tests pass and untested paths are disclosed.
10. Before-and-after evidence demonstrates real, observable behaviour.
11. A reviewable PR is opened without merging or deploying.

**Final instruction: Preserve JATA AFTERCALL exactly as it is visually. Build a mature, shared fintech motion capability across the entire product, and make Website Studio-generated websites inherit that capability automatically while retaining their own unique designs. Improve movement, responsiveness, feedback and consistency—not the established visual identity.**

- **Purpose / function:** implement and verify the entire original specification above, not a reduced summary.
- **Security/privacy / UX:** all constraints and accessibility safeguards in the original specification apply; no production, migration, spending or customer-site publishing operations.
- **Affected:** shared motion, existing modules, Website Studio generation/render/publish, tests and browser evidence; exact implementation paths are recorded in later append-only updates.
- **Acceptance:** all acceptance criteria and definition of done in sections 12–15 above. **Dependencies/conflicts:** fixed Arena branch and existing open draft PR #77 supersede a separate branch/new PR; the official canonical domain instruction in ADMIN-003 is retained and the Vercel URL above is infrastructure. Existing per-site Lite/none settings and OS reduced motion must remain effective. **Evidence:** owner supplied full specification in this session; implementation and independently inspected browser evidence remain incomplete. **Implementation commit:** locate with `git log --follow -- docs/ADMIN_BUILDING_INSTRUCTIONS.md` and later append-only records.
- **Correction of:** MOTION-007
- **Change:** the original full advanced-engine specification is now supplied and recorded above, rather than treated as unavailable.
- **Approval:** owner supplied the specification and directed implementation in this session.
- **Original retained:** MOTION-007 and all prior entries remain unchanged above.

### 033 — MOTION-009: bounded visible-section inheritance
- **Date / approval / status:** 2026-10-31; owner-directed; IN PROGRESS.
- **Owner instruction:** implement the complete MOTION-008 specification, using existing shared Studio runtime without duplication and preserving visual identity, current Lite/none settings, reduced motion, performance and tenant boundaries.
- **Purpose / function:** bounded observer queue allows eligible visible sections beyond the eight concurrent animations to receive shared reveals when capacity frees; sections leaving view, changed preferences and unmounts clear or discard work, and content remains visible.
- **Security/privacy / UX:** no new dependencies, configuration, branding, static layout, database migrations, customer publishing or production operations; active keyboard focus and reduced-motion cancellation remain enforced.
- **Affected:** `lib/experience/motionRuntime.ts`, `tests/unit/storefront-motion.test.ts`, `docs/agents/MOTION_INHERITANCE_AUDIT_20261031.md`.
- **Acceptance:** bounded concurrency, queue drain, off-screen removal, preference change and unmount tests; actual application, complete template generation/publishing paths, six viewports and before/after recordings remain required by MOTION-008. **Dependencies/conflicts:** other storefront routes and classic fallback do not use `ExperienceSite`'s controller; owner Lite/none and OS reduced motion override decoration; no new branch can be created in this session. **Evidence:** 84 focused runtime, SSR and design tests passed locally; independent browser validation and all-template inheritance NOT TESTED. **Implementation commit:** locate using `git log --follow -- lib/experience/motionRuntime.ts`.

### 034 — MOTION-010: storefront route and fallback motion inheritance
- **Date / approval / status:** 2026-10-31; owner-directed; IN PROGRESS.
- **Owner instruction:** integrate the shared motion controller into every storefront route and classic fallback; verify all template families, previews and published paths, bounded queue, cancellation, disabled/reduced motion, six-view real browser screenshots and recordings, and final-head CI without production changes.
- **Purpose / function:** mount the existing scoped controller once in the common storefront shell; apply restrained fade recipes on shop, item, checkout, enquiry, booking and order pages; mount it in the existing classic business-page scope with readable section markers. Existing theme, business content, financial status and layout remain unchanged by design.
- **Security/privacy / UX:** respect existing Lite/none treatment, reduced-motion and save-data policy, scoped ownership and focused controls; never infer transaction success from motion; no schema, production, publishing or provider changes.
- **Affected:** `components/storefront/StorefrontShell.tsx`, `components/storefront/ExperienceSite.tsx`, `components/storefront/RenderModeProbe.tsx`, `components/BusinessPage.tsx`, `lib/experience/motionRuntime.ts`, `app/b/[slug]/**`, `app/globals.css`, `tests/unit/storefront-motion-inheritance.test.ts`, `tests/unit/storefront-motion.test.ts`.
- **Acceptance:** every actual supported route, classic fallback and every family has real preview/publication browser evidence, six independently inspected viewport screenshots, motion recordings, disabled/reduced-motion and concurrency/re-entry tests, and exact-head workflow results. **Dependencies/conflicts:** the `/b/[slug]/ai` route uses its own separately entitled renderer and remains an explicitly identified non-inheriting exception; this cycle has no independently running coding workers, local PostgreSQL or installed Chromium. Source/SSR tests do not establish genuine visual or authorization behavior. **Evidence:** 107 motion, SSR and family tests passed locally, including 20 synthetic generated-family SSR fixtures, queue/re-entry/disabled motion and a route-bypass guard; real browsers and screenshots remain NOT TESTED. **Implementation commit:** locate using `git log --follow -- components/storefront/StorefrontShell.tsx`.

### 035 — MOTION-011: close universal inheritance and acceptance gaps
- **Date / approval / status:** 2026-10-31; owner-directed; IN PROGRESS.
- **Owner instruction:** MOTION-011 — CLOSE UNIVERSAL INHERITANCE AND ACCEPTANCE GAPS. Continue from the actual PR #77 HEAD. Reported SHA: `239bb63`. Preserve all MOTION-008, MOTION-009 and MOTION-010 work. Do not start another isolated motion enhancement. Close the known gaps.
  1. AI Front Desk renderer: integrate the shared motion controller into the separate AI Front Desk renderer; verify its SSR, hydration, preview, published and fallback paths; add route-bypass protection and regression tests.
  2. Universal browser coverage: enumerate every template family, storefront route, publishing path and classic fallback; produce a coverage matrix; exercise each path in a real browser; record controller initialization, animation behaviour, queue handling and reduced-motion behaviour; do not use SSR fixtures or generic screenshot CI as substitutes for browser proof.
  3. Visual evidence: capture before-and-after recordings; capture and independently inspect all six viewports: 320×568, 360×800, 390×844, 430×932, 768×1024 and 1366×768; verify static visual preservation when motion is disabled; document any genuine browser/environment blocker without claiming a pass.
  4. Instruction integrity: investigate and fix the Admin instruction completeness gate failure; preserve all historical instruction IDs and entries; do not weaken or bypass the completeness gate to obtain a green result.
  5. Final verification: confirm the Interactive Business E2E workflow completes; rerun all required workflows against the exact final SHA; provide run IDs, results and actual evidence links or artifacts.
  Use parallel workstreams when available. If independent workers are unavailable, execute the tasks sequentially without dropping requirements. Keep PR #77 open and draft. No production changes, customer-site republishing, merge or deployment. Acceptance requires universal browser verification, including AI Front Desk and classic fallback. Until then report `MOTION ACCEPTANCE BLOCKED — DO NOT MERGE OR DEPLOY`.
- **Purpose / function:** share controller ownership with the separate AI scope, inherit authorized published/draft motion settings, fail static when settings are absent or unreadable, and enumerate actual gaps in a coverage matrix.
- **Security/privacy / UX:** retain entitlement and tenant checks; never animate status as a success claim, expose draft settings publicly or force motion against owner Lite/none or system reduced motion. No production changes.
- **Affected:** `app/b/[slug]/ai/page.tsx`, `components/AIFrontDeskCustomerClient.tsx`, `components/storefront/RenderModeProbe.tsx`, `lib/experience/motionRuntime.ts`, `app/globals.css`, `tests/unit/storefront-motion-inheritance.test.ts`, `tests/unit/ai-front-desk-customer-default-state.test.ts`, `docs/agents/MOTION_011_COVERAGE_MATRIX.md`.
- **Acceptance:** real browser coverage and independent six-viewport review of every family, route, preview/published/fallback, queue/reduced/disabled behavior and recordings, exact-head workflows, plus genuine programme acceptance without gate weakening. **Dependencies/conflicts:** no local browser or disposable PostgreSQL; no independent coding workers; existing readiness failures are unevidenced programme obligations rather than checker bugs. **Evidence:** 141 focused unit/SSR tests and seven gate/integrity tests passed; real browser matrix NOT TESTED. Prior Interactive E2E 41217293453 passed against `239bb63`, not proof of this acceptance. **Implementation commit:** locate using `git log --follow -- components/AIFrontDeskCustomerClient.tsx`.

### 036 — MOTION-012: obtain real browser acceptance evidence
- **Date / approval / status:** 2026-10-31; owner-directed; IN PROGRESS.
- **Owner instruction:** MOTION-012 — OBTAIN REAL BROWSER ACCEPTANCE EVIDENCE. Continue from the actual PR #77 HEAD. Reported SHA: `a6bfe575fb70da8e2dae70b8e0e95d8e128d0185`. Preserve all previous motion work and the instruction completeness gate. The remaining task is now primarily browser verification and evidence, not another round of isolated unit tests.
  1. Provision or use an available isolated browser-testing environment. Investigate CI browser runners or another existing supported browser environment. Do not treat unavailable local Chromium as proof that browser testing is impossible.
  2. Execute the coverage matrix against every storefront template family and route.
  3. Verify classic fallback, AI Front Desk preview, published and fallback rendering.
  4. Verify controller initialization, visible animation targets, queue behaviour, re-entry, cleanup, reduced-motion behaviour and static rendering when motion is disabled.
  5. Capture actual before-and-after browser recordings and screenshots.
  6. Independently inspect all six viewport sizes: 320×568, 360×800, 390×844, 430×932, 768×1024 and 1366×768.
  7. Record the tested URL/route, template family, publishing mode, viewport, browser version, result and evidence artifact for every test.
  8. Ensure screenshots and recordings are tied to the tested commit and not older builds.
  9. Complete the final-head Interactive Business E2E workflow and rerun all required workflows against the exact final SHA.
  10. Keep the instruction completeness gate strict. Only change NOT_TESTED to PASS when actual evidence exists.
  If an environment genuinely prevents a particular test, identify the exact missing capability and continue all other browser coverage that can be executed. Do not substitute SSR tests, unit tests or generic Premium Screenshots workflow results for universal browser proof. PR #77 remains open and draft. No production republishing, production changes, merge or deployment. Final acceptance requires independently inspectable evidence. Otherwise retain `MOTION ACCEPTANCE BLOCKED — DO NOT MERGE OR DEPLOY`.
- **Purpose / function:** use a dedicated disposable PostgreSQL and real Chrome CI run to record exact-head classic and AI preview/fallback observations, screenshots and browser video, without altering production or claiming universal acceptance.
- **Security/privacy / UX:** workflow checks out the exact PR head, reads only local seeded fictional data, rejects non-loopback and non-disposable environments; no live provider, payment, publication or customer writes. Reduced-motion and static observations remain evidence to inspect, not claimed visual acceptance.
- **Affected:** `.github/workflows/motion-evidence.yml`, `scripts/motion/disposable-browser-evidence.mjs`, `docs/agents/PROGRAMME_READINESS.json`.
- **Acceptance:** every family and applicable route through actual generation and publishing, before/after recordings and independently reviewed six-view screenshots, queue/re-entry/cleanup, disabled/reduced and exact-head workflow results. **Dependencies/conflicts:** CI can run real Chrome and PostgreSQL, but this initial read-only harness only exercises seeded classic/AI preview/denial/not-found; it does not cover generated Studio families or actual AI publication. Before/after build comparison and independent inspection remain incomplete. **Evidence:** prior-head Interactive E2E 41218465528 PASS; exact-head browser artifacts pending. **Implementation commit:** locate using `git log --follow -- scripts/motion/disposable-browser-evidence.mjs`.
