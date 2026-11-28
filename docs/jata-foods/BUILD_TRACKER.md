# JATA FOODS build tracker

This tracker is the execution companion to `docs/jata-foods/JATA_FOODS_WHATSAPP_NATIVE_MARKETPLACE_BUILD_ACTIONS.md`.

## Phase 0 — repo audit (NEXT ACTION)
- [ ] Inspect existing WhatsApp adapters/webhooks, OTP, Meta app configuration and channel registry.
- [ ] Inspect Paystack integration, account mapping, supported Kenya payment methods, webhook signature and reconciliation.
- [ ] Inspect Prisma schema, tenant model, outbox/events, AI tool registry, auth/roles, notifications, storage.
- [ ] Map reuse vs new domain; produce evidence-backed architecture inventory.
- [ ] Confirm no existing JATA FOODS domain/schema/feature flags overlap.
- [ ] Create mocks and sandbox fixtures. All new flags OFF.

## Build order
- [ ] 0. Audit + sandbox harness
- [ ] 1. Catalog + customer + consent + basket + order domain
- [ ] 2. WhatsApp menu, order parsing, basket confirmation, quote and order status
- [ ] 3. Supplier lead acquisition + onboarding + verification + RFQ
- [ ] 4. Supply-link sourcing + procurement + inventory/warehouse + batch/expiry
- [ ] 5. Driver onboarding + delivery marketplace + dispatch + POD
- [ ] 6. Paystack sandbox lifecycle, webhook, idempotency and reconciliation
- [ ] 7. Follow-ups, reorder, feedback, referrals, opt-out, templates and caps
- [ ] 8. Analytics, demand forecast, market/supplier trend, margin and delivery density
- [ ] 9. Pilot-readiness security/compliance/operations review

## Gates
- [ ] All feature flags default OFF.
- [ ] No production secrets or live WhatsApp traffic.
- [ ] No live payment, payout, supplier commitment or deployment.
- [ ] Tests and evidence attached to each PR.
- [ ] Explicit PASS/FAIL/BLOCKED/NOT TESTED status.
- [ ] Tenant isolation and financial/security boundaries verified.
- [ ] Human approval remains required for supplier/driver activation, safety exceptions, refunds, payouts, contracts and production enablement.

## Status reporting
Do not mark any task complete without repository code, test output or verifiable provider evidence. A documentation PR is not implementation.
