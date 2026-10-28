# Release decisions: media storage and sale-price policy

Status as of E-25: **owner approval remains pending.** This file distinguishes implemented source behavior from owner authorization. The current source has sale-window fields/migrations and a shared pricing helper; new inline media writes are blocked. No durable media provider/account was activated, no legacy data was inventoried or migrated, and no database migration was executed. No owner decision is inferred from code/migration comments or historical release wording.

Scope: current worktree on `arena/401b4d54-jata-aftercall` at `2575cf461d33476a6bf8edb44fc56dc63498152a`; source-path review only. Exact requests are in `OWNER_APPROVAL_REQUEST.md`; the full cost/access and environment analysis is in `OWNER_DECISION_READINESS_PLAN.md`.

---

## 1. Media storage and legacy image records

### 1.1 Current source behavior (E-25)

- The no-binary-in-Neon rule remains. `/api/media` rejects new inline `data:image` bytes; a safe hosted/path URL is metadata-only, not a durable upload. The inline provider identifier remains for compatibility, but `put()` fails closed. `IMPLEMENTED_PROVIDERS` is empty and no durable object-read adapter is wired.
- The Studio AI image/enhance routes do not inject an `ImageAssetStore`; they fail closed before quota/generation/provider work. Existing media URL reads remain for compatibility.
- No database inventory ran. Legacy inline values, references and other binary representations remain unknown; do not claim the database is clean or zero. No provider/account/token, upload, backfill, migration, deletion or spend was authorized or performed.

### 1.2 Options to compare before selection

| Candidate | Current evidence and cost status | Access/privacy questions |
|---|---|---|
| Vercel Blob | Candidate only; not installed or implemented. Current pricing/limits and expected operation/transfer costs need verification against current terms and measured traffic. | Public versus private draft access, URL exposure, project identity/secret mechanism, quotas, retention and deletion. |
| S3-compatible (including AWS S3 or R2) | Candidate only; compatible implementation and current storage/request/egress/versioning costs are not established. | Least-privilege identity, tenant-scoped keys, public/private delivery, signed URLs/proxy, lifecycle and deletion. |
| Cloudinary | Candidate only; compatible implementation, current plan/credit/transformation costs and workload fit are not established. | Upload/delivery scope, tenant authorization, public/private behavior, transformation data, retention and deletion. |

Older local cost examples are illustrative, conflict with one another and are not current quotes. Before choosing, compare current provider terms for storage, requests, egress/cache misses, transformations, backups/versioning and service limits; specify one-time and recurring spend caps. No provider is preferred or selected here.

### 1.3 Required owner choices and safe legacy plan

Authorize a non-binding comparison only, or defer and keep uploads disabled. Before any selection, decide provider, account/identity approach, public/private access, per-tenant and global count/byte limits, alerts, privacy, retention/legal deletion, orphan/reference behavior, rollback window, and a hard one-time/monthly budget. No provider activation, token/secret creation, dependency installation, upload, backfill, migration or spend is included.

For legacy media, preserve existing reads and first inventory only an owner-approved isolated/sanitized snapshot with a read-only role. Then choose an owner-reviewed replacement/re-upload process or a dry-run, per-tenant staged backfill with mapping, verification and rollback; cleanup/deletion requires separate approval. State how drafts, published products, versions/history, orphans and deletion requests are handled. `LEGACY_MEDIA_INVENTORY_READONLY.sql` is count-only, has known detection limits, has not been PostgreSQL-validated and has not been run.

The detailed decision request and current constraints are in `OWNER_APPROVAL_REQUEST.md` (C) and `OWNER_DECISION_READINESS_PLAN.md` § “Storage options, cost controls and rollback.” No storage status or data is changed by this section.

---

## 2. Sale-price policy

### 2.1 Current implementation (not owner-approval evidence)

`lib/sale-pricing.ts` is the shared server-side helper. For catalogue products, the sale applies only inside the explicit start-inclusive/end-exclusive interval `startsAt <= now < endsAt`. Timestamps are stored in UTC; zoneless owner-entered times are interpreted as Africa/Nairobi (UTC+03:00). Outside the window, with no/invalid dates, or when the sale price is not below the list price, the base/list price applies. A product variant with its own price is not discounted by a product-level sale.

A configured quantity rule is evaluated after the effective price, can only lower it, and does not compound another discount. If multiple configured rules match, the helper currently selects the first matching rule in configured order; the sanitizer preserves that order. Storefront checkout, pre-orders, member carts, AI/conversational order and quote paths use the shared pricing logic. POS uses the same sale-window helper with its own product catalogue and retains its permissioned override, wholesale (quantity threshold) and discount rules; do not treat POS as otherwise identical to storefront checkout.

The Product and POS sale-window fields and additive migrations `20261010000000_sale_price_windows` and `20261010000100_pos_sale_price_windows` are present in source. **No application DB migration has been run.** Existing unit/channel/storefront/pre-order test files cover window boundaries and channel behavior, but they were not run in E-25. E-23 remains the latest successful application-suite record; its scope was mock/fake-DB where documented.

The shared source and migration comments previously described this as “approved policy C”; those comments are corrected to say they describe current implementation only. No independent owner approval record was established by this review. `OWNER_NOTICE_SALE_PRICES.md` is a draft, not evidence of approval or delivery. Historical release reports remain historical and do not substitute for the owner’s confirmation requested below.

### 2.2 Owner decision required

Choose one:

- **Confirm the current implementation:** approve the time-window behavior above, including first-match quantity-rule precedence and POS scope/wholesale separation; or
- **Specify a different policy:** state sale-window boundaries, invalid/missing-window behavior, quantity-rule thresholds and overlap precedence, variant treatment, affected storefront/pre-order/cart/AI/POS channels, effective date, handling of existing sales and customer notice; or
- **Defer:** leave the code unchanged, do not claim policy approval and keep the owner gate open.

A policy decision alone does not authorize implementation changes, migration execution, customer messaging or deployment. Any code change and customer-notice timing require separate authorization. See `OWNER_APPROVAL_REQUEST.md` G2. Framework baseline (`A-180`) is a separate owner decision, not part of sale-price approval.

### 2.3 Customer and business implications

Changing the rule can alter prices quoted or charged across storefront, pre-order, member and AI channels, receipts, promotions and reporting; changing POS behavior can alter cashier totals. Confirm that customer commitments and existing sale-window data are handled deliberately. Preserve tenant authorization, server-derived price, payment verification, idempotency, POS permissions, settlement, entitlement and inventory behavior. No real payment or refund is permitted for verification.

### 2.4 Verification after approval

If the owner confirms current behavior, run the existing focused regressions after the approved dependency/browser/database prerequisites are available:

```sh
npm test -- tests/unit/sale-pricing.test.ts tests/unit/sale-channels.test.ts tests/integration/storefront-parity.test.ts tests/integration/preorder-price-integrity.test.ts
```

Then validate/apply the reviewed migrations only to the approved disposable synthetic database and run applicable Prisma checkout tests. If the owner selects a different policy, obtain separate implementation authorization, add boundary/channel/precedence regressions, and test against the disposable DB before any customer-facing release. No test or migration ran in E-25.
