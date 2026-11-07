# Control-plane six-role authorization policy

**Current effective owner decision — 2026-11-07:** GITANYA KARIUKI authorized the platform to choose least-privilege role decisions and enable Control role access. This supersedes the 2026-11-01 all-DENY decision. The historical decision is retained below only for audit history.

## Current effective policy

The 15 capabilities × 6 canonical roles produce 90 explicit decisions. Only scoped, read-only access is allowed:

| Role | ALLOW capabilities | Required scope |
|---|---|---|
| SUPER_ADMIN | businesses.read, subscriptions.read, payments.read, commissions.read, audit.read, system.health.read | Exact business scope for tenant data; minimal system health only is platform-wide |
| PLATFORM_ADMIN | businesses.read, subscriptions.read, system.health.read | Exact business scope for tenant data; minimal system health only is platform-wide |
| FINANCE_ADMIN | subscriptions.read, payments.read, commissions.read | Exact business scope |
| SUPPORT_ADMIN | businesses.read, subscriptions.read | Exact business scope |
| SECURITY_ADMIN | audit.read, system.health.read | Exact business scope for audit; minimal system health only is platform-wide |
| READ_ONLY_AUDITOR | audit.read | Exact business scope |

All other cells are DENY. All write, approval, refund, commission-adjustment, payout, agent-management, communications-recovery, provider-configuration, identity/grant-administration and emergency/break-glass capabilities remain denied. Role labels alone never authorize access.

## Runtime enforcement

- `CONTROL_ROLE_POLICY_APPROVED=true` and `CONTROL_ROLE_ACCESS_ENABLED=true`.
- Enabling the policy does not create an identity, assign a role, or seed a database grant.
- Every protected request requires a valid current session, an active database grant with the exact policy-approved capability, exact business scope for tenant data, a live grant recheck and verified short-lived MFA.
- Null/global scope is rejected for tenant-keyed data. Only the minimum system-health capability may use platform-wide scope.
- Unknown roles, permissions, malformed grants and permission escalation fail closed.
- No production identity, ControlRoleGrant, or financial/provider mutation authority is created by this decision.

## Acceptance boundary

The policy is implemented in `lib/control/role-policy.ts`. Positive authenticated browser/API journeys, tenant isolation, MFA recovery, grant/session revocation and expiry, persisted PostgreSQL audit behavior and independent six-viewport enabled-console evidence must still pass on the exact release candidate before these capabilities are treated as production-accepted.

## Historical decision — 2026-11-01

The earlier all-DENY matrix and its rationale are preserved below as historical context. It was superseded by the explicit least-privilege owner authorization dated 2026-11-07.

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
