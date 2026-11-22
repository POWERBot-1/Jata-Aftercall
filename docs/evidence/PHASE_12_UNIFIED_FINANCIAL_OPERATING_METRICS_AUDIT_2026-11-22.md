# Phase 12 — unified financial and operating metrics source audit — 2026-11-22

## Disposition

**ADMIN-005 remains BLOCKED.** This phase performs an exact-branch schema/source inventory to refine the implementation boundary. It does not claim unified cash acceptance, accounting correctness, tenant-safe reporting, or independent acceptance.

Repository: `POWERBot-1/Jata-Aftercall`  
Branch: `arena/ai-front-desk-motion-evidence-20261122`  
Audited head before this document: `8ebd687849c054e80756dc5043110b1d06df38c6`  
PR: #155 (OPEN / DRAFT / UNMERGED)

## 1. Authoritative persisted fields found

The Prisma `Payment` model contains:
- `environment` (default UNKNOWN), `status`, `currency`, `amount`
- `providerSettledAt`, `providerSettlementReference`
- `providerFeeMinor`, `providerTaxMinor`
- `settledRefundMinor`, `settledChargebackMinor`
- `reconciliationStatus` (default UNRECONCILED), `reconciledAt`
- stable internal `id` and `reference`

The `ProviderSettlementSnapshot` model separately stores provider, settlement ID/status, currency, gross processed, provider fee, effective net, deductions, settlement date, source endpoint/page/filter, source snapshot hash and fetch metadata. The associated transaction evidence stores snapshot linkage, provider transaction ID/payment reference, status, amount, currency, fee, paid timestamp and source row hash.

The existing `persisted-financial-evidence-summary` is explicitly `EVIDENCE_INVENTORY_ONLY`: it counts snapshots, transaction rows, bank-credit rows and selected identity/completeness exceptions. It does not produce accepted settlement-date cash totals or prove bank receipt.

## 2. Acceptance gap refined

The previous audit described fee/tax fields as absent from the payment model. This phase corrects that statement: the Payment schema does persist fee and tax fields. The unresolved gap is a verified, permission-safe and source-stamped aggregation with defined provenance and reconciliation rules—not proof that no such fields exist.

Still not established:
- Reconciled gross settled cash, refunds, chargebacks and net cash by provider settlement date and currency, with explicit inclusion/exclusion rules.
- Consistency checks between Payment-level fee/tax/refund/chargeback fields and provider settlement snapshots/transaction evidence; no double counting across these sources.
- Whether provider tax is a distinct withheld amount, included in deductions, or already represented in provider net for every supported source; do not add or subtract it without a documented provider contract and reconciliation proof.
- Exception classification/counts with stable internal references and no payer PII.
- Source-stamped AI usage/cost, background job throughput/failures/latency and incident metrics from authoritative persisted operational sources.
- PostgreSQL integration tests for all relevant states, dates, currencies, duplicate/collision cases, tenant boundaries, missing/contradictory fields and denied routes.
- Independent acceptance of output semantics and Control authorization. All-DENY permissions and the runtime kill switch remain unchanged.

## 3. Safe implementation contract

Any next implementation must:
1. Treat `providerSettledAt` / verified provider `settlementDate` as the settlement-date dimension; never substitute webhook receipt or row creation time.
2. Partition by provider and currency. Never combine currencies or infer FX.
3. Define one authoritative source per amount and reconcile cross-source duplicates before aggregation; never sum Payment and settlement snapshot values as if they were independent cash.
4. Keep gross, provider fee, provider tax, deductions, refund, chargeback and net as separate fields. Missing/ambiguous values are UNAVAILABLE, not zero.
5. Exclude TEST/UNKNOWN, pending, failed and unreconciled records from settled-cash totals; surface them separately as exceptions where supported.
6. Do not claim bank receipt from provider settlement evidence. Bank-credit evidence remains a separate comparison until matching is explicitly implemented and accepted.
7. Emit source, as-of timestamp, currency, settlement window, row counts and stable internal evidence references; never expose payer identity or raw provider payloads.
8. Keep all Control permissions DENY and the Control runtime disabled. No new route exposure or operator grant is part of this phase.
9. Add pure tests plus disposable PostgreSQL integration tests, including date-boundary, idempotency, duplicate identity, contradictory amount, missing fee/tax, refund/chargeback, tenant isolation and denied-route cases.

## 4. Programme completeness — exact latest CI

Latest exact-head Admin instruction integrity run: `45064841409`.
- `instruction-integrity`: PASS.
- `programme-completeness`: FAIL.
- The test of the completeness gate passed; the required repository-wide acceptance step failed, as intended.

The current readiness manifest contains 24 unresolved requirements: 21 BLOCKED and 3 NOT_TESTED:
`ADMIN-005`, `ADMIN-006`, `ADMIN-007`, `ADMIN-009`, `ADMIN-010`, `ADMIN-013`, `ADMIN-014`, `ADMIN-015`, `MOTION-002`, `MOTION-003`, `MOTION-004`, `MOTION-005`, `MOTION-006`, `MOTION-007`, `MOTION-008`, `MOTION-011`, `MOTION-012`, `MOTION-013`, `MOTION-014`, `MOTION-015`, `MOTION-016`, `MOTION-017`, `MOTION-018`, `RELEASE-001`.

No readiness status or checker rule was changed. The exact-head POS / ERP-PRO verification run `45064841420` completed successfully; it does not clear the programme gate.

## 5. Preview and documentation deployment

The latest Vercel deployment for the audited head is `dpl_FxNar69TVue57XqM7NXgCCvQGEX2`, URL `jata-aftercall-dax6r3cln-powerbot-1.vercel.app`, state ERROR (`BUILD_UTILS_SPAWN_1`). Prisma Client generation succeeded; `scripts/ci/check-preview-environment-isolation.mjs` stopped the build before Next.js compilation.

Missing branch-scoped Preview variables:
- `DATABASE_URL`
- `DIRECT_URL`
- `JATA_STAGING_DATABASE_HOST`
- `AUTH_SECRET`
- `NEXTAUTH_SECRET`
- `PUBLIC_BASE_URL`
- `NEXTAUTH_URL`

A metadata-only Vercel query for the exact PR branch returned no environment entries. No secret values were decrypted. No other branch's configuration was copied. The isolation guard was not bypassed.

Owner-controlled prerequisite: provision and verify a dedicated non-production Neon staging database/host, independent Preview auth secrets, non-production Preview origins, Paystack test credentials and an isolated Preview object-storage bucket; attach the configuration to this exact PR branch and rerun the exact-head deployment. Do not use production resources or weaken the guard.

## 6. Safety and next action

No production database, payment, payout, provider, DNS, environment variable, secret, Control permission, merge or deployment mutation was performed. PR #155 remains draft/open/unmerged.

**Next engineering tranche:** implement the read-only, deduplicated cash aggregation against the confirmed Payment and settlement evidence schema only after the source-of-truth mapping for fees, tax, deductions, refunds and chargebacks is documented and tested. In parallel, inventory authoritative AI usage, job and incident data sources before designing their metrics. Do not mark ADMIN-005 PASS until PostgreSQL, tenant-scope, denied-route and independent semantic acceptance all pass.
