# `/control` owner decision package

**Purpose:** record the conservative effective policy and its owner decision without enabling any capability. On 2026-11-01 the owner approved DENY for all 90 cells only. The owner approved no ALLOW, Control grant, role assignment, permission or operational/production identity. Separately, the owner explicitly authorized a temporary synthetic ordinary `User` solely inside the isolated disposable PostgreSQL database used by PR #78 CI; that fixture has no Control grant or role and is discarded with the database. This narrow test-only authorization does not enable production access or any Control capability.

**Repository / PR:** `POWERBot-1/Jata-Aftercall`, PR #78, branch `arena/115a62e1-jata-aftercall`  
**Baseline reviewed:** `34283dff5aa13579931cbed7dc62c497cec8e753`

**Owner decision recorded:** On 2026-11-01, the owner explicitly approved DENY for every one of the 90 canonical role × capability cells listed below. This is approval of the documented all-DENY policy only; it approves no ALLOW, Control grant, role assignment, permission, operational identity, provisioning, or operational Control access. The separately authorized disposable CI test `User` is an ordinary synthetic account and receives no Control role or grant.

**Implementation semantics:** `CONTROL_ROLE_POLICY_APPROVED = true` records that owner decision only. The independent runtime kill switch `CONTROL_ROLE_ACCESS_ENABLED = false` remains closed, so protected routes continue to fail closed. The approved decision does not create any grant or identity and does not enable any route.

## Decision protocol

The owner has explicitly approved **DENY** for every current canonical role × capability cell. The approved all-DENY matrix is the operative policy decision. It authorizes no access. Any future change to **ALLOW** requires a separate explicit owner decision for that exact cell, with action, data fields, tenant/resource scope, conditions and a non-production test plan, followed by separate implementation authorization and acceptance. A blank, ambiguous or partial change request remains **DENY**.

Even a written ALLOW does not activate an operation. The implementation must be reviewed, the role-policy constant must only be changed under a separate explicit implementation authorization, and the exact approved mapping must be enforced and tested server-side before that capability is usable. Unsupported operations stay denied until implemented and independently verified.

### Decisions required before any positive-permission test or policy activation

1. Confirm or replace each role’s purpose below; distinguish responsibilities rather than assuming the names define them.
2. The current 90 DENY decisions are approved. Before any future ALLOW, decide that exact role × capability cell and specify tenant/resource scope, field-level visibility, conditions and whether platform-wide/null scope is prohibited or requires separate dual approval.
3. Approve or reject the current candidate operations and list business side effects. In particular, define exactly what suspension/reinstatement changes and what it must not change.
4. Decide whether status-only payment/subscription data, agent/referral counts, commission-ledger metadata, communications state, audit records, system health, identities or any personal data may be seen. Specify minimum necessary fields, redaction and retention.
5. Define MFA enrollment, authenticator/freshness requirements, lockout, recovery, lost-device handling, session lifetime and reauthentication for sensitive actions. Existing TOTP implementation is a technical capability, not an approved policy.
6. No Control grant, role assignment, permission, ALLOW rule, operational identity, or production identity is authorized by this decision. On 2026-11-01 the owner separately authorized only the temporary synthetic ordinary `User` required by PR #78 CI, confined to its isolated disposable PostgreSQL database and discarded with that database. It receives no Control grant or role; do not broaden this exception. Any future positive authorization test still requires separate written approval for its exact principal, fixture data, grant/scope/expiry, custodian, evidence handling and production separation.
7. Define emergency access and recovery, if any: trigger, named approvers, dual control, duration, least privilege, alerting, audit, revocation and post-incident review. There is no current break-glass route or bootstrap bypass.
8. Decide audit-read permissions and sensitive-read auditing separately from mutation auditing; define retention, legal/privacy limits, export and review procedure.

## Owner-approved effective policy matrix — 90 DENY decisions; no ALLOW

The owner explicitly approved this all-DENY authorization policy on 2026-11-01. Role duties and operational needs remain unresolved; the approval does not infer them from names. No route is enabled, and no Control grant, role assignment, permission, operational identity or operational access is authorized. The separately authorized synthetic ordinary CI `User` is not a Control principal. The separate runtime access kill switch remains false.

| Capability | SUPER_ADMIN | PLATFORM_ADMIN | FINANCE_ADMIN | SUPPORT_ADMIN | SECURITY_ADMIN | READ_ONLY_AUDITOR |
|---|---|---|---|---|---|---|
| `businesses.read` | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY |
| `businesses.suspend` | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY |
| `businesses.reinstate` | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY |
| `subscriptions.read` | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY |
| `payments.read` | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY |
| `agents.read` | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY |
| `agents.manage` | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY |
| `commissions.read` | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY |
| `communications.read` | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY |
| `communications.recover` | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY |
| `providers.read` | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY |
| `providers.configure` | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY |
| `audit.read` | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY |
| `exceptions.read` | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY |
| `system.health.read` | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY | APPROVED DENY |

**Cell semantics:** each of these 90 owner-approved DENY cells permits no route, action, field, business, resource, tenant, null/global scope, side effect, or delegation. Reads and writes are both denied. No PII, payment detail, provider secret, commission amount, message body, audit export, or cross-tenant aggregate is exposed. There is no role inheritance, wildcard, self-approval, or exception. A denied request must not mutate state or create a misleading success audit record. MFA/session checks remain mandatory prerequisites but do not turn a denial into a grant. Any owner-requested ALLOW must replace the exact cell only after a written rationale, exact action and field list, scope, preconditions, side effects, approvals/separation-of-duties, MFA freshness, audit contract, and isolated test plan are recorded. Blank or ambiguous cells stay DENY.

| Role | Proposed role-specific rationale (not inferred from identifier) |
|---|---|
| `SUPER_ADMIN` | No documented authority boundary or operation list supports a broad grant; the title does not imply unrestricted access. |
| `PLATFORM_ADMIN` | No platform-operation runbook or tenant boundary establishes a necessary capability; global administration is not presumed. |
| `FINANCE_ADMIN` | No approved finance workflow, field need, reconciliation authority, or separation-of-duties rule is supplied. |
| `SUPPORT_ADMIN` | No case-to-tenant relationship, support workflow, customer-data need, or status-change authority is supplied. |
| `SECURITY_ADMIN` | No incident workflow, audit visibility decision, identity authority, or emergency mandate is supplied. |
| `READ_ONLY_AUDITOR` | No audit charter, record/field scope, tenant boundary, sensitive-read policy, or export mandate is supplied; “read-only” is not universal access. |

### High-risk decisions — deny unless separately confirmed

The approved 90-cell DENY matrix closes the current capability decisions. Grant/identity administration, other-user session revocation, emergency access and unrestricted audit export are not capabilities in that matrix and remain unsupported and unauthorized separately; this owner decision does not add routes or create principals.

| Decision | Operational need to establish | Security/operational impact if allowed | Safer alternative pending approval | Proposal |
|---|---|---|---|---|
| Provider configuration / secret rotation | Named operator duty, provider, specific setting, change window and rollback owner. | Secret exposure, payment/message outage, provider-wide effects, hard-to-reverse external changes. | Keep secrets in existing Vercel/provider secret management; use reviewed change ticket, two-person approval and provider-native audit. No Control secret read/write. | DENY for every role. |
| Financial mutations (refunds, adjustments, commission changes, payouts) | Reconciliation/refund case, source-of-truth record, legal/accounting basis and accountable approvers. | Direct loss, duplicate payment, ledger imbalance, fraud or irreversible Paystack effect. | Preserve existing authenticated Paystack/payment workflows with idempotency, bounded action, dual approval and independent reconciliation; no new Control mutation. | DENY for every role. |
| Agent management | Exact state transition and verified relation to an application/business. | Fraud, identity/PII exposure, referral/commission manipulation and cross-tenant impact. | Keep existing application/agent workflow; case-bound, tenant-scoped review with a separate approver and append-only history. | DENY for every role. |
| Communications recovery/replay | Specific failed outbox event, retry budget and duplicate-suppression evidence. | Duplicate external messages, privacy leak, recipient harm, cost and provider throttling. | Use existing idempotent worker/recovery queue with event-ID allowlist, dry run, bounded retry and operator reason; no broad Control replay. | DENY for every role. |
| Grant/identity administration | Named access custodian, target identity, approved role/capability, exact tenant scope and expiry. | Privilege escalation, persistence, lockout, insider abuse and self-granting. | Keep grants out of this console; require separate identity process, independent two-person approval, just-in-time scope, expiry/revocation and immutable audit. | DENY for every role. |
| Other-user session revocation | Confirmed incident, exact target account and accountable incident lead. | Denial of service, retaliation, evidence loss or attacker-assisted lockout. | Existing incident response with verified target, second-person confirmation, alerting, reason and audited bounded action; no endpoint until separately designed. | DENY for every role. |
| Emergency/break-glass access | Defined outage/incident trigger, approved responders and recovery objective. | Permanent bypass, stolen bootstrap credential, unreviewed cross-tenant access. | Continue normal owner/on-call escalation; no bypass or bootstrap admin. If later approved, require short expiry, dual control, alert, immutable audit and post-incident review. | DENY; no break-glass route. |
| Audit export / sensitive-data access | Legal/compliance purpose, exact fields, time range, tenant and recipient. | Bulk PII/financial leakage, loss of audit confidentiality, uncontrolled copies. | Search narrowly in place with redaction and tenant filter; separately approve any encrypted, time-bound, logged export. | DENY for every role. |

### Exact permitted-action and control proposal by capability

For all six roles, the proposed permitted action for each capability below is **none**. The candidate description is not an authorization. The listed boundaries define what must be decided before a future proposal can be reconsidered; they do not grant a subset of the capability.

| Capability | Proposed actions / data if reconsidered | Scope / sensitive-field boundary | Side effects, approvals, MFA, audit and separation-of-duties conditions before any future ALLOW |
|---|---|---|---|
| `businesses.read` | None now; candidate source fields are business name, slug, category, status, publication flag and timestamps. | One explicitly bound business only; no search-based existence leakage or cross-tenant aggregate; no customer PII. | Confirm per field and case/business relation; fresh MFA for any approved Control session; log actor, tenant, fields, query/result and outcome; reader cannot approve grants or change status. |
| `businesses.suspend` | No state change now. | Exact business ID only; no inferred linked booking, subscription, payment, agent or user action. | Owner must define transition/effects, reason, confirmation, rollback, notice and dual approval; fresh MFA; transactional before/after audit; requester cannot be sole approver. |
| `businesses.reinstate` | No state change now. | Exact suspended business ID only; no automatic republish, payment or user change. | Owner must define eligibility, side effects, reason, confirmation and independent approval; fresh MFA; transactional audit; no self-approval. |
| `subscriptions.read` | None now; candidate is status/record metadata only. | Tenant-bound business relation; no amount, payment instrument or customer identity. | Owner confirms fields and tenant relation; audit sensitive reads and outcomes; no write authority derived from read. |
| `payments.read` | None now; candidate is status/record metadata only. | Tenant-bound business relation; exclude amount, provider reference/ID and customer identity unless separately authorized. | Finance owner specifies exact field need and reconciliation separation; fresh MFA; audited purpose/tenant access; no refunds, adjustments or payouts. |
| `agents.read` | None now; candidate status metadata only. | Source lacks safe tenant key; no platform-wide scope, names, phone numbers or user IDs. | First establish a verified tenant relation and need; otherwise remain unavailable. Audit filtered reads; no agent management or commission authority. |
| `agents.manage` | None; unsupported status/write operation. | No identity or tenant scope is safe until workflow is designed. | Separate approved workflow, verified subject, dual approval, fresh MFA and atomic before/after audit required; manager cannot approve own change. |
| `commissions.read` | None now; candidate entry type/timestamps only. | Business/payment relation must be verified; exclude amount, currency, identity, payable state and eligibility. | Finance owner defines permitted metadata and reconciliation separation; audit every read; no rate, adjustment, accrual or payout authority. |
| `communications.read` | None now; candidate delivery state/count only. | No message body, recipient/destination or cross-tenant result; only verified tenant/event scope. | Owner defines privacy purpose and retention; audit query/result without copying message contents; no recovery or replay authority. |
| `communications.recover` | None; no Control replay/recovery route. | Exact event IDs only if later designed; no bulk or cross-tenant replay. | Require idempotency proof, dry run, bounded retry, fresh MFA, independent approval and immutable attempt/outcome audit; no self-approval. |
| `providers.read` | None; no authoritative Control probe or secret view. | No credentials, secret values, configuration, provider-wide tenant inference or unsupported health claim. | Prefer provider-native health/secret systems; any future metadata read must be redacted, tenant/purpose limited and audited. |
| `providers.configure` | None; unsupported external configuration. | No secret/config mutation or global provider scope. | Use reviewed Vercel/provider change management, secret rotation, rollback and two-person approval; no Control route absent separate authorization. |
| `audit.read` | None now; candidate event metadata only. | Exact tenant/time/event filter; redact personal/financial/provider secrets; no unrestricted export. | Owner defines audit charter, retention and reviewer independence; log audit-log reads/exports; auditor cannot mutate grants or delete/correct events. |
| `exceptions.read` | None now; candidate authoritative operational exceptions only. | Each source must prove tenant binding; no inferred global count or personal data. | Owner defines source, severity and purpose; log queries and results; no remediation/write action from this read key. |
| `system.health.read` | None now; no probes or unsupported health results. | Only verified aggregate service availability, no secrets, tenant data or configuration. | Owner defines service/source and incident use; log access; health reader cannot configure providers or change production state. |

MFA freshness, recovery, session lifetime, grant expiry/revocation latency, approval identities, audit retention and the exact separation-of-duties model remain owner choices. The current technical 15-minute MFA token is not an approved freshness standard. Until those decisions are supplied, every proposal above remains **DENY** and no positive test grant may be provisioned.

## Canonical role identifiers and purpose questions

The following identifiers exist in `prisma/schema.prisma` and `lib/control/permissions.ts`. The purpose text is copied as **tentative and unapproved** from the existing proposed matrix. Confirm, replace or reject each; no route or capability follows from the label.

| Canonical role | Tentative purpose — owner must confirm/redefine | Required scope and separation-of-duties decision |
|---|---|---|
| `SUPER_ADMIN` | Proposed broad platform stewardship; authority and limits unresolved. | Is any platform-wide access intended? Which functions are excluded or require another approver? Define separation from `PLATFORM_ADMIN`; do not infer unrestricted access. |
| `PLATFORM_ADMIN` | Proposed platform operations; modules and separation from `SUPER_ADMIN` unresolved. | Name exact operational modules and tenant boundary. Provider configuration, identity/grants and emergency access are not implied. |
| `FINANCE_ADMIN` | Proposed financial oversight; data and action boundaries unresolved. | Decide status-only versus amount/currency/reference visibility separately from reconciliation, adjustments, commissions, refunds and payout authority. No financial authority is inferred. |
| `SUPPORT_ADMIN` | Proposed support operations; customer-data and tenant boundaries unresolved. | Decide whether business/agent information or status changes are needed, and what tenant/case relationship permits access. No cross-tenant or PII access is inferred. |
| `SECURITY_ADMIN` | Proposed security operations; identity, incident and grant authority unresolved. | Decide audit/security visibility separately from grant changes, recovery, another user’s session revocation, provider configuration and emergency access. None is implied. |
| `READ_ONLY_AUDITOR` | Proposed independent review; data, audit visibility and tenant scope unresolved. | Define which records and fields can be read, whether scope is tenant-specific, and whether sensitive-read logging/export is required. “Read only” does not imply access to every tenant or personal data. |

## Existing application surface (implementation inventory, not approved access)

No role-specific route assignment is currently approved. The routes below are the existing candidate surface only. The global pending-policy check currently blocks protected pages/APIs after authentication, before grant lookup or MFA; the list therefore does not represent live authorized functionality.

| Existing route / operation | Candidate capability or gate in source | Data or effect currently represented | Owner decision / security concern |
|---|---|---|---|
| `GET /control` | Authenticated Control identity; then explicit read capability in the page. | `app/control/page.tsx` redirects anonymous users to `/control/sign-in`, shows a pending-policy state while policy is false, and otherwise renders the console only if a read capability exists. | Decide which roles, if any, may see the console and which modules each may open. Navigation visibility must never replace API authorization. |
| `GET /control/policy` | Public policy-display page; does not grant access. | Displays the proposed six-role boundary and pending state. | Decide how this review-only matrix is presented; it must never imply authorization. |
| `GET /api/control/overview` | Any one of ten explicit read keys: businesses, subscriptions, payments, agents, commissions, communications, providers, audit, exceptions or system health. | Aggregated authoritative-source counts/statuses where supported. Some modules intentionally return unavailable/pending; no provider probe or simulated health is configured. Business names/category/status may be returned. Payment/subscription overview is by status, not amount. Agent and notification sources lack tenant keys and require platform-wide scope in code. | Decide module by module, field by field, scope by scope. Define whether owner/business names, operational exceptions, referrals, provider/system status, or cross-tenant counts are permissible. Do not infer MRR, commission eligibility or delivery success. |
| `GET /api/control/businesses` | `businesses.read`; scope-filtered. | Business name, slug, category, status, publication flag and timestamps; paginated/searchable. | Decide whether each field is necessary; tenant boundaries; whether search itself could expose cross-tenant existence. |
| `PATCH /api/control/businesses` | `businesses.suspend` or `businesses.reinstate`; same-origin, explicit confirmation and reason, live scoped grant recheck, rate limit. | Changes business status and writes a same-transaction audit event in source. | Decide which role, if any, may do this; exact prerequisites, approvals, tenant scope, reversibility, notification and effects on publishing, booking, subscription, payment, referrals and users. These side effects are not authorized by this worksheet. |
| `GET /api/control/records?kind=subscriptions` | `subscriptions.read`; tenant-filtered if a tenant grant is approved. | Subscription status/record metadata; read-page audit code exists. | Decide exact fields, status semantics, tenant scope and sensitive-read policy. |
| `GET /api/control/records?kind=payments` | `payments.read`; tenant-filtered if approved. | Status/record metadata only; amount, reference, provider ID and customer identity are intentionally withheld in the current selector. | Decide whether even status-only data is needed. Amounts, refunds, payout eligibility, reconciliation decisions and transaction authority each require separate explicit decisions. |
| `GET /api/control/records?kind=agents` | `agents.read`; current source has no tenant key, so implementation requires an explicit platform-wide grant. | Application/agent status metadata; names, phone numbers and user identifiers are withheld. | Decide whether a platform-wide scope is justified, what relationship/data is needed, and how application status differs from agent operational status. No cross-tenant access is inferred. |
| `GET /api/control/records?kind=commissions` | `commissions.read`; scoped through payment/business relation when available. | Entry type and timestamps; amount, currency, identity references, payable state and eligibility are withheld. | Decide whether metadata may be viewed. Rates, qualifying events, attribution, reversals, adjustments, balances, refunds and payouts remain separate owner decisions; no financial policy is inferred. |
| `GET /api/control/audit` | `audit.read`; scope-filtered in source. | Actor ID/role, action, target, scope, outcome, reason, before/after, metadata, correlation and timestamp fields. | Decide who may see audit records, which fields need redaction, tenant/platform scope, sensitive-read audit, retention, export and review duties. |
| `POST /api/control/session/revoke` | Current source accepts any explicit `.read` capability, MFA, same-origin and literal self-revocation confirmation. | Revokes only the current user’s sessions by incrementing session version and clears session/MFA cookies; source records an audit event. There is no other-user revocation endpoint. | Confirm whether every role, especially the proposed read-only auditor, should be allowed self-revocation. Any other-user revocation remains denied absent a separate decision and endpoint review. |
| `GET /api/control/mfa/status`, `POST /api/control/mfa/enroll`, `POST /api/control/mfa/verify` | Authenticated Control identity; enrollment/verification require explicit read grant after policy gate. | Encrypted TOTP enrollment and a short-lived MFA session. | Approve authenticators, enrollment timing, recovery, lockout, re-verification, support and audit policy. Do not treat implemented TOTP as a complete owner-approved MFA policy. |
| User/grant administration, another user’s session revoke, agent status writes, communications recovery, provider configuration, financial mutation/refund/payout | No supported route is exposed by the current Control implementation for these operations. | Not available. | **Remain denied.** If requested, require a separate explicit scope, business/effect analysis, design, authorization review and tests before implementation. |

### Capability semantics, classification and effective decisions

**Policy result:** all 90 role × capability cells are **DENY**. This is the implemented least-privilege default because the owner's overall approval did not specify per-role duties, exact data needs, or tenant/resource scopes. It is not an owner-specific grant decision. There are no ALLOW cells, wildcard/inherited permissions or global-scope exceptions. The global policy switch remains false, so the protected routes reject before consulting grants or MFA.

| Capability | Read/write classification | Candidate semantics (not enabled) | Scope and sensitive-data restrictions | Effective decision |
|---|---|---|---|---|
| `businesses.read` | READ | Business name, slug, category, status, publication flag and timestamps; pagination/search. | Business-scoped only if later approved; never implicit global. No customer PII is needed by the current selector. | DENY |
| `businesses.suspend` | WRITE / destructive | Change one business status to SUSPENDED after exact confirmation, reason, status precondition, rate limit and live grant recheck. | Exact business tenant only. Effects on bookings, publishing, subscriptions, payments, agents and users must be clarified; no side effect is authorized. | DENY |
| `businesses.reinstate` | WRITE / destructive | Change one suspended business status to ACTIVE after exact confirmation, reason, status precondition, rate limit and live grant recheck. | Exact business tenant only. Reinstatement effects and approval/dual-control requirements are unresolved. | DENY |
| `subscriptions.read` | READ | Subscription status and record metadata from the authoritative store. | Business-associated only if approved. No amount, payment instrument or customer identity is implied. | DENY |
| `payments.read` | READ / financial-sensitive | Payment status and record metadata only; current selector withholds amount, reference, provider ID and customer identity. | Business-associated only if approved. No refund, adjustment, reconciliation, payout or amount visibility. | DENY |
| `agents.read` | READ / personal-data-sensitive | Agent/application/referral status metadata; names, phone numbers and user identifiers are withheld. | Source lacks a tenant key. Platform-wide access is denied; no tenant inference or cross-tenant access. | DENY |
| `agents.manage` | WRITE / unsupported | No Control mutation route is supported. | Denied regardless of role; requires separate design, scope, side-effect and owner review. | DENY |
| `commissions.read` | READ / financial-sensitive | Entry type and timestamps only; amount, currency, identity, payable state and eligibility are withheld. | Business/payment relation only if available and approved. No rate, calculation, adjustment, balance or payout policy. | DENY |
| `communications.read` | READ / personal-data-sensitive | Delivery state/counts only; message body and destination are not authorized. | Source does not provide safe tenant scope for all rows; global access denied. | DENY |
| `communications.recover` | WRITE / unsupported | No Control replay/recovery operation is supported. | Denied; could duplicate external effects. Requires separate idempotency and safety design. | DENY |
| `providers.read` | READ / security-sensitive | No authoritative provider probe or credential/configuration view is available in the Control module. | Denied; no secrets, health claims or cross-tenant provider data. | DENY |
| `providers.configure` | WRITE / security-sensitive / unsupported | No Control provider-configuration route is supported. | Denied; no secret rotation or external provider change. | DENY |
| `audit.read` | READ / security-sensitive | Actor ID/role, action, target, scope, outcome, reason, before/after, metadata, correlation and timestamp fields. | Tenant/resource filtering only where proven; platform-wide audit visibility, export, retention and sensitive-read policy unresolved. | DENY |
| `exceptions.read` | READ / security-sensitive | Aggregated operational exceptions where available; no unsupported inferred metrics. | Source-specific scope must be proven. No global access or fabricated health result. | DENY |
| `system.health.read` | READ / security-sensitive | Only authoritative app/service availability signals; never secrets or configuration. | Platform-wide by nature, but not authorized. No probes or health response is inferred. | DENY |

### Complete role × capability matrix (90 decisions)

Each cell is an explicit effective **DENY**. A future ALLOW requires a written owner decision for that exact role/capability, action and data scope, plus separate implementation authorization and acceptance evidence. No role name grants access.

| Capability | SUPER_ADMIN | PLATFORM_ADMIN | FINANCE_ADMIN | SUPPORT_ADMIN | SECURITY_ADMIN | READ_ONLY_AUDITOR |
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

### Global scope, sensitive data, audit, MFA, revocation and emergency controls

- **Role separation:** the six role names do not establish responsibility. Confirm purpose, boundaries and any incompatible duties for each. No role inherits another role's access.
- **Tenant scope:** no scope is assigned. Tenant-keyed capabilities would require an exact business/resource binding; null/global scope is denied. Agent, communications, provider, exception, audit and health data with missing/unsafe tenant keys remain denied.
- **Sensitive data:** no PII, payment amounts/references, provider secrets, personal contact details, commission amounts/eligibility or cross-tenant aggregates are authorized. Define minimum fields and redaction before considering access.
- **MFA/session:** ordinary JWT session is 7 days and revalidated against the current user role and `sessionVersion`; existing protected Control routes require an MFA token bound to user/session version and limited to 15 minutes. Those technical controls are not policy approval. Owner must decide MFA freshness, authenticators, recovery, reauthentication, session lifetime and revocation latency.
- **Grant lifecycle:** `ControlRoleGrant` has revocation but no grant-expiry field. Grant expiry is **BLOCKED** pending a schema/design decision; do not emulate expiry client-side or treat session expiry as grant expiry. Unknown role/capability, missing/empty/revoked grant, invalid/expired session, missing/invalid MFA, unsupported operation and pending policy all deny.
- **Audit:** current implementation includes append-only event support for selected reads/mutations, but complete persisted application-event coverage is not proven. Any future operation requires correctly attributed outcome, actor/role, scope, target, time, reason/correlation and relevant before/after in a durable event; mutation and success audit must commit/roll back together. A denial must never create a misleading success record. Decide sensitive-read audit, denial-event policy, retention, redaction and export.
- **Revocation/emergency:** self-session revocation increments `sessionVersion`; a separate grant revocation is checked on requests if policy is enabled. Define required revocation latency and emergency-access handling. No break-glass path or bootstrap bypass exists; do not add one without a separate decision.
- **Unsupported/high-impact operations:** agent management, communications recovery, provider configuration, user/grant administration, other-user session revocation, refunds, payout, commission adjustment and financial mutation remain denied and unimplemented.


## Cross-cutting data and security decisions

### Tenant/resource boundaries

- Business, subscription and payment records have business associations and can be tenant-filtered in source. Commission records are filtered through their payment/business relation where present.
- Agent application/referral, notification delivery, provider and system-health sources do not all carry a safe tenant key. Current implementation returns them unavailable or requires a platform-wide scope; the owner must decide whether such access is necessary and how it is constrained.
- Specify treatment of null/unassociated businesses, merged/closed tenants, shared agents, cross-tenant incidents, cursors, search and aggregates. Do not make implicit global grants or use IDs from a different tenant.
- Session claims or the application’s ordinary `CUSTOMER`/`ADMIN` role never grant Control capabilities. Authorization must remain exact-key, current-grant, server-side and resource-scoped for each request.

### Sensitive and destructive actions

- Every possible read of identity/PII, payment details, financial records, audit metadata, provider/system configuration and cross-tenant aggregates requires an explicit field/scope decision.
- The only current business mutation is suspend/reinstate. Define its effects and guardrails before enabling either action. Current source requires same-origin, exact confirmation, a 12–500 character reason, a scoped live grant, status preconditions, rate limit and a transaction with audit. This is an implementation description, not an owner approval of the operation.
- Refunds, payment changes, commission policy, accruals, reconciliation decisions, adjustments, payout eligibility, payouts, communications replay, provider changes and other-user session revocation are **not authorized** and have no current Control operation.
- Sensitive read audit requirements need a decision. Current record-list reads write `CONTROL_RECORDS_READ` events, but this does not prove every sensitive read is logged, nor define audit-view access or retention.

### Audit requirements to approve

For any enabled sensitive operation, require immutable application-generated records that preserve at minimum actor ID and role, tenant/resource scope, action, target, database timestamp, result/outcome, reason where applicable, before/after state where relevant, and request correlation ID. Define which reads are audited, allowed metadata, personal-data minimization, retention, who can view/export/review records, and how corrections are handled without mutation/deletion. Failed operations must not be represented as successful; if a mutation and audit share a transaction, both must commit or roll back. Current database trigger tests establish only database-level append-only resistance; application-generated persisted events remain to be verified.

### Authentication, MFA and session/revocation decisions

Existing technical behavior identified in source (not policy approval):

- Ordinary session JWTs expire after 7 days; `getSession` checks current user existence, unchanged base role and database `sessionVersion`. A mismatch, deleted user or verification/store error fails closed.
- The separate Control MFA implementation uses encrypted TOTP secrets, six-digit 30-second codes with adjacent-step allowance and replay prevention, a 15-minute MFA token bound to user ID and session version, rate limits and a 15-minute lock after five failed codes. Authenticated protected routes currently do not reach this logic while the owner-policy gate is false.
- Current self-revocation increments `sessionVersion` and clears both session and MFA cookies. The MFA token is rejected after expiry, account mismatch or session-version change.

Owner decisions still required: whether these lifetimes and methods are acceptable per role/action; when fresh MFA is needed; approved authenticator types; recovery, lost-device and lockout support; user and grant revocation latency; whether role/grant change must terminate every active session; and an emergency-access policy. Do not build a bypass or privileged bootstrap account. If emergency access is authorized later, require named approvers, short expiry, monitoring, immutable audit and tested revocation.

## Safe six-role acceptance plan — gated on owner approval

This is a **future test specification**. The owner has separately authorized one temporary synthetic ordinary `User` solely inside the isolated disposable PostgreSQL database for PR #78 CI; it receives no Control grant, role assignment or permission and is discarded with the database. This narrow test-fixture authorization does not authorize any positive permission or operational identity. Any future positive-role test still requires separate authorization for the exact role, grant, scope and fixture.

For the current deny-path journey, use only a disposable database and an isolated synthetic ordinary session with no Control grant; verify `/control`, protected APIs and mutations return an explicit denial, do not mutate fixtures and do not emit success audit events. For future positive acceptance (only after explicit role decisions), use synthetic businesses `tenant-a` and `tenant-b`, synthetic records, and one isolated test identity per approved role. Provision only exact approved grant keys/scopes through the approved mechanism; record no production credentials or PII. Test:

1. Anonymous page and API access; ordinary customer/admin session; sign-in, logout and session expiry.
2. The signed-off allowed route/action list and a direct URL/API call for every denied capability; forged JWT role claims must not grant access.
3. Same-tenant, other-tenant, null-scope, unassociated-record, cursor and cross-tenant audit behavior exactly as approved.
4. Missing, expired, wrong-user, replayed and stale-session-version MFA tokens; failed-code rate limit and lockout; grant revocation during a request; role/grant/session-version changes.
5. CSRF/origin, invalid input, missing confirmation/reason, destructive-action confirmation, permission-denied, loading, empty, success and failure states.
6. Actual application operation → persisted audit record with actor/tenant/action/target/time/outcome/correlation and required before/after data; test failure and rollback do not leave a false success; update/delete attempts fail; migration rollback/reapply preserves expected integrity.
7. Capture a real authenticated session and route trace at each required Control viewport. Independently inspect screenshots and keyboard/focus/accessibility behavior. Keep fixture data visibly synthetic and never label it live.

Acceptance evidence must identify test commit/source SHA, fixture schema identity, role and approved grant scope (without secrets), exact route/action, expected and observed response, persisted audit row IDs/payload (sanitized), and screenshot/trace artifacts. Test cleanup must remove the disposable schema and revoke/delete fixture identities only through the approved test process.

## Owner response record

The owner decision on 2026-11-01 records DENY for all 90 current cells. For any future request to change a cell to ALLOW, provide a separate owner decision record for that exact role and capability with:

- `Decision ID`, approver identity/authority, date and scope of approval.
- Role purpose: confirm/rewrite/reject the tentative description.
- Capability: `ALLOW` or `DENY`; exact route/action; field-level data list; tenant/resource scope; null-scope rule.
- Preconditions, reason/confirmation, rate limits, dual approval and separation of duties.
- MFA/session freshness, expiry, revocation, recovery and emergency-access requirements.
- Audit event/read policy, retention, viewer/export access and personal-data handling.
- Non-production provisioning authority and isolated test procedure.

The all-DENY policy is owner-approved and `CONTROL_ROLE_POLICY_APPROVED` is true. `CONTROL_ROLE_ACCESS_ENABLED` remains false, all 90 capabilities remain denied, protected Control routes return `POLICY_PENDING`, and no positive or six-role authenticated acceptance is claimed. Approval of these denials does not waive the remaining acceptance evidence.


## Owner authorization update — 2026-11-07

GITANYA KARIUKI has now expressly authorized the platform to select and implement the role decisions it deems suitable in the platform owner's interest, and to proceed with Control role access. This supersedes the 2026-11-01 all-DENY operational policy. The implementation selects only narrowly scoped read capabilities; all write, approval, financial mutation, provider configuration, identity/grant administration, and emergency access remain denied.

The exact effective matrix is documented in CONTROL_ROLE_ACTION_MATRIX.md and implemented in lib/control/role-policy.ts. The independent runtime gate is enabled, but no grant is automatically created. The grant table must still contain an active exact-key grant, the tenant-keyed operation must have an explicit business scope, and each protected request must pass current-session, live-grant and MFA checks. No owner identity or production grant was provisioned.

This does not retroactively authorize or mutate existing accounts, businesses, payments, commission balances or provider configuration. Positive browser, MFA recovery, expiry, database audit and six-viewport acceptance remain evidence requirements.
