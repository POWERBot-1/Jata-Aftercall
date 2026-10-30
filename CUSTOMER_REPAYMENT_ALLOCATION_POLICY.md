# Customer repayment allocation — owner decision and implementation gate

The owner selected **oldest eligible sale first (FIFO)** for future customer repayments in this session. This is a policy decision, not evidence that allocation has been implemented or that any historical amount is reconciled.

## Findings

`recordRepayment` creates a settled `PosPayment` with `purpose=CREDIT_REPAYMENT` and `customerId`, but no `saleId`; its `PosCreditEntry` references the payment and customer, not an individual sale. A sale debit or credit refund may have a sale reference, but that is not a repayment allocation. The schema has no persisted repayment-to-sale allocation table. Account-level FIFO ageing is a reporting convention and explicitly refuses ambiguous sale-linked credit reversals; it is not proof of invoice settlement. Original sale `balanceKES` is not reduced by repayments. Customer balances and history may include unverified openings.

## Proposed implementation details (not yet implemented)

- Apply new qualifying, settled repayments only within the same business and customer, to eligible unpaid sale receivables oldest first. Use a stable tie-breaker such as creation time then sale ID; owner/product review of eligibility and tie-breaking remains necessary.
- Persist immutable allocation entries linking repayment, sale, amount and tenant. Bound each sale's allocation to its eligible residual; no overpayment, cross-tenant assignment, duplicate allocation or allocation of unverified opening debt. Lock the customer and relevant receivables in a consistent order and post payment, allocations, credit ledger and audit atomically.
- Define and test allocations for repayments reversed after posting, refunds and voids, multi-tender sales, backdated entries, retries, concurrent repayments, customer merges and corrections. Reversals must reference and unwind the original allocations; do not silently reallocate historical movements.
- Establish a verified opening and complete history before any historical reconstruction. Where evidence is missing or ambiguous, present sale-level current owed as unavailable; do not backfill a guessed allocation. An independently reviewed migration and reconciliation would be required before historical backfill.
- Original sale unpaid values shown by existing reports and captures are labelled as such, with repayment limitations; they are not current sale-level debt. Customer-level stored balances are not automatically verified historical openings.

These are design requirements, not a release approval. Until implemented and validated in real PostgreSQL with the full accounting matrix, sale-level current balances remain unsupported.

## Temporary safety boundary

A credit refund or void is refused when a settled, sale-unlinked customer repayment exists, because the current account balance cannot prove which sale remains unpaid. This is deliberately conservative: it can also refuse a legitimate credit refund after a fully settled earlier account. Cash-only refunds remain available. The guard is not a replacement for persistent FIFO allocations or reconciliation, and it does not establish historical balances. Credit refunds and repayments serialize on the customer row. Caller-owned transactions must propagate refund aborts so claimed return items roll back.
