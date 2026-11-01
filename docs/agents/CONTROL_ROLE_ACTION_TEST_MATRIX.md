# Control authorization acceptance test matrix

**Owner-approved effective policy: DENY all 90 role × capability cells** (decision recorded 2026-11-01). `CONTROL_ROLE_POLICY_APPROVED = true` records approval of the denial document only; `CONTROL_ROLE_ACCESS_ENABLED = false` remains the separate fail-closed runtime gate. No ALLOW, grant, identity, permission, or operational access is authorized. This document describes evidence boundaries; it is not a provisioning instruction.

The complete matrix, capability semantics, read/write classification, scope/data restrictions and owner questions are in `docs/agents/CONTROL_OWNER_DECISION_PACKAGE.md`.

## Exact-head evidence and result

The last CI-verified feature head is `f3383e335e821494e06d6484d460287d251ba2c6` (PR merge-ref SHA `2a6c4300aebfea88de899e364a20b87166d6baed`). It passed the authenticated real-browser/API denial journey in [Interactive Business E2E run 41317961120](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41317961120). That historical harness used a disposable synthetic identity; it is not being rerun under the current explicit no-identities restriction. It verified anonymous API denial, `POLICY_PENDING` on authenticated protected reads and a valid same-origin mutation, unchanged disposable business state, no Control grant, and no persisted success audit event. Six `/control` denial-state screenshots were uploaded, but GitHub artifact download returned EOF; independent visual inspection therefore remains BLOCKED.

At that historical head, [full no-database suite 41317961144](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41317961144), [Release Validation 41317961095](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41317961095), [candidate migration rehearsal 41317961077](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41317961077), and [PostgreSQL/POS/ERP verification 41317961049](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41317961049) passed. `instruction-integrity` passed in run 41317961063; `programme-completeness` failed because 34 requirement records remain BLOCKED or NOT_TESTED. The owner has since explicitly approved all 90 DENY decisions; that approval does not grant access or close positive-authorization acceptance.

After the local approval/runtime-gate edits, the focused offline Control Vitest run passed **35/35** tests across four files (all 90 cells, unknown roles/capabilities, independent fail-closed gate, and mocked cross-tenant denial included). The broader local `npx vitest run --exclude tests/e2e` completed with 3,980 passing, 253 skipped and one failing test: `tests/unit/autopilot-phase1-hardening.test.ts` could not read Prisma DMMF because this checkout has no generated `@prisma/client`; no Control test failed. The full suite is therefore not certified for the current local tree. No migration files changed; the most recent isolated candidate rehearsal above passed, but exact-head rehearsal was not rerun. The programme checker still reports 34 NOT_READY requirements. Remaining acceptance gaps include positive-role/tenant authorization, MFA/revocation/expiry, successful audit, rollback/integrity on the current exact head, and independent visual evidence.

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

The owner has decided DENY for all 90 cells. Any future request to change a cell to ALLOW requires exact role duties/separation, route/action, field/data minimum, tenant/resource scope, side effects, financial/PII visibility, MFA freshness/recovery, session/grant expiry and revocation, emergency access, audit-read/retention and a separate non-production test authorization. No Control capability grant is created. The previously run deny-path synthetic identity carried no Control grant; no new identity or grant is provisioned by this decision.

A complete six-role acceptance must later prove, for approved roles only: positive/negative direct API and browser actions; tenant isolation; valid/expired/revoked grant, session and MFA behavior; persisted application audit outcomes; rollback/integrity; authenticated enabled-console journeys; and independently reviewed `/control` screenshots at all required viewports. No acceptance is claimed from helper tests, mocked routes, this pending-policy UI, or unrelated green workflows.
