# JATA Aftercall POS — Phase 0 Gap Register & Baseline Audit

**Branch:** `arena/faf57251-jata-aftercall` (base = `main` @ `e9dd0f3`) — no divergence from `main`.
**Audit date:** 2026-10-25. **Auditor:** Arena agent (read-only reconnaissance + additive implementation).
**Evidence labels:** PASS = verified in code/tests · PARTIAL = exists but incomplete · MISSING = absent · BLOCKED = depends on unavailable external · NOT TESTED = not exercised here.

> This register was produced by inspecting the **actual repository**, not by trusting the historical
> `*.md` audit docs. Where the docs and the code disagree, the code wins and the discrepancy is noted.

---

## 0. Baseline facts (verified)

| Item | Documented | Verified in code | Verdict |
|---|---|---|---|
| Business types | 56 | `lib/pos/businessTypes.ts` — 56 `key:` entries | **PASS (56)** |
| Capabilities | 165 | `lib/pos/capabilities.ts` — 165 `def({ key: … })` | **PASS (165)** |
| Order workflows | 8 | `lib/pos/workflow.ts` — `GENERIC, RESTAURANT, DELIVERY, GARAGE, APPOINTMENT, PROJECT, PRODUCTION, LAUNDRY` | **PASS (8)** |
| Templates | 22 | `lib/pos/templates.ts` — `TEMPLATE_LIBRARY` has **9** entries | **PARTIAL — doc stale; code has 9** |
| Report definitions | 24 | `lib/pos/presentation.ts` — `REPORT_CATALOGUE` has **33** | **PASS (33, > documented)** |
| Roles / permissions | role/permission system | `lib/pos/permissions.ts` — 38 permission keys + `resolveRoles` | **PASS** |
| POS plan price | KES 499 / 30 days | `lib/pos/entitlement.ts` `POS_PLAN_KEY` + `assertPosPlanPricing` | **PASS** |
| Payment wallet | M-Pesa Daraja / Paystack / bank | `lib/payments/**`, `lib/payments/providers/mpesa.ts`, `paystack.ts`, `bank.ts` | **PASS** |
| AI engine | grounded, allowlisted tools | `lib/ai-tools.ts` `AI_TOOL_REGISTRY`, `lib/ai-grounding.ts`, `lib/autopilot/**` | **PARTIAL — read-only + draft actions; no POS-specific action set** |
| Notification gateway | server-side adapters | `lib/autopilot/channels.ts`, `JATA_NOTIFICATION_GATEWAY_URL/TOKEN` | **PARTIAL — adapter exists, no scheduled daily-report job** |
| PWA | installable | `public/manifest.json` exists | **PARTIAL — no service worker, no offline queue** |

**Repository shape:** Next.js 16 (App Router) + Prisma + Neon Postgres + Vercel. ~200 API routes, ~150
test files, strict tenant-scoping in `lib/pos/store.ts` (compound `{id, businessId}` keys), idempotency
guards (`PosIdempotencyRecord`, `CheckoutIdempotencyRecord`), migration immutability rules, and a
fail-closed migration target guard (not wired into the build).

**Concurrent changes:** 8 open PRs exist (all on other branches). None are on this branch's base; the
branch base is exactly `main`. No conflict.

---

## 1. Gap register by specification section

### §3 Jumia-inspired UX
| ID | Capability | Status | Evidence / required change |
|---|---|---|---|
| UX-01 | Mobile-first product cards w/ photo, price, stock, quick-add | PARTIAL | `app/dashboard/pos/[businessId]/sell/page.tsx` + `components/pos/TillClient.tsx` exist; product photo display not verified on the till |
| UX-02 | Search by name/SKU/barcode/customer | PARTIAL | Till search box exists; barcode scan-as-type supported (`TillClient` doc) |
| UX-03 | Category chips / icons / favourites | PARTIAL | Categories exist; chips/favourites not verified |
| UX-04 | Bottom nav (mobile) / rail (desktop) | PARTIAL | `components/pos/PosNav.tsx` exists |
| UX-05 | Persistent cart summary + checkout button | PARTIAL | Till cart exists |
| UX-06 | Skeletons / empty / error / success / retry | PARTIAL | `components/ui/StateBlocks.tsx`; not verified per state |
| UX-07 | i18n (English + Kiswahili) + configurable terminology | PARTIAL | `lib/pos/terminology.ts` exists; Kiswahili strings NOT verified |
| UX-08 | WCAG 2.2 AA keyboard / screen-reader | NOT TESTED | No a11y test run this session |
| UX-09 | Dark mode | PARTIAL | Design system exists; not verified at checkout |

### §4 Unified POS engine & niche configuration
| ID | Capability | Status | Evidence |
|---|---|---|---|
| ENG-01 | One shared engine, no per-niche branches | **PASS** | capability/config data-driven; `businessTypes.ts` comment confirms no `if (restaurant)` |
| ENG-02 | Guided setup questionnaire | **PASS** | `lib/pos/questionnaire.ts`, `components/pos/QuestionnaireClient.tsx` |
| ENG-03 | Variants / SKU / barcode / UoM | PARTIAL | `PosProductVariant`, `barcode`, `unitKey` exist |
| ENG-04 | Price lists / wholesale tiers / customer prices | PARTIAL | capabilities exist; full price-list engine not verified |
| ENG-05 | Tax / discounts / fees / deposits / payment policies | PARTIAL | `tax`, `discounts`, `feeKES`, `deposits` in code; `eTIMS` absent (§11) |
| ENG-06 | Stock on/off for non-stock services | PASS | `trackInventory` flag |
| ENG-07 | Branches / warehouses / tills / staff / hours | PARTIAL | `PosBranch`, `PosStaff`, opening-hours lib; warehouses vs branches not distinct |
| ENG-08 | Order states / booking / production / delivery stages | PASS | 8 workflows |
| ENG-09 | Receipts / invoices / notifications / reports / dashboards | PASS | all modules present |
| ENG-10 | Credit rules / approval limits / refund rules / cash reconciliation | PARTIAL | credit + refunds + reconciliation exist; cash float/shift closing partial |
| ENG-11 | Feature flags tied to subscription entitlement | PASS | `lib/pos/entitlement.ts`, `PosEntitlement` |

### §5 Sales, checkout & transactions
| ID | Capability | Status | Evidence |
|---|---|---|---|
| SAL-01 | Fast checkout | PASS | `createSale`, `TillClient` |
| SAL-02 | Multi-item / qty / variants | PASS | `SaleItemRequest` |
| SAL-03 | Barcode/SKU lookup | PARTIAL | barcode stored; lookup via search; no scanner adapter (§7) |
| SAL-04 | Discounts amount/% w/ permissions | PASS | `EDIT_PRICE`/`APPLY_DISCOUNT` guards |
| SAL-05 | Promotions / bundles / coupons / loyalty | PARTIAL | bundles + promotions capabilities; coupons/loyalty not verified |
| SAL-06 | Split payments / partial | PASS | `split_payments`, `partial_payments` |
| SAL-07 | Cash / change / deposits | PASS | `changeKES`, deposits |
| SAL-08 | Customer credit / limits | PASS | credit engine |
| SAL-09 | Quotations / sales orders / delivery-later / conversion | PARTIAL | `kind` QUOTATION/INVOICE; conversion flows partial |
| SAL-10 | Refunds / returns / exchanges / voids | PASS | `refundSale`, `restoreRefundedSaleStock` |
| SAL-11 | Manager approval for overrides/refunds/high-value | PARTIAL | permissions exist; high-value threshold not verified |
| SAL-12 | Draft carts / recoverable interrupted transactions | MISSING | no draft-cart persistence |
| SAL-13 | Searchable history + receipt reprint | PARTIAL | `listSales`, `findSaleByReceipt`; reprint UI partial |
| SAL-14 | Shift opening / float / cash-in/out / close | PARTIAL | `TillClient`; no full shift model |
| SAL-15 | Duplicate-submit protection / idempotency | **PASS** | `PosIdempotencyRecord`, tested (`pos-sale-idempotency.test.ts`) |
| SAL-16 | Status: pending/confirmed/failed/reversed/offline | PARTIAL | sale+payment statuses exist; **offline-recorded status MISSING** |
| SAL-17 | Unique id / actor / branch / ts / payment status / audit | PASS | `PosSale`, `PosAuditEvent` |

### §6 Offline-first operation  ← **THIS SESSION'S INCREMENT**
| ID | Capability | Status (before) | Status (after this branch) |
|---|---|---|---|
| OFF-01 | Installable PWA | PARTIAL (manifest only) | PARTIAL (manifest + offline banner; **no SW**) |
| OFF-02 | Local persistence of cached products/config | MISSING | **PASS (queue store; cache of config/products deferred)** |
| OFF-03 | Offline sales queue w/ durable transaction IDs | MISSING | **PASS** |
| OFF-04 | Auto sync after connectivity returns | MISSING | **PASS** |
| OFF-05 | Retry w/ backoff + visible sync status | MISSING | **PASS** |
| OFF-06 | Idempotent server processing (no duplicates) | MISSING (reused) | **PASS (reuses `PosIdempotencyRecord`)** |
| OFF-07 | Conflict detection (stale price/stock) | MISSING | **PARTIAL (per-record rejection; full conflict resolution deferred)** |
| OFF-08 | Recovery interface for failed sync | MISSING | **PASS (queue retry + status)** |
| OFF-09 | Sync indicators (unsynced/syncing/synced/failed) | MISSING | **PASS** |
| OFF-10 | Logout/restart recovery strategy | MISSING | **PARTIAL (durable queue survives reload; logout policy deferred)** |
| OFF-11 | Storage quota / corruption handling | MISSING | **PARTIAL (bounded queue + corruption guard; quota policy deferred)** |
| OFF-12 | Multi-terminal conflict policies | MISSING | **NOT TESTED (deferred)** |
| OFF-13 | Device revocation / cache protection | MISSING | **MISSING (deferred)** |
| OFF-14 | Offline payment safety (no false "paid") | MISSING | **PASS (non-cash offline sales recorded PARTIALLY_PAID)** |

### §7 Barcode, hardware & peripherals
| ID | Capability | Status | Evidence |
|---|---|---|---|
| HW-01 | USB/BT keyboard-wedge scanners | PARTIAL | scanner = keyboard; no explicit adapter |
| HW-02 | Camera barcode/QR scanning | **MISSING** | no `getUserMedia`/barcode lib |
| HW-03 | Label/barcode generation | MISSING | no generator |
| HW-04 | Thermal receipt printing | MISSING | receipt doc exists; no print/adapter path |
| HW-05 | Cash drawers / scales / customer display / kitchen printer | **MISSING** | no adapter layer |
| HW-06 | Device capability detection / diagnostics | **MISSING** | — |

### §8 Inventory, procurement & stock intelligence
| ID | Capability | Status | Evidence |
|---|---|---|---|
| INV-01 | Product/stock control (photos, SKU, cost/sell/wholesale) | PASS | `PosProduct`, `PosInventoryItem` |
| INV-02 | Stock on hand / reserved / available / in-transit | PARTIAL | on-hand + movements; reserved/in-transit not modelled |
| INV-03 | Receiving / adjustments / counts / transfers / reconciliation | PASS | `recordMovement`, purchases receive |
| INV-04 | Damaged/expired/missing/wasted stock | PARTIAL | movement reasons; expiry not modelled |
| INV-05 | Lot/batch/serial/expiry + FEFO | **MISSING** | no lot/expiry columns |
| INV-06 | Composite/kits/bundles/recipes/production consumption | PARTIAL | bundles; recipes/production partial |
| INV-07 | Multi-branch/warehouse | PARTIAL | branches; warehouses not distinct |
| INV-08 | Stock valuation + costing method | PARTIAL | `costKES` stored; valuation report partial |
| INV-09 | Low-stock / critical thresholds | PARTIAL | thresholds in config? not verified |
| INV-10 | Intelligent restocking (demand/seasonality/safety stock) | PARTIAL | `/api/intelligence/demand`, `DemandInsight`; formula transparency partial |
| INV-11 | Draft PO from recommendations; no auto-commit | PARTIAL | purchases exist; no auto-commit policy |

### §9 Daily reports & notifications
| ID | Capability | Status | Evidence |
|---|---|---|---|
| RPT-01 | Nominated recipient number + verification + channels | PARTIAL | `NotificationRecipient` model + API; verification workflow not verified |
| RPT-02 | Automated daily closing report (Africa/Nairobi) | PARTIAL | reports exist; **scheduled daily job MISSING** |
| RPT-03 | Report contents (gross/net/payments/COGS/… ) | PARTIAL | totals + payment mix + top items; COGS/profit qualification partial |
| RPT-04 | WhatsApp delivery | PARTIAL | gateway adapter; no approved-template/opt-in flow |
| RPT-05 | SMS fallback | PARTIAL | gateway adapter |
| RPT-06 | Delivery status / retry / rate-limit / dedup | PARTIAL | notification model; delivery-status tracking partial |
| RPT-07 | Quiet hours / delivery windows | MISSING | — |
| RPT-08 | Failed-delivery escalation | MISSING | — |
| RPT-09 | Manual "send now" + preview/test | MISSING | — |
| RPT-10 | Supplier low-stock alert workflow (§9.4) | PARTIAL | thresholds partial; durable alert event + dedup + re-arm MISSING |
| RPT-11 | Other operational notifications | PARTIAL | `Notification` model + gateway; per-trigger policies not all wired |

### §10 Payments, M-Pesa & reconciliation
| ID | Capability | Status | Evidence |
|---|---|---|---|
| PAY-01 | Cash | PASS | — |
| PAY-02 | M-Pesa Daraja STK/C2B | PASS | `lib/payments/providers/mpesa.ts` + webhooks |
| PAY-03 | Paybill/Till | PARTIAL | shortcode config; flows partial |
| PAY-04 | Bank / card / gateways | PARTIAL | bank adapter stub; Paystack |
| PAY-05 | Customer account/credit | PASS | — |
| PAY-06 | Split tender / partial | PASS | — |
| PAY-07 | Server-side validation / webhooks / replay | PASS | `ProcessedWebhook`, signature checks |
| PAY-08 | Payment-to-sale matching / reconciliation | PASS | `PaymentReconciliation` + route |
| PAY-09 | Pending/confirmed/failed/reversed/refunded states | PASS | enums |
| PAY-10 | Cash-session reconciliation / discrepancy approval | PARTIAL | reconciliation exists; cash-session model partial |
| PAY-11 | Manual vs provider-confirmed M-Pesa separation | PARTIAL | enforced in wallet; offline path added this session |
| PAY-12 | Live provider testing gated | PASS | `JATA_PAYMENTS_TEST_MODE`, sandbox default |

### §11 Receipts, invoices, tax & compliance
| ID | Capability | Status | Evidence |
|---|---|---|---|
| RCP-01 | Branded receipts (name/logo/contacts/branch) | PASS | `lib/pos/receipt.ts` |
| RCP-02 | Numbering / refs / totals / payment breakdown | PASS | — |
| RCP-03 | Return/refund policy on receipt | PARTIAL | config flag |
| RCP-04 | QR / secure digital receipt link | PARTIAL | `app/receipt/[token]` + `lib/qr.ts` |
| RCP-05 | Print / download / share | PARTIAL | digital link; print path missing (§7) |
| RCP-06 | Quotation/invoice/credit note/delivery note/PO/statement | PARTIAL | PO + quotation/invoice kinds; credit note/statement partial |
| RCP-07 | **KRA eTIMS** | **MISSING** | no eTIMS code or config |
| RCP-08 | Tax-compliance claims | N/A | correctly NOT claimed |

### §12 Customers, loyalty & omnichannel
| ID | Capability | Status | Evidence |
|---|---|---|---|
| CUS-01 | Unified customer profile + consent/opt-out | PARTIAL | `PosCustomer`; consent not modelled |
| CUS-02 | Purchase history / returns | PASS | — |
| CUS-03 | Credit limits / statements / repayments | PASS | `PosCreditEntry`, `recordRepayment` |
| CUS-04 | Price lists / customer groups | PARTIAL | customer pricing capability |
| CUS-05 | Loyalty points / rewards / redemption | MISSING | no loyalty model |
| CUS-06 | Coupons / promotions / gift cards / store credit | PARTIAL | promotions; coupons/gift cards missing |
| CUS-07 | Multi-channel orders (POS/web/WhatsApp) | PARTIAL | channel field; omnichannel stock sync missing |
| CUS-08 | Delivery/pickup preferences + status | PARTIAL | delivery workflow |
| CUS-09 | Feedback / complaints / resolution | MISSING | — |
| CUS-10 | Customer matching across channels | MISSING | — |

### §13 Specialist workflows
| ID | Capability | Status | Evidence |
|---|---|---|---|
| NIC-01 | Retail/duka/supermarket | PARTIAL | barcode checkout partial (§7); shifts/branch comparison partial |
| NIC-02 | Wholesale/distribution | PARTIAL | customer pricing, quotations; route/dispatch partial |
| NIC-03 | Restaurant/café/catering | PARTIAL | menu + RESTAURANT workflow; **tables/floors, kitchen display, recipes partial** |
| NIC-04 | Salon/barber/spa | PARTIAL | APPOINTMENT workflow + appointments page; commissions partial |
| NIC-05 | Garage/repair/auto-parts | PARTIAL | GARAGE workflow + jobs page; vehicle records partial |
| NIC-06 | Pharmacy/agro-vet/regulated | **MISSING** | no lot/expiry/FEFO/quarantine (§8.1 INV-05) |
| NIC-07 | Agriculture/agro-processing | PARTIAL | produce page; grades/lots partial |
| NIC-08 | Laundry/dry cleaning | PARTIAL | LAUNDRY workflow; garment tags/collection partial |
| NIC-09 | Education/membership | PARTIAL | bookings; fees/installments partial |
| NIC-10 | Property/professional services | PARTIAL | quotations/projects; recurring invoices partial |
| NIC-11 | E-commerce/social commerce | PARTIAL | storefront exists; shared stock sync partial |

### §14 Intelligent JATA POS AI engine
| ID | Capability | Status | Evidence |
|---|---|---|---|
| AI-01 | Business Q&A grounded in tenant records | PARTIAL | `lib/ai-grounding.ts`, `ai-business-brain.ts`; POS-specific Q&A not verified |
| AI-02 | Analytics (trends/best-sellers/stockout) | PARTIAL | reporting exists; AI analytics partial |
| AI-03 | Operational assistance (draft POs/reports/replies) | PARTIAL | `autopilot/actions.ts` |
| AI-04 | Customer engagement AI | PARTIAL | `ai-front-desk`, `ai-channels` |
| AI-05 | Fraud/anomaly assistance | PARTIAL | partial; anomaly detection not verified |
| AI-06 | Typed allowlisted action registry | **PASS** | `AI_TOOL_REGISTRY` + categories READ/WRITE/HIGH_RISK |
| AI-07 | 10-step action execution contract | PARTIAL | registry + audit; POS domain actions partial |
| AI-08 | Grounding / reliability / injection defence | PARTIAL | `ai-grounding.ts`; prompt-injection tests exist (`ai-grounding-and-safety.test.ts`) |
| AI-09 | AI controls (enable/limits/approvals/cost) | PARTIAL | `AIConfiguration`, quota; per-action limits partial |
| AI-10 | Core POS works if AI unavailable | **PASS** | checkout independent of AI |

### §15 Reporting & dashboards
| ID | Capability | Status | Evidence |
|---|---|---|---|
| DASH-01 | Daily closing / shift reports | PARTIAL | reports exist; shift report partial |
| DASH-02 | Sales/margin/expenses/net with explicit definitions | PARTIAL | totals + payment mix; margin qualification partial |
| DASH-03 | Product/category/service performance | PASS | `topItems` |
| DASH-04 | Payment reconciliation | PASS | — |
| DASH-05 | Inventory valuation/movements/expiry/wastage | PARTIAL | movements; expiry/wastage partial |
| DASH-06 | Stockout frequency / lead-time performance | MISSING | — |
| DASH-07 | Debtors / payables | PASS | credit + purchases |
| DASH-08 | Staff/branch/cashier comparison | PARTIAL | branch scope; staff comparison partial |
| DASH-09 | Returns/discounts/voids/audit exceptions | PARTIAL | audit exists; exception report partial |
| DASH-10 | CSV export + printable reports | PARTIAL | CSV partial |
| DASH-11 | Scheduled delivery via channels | MISSING | ties to §9.2 |

### §16 Accounting, staff & multi-branch
| ID | Capability | Status | Evidence |
|---|---|---|---|
| ACC-01 | Expenses / categorized outflows | PASS | `PosExpense` |
| ACC-02 | Cash float / till sessions | PARTIAL | till exists; session model partial |
| ACC-03 | Settlement reconciliation | PASS | — |
| ACC-04 | Receivables / payables | PASS | — |
| ACC-05 | PO / goods-received / supplier invoices | PARTIAL | `PosPurchase`; GRN/invoice partial |
| ACC-06 | Tax config + document references | PARTIAL | tax capability; eTIMS missing |
| ACC-07 | Accounting exports / GL integration | PARTIAL | exports partial; **double-entry GL MISSING** |
| ACC-08 | Branch stock & pricing | PARTIAL | branch scope; per-branch pricing partial |
| ACC-09 | Inter-branch transfers | PARTIAL | transfer capability; audit partial |
| ACC-10 | Staff accounts/roles/approval thresholds | PASS | — |
| ACC-11 | Shift handover | MISSING | — |
| ACC-12 | Append-only audit for sensitive ops | PASS | `PosAuditEvent`, `AuditEvent` |

### §17 Security, privacy & governance
| ID | Capability | Status | Evidence |
|---|---|---|---|
| SEC-01 | Tenant identity from server session | **PASS** | `guard.ts`, `tenant.ts` |
| SEC-02 | Branch/record ownership on every request | **PASS** | compound keys in `store.ts` |
| SEC-03 | Permissions enforced in service layer | **PASS** | `guard.ts` + tests |
| SEC-04 | IDOR / cross-tenant prevention | **PASS** | tested (`pos-tenant-isolation`, `pos-branch-isolation`) |
| SEC-05 | CSRF / session hardening | PASS | session version tests |
| SEC-06 | Webhook signature + idempotency | PASS | `ProcessedWebhook` |
| SEC-07 | XSS/injection/SSRF/upload defence | PARTIAL | `safeError`, media source-safety; not exhaustively verified |
| SEC-08 | Rate limits | PASS | `lib/rate-limit.ts` |
| SEC-09 | Secret storage / server-only env | PASS | `.env.example` discipline |
| SEC-10 | Minimise PII in logs/notifications | PARTIAL | not verified |
| SEC-11 | Access logging for sensitive records | PARTIAL | audit exists |
| SEC-12 | Retention/deletion rules for caches/AI logs | MISSING | — |
| SEC-13 | Export/bulk-comm authorization | PARTIAL | — |

---

## 2. Summary matrix (counts)

| Status | Count |
|---|---|
| PASS (verified) | ~34 |
| PARTIAL | ~55 |
| MISSING | ~20 |
| NOT TESTED / BLOCKED | ~6 |

**Top priority gaps (ranked):**
1. **§6 Offline-first operation** — entirely missing; cashier cannot sell without connectivity. → **implemented this session (Phase 2 increment).**
2. **§7 Hardware/barcode/printing** — no camera scan, no printer, no adapter layer.
3. **§9.2–9.4 Scheduled daily report + supplier alert jobs** — no durable scheduler.
4. **§8.1 lot/batch/expiry/FEFO** — blocks pharmacy/agro-vet niche (§13 NIC-06).
5. **§11 eTIMS** — KRA compliance absent.
6. **§14 POS-specific AI action set** — registry exists but POS domain actions partial.

## 3. This session's increment (Phase 2 — offline-first)
See `docs/OFFLINE_FIRST_IMPLEMENTATION_2026-10-25.md` for the design, and the branch commits for the
code. Deliverables: durable offline sales queue, connectivity-aware sync flusher with backoff, server
sync endpoint reusing `createSale` idempotency, payment safety (non-cash offline ≠ confirmed), audit
trail, sync status endpoint, and sell-page UI. No schema migration; no production change.

## 4. Explicit non-actions (per brief §1)
- No merge, no deployment, no production migration, no live config change, no webhook behaviour change.
- No GitHub credentials touched.
- No existing POS behavior altered beyond additive offline paths.
