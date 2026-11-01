# `/control` owner decision package

**Purpose:** obtain explicit owner decisions for the proposed six-role control plane before any role/action policy, privileged test identity or grant is enabled. This is a review worksheet, **not an authorization, approval, role description, provisioning instruction or evidence of acceptance**.

**Repository / PR:** `POWERBot-1/Jata-Aftercall`, PR #78, branch `arena/115a62e1-jata-aftercall`  
**Application-code source reviewed:** `d842777bc3e4a3cd15a9f8dec0c15a1210a1764c`  
**Documentation head at preparation:** `1842c60ab14e70ac0775d1827bc2092bb9c6e0d2`  
**Runtime policy:** `CONTROL_ROLE_POLICY_APPROVED = false`. Protected Control routes remain fail-closed. This document does not change that constant or any route, permission, database record, identity, session or grant.

## Decision protocol

For every proposed role × capability cell, the owner must explicitly choose **ALLOW** or **DENY**, identify the applicable tenant/resource scope, define the data fields/actions, and authorize the safe test/provisioning method. A blank, ambiguous or partial decision means **OWNER DECISION REQUIRED; deny by default**. Approval of a role name or role purpose alone grants no permission.

Even a written ALLOW does not activate an operation. The implementation must be reviewed, the role-policy constant must only be changed under a separate explicit implementation authorization, and the exact approved mapping must be enforced and tested server-side before that capability is usable. Unsupported operations stay denied until implemented and independently verified.

### Decisions required before any authenticated six-role test

1. Confirm or replace each role’s purpose below; distinguish responsibilities rather than assuming the names define them.
2. Decide each of the 15 explicit capability keys for each role: ALLOW or DENY. For every ALLOW specify tenant/resource scope, field-level visibility, conditions and whether platform-wide/null scope is prohibited or requires dual approval.
3. Approve or reject the current candidate operations and list business side effects. In particular, define exactly what suspension/reinstatement changes and what it must not change.
4. Decide whether status-only payment/subscription data, agent/referral counts, commission-ledger metadata, communications state, audit records, system health, identities or any personal data may be seen. Specify minimum necessary fields, redaction and retention.
5. Define MFA enrollment, authenticator/freshness requirements, lockout, recovery, lost-device handling, session lifetime and reauthentication for sensitive actions. Existing TOTP implementation is a technical capability, not an approved policy.
6. Name the non-production test-identity/grant approver and custodian; specify test tenant fixtures, creation/deletion, grant expiry/revocation, evidence handling, and separation from production. Until this is approved, do not create role identities or grants, even in an ad hoc test environment.
7. Define emergency access and recovery, if any: trigger, named approvers, dual control, duration, least privilege, alerting, audit, revocation and post-incident review. There is no current break-glass route or bootstrap bypass.
8. Decide audit-read permissions and sensitive-read auditing separately from mutation auditing; define retention, legal/privacy limits, export and review procedure.

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

### Capability decision sheet

All cells are currently **OWNER DECISION REQUIRED**. The values below are deliberately not ALLOW defaults. For each cell, replace only after owner review with `ALLOW` or `DENY`, and add a reference to the written decision, data scope and any conditions. This worksheet itself must not be used to provision grants.

| Explicit capability key | SUPER_ADMIN | PLATFORM_ADMIN | FINANCE_ADMIN | SUPPORT_ADMIN | SECURITY_ADMIN | READ_ONLY_AUDITOR |
|---|---|---|---|---|---|---|
| `businesses.read` | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED |
| `businesses.suspend` | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED |
| `businesses.reinstate` | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED |
| `subscriptions.read` | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED |
| `payments.read` | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED |
| `agents.read` | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED |
| `agents.manage` | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED |
| `commissions.read` | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED |
| `communications.read` | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED |
| `communications.recover` | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED |
| `providers.read` | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED |
| `providers.configure` | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED |
| `audit.read` | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED |
| `exceptions.read` | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED |
| `system.health.read` | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED | OWNER DECISION REQUIRED |

**Explicit deny-until-authorized boundary:** there are no role defaults. Capability keys without a route remain unavailable even if the owner elects a desired future policy; implementation and verification are prerequisites. Never infer platform-wide scope from `scopeBusinessId = null`; it requires an explicit, reviewed grant after approved policy and provisioning.

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

This is a **test specification only**. Do not create these identities, sessions or grants until the owner approves the role/action mapping and an isolated provisioning method.

After authorization, use a disposable/non-production database with synthetic businesses `tenant-a` and `tenant-b`, synthetic records, and one isolated test identity per approved role. Provision only the exact approved grant keys and scopes through the approved mechanism; record no production credentials or PII. For every role, test:

1. Anonymous page and API access; ordinary customer/admin session; sign-in, logout and session expiry.
2. The signed-off allowed route/action list and a direct URL/API call for every denied capability; forged JWT role claims must not grant access.
3. Same-tenant, other-tenant, null-scope, unassociated-record, cursor and cross-tenant audit behavior exactly as approved.
4. Missing, expired, wrong-user, replayed and stale-session-version MFA tokens; failed-code rate limit and lockout; grant revocation during a request; role/grant/session-version changes.
5. CSRF/origin, invalid input, missing confirmation/reason, destructive-action confirmation, permission-denied, loading, empty, success and failure states.
6. Actual application operation → persisted audit record with actor/tenant/action/target/time/outcome/correlation and required before/after data; test failure and rollback do not leave a false success; update/delete attempts fail; migration rollback/reapply preserves expected integrity.
7. Capture a real authenticated session and route trace at each required Control viewport. Independently inspect screenshots and keyboard/focus/accessibility behavior. Keep fixture data visibly synthetic and never label it live.

Acceptance evidence must identify test commit/source SHA, fixture schema identity, role and approved grant scope (without secrets), exact route/action, expected and observed response, persisted audit row IDs/payload (sanitized), and screenshot/trace artifacts. Test cleanup must remove the disposable schema and revoke/delete fixture identities only through the approved test process.

## Owner response record

Please return one decision record per role and capability with:

- `Decision ID`, approver identity/authority, date and scope of approval.
- Role purpose: confirm/rewrite/reject the tentative description.
- Capability: `ALLOW` or `DENY`; exact route/action; field-level data list; tenant/resource scope; null-scope rule.
- Preconditions, reason/confirmation, rate limits, dual approval and separation of duties.
- MFA/session freshness, expiry, revocation, recovery and emergency-access requirements.
- Audit event/read policy, retention, viewer/export access and personal-data handling.
- Non-production provisioning authority and isolated test procedure.

Until an owner decision is recorded, preserve the current status: all role/action permissions remain pending/denied, all protected Control routes remain blocked by `POLICY_PENDING`, and no authenticated six-role acceptance is claimed.
