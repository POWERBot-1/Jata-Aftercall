# Product lifecycle execution persistence

## Scope
This module persists lifecycle work and its execution evidence. It is not an entitlement engine and must not be wired to customer-access mutations without a separately reviewed owner decision.

## Persistence contract
- Runs are idempotently created by caller-supplied unique run keys.
- Task enqueue uses the SHA-256 lifecycle identity key and PostgreSQL duplicate skipping.
- Task claims are bounded to 100 rows, check run status without locking the run row, use ordered `FOR UPDATE SKIP LOCKED`, and assign a unique UUID lease token per row. Independent workers can therefore claim disjoint tasks from the same run.
- Enqueue and finalization lock the run row to serialize task insertion against completion; claiming does not take that run-level lock.
- Expired claims can be reclaimed. Attempts at or above the configured cap are moved to `DEAD_LETTER` with an event.
- Completion, failure/retry and manual-review transitions require the current lease token and an unexpired lease. Task update and event insertion share one database transaction.
- Events remain append-only under the migration trigger.
- Payloads and run metadata are bounded JSON; task errors are constrained to reason codes rather than raw exception text.

## Operational restrictions
- Do not register a scheduler or expose a worker route from this module.
- Do not run a PLAN-mode worker in production.
- Do not update Subscription, Payment, product entitlement or customer-access records.
- Do not send notifications, invoke Paystack/Telnyx, refund, payout or post accounting entries.
- Apply the additive migration only after separate database backup/restore, Prisma validation, migration rehearsal and owner approval.

## Required validation before any runtime activation
1. Prisma schema validation and client generation against the candidate schema.
2. Unit tests and PostgreSQL integration tests against a disposable PostgreSQL instance. The lifecycle integration suite verifies SKIP LOCKED behavior under a held row lock, stale-token fencing after lease reclamation, and append-only event enforcement. Its synthetic event fixtures are intentionally retained because the ledger rejects DELETE.
3. Concurrent claim test proving no duplicate claim under parallel transactions.
4. Stale-token, expired-lease, retry/dead-letter and append-only trigger tests.
5. Exact-head CI green, plus reconciliation of all repository-wide release blockers.
6. Separate authorization for migration, worker route, scheduler and any future customer-access policy.
