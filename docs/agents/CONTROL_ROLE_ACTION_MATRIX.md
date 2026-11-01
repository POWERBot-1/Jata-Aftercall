# Control-plane six-role authorization policy

**Effective policy: DENY all 90 role × capability cells.** `CONTROL_ROLE_POLICY_APPROVED = false`; protected Control routes remain fail-closed. The owner authorized this policy work and isolated synthetic test identities/disposable fixtures, but did not give role-by-role permissions. No role, capability, grant, production identity or production access is approved by that overall consent. JATA AFTERCALL remains separate from JATA Qi/TANYA-AI.

The exact 15×6 matrix, candidate capability semantics, read/write classifications, scope/data restrictions, session/MFA/audit/revocation/emergency controls, expiry gap and owner questions are recorded in `docs/agents/CONTROL_OWNER_DECISION_PACKAGE.md`. This file is a short implementation summary, not a separate source of role grants.

## Effective role policy

| Canonical role | Proposed purpose (unapproved) | Effective policy | Scope / sensitive data | Additional boundary |
|---|---|---|---|---|
| `SUPER_ADMIN` | Proposed platform stewardship; authority and limits unresolved. | DENY all 15 capabilities. | No assigned scope; null/global and cross-tenant access denied. | No implicit unrestricted access, grant administration or emergency access. |
| `PLATFORM_ADMIN` | Proposed platform operations; separation from Super Admin unresolved. | DENY all 15 capabilities. | No assigned scope; provider/system/platform-wide data denied. | No provider configuration, identity/grant changes or unsupported operations. |
| `FINANCE_ADMIN` | Proposed financial oversight; data/actions unresolved. | DENY all 15 capabilities. | No payment amounts, references, commission amounts, balances or eligibility. | No reconciliation decisions, adjustments, refunds, payouts or approvals. |
| `SUPPORT_ADMIN` | Proposed support operations; tenant/case relationship unresolved. | DENY all 15 capabilities. | No PII, contact data, agent detail or cross-tenant reads. | No business status change or unsupported recovery action. |
| `SECURITY_ADMIN` | Proposed security operations; identity/incident boundaries unresolved. | DENY all 15 capabilities. | No audit, identity, provider-secret or system-wide data access. | No grant/user administration, other-user revocation or bypass. |
| `READ_ONLY_AUDITOR` | Proposed independent review; records/tenant scope unresolved. | DENY all 15 capabilities. | No automatic audit visibility, global scope, PII or sensitive-data access. | “Read only” is not permission to read all tenants or all fields. |

The application policy object explicitly has one `DENY` for each of the 15 canonical permissions and maps each of the six canonical roles to that all-deny set. Automated tests iterate all 90 cells. Unknown roles, unknown permissions, wildcard-like values, malformed grants, missing grants and any grant permission not allowed by policy are denied. A database grant can narrow policy but cannot widen it.

## Authorization and safe technical behavior

- The global approval switch remains false, so authenticated requests receive `POLICY_PENDING` before grant lookup, operational reads, mutation or MFA checks. Unauthenticated requests remain unauthenticated.
- If an owner later approves an exact ALLOW and a separate implementation authorization is provided, a valid current session, active exact-key grant, exact resource/tenant scope and required MFA remain mandatory. Role name or JWT role alone never authorizes Control access.
- Current ordinary sessions expire after seven days and `getSession` rechecks the stored user, base role and `sessionVersion`. Current Control MFA uses a user/session-bound 15-minute token. These are technical settings, not an approved role-specific policy; positive Control MFA acceptance is not established while the global gate is closed.
- `ControlRoleGrant` supports revocation but has **no grant-expiry field**. Grant expiry is BLOCKED pending an owner decision and schema design; session expiry is not grant expiry. Do not invent client-side expiry or relax checks.
- Existing supported operations are not implicitly approved. Business suspension/reinstatement, financial-sensitive reads, audit/exception/system visibility and platform-wide sources remain unavailable. Agent management, communications recovery, provider configuration, user/grant administration, other-user session revocation, refunds, adjustments and payouts remain unsupported and denied.
- Supported write source paths include confirmation/reason, validation, resource scope, live grant recheck, status guards, rate limit and transactional audit. That code is not reachable while policy is pending. Denied attempts must not mutate application data or create a success audit event.
- No break-glass route, bootstrap bypass, seeded Control grant or production identity is added.

## Owner clarification required before any ALLOW

1. Confirm/redefine each role's purpose and separation of duties; role labels are not job definitions.
2. Decide each role × capability cell individually. For every proposed ALLOW, name exact route/action, fields, tenant/resource scope, conditions, side effects, null/global-scope rule and any dual approval.
3. Clarify payments/subscriptions, agent/referral, commission, communications, provider, exceptions, health and audit visibility; specify minimum fields, redaction, tenant boundaries, retention/export and sensitive-read logging.
4. Define suspension/reinstatement effects, financial authority, operational recovery, identity/grant/session administration and all unsupported high-impact actions.
5. Approve MFA freshness, authenticator/recovery/lockout, session duration, grant expiry, revocation latency, emergency access, test-identity custodian and disposable fixture procedure.

Until those decisions and all mandatory acceptance checks are complete, the 90 denials and `CONTROL_ROLE_POLICY_APPROVED = false` remain in effect.

## Evidence boundary

The owner approved isolated synthetic identities and disposable fixtures solely for non-production tests. The CI deny-path journey uses an ordinary synthetic session with no Control grant, calls the real built application over HTTP, attempts a valid business status mutation, checks persisted business/audit state and captures `/control` denial screenshots at 320×568, 360×800, 390×844, 430×932, 768×1024 and 1366×768. It proves only denial behavior and responsiveness of the pending-policy shell, not positive role authorization, enabled-console UI, MFA success/recovery, grant expiry, complete persisted success-audit events or production behavior.

A full role-positive, tenant isolation, MFA/revocation, exact-grant/expiry, persisted audit and authenticated enabled-console acceptance remains **BLOCKED** until the owner supplies exact ALLOW decisions and required policy details. No acceptance is claimed from pure helper tests, mocked routes, unrelated green CI or denial-state screenshots.
