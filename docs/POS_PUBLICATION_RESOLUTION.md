# Paid POS publication-resolution policy (Option B)

**Candidate date:** 2026-10-23

**Status:** implementation candidate; not release authorization

**Scope:** Business POS only. No live payment, Safaricom, Neon recovery, deployment, or production-data action is authorized by this document.

## 1. Selected business behavior

The owner-selected Option B separates **money/entitlement** from **publication**:

| Fact | Required behavior |
|---|---|
| Provider-verified POS payment succeeds | Preserve the `Payment` ledger row as `PAID`; activate/extend the POS subscription and entitlement idempotently. |
| Configuration publication succeeds in the same settlement transaction | Write the immutable snapshot/version, set configuration `LIVE` / `PUBLISHED`, and resolve any open publication case. |
| Publication is blocked | Preserve payment, subscription, entitlement, draft, and existing sales. Set `PAYMENT_CONFIRMED`; do **not** claim `LIVE`, do not increment `publishedVersion`, and do not write a partial snapshot. |
| Paid but unpublished | The existing entitlement guard continues to permit draft-backed POS selling. `ready` and the `LIVE` label still require a real published snapshot. |
| Owner later publishes or rolls back successfully | Resolve the case only after the snapshot write succeeds. Resolution retries are idempotent. |

`configurationStatus` remains `READY` for a valid draft whose publication is blocked by legacy inline media, and `INCOMPLETE` for a draft with validation errors. The reason a payment is valid but publication is not complete is exposed as a blocker code/detail, not hidden behind a live-state label.

## 2. Authoritative confirmation time and the 72-hour deadline

A case has one row per POS `Payment` (`PosPublicationResolution.paymentId` is unique).

- **Fresh settlement:** the server captures `now` inside the verified settlement transaction and stores it as `confirmedAt` atomically with payment/subscription/entitlement/publication outcomes.
- **Duplicate callback/retry:** the existing payment CAS, subscription replay, processed-event, unique payment case, and notification idempotency key prevent a second entitlement/case/remedy. A retry does not move `confirmedAt` or `deadlineAt`.
- **Legacy PAID repair:** a verified Paystack `paid_at` is required and is passed explicitly as `providerConfirmedAt`. Missing or invalid evidence fails with `LEGACY_PAYMENT_CONFIRMATION_TIME_REQUIRED` before settlement writes.
- **Prohibited substitutes:** mutable `Payment.updatedAt`, row creation time, configuration timestamps, and subscription activation/renewal timestamps are not used as proof of the original payment-confirmation instant.

The deadline is exact instant arithmetic:

```text
deadlineAt = confirmedAt + 72 hours
```

JavaScript `Date` epoch arithmetic is timezone-independent; ISO presentation is UTC. For example, `2026-10-23T08:00:00+03:00` is `2026-10-23T05:00:00Z`, so its deadline is `2026-10-26T05:00:00Z`. A case is not escalated one millisecond before the deadline and is escalated **at** the deadline. A resolved case never becomes escalated later.

## 3. Blockers, notifications, entitlement observation, and remedies

`lib/pos/publication-policy.ts` records:

- payment/business/configuration references and a safe blocker code/detail;
- confirmation/deadline/escalation/resolution instants;
- `OPEN`, `ESCALATED`, or `RESOLVED` case state;
- `PENDING_PUBLICATION`, `OWNER_ESCALATED`, or `PUBLISHED` remedy state;
- an observational entitlement status refreshed during reconciliation;
- deterministic owner, escalation, and resolution `PaymentNotification` keys.

Notifications are scoped by business and use `POS` / `IN_APP` delivery. The owner message is scheduled at confirmation, the escalation message at the deadline, and the resolution message only after publication. Resolving before the deadline preserves but cancels a still-pending escalation as `SKIPPED` / “no longer required”; sent or failed history is not rewritten. Existing notification-delivery code records `SENT` for this in-app channel; unconfigured external channels are `SKIPPED`. `SENT` does not mean the owner read the message.

Reconciliation is invoked from authorized POS workspace reads and processes only the bounded `pos:publication-policy:` notification prefix. It does not flush unrelated payment, email, or SMS queues. Conditional updates ensure only one reconciliation pass records each escalation/resolution audit event.

## 4. Explicit operational limits — not silently implemented

The following remain open and must not be inferred from the code:

1. **No scheduler is configured.** Deadline state is derived correctly when an authorized reconciliation/read occurs, and due in-app messages are delivered then. There is no evidence of an unattended job running exactly at 72 hours. If the business requires guaranteed unattended escalation, a separately reviewed scheduler/support integration and non-production evidence are required.
2. **No external support ticket exists.** `OWNER_ESCALATED` is an internal owner-facing record, not a support-provider ticket or a promise of human response.
3. **No automatic M-PESA/Paystack refund, reversal, fee, service credit, authorization limit, or customer compensation is invented.** Refund and customer-remedy policy remains a separate owner/business decision. Escalation does not suspend a valid entitlement or alter the PAID ledger row.
4. **Legacy PAID rows without verified `paid_at` cannot receive a fabricated deadline.** Their repair is blocked until authoritative provider evidence is available; an operational recovery/backfill policy is still required. Pre-policy PAID rows already marked `LIVE` with `publishedVersion = 0` likewise need an approved inventory/repair path; the additive migration deliberately backfills none. Server derivation will not treat zero published versions as proof of publication.
5. **Publication remains blocked by legacy inline-media persistence rules.** The policy does not rewrite/delete legacy media, select a durable storage provider, or authorize a backfill.
6. **Neon and live-provider evidence is separate.** Disposable PostgreSQL cannot satisfy Neon R2/R3/R5. Safaricom approval, live Daraja processing, live payment round-trips, and customer onboarding remain blocked/not tested.

## 5. Why the third additive migration is necessary

`prisma/migrations/20261023000000_pos_publication_resolution/migration.sql` adds one table, indexes, and foreign keys only. Durable per-payment confirmation/deadline/case state cannot be reconstructed safely from mutable payment or subscription timestamps. The payment FK uses `ON DELETE RESTRICT`; business deletion cascades its owned policy cases. No existing table/column is altered and no historical row is rewritten.

The reconciled candidate therefore has **19 migration directories** (16 from the starting `main`, plus media version, password recovery, and this policy table). Candidate D2 derives the expected count from the exact checked-out candidate rather than hardcoding 18. Pull-request rehearsals bind to `github.event.pull_request.head.sha`; manual rehearsals require an explicit full SHA. Neither defaults to original PR #49.

## 6. Validation map

- `tests/integration/pos-publication-policy.test.ts`: blocked publication, payment/entitlement preservation, duplicate callbacks/remedies, exact deadline, delayed in-app delivery, escalation/reconciliation, entitlement observation, failed/successful publication retry, and resolution idempotency (in-memory behavioral evidence).
- `tests/prisma/pos-publication-policy.test.ts`: the same settlement/publication policy against real PostgreSQL through Prisma, including concurrent settlement, one case/entitlement, exact deadline escalation, legacy `paid_at` refusal/use, and failed-then-successful publication. Native CI uses the pinned engine; an optional offline harness must be labeled `wasm-query-engine+adapter-pg` and is not native-engine evidence.
- `tests/unit/pos-entitlement.test.ts`: lifecycle derivation and fresh/legacy settlement timestamp rules.
- `scripts/test-local-postgres-migrations.mjs`: guarded loopback-only synthetic SQL checks, including concurrent case upsert and exact escalation boundary.
- `scripts/ci/rehearse-candidate-migrations.mjs` and `.github/workflows/candidate-rehearsal.yml`: exact-SHA full-history PostgreSQL 18 rehearsal, object/ledger/drift/failure controls, candidate tests, production build, and audits.

A green in-memory suite is not PostgreSQL evidence; disposable PostgreSQL is not Neon evidence; neither is live-payment or release approval.
