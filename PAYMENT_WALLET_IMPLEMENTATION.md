# JATA Payment Wallet — implementation record

Branch: `arena/01a10868-jata-aftercall`
Date: 2026-10-04 (Africa/Nairobi)
Scope: the payment layer of the JATA AFTERCALL **Business POS** (KES 499 / 30 days)
Spec: JATA AFTERCALL BUSINESS POS — payment infrastructure (§1–§130)

---

## 1. What was asked

Build production-grade, multi-tenant, provider-agnostic payment infrastructure **natively inside the
POS**, on one defining rule:

> **ZERO MERCHANT-SIDE INTEGRATION.** The merchant only says *where* their customers pay — an
> M-PESA till, a PayBill, a bank account, a Paystack account. JATA centrally owns the provider
> integration, the credentials, the callbacks, the routing, the verification, the notifications,
> the receipts and the reconciliation (§1, §3).

```
Merchant → JATA → Provider          (the only integration boundary that exists)
```

A merchant never configures a webhook, a callback URL, an API key, an endpoint, SSL, DNS or a
queue, and never sees a provider payload (§120). JATA-side provider integration is **required**, and
where a provider demands authorization, compliance or onboarding, JATA does it — the spec forbids
pretending a provider requirement was bypassed (§2, §129).

---

## 2. What was built

### 2.1 Data model (`prisma/schema.prisma`, migration `20261005000000_payment_wallet`)

Nine tables, eleven enums, all additive — the migration creates new tables and never alters a table
that already exists:

| Model | Holds |
| --- | --- |
| `PaymentDestination` | where a business gets paid: kind, provider, masked label, verification source, capabilities actually available |
| `PaymentProviderConnection` | JATA's connection to a provider **for one tenant** — status, health, last event |
| `PaymentTransaction` | the payment itself: state machine value, integer minor-unit amounts, provider reference and transaction id, `posSaleId` (unique), receipt number + token |
| `PaymentAttempt` | every initiation attempt and its provider answer |
| `PaymentEvent` | every provider event, `@@unique([provider, providerEventId])` — the idempotency spine |
| `PaymentNotification` | queued/sent/skipped messages, idempotency key |
| `PaymentReconciliation` | MATCHED / AMOUNT_MISMATCH / UNKNOWN_PAYMENT / DUPLICATE / UNCONFIRMED / MANUAL_MATCHED |
| `Refund` | additive refund records — the original payment is never rewritten |
| `PaymentAuditEvent` | append-only trail; a BEFORE UPDATE trigger refuses rewrites |

Amounts are `Int` **minor units** (never a float); currency is a column, KES first.

### 2.2 Engine (`lib/payments/`)

- `money.ts` — integer minor units, masking, KES phone normalisation. No float arithmetic anywhere.
- `states.ts` — the full state machine (`CREATED → PAYMENT_REQUESTED → PENDING → PROCESSING →
  CONFIRMED → PAID`, plus FAILED / EXPIRED / CANCELLED / REVERSED / PARTIALLY_PAID /
  PARTIALLY_REFUNDED / FULLY_REFUNDED). A payment is never a boolean. `EXPIRED` stays confirmable:
  it means *JATA stopped waiting*, not *the money is closed off*.
- `ids.ts` — merchant-readable `JTP-YYYYMMDD-…` payment ids, per-tenant idempotency keys, receipt
  tokens, customer keys.
- `destinations.ts` — `identifyDestination` / `validateDestination` / `routeDestination` /
  `effectiveCapabilities`. Capability is **reduced to the truth**: no `REAL_TIME_CONFIRMATION`,
  `WEBHOOKS`, `REFUNDS` or `REVERSALS` claim unless the destination is provider-verified *and*
  JATA's own connector for it is configured.
- `config.ts` — connector readiness per provider, and what is still missing (JATA-internal only).
- `providers/` — the `PaymentProviderAdapter` interface plus M-PESA (Daraja), Paystack, bank
  (instructions-only) and a registry. The POS never branches on a provider name.
- `orchestrator.ts` — `createPaymentRequest` (idempotent, server-priced, routes to one destination,
  returns honest customer instructions), `checkPaymentStatus`, `cancelPaymentRequest`,
  `recheckPaymentForOperator` (an operator asks the provider for the current truth — never a replay
  of stored provider data)
- `engine.ts` — `applyConfirmation` / `applyReversal` / `applyFailure` / `expireStalePayments` /
  `refreshStatus`. One provider confirmation produces exactly one financial effect.
- `webhooks.ts` — the shared pipeline: authenticate → validate → identify → claim idempotency →
  apply atomically → notify.
- `reconciliation.ts`, `notifications.ts`, `realtime.ts`, `refunds.ts`, `wallet.ts`, `store.ts`,
  `audit.ts`, `reauth.ts`, `result.ts`.

### 2.3 Endpoints

**JATA-owned provider events** (§35, §111) — merchants never see these:

```
POST /api/payments/webhooks/mpesa      (STK, C2B confirmation, validation)
POST /api/payments/webhooks/paystack
```

**Merchant POS API** — every route goes through `handlePosRequest` (session → tenant → permission):

```
GET/POST /api/pos/[businessId]/payments
GET      /api/pos/[businessId]/payments/[transactionId]
POST     /api/pos/[businessId]/payments/[transactionId]/status
POST     /api/pos/[businessId]/payments/[transactionId]/cancel
GET/POST /api/pos/[businessId]/payments/[transactionId]/refund
GET/POST /api/pos/[businessId]/payments/destinations
POST     /api/pos/[businessId]/payments/destinations/[destinationId]
POST     /api/pos/[businessId]/payments/connections/[provider]
GET/POST /api/pos/[businessId]/payments/reconciliation
GET      /api/pos/[businessId]/payments/updates     (SSE + polling fallback)
```

**JATA internal** — admin-only: `/admin/payments/wallet` and
`POST /api/admin/payments/[transactionId]/recheck` — asks the provider for the
  current status of one payment (§102); only the provider's own answer can move it.

**Public, token-addressed:** `/receipt/[token]` — a customer verifies a receipt without an account
and sees that receipt and nothing else (§38, §83).

### 2.4 Screens

- `/dashboard/pos/[businessId]/payments` — live payments, where you get paid, health, books
  (reconciliation), all in merchant words.
- The till (`/sell`) carries the wallet: request a payment, show the customer honest instructions,
  then wait — the screen flips to PAID on a verified provider confirmation, with no refresh and no
  cashier decision (§41, §112).
- The sale page shows the customer's receipt-verification link.

---

## 3. The invariants that are enforced, and where

| Rule | Enforced by |
| --- | --- |
| One payment = one financial effect (§33) | `PaymentEvent @@unique([provider, providerEventId])`, byte-for-byte identical idempotency keys, compare-and-set state transitions, `PaymentTransaction.posSaleId @unique` |
| PAID only from a verified provider confirmation (§41, §120) | Only `applyConfirmation` writes `PAID`, and it is reachable only through `applyProviderEvent`, which authenticates first |
| Provider amount must match the requested amount (§42, §98) | Re-price at settlement; a mismatch raises a reconciliation exception and does *not* settle |
| Tenant isolation (§5, §75) | Every query filters `businessId`; a foreign destination id is refused, not resolved |
| No secrets to a browser (§58) | Provider credentials are read server-side only; nothing exposes them; capability claims carry no keys |
| Money is never a float (§24) | Minor-unit integers end to end |
| Destination change is deliberate (§62) | `MANAGE_PAYMENT_DESTINATIONS` (owner-level) + in-the-moment confirmation + audit + owner notice |
| Financial history is never deleted (§114) | Refunds and reversals are additive rows; destinations are deactivated, never removed |

---

## 4. Provider prerequisites (JATA-side)

**Absent these, the wallet still works and says so.** It saves the merchant's destination, shows the
customer how to pay, and states plainly that automatic confirmation is not available in this
deployment. It never pretends a connection exists (§16, §120).

### M-PESA (Safaricom Daraja)

| Requirement | Purpose |
| --- | --- |
| `MPESA_ENV` = `sandbox` \| `production` | which Daraja host |
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET` | app credentials for the Daraja API |
| `MPESA_SHORTCODE` | the Buy Goods till / PayBill that collects |
| `MPESA_PASSKEY` | Lipa na M-PESA online passkey for that shortcode |
| `MPESA_CALLBACK_TOKEN` | JATA's own shared secret appended to the callback URLs — Daraja does not sign callbacks, so without it JATA refuses unauthenticated callbacks rather than trusting whoever finds the URL |
| Daraja app **authorized** for STK push and C2B, with the C2B confirmation/validation URLs registered | Daraja will not deliver events JATA has not registered |
| `MPESA_INITIATOR_NAME`, `MPESA_SECURITY_CREDENTIAL` (only for refunds/reversals paid out via B2C) | B2C payout |
| Optional: `MPESA_STK_CALLBACK_URL`, `MPESA_C2B_CONFIRMATION_URL`, `MPESA_C2B_VALIDATION_URL`, `MPESA_ALLOWED_IPS` | URL overrides and source-IP filtering |

### Paystack

`PAYSTACK_SECRET_KEY` (shared with the platform) — the wallet's endpoint is
`/api/payments/webhooks/paystack`. Paystack signs events; the adapter verifies the signature and
then re-verifies every charge with `GET /transaction/verify` before anything is treated as paid
(§30, §90).

### Bank

`BANK_CONNECTOR_URL`, `BANK_CONNECTOR_API_KEY` — an **authorized bank connector**. Without one, a
bank destination is instructions-only and says so.

### Deployment

`JATA_PAYMENTS_TEST_MODE` (`on` \| unset) — `on` lets a deployment accept unsigned Daraja-shaped
callbacks for local testing; unset means JATA refuses unauthenticated provider events and derives
test mode from whether a live connector is configured (§94).
`JATA_NOTIFICATION_GATEWAY_URL/TOKEN` — optional outbound SMS/WhatsApp/e-mail; POS/in-app messages
always work, and without a gateway external channels are recorded as **SKIPPED**, never as sent.

---

## 5. What has been verified, and what has not

### Verified in this environment

- **Unit** (`tests/unit/payments-core.test.ts`): money conversions, masking, the state machine,
  ids, destination identification, and the capability honesty rules.
- **Integration, wallet journey** (`tests/integration/payments-journey.test.ts`): a server-priced
  request → instructions → provider confirmation → sale + stock + receipt + reconciliation +
  notifications in one transaction; a repeated confirmation changes nothing; an amount that does not
  match is refused and recorded; an `EXPIRED` payment still settles on a late confirmation; two
  sales get two distinct payments.
- **Integration, provider events** (`tests/integration/payments-webhooks.test.ts`): M-PESA STK
  confirmation applied once, with a byte-identical retry changing nothing; a wrong callback token
  refused (HTTP 401); no
  token registered → refused; a failure callback becomes `FAILED`, never PAID; money that cannot be
  attributed is recorded as `UNKNOWN_PAYMENT` against the destination's business; Paystack
  `charge.success` re-verified with the provider before applying; a forged signature refused; a
  charge the provider itself calls unsuccessful is not applied.
- **Integration, provider events** also proves the operator re-check asks the provider and changes
  nothing when JATA has no connection to ask, and refuses a payment that does not exist.
- **Security** (`tests/security/payments-isolation.test.ts`): tenant scoping of every read, a
  foreign destination id refused, a confirmation settling only its own tenant's payment, no
  client-supplied status accepted, no credential in anything a merchant can reach, no whole phone
  number stored, cashier blocked from changing where money lands, refund permission and explicit
  confirmation required, refunds capped at what was paid, an unauthenticated event refused leaving
  records untouched.
- **Build / type / lint**: `npx next build`, `tsc --noEmit`, `next lint` (one pre-existing,
  unrelated warning in the storefront cart).
- **Schema contract**: `tests/unit/pos-prisma-contract.test.ts` validates the payment queries
  against `prisma/schema.prisma`; `tests/unit/repair-guards.test.ts` proves the migration is
  additive.

### Not verified — requires real provider credentials

- **A real M-PESA sandbox or production journey**: no Daraja app, shortcode, passkey or callback
  token exists in this environment, so no live STK prompt, C2B payment or Daraja callback has been
  performed. The adapter's correctness against Daraja is verified by contract and by unit tests,
  **not** by a live confirmation.
- **A real Paystack test-mode charge through the wallet** (the platform's Paystack subscription flow
  is unchanged and separately verified).
- **A bank connector**: none is configured, so bank destinations are instructions-only here.
- **Migration applied to a real Postgres**: there is no database in this environment. `prisma
  validate` cannot run offline; migration state is checked by CI (`postgres:16` + `migrate deploy`)
  and by the additive-migration guard.
- **Outbound SMS/WhatsApp delivery**: no gateway is configured; those channels are recorded as
  SKIPPED rather than sent.

**The wallet must not be described as PRODUCTION READY until a real provider confirmation has been
observed end to end** (§129).

---

## 6. Deliberately not built

- No merchant-facing webhook, API key, endpoint, queue or SSL configuration — ever (§120).
- No stored-value wallet: JATA routes money to the merchant's own account and never holds a balance
  (§1).
- No PIN capture of any kind; the customer authorizes on the provider's own secure screen.
- No second JATA product, no JATA Qi, no custom domains (§119–§120).
- No fake success path: a destination whose provider cannot confirm keeps only the instruction
  capability, and the merchant sees that stated plainly.

---

## 7. Key decisions worth remembering

1. **`strict: false` does not narrow boolean unions.** `lib/payments/result.ts` provides `isOk` /
   `isFailure`; the payment result types stay precise instead of degrading to all-optional fields.
   `lib/pos/sales.ts` exports `isPricedSale` for the same reason.
2. **Receipt identity comes from the sale, not the engine.** `settlePosSale` returns the sale's
   receipt number; there is no separate receipt builder in `engine.ts`.
3. **An operator cannot move money by hand.** The internal action is a *provider re-check*, not a
   replay of a stored payload: the adapter asks the provider, and only the provider's answer can
   change a payment. The event log keeps sanitized payloads (§116), so there is deliberately no raw
   body to re-run — replaying one would mean re-running data no signature vouched for at that moment.
4. **A failure event correlates by the provider's own attempt handle.** An M-PESA STK failure quotes
   the CheckoutRequestID and carries no JATA reference, so `applyFailure` looks up the reference and
   then the `providerTransactionId` — the checkout id stays the correlation key for the attempt,
   while the M-PESA receipt is retained in the sanitized `PaymentEvent` payload.
5. **Capability is subtracted, not asserted.** `effectiveCapabilities` downgrades claims whenever
   JATA's connector or the provider's verification cannot back them up.
6. **Notifications are outside the money path.** A message that fails is retried and recorded; it
   can never reverse, block or un-confirm a payment (§66, §100).
