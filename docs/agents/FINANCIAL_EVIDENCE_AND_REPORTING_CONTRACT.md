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
