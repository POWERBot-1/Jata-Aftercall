# Phase 10 ADMIN-005 read-model code audit — 2026-11-22

## Scope and result

Reviewed the exact PR #154 candidate source at `b5706a1dbc3c3daa721d4c083b3818b875d06c2f`:

- `lib/control/financial-metrics.ts`
- `tests/unit/control-financial-metrics.test.ts`
- `app/api/control/overview/route.ts`
- `docs/agents/FINANCIAL_EVIDENCE_AND_REPORTING_CONTRACT.md`

**Disposition: ADMIN-005 remains BLOCKED / implementation PARTIAL.** This was a source review only; no source code, tests, schema, readiness status or financial data were changed.

## Existing implementation verified by source inspection

1. The recurring revenue calculator includes only ACTIVE subscriptions with matching subscription/payment identifiers, LIVE/PAID/KES settlement evidence, provider transaction ID, settlement timestamp/reference, zero settled refund/chargeback evidence and a complete immutable recurring-price snapshot.
2. It supports only 30-day and 365-day price intervals, normalizes exactly, and returns the monthly numerator over 12 without undocumented rounding.
3. An active row with incomplete or contradictory evidence withholds the aggregate as UNAVAILABLE rather than silently understating it.
4. The overview route reads product subscription counts and recurring snapshots across CORE, POS, AUTOPILOT, ERP legacy, ERP PRO and MJENGO models. It selects only the fields required for the aggregate and does not select payer PII or raw provider payloads.
5. The unit suite covers normalization, TEST exclusion, duplicate payment linkage, zero active subscriptions, missing settlement/linkage/snapshot fields, unsupported currency/interval, refunds/chargebacks and aggregate identifier non-disclosure.

## Acceptance gaps still open

The reviewed recurring-revenue helper is not a complete ADMIN-005 financial and operating read model:

- **Cash reporting:** the inspected overview route does not yet calculate gross settled cash, settled refunds, settled chargebacks and net cash separately by provider settlement date.
- **Fee/tax reporting:** provider fee/tax values are not presented as separate authoritative metrics in this route; missing values must remain UNAVAILABLE rather than inferred.
- **Reconciliation exceptions:** the inspected route does not yet aggregate immutable payment/provider reconciliation exceptions by identifiers or exception class.
- **Operating metrics:** authoritative AI usage/cost, jobs and incidents are not assembled into a unified source-stamped section. Existing provider health output is UNAVAILABLE when no authenticated probe with source and last-success metadata exists; that fail-closed behavior must be preserved.
- **Integration acceptance:** the reviewed unit tests do not establish full PostgreSQL integration coverage for all subscription/payment states, provider environments, settlement dates, refund/chargeback cases, tenant scopes and exception classifications.
- **Control access:** the Control permission matrix remains all-DENY and the runtime feature remains disabled. No financial metric is thereby authorized for customer or operator exposure. Keep explicit route-denial tests and do not add grants.

## Safe next implementation slice

A subsequent isolated engineering change may add a read-only cash-evidence summary behind the existing server-side permission and scope checks, using only authoritative persisted settlement/refund/chargeback fields. It must:

1. Use provider settlement timestamps, not local webhook receipt/created timestamps.
2. Separate gross, refund, chargeback, fees and tax; preserve missing values as UNAVAILABLE.
3. Exclude TEST/UNKNOWN, pending, failed, initiated and unreconciled cash records.
4. Group by currency and settlement date; do not apply FX conversion or infer bank credit.
5. Surface exception counts and stable internal references without exposing payer PII.
6. Return source and as-of metadata; fail closed on missing or contradictory evidence.
7. Add pure tests and disposable PostgreSQL integration tests for all inclusion/exclusion and date-boundary cases.
8. Preserve the all-DENY policy, Control runtime kill switch, and current route denial behavior.

No production SQL, financial mutation, provider request, payment, payout, entitlement change, secret, Control permission, merge or deployment is authorized or performed by this audit.

## Overall result

This source audit identifies a concrete next code tranche but does not satisfy ADMIN-005. No readiness status is promoted.