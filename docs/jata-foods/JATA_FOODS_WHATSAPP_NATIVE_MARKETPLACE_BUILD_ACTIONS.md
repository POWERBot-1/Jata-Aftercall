# JATA FOODS — WhatsApp-Native Marketplace Build Actions

**Status:** Build specification and implementation action plan  
**Product:** JATA FOODS  
**Customer channel:** WhatsApp only (customer-facing)  
**WhatsApp number:** 0724317010  
**Payment:** Paystack rails/Till/payment integration already used by JATA AFTERCALL; reuse only after repository/provider configuration and payment-account mapping are verified. Never invent a Paystack Till ID or treat a Till as an API credential.  
**Brand promise:** YOUR KITCHEN. OUR SUPPLY. / THE KITCHEN NEVER RUNS OUT.  
**Operating market:** Kenya, phased national rollout  
**Repository:** POWERBot-1/Jata-Aftercall  
**Safety:** sandbox-first, fail-closed, no production activation, real WhatsApp sends, live charges, supplier contracts, payouts, deployments or production migrations without explicit owner authorization.

## 0. Product boundary and design originality
Build a WhatsApp-native food supply marketplace with marketplace conventions familiar to users (search, categories, product cards, seller profiles, offers, basket, checkout, order status, ratings, support, repeat order) and a fast, bold, high-density retail experience. Do **not** copy Jumia's logo, trademark, proprietary illustrations, exact page layout, copy, distinctive visual identity, assets, source code, or pixel-level design. Create an original JATA FOODS identity, design system, interaction patterns and content. Inspiration may be limited to broad marketplace usability conventions.

JATA FOODS is not a conventional grocery storefront. It is poultry-first food distribution and hospitality procurement, with an eventual supplier marketplace and delivery network. Start lean with an approved catalogue, validated suppliers and a narrow regional operating footprint; design the system for nationwide expansion.

## 1. Goals
1. Customers can discover, ask, quote, order, confirm, pay, track, repeat, complain and get human help entirely in WhatsApp.
2. Suppliers can apply, submit catalogue/stock/quotes, receive purchase orders, confirm fulfillment and communicate through WhatsApp.
3. Drivers/couriers can apply, be vetted, receive/accept dispatch offers, navigate, confirm pickup/dropoff and submit proof of delivery through WhatsApp.
4. A back-office web console is internal-only for operators, finance, quality, dispatch and owner; it is not a customer shopping channel.
5. Demand/supply, pricing, availability, payments, delivery and customer follow-up data feed auditable analytics.
6. Build on JATA AFTERCALL existing infrastructure, with clean boundaries and tenant-safe design; avoid duplicating WhatsApp OTP webhook, payment adapters or existing messaging primitives.
7. All external actions have explicit policies, idempotency, audit logs, opt-out handling and human approval gates.

## 2. WhatsApp channel
Use official Meta WhatsApp Business Platform/Cloud API only. Reconcile existing WhatsApp adapter/webhook, OTP flow, environment variable names and Autopilot channel readiness before changes. Do not create a duplicate webhook subsystem.

Customer-facing number: **0724317010**. Verify number ownership, WhatsApp Business registration and Meta API eligibility before production. Do not assume this number is already connected to Meta Cloud API. Sandbox uses test WABA/phone or mock adapter.

Channel requirements:
- English and Kiswahili; robust code-switching/Sheng understanding, with confirmation for ambiguous requests.
- Text, supported interactive lists/buttons, product images, catalogue links, location share, voice-note transcription, image/list OCR, order summaries, templates and human handoff.
- Conversation identity linked to a verified phone; customer profiles and business profiles are tenant-safe.
- Respect WhatsApp service-window/template rules, opt-in, opt-out, template approval, messaging rate limits and policy.
- No unofficial WhatsApp Web automation, QR session scraping or consumer account bots.
- Minimize PII; redact logs and never expose secrets or other customers' data.

## 3. Product catalogue and merchandising
Create taxonomy and catalogue lifecycle:
- **JATA POULTRY:** whole chicken; fresh/frozen where clearly labelled; breast, thighs, drumsticks, wings, legs, necks, feet, liver, gizzards, hearts, carcasses; minced/fillets/strips; marinated/processed items only when legal requirements and supplier capabilities are verified.
- **JATA EGGS:** tray/pack sizes, grades/sizes only if verified; batch, source and breakage handling.
- **JATA PANTRY:** potatoes, onions, tomatoes, vegetables, rice, flour, grains, beans, oil, sugar, salt, spices, sauces, seasonings, breading, staples, frozen items.
- **JATA KITCHEN:** food-safe packaging, containers, foil, cling film, serviettes, gloves, hairnets, cleaning supplies, storage and consumables.
- **JATA HOTEL & HOSPITALITY:** institutional bundles, department baskets, contracts and quote-based orders.
- **JATA SELECT:** curated/premium assortment, subject to supplier verification.

Each SKU needs stable ID, name, category, description, images, unit, pack/weight, verified product attributes, price/currency, tax treatment, availability mode, supplier/stock source, lead time, minimum order, region eligibility, substitutions policy, shelf-life/expiry where relevant, lot/batch when relevant, handling/cold-chain, status and timestamps. Distinguish exact weights from estimates and price-per-unit from final weighed price. No AI invents price, quantity, grade, availability or claims.

Catalogue onboarding and publication require approval gates for restricted/high-risk products and compliance/quality checks. Customer sees product-specific and clear availability, fresh/frozen status, unit/pack, price and delivery terms.

## 4. Customer acquisition and ordering
Implement WhatsApp-native paths:
- Entry keywords: MENU, CHICKEN, EGGS, PANTRY, KITCHEN, HOTEL, BULK, QUOTE, REORDER, TRACK, HELP, HUMAN, STOP.
- Guided category browsing using interactive messages where supported.
- Natural-language basket creation and edits.
- Voice notes: speech-to-text, language detection, extraction, then confirm exact parsed basket.
- Image/handwritten list/invoice ingestion: OCR/vision extraction, uncertain items surfaced for correction.
- Smart Basket based on customer-approved purchase history, business type, menu/consumption, frequency, seasonality, budget and available inventory.
- Repeat last order with review; saved baskets; favorites; quantity edits; requested delivery date/time window; location pin.
- B2B quotations and purchase order references; multi-user roles (basket preparer, approver, payer) for hotel accounts.
- Customer account onboarding: customer type, business name (optional/appropriate), delivery location, contacts, preferences, consent, delivery notes, tax/invoice details when required.
- Support English/Kiswahili/code-switching; confirmation summary before creating a committed order.
- Order states: draft → awaiting confirmation → confirmed → sourcing/allocated → picking/packing → awaiting payment/paid (policy-defined) → dispatched → delivered → completed; cancellation, failed payment, partial fulfillment, returns and disputes are explicit states.
- Customer must approve material substitutions, changes to total, split delivery, delivery fee, time window and any credit arrangement.

## 5. Payments — JATA AFTERCALL Paystack
Reuse the existing JATA AFTERCALL Paystack provider integration where architecture and account permissions allow. Payment should settle to the verified JATA AFTERCALL Paystack business account/Till arrangement as intended by the owner. **Verify the actual Paystack account, Till/merchant mapping, payment methods, Kenya availability and credentials; do not assume a Till number is interchangeable with Paystack API credentials or that a particular payment flow is supported.** No new payment account or settlement destination may be silently created.

Build payment orchestration:
- Server-generated immutable order/payment amount and currency (KES).
- Customer confirmation before payment request.
- Provider-hosted/approved payment link or supported channel; WhatsApp sends link/instructions, customer returns to chat.
- Payment intent/reference unique to order; idempotency.
- Verify payment server-side through authenticated provider API and signed webhook, never by screenshot or customer assertion.
- Raw webhook signature validation, replay protection, dedupe and durable event processing.
- Pending, success, failed, cancelled, expired, refund and reconciliation states.
- No order marked paid until verified provider evidence.
- No AI-created charges, refunds, payouts, settlement changes or credit approvals. Financial mutations require deterministic policy and appropriate authorization.
- Daily reconciliation, exception queues and audit trail.
- Sandbox/mock tests only until owner approves live setup.

## 6. Automated supplier discovery and onboarding — Jumia-like marketplace conventions
Use familiar marketplace supplier onboarding conventions without copying Jumia's proprietary design/content:
- Supplier acquisition channels: supplier referrals, farmer/cooperative networks, public business directories and websites, trade associations, county agriculture networks, markets, wholesalers, manufacturer/distributor referrals, consent-based inbound WhatsApp, public professional pages, and approved outbound campaigns.
- Lead capture records source, legal basis/permission, contact, geography, product capability, contact preference, opt-out and timestamp.
- Supplier WhatsApp entry keyword: SUPPLIER / SELL TO JATA / JOIN SUPPLY.
- Application conversational flow: business/person name, contact, county/area, product categories, product specifications, capacity, unit/pack, minimum order, price/price validity, lead time, delivery/collection, payment terms, business documents, food safety/veterinary licences/certificates as applicable, facility photos and traceability.
- Supplier application states: lead → invited → started → submitted → validation → quality review → approved/limited-approved/rejected → active → suspended.
- Supplier identity/document verification and due diligence; duplicate detection; manual review for food safety, high-risk claims, pricing anomalies and initial activation.
- Supplier portal is not required for customer-facing experience; supplier interactions should be WhatsApp-native. Internal staff may use an operations console.
- Supplier catalog/stock updates via structured WhatsApp prompts, templates, API where contracted, and operator import; parse natural language but confirm structured values.
- Supplier terms, commission/fees, contracts, dispute rules, payment terms and promotional placements must be transparent and approved.
- Automated reminders for incomplete applications, expiring documents and stock updates; rate-limited, permission-based and opt-out respected.
- No private-group scraping, harvested personal data, unsolicited bulk WhatsApp blasts, deceptive outreach or fake supplier ratings.

## 7. Supplier sourcing and automated Supply Links
Create **JATA SUPPLY LINK**: a sourcing orchestration service connecting customer demand, JATA stock, suppliers, processors, warehouse/cross-dock, delivery capacity and regional inventory.
- Order-line sourcing: JATA inventory first according to policy, then preferred supplier(s), regionally eligible suppliers and approved backup suppliers.
- Supplier matching scores: landed cost, available quantity, quality/compliance, distance, freshness/batch, delivery SLA, reliability, rejection/return history, cold-chain capability, capacity, current workload and payment terms.
- Calculate landed cost (buy price + transport + handling + cold-chain + packaging + fees + expected loss) and margin floor.
- RFQ/quote requests sent to selected approved suppliers through WhatsApp; suppliers respond with stock, price, validity, lead time and terms. AI parses responses; supplier-confirmed data is stored with provenance and validity.
- Demand pooling: aggregate compatible orders to negotiate bulk purchases; do not violate privacy—supplier receives only required aggregated quantities.
- Cross-dock consolidation for multi-supplier baskets where feasible; calculate consolidation cost and delivery feasibility.
- Substitutions require customer approval if specification, brand, grade, weight, pack, freshness, price or delivery changes materially.
- Automatic purchase orders only when preapproved limits and policies are satisfied; otherwise route for staff approval. No supplier commitments by AI outside authorization.
- Maintain source, supplier, batch, lot, expiry, purchase price, quantity, receiving results and timestamps.
- Supplier scorecard and fraud/quality risk alerts; no automatic exclusion based on opaque model alone.

## 8. Inventory, warehouse and food safety
Build inventory operations for stock-owned and supplier-direct/cross-dock:
- Multi-location, SKU/unit conversion, available/reserved/committed/inbound/quarantined/damaged/expired inventory.
- Reservations and atomic order allocation; prevent overselling.
- Receiving with supplier, PO, lot/batch, quantity, weigh/measure, photos, date, temperature when required, QC result and discrepancy.
- FIFO/FEFO; expiry alerts; shelf-life rules; recall traceability.
- Picking lists, packing, weighing, packaging, dispatch staging, stock adjustments with reason and audit.
- Fresh/frozen/ambient classification; cold-chain validation and transport restrictions.
- Quarantine unsafe, damaged, expired, unverified or temperature-compromised products. Fail closed.
- Recall: trace supplier lot to customer orders, freeze affected inventory, notify owner/quality, prepare approved customer notices and track acknowledgments.
- Food handling, public-health, veterinary, meat-control, county, KEBS and other legal requirements must be reviewed before product/warehouse/processing activation. No claims of compliance until evidence verified.

## 9. Automated delivery marketplace — Uber-like dispatch
Create **JATA DELIVERY** with marketplace-style courier onboarding and dispatch:
- Driver/rider/vehicle applications through WhatsApp keyword DRIVER / DELIVERY PARTNER.
- Collect identity, contact, location, vehicle type/capacity, registration, licences, insurance, availability, delivery radius, cold-chain capability, bank/mobile payment details via secure approved collection, and required food transport training/docs.
- Verification and human activation; maintain driver status, suspension and audit.
- Dispatch job includes pickup(s), dropoff, item type, weight/volume, temperature/handling, deadline, fees, route, customer contact masked where feasible, and proof requirements.
- Eligibility filters before ranking: vehicle capacity, food/cold-chain, region, availability, documentation, route and ETA.
- Matching rank by proximity, ETA, capacity, reliability, acceptance/cancellation, route fit, price and fair rotation.
- Driver receives WhatsApp offer, accepts/rejects within timeout; offer next eligible driver on rejection/timeout.
- Multi-pickup route optimization and consolidation only when quality, safety and ETA permit.
- Pickup verification via order/dispatch code, scan or photo; seal/batch checks where relevant.
- Live location tracking only with consent and during active delivery, with privacy and retention rules. Avoid storing precise location longer than operationally required.
- Customer updates: driver assigned, pickup, ETA, delay, delivered.
- Proof of delivery: recipient OTP/code, photo (where consent and appropriate), timestamp, delivery location evidence and receiver name; no sensitive photos by default.
- Failed delivery, customer unreachable, damaged/missing, temperature breach, return-to-origin and dispute workflows.
- Driver earnings, fees, payment reconciliation, ratings, safety escalation and support.
- No driver payout activation until legal, account, policy, settlement and owner approval gates cleared.
- Cold-chain vehicles required for eligible products; motorcycle only for items and routes allowed by verified policy.
- Delivery pricing is server-calculated and disclosed before order confirmation.

## 10. Customer follow-up, retention and service automation
Implement lifecycle orchestration via WhatsApp, consent/policy-aware:
- Order received and confirmation.
- Payment instructions and payment receipt only after verification.
- Supplier delay and revised ETA.
- Picking/packing notification.
- Dispatch and driver details (minimal).
- Delivery ETA.
- Delivery confirmation.
- Satisfaction/quality feedback.
- Complaint ticket and human handoff.
- Reorder reminders based on product-specific frequency.
- Saved basket reminders.
- Abandoned basket recovery only within policy, limited frequency and consent.
- Customer birthday/seasonal/business occasion only when appropriate and consented.
- Price/stock changes for favorites only with explicit subscription preferences.
- Loyalty/rewards, referrals and account benefits.
- Contract renewal/quote follow-up.
- Invoice/receipt delivery.
- Opt-out and preference centre through WhatsApp commands.

Rules:
- Respect Meta 24-hour customer service window and approved template requirements outside it.
- Consent and opt-out are first-class records.
- Frequency caps, quiet hours, suppression lists, delivery status and campaign attribution.
- STOP/UNSUBSCRIBE immediately suppresses marketing; transactional notices follow legal/policy basis.
- AI drafts follow-ups but templates, eligibility and send policy are deterministic.
- Do not use manipulative urgency, fabricated scarcity or misleading offers.

## 11. Customer acquisition & referral channels (WhatsApp-first)
- Click-to-WhatsApp entry points from approved social posts, QR codes, packaging, flyers, supplier referrals and offline signage.
- Referral codes for customers, suppliers and delivery partners.
- Business type segmentation: hotel, restaurant, caterer, school, institution, butcher, retailer, household.
- Conversational onboarding, sample basket, quote and first-order incentives (approved and margin-safe).
- Campaign audience is consent-based; no bulk unsolicited messaging.
- Attribution: source, campaign, referral, conversion, order value, contribution margin, repeat rate and cohort.
- Automated referral reward only after fraud checks and eligible completed order; human-approved programme terms.

## 12. Market, customer and trend intelligence
Create a data warehouse/analytics layer from lawful first-party transactions and approved supplier data:
- Product/customer/region demand trend.
- Search/request-with-no-stock trends.
- Basket affinity and cross-sell.
- Customer purchase frequency, churn risk and repeat interval.
- Hotel/restaurant segment differences.
- Supplier price movements and quote dispersion.
- Regional availability and shortages.
- Seasonality, holidays, events, weather only from lawful sources and with validated relevance.
- Chicken cut demand imbalance, yield and waste.
- Egg demand/price trends.
- Delivery cost, density, SLA and route profitability.
- Promo elasticity and margin impact.
- Competitor/public price intelligence only from lawful, public, properly collected sources; no competitor private data or unauthorized scraping.
- Supplier quality/reliability trends.
- Forecast confidence and uncertainty.

Outputs:
- Weekly demand forecast.
- Procurement recommendations.
- Stockout risk.
- Price movement alerts.
- Waste/expiry forecast.
- New SKU recommendations.
- Customer churn alerts.
- Region expansion recommendations.
- Supplier acquisition priorities.
- Delivery density heatmap.
- Contribution margin dashboard.

AI may recommend; financial/product price changes, supplier commitments, promotions, credit, contracts and operational actions require bounded rules and approval. Provide source lineage, confidence, explanations, bias checks and manual overrides.

## 13. Customer profiles and B2B procurement
Support:
- Household.
- Restaurant.
- Hotel/lodge.
- Caterer.
- Butchery.
- Retailer.
- School/institution.
- Hospital/organization.
- Distributor.

Features:
- Verified business profiles and optional VAT/tax/invoice fields.
- Delivery locations.
- Multiple WhatsApp contacts and authorized roles.
- Saved baskets.
- Department budgets and approval steps.
- Purchase-order number.
- Quotations with expiry.
- Contract pricing and price lists.
- Invoice and receipt history.
- Scheduled deliveries.
- Order limits and credit only if separately approved and legally compliant.
- Account-specific SLA.
- Consolidated spend summaries.
- Procurement analytics and repeat baskets.

## 14. Pricing, margin and marketplace economics
- Server-authoritative prices, tax rules, discounts, fees and delivery charges.
- Product unit/weight/pack clarity.
- Supplier price validity timestamps.
- Price history and audit.
- Customer tier/contract pricing.
- Wholesale volume bands.
- Marketplace commissions/fees with transparent supplier agreements.
- Promotion engine with maximum discount, margin floor, budget and expiry.
- No unapproved dynamic price discrimination or AI price mutation.
- Unit economics per delivered order, SKU, supplier, route and customer segment.

Contribution margin calculation must include purchase cost, processing, packaging, handling, cold chain, delivery, payment fees, discounts, spoilage, returns and support costs. Do not optimize gross sales alone.

## 15. Payments, finance and reconciliation
Use JATA AFTERCALL's existing Paystack integration and account only after the current account/Till mapping and provider capabilities are confirmed.
- KES order amounts and supported payment methods.
- Payment request, order reference, customer WhatsApp instructions/link.
- Signed provider webhook, server verification, dedupe and replay protection.
- Payment status and ledger events; order cannot be paid from screenshots/chat assertions.
- Refunds and reversals are approval-controlled and auditable.
- Reconciliation of orders, provider transactions, fees, settlements and exceptions.
- Supplier payables, delivery partner payables and marketplace commissions tracked separately.
- Payouts disabled until owner-approved finance policy, compliance and reconciliation gates pass.
- No payment credentials in chat, logs or source code; no API secrets sent to suppliers/drivers/customers.
- Never assume a Paystack Till number alone enables API payment collection; verify provider/account setup and supported payment flow.

## 16. AI agents and next-generation models
Implement bounded agents behind a shared orchestration layer, each with narrow tool access and policy enforcement:
1. Customer Sales & Order Agent — browse approved catalog, draft baskets, quote server-calculated price, order status, reorder.
2. Kitchen Replenishment Agent — forecast, propose baskets and reminders; no auto-charge.
3. Poultry Yield & Cut Intelligence — demand balancing, yield/waste insights; recommendations only.
4. Supplier Discovery Agent — find public/authorized supplier leads, deduplicate, draft consent-respecting outreach, score coverage.
5. Supplier RFQ Agent — request quotes from approved suppliers, parse offers, create comparison; purchase commitment approval gate.
6. Procurement Agent — source recommendations, PO drafts, bounded auto-PO only with explicit owner policy and limits.
7. Delivery Dispatch Agent — candidate ranking and offers; safety eligibility deterministic.
8. Customer Retention Agent — feedback/reorder suggestions, consent, caps, suppression.
9. Market Intelligence Agent — trends, forecasts, supplier price analysis, stockout/waste risk.
10. Customer Support Agent — issues, refunds request intake, escalation; cannot issue refund or alter payment.
11. Quality & Recall Agent — traceability, quarantine alerts, draft notices; human quality approval.
12. Finance Reconciliation Agent — explain mismatches and create exception queue; no payout/settlement changes.

Use a model-agnostic adapter so models can be swapped. Model selection must be based on measured accuracy, latency, cost, language coverage, privacy and tool safety. Keep deterministic inventory, prices, payments, dispatch eligibility, permissions and policy checks outside LLM control. Evaluate agent quality with Kenyan English/Kiswahili/Sheng test suites, adversarial tests, hallucination checks and regression benchmarks.

## 17. JATA AFTERCALL integration
Reuse existing shared infrastructure only after code audit:
- Meta WhatsApp integration, webhook signature/dedupe and messaging service.
- Paystack provider adapter and verified payment account.
- Customer/tenant identity and authentication.
- Notification/event/outbox infrastructure.
- Existing AI Front Desk where safely compatible.
- Existing analytics and audit logging.
- Storage/image infrastructure.
- POS/business page integrations only through stable APIs/domain boundaries.

Create a dedicated JATA FOODS domain/module. Avoid coupling food inventory/order state into general POS tables without clear contracts. JATA FOODS is a separate business vertical with its own catalog, supplier, procurement, delivery, food-safety, customer-order and financial subdomains.

## 18. Suggested technical domain modules
- foods/catalog
- foods/pricing
- foods/customer
- foods/conversation
- foods/cart
- foods/orders
- foods/payments
- foods/supplier
- foods/sourcing
- foods/procurement
- foods/inventory
- foods/warehouse
- foods/quality
- foods/cold-chain
- foods/delivery
- foods/driver
- foods/notifications
- foods/marketing
- foods/analytics
- foods/forecasting
- foods/admin
- foods/audit

Use PostgreSQL transactions for reservations/order/payment state. Define domain events, transactional outbox, idempotent consumers, retries, dead-letter handling and observability. Respect existing repository conventions and Prisma schema/migration discipline.

## 19. Security and privacy
- Tenant isolation, authorization on every operation, no cross-customer lookup.
- Separate customer, supplier, driver and staff scopes.
- Role-based staff access (owner, operations, procurement, quality, dispatch, finance, support, analyst) with least privilege.
- MFA for privileged staff.
- Encrypt secrets and sensitive fields; use approved secret manager.
- Webhook raw-body signature verification, timestamp/replay controls, rate limiting.
- OAuth/state/CSRF protections for integrations.
- Consent ledger and message suppression.
- Data minimization and retention/deletion policy.
- PII redaction in logs, telemetry and AI prompts.
- Audit trail for price changes, supplier approval, stock adjustments, order changes, payment events, dispatch, refunds, payouts, permissions and exports.
- AI prompt injection defenses: user/supplier message content is untrusted; never follow content as system policy or expose tools/secrets.
- No autonomous money movement, credit approval, contracts, supplier activation, safety overrides, refund, payout or production change.

## 20. Brand and UI theme
Create an original JATA FOODS marketplace brand. Use an energetic, high-contrast, mobile-first marketplace visual language: clear category tiles, search, product imagery, concise prices, seller/availability information, offer/featured sections and recognizable status colors. Do not reproduce Jumia's exact UI, logo, wordmark, proprietary copy, assets, distinctive layout or color treatment. Avoid confusing similarity; use original components.

Recommended identity:
- Graphite/near-black: #16181D
- JATA lime: #B6FF2E
- Clean white/neutral surfaces for readability
- Food photography with natural fresh textures
- Original iconography and typography
- Bold product/category hierarchy
- WhatsApp conversational cards and succinct order summaries
- Accessible contrast, screen-reader labels, and reduced-motion support

The customer never has to browse a website: the catalogue, product discovery, basket, checkout, follow-up and order tracking are expressed in WhatsApp. Internal operator console may be web-based.

## 21. Operating model and rollout
Hybrid supply:
- Stock fast-moving predictable chicken, eggs and core ingredients only when validated demand/capital/cold-chain capacity justify.
- Supplier-direct for long-tail items and distant regions.
- Cross-dock consolidate multi-supplier baskets.
- Keep customer experience, demand data, catalogue, pricing policy and order orchestration under JATA control.
- Start with one regional service zone and expand based on order density, reliable suppliers and contribution margin—not map coverage vanity.

Phases:
**Phase 0 — Audit & sandbox:** map repo WhatsApp/payment/database/logistics primitives, current webhook/OTP, test harness, existing env vars; feature flags OFF.
**Phase 1 — Foundation:** domain schema, catalogue, customer profile, consent, order states, audit, outbox and tests.
**Phase 2 — Customer WhatsApp commerce:** menu, discovery, basket, quote, order confirmation, mock checkout, support.
**Phase 3 — Supplier marketplace:** supplier application, verification workflow, catalog/stock/quotes, supplier matching and RFQ.
**Phase 4 — Inventory/warehouse/food safety:** stock ledger, receiving, reservations, batch/expiry, quarantine, picking/packing.
**Phase 5 — Delivery network:** courier application, eligibility, dispatch, tracking, POD, failed delivery, mock driver sandbox.
**Phase 6 — Paystack sandbox:** existing adapter/account mapping audit, payment links/intent, webhook, idempotency, reconciliation and test lifecycle.
**Phase 7 — Follow-up & marketing:** opt-in, templates, frequency caps, reorders, feedback, referral and suppression.
**Phase 8 — Intelligence:** trend dashboards, forecasts, supplier price, stockout, waste, basket, route and contribution margin.
**Phase 9 — Regional pilot readiness:** legal/food safety/provider/quality review, operational runbook, incident and rollback, owner approval.
No phase enables production by default. Each phase requires tests and evidence.

## 22. Sandbox-first engineering action plan
Repository implementation begins with audit and mocked integrations:
- Identify existing WhatsApp adapter, webhook, tenant model, Paystack integration, Prisma models, event/outbox, notifications and AI tool registry.
- Confirm branch base and avoid unrelated changes.
- Use mock WhatsApp transport, fake supplier, fake inventory, fake driver, fake payment provider and synthetic customers.
- No production credentials or live provider calls in tests.
- No production DB or schema migration.
- No Vercel deployment or production activation.
- Build schema and domain tests; add integration tests using disposable local/test DB if supported.
- Use contract tests for provider adapters.
- Verify tenant isolation, dedupe, idempotency, replay, race conditions, order totals, inventory reservation, failed payment, refund permissions, supplier approval, cold-chain dispatch rules, opt-outs and message caps.
- Do not add new paid services or libraries unless reviewed for necessity, licensing, maintenance and security.
- Do not duplicate existing subsystems; adapt existing interfaces.

## 23. Required acceptance tests and evidence
Must include and report PASS/FAIL/BLOCKED/NOT TESTED, with command, output and evidence:
- WhatsApp webhook signature valid/invalid; raw-body handling.
- Dedupe repeated events; replay attack blocked.
- Unknown customer safely onboarded.
- Tenant isolation: cross-tenant order/customer/supplier access denied.
- Natural language, Swahili, Sheng, voice and OCR order parsing with confirmation.
- AI hallucinated SKU/price/stock blocked by server.
- Unit conversion and basket total correctness.
- Concurrent stock reservation prevents oversell.
- Supplier lead duplicate and opt-out suppression.
- Supplier application unapproved cannot offer/fulfill.
- RFQ quotes have source and validity; invalid quote rejected.
- Substitution requires approval.
- Purchase order threshold approvals enforced.
- Payment webhook signature, replay, dedupe and idempotency.
- Fake payment never marks order paid without verified event.
- Paystack test payment success/failure/expiry/reconciliation; no live payment.
- Driver/vehicle eligibility; cold-chain ineligible vehicle blocked.
- Dispatch acceptance race; only one driver assigned.
- Pickup and POD evidence; failed delivery/return workflow.
- Marketing consent, template/window rules, caps, STOP immediate suppression.
- Follow-up retries idempotent and rate-limited.
- Supplier/customer trends use valid data and provenance.
- Recall lot traceability and quarantine.
- Role permissions, MFA requirement and audit trail.
- Accessibility/mobile WhatsApp content readability.
- Unit, integration, lint/typecheck and relevant repository regression tests.

## 24. Feature flags and production gates
All new flags default OFF, including:
- JATA_FOODS_ENABLED
- JATA_FOODS_WHATSAPP_COMMERCE_ENABLED
- JATA_FOODS_SUPPLIER_NETWORK_ENABLED
- JATA_FOODS_PROCUREMENT_ENABLED
- JATA_FOODS_INVENTORY_ENABLED
- JATA_FOODS_DELIVERY_ENABLED
- JATA_FOODS_DRIVER_ONBOARDING_ENABLED
- JATA_FOODS_PAYMENTS_ENABLED
- JATA_FOODS_MARKETING_ENABLED
- JATA_FOODS_AI_AGENTS_ENABLED
- JATA_FOODS_ANALYTICS_ENABLED

Flag names are proposed; reconcile with repo conventions before introducing them. Fail closed when required configuration is missing. Sandbox can use mocks without secrets.

## 25. Owner controls
Owner can:
- Pause customer ordering.
- Pause supplier onboarding.
- Pause procurement.
- Pause dispatch.
- Pause marketing/follow-ups.
- Pause AI agents.
- Set permitted regions.
- Set margin floors.
- Set auto-PO ceilings (default zero).
- Set message caps.
- Approve suppliers/drivers.
- Approve products and quality standards.
- Approve templates/campaigns.
- Review financial exceptions.
- Export operational data with audit.

No AI or staff role may silently grant owner authority, alter payment destination, enable production flags, change payout rules, bypass verification or deploy live.

## 26. Deliverables
Build in incremental pull requests, not one risky mega-merge:
1. Repository/domain audit and architecture map.
2. Sandbox harness and feature flags.
3. Catalog/customer/order schema and APIs.
4. WhatsApp customer order flow.
5. Supplier onboarding/acquisition and RFQ.
6. Inventory/procurement/supply-link engine.
7. Delivery/driver marketplace.
8. Paystack sandbox payment lifecycle and reconciliation.
9. Follow-ups/consent/referral.
10. Analytics/forecasting and operational dashboards.
11. Compliance, security, test and pilot readiness review.

Each PR must contain: scope, files changed, migrations (if any), tests, command outputs, risks, rollout/rollback, feature-flag status, PASS/FAIL/BLOCKED/NOT TESTED, and proof. Keep PRs draft until gates pass. No merge or deployment in this directive.

## 27. Definition of Done
JATA FOODS is ready for a controlled pilot only when:
- Customer can discover, order, confirm, pay in sandbox, track and reorder via WhatsApp.
- Supplier can apply and submit products/quotes via WhatsApp; approval gates work.
- Supply matching and procurement drafts are correct and explainable.
- Driver can apply, accept dispatch, pickup, track and deliver in sandbox.
- Payment verification and reconciliation pass.
- Follow-ups are consent/policy compliant.
- Stock, batch, expiry, quality and cold-chain controls pass.
- Analytics provide actionable trends with lineage.
- Tenant security, privacy, idempotency, audit, failure handling and regression gates pass.
- Legal, food safety, licensing, provider, finance and operations evidence reviewed.
- Production is explicitly owner-approved; until then all live flags remain OFF.

**Build priority:** WhatsApp-first order and customer value, supplier reliability, payment safety, delivery reliability, repeat orders, and contribution-margin discipline. Do not expand nationally before a regional pilot demonstrates operational reliability and positive unit economics.
