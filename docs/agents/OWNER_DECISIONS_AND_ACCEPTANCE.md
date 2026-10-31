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
| Outbox and provider callbacks | `lib/agents/admin-notification-{event,claims}.ts`, notification operations route, `lib/messaging/meta-whatsapp-webhook.ts` and related tests | **BLOCKED**: enqueue/claims and OTP webhook foundations exist; operational notification worker, provider correlation, controlled replay and full delivery recovery do not |
| Agent journey and hierarchy authorization | Agent/referral/admin routes, `tests/prisma/agent-applications-postgres.test.ts`, agent security tests | **NOT TESTED** as a connected journey: no complete payment, commission, report and notification E2E or comprehensive hierarchy authorization |
| Native migrations and recovery | Candidate migration, Release Validation, POS/ERP workflows | **BLOCKED** for release: native CI checks ran on the starting head, but local native download fails TLS and a production-safe agent-specific rollback/forward-recovery plan is unverified |
| Six-viewport actual journey inspection | Premium Screenshots workflow and `docs/agents/evidence/` | **NOT TESTED**: earlier screenshots cover limited synthetic views; final connected agent/admin journey images were not independently inspected |
| Meta WhatsApp | `lib/messaging/meta-whatsapp*.ts`, Meta unit/webhook tests | **BLOCKED** for live: account, template, webhook, recipient and explicit controlled-test approval not established; mocks are not live evidence |

The five workflows on the starting head completed successfully: Candidate `41194093735`, Release `41194093774`, POS/ERP `41194093720`, Interactive `41194093707` and Premium `41194093785`. These results do not prove the missing agent-specific journey, provider acceptance or independent screenshot inspection.
