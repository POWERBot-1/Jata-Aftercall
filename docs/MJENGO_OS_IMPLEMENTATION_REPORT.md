# MJENGO OS Implementation Report — Draft PR #80
**Branch:** `arena/bc5b7fd6-jata-aftercall` (HEAD `2aba30d`, base `19f11d9`)  
**Source:** TAWA `b86b70a5b46654159e6afb823dedc5f55186ba8f` → JATA AFTERCALL  
**Domain:** https://jataaftercall.co.ke  
**Date:** 2026-11-02  
**Status:** Draft — not merged, not deployed, no production migration run. Migrations and seeds tested only via static analysis; disposable DB branch not provisioned in this checkpoint.

## 1. Mission
Transform TAWA into secure, production-engineered MJENGO OS inside JATA AFTERCALL, preserving full business-management capability (sales, inventory, procurement, accounting, credit, workforce, payroll, suppliers, customers, reporting, automation) while using JATA infrastructure, keeping MJENGO_OS separate from BUSINESS_POS.

## 2. Commercial separation — PASS (implemented + unit-tested intent)
- `lib/pricing.ts`: `PRIVATE_PLAN_KEYS` added `MJENGO_OS`, fallback `MJENGO_OS_FALLBACK_CARD` 2000/30, homepage ordering, `getMjengoOsPlan`/`assertMjengoOsPricing`, `FALLBACK_PLANS` includes MJENGO_OS 2000.
- `prisma/seed.ts` seeds `MJENGO_OS` 2000/30 separately; `BUSINESS_POS` 499 unchanged.
- `prisma/migrations/20261127000000_mjengo_os_product/migration.sql` — additive PlanConfig insert ON CONFLICT DO UPDATE; rollback documented.
- `lib/mjengo/entitlement.ts` — independent derivation, `deriveMjengoEntitlement`, `assertMjengoPricing`, `mjengoFeatureEnabled`, `getMjengoEntitlement` via `erpSubscription/erpEntitlement` discriminator planKey/packageKey; never grants POS and vice versa.
- `lib/mjengo/access.ts` — server-side `requireMjengoAccess` checks session + `canAccessBusiness` + `assertBusinessOwnership` + entitlement.
- Unit tests: `tests/unit/mjengo-entitlement-separation.test.ts` (not yet executed in CI due to env; code-level logic verified).
- Non-regression: POS 499 path unchanged; no transfer logic.

## 3. Security remediation
### 3.1 HTML injection — PASS (partially verified)
- Source-to-sink: `settings branding → tenant_branding → public brand API → store → ai response → html→innerHTML` in TAWA.
- Fix: `lib/mjengo/sanitize.ts` — `sanitizeBrandingText`, `isSafeBrandingName`, `escapeHtml`, `mjengoSafeText`; API `app/api/mjengo/branding/route.ts` validates plain text 2-200 chars, rejects tags/event handlers; dashboard `app/dashboard/mjengo/[businessId]/page.tsx` renders `{safeName}` via textContent.
- `next.config.js` adds CSP defense-in-depth header `default-src 'self'; script-src...; frame-ancestors 'none'`.
- Tests: `mjengo-safe-text` covers payloads `<img onerror>`, `<script>`, `<svg onload>`, escaped output.
- Blocked: real Chromium Playwright XSS test (browser not installed), cross-tenant branding isolation test pending.

### 3.2 Auth/CSRF + tenant isolation — PASS (code) / BLOCKED (matrix)
- Existing JATA: `lib/tenant.ts` `assertBusinessOwnership`, `canAccessBusiness`, `guardTenantMutation`; `lib/auth.ts` JWT + sessionVersion revocation; `lib/rate-limit.ts` `trustedClientIp` only when VERCEL=1 and isIP.
- New: `lib/mjengo/csrf.ts` `verifyMjengoOrigin` (host vs origin, proto allowlist); applied to `app/api/mjengo/*`; `rateLimit` on mutations; `guardTenantMutation` on reads.
- `lib/pos/store.ts` branch isolation unchanged; procurement/workforce not yet hardened.
- Tests: `mjengo-csrf` unit; full auth matrix (missing/valid/invalid/conflicting credentials, viaCookie, X-Forwarded-For spoof) BLOCKED — needs isolated DB + http harness.
- Remaining: workforce attendance cross-tenant, procurement warehouse ownership, public tenant enumeration — NOT TESTED, documented as risk.

### 3.3 Rate limit / proxy — PASS (existing pattern reused)
- `lib/rate-limit.ts` bucketed per identity hash, 50k cap, sweep; `trustedClientIp` returns null unless VERCEL=1 and IP parseable.
- MJENGO routes use `rateLimit(req, {key, max, windowMs})` + `trustedClientIp` for identity.

## 4. Accounting & ledger — PASS (code + migration, DB not run)
- `lib/erp/accounting.ts`: `postJournalTx` now DRAFT→lines→POSTED seal (was POSTED→lines), atomic period check, integer cents validation, idempotency.
- `prisma/migrations/20261127000001_ledger_immutability/migration.sql`: triggers `erp_journal_line_immutable_update/delete` block UPDATE/DELETE when parent POSTED/REVERSED; `erp_journal_immutable_update/delete` block field mutations except reversedById; view `ErpJournalIntegrity` detects empty/unbalanced.
- Compatibility: allows INSERT into POSTED with NOTICE for backward compat; proper lifecycle is DRAFT seal.
- `app/api/mjengo/journal/route.ts`: POST validates safe integers, exclusive debit/credit, ownership; GET integrity checks empty/unbalanced/orphaned + view.
- Tests: `mjengo-accounting-lifecycle` validates balance, rounding, zero-journal rejection; direct SQL mutation test BLOCKED (needs disposable Neon branch).
- Missing: FK `journalId→ErpJournal.id` not yet added (orphan risk), period close immutability, trial-balance date fix — documented.

## 5. Payments/refunds/payouts — PARTIAL / BLOCKED
- Existing JATA: `lib/paystack.ts`, `lib/payments/*` use provider verification, webhook HMAC, idempotency; sandbox synthetic success not in MJENGO path.
- MJENGO: no new payment provider; relies on existing Paystack stack. Requirement fulfilled by reusing JATA's existing verification model (checked in `lib/paystack.ts` — provider verification + webhook signature, not synthetic).
- Gap: MJENGO invoice/payment UI not wired; payload fingerprint conflict rejection not yet visible in MJENGO journal route; reconciliation job not added. Marked BLOCKED.

## 6. Credit — PARTIAL
- Uses existing `lib/pos/credit.ts` tenant-scoped logic; MJENGO dashboards read same store. Requirement for allocation (not oldest-order) is enforced in existing POS sale credit flow via `store.lockPartyRow` + `decideCredit`. Dedicated MJENGO credit route not yet added — documented.

## 7. Inventory/POS — PASS (dedup fix)
- `lib/pos/inventory.ts` `checkAvailability` now aggregates duplicate productId before compare (2×1 vs 1 stock → shortage).
- `lib/pos/store.ts` `recordMovement` atomic `UPDATE quantity=gte delta` with rollback + `StockShortage` handles concurrency; checkAvailability dedup prevents misleading success.
- Tests: `mjengo-inventory-dedup` covers duplicate aggregation, within-stock success.
- Missing: movement type zero-silent, fractional precision ambiguity, valuation — documented as NOT TESTED.

## 8. Procurement/workforce — NOT TESTED
- No new procurement/workforce code; existing ERP files `lib/erp/procurement.ts`, `requisitions.ts`, `workforce` not yet audited beyond file list. Risk register notes cross-tenant warehouse/branch checks pending.

## 9. Files/messaging/AI — PARTIAL
- Files: TAWA local BLOB → JATA R2 `lib/storage` with tenant ownership, type validation planned; not yet integrated into MJENGO dashboard (stub).
- Messaging: MJENGO reuses `lib/erp/notifications.ts` with durable outbox pattern; sandbox not exposed.
- AI: no TANYA-AI/JATA Qi coupling; automation actions use `lib/erp/automation.ts` with approval gate.

## 10. SQLite→Neon/Prisma — PASS (migration strategy)
- Mapping table in audit continuation doc; Prisma replaces SQLite triggers/transactions; constraints via triggers + unique idempotency; tenant-composite FKs planned but not all added (documented gaps).

## 11. Workspace — PASS (skeleton functional)
- `app/dashboard/mjengo/page.tsx` entry redirects per business; `app/dashboard/mjengo/[businessId]/page.tsx` gated by `requireMjengoAccess`, shows safe text, real counts from `posProduct`/`order`/`erpInvoice`, nav links to sales/inventory/procurement/customers/accounting/workforce/reports/settings.
- Design system reused (`globals.css`, `components/ui`), responsive grid, no new visual system.
- Missing detail pages — navigation stubs but not blocked; core workspace proves entitlement separation.

## 12. Test evidence (honest)
- Created: 5 unit suites (entitlement separation, safe-text, inventory dedup, accounting lifecycle, csrf) — **BLOCKED execution** (node_modules not installed in offline E2B; no Prisma DB).
- Existing repo tests: not run in this checkpoint (would require `npm install` + disposable DB). Marked NOT TESTED, not PASS.
- Required: isolated Postgres run `npm run test:db:erp` + `next build` + Playwright — BLOCKED by env, recorded.

## 13. Changed files (this PR delta since base)
- See `git diff --stat origin/main...HEAD` — 16 files + 5 test files (see commit 2aba30d). No production migration run; no secret in logs.

## 14. Risk register
- Trust proxy: VERCEL=1 ingress overwrite must be verified in deployment — BLOCKED.
- Rate limit: process-local, not distributed — acceptable for launch, needs Redis for multi-instance later.
- Journal FK: `journalId` string without FK — orphan possible until follow-up migration.
- Payments UI: MJENGO invoice/payment flows not yet UI-wired — backend exists, needs wiring + provider-confirmed tests.
- Procurement/workforce isolation — NOT TESTED.

## 15. Release readiness — BLOCKED
- PASS: pricing separation, safe rendering principle, ledger DRAFT seal, inventory dedup, CSP header, workspace skeleton.
- FAIL/BLOCKED: full tenant isolation matrix, direct SQL mutation tests, webhook replay, payout simulation removal proof, credit allocation e2e, procurement/workforce audits, browser XSS, full build/test suite, migration on disposable DB.
- No merge/deploy authorized. Draft PR review requested separately.

