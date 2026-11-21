# JATA AFTERCALL — OWNER AUTHORITY IMPLEMENTATION & VERIFICATION PLAN

**Status:** IMPLEMENTATION BLOCKED — this document records scope and fail-closed acceptance requirements; it is not evidence that code enforcement is complete.
**Target:** PR #126 branch `arena/a3de1985-jataaftercall`
**Candidate inspected:** `ccb8b5439b5350cd647cd588e31a2369b9e72039`
**Production:** no changes authorized or performed.

## Authority

The sole initial Platform Owner is Gitanya Kariuki. Owner identity must be bound to a verified authenticated account and a documented identity-verification workflow. Do not commit government ID numbers, personal phone numbers, passwords, tokens, identity documents, or verification codes. No account may become owner based only on a client claim, role string, email text, seed, or environment variable exposed to the client.

## Required role taxonomy

Canonical roles: OWNER, SECURITY, OPERATIONS, FINANCE, and AUDITOR. Map legacy role identifiers only through an explicit, reviewed compatibility mapping. Unknown roles are denied. Roles must not inherit capabilities implicitly.

## Required controls

1. Sole initial owner. Owner bootstrap must be single-use, transactionally protected, and verified against the owner identity workflow.
2. Additional privileged identities require an owner-authenticated approval record; approvals must be attributable, scoped, and auditable.
3. Every protected route, server action, API, job, worker, webhook, and tool must authorize at the server action boundary.
4. Least privilege: exact capability allowlists, no wildcard permissions, explicit resource/tenant scope, and no grants from role labels alone.
5. Role separation: OWNER, SECURITY, OPERATIONS, FINANCE, AUDITOR; incompatible duties and privilege combinations must be denied.
6. No direct financial-record mutation. Ledger/payment/commission/settlement source records are immutable through administrative paths. Corrections use approved compensating/reversal records, with idempotency and reconciliation.
7. Tenant isolation: derive tenant scope from trusted session/database relationships; never accept client-supplied tenant IDs as authority. Minimum-necessary customer/merchant data.
8. Privileged audit events must be attributable and durable. For gated operations, audit persistence failure blocks the operation. Protect audit history from mutation/deletion and validate integrity.
9. MFA is mandatory for privileged accounts. Require verified MFA state and a short-lived, session-bound MFA proof for privileged actions. Enrollment, recovery, revocation, and freshness policy must be tested.
10. Production deployment, payment activation, payout, irreversible operations, and sensitive policy changes require explicit owner authorization bound to the exact action/target/parameters and revalidated at execution time. Approval cannot be reused for different parameters.
11. Fail closed on missing identity, invalid/revoked session, stale session version, unknown policy, authorization or tenant lookup failure, missing MFA, or audit failure.
12. Owner revocation and emergency lockdown must be server-side, immediately effective, durable, audited, and fail closed. Recovery must not introduce an unauthenticated bypass.
13. AI agents, scheduled jobs, workers, service accounts, webhooks, and tool calls have non-owner identities with narrowly scoped credentials. They cannot impersonate owner, mint grants, bypass approval, or escalate through delegated calls.
14. Direct database access and privileged database credentials must be isolated from application/user/agent identities. Database constraints, permissions, and migration review must support application authorization rather than bypass it.
15. No hidden administrative backdoor, seeded production owner, universal bypass flag, impersonation endpoint, or alternate recovery bypass.
16. Keep all existing deny-by-default controls enabled until implementation and independent verification are complete. Do not enable broad control access or change production configuration as part of this work.

## Architecture work required

- Owner identity binding and single-use bootstrap/recovery protocol.
- Server-side authorization helper with explicit action, actor, resource, tenant, and policy inputs.
- Role/capability policy and incompatibility matrix.
- Privileged grant/approval records with transactional checks and revocation.
- MFA enforcement and session-bound MFA proof.
- Owner action approval record bound to action, target, canonical parameters, expiry, nonce, and consumption state.
- Emergency lockdown and revocation checks on every privileged operation.
- Audit schema/append-only enforcement, integrity verification, safe metadata redaction, and audit-failure gate.
- Financial immutability and reversal-only correction paths.
- Agent/service identity boundary and delegation rules.
- Inventory and compatibility review for every existing ADMIN route, control route, server action, worker, webhook, and privileged DB access.
- Avoid changing public/customer access and ordinary tenant workflows except where necessary to enforce authorization.

## Required test evidence

Tests must execute at API/server/action boundary in isolated fixtures/disposable databases and prove no unauthorized side effects occurred.

| Scenario | Required expected result |
|---|---|
| Admin creation without owner approval | DENIED |
| Owner approval absent, expired, replayed, or parameter mismatch | DENIED |
| Privileged access without MFA | DENIED |
| Cross-tenant access | DENIED; no data leak or write |
| Direct ledger/payment/commission/settlement mutation | DENIED |
| Financial correction via approved reversal | ALLOW only under exact policy and approval |
| AI/service identity claims owner | DENIED |
| Privilege escalation / unknown role / wildcard grant | DENIED |
| Identity/session/policy lookup failure | DENIED |
| Emergency lockdown active | Privileged action DENIED |
| Owner-authorized action within exact scope | ALLOW only if all checks pass |
| Privileged action audit record | Required actor/action/target/scope/result/correlation |
| Audit store unavailable/integrity failure | Gated operation DENIED |
| Owner revocation | Privileges immediately ineffective |
| Session revocation/version mismatch | DENIED |
| UI bypass/partial rendering/server action/API/job/webhook | DENIED without valid authorization |
| Bootstrap repeated or concurrent | At most one owner; all other attempts DENIED |
| Owner recovery | No bypass; evidence-backed identity verification required |

## Role/capability matrix

This is a design starting point, not a permission grant. Keep every capability DENY until the owner explicitly approves exact capability, resource scope, conditions, and implementation evidence.

| Role | Initial authority | Financial writes | User/grant administration | Tenant data | Production/sensitive actions |
|---|---|---|---|---|
| OWNER | Owner-only, verified | No direct record mutation; reversal approval only | Owner-authorized only | Minimum necessary; audited | Explicit action-bound approval |
| SECURITY | Security operations only | DENY | Restricted security scope | Minimum necessary | DENY except exact approved security controls |
| OPERATIONS | Operational support only | DENY | DENY | Explicit tenant scope | DENY |
| FINANCE | Read/reconciliation only | DENY direct mutation | DENY | Financial scope only | DENY |
| AUDITOR | Read-only, independent | DENY | DENY | Explicit audit scope, redacted | DENY |

No matrix cell grants access. Future ALLOW cells require separate explicit owner approval and code/test review.

## Release gates

- [ ] Source inventory completed; no unreviewed privileged entry points.
- [ ] Owner identity workflow verified, with personal ID values excluded from repository.
- [ ] Owner bootstrap single-use, concurrency-safe, and verified.
- [ ] Role and capability policy implemented; all unspecified permissions DENY.
- [ ] MFA and session freshness/revocation enforced.
- [ ] Owner action approval bound to exact operation and parameters.
- [ ] Tenant isolation and data minimization tests pass.
- [ ] Financial mutation prohibition/reversal controls verified.
- [ ] Agent/worker/webhook boundaries verified.
- [ ] Audit durability, redaction, integrity, and fail-closed behavior verified.
- [ ] Emergency lockdown and owner revocation verified.
- [ ] Full test suite and CI checks pass on exact candidate SHA.
- [ ] Independent review completed.
- [ ] Preview-only integration tests completed without production changes.
- [ ] Release readiness findings updated with PASS/FAIL/BLOCKED/NOT TESTED and artifact references.

## Current evidence snapshot

- Existing control plane is fail-closed: `CONTROL_ROLE_ACCESS_ENABLED=false`.
- Existing documented role policy currently denies all 90 role/capability cells; preserve this.
- Existing control roles differ from the requested canonical roles and require compatibility review.
- Existing generic admin guards rely on session role `ADMIN`; this is not sufficient proof of verified Platform Owner identity.
- This inspection did not execute application tests or verify production behavior.
- PR #126 programme-completeness check failed on its latest retry; instruction-integrity check passed.
- Therefore owner authority implementation is **BLOCKED / NOT TESTED**, not complete.

## Work boundary

This plan does not authorize Production deployment, merge, payment activation, payout, spending, provider commitments, role grants, broad access enablement, or release-gate bypass.
