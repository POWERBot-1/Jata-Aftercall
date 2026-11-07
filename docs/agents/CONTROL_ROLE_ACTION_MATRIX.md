# Control-plane six-role authorization policy

**Owner-approved effective policy: DENY all 90 role × capability cells** (owner decision recorded 2026-11-01). `CONTROL_ROLE_POLICY_APPROVED = true` records approval of the denial document only. `CONTROL_ROLE_ACCESS_ENABLED = false` is the independent operational kill switch; protected Control routes remain fail-closed. The owner approved no ALLOW, Control grant, role assignment, permission, operational identity, provisioning, or operational access. A separate narrow authorization permits one synthetic ordinary CI `User` in PR #78's disposable database only; it receives no Control role/grant/permission and is discarded with the database. JATA AFTERCALL remains separate from JATA Qi/TANYA-AI.

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

- The documented all-DENY policy is owner-approved, but the independent `CONTROL_ROLE_ACCESS_ENABLED` switch remains false, so authenticated requests receive `POLICY_PENDING` before grant lookup, operational reads, mutation or MFA checks. Unauthenticated requests remain unauthenticated.
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

The owner-approved all-DENY decision is now recorded. Until any future ALLOW decision is separately authorized and all applicable acceptance checks complete, the 90 denials remain in effect and `CONTROL_ROLE_ACCESS_ENABLED = false`.

## Evidence boundary

The exact-head CI deny-path journey used one temporary synthetic ordinary session in the disposable database, with no Control grant, called the built application over HTTP, attempted a business status mutation, checked persisted business/audit state and captured `/control` denial screenshots at 320×568, 360×800, 390×844, 430×932, 768×1024 and 1366×768. The owner explicitly authorized this narrow test-only fixture; it proves only denial behavior and responsive layout of the access-disabled shell, not positive role authorization, enabled-console UI, MFA success/recovery, grant expiry, successful persisted audit events or production behavior. No Control grant, role assignment, permission or production identity was created.

A full role-positive, tenant isolation, MFA/revocation, exact-grant/expiry, persisted audit and authenticated enabled-console acceptance remains **BLOCKED** until the owner supplies exact ALLOW decisions and required policy details. No acceptance is claimed from pure helper tests, mocked routes, unrelated green CI or denial-state screenshots.


## Owner authorization update — 2026-11-07 (supersedes the 2026-11-01 all-DENY operational decision)

The owner, GITANYA KARIUKI, expressly authorized the platform to select the least-privilege role decisions and proceed with Control role access. The previous all-DENY matrix remains preserved as historical decision context, but it is superseded by this bounded read-only policy. This authorization does **not** delegate financial mutation, payout, provider-secret, user/grant administration, emergency or other write authority.

| Role | ALLOW capabilities | Required scope |
|---|---|---|
| SUPER_ADMIN | businesses.read, subscriptions.read, payments.read, commissions.read, audit.read, system.health.read | Business, subscription, payment, commission and audit reads require exact business scope; only minimal system health is platform-wide |
| PLATFORM_ADMIN | businesses.read, subscriptions.read, system.health.read | Business/subscription reads require exact business scope; minimal system health is platform-wide |
| FINANCE_ADMIN | subscriptions.read, payments.read, commissions.read | Exact business scope only |
| SUPPORT_ADMIN | businesses.read, subscriptions.read | Exact business scope only |
| SECURITY_ADMIN | audit.read, system.health.read | Audit reads require exact business scope; minimal system health is platform-wide |
| READ_ONLY_AUDITOR | audit.read | Exact business scope only |

All remaining cells in the 15 × 6 matrix are DENY. In particular: businesses.suspend, businesses.reinstate, agents.manage, communications.recover, providers.configure remain DENY for every role. agents.read, communications.read, providers.read and exceptions.read remain DENY because their present data sources are not proven safe for the delegated tenant scope or have no implemented authoritative provider query.

**Runtime:** CONTROL_ROLE_POLICY_APPROVED=true and CONTROL_ROLE_ACCESS_ENABLED=true. The second value only opens the grant-evaluation path; it does not grant access. Every request still requires a valid current session, an active database grant containing the exact policy-approved permission, explicit business scope for tenant-keyed data, live grant recheck, and verified short-lived MFA. No owner identity, ControlRoleGrant or production permission was provisioned by this change. An account with no grant continues to receive CONTROL_ACCESS_REQUIRED.

**Acceptance boundary:** this policy and its unit tests do not constitute positive authenticated browser acceptance, grant-expiry proof, MFA recovery proof, PostgreSQL append-only audit acceptance, or independent six-viewport visual review. Those remain blocked until exact-head tests and evidence pass.
