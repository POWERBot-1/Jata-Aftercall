# Control-plane six-role permission matrix

**Status: PROPOSED FOR OWNER REVIEW — NO ROLE/ACTION GRANTS APPROVED.** This matrix records a review boundary, not permission to provision accounts or grants. Nothing here authorizes production access. JATA AFTERCALL remains separate from JATA Qi/TANYA-AI.

## Decision classes

- **Repository-authorized behavior:** the repository defines six canonical role identifiers, explicit capability keys, deny-by-default server-side authorization, per-request grant reads, tenant/resource scoping, session-version enforcement, MFA support, and append-only auditing for supported mutations. These engineering controls do not approve a mapping from any role to any capability.
- **Safe technical behavior:** unsupported or unapproved reads/actions remain denied or explicitly unavailable/pending; no role defaults, fixtures presented as live data, implicit global scope, grant creation UI, production account, or production grant is created.
- **Owner approval required:** exact role/action mapping; tenant versus platform-wide access; payment amount and personal-data visibility; status changes and their effects; role/grant provisioning and revocation; dual control; financial authority; recovery; MFA policy; audit visibility and retention. All such capabilities remain denied until decision and implementation evidence exist.

## Role/action matrix

Every capability cell is intentionally pending/denied. The role descriptions below are tentative descriptions inferred from role names, not approved job definitions.

| Canonical role | Proposed responsibility (unapproved) | Read | Write | Approval / dual control | Financial visibility / authority | Tenant scope | Sensitive administrative operations | MFA | Audit |
|---|---|---|---|---|---|---|---|---|---|
| `SUPER_ADMIN` | Broad platform stewardship; scope and boundaries unresolved | **Pending** exact modules and data classes; no role default | **Denied pending approval** | **Denied**; no approval authority inferred | **Pending**; no amounts, adjustments, commissions, refunds, or payouts authorized | **Unassigned**; no global/null-scope grant inferred | **Denied pending approval**, including grants, identity, providers and emergency access | Protected routes currently fail closed unless TOTP is verified; role-specific rules/recovery pending | Supported writes are audited; visibility, sensitive-read logging and retention pending |
| `PLATFORM_ADMIN` | Platform operations; separation from Super Admin unresolved | **Pending** exact modules and data classes | **Denied pending approval** | **Denied**; no approval authority inferred | **Pending**; no financial authority inferred | **Unassigned**; no global/null-scope grant inferred | **Denied pending approval**, including provider configuration and grant changes | Protected routes currently fail closed unless TOTP is verified; role-specific rules/recovery pending | Supported writes are audited; visibility, sensitive-read logging and retention pending |
| `FINANCE_ADMIN` | Financial oversight; data and action boundaries unresolved | **Pending**; payment amounts/details and ledger visibility not approved | **Denied pending approval** | **Denied**; no approval or dual-control authority inferred | **Denied** for adjustments, commission policy, reconciliation decisions, refunds and payouts; read scope pending | **Unassigned**; no global/null-scope grant inferred | **Denied pending approval**, including financial records outside approved minimum data | Protected routes currently fail closed unless TOTP is verified; role-specific rules/recovery pending | Supported writes are audited; finance-specific visibility and retention pending |
| `SUPPORT_ADMIN` | Support operations; customer-data and tenant boundaries unresolved | **Pending**; identity/PII and tenant reads not approved | **Denied pending approval**, including business/agent status changes | **Denied**; no case or business approval authority inferred | **Denied**; no payment/commission actions inferred | **Unassigned**; no cross-tenant/customer access inferred | **Denied pending approval**, including identity, suspension effects and another user's sessions | Protected routes currently fail closed unless TOTP is verified; role-specific rules/recovery pending | Supported writes are audited; support audit visibility and retention pending |
| `SECURITY_ADMIN` | Security operations; identity/incident authority unresolved | **Pending** exact identities, audit and tenant scope | **Denied pending approval**, including role/grant and session changes | **Denied**; no grant approval/emergency authority inferred | **Denied**; no financial authority inferred | **Unassigned**; no global/null-scope grant inferred | **Denied pending approval**, including another user's session revocation, grants, recovery and providers | Protected routes currently fail closed unless TOTP is verified; role-specific rules/recovery pending | Supported writes are audited; audit visibility, sensitive-read logging and retention pending |
| `READ_ONLY_AUDITOR` | Independent review; audit/data visibility unresolved | **Pending** exact records, personal-data redaction and tenant scope | **Denied** by proposed read-only boundary; owner confirmation still required | **Denied**; no approval authority inferred | **Pending** read scope; no adjustment, reconciliation decision or payout authority | **Unassigned**; no global/null-scope grant inferred | **Denied**; no identity, grant, provider, recovery or operational mutation | Protected routes currently fail closed unless TOTP is verified; role-specific rules/recovery pending | **Pending** audit visibility, actor identifiers, cross-tenant coverage, sensitive-read logging and retention |

## Capability vocabulary (not assignments)

The explicit keys currently recognized in `lib/control/permissions.ts` are `businesses.read`, `businesses.suspend`, `businesses.reinstate`, `subscriptions.read`, `payments.read`, `agents.read`, `agents.manage`, `commissions.read`, `communications.read`, `communications.recover`, `providers.read`, `providers.configure`, `audit.read`, `exceptions.read`, and `system.health.read`. No role receives any of these by name; no grant is seeded. The existence of a key is not owner approval to expose a data class or enable an operation.

## Specific owner decisions still required

1. Approve or reject each role's responsibilities and each exact role × capability pair. Identify explicitly allowed and denied actions, including direct URL/API behavior.
2. Define when each capability is tenant-scoped versus platform-wide; whether null scope needs a second approver; how unassociated payments and cross-tenant incidents are handled.
3. Approve minimum necessary user/agent data, sensitive fields, retention, audit visibility, and any sensitive-read auditing.
4. Define business suspension and reinstatement preconditions and all effects on publication, booking, subscription, payments, referrals, notifications and users.
5. Define financial visibility and authority separately: amount/currency access, reconciliation, commission rates/events/attribution/reversals, adjustments, refunds, payout eligibility, approvals and separation of duties.
6. Name the grant/bootstrap authority and approval/revocation/recovery process; decide dual control, expiry, emergency access and how to test safely without creating production accounts.
7. Approve role/action MFA freshness, approved authenticators, lockout, recovery, and support procedure. Current all-route TOTP gating is a fail-closed engineering posture, not policy approval.

## Evidence and acceptance boundary

- Policy source: `lib/control/role-policy.ts`; display: `/control/policy` (`app/control/policy/page.tsx`).
- Enforcement source: `lib/control/permissions.ts`, `lib/control/access.ts`, `/api/control/*`, and `prisma/schema.prisma` (`ControlRoleGrant`, `ControlAuditEvent`, session version, MFA credential).
- The UI must display this pending state. It must not create grants or production identities. Until owner decisions and isolated non-production provisioning approval exist, authenticated six-role journeys cannot be run as role-policy acceptance; report that precise provisioning blocker rather than simulating role access.
- Repository test results, route presence, or screenshots of this static matrix do not count as six-role browser acceptance, accessibility inspection, production verification, or owner policy approval.
