# Control authorization acceptance test matrix

**Effective policy: DENY all 90 role × capability cells.** `CONTROL_ROLE_POLICY_APPROVED = false` remains set to the fail-closed value. The owner authorized isolated synthetic identities and disposable fixtures for deny-path tests, but supplied no per-role ALLOW decisions. This document describes tests and limitations; it is not an authorization, grant or production provisioning instruction.

The complete matrix, capability semantics, read/write classification, scope/data restrictions and owner questions are in `docs/agents/CONTROL_OWNER_DECISION_PACKAGE.md`.

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

The policy unit test iterates every role and canonical capability, asserts every matrix cell is `DENY`, rejects unknown roles/capabilities and wildcard-like values, and verifies no database grant can add a role permission. `hasControlPermission`/`scopedBusinessIds` helper tests use in-memory fixture grants only to exercise exact-key and tenant-scope primitives; they do **not** represent an effective grant or prove an API allows access. `getControlIdentity()` checks the global pending-policy gate before grant lookup, and `lib/control/access.ts` filters any future database grant through the role matrix.

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

Owner must decide each exact role × capability ALLOW (or keep DENY), role duties/separation, route/action, field/data minimum, tenant/resource scope, side effects, financial/PII visibility, MFA freshness/recovery, session/grant expiry and revocation, emergency access, audit-read/retention and safe test provisioning. Until then, no positive identity or Control capability grant is created. The deny-path synthetic ordinary identity is disposable, isolated and carries no Control grant.

A complete six-role acceptance must later prove, for approved roles only: positive/negative direct API and browser actions; tenant isolation; valid/expired/revoked grant, session and MFA behavior; persisted application audit outcomes; rollback/integrity; authenticated enabled-console journeys; and independently reviewed `/control` screenshots at all required viewports. No acceptance is claimed from helper tests, mocked routes, this pending-policy UI, or unrelated green workflows.
