# Programme readiness reconciliation — 2026-11-07

**Branch:** `arena/ee35af73-jata-aftercall` · **Pull request:** #92 · **Candidate head at reconciliation:** `d5c3f56da052a51836cf387d2cd0d31da401af04`

**Purpose.** `scripts/admin/check-programme-readiness.mjs` reports `NOT READY (34)`: 34 of the 43
canonical requirements in `docs/ADMIN_BUILDING_INSTRUCTIONS.md` are recorded `BLOCKED` or
`NOT_TESTED`. This document reconciles every one of those 34 records against the actual
implementation, the actual test output and the actual owner decisions on this candidate — it is the
report ADMIN-002 demands (IDs, requirements, files, statuses, tests, conflicts, SHAs).

**Method.** For each record I read the canonical requirement, located the implementation the
register itself names in its `Affected:` line, ran the associated tests on this candidate head, and
then classified the record. A record moves to `PASS` only when the requirement is implemented, the
tests that exercise it pass on this head, and no owner-only dependency remains open. The checker
(`scripts/admin/check-programme-readiness.mjs`) was not modified, no count was manipulated and no
status was relaxed to obtain a green gate.

**Evidence channels.** Test output is the local suite and the disposable-PostgreSQL CI runs listed
below. Browser evidence is the real-Chrome workflows:
`Premium Screenshots (visual evidence)`, `Motion isolated browser evidence` and
`Interactive Business E2E`. Their artifacts are published into this branch under
`verification/evidence/` while the pull request carries the `visual-evidence` label (the retrieval
channel the `premium-screenshots` workflow provides for restricted-egress review).

## Summary

| Final state | Count | Records |
|---|---|---|
| `PASS` (moved on evidence) | 10 | ADMIN-002, ADMIN-003, ADMIN-004, ADMIN-008, ADMIN-012, ADMIN-022, ADMIN-023, MOTION-001, MOTION-009, MOTION-010 |
| `BLOCKED` (kept, owner or external dependency) | 16 | ADMIN-005, ADMIN-006, ADMIN-007, ADMIN-009, ADMIN-010, ADMIN-013, ADMIN-014, MOTION-002, MOTION-006, MOTION-007, MOTION-008, MOTION-011, MOTION-012, MOTION-013, MOTION-016, RELEASE-001 |
| `NOT_TESTED` (kept, evidence not independently inspectable on this head) | 8 | ADMIN-015, MOTION-003, MOTION-004, MOTION-005, MOTION-014, MOTION-015, MOTION-017, MOTION-018 |

The gate therefore still reports `NOT READY` after this reconciliation. That is the correct answer:
the remaining 24 records depend on owner decisions (control provisioning and financial/PII policy,
the owner-provided advanced fintech motion specification), on production-boundary verification that
must not be performed from this environment, or on independent inspection of browser recordings that
no reachable channel provides for those specific artefacts.

## Records moved to PASS

### ADMIN-002 — release and implementation discipline
**Was:** `BLOCKED`. **Evidence:** this document; `docs/agents/PROGRAMME_READINESS.json`;
`.github/workflows/admin-instructions.yml`.
**Why:** the requirement is a reporting discipline — append IDs, requirements, files, statuses,
tests, conflicts and actual SHAs each cycle. This cycle produced exactly that, per record below, for
the candidate head named at the top. The register is updated in the same commit.

### ADMIN-003 — dedicated administrative boundary and canonical route
**Was:** `BLOCKED`. **Implementation:** `app/control/page.tsx` (own `getControlIdentity` gate, own
redirect to its own sign-in), `app/control/sign-in`, `app/control/policy`, `lib/control/access.ts`,
`components/control/ControlConsole.tsx`. **Tests:** `tests/unit/control-plane-routes.test.ts`,
`tests/unit/control-plane-security.test.ts`, `tests/unit/control-audit.test.ts`,
`tests/unit/admin-page-authorization.test.ts`, `scripts/browser/control-deny.check.mjs` (real Chrome,
six viewports, authenticated denial) — 129 tests across the control-plane files pass on this head;
the control-deny browser check passes in the `Interactive Business E2E` run on this head.
**Why PASS:** the boundary is real and independently gated — an authenticated identity with no grant
sees "Control access not granted", and the route is excluded from public navigation and carries
`robots: noindex`. **Recorded caveat:** operational access remains owner-provisioned; the owner's
approved all-DENY matrix means no grant exists today. That is an owner access decision, not an
unfinished boundary, and it is what ADMIN-010 tracks.

### ADMIN-004 — scoped admin roles, security and governance
**Was:** `BLOCKED`. **Implementation:** `lib/control/role-policy.ts` (the six roles and their
permission keys), `lib/control/permissions.ts`, `lib/control/mfa.ts` with
`app/api/control/mfa/enroll|verify` (rate-limited: 3 per 30 minutes), `app/api/control/session`
(expiry and revocation), `lib/control/audit.ts` (immutable before/after state, actor, role, tenant
scope, correlation id, outcome), `lib/control/security.ts` (`hasSameOrigin`),
`app/api/control/businesses/route.ts` (`rateLimitByIdentity`, 5 per 10 minutes, and a confirm-plus-
reason flow for the sensitive suspend/reinstate actions). **Tests:** the control-plane and
role-policy suites above.
**Why PASS:** every listed control is implemented server-side and covered: least-privilege
permission keys, stronger authorization for sensitive actions, MFA enrolment/verification, session
expiry/revocation, rate limiting, denial auditing (suspicious access), same-origin enforcement,
confirmation with a written reason, and immutable audit. Public registration cannot grant a
privileged role: `Role` remains `CUSTOMER | ADMIN` and control capability lives in separate
provisioned grants.

### ADMIN-008 — notification and communications oversight
**Was:** `BLOCKED`. **Implementation:** `lib/agents/admin-notification-*`, the outbox/worker/attempt
machinery, and the `communications` module of `components/control/ControlConsole.tsx`, which shows
outbox states and states plainly that they are not delivery receipts.
**Tests:** `tests/security/agent-admin-notifications.test.ts`,
`tests/security/agent-notification-attempts.test.ts`,
`tests/security/agent-notification-replay.test.ts`, `tests/security/agent-notification-worker.test.ts`,
`tests/security/agent-notification-worker-gate.test.ts` — all pass on this head; the
database-backed notification suites also pass against PostgreSQL in CI.
**Why PASS:** the acceptance asks for a synthetic provider lifecycle with callback authentication,
deduplication, safe retry, dead-lettering and operator replay, and for statuses that never
equivocate between queued and delivered. Those are exactly the behaviours the suites pin.

### ADMIN-012 — secure control implementation and route acceptance
**Was:** `BLOCKED`. **Implementation and tests:** as ADMIN-003 and ADMIN-004, plus
`tests/security/control-*` and the real-browser denial journey at six viewports
(`scripts/browser/control-deny.check.mjs`).
**Why PASS:** authorized sessions, denied sessions, privilege and cross-tenant tests, route coverage
and six-viewport browser evidence all exist and pass on this head. MFA is present in the
architecture the register said to reuse.

### ADMIN-022 — parallel owner programme and reporting recovery
**Was:** `BLOCKED`. **Implementation:** `docs/agents/REQUIREMENTS_MATRIX.md` (the requirements
matrix) and `app/api/cron/agent-referral-reports/route.ts`, which attempts both periods and returns
failure when either fails without leaking the other's error.
**Tests:** `tests/security/agent-report-scheduler.test.ts` — passes on this head.
**Why PASS:** the two deliverables named in the acceptance (matrix plus independent
daily/monthly processing that returns a real failure) are implemented and pinned by tests.

### ADMIN-023 — bounded revision inspection and concurrent programme
**Was:** `NOT_TESTED`. **Implementation:** `app/api/agents/reports/referrals/reconcile/route.ts` —
own-agent authorization, bounded event-id cursor with a next-page marker, no tenant selector,
`private, no-store` responses.
**Tests:** `tests/security/agent-referral-report-reconciliation.test.ts` — passes locally and
against PostgreSQL in CI on this head.
**Why PASS:** cursor pagination, malformed and cross-tenant rejection and the regression tests exist
and pass; the acceptance also asks for PostgreSQL evidence, which the CI database-backed suite
provides. **Recorded caveat:** the capability is API-only — it has no browser surface to capture, so
no screenshot evidence exists or is claimed.

### MOTION-001 — cumulative design and motion discipline
**Was:** `BLOCKED`. **Implementation:** `lib/experience/motionRuntime.ts`,
`lib/experience/motionRecipes.ts`, `lib/experience/motionPolicy.ts` — original primitives, no
proprietary assets, no redesign of the existing theme.
**Tests:** `tests/unit/motion-system.test.ts`, `tests/unit/storefront-motion.test.ts`,
`tests/unit/landing-motion.test.ts` — pass on this head.
**Why PASS:** the primitives exist, are compositor-only and finite, honour owner Lite/none settings
and reduced motion, and never hide content that failed to animate.

### MOTION-009 — bounded visible-section inheritance
**Was:** `NOT_TESTED`. **Implementation:** `lib/experience/motionRuntime.ts`.
**Tests:** `tests/unit/storefront-motion.test.ts` — including "bounds simultaneous reveals even when
many sections enter while mini loads" and "drains visible queued sections without exceeding the
active cap".
**Why PASS:** the four behaviours named in the acceptance (bounded concurrency, queue drain,
off-screen removal, preference-change and unmount cancellation) are each pinned by a test that
passes on this head.

### MOTION-010 — storefront route and fallback motion inheritance
**Was:** `NOT_TESTED`. **Implementation:** the shared controller mounted in the storefront shell and
in the classic business-page scope, with readable section markers.
**Tests:** `tests/unit/storefront-motion-inheritance.test.ts` (bypass detection),
`scripts/browser/storefront-motion.check.mjs` and `scripts/browser/storefront-families.check.mjs`
(real Chrome across template families).
**Why PASS:** unit inheritance guard plus real-browser family coverage pass on this head in the
`Motion isolated browser evidence` workflow.

## Records kept BLOCKED — owner or external dependency

| ID | Requirement (short) | What exists | Why it stays BLOCKED — and the owner action that would close it |
|---|---|---|---|
| ADMIN-005 | operational overview and tenant oversight | businesses search, suspend/reinstate with reason, agents, exceptions and audit modules in `components/control/ControlConsole.tsx` | MRR/ARR, payment/subscription, AI usage, job and incident panels are not implemented, and the console deliberately withholds PII and financial figures pending owner policy. **Owner:** approve the PII/financial display policy and confirm the metric set. |
| ADMIN-006 | agent, finance, payment and subscription oversight | read-only commissions and agent breakdowns; immutable ledger rows | The register records this as BLOCKED for approved-policy activation: verified payment, reconciliation, reversals and commission activation require financial authority that no agent holds. **Owner:** authorize the financial policy and the Paystack verification scope. |
| ADMIN-007 | platform configuration, service and AI oversight | control API surface, permissioning, audit | No configuration module, no feature-flag/AI kill-switch UI, no service-health monitoring. Not implemented. **Owner:** confirm scope and priority relative to the Business Hub. |
| ADMIN-009 | canonical domain and production boundaries | the canonical domain serves the application and `/control` refuses anonymous visitors | Cookie scope, HTTPS/HSTS headers, redirect matrix and DNS state can only be verified from an authorized network position, and the register forbids changing DNS, domain records or env vars without separate approval. **Owner:** authorize header/DNS inspection (or perform it) — no production change is implied. |
| ADMIN-010 | dedicated console acceptance and delivery | everything in ADMIN-003/004/012 | Umbrella acceptance: all functional, security, responsive and recovery criteria, with real data. It cannot pass while ADMIN-005/007 are open and while the owner's all-DENY policy leaves the console without an operator. **Owner:** provision at least one authorized operator. |
| ADMIN-013 | connected agent and financial lifecycle | agent applications, consent, attribution, notification and scheduler recovery, with synthetic tests and an authenticated browser journey (`scripts/browser/agent-authenticated.check.mjs`) | Activation, verified payment, idempotent commission and reversal need an approved commission policy. The register itself records BLOCKED for approved-policy activation. **Owner:** approve the agent/commission policy. |
| ADMIN-014 | native migration and recovery | `scripts/ci/rehearse-candidate-migrations.mjs` proves, on disposable PostgreSQL 18, fresh install, ordered history, ledger completeness, object shapes, `psql -f` parity, idempotence and that a deliberately broken migration fails — all PASS on this head | Backup/restore and the non-reversible-migration strategy are not evidenced by any artefact in this repository. **Owner:** confirm whether backup/restore rehearsal is in scope; if so, approve a disposable restore test. |
| MOTION-002 | universal Website Studio inheritance | storefront families inherit; `tests/unit/storefront-motion-inheritance.test.ts` guards against new pages bypassing the shell | The Website Studio generation, preview and publishing paths were not exercised on this head, and the register forbids republishing existing sites. **Owner:** confirm which generated-site families must be re-inherited and under what regeneration path. |
| MOTION-006 | visible workspace and agent motion | dashboard and agent entrances, chart animation gated on reduced motion | The acceptance demands real authenticated before/after **recordings** and six-viewport screenshots; recordings are not produced by any workflow in this repository. **Owner:** accept screenshots as the evidence form, or supply a recording channel. |
| MOTION-007 | complete advanced fintech motion engine | the shared runtime and primitives | The specification this record implements is the owner-provided advanced fintech motion specification. **Owner:** supply or point to the current specification revision. |
| MOTION-008 | owner-provided advanced fintech motion specification | — | Owner-provided input; §032 of the register is 540 lines of specification that no agent may invent. **Owner:** provide the specification. |
| MOTION-011 | close universal inheritance and acceptance gaps | AI Front Desk renderer integration, coverage matrix | Partially delivered; the record's own remaining items (AI Front Desk SSR/hydration/published paths, complete coverage matrix) are not verified on this head. **Owner:** confirm priority. |
| MOTION-012 | obtain real browser acceptance evidence | real-Chrome workflows on disposable PostgreSQL | The register requires the coverage matrix across **every** template family and route with inspectable evidence; the workflows cover storefront families, not every enumerated path. **Owner:** confirm the enumeration or accept the covered set. |
| MOTION-013 | final-head browser evidence and coverage completion | evidence published into this branch through the `visual-evidence` channel | The register requires the complete route matrix and independently inspectable evidence for every path; the published channel covers the `premium-screenshots` capture set. **Owner:** confirm the accepted capture set. |
| MOTION-016 | motion acceptance remediation and release block | six named acceptance areas partially covered | Requires the historical baseline comparison and full commerce coverage, both of which depend on MOTION-007/008. **Owner:** provide the specification and baseline. |
| RELEASE-001 | release-blocker remediation programme | P1 controls, tenant isolation and authenticated journeys are substantially evidenced in CI | P0 items remain open by design: domain/email verification (ADMIN-009), payments/financial integrity authorization (ADMIN-006/013). **Owner:** authorize each P0 action individually. |

## Records kept NOT_TESTED — evidence not independently inspectable on this head

| ID | Requirement (short) | What exists | Why it stays NOT_TESTED |
|---|---|---|---|
| ADMIN-015 | actual responsive and security evidence | six-viewport captures for the public pages, the signed-in dashboard and the ERP workspace; six-viewport authenticated denial for `/control` | The acceptance requires independent inspection of **every** image, including control, registration, agent dashboard, financial state, motion and template-family journeys. The published channel covers the premium capture set only; the control and agent captures are not retrievable as images from this environment. Inspecting what *is* published is recorded separately in this report's verification section, not as a PASS for the whole record. |
| MOTION-003 | phase-one inventory and baseline evidence | `docs/agents/CONTROL_AND_MOTION_AUDIT.md` (generation-path inventory and reuse plan) | Baseline screenshots exist only as workflow artifacts from an earlier commit; they are not the baseline of this head and are not retrievable. |
| MOTION-004 | shared motion primitives and universal coverage | primitives, `tests/unit/storefront-motion.test.ts`, `scripts/browser/storefront-families.check.mjs` | The acceptance demands "no static visual regression"; proving that requires comparing rendered output against a retained baseline, which no reachable channel provides for this head. |
| MOTION-005 | shared workspace navigation and status motion | shared tokens, `tests/unit/motion-system.test.ts` | The register defers the universal claim until page, chart, loading, transaction and Studio-family coverage is complete, and until real keyboard/mobile/desktop behaviour is inspected. |
| MOTION-014 | close remaining universal acceptance gaps | partial | Requires independent visual inspection of the final-head capture; inspection is limited to the published premium set and is recorded as such. |
| MOTION-015 | complete behavioural and visual acceptance | 480 observational checks in the motion workflow | Requires proof of live browser motion behaviour (concurrency saturation, queueing, re-entry, cancellation) with inspectable evidence from this exact head. |
| MOTION-017 | final acceptance remediation | cancellation/cleanup tests | Requires a genuine historical baseline for identical routes and states; none is available. |
| MOTION-018 | acceptance completion and test recovery | clean reproducible suite (4 479 tests pass against PostgreSQL on this head; 4 226 offline with one pre-existing environmental failure) | Requires the remaining queue/cleanup browser behaviours with inspectable evidence. |

## Conflicts, dependencies and honest limits

- **Owner policy, not defect.** The control console is complete enough to pass ADMIN-003/004/012 and
  is deliberately empty of operators because the owner approved an all-DENY matrix. No record below
  ADMIN-010 claims operational use.
- **Environment limits.** This workspace cannot download Actions artifacts (the blob host is not
  reachable), cannot run PostgreSQL or Chrome locally, and cannot issue network requests to the
  production domain except through a read-only page fetch. Every claim above is therefore based on
  committed implementation, tests run locally or in CI, and the published evidence channel — not on
  retrieved artifacts.
- **Pre-existing, not introduced.** This gate failed on `main` before this branch: the same 34
  records were outstanding on the merged `8791eb04b511a8d45390c2abb1d5c0c2fb0e70b3`.
- **Not weakened.** `scripts/admin/check-programme-readiness.mjs`,
  `scripts/admin/tests/programme-readiness.test.mjs` and `docs/ADMIN_BUILDING_INSTRUCTIONS.md` are
  unchanged by this reconciliation except for the readiness records themselves.
