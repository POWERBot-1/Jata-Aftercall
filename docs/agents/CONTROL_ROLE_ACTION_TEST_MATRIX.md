# Control authorization acceptance test matrix

**Owner-approved effective policy: DENY all 90 role × capability cells** (decision recorded 2026-11-01). `CONTROL_ROLE_POLICY_APPROVED = true` records approval of the denial document only; `CONTROL_ROLE_ACCESS_ENABLED = false` remains the separate fail-closed runtime gate. No ALLOW, Control grant, role assignment, permission, operational identity or operational access is authorized. A separate narrow owner authorization permits one temporary synthetic ordinary CI `User` solely in PR #78's disposable database; it receives no Control grant or role and is discarded with that database. This document describes evidence boundaries; it is not a provisioning instruction.

The complete matrix, capability semantics, read/write classification, scope/data restrictions and owner questions are in `docs/agents/CONTROL_OWNER_DECISION_PACKAGE.md`.

## Exact-head evidence and result

The exact implementation commit `0b665e5719935966de76c0e3f42b23c2dcad4872` passed the updated CI denial journey and relevant validation:

- [Interactive Business E2E run 41321876592](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41321876592) — passed, including the authenticated Control browser/API deny-path, unchanged disposable business state, and denial screenshot upload. The owner explicitly authorized its synthetic ordinary test `User` inside the disposable PostgreSQL service only. No Control grant, role assignment, permission, ALLOW, production identity, or production access was created.
- [Full no-database suite 41321876655](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41321876655) — passed.
- [Candidate migration rehearsal 41321876623](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41321876623) — exact candidate migration rehearsal passed on disposable PostgreSQL 18; no migration files changed in this PR update.
- [Release Validation 41321876594](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41321876594) and [POS / ERP verification 41321876611](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41321876611) — passed.
- [Motion isolated browser evidence 41321876581](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41321876581) and [Premium Screenshots 41321876665](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41321876665) — passed; these are unrelated visual journeys and do not constitute independent review of the `/control` denial screenshots.
- [Admin instruction integrity run 41321876626](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41321876626) — instruction-integrity passed, but programme-completeness correctly failed because 34 requirements remain BLOCKED or NOT_TESTED. No status was weakened to clear the gate.

The latest `/control` denial screenshots were uploaded, but independent visual inspection remains BLOCKED; an earlier artifact download attempt returned EOF. Local focused Control Vitest passed **35/35** across four files, covering all 90 cells, unknown roles/capabilities, the independent fail-closed gate, and mocked cross-tenant denial. A broader local no-database run had one environment-only failure because this checkout lacked generated Prisma DMMF; the exact-commit CI full suite above passed. The programme checker still reports 34 NOT_READY requirements. Remaining acceptance gaps include positive-role/tenant authorization, MFA/recovery/revocation/expiry, successful persisted application audit, and independent `/control` visual inspection.

## Six roles × 15 capabilities

| Capability | `SUPER_ADMIN` | `PLATFORM_ADMIN` | `FINANCE_ADMIN` | `SUPPORT_ADMIN` | `SECURITY_ADMIN` | `READ_ONLY_AUDITOR` |
|---|---|---|---|---|---|---|
| `businesses.read` | DENY | DENY | DENY | DENY | DENY | DENY |
| `businesses.suspend` | DENY | DENY | DENY | DENY | DENY | DENY |
| `businesses.reinstate` | DENY | DENY | DENY | DENY | DENY | DENY |
| `subscriptions.read` | DENY | DENY | DENY | DENY | DENY | DENY |
| `payments.read` | DENY | DENY | DENY | DENY | DENY | DENY |
| `agents.read` | DENY | DENY | DENY | DENY | DENY | DENY |
| `agents.manage` | DENY | DENY | DENY | DENY | DENY | DENY |
| `commissions.read` | DENY | DENY | DENY | DENY | DENY | DENY |
| `communications.read` | DENY | DENY | DENY | DENY | DENY | DENY |
| `communications.recover` | DENY | DENY | DENY | DENY | DENY | DENY |
| `providers.read` | DENY | DENY | DENY | DENY | DENY | DENY |
| `providers.configure` | DENY | DENY | DENY | DENY | DENY | DENY |
| `audit.read` | DENY | DENY | DENY | DENY | DENY | DENY |
| `exceptions.read` | DENY | DENY | DENY | DENY | DENY | DENY |
| `system.health.read` | DENY | DENY | DENY | DENY | DENY | DENY |

The policy unit test iterates every role and canonical capability, asserts every matrix cell is `DENY`, rejects unknown roles/capabilities and wildcard-like values, and verifies no database grant can add a role permission. `hasControlPermission`/`scopedBusinessIds` helper tests use in-memory fixture objects only to exercise exact-key and tenant-scope primitives; they do **not** represent a persisted/effective grant or prove an API allows access. `getControlIdentity()` checks `CONTROL_ROLE_ACCESS_ENABLED=false` before grant lookup, and `lib/control/access.ts` filters any future database grant through the approved all-DENY role matrix.

## Route and session contract

| Surface | Effective behavior now | Required acceptance / limitation |
|---|---|---|
| `/control` | Anonymous request redirects to sign-in; an authenticated ordinary synthetic session sees only the `POLICY_PENDING` shell. | Current browser journey checks no operational data, no horizontal overflow and screenshots at 320×568, 360×800, 390×844, 430×932, 768×1024 and 1366×768. These are denial-state screenshots, not enabled-console acceptance. |
| `/api/control/overview`, `/api/control/businesses` GET | Anonymous: `UNAUTHENTICATED`; authenticated: `POLICY_PENDING`. | Real HTTP browser/API CI check verifies exact responses; no Control grant is provisioned. |
| `/api/control/businesses` PATCH | A syntactically valid same-origin suspension request returns `POLICY_PENDING` before transaction/business write/audit. | Disposable PostgreSQL fixture asserts business status remains unchanged, no grant is created and no misleading success audit event persists. |
| All other protected Control APIs | Pending policy denies before grant/MFA/data access. Unsupported operations have no enabling route. | Exact positive capability behavior, tenant-authorized browser flow and persisted success audit through an enabled API remain BLOCKED. |
| Session/MFA | Ordinary session validation uses current user, base role and `sessionVersion`; protected Control MFA is checked only after the global policy gate. | No positive MFA, recovery, step-up or grant-revocation application path is exercised in this denial journey. |
| Grant expiry | `ControlRoleGrant` has `revokedAt` but no expiry field. | BLOCKED pending owner design/schema decision; no client-only expiry simulation. |

## Scope, audit, rollback and unsupported actions

- Unknown roles, missing/empty grants, unknown capabilities, wildcards, invalid/expired sessions, pending policy, missing/invalid MFA, revoked grants and unsupported operations fail closed.
- No null/global scope or cross-tenant access is enabled. Agent, communications, provider, exception, audit and health sources without a proven tenant relationship remain denied.
- Sensitive data (PII, payment amounts/references, provider credentials, commission amounts/eligibility and broad audit data) remains unavailable. Financial changes, agent management, communications recovery, provider configuration, grant administration, other-user session revocation and break-glass remain unsupported/denied.
- The isolated denial journey checks persistence before/after the attempted business mutation and actor audit count. It does not test a successful application-generated Control audit event. Existing PostgreSQL foundation tests cover append-only trigger resistance and rollback/reapply, but are not proof of complete application audit payloads.
- Any future enabled mutation must persist its business effect and truthful outcome audit atomically where required. Failed/denied actions must not leave a success response/event. Migration rollback/integrity still needs exact-head current run evidence.

## Explicitly BLOCKED before positive role-policy acceptance

The owner has decided DENY for all 90 cells. Any future request to change a cell to ALLOW requires exact role duties/separation, route/action, field/data minimum, tenant/resource scope, side effects, financial/PII visibility, MFA freshness/recovery, session/grant expiry and revocation, emergency access, audit-read/retention and a separate non-production test authorization. No Control capability grant is created. The separately authorized synthetic CI `User` carried no Control grant/role and existed only in the disposable test database; no operational or production identity/grant was provisioned by this decision.

A complete six-role acceptance must later prove, for approved roles only: positive/negative direct API and browser actions; tenant isolation; valid/expired/revoked grant, session and MFA behavior; persisted application audit outcomes; rollback/integrity; authenticated enabled-console journeys; and independently reviewed `/control` screenshots at all required viewports. No acceptance is claimed from helper tests, mocked routes, this pending-policy UI, or unrelated green workflows.


## Superseding owner authorization — 2026-11-07

The preceding all-DENY matrix and denial-only acceptance notes are historical. GITANYA KARIUKI has authorized the platform to choose least-privilege decisions. The effective policy is now the bounded read-only 90-cell matrix in `lib/control/role-policy.ts` and `docs/agents/CONTROL_ROLE_ACTION_MATRIX.md`:

- SUPER_ADMIN: businesses.read, subscriptions.read, payments.read, commissions.read, audit.read, system.health.read.
- PLATFORM_ADMIN: businesses.read, subscriptions.read, system.health.read.
- FINANCE_ADMIN: subscriptions.read, payments.read, commissions.read.
- SUPPORT_ADMIN: businesses.read, subscriptions.read.
- SECURITY_ADMIN: audit.read, system.health.read.
- READ_ONLY_AUDITOR: audit.read.
- All remaining cells DENY. All writes, financial adjustments, refunds, payouts, grant/identity administration, provider configuration, communications recovery and emergency access remain denied.
- Tenant-keyed reads require exact business scope. Null/global grants do not authorize tenant-keyed reads. Minimal system-health read is the only global-scope exception.
- Access requires a current authenticated session, active exact-key DB grant, live grant recheck and verified short-lived MFA. No grant is seeded or provisioned by the policy change.

The latest implementation corrects a stale fail-closed test suite that still asserted the superseded all-DENY behavior. Exact-head PostgreSQL and authenticated browser positive-role acceptance, grant expiry, MFA recovery/revocation race, persisted success audit and independent six-viewport visual inspection remain separate evidence requirements. Do not mark them PASS until those exact-head checks pass.
