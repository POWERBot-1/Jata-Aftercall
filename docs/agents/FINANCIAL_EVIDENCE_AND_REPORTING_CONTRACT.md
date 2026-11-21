# Financial evidence and reporting contract

**Implementation state: PARTIAL — not a release approval.** This contract is additive and fail-closed. Payouts, commission accrual and automatic financial corrections remain disabled.

## 1. Payment environment

Payment.environment is the persisted classification:

- TEST: payment was created while the configured Paystack secret explicitly begins with sk_test_.
- LIVE: payment was created while the configured Paystack secret explicitly begins with sk_live_.
- UNKNOWN: legacy rows, missing secrets, malformed/unrecognized keys, or any payment whose mode cannot be established.

The public key is not authoritative for mode. An arbitrary non-empty secret must not default to TEST. Legacy rows are never backfilled from payment status, reference shape, or deployment assumptions. The checkout and order-payment creation paths persist the mode observed at initiation. Non-Paystack or synthetic fixtures remain UNKNOWN unless their test/live origin is explicitly established.

## 2. Settlement evidence

A payment's PAID status is not by itself proof of settlement for reporting. Provider confirmation must match the immutable JATA reference, provider transaction ID, amount and currency. providerSettledAt records the provider's paid timestamp only when it is present and parseable. providerSettlementReference stores the matched JATA reference. Missing provider timestamps remain null.

Provider fee, tax, settled refund and settled chargeback amounts are stored in minor units only when an authoritative provider settlement/refund/chargeback record supplies them. Null means unavailable; do not estimate or convert a missing value to zero. A partial refund requiring manual review is an exception, not a reconciled refund. A payment mismatch is an exception and must never be auto-corrected by matching on amount alone.

reconciliationStatus values:
- UNRECONCILED: no complete reconciliation decision has been recorded.
- MATCHED: immutable payment/provider identity, gross amount and currency were matched against authoritative evidence.
- EXCEPTION: a mismatch, unsupported partial refund or other unresolved discrepancy exists.
- NOT_APPLICABLE: the row is not a provider cash collection (must be justified by its purpose).

MATCHED does not mean provider fees, tax, payout settlement or bank deposits have been reconciled. Those are separate reconciliation layers.

## 3. Recurring subscription value

The base Subscription row now has nullable effective recurring snapshot fields: recurringAmountKES, recurringDiscountKES, recurringCurrency, recurringIntervalDays, and recurringPriceEffectiveAt. Verified settlement writes the current PlanConfig price, an explicit zero recurring discount (the checkout path offers no discount), currency, plan interval and effective timestamp. A null snapshot is not eligible for MRR.

MRR includes only subscriptions that are active and supported by an eligible, settled, non-test payment, with a complete recurring snapshot and a current effective period. Normalize 30-day plans by 30 and annual plans by 365 only when the configured interval is exactly 30 or 365 respectively; do not extrapolate arbitrary terms without a reviewed rule. The effective consideration is amount less recurring discount. One-time purchases, setup fees, orders, deposits, complimentary access, trials, pending, expired, suspended, cancelled, test, and UNKNOWN payments are excluded.

ARR is MRR × 12 and is an annualized run-rate, not cash received or statutory revenue. Report currency and as-of timestamp. Do not aggregate mixed currencies without an approved FX source and timestamp.

Coverage limitation: this first schema/settlement tranche snapshots the shared Subscription model. POS, Autopilot, MJENGO and other dedicated entitlement/subscription models require their own price snapshot and authoritative settlement linkage before their recurring value may enter MRR. They must remain excluded until implemented and tested.

## 4. Cash reporting

Gross cash collected = successful, settled, non-test payments in the period, by provider settlement timestamp. Net cash collected = gross cash collected less settled refunds and settled chargebacks, each reported separately by settlement date and original payment reference. Provider fees and taxes are separate line items and remain UNAVAILABLE where authoritative records are absent. A payment row alone is not proof that funds reached the bank.

## 5. Commission and payout controls

The adopted referral policy is not a configured rate schedule. No numeric commission rate is inferred. Commission accrual remains disabled until a versioned plan/product rate schedule is explicitly approved and configured. Payouts additionally require separately approved payee verification, threshold, hold period, schedule, reconciliation and maker-checker controls. No payout operation is enabled by this change.

## 6. Reproducible acceptance

- tests/unit/paystack-environment.test.ts: explicit TEST/LIVE prefixes, malformed secret rejection, and public-key non-authority.
- tests/unit/payment-settlement.test.ts: provider timestamp/reference and recurring snapshot are asserted on verified settlement; fee/tax are not fabricated.
- Prisma migration rehearsal and generated-client/typecheck are required on the exact candidate commit.
- Provider-originated fee, tax, refund and chargeback records, full ledger reconciliation, dedicated product subscription snapshots, and live/sandbox provider lifecycle acceptance remain outstanding until backed by provider evidence and traceable exact-head runs.

No production migration, financial mutation, payout, or live charge is authorized by this contract.


## Dedicated-product provider settlement timestamps

The POS, Autopilot and MJENGO settlement transactions now use the shared provider-settlement evidence mapper. A providerSettledAt value is written only from a valid paid_at timestamp returned by the verified Paystack transaction, and providerSettlementReference is tied to the local payment reference. The local webhook receipt time is never substituted for provider settlement time. If paid_at is absent or malformed, the timestamp remains null and the payment remains unreconciled until authoritative evidence is imported.

This does not complete fee/tax import, refund/chargeback reconciliation, bank-statement matching, or a full MRR/ARR calculation. Dedicated-product snapshots and payment-to-subscription reconciliation still require independent acceptance, including ERP PRO's actual activation path.


## Paystack dispute-event handling

Signed Paystack charge dispute create, remind and resolve events are recorded against the stored payment reference. They set reconciliationStatus to REVIEW_REQUIRED and write a durable audit record in the same transaction as the processed-event claim. These events do not prove that a chargeback settled, do not populate settledChargebackMinor, do not mark a payment refunded, and do not automatically suspend a subscription. A finance operator must reconcile the provider dispute outcome and authoritative settlement evidence before changing financial balances or entitlements. Unknown references are acknowledged as ignored and audited; malformed references are rejected for provider retry.


## Asynchronous refund currency control

Provider refund settlement must match both the reserved refund amount in minor units and, when the provider supplies it, the reserved refund currency. A currency mismatch is recorded as UNCONFIRMED reconciliation evidence and leaves the refund in REQUESTED/PENDING_PROVIDER; it must not advance refunded totals, release the reservation, or change payment entitlement. Paystack refund webhooks now carry their provider-reported currency into the common refund resolver. Providers that do not include currency remain subject to amount matching and require independent reconciliation evidence for currency assurance.


## Provider fee evidence (Paystack)

For authenticated Paystack `charge.success` events and successful transaction verification responses, JATA captures Paystack's explicit `fees` integer as `providerFeeMinor` in the sanitized immutable payment-event payload. The value is accepted only as a non-negative safe integer in provider minor units. Missing, malformed, negative, fractional or unsafe values remain unknown; an explicit numeric zero remains a valid provider-reported value. This is evidence capture, not a fee ledger or a bank-settlement assertion. Paystack's `fees` field is not split into tax unless the provider supplies a separately authoritative tax field with documented semantics. JATA must not infer tax from the fee, a percentage, gross amount or net amount. The current implementation does not yet post fee/tax journal entries or reconcile Paystack net settlements against bank statements.


## Provider payout ↔ bank-credit reconciliation primitives

`lib/payments/provider-settlement-reconciliation.ts` defines a deterministic evidence boundary for future provider payout and bank statement ingestion:

- A provider settlement is arithmetically valid only when gross, fee, tax, signed adjustment and net are all explicitly supplied as safe integer minor-unit values and `gross - fee - tax + adjustment = net`.
- Missing fee, tax or adjustment remains incomplete; it is never silently treated as zero. Explicit numeric zero is accepted.
- A bank credit is automatically matched only on one unique exact settlement reference, equal normalized currency and exact net credit amount.
- Duplicate provider references or bank references are ambiguous. Missing references, amount differences and currency differences remain unmatched.
- No amount-only, date-only, substring or fuzzy matching is used.

This tranche adds pure validation/matching primitives and unit tests only. It does not import a bank statement, query a Paystack settlement feed, persist a payout record, create a journal entry, or assert that any payout reached a bank account. Those capabilities remain blocked on provider-specific source evidence, an approved statement ingestion channel, and a separately reviewed persistence/migration design. No live financial records were read or changed.


### Provider-specific follow-on: Paystack settlement feed

Paystack documents read endpoints `GET /settlement` and `GET /settlement/{id}/transactions`. Its settlement response exposes status, currency, `total_processed`, `total_fees`, `effective_amount`, `deductions` and `settlement_date`; the underlying settlement transaction response exposes per-transaction `fees` and currency. These fields are provider-reported evidence, but they do not by themselves prove a bank statement credit. In particular, a missing/null `deductions` value must not be treated as a verified zero tax or adjustment, and the provider settlement ID must not be assumed to appear in a bank statement narration. A later adapter must retain provider settlement ID separately from any bank-statement reference, preserve source payload provenance, and leave arithmetic/bank matching unresolved where evidence is incomplete. Source: https://paystack.com/docs/api/settlement/.


## Read-only Paystack settlement feed adapter

`lib/payments/providers/paystack-settlements.ts` implements read-only GET access to Paystack's documented `GET /settlement` and `GET /settlement/:id/transactions` endpoints. It uses the deployment-selected Paystack secret from the existing server-only configuration, bounded page/per-page inputs, optional status/date filters, request timeout, and strict response normalization. It does not expose customer, authorization, account or raw provider payload fields. It performs no writes and does not automatically paginate: callers must request each bounded page deliberately.

The settlement summary preserves provider settlement ID, status, currency, `total_processed`, `total_fees`, `effective_amount`, `deductions` and settlement date as separate evidence fields. A null `deductions` remains unknown; it is not converted to zero or tax. Settlement transaction rows expose only provider transaction ID, payment reference, status, amount, currency, provider fee and paid timestamp. Malformed or absent values remain null, and malformed response envelopes or non-success HTTP responses fail closed.

This adapter is not a payout ledger or bank integration. Paystack's settlement ID is a provider-side identifier and is not assumed to be a bank-statement reference. A successful provider settlement response is provider evidence only; it does not independently verify the receiving bank credit. No live provider endpoint was called by the tests; all adapter tests use injected mock fetch responses. Source: https://paystack.com/docs/api/settlement/.


## Canonical bank-credit statement parser (pre-persistence)

`lib/payments/bank-statement-csv.ts` accepts only a deliberately narrow canonical CSV format with the exact header `statement_line_id,booking_date,reference,currency,credit_minor`. It parses credit rows only, normalizes currency and booking date, rejects duplicate line IDs, malformed CSV, invalid dates/references/currencies/amounts, unsafe integers, extra columns, files over 5 MiB and imports over 10,000 data rows. A single invalid financial row rejects the entire file; it is not silently skipped. The parser returns only the five normalized fields and does not retain raw statement narration, account numbers, customer details or the original file.

Bank-specific CSV/PDF formats must be mapped into this canonical format by an authorized finance operator before import. This parser is not yet connected to a file upload, persistent statement-import ledger, user-facing workflow or automatic posting. No real bank statement was uploaded or parsed. Exact-reference, amount and currency matching remains a separate step; a provider payout is not considered bank-confirmed until that independent match is reviewed.


## Append-only provider settlement and bank-credit evidence ledger

Migration `20261204000000_financial_evidence_ledger` adds four isolated evidence models:

- `ProviderSettlementSnapshot` stores normalized Paystack settlement summary fields, provider settlement ID, source endpoint/page/filter provenance, normalized snapshot SHA-256 and optional fetcher identity.
- `ProviderSettlementTransactionEvidence` stores reduced transaction rows attached to the exact settlement snapshot, including provider transaction ID, JATA payment reference, amount, currency, fee, paid timestamp, page provenance and a per-row digest.
- `BankStatementImportBatch` stores the original file SHA-256, canonical schema version, mandatory importing actor identity and row count. The uploaded file itself is not persisted.
- `BankStatementCreditEvidence` stores only normalized credit rows: statement line ID, booking date, reference, currency and credit amount in minor units.

All monetary values are nullable where the provider may omit evidence and use PostgreSQL BIGINT. Database constraints reject invalid hashes, currencies, amounts, pagination, row counts and references. Foreign keys use RESTRICT. Database triggers reject UPDATE, DELETE and TRUNCATE on all four evidence tables. Duplicate source snapshots, transaction rows and identical statement files are idempotently skipped by their content digests/unique keys.

`lib/payments/financial-evidence-store.ts` provides transactional persistence primitives for already-fetched normalized Paystack pages and already-supplied canonical CSV text. It does not call Paystack, expose an upload route, persist raw provider payloads or bank files, update Payment rows, create accounting journals, perform automatic bank matching, or authorize payouts. Bank statement imports require an explicit actor ID. The offline Prisma fallback includes fail-closed stubs for the new models.

Important evidence boundary: Paystack settlement IDs are not treated as bank statement references. Persisting both evidence sets does not constitute a match. Exact payout-to-bank reconciliation still requires an independently evidenced bank reference and separately reviewed decision. No production migration has been applied and no live financial data has been read or written.


## Evidence-gated recurring revenue calculation — candidate implementation

`lib/payments/recurring-revenue.ts` adds a pure calculation boundary for subscription snapshots supplied with their exact Payment evidence. It admits a row only when the subscription is ACTIVE and within its effective period, the recurring snapshot is complete, the term is exactly 30 or 365 days, and the linked payment matches business, plan, payment ID, JATA reference, purpose, amount and currency. The payment must be PAID, explicitly LIVE, provider-settled by a valid provider timestamp, and marked MATCHED.

The first calculation output is KES-only. Non-KES rows are excluded rather than converted. 30-day value is monthly; 365-day value is divided by twelve without whole-kobo rounding. Missing links, TEST/UNKNOWN payments, unresolved reconciliation, mismatches, unsupported terms and incomplete snapshots produce explicit exclusions.

`tests/unit/recurring-revenue.test.ts` adds focused unit cases for eligibility, annual normalization, legacy missing links, test/unknown/unreconciled payments, identity/amount/currency mismatches, expired periods, unsupported terms, incomplete snapshots and ambiguous payment identities.

### Read-only admin MRR projection

`lib/admin/recurring-revenue-report.ts` loads the POS, Autopilot, MJENGO, legacy ERP and ERP PRO subscription models. It joins each row to Payment only by its stored payment ID, then passes the normalized evidence to the pure calculator. The shared base `Subscription` model is deliberately omitted: it also serves AI Front Desk tiers, and a canonical audited plan-key allowlist has not yet established which rows represent Business Page rather than Front Desk. This prevents product misclassification and double counting. It does not infer historical links, mutate payment/subscription rows, perform FX, or write a ledger. If any required subscription source or payment query fails, the report fails closed so the admin overview displays Unavailable rather than a partial total.

The admin overview now presents **Evidence-qualified MRR (KES)** as a distinct projection, alongside (not substituted for) the historical PAID subscription payment amount. It also shows eligible and excluded subscription counts. The figure is not statutory revenue, cash collected, provider net payout, ARR, or proof of bank receipt. The calculator's `reconciliationStatus = MATCHED` condition is an explicit Payment-row gate; it must not be represented as a bank-credit match unless the separate provider-payout-to-bank evidence process has established that exact relationship.

Legacy subscriptions without exact payment links remain excluded. The dedicated product models are read independently; null payment links remain excluded. The shared base Subscription model, AI Front Desk and Website Studio entitlements are not included in this projection pending authoritative product classification. No production migration, live DB read, or financial mutation is part of the reporting implementation.

`tests/unit/recurring-revenue-report.test.ts` covers all five included dedicated subscription sources, exact payment-ID lookup, missing legacy links, unreconciled payment exclusion, source failure and empty data. PostgreSQL and full CI acceptance on the exact commit remain pending.
