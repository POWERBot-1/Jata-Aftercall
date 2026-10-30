# POS accounting: current behavior and acceptance gaps

This describes the implementation, **not** an approved complete accounting policy. No report should be treated as a complete period financial statement until its sources and reconciliation have been implemented and verified together.

## Current sources and dates

- The sales and tender-breakdown reports select sales by their **sale creation time** and show their current refund/void state. A later correction can change an earlier sale-cohort report. It is not an as-of-period-end reconstruction or a period cash-flow report.
- The refund report selects settled POS `OUT` / `REFUND` payment rows by their **payment creation time**, including payouts on earlier sales. Split tenders generate separate rows. It excludes credit reversals, goods returned, and Payment Wallet refunds; it is marked partial. More than 5,000 matching rows yields a clearly disclosed first-5,000 subtotal, not a total.
- The POS refund path limits cash and other payouts to the corresponding settled original tenders, less previous payouts; credit reversal reduces the outstanding receivable, not the cash drawer. Named returned items create stock `RETURN` movements, with per-line quantity guarded against duplicate returns. Wallet-settled sales use the separate wallet refund flow.
- Provider wallet refunds can be asynchronous; a request is not proof of settlement. Provider completion and duplicate/mismatch handling belong to the wallet ledger. The POS refund payout report does not incorporate this ledger.
- The drawer calculation uses settled POS cash payment movements by payment creation time, not the original sale's date; it is a net movement for that day, not a verified physical count or a carry-forward opening balance. Expenses are separately recorded and must not be subtracted again from the payment ledger.
- Immutable finalized captures record a whole-business completed UTC date range, freezing the sale cohort's state at finalization and the period's POS ledger, credit entries, audit events, expenses and inventory movements. A capture is **not** necessarily the balance at period end. Corrections produce separate superseding revisions, which must not be added to previous revisions. Branch-scoped finalization is unsupported. Captures refuse inputs beyond their bounded limit rather than persist incomplete data.

## Limits and unresolved work

- Sale, expense, payment, inventory movement and order inputs used by reports and day closing are capped at 5,000. The report endpoint conservatively refuses when any input reaches the cap (including exactly 5,000), rather than emitting incomplete totals. Credit-age reports also refuse if their debit-entry read reaches the cap. A shorter period can help period-based queries; daily closing and tenant-wide credit ageing may require operational support. The separate dashboard and credit screens still use bounded data reads and are not covered by this refusal: do not assume their figures are complete at scale.
- The report's sales detail shows at most 200 non-voided rows; the totals are computed from the full fetched cohort below the cap. Credit ageing currently uses the oldest recorded debit, not a verified allocation of open entries.
- A complete authoritative period statement needs a consistent event/settlement model covering credit, returns, wallet/provider settlement, adjustments and each supported tender, plus tests for actual cross-period operations, concurrency and limits. Historical mutable sale fields must not be presented as immutable period facts.
- The actual UTC-midnight scenario remains unexecuted. A short elapsed boundary or backdated test is not equivalent.
