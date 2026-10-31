# PR #76 — original 91-file scope classification

Base `c3f8dc2daa0ae618a5cf71f0ff78dc7c10e8eb16`; original PR head `30d38fc1b351b6a8b605c5244382dd5eb93d15f2`. This is a scope classification, **not a claim that every required file is verified or release-ready**. The current working tree also has later changes.

- **Required safe**: retained functionality or a mandatory gate; its presence here is not a pass. It needs applicable financial, security, isolation and CI evidence.
- **Completed safe**: only where evidence covers the feature and its stated limits; no entire file is declared universally safe on partial evidence.
- **Incomplete excluded/disabled**: not to be presented as a working released feature; notes identify the actual exclusion or remaining action.
- **Owner-dependent deferred**: depends on separately approved provider, evidence or resource; no claim of validation.

The following classification does not override the mandatory STOP: pending sale allocation, provider reversal/reconciliation completeness, exact-head CI and protected approvals. Capture data are not authoritative period statements. No production migration, data or configuration was changed.

| Original changed file | Classification | Boundary / remaining action |
|---|---|---|
| `.github/workflows/premium-screenshots.yml` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `OWNER_RELEASE_BLOCKERS.md` | Owner-dependent deferred | Storage, email and other owner resources remain unapproved; document is not delivery evidence. |
| `POS_ACCOUNTING_LIMITATIONS.md` | Required safe | Retain as limitation/gate documentation; not proof of financial completeness. |
| `PR76_ACCEPTANCE_RESTRUCTURE.md` | Required safe | Retain as limitation/gate documentation; not proof of financial completeness. |
| `R2_SETUP.md` | Owner-dependent deferred | Storage, email and other owner resources remain unapproved; document is not delivery evidence. |
| `app/api/pos/[businessId]/categories/route.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `app/api/pos/[businessId]/category-images/route.ts` | Owner-dependent deferred | Durable tenant-authorized media storage not verified; retain refusal of unsupported uploads. |
| `app/api/pos/[businessId]/customers/[customerId]/route.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `app/api/pos/[businessId]/expenses/route.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `app/api/pos/[businessId]/products/[productId]/route.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `app/api/pos/[businessId]/products/route.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `app/api/pos/[businessId]/reports/route.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `app/api/pos/[businessId]/reports/snapshots/route.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `app/api/pos/[businessId]/sales/route.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `app/api/pos/[businessId]/suppliers/[supplierId]/route.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `app/dashboard/pos/[businessId]/credit/page.tsx` | Required safe | Retain account-level credit/ageing safeguards; sale repayment allocation not implemented; unverified historical balances stay qualified. |
| `app/dashboard/pos/[businessId]/customers/[customerId]/page.tsx` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `app/dashboard/pos/[businessId]/expenses/page.tsx` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `app/dashboard/pos/[businessId]/page.tsx` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `app/dashboard/pos/[businessId]/products/ProductScreen.tsx` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `app/dashboard/pos/[businessId]/sales/[saleId]/page.tsx` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `app/dashboard/pos/[businessId]/sell/page.tsx` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `app/globals.css` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `app/layout.tsx` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `components/OnboardingForm.tsx` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `components/pos/CategoryManager.tsx` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `components/pos/CategoryPhotos.tsx` | Owner-dependent deferred | Durable tenant-authorized media storage not verified; retain refusal of unsupported uploads. |
| `components/pos/PrintReceiptButton.tsx` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `components/pos/RecordBoard.tsx` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `components/pos/ReportsClient.tsx` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `components/pos/TillClient.tsx` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `components/pwa/PwaInstaller.tsx` | Owner-dependent deferred | Preserve existing PWA; advanced native lifecycle evidence deferred, not passed. |
| `lib/ai/designContext.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `lib/categoryImagery.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `lib/db.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `lib/experience/businessRecipes.ts` | Required safe | Retain independent onboarding/studio behavior; affected journey and isolation evidence required. |
| `lib/experience/categories.ts` | Required safe | Retain independent onboarding/studio behavior; affected journey and isolation evidence required. |
| `lib/experience/contentAssist.ts` | Required safe | Retain independent onboarding/studio behavior; affected journey and isolation evidence required. |
| `lib/experience/templateFamilies.ts` | Required safe | Retain independent onboarding/studio behavior; affected journey and isolation evidence required. |
| `lib/experience/themes.ts` | Required safe | Retain independent onboarding/studio behavior; affected journey and isolation evidence required. |
| `lib/experience/types.ts` | Required safe | Retain independent onboarding/studio behavior; affected journey and isolation evidence required. |
| `lib/pos/credit-age.ts` | Required safe | Retain account-level credit/ageing safeguards; sale repayment allocation not implemented; unverified historical balances stay qualified. |
| `lib/pos/credit-period.ts` | Incomplete excluded/disabled | Projection module/tests remain internal; production capture invocation removed locally; legacy response redaction pending final verification. |
| `lib/pos/credit.ts` | Required safe | Retain account-level credit/ageing safeguards; sale repayment allocation not implemented; unverified historical balances stay qualified. |
| `lib/pos/dashboard.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `lib/pos/forms.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `lib/pos/operations.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `lib/pos/presentation.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `lib/pos/productImage.ts` | Owner-dependent deferred | Durable tenant-authorized media storage not verified; retain refusal of unsupported uploads. |
| `lib/pos/report-limit.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `lib/pos/report-snapshots.ts` | Required safe | Retain only as qualified capture/report; current allocation and complete financial reconciliation remain blocked. |
| `lib/pos/reporting.ts` | Required safe | Retain only as qualified capture/report; current allocation and complete financial reconciliation remain blocked. |
| `lib/pos/reports.ts` | Required safe | Retain only as qualified capture/report; current allocation and complete financial reconciliation remain blocked. |
| `lib/pos/sales.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `lib/pos/store.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `lib/validation.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `package-lock.json` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `package.json` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `prisma/migrations/20261101000000_pos_category_images/migration.sql` | Required safe | Retain pending native migration rehearsal and compatibility/protected CI; local raw SQL is not Prisma migrate deploy. |
| `prisma/migrations/20261102000000_pos_report_snapshots/migration.sql` | Required safe | Retain pending native migration rehearsal and compatibility/protected CI; local raw SQL is not Prisma migrate deploy. |
| `prisma/migrations/20261103000000_pos_categories/migration.sql` | Required safe | Retain pending native migration rehearsal and compatibility/protected CI; local raw SQL is not Prisma migrate deploy. |
| `prisma/schema.prisma` | Required safe | Retain pending native migration rehearsal and compatibility/protected CI; local raw SQL is not Prisma migrate deploy. |
| `scripts/browser/onboarding-authenticated.check.mjs` | Required safe | Retain independent onboarding/studio behavior; affected journey and isolation evidence required. |
| `scripts/browser/pos-photo-refusal.check.mjs` | Owner-dependent deferred | Durable tenant-authorized media storage not verified; retain refusal of unsupported uploads. |
| `scripts/browser/pos-profile-journeys.check.mjs` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `scripts/browser/studio-authenticated.check.mjs` | Required safe | Retain independent onboarding/studio behavior; affected journey and isolation evidence required. |
| `scripts/erp/migration-verify.sh` | Required safe | Retain pending native migration rehearsal and compatibility/protected CI; local raw SQL is not Prisma migrate deploy. |
| `scripts/verification/release-acceptance.mjs` | Required safe | Retain fail-closed gate; current offline acceptance inventory is blocked, not a release pass. |
| `tests/e2e/business-pos-journey.test.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `tests/helpers/posFakeDb.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `tests/integration/pos-api-routes.test.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `tests/integration/pos-supplier-concurrency-postgres.test.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `tests/security/pos-page-authorization.test.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `tests/unit/business-recipe-layouts.test.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `tests/unit/business-recipes.test.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `tests/unit/experience-art-direction.test.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `tests/unit/experience-categories.test.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `tests/unit/pos-bounded-totals.test.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `tests/unit/pos-category-photo-ui.test.ts` | Owner-dependent deferred | Durable tenant-authorized media storage not verified; retain refusal of unsupported uploads. |
| `tests/unit/pos-credit-age-fifo.test.ts` | Required safe | Retain account-level credit/ageing safeguards; sale repayment allocation not implemented; unverified historical balances stay qualified. |
| `tests/unit/pos-credit-period-projection.test.ts` | Incomplete excluded/disabled | Projection module/tests remain internal; production capture invocation removed locally; legacy response redaction pending final verification. |
| `tests/unit/pos-credit-statement-safety.test.ts` | Required safe | Retain account-level credit/ageing safeguards; sale repayment allocation not implemented; unverified historical balances stay qualified. |
| `tests/unit/pos-dashboard-report-safety.test.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `tests/unit/pos-product-photo-ui.test.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `tests/unit/pos-refund-period-limit.test.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `tests/unit/pos-refund-report-snapshot.test.ts` | Required safe | Retain only as qualified capture/report; current allocation and complete financial reconciliation remain blocked. |
| `tests/unit/pos-report-limit-refusal.test.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `tests/unit/pos-report-snapshot-period.test.ts` | Required safe | Retain only as qualified capture/report; current allocation and complete financial reconciliation remain blocked. |
| `tests/unit/pos-schema.test.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
| `tests/unit/release-acceptance-runner.test.ts` | Required safe | Retain fail-closed gate; current offline acceptance inventory is blocked, not a release pass. |
| `tests/unit/repair-guards.test.ts` | Required safe | Retain; validate affected behavior and protected checks; not independently signed off. |
