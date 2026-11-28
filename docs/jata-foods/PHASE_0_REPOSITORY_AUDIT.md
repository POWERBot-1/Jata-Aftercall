# JATA FOODS — Phase 0 Repository Audit (Initial Evidence)

**Audit scope:** GitHub default branch `main`, inspected through repository file APIs on 2026-11-28. This is a bounded initial audit, not a complete repo review.  
**Status:** PARTIAL / CONTINUE AUDIT

## Verified repository facts
- Next.js/TypeScript application; package scripts include `build`, `lint`, `typecheck`, `test`, database migration tests and browser checks.
- Prisma/PostgreSQL is the primary persistence layer; `DATABASE_URL` pooled and `DIRECT_URL` direct are configured in schema.
- Existing official Meta WhatsApp Cloud API adapter: `lib/messaging/meta-whatsapp.ts`.
- Existing WhatsApp webhook route: `app/api/webhooks/meta-whatsapp/route.ts`.
- Existing webhook module: `lib/messaging/meta-whatsapp-webhook.ts`. Current inspected route is designed around Meta status callbacks and the existing phone-verification challenge flow; it is not yet evidenced as a full inbound customer-commerce webhook.
- Existing Meta WhatsApp provider is gated by configuration and template rules; outbound adapter shown supports authentication-template sending, not general catalog/chat commerce.
- Existing supplier/procurement/ERP concepts exist: `lib/erp/procurement.ts`, ERP supplier/procurement pages, approvals and audit-related modules. Their suitability for JATA FOODS multi-supplier marketplace must be evaluated before reuse.
- Existing payment provider and orchestration: `lib/payments/providers/paystack.ts`, `lib/payments/config.ts`, `lib/payments/orchestrator.ts`, `lib/payments/destinations.ts`; existing Paystack webhook: `app/api/payments/webhooks/paystack/route.ts`. A provider payment can be re-used only after account/destination configuration and sandbox lifecycle evidence are confirmed.
- Existing ERP industry pack references dispatch/delivery/drivers as scoped capabilities, while a code excerpt explicitly reports live courier API adapters as not connected. This is not evidence of a functioning JATA FOODS Uber-like courier marketplace.
- Existing communication/campaign engine and consent/suppression concepts exist, but the repo search evidence does not establish a complete WhatsApp customer-conversation inbox/order automation flow for JATA FOODS.
- The package has no standalone JATA FOODS commerce domain verified in this initial inspection.

## Architectural implications
1. Extend the existing Meta integration with a properly scoped inbound messaging adapter and webhook event pipeline; do not replace the OTP flow or duplicate signature verification. Reconcile existing configuration and phone-number ownership.
2. Reuse the existing payment provider/orchestrator/webhook, but build a JATA FOODS order/payment domain adapter with its own idempotent references and sandbox tests. Do not bypass financial gates.
3. Existing ERP supplier, procurement and approvals are potential building blocks. Avoid creating parallel supplier/approval abstractions until their tenant, product, supplier and event contracts are reviewed.
4. Driver/dispatch capability appears scoped rather than connected to a real provider. Build an independent sandbox driver dispatch domain and provider abstraction; no live courier activation.
5. Before any implementation migration, review existing schema conventions, tenant relations, idempotency patterns, audit events, outbox/notification, feature-flag controls, test DB harness and migration safety.

## Initial statuses
- **PASS (limited evidence):** repo/package and Prisma structure inspected; named existing WhatsApp and Paystack integration files exist.
- **BLOCKED:** full inbound WhatsApp commerce messaging capability not yet verified; the inspected adapter handles authentication templates.
- **BLOCKED:** Paystack account/Till mapping, intended settlement destination and supported WhatsApp checkout/link flows not verified.
- **BLOCKED:** live driver marketplace/courier APIs not verified and existing ERP evidence describes courier adapters as not connected.
- **NOT TESTED:** no source code modified in this audit, no unit/integration/browser tests executed, no sandbox provider traffic, no migrations, no live messages, no payment, no deployment.
- **NEXT:** inspect exact Prisma tenant/domain models and existing ERP supplier/procurement/approval modules; then produce a reuse matrix and start the first implementation PR: sandbox-only catalog/customer/order primitives and tests with flags off.

## Safety
This audit used source inspection only. No secrets were read, no production database was accessed, no provider calls were made, no tests were run, no migration was executed and no deployment occurred.
