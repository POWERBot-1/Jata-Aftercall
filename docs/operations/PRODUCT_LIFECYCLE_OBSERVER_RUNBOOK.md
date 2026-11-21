# Product lifecycle observer — operator runbook

## Current operating mode

This endpoint is a **read-only observer**, not an expiry worker. It does not change subscription state, entitlement state, product configuration, customer access, payment records, or audit history. It must not be described as a lifecycle enforcement or remediation job.

No Vercel cron registration is included in this change. Production execution remains disabled until the owner approves an operating policy and an operator provisions the two environment variables below.

## Fail-closed configuration

The route returns 503 unless both conditions are met:

- `PRODUCT_LIFECYCLE_OBSERVER_ENABLED=true`
- `PRODUCT_LIFECYCLE_OBSERVER_SECRET` contains a 32–512 byte secret

Do not commit the secret or paste it into tickets/chat. Keep the feature flag unset/false in every environment until explicitly approved.

## Bounded invocation

Authenticated `GET /api/cron/product-lifecycle-observer` accepts:

- `limit`: integer 1–100; default 50 rows per subscription table
- `cursor`: optional opaque base64url JSON cursor returned by the previous page

Each call reads at most `limit + 1` rows from each of the five subscription tables using stable `id` keyset pagination. Continue with the returned `nextCursor` until `complete=true`. A cursor is a continuation token, not an authorization token; every request still requires the bearer secret.

The response contains aggregate counts only. Individual business IDs, subscription IDs and observation rows are not returned by the HTTP route. Responses use `Cache-Control: private, no-store`.

## Interpreting results

- `CURRENT`: recorded subscription period has not elapsed.
- `GRACE`: an explicit stored `graceUntil` remains in the future.
- `EXPIRED`: an explicit stored grace deadline has elapsed.
- `GRACE_POLICY_UNKNOWN`: subscription expiry elapsed without an explicit grace deadline.
- `INVALID_GRACE_WINDOW`: malformed or contradictory date evidence.
- `INACTIVE`: subscription is outside the active billing lifecycle.
- `NO_EXPIRY`: no expiry is stored.

Do not infer a grace duration from product name, plan duration, or another product's policy. Unknown and invalid rows require policy/evidence review.

## Release gates before any mutation-capable worker

1. Confirm product-by-product grace and cancellation policy against owner-approved commercial terms.
2. Reconcile the observer's product mapping with the live plan catalogue and schema.
3. Run exact-head typecheck, unit/security tests and isolated PostgreSQL pagination tests.
4. Establish a durable, idempotent run ledger and per-product claim/lease protocol before adding mutations.
5. Define audit requirements, rollback/forward-recovery, bounded batch limits and stale-lease recovery.
6. Obtain separate explicit authorization for production feature flags, scheduler registration, and any state-changing behavior.

Until every gate is satisfied, use the endpoint for controlled read-only observation only. No automated suspension, entitlement revocation, notification, payment retry or provider action is authorized by this implementation.
