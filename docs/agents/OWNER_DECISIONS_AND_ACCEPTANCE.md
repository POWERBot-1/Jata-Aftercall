# Agent programme: owner decisions and acceptance matrix

Status: **ACCEPTANCE BLOCKED — DO NOT MERGE OR DEPLOY**. No entries below are approved policy. This record distinguishes business decisions from work engineering can continue without them. The repository is JATA AFTERCALL only.

## Owner decisions required before financial activation

| Decision | Owner input required | Current restriction |
|---|---|---|
| Rates and basis | Fixed/percentage rates, eligible amount, gross or net, taxes, discounts and rounding | No default rate or payable posting; evaluator fixtures are hypothetical |
| Earning and payment | Qualifying verified events, agent eligibility at the event, recurrence and earning versus payable timing | No verified event-to-ledger writer or payouts |
| Refunds and chargebacks | Full/partial reversal basis, timing, chargeback treatment and dispute resolution | Ledger storage primitives are not an integrated refund lifecycle |
| Caps, holds and thresholds | Caps, holding periods, thresholds, settlement and payout methods/timing | No approved values and no real payout activation |
| Attribution | Precedence/conflicts, attribution windows, consent, correction and expiration | Consented registration/application evidence only; no authoritative sale attribution |
| Hierarchy | Whether recruitment is enabled, permissible relationships, subordinate scope and any compensation | No default multilevel compensation or hierarchy entitlement |
| Retention and privacy | Evidence, audit, personal-data retention, deletion/legal hold and recovery | Restrictive foreign keys and immutability guards require an approved deletion/recovery design |
| Privileged operations | Administrative authority, dual review, emergency access, adjustment and audit requirements | Admin audit foundations exist; exceptional financial adjustments are not implemented |

The owner's approval of policy is distinct from approval to enable a provider, use a real recipient, merge, migrate or deploy. No live activation is authorized by this record.

## Requirement-to-code-to-test matrix (starting head `44a13dfb7b8d091861a0a6b46e6487254ebe5bab`)

| Requirement | Code / existing evidence | Acceptance status and gap |
|---|---|---|
| Paystack transaction verification and signature | `app/api/paystack/verify/route.ts`, `app/api/paystack/webhook/route.ts`, `lib/paymentVerification.ts` | **BLOCKED** for programme: verified settlement ingestion/attribution and a connected commission writer are absent; existing payment paths are not full commission E2E |
| Immutable commissions, partial/full reversals and reconciliation | `prisma/migrations/20261111000000_agent_commission_ledger`, `lib/agents/commission-{calculation,reconciliation}.ts`, `tests/prisma/agent-commission-ledger-postgres.test.ts` | **BLOCKED**: storage and hypothetical/read-only evaluators do not establish policy-approved posting, provider reconciliation or audited adjustments |
| Historical Nairobi reports and late data | `lib/agents/report-periods.ts`, report routes and `tests/prisma/agent-report-versions-postgres.test.ts` | **BLOCKED**: referral evidence only; historical eligibility, late financial events, automatic detection and over-5,000 bounded complete reports absent |
| Scheduler | `lib/agents/referral-report-scheduler*.ts`, cron route, scheduler PostgreSQL/security tests | **BLOCKED**: disabled hook, bounded pages, concurrency and stale-run fencing exist; retry exhaustion, retention and complete historical reporting are absent |
| Outbox and provider callbacks | `lib/agents/admin-notification-{event,claims}.ts`, notification operations route, `lib/messaging/meta-whatsapp-webhook.ts` and related tests | **BLOCKED**: enqueue/claims and a default-off worker with correlated callback event history now exist; controlled replay, audited operator recovery, complete status semantics and approved live provider integration remain incomplete |
| Agent journey and hierarchy authorization | Agent/referral/admin routes, `tests/prisma/agent-applications-postgres.test.ts`, agent security tests | **NOT TESTED** as a connected journey: no complete payment, commission, report and notification E2E or comprehensive hierarchy authorization |
| Native migrations and recovery | Candidate migration, Release Validation, POS/ERP workflows | **BLOCKED** for release: native CI checks ran on the starting head, but local native download fails TLS and a production-safe agent-specific rollback/forward-recovery plan is unverified |
| Six-viewport actual journey inspection | Premium Screenshots workflow and `docs/agents/evidence/` | **NOT TESTED**: earlier screenshots cover limited synthetic views; final connected agent/admin journey images were not independently inspected |
| Meta WhatsApp | `lib/messaging/meta-whatsapp*.ts`, Meta unit/webhook tests | **BLOCKED** for live: account, template, webhook, recipient and explicit controlled-test approval not established; mocks are not live evidence |

The five workflows on the starting head completed successfully: Candidate `41194093735`, Release `41194093774`, POS/ERP `41194093720`, Interactive `41194093707` and Premium `41194093785`. These results do not prove the missing agent-specific journey, provider acceptance or independent screenshot inspection.

## Control-plane owner decisions required before provisioning or broad acceptance

This section records unresolved authorization policy; the capability strings and fallback behavior in the implementation are not an approved role/action matrix.

| Decision | Clarification required | Safe current boundary |
|---|---|---|
| Six-role action matrix | For each canonical role (`SUPER_ADMIN`, `PLATFORM_ADMIN`, `FINANCE_ADMIN`, `SUPPORT_ADMIN`, `SECURITY_ADMIN`, `READ_ONLY_AUDITOR`), approve exact module/action capabilities and deny defaults. In particular clarify tenant, identity/PII, payment, support, configuration, communications-recovery and audit visibility. | Database grants store exact capability keys; no role name implies a permission; no grant is seeded. No provisioning UI or public registration path exists. |
| Scope and platform-wide authority | Confirm whether each permission is tenant-scoped, platform-wide, or both; whether null scope requires additional approval/dual control; define treatment for payments without a business ID and cross-tenant incidents. | Tenant-keyed business, subscription, payment, ledger and audit reads filter to explicit business IDs. Unkeyed/global sources are unavailable to scoped grants. |
| MFA requirement and freshness | Identify which roles/actions require MFA, allowed authenticator/recovery mechanisms, re-verification interval, lockout/support procedure, and whether all control reads may be gated. | TOTP support is implemented; the current candidate gates all protected control reads/actions on a short-lived MFA session as a fail-closed provisional choice, not an owner-approved policy. Existing/enrolled credential recovery is deliberately unavailable without a reviewed process. |
| Initial grant and grant administration | Name the authorized grant provisioner and review/approval path; determine whether grants require two-person approval, maximum duration, revocation reason, and a tested recovery route. | The migration creates no privileged grants. No endpoint or UI can create/modify a grant. Only a separately controlled reviewed database process can provision one until owner-approved governance exists. |
| Session revocation scope | Confirm whether a control operator may revoke only their own sessions or other users' sessions, whether self-revocation should revoke all devices, and what incident-response workflow is required. | Implemented action revokes all sessions for the authenticated actor's own account, increments the existing durable session version, clears current cookies and writes an audit event. No ability to revoke another person's session. |
| Business suspension semantics | Confirm effects on publication, bookings, payments, subscriptions, agent/tenant relationships, notification and customer-facing messaging, and reinstatement preconditions. | Candidate changes only `Business.status` from its current allowed state to `SUSPENDED`, or from `SUSPENDED` to `ACTIVE`; it leaves publication and related records untouched, requires a reason/explicit confirmation, and audits the transition. This limited behavior requires owner review before production use. |
| Audit access and retention | Confirm who may view platform-wide versus tenant audit, treatment of actor identifiers and retention/legal-hold requirements, and whether sensitive reads must themselves be audited. | Audit rows are append-only via a PostgreSQL trigger; route filtering is scope-aware. No retention/deletion API or sensitive-read logging is included. |

No production admin account, role grant, migration, provider setting, message, payment, or user data was changed. Request owner clarification before enabling grants or asserting full role/action, MFA, bootstrap, suspension, or recovery acceptance.
