# Product lifecycle execution ledger — contract

## Purpose and authority boundary

The ledger supplies durable evidence and concurrency primitives for future lifecycle work. Persisting a task, claiming a task, retrying a task, or completing an observation task does **not** authorize subscription suspension, entitlement revocation, billing changes, customer notification, or provider calls.

The current observer remains read-only and disabled by default. No worker or cron schedule is registered by this phase.

## Durable records

- `ProductLifecycleExecutionRun`: one bounded invocation, with stable run key, mode, status, cursor, summary and lease metadata.
- `ProductLifecycleExecutionTask`: one product/business/subscription transition candidate, uniquely keyed by a SHA-256 idempotency key.
- `ProductLifecycleExecutionEvent`: append-only state-transition evidence, protected against UPDATE and DELETE by a PostgreSQL trigger.

The additive migration creates no customer rows and does not alter existing subscription, payment or entitlement tables.

## Candidate policy

- `EXPIRED`: eligible for an expiry-review work item only when the existing observer has an explicit expiry and grace deadline and reports the deadline elapsed.
- `GRACE_POLICY_UNKNOWN` and `INVALID_GRACE_WINDOW`: manual review only.
- `CURRENT`, `GRACE`, `INACTIVE` and `NO_EXPIRY`: no expiry task.

This is a conservative candidate classification, not a decision to remove access.

## Task state machine

`READY → CLAIMED → COMPLETED`

`CLAIMED → RETRY → CLAIMED`

`CLAIMED → DEAD_LETTER` or `MANUAL_REVIEW`

Claims require a non-empty fencing token and a lease of at most 15 minutes. Expired leases can be reclaimed. Completion/failure/review transitions require the current lease token and an unexpired lease. Retries use exponential backoff starting at 30 seconds and capped at one hour; the attempt cap is bounded at 20 even if a caller supplies a larger value.

## Required implementation before worker activation

1. Add transaction-backed enqueue with unique-key conflict handling.
2. Implement PostgreSQL `FOR UPDATE SKIP LOCKED` batch claims and lease-token fencing.
3. Persist task state and append-only event rows in one transaction.
4. Add isolated PostgreSQL tests for concurrent claims, duplicate enqueue, lease expiry, stale-worker fencing, crash recovery and event immutability.
5. Verify Prisma schema/migration on a disposable database with the exact locked Prisma version.
6. Approve product-specific grace, cancellation, suspension, restoration and customer-notice policies.
7. Obtain separate owner authorization before adding any mutation-capable worker, scheduler registration, or production flag.

## Current status

Schema, additive migration, pure transition contract and unit tests are authored. Runtime persistence/claim adapter, PostgreSQL concurrency verification, Prisma validation, and production inventory are not yet validated. No migration has been applied to production.
