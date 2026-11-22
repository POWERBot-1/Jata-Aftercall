# Lifecycle observer implementation gap audit

**Status:** READ-ONLY SOURCE AUDIT / CHANGES REQUIRED  
**Audited revision:** `76fb490576ad1a33cf732d22742c42c7f67980a2`  
**Source files:**  
- `app/api/cron/product-lifecycle-observer/route.ts`
- `lib/admin/product-expiry-grace-observation-store.ts`
- `lib/admin/product-expiry-grace-observation.ts`
- `lib/admin/product-lifecycle-execution-store.ts`
- `tests/security/product-lifecycle-observer-route.test.ts`
- `tests/integration/product-lifecycle-execution-postgres.test.ts`

This is a source-code review only. No endpoint was called, no database was queried, and no production configuration was read or changed.

## 1. Existing implementation confirmed

The candidate contains a cron-style GET endpoint at `/api/cron/product-lifecycle-observer`.

The endpoint:
- Returns 503 unless `PRODUCT_LIFECYCLE_OBSERVER_ENABLED === "true"`.
- Requires a configured bearer secret between 32 and 512 UTF-8 bytes and uses timing-safe comparison.
- Bounds page size to 1–100 and cursor input to 2,048 characters.
- Returns aggregate counts, an observation timestamp and opaque continuation cursor; it does not return individual observation rows.
- Labels the response `READ_ONLY_OBSERVATION` and `accessChanges: NONE`.
- Uses private no-store response caching and hides internal errors.

The underlying inventory store:
- Reads five source groups in parallel: shared `Subscription`, POS, Autopilot, MJENGO and ERP PRO.
- Uses per-table ID keyset pagination (`orderBy id asc`, `take limit + 1`, cursor + skip 1).
- Selects limited subscription fields and a plan key for shared subscriptions.
- Maps known shared plan keys to Business Page, Website Studio and AI Front Desk.
- Reads dedicated product tables for POS, Autopilot, MJENGO and ERP PRO.
- Calls a pure observation function and returns aggregate counts.

The execution ledger separately supports durable run/task persistence, idempotent enqueue, claims and lease fencing. The audited observer endpoint does not call that ledger or enqueue tasks.

## 2. Confirmed gaps against the producer contract

| Finding | Evidence | Consequence | Required disposition |
|---|---|---|---|
| No immutable run cutoff | Each inventory request invokes `loadProductExpiryGraceObservation` with a fresh default `new Date()`; continuation cursor carries only per-table IDs. | A multi-page scan does not represent one fixed observation time. | Add an explicit run-scoped `asOf` value and preserve it across all pages only after contract approval. |
| No source snapshot/high-water boundary | Pagination uses primary-key cursors without a captured high-water ID or database snapshot. | Concurrent inserts/updates/deletes can make a multi-page scan inconsistent; keyset pagination alone does not provide snapshot semantics. | Design and test a bounded consistency strategy before using scan output for lifecycle decisions. |
| Autopilot grace fallback not applied | Generic `observeSubscriptionExpiry` uses stored `graceUntil`, otherwise emits `GRACE_POLICY_UNKNOWN`; inventory projection does not select `cancelledAt` or plan-specific grace inputs. | Autopilot records with null stored grace may be classified differently from the existing Autopilot entitlement reader, which calculates a fallback grace period. | Do not use generic classification as Autopilot entitlement truth. Implement only after owner-approved policy parity and tests. |
| Cancellation evidence omitted | Dedicated-table projections select `id`, `businessId`, `status`, `expiresAt`, `graceUntil`; they omit `cancelledAt`. | Product-specific cancellation semantics cannot be represented by the current observation input. | Approve per-product cancellation precedence and expand minimal projection only as needed. |
| Team-free override not reconciled | The store scans paid subscription rows but does not select or classify team-free access. | Aggregate expiry counts describe subscription rows, not necessarily the effective access outcome for a business. | Keep outputs explicitly labelled subscription observations; define whether team-free override exclusion is required before any producer consumes them. |
| Unknown shared plan keys disappear from the result | Shared rows whose `PlanConfig.key` is not in the hard-coded allowlist are filtered out. | `total` and counts do not expose unmapped source rows, so `complete: true` means no more pages, not complete product classification. | Add an explicit unmapped-plan count or fail-closed diagnostic before claiming full product inventory. |
| Per-page aggregate counts are not run aggregates | Each call summarizes only the rows on that page; no durable run accumulator or scan identity is used by this endpoint. | Counts from the final page cannot be interpreted as totals for the entire scan. | Aggregate across a run with stable run identity and cutoff, or clearly label all counts as page-local. |
| Existing PostgreSQL integration tests do not test source inventory | `tests/integration/product-lifecycle-execution-postgres.test.ts` exercises ledger enqueue/claim/retry/fencing, not `loadProductExpiryGraceObservation` source pagination or product mapping. | Ledger acceptance is not producer/source-query acceptance. | Add isolated PostgreSQL tests for source query mapping, pagination, concurrency, tenant boundaries and replay. |

## 3. Important distinction: observer versus worker

The route is an authenticated observer, not an execution worker:
- It does not call `createLifecycleExecutionRun`.
- It does not call `enqueueLifecycleTasks`.
- It does not claim or complete tasks.
- It does not mutate subscriptions, entitlements, payments or customer access.
- It does not call external providers.

Therefore, the presence of this route does not establish that a lifecycle producer, worker, scheduler, or business-side-effect path is implemented. The route is nevertheless a real read-only inventory surface and must be included in lifecycle security and operational review.

## 4. Required tests before source changes

Add a dedicated PostgreSQL integration suite against disposable PostgreSQL and real Prisma delegates:

1. Shared subscription plan-key mapping for all supported product keys, plus explicit unmapped-key accounting.
2. Dedicated source-table mapping for POS, Autopilot, MJENGO and ERP PRO.
3. Page boundary correctness with more than one page per source table.
4. Inserts, updates, deletes and renewals between pages, proving the selected cutoff/high-water semantics.
5. Same `asOf` timestamp preserved across resumed pages.
6. Autopilot fallback grace parity with the existing entitlement policy, after policy approval.
7. Cancellation and suspended-state precedence per product, after policy approval.
8. Team-free override classification, without inventing subscription records.
9. Tenant-scoped source joins and no cross-business leakage.
10. Unknown plan keys visible as unmapped rather than silently disappearing.
11. Per-page versus whole-run aggregate semantics are explicit and tested.
12. No write queries or ledger enqueue calls occur during observation.

Mocked route tests remain useful for HTTP authorization and input validation but do not satisfy these database tests.

## 5. Current evidence status

- **PASS:** source inspection confirms an authenticated, disabled-by-default, aggregate-only observer route and separate lifecycle ledger.
- **PASS:** source inspection confirms five independently keyset-paginated source groups and limited projections.
- **FAIL:** the current observer output is not a fixed-cutoff, snapshot-consistent, whole-run product inventory.
- **BLOCKED:** product-specific cancellation/grace policy and team-free precedence require approved contracts.
- **NOT TESTED:** live database contents, real PostgreSQL observer pagination, tenant isolation for the observer, concurrent source mutation, or production endpoint configuration.
- **PROHIBITED:** enabling the endpoint, setting production secrets/flags, enqueueing work, activating a worker/scheduler, changing entitlements/subscriptions/payments/access, or deploying.

## 6. Recommended implementation order

1. Approve product-specific grace, cancellation, status and team-free rules.
2. Choose and document a fixed-cutoff/high-water consistency model.
3. Add unmapped-plan accounting and make page-versus-run aggregate semantics explicit.
4. Implement the isolated PostgreSQL source-inventory acceptance suite.
5. Only then revise the observer store and endpoint.
6. Keep lifecycle enqueue, worker activation and business-side effects behind separate explicit approval gates.

This audit supersedes any assumption that the repository contains no observer endpoint. It does not change the earlier conclusion that no production lifecycle worker or production enqueue activation has been established.
