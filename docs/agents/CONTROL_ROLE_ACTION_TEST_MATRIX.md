# Control authorization test matrix

**Policy status: PENDING.** This is a software authorization test matrix, not an owner-approved role-to-action mapping. No production accounts/grants exist or may be created from this matrix. All six role identifiers are runtime labels only; role names never grant capabilities.

## Six roles × 15 explicit capability keys

For every cell below, the policy answer is **DENIED pending owner approval**. The runtime tests additionally verify the same capability evaluator for every role:

- no matching `permissionKeys` entry → denied;
- exact capability entry with tenant scope `tenant-a` → allowed only for that exact key and resource in `tenant-a`;
- another capability or resource in `tenant-b` → denied;
- `scopeBusinessId: null` is platform-wide only when the exact permission was explicitly granted; no null-scope grant is seeded or assumed.

| Capability/action | `SUPER_ADMIN` | `PLATFORM_ADMIN` | `FINANCE_ADMIN` | `SUPPORT_ADMIN` | `SECURITY_ADMIN` | `READ_ONLY_AUDITOR` |
|---|---|---|---|---|---|---|
| `businesses.read` | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending |
| `businesses.suspend` | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending |
| `businesses.reinstate` | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending |
| `subscriptions.read` | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending |
| `payments.read` | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending |
| `agents.read` | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending |
| `agents.manage` | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending |
| `commissions.read` | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending |
| `communications.read` | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending |
| `communications.recover` | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending |
| `providers.read` | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending |
| `providers.configure` | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending |
| `audit.read` | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending |
| `exceptions.read` | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending |
| `system.health.read` | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending | DENIED pending |

The test suite evaluates the 6×15 combinations through the exact-capability/tenant helper, and the route suite verifies explicit grants versus no grant for all six role identifiers on the subscription-record endpoint. Those route fixtures exercise the handler's post-approval capability path; the production access layer has an independent global `CONTROL_ROLE_POLICY_APPROVED = false` guard that currently denies every protected API/page before grant lookup or MFA. A synthetic explicit grant cannot override this pending-policy gate. The test fixture grants are in-memory only; they do not create database records or user accounts. The tests establish code behavior, not owner approval or authenticated-role acceptance.

## Route/action runtime contract

| Route/action | Runtime allow condition | Denials and fail-closed cases | Evidence path |
|---|---|---|---|
| Global pending-policy gate | **No protected Control route is currently allowed.** `CONTROL_ROLE_POLICY_APPROVED` is false; after owner decision, an explicit reviewed code change is required before the per-capability path can run. | Authenticated `/control` displays pending-policy state; protected APIs return `POLICY_PENDING`. A stored/forged capability cannot override this gate. | `lib/control/role-policy.ts`, `lib/control/access.ts`, `app/control/page.tsx`; `tests/unit/control-policy-pending-access.test.ts` |
| Direct `/control` page | Existing authenticated session, current explicit read grant, then MFA before data | Redirect signed-out user; deny no grant; fail closed if access store unavailable | `app/control/page.tsx`, `components/control/ControlConsole.tsx`; `tests/unit/control-plane-routes.test.ts` |
| `/api/control/overview` | After owner policy approval only: at least one exact read capability and MFA; returns only granted modules | Currently blocked by `POLICY_PENDING`, regardless of grants; afterwards no grant, stale session, no MFA or access-store failure denies; unavailable tenant-unsafe sources remain withheld | `app/api/control/overview/route.ts`; `lib/control/access.ts`; `tests/unit/control-policy-pending-access.test.ts`, `tests/unit/control-plane-routes.test.ts` |
| `/api/control/records?kind=subscriptions` | Exact `subscriptions.read`, MFA, live grant row and tenant filter | Invalid/out-of-scope cursor, missing grant, revocation race, non-authoritative source error | `app/api/control/records/route.ts`; `tests/unit/control-records-route.test.ts` |
| `/api/control/records?kind=payments` | Exact `payments.read`, MFA, live grant row and tenant filter; null-business records require an explicit platform-wide grant | Amount, reference, provider id and customer identity are withheld; invalid cursor/scope or access failure denied | `app/api/control/records/route.ts`; `tests/unit/control-records-route.test.ts` |
| `/api/control/records?kind=agents` | Exact `agents.read`, MFA and explicit platform-wide scope because source has no tenant key | Tenant-scoped grant denied; names, phone, user identifier and status mutations unavailable | `app/api/control/records/route.ts`; `tests/unit/control-records-route.test.ts` |
| `/api/control/records?kind=commissions` | Exact `commissions.read`, MFA and payment-business tenant filter | Financial amounts, currency, related identity references, payable state and eligibility withheld; no write/payout action | `app/api/control/records/route.ts`; `tests/unit/control-records-route.test.ts` |
| `/api/control/businesses` GET | Exact `businesses.read`, MFA and scoped query | Cross-tenant records excluded; invalid source fails without fabricated values | `app/api/control/businesses/route.ts`; `tests/unit/control-plane-routes.test.ts` |
| `/api/control/businesses` PATCH | Exact `businesses.suspend` or `.reinstate`, MFA, same-origin, row-locked current grant scoped to target, valid state transition, explicit confirmation and reason | Cross-tenant/direct API, invalid status/confirmation/reason, concurrent state/grant change denied; successful mutation and audit are one transaction | `app/api/control/businesses/route.ts`; `tests/unit/control-plane-routes.test.ts` |
| `/api/control/audit` GET | Exact `audit.read`, MFA and audit tenant scope | Unscoped entries not returned to tenant-scoped grants; source errors are unavailable, not empty | `app/api/control/audit/route.ts`; `tests/unit/control-plane-routes.test.ts` |
| `/api/control/session/revoke` POST | Any explicit read capability, MFA, same-origin and literal self-revocation confirmation | Only actor's own sessions; no other-user revocation route; increments session version, clears cookies and audits | `app/api/control/session/revoke/route.ts`; `tests/unit/control-plane-routes.test.ts`, `tests/security/auth-session-revocation.test.ts` |
| MFA status/enroll/verify | Authenticated control identity, same-origin for mutation, rate limit, encrypted TOTP secret and one-use time step | No protected module data before verification; no account/grant creation or recovery override | `app/api/control/mfa/**`; `tests/unit/control-plane-security.test.ts` |
| User/role/grant management, agent status writes, commission actions, communication replay, provider configuration, other-user session revoke | **Unavailable pending owner policy** | No endpoint, UI control, mock or production provisioning | `lib/control/permissions.ts`, `docs/agents/OWNER_DECISIONS_AND_ACCEPTANCE.md` |

## Cross-tenant test obligations

The tested authorization matrix includes a same-tenant explicit read, a different-tenant denial, a cursor belonging to another tenant, and a grant-revocation race. The existing business mutation tests additionally deny a direct cross-tenant PATCH before persistence or audit; the PostgreSQL foundation tests prove grant/audit immutability and append-only update/delete rejection. `tests/unit/control-plane-security.test.ts` covers every role × capability pair and both tenant identifiers. Cross-tenant **authenticated browser** journeys remain BLOCKED: no approved disposable-account/grant process exists.

## Audit integrity

Protected successful mutations are recorded transactionally with actor, role, action, target, timestamp (database-created), outcome, reason where applicable, before/after state where relevant, and correlation ID. New read pages record `CONTROL_RECORDS_READ` with target kind, scope, outcome, request correlation and record count. PostgreSQL triggers reject ordinary audit update/delete; integration proof resides in `tests/prisma/control-plane-foundation-postgres.test.ts`. This does not establish owner approval of audit viewer roles, retention, or sensitive-read policy.
