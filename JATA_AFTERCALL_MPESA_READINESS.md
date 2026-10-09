# JATA AFTERCALL — M-PESA (Daraja) integration readiness

Base: `main` @ `9c36bd1` (PR #40). Scope: the M-PESA integration inside the existing Next.js / Prisma / Neon / Vercel
application. **No schema, migration, dependency, CI, build-script or Vercel-configuration change was made.**

> ## Verdict: NOT PRODUCTION-READY — NOT GO LIVE
>
> The repository-controlled work is implemented and tested. Everything that needs Safaricom's authorization,
> genuine production credentials, callback registration or a live transaction is **BLOCKED** or **NOT RUN**, and
> nothing in this document claims otherwise.

| | Status | Meaning |
|---|---|---|
| **A. CODE IMPLEMENTATION** | **PASS** — with the limitations in §9 | Every flow below is implemented, with fail-closed configuration. Two Daraja behaviours rest on third-party references and are flagged for sandbox confirmation (§3). |
| **B. AUTOMATED TESTS** | **PASS** for the payment/M-PESA scope — 3 unrelated pre-existing failures; DB-backed suites **NOT RUN** | 1688 passed · 3 failed (identical to baseline, unrelated) · 12 skipped. See §7. |
| **C. SANDBOX VERIFICATION** | **NOT RUN** | No credentials and no route to Safaricom from the build environment. A Daraja sandbox app named JATA AFTERCALL exists but was not exercised. |
| **D. PRODUCTION CONFIGURATION** | **BLOCKED** | No Vercel access from here. No production value was seen or set. Use the readiness endpoint (§5) to verify. |
| **E. SAFARICOM AUTHORIZATION** | **BLOCKED** | Safaricom has not responded. Shortcode `174379` is Safaricom's public sandbox shortcode, **not** JATA ATLAS's production shortcode. |
| **F. LIVE TRANSACTION VERIFICATION** | **NOT RUN** | Not authorized, and blocked by E. No money has been moved. |

---

## 1. How to read the evidence

| Label | Meaning |
|---|---|
| **Tested** | Exercised by an automated test in this repository that passed on this tree. |
| **Reference** | Taken from third-party integration material that reproduces Safaricom's Daraja documentation. **Safaricom's official portal (`developer.safaricom.co.ke`) is client-rendered and could not be read from this environment.** Confirm every *Reference* item there and in the sandbox before go-live. |
| **Unverified** | Neither tested nor documented to a standard that supports a claim. Needs Safaricom or an operator. |

---

## 2. Audit findings (Phase 1)

Severity: **H** = could lose, duplicate or hide money, or accept a forgery · **M** = wrong state or misleading to a merchant · **L** = hygiene.

| # | Sev | Finding (before) | Where | Resolution |
|---|---|---|---|---|
| 1 | H | `MPESA_ENV` fell back to **sandbox** for any value other than `production` (`prod`, `live`, a typo, or unset). | `lib/payments/config.ts` | **Fixed.** Exactly `sandbox` or `production` or the connector is *not ready*; no host is selected. Tested. |
| 2 | H | `ready` ignored the environment, the callback origin and value formats. With no `PUBLIC_BASE_URL`/`NEXTAUTH_URL` every callback silently became `http://localhost:3000/…` while the connector reported *ready*. | `config.ts` | **Fixed.** Public https origin required (or all three URL overrides); localhost, http, private and credentialed URLs refused. Tested. |
| 3 | H | A *queue timeout* (`QueueTimeOutURL`) was parsed as a definitive reversal **failure**, releasing the reserved refund amount — which could allow a second, duplicate payout while the first was still processing. | `providers/mpesa.ts`, `engine.ts`, `refunds.ts` | **Fixed.** A distinct `reversal_timeout` event keeps the refund `PENDING_PROVIDER` and reserved, marks it *unknown*, and never releases it. Tested (and mutation-checked). |
| 4 | H | A success callback (`ResultCode 0`) whose amount was missing or unparseable became a *failure*, closing the payment as terminal `FAILED` while the customer had paid. | `providers/mpesa.ts` | **Fixed.** Routed through the amount-mismatch path: nothing marked paid, payment stays open, exception recorded, "Check status" can settle it. Tested. |
| 5 | H | STK Query could **never** settle a payment: Daraja's query carries no receipt, yet confirmation required one — so a lost callback (Daraja does not retry them) was unrecoverable. | `engine.ts`, `providers/mpesa.ts` | **Fixed.** A status-check confirmation settles without a receipt, is audited as such, and a later callback back-fills the receipt (which is what makes the payment reversible). Tested. |
| 6 | H | STK Query treated **any** non-zero `ResultCode` as a failed payment, including the in-flight answer (`4999`, HTTP 200) and the non-discriminating `500.001.1001` — closing a payment the customer was still completing. | `providers/mpesa.ts` | **Fixed.** Only `1`, `1032`, `1037`, `2001` are final failures; everything else is *pending/unknown*. Tested. *Reference* for the code behaviour. |
| 7 | H | Reversal used an **invented initiator** (`"JATA"`) and an **empty SecurityCredential** when unset, and never checked `ResponseCode`/the conversation id the later Result must be matched on. | `providers/mpesa.ts` | **Fixed.** Refused locally (no call) until a valid initiator + credential are configured; acceptance requires `ResponseCode 0` and a conversation id, otherwise the outcome is *unknown*. Tested. |
| 8 | H | Refund outcome lost on a transport error: the reservation had no conversation id, so the eventual Result callback could never be matched. | `refunds.ts` | **Fixed.** Results are also matched by the **receipt they reversed** (`OriginalTransactionID`), only when exactly one open refund on exactly one payment carries it. Tested. |
| 9 | H | A refused (unauthenticated) event was stored under the **provider event id it claimed**, making a forged request able to shadow — and so suppress — the genuine event. (Latent in production: the insert used the wrong field name, `eventId` instead of `providerEventId`, so refused events were never persisted at all and the audit row was silently lost.) | `webhooks.ts` | **Fixed.** Refused events are stored under `rejected:<digest>` with the correct field; genuine ids stay free. Applies to Paystack too. Tested. |
| 10 | H | If the pipeline threw after claiming the event id, the row stayed `RECEIVED` and every redelivery was swallowed as a duplicate — a lost confirmation. | `webhooks.ts` | **Fixed.** The event is marked `FAILED`; a redelivery (or an abandoned `RECEIVED` row past a 60 s lease) completes it. The apply steps are idempotent. Tested. |
| 11 | H | The C2B fallback matcher attributed a payment to the **most recent** open payment with the same destination and amount, even when several qualified — one customer's sale could take another's money. | `engine.ts` | **Fixed.** Exactly one candidate or no auto-match; ambiguity becomes a reconciliation exception. Tested. |
| 12 | H | `JATA_PAYMENTS_TEST_MODE=on` allowed unsigned callbacks even with `MPESA_ENV=production`. | `config.ts`, `providers/mpesa.ts` | **Fixed.** Ignored on any production deployment. Tested. |
| 13 | M | Callbacks were answered `{"status":"processed"}`, not Daraja's `{"ResultCode":0,"ResultDesc":"Accepted"}`; for **C2B validation** that body is the accept/reject decision itself. | `mpesa/handler.ts` | **Fixed.** Daraja-format acknowledgements; refusals keep their own 4xx and are never told "Accepted". Tested. |
| 14 | M | STK `AccountReference` was the ~27-character JATA reference (limit **12**); `TransactionDesc` up to 100 (limit **13**); amounts were rounded to whole shillings. A timeout threw, leaving the payment stuck in `CREATED` with the prompt possibly already on the phone. | `providers/mpesa.ts` | **Fixed.** Compliant references; a fractional amount is *refused*, never rounded; transport failures return a retry-safe failure that says the customer may still see a prompt. Tested. *Reference* for the limits. |
| 15 | M | Failure messages were wrong: code `1` (insufficient balance) read "cancelled", `1032` (cancelled) and `2001` (wrong PIN) read "did not enter their PIN in time"; Safaricom's free text was echoed to merchants. | `providers/mpesa.ts` | **Fixed.** Accurate messages per code; unknown codes get a neutral sentence. Tested. |
| 16 | M | One global OAuth token cache, no handling of an expired token. | `providers/mpesa.ts` | **Fixed.** Cached per (host, consumer key); refreshed and retried **once** on a rejected token; no other retry exists. Tested. |
| 17 | M | A partial reversal was allowed. Daraja's documentation does not describe partial reversal. | `refunds.ts`, `providers/mpesa.ts` | **Fixed (policy).** A payment is reversed once and in full; partials are refused before anything is reserved. **Unverified** whether Daraja would accept partials — revisit with Safaricom. |
| 18 | M | Nothing ever expired stale payments (`expireStalePayments` has no caller) and there is no scheduled reconciliation. | `engine.ts` | **Partly fixed.** A status check now expires a payment past its window (still confirmable later). **No automatic/scheduled reconciliation exists** — see §9. |
| 19 | M | The till showed `Refund pending_provider through the provider.` | `components/pos/PaymentsClient.tsx` | **Fixed.** A pending refund is never described as done. |
| 20 | L | `readTestMode()` treated a fully configured **sandbox** connector as production-ready. | `config.ts` | **Fixed.** Only a live connector is live. Tested. |
| 21 | L | The documented callback paths contain "mpesa"; integration guides say Daraja filters such URLs. | routes | **Mitigated.** Neutral `/api/payments/webhooks/daraja/*` routes (same handler) are now the default; the legacy `mpesa/*` routes stay live. *Reference* — enforcement is **unverified**. |
| 22 | — | **Not changed** — see §9: STK `PartyB`, Preview builds applying migrations, the Paystack return page, no C2B registration tooling, no automatic reconciliation, STK prompts cannot be cancelled. | | Documented. |

---

## 3. Daraja products and permissions, by flow (Phase 1.3)

| Flow | Daraja product / endpoint | Credentials JATA needs | Safaricom authorization needed | Registration |
|---|---|---|---|---|
| **STK Push** | M-PESA Express — `POST /mpesa/stkpush/v1/processrequest` | `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY` | A Daraja app approved for M-PESA Express **on the production shortcode** (go-live). For a Buy Goods till, the till must sit under the head-office number used as `BusinessShortCode`. | **None** — `CallBackURL` is sent with each request. |
| **STK Query** | `POST /mpesa/stkpushquery/v1/query` | same four | none beyond STK Push | none |
| **C2B (over the counter)** | Customer-to-Business — inbound; `POST /mpesa/c2b/v1/registerurl` registers the URLs | `MPESA_CALLBACK_TOKEN` authenticates inbound; the four above to register | C2B enabled for the shortcode. *Reference:* external validation is **off by default** and must be requested. | **Required, once per shortcode per environment, performed outside the app** (§6). |
| **Reversal** | `POST /mpesa/reversal/v1/request` (`TransactionReversal`) | `MPESA_INITIATOR_NAME`, `MPESA_SECURITY_CREDENTIAL` plus the four above | An API initiator with the **reversal role** on the shortcode; a SecurityCredential made with Safaricom's certificate **for that environment**. | **None** — `ResultURL`/`QueueTimeOutURL` are sent with each request. |
| Not implemented | B2C (the route for *partial* refunds), Transaction Status, Account Balance, dynamic QR, Ratiba | — | — | — |

**Reference / Unverified items to confirm in the sandbox and with Safaricom**

1. **`RecieverIdentifierType` for reversals.** The code now sends `"11"`. A 2019 tutorial used `"4"`; recent SDKs and docs-derived material use `"11"`. *Reference only — unverified.* It is one constant, `MPESA_REVERSAL_RECEIVER_IDENTIFIER_TYPE` in `lib/payments/providers/mpesa.ts`. Confirm in the sandbox (**C**) before any live reversal.
2. **`ReceiverParty`** is the receiving till/PayBill (the destination) when known, else `MPESA_SHORTCODE`. *Unverified* for head-office/till structures.
3. **Partial reversal** — not documented as supported; refused by policy (finding 17).
4. **Reversal timing.** *Reference:* the result may arrive hours later, and may need approval on Safaricom's side. JATA treats a pending reversal as pending and a timeout as unknown, indefinitely.
5. **STK result codes** (`0`, `1`, `1032`, `1037`, `2001`; in-flight `4999`/`500.001.1001` on query) — *Reference*, observed in sandbox runs reported publicly.
6. **STK field limits** (`AccountReference` ≤ 12, `TransactionDesc` ≤ 13, whole-shilling `Amount`) — *Reference.*
7. **Buy Goods:** `BusinessShortCode` = head-office number, `PartyB` = till; a mismatched pair is rejected by Daraja ("Agent number and Store number do not match") — *Reference.* For **PayBill**, `PartyB` must equal `BusinessShortCode`; JATA therefore does **not** prompt for a PayBill that is not `MPESA_SHORTCODE` and shows the customer how to pay instead.

Sources: dev.to *M-PESA Express (STK Push) API Guide*; paybillke.com STK Push guide; dev.to *Eight things I measured about M-Pesa STK Push*; GitHub `Educore#538` and `lipwa#67` (STK Query behaviour); `mpesa-python#2` and `sokoni#121` (Buy Goods `PartyB`); `ex_mpesa` / `daraja-api.netlify.app` (URL keyword guidance); peternjeru.co.ke Daraja tutorial and the `mpesa-api` / `mpesa-sdk` packages (Reversal).

---

## 4. Implemented flows (Phases 3–4)

**Collection.** The till asks JATA for a payment → JATA prices it server-side → STK Push is sent (or the customer is shown how to pay) → the payment is `PENDING` with the `CheckoutRequestID` stored → Safaricom's authenticated callback settles it → the till says "paid" only from that verified state, never from a redirect, screenshot or browser assertion.

- **Authentication:** constant-time `?token=` match; optional exact-IP allowlist; no unauthenticated acceptance on any production deployment.
- **Validation before any write:** the payment is found by `CheckoutRequestID` (never by receipt), its tenant and destination are checked, the amount must equal the request **exactly**, an STK confirmation must carry a valid receipt, and a state compare-and-set guards against concurrent duplicates.
- **Idempotency:** one provider event id → one financial effect; duplicates are acknowledged and ignored; an abandoned event is recoverable; a refused event never occupies an id.
- **Late and odd callbacks:** `EXPIRED` + success → settles; `FAILED`/`CANCELLED` + success → a reconciliation exception (never silently re-opened); unknown checkout id → recorded, nothing invented; amount mismatch → nothing paid, exception recorded.
- **Reconciliation for lost callbacks:** the till's **Check status** and the admin re-check ask Daraja (STK Query). Only a *final* answer moves a payment; an in-flight/unknown answer changes nothing; a payment past its window is expired but remains confirmable.

**Refunds (reversals).** `REFUND_PAYMENT` permission + password re-authentication → payment locked → provider pre-flight (full amount only, once; Pochi refused) → amount **reserved** → Reversal request (single attempt) → one of:

| State (`refundOutcomeState`) | Stored as | Meaning |
|---|---|---|
| `RESERVED` | `REQUESTED` | reserved, not yet answered by Safaricom |
| `AWAITING_PROVIDER` | `PENDING_PROVIDER` + conversation id | accepted; waiting for the authenticated Result |
| `UNKNOWN` | `PENDING_PROVIDER` + `OUTCOME UNKNOWN —` marker (or no conversation id) | the outcome is not known (timeout, 5xx, incomplete answer, queue timeout); amount stays reserved; **never retried automatically** |
| `COMPLETED` | `COMPLETED` | authenticated success Result with the matching amount |
| `FAILED` | `FAILED` | Safaricom refused it (or the authenticated Result was a failure); reservation released. (`REJECTED` exists in the schema; no M-PESA path produces it.) |

No automatic retry exists anywhere in the money-out path. The single re-send that exists is after a *rejected OAuth token*, which proves nothing was processed.

**Audit.** Every transition writes a payment-audit row in the same transaction; new actions: `REFUND_OUTCOME_UNKNOWN`, `PAYMENT_CONFIRMED_BY_STATUS_CHECK`, `PAYMENT_RECEIPT_RECORDED`. Logs and audit rows carry no token, credential, passkey or full phone number (tested).

---

## 5. Environment and authentication (Phase 2)

**Strict separation.** Set `MPESA_ENV=production` and every production credential **only** in the Vercel **Production** environment; use `MPESA_ENV=sandbox` and the Daraja sandbox credentials in **Preview/Development**. The code enforces what it can: a production connector is *refused* on a Preview/Development deployment; Safaricom's sandbox shortcode is refused with `MPESA_ENV=production`; each OAuth token is bound to its host; only the two official Safaricom hosts can ever be called; a sandbox connector on a Production deployment raises a warning.

| Variable | Required for | Rule (otherwise: not ready, with the variable named, never its value) |
|---|---|---|
| `MPESA_ENV` | everything | exactly `sandbox` or `production` — **no default** |
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET` | everything | 8–512 printable characters, no spaces |
| `MPESA_SHORTCODE` | STK Push/Query, reversals | 5–7 digits; `174379` refused in production |
| `MPESA_PASSKEY` | STK Push/Query | 8–512 printable characters, no spaces |
| `MPESA_CALLBACK_TOKEN` | callbacks | 24–128 of `A–Z a–z 0–9 _ -` (`openssl rand -hex 24`; **not** base64) |
| `PUBLIC_BASE_URL` (or `NEXTAUTH_URL`) | callback URLs | public `https` origin; localhost/http/private refused. Not needed if all three overrides are set |
| `MPESA_STK_CALLBACK_URL`, `MPESA_C2B_CONFIRMATION_URL`, `MPESA_C2B_VALIDATION_URL` | optional overrides | public https, end in `/stk` / `/confirmation` / `/validation`, carry `?token=<MPESA_CALLBACK_TOKEN>`; used verbatim |
| `MPESA_ALLOWED_IPS` | optional | comma-separated **exact** IPs (no CIDR) |
| `MPESA_INITIATOR_NAME`, `MPESA_SECURITY_CREDENTIAL` | reversals only | 3–64 of `A–Z a–z 0–9 _ . @ -`; base64 |
| `JATA_PAYMENTS_TEST_MODE` | leave **unset** in production | ignored on production deployments |
| `PAYSTACK_*`, `DATABASE_URL`, `AUTH_SECRET`, … | unchanged | not touched by this work |

**Verify without reading a secret:** an admin can call `GET /api/admin/payments/mpesa/readiness` (admin-only, read-only, uncached). It returns the environment, whether collections and reversals are ready, the **names** of missing variables, the **rule** each malformed one broke, and the callback URLs with the token redacted. Tested to leak nothing, even when the configuration is broken. (It is new — available once this branch is deployed.)

---

## 6. Callbacks and registration (Phase 5)

**Routes** (all run one shared handler; `GET` answers `{"status":"ok"}` without side effects):

| Purpose | Default path (neutral) | Legacy path (still served) |
|---|---|---|
| STK result | `/api/payments/webhooks/daraja/stk?token=…` | `/api/payments/webhooks/mpesa/stk` |
| C2B confirmation | `…/daraja/confirmation?token=…` | `…/mpesa/confirmation` |
| C2B validation | `…/daraja/validation?token=…` | `…/mpesa/validation` |
| Reversal result | `…/daraja/result?token=…` (derived from the confirmation URL) | `…/mpesa/result` |
| Reversal queue timeout | `…/daraja/timeout?token=…` (derived from the validation URL) | `…/mpesa/timeout` |

The deployed production handlers have **not** been checked against these paths: the neutral routes exist only once this branch is deployed. After deployment, `GET` each of the five paths and confirm `{"status":"ok"}` before registering anything.

**Registration — what is required, and what has (not) been done**

| Callback | Registered with Safaricom? | How |
|---|---|---|
| STK `CallBackURL` | not applicable | sent with every STK request |
| Reversal `ResultURL` / `QueueTimeOutURL` | not applicable | sent with every reversal request |
| **C2B confirmation + validation** | **required — NOT DONE, NOT VERIFIED** | one-time Register URL call per shortcode and environment, below |

No code in this repository calls `registerurl`; **nothing has been registered with Safaricom**, and a reachable route proves nothing about registration.

**Exact C2B registration procedure** (only after Safaricom confirms C2B is enabled for the production shortcode). Run locally, with the values read from a protected shell or secret manager — **never pasted into chat, tickets or this repository**:

```bash
# 1. After deployment, each of the five neutral GET probes must answer {"status":"ok"}.

# 2. OAuth token (production host; use https://sandbox.safaricom.co.ke for the sandbox app)
TOKEN=$(curl -s -u "$MPESA_CONSUMER_KEY:$MPESA_CONSUMER_SECRET" \
  "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials" | jq -r .access_token)

# 3. Register the two URLs (once). ResponseType "Completed" = accept the payment if the validation
#    URL cannot be reached; JATA's validation endpoint accepts and reconciles afterwards.
curl -s -X POST "https://api.safaricom.co.ke/mpesa/c2b/v1/registerurl" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"ShortCode\":\"$MPESA_SHORTCODE\",\"ResponseType\":\"Completed\",
       \"ConfirmationURL\":\"https://<public-origin>/api/payments/webhooks/daraja/confirmation?token=$MPESA_CALLBACK_TOKEN\",
       \"ValidationURL\":\"https://<public-origin>/api/payments/webhooks/daraja/validation?token=$MPESA_CALLBACK_TOKEN\"}"
# Success is ResponseCode "0" — that the request was accepted, not that callbacks arrive.
```

Use the registration API version Safaricom enabled for the shortcode. *Reference:* a production registration may not be overwritable through the API — if a URL or the token must change, ask Safaricom; do not retry blindly. The registered URLs **contain the token**: treat the request, its logs and any screenshot as secret, and rotate the token if one leaks.

**Network restrictions — options and trade-offs** (nothing here assumes a Vercel capability that was not confirmed):

1. **Shared-secret token in the URL** — implemented, the primary control. Daraja does not sign callbacks or support mutual TLS.
2. **App-level exact-IP allowlist (`MPESA_ALLOWED_IPS`)** — implemented. Vercel's documentation says `x-forwarded-for` is the client's public IP and that Vercel overwrites incoming values to prevent spoofing (unless an Enterprise "Trusted Proxy" is enabled). *Trade-offs:* Safaricom's callback source addresses are not an officially guaranteed list (third-party lists exist; ask Safaricom for a written one); if they change, genuine callbacks are refused with `401` and payments stay pending until Check status recovers them; no CIDR support. **Leave empty unless Safaricom provides a stable written list.**
3. **Vercel platform firewall / rate-limit rules** — would filter or throttle before the function runs. Availability depends on the Vercel plan: **unverified**. Same IP-stability trade-off.
4. **Residual risk:** an unauthenticated POST still costs one audit row and, if it looks like an event, one `rejected:` event row. There is no in-app rate limit on this endpoint; a platform rate-limit rule is the recommended mitigation.
5. **Outbound IP whitelisting** (JATA → Safaricom). *Reference, conflicting:* one go-live guide says Safaricom whitelists production server IPs; an older tutorial says it is unnecessary. Vercel Functions' egress addresses are not fixed by default. **Unverified — ask Safaricom whether it applies** before assuming an architecture change (a fixed-egress option, if your Vercel plan has one, or a fixed-IP relay — new infrastructure, out of scope here).

---

## 7. Tests (Phase 6) — genuine results

All run on this tree in the build environment. Safaricom is a scripted `fetch`; every credential is an obviously fake placeholder; no production secret is required or used.

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, **0 errors** |
| `npx vitest run --exclude "tests/e2e/**"` | **1688 passed · 3 failed · 12 skipped** (1703) |
| *same command, untouched `main` @ `9c36bd1`* | 1373 passed · 3 failed · 12 skipped (1388) — **+315 passing = the 315 new tests; same 3 failures** |
| `npx vitest run tests/e2e` | 1 passed · **39 skipped** — the journeys need `DATABASE_URL` |
| `npx next lint` | exit 0; one pre-existing warning (`components/storefront/CartProvider.tsx` `<img>`) |
| `env -u DATABASE_URL bash scripts/build.sh` | **exit 0** — compiled, 40/40 static pages, new routes listed. `prisma generate` cannot download its engine here and falls back (the script's offline path). |

**The 3 failures** (`phase1-foundation`, `pricing-ai` ×2) query the real Prisma client for plan configuration with no database. They fail identically on untouched `main` in this environment, are unrelated to payments, and pass in CI where `DATABASE_URL` points at Postgres.

**NOT RUN — need a database (CI runs them against Postgres on a pull request to `main`, which a branch push alone does not trigger):** `ai-front-desk-entitlement-postgres`, `payment-wallet-refunds-postgres`, `payment-wallet-stk-receipt-postgres`, `pos-refund-race-postgres` (12 tests) and the two e2e journeys (39 tests). The in-memory database used here does not model row locks or real rollback, so **row-lock reservation behaviour and transaction rollback are verified only by those suites.**

New tests (315): `mpesa-config` (92), `mpesa-adapter` (128), `mpesa-callbacks` (89), `mpesa-readiness-route` (6). They cover: missing/malformed variables; sandbox vs production host selection and no cross-use of tokens; expired tokens (one retry, never a loop); STK success and every failure shape; invalid, duplicate, delayed, forged and malformed callbacks; amount and reference mismatches; cross-tenant access; idempotency including concurrent duplicates and recovery after a mid-pipeline failure; reversal authorization, duplicate submission, timeout, failed and unknown outcomes, and the no-resend guarantee; and Paystack/entitlement regression via the existing suites that still pass.

**Mutation check.** 15 deliberate breakages of the safety behaviours above (e.g. timeout parsed as failure, STK Query treating `4999` as failure, a forged event claiming the genuine id, an ambiguous C2B match, partial reversal allowed) were each applied to the source and **each was caught** by at least one test, then reverted.

Existing tests changed deliberately: `mpesa-reversal-receipt` (valid fake environment; full-amount reversals — a partial reversal is now refused), `payments-isolation` (full-amount refund: its subject is the missing receipt), and the in-memory database now enforces the schema's `(provider, providerEventId)` uniqueness.

---

## 8. Files changed

**Source:** `lib/payments/config.ts` · `lib/payments/providers/mpesa.ts` · `lib/payments/providers/types.ts` · `lib/payments/types.ts` · `lib/payments/webhooks.ts` · `lib/payments/engine.ts` · `lib/payments/refunds.ts` · `lib/payments/audit.ts` · `app/api/payments/webhooks/mpesa/handler.ts` · `components/pos/PaymentsClient.tsx`
**New routes:** `app/api/payments/webhooks/daraja/{stk,confirmation,validation,result,timeout}/route.ts` · `app/api/admin/payments/mpesa/readiness/route.ts`
**Comments only:** the five legacy `app/api/payments/webhooks/mpesa/*/route.ts`
**Docs:** `.env.example` · `PAYMENT_WALLET_IMPLEMENTATION.md` · this file
**Tests:** `tests/unit/mpesa-config.test.ts` · `tests/unit/mpesa-adapter.test.ts` · `tests/integration/mpesa-callbacks.test.ts` · `tests/security/mpesa-readiness-route.test.ts` · `tests/helpers/mpesaEnv.ts` (new) · `tests/helpers/posFakeDb.ts` · `tests/security/payments-isolation.test.ts` · `tests/unit/mpesa-reversal-receipt.test.ts` (updated)

**Not touched:** `prisma/` (no schema or migration), `package.json`/lockfile, `.github/`, `scripts/`, `next.config.js`, any Vercel setting, all Paystack code paths. The diff was scanned for provider keys, credentialed database URLs, hex/base64 blobs and bearer literals: none, apart from one intentionally fake placeholder in `tests/helpers/mpesaEnv.ts`.

---

## 9. Outstanding defects and risks

1. **No automatic reconciliation.** There is no cron or scheduled job. A lost callback is recovered only when someone presses **Check status** or an admin re-checks. Pending payments are expired only by that path. A scheduled sweep (Vercel Cron needs a `vercel.json` and a secret — not added) is the recommended follow-up.
2. **STK `PartyB` is merchant-supplied.** Daraja requires `PartyB` to be the receiving shortcode (PayBill) or a till under the head-office `BusinessShortCode` (Buy Goods). Whether Safaricom will set up JATA's shortcode so that merchants' tills are valid `PartyB` values is a **Safaricom/business-model question** (§10). Until answered, STK will be rejected by Daraja for a till that is not under JATA's head office.
3. **Reversal specifics unverified** (§3 items 1–4), including `RecieverIdentifierType`. A reversal that Daraja rejects fails safely (no money moves) — but confirm before relying on it.
4. **STK payments confirmed only by status check have no receipt** and cannot be reversed automatically until the real callback supplies it (or a person records it). The refund is refused with a durable record.
5. **STK prompts cannot be cancelled through Daraja.** A cashier "cancel" marks the payment `CANCELLED`; if the customer then approves, the late success is recorded as a reconciliation exception, not settled.
6. **Preview builds can apply migrations.** `scripts/build.sh` runs `prisma migrate deploy` whenever `DATABASE_URL` is set in *that* Vercel environment, with no environment guard. A Preview environment pointing at the production database would migrate production on every branch build. **Unverified** for this project; keep Preview on a separate database or none. (This work adds no migration.)
7. **Paystack wallet return page missing.** `lib/payments/providers/paystack.ts` sends customers to `<origin>/payments/return`, which no page serves (pre-existing, out of M-PESA scope, left untouched). The wallet's Paystack callback also uses `publicBaseUrl()`, which still falls back to localhost.
8. **Two Paystack webhook endpoints, one dashboard URL per mode** (`/api/paystack/webhook` and `/api/payments/webhooks/paystack`). Pre-existing; unrelated to M-PESA.
9. **Unauthenticated-request cost** (§6.4) and **IP-list stability** (§6.2).
10. **Row-lock and rollback behaviour** is verified only by the Postgres-backed CI suites, which did not run here.

---

## 10. Safaricom-dependent checklist (Phase 7) — none of these can be completed by a repository change

Nothing below has been done. Do **not** share passwords, secrets or credentials in Arena chat; install them directly in Vercel **Production**.

- [ ] **Confirm JATA ATLAS's actual production shortcode** and eligible M-PESA account (PayBill or Buy Goods; for a till, the head-office/store structure). `174379` is the shared public sandbox shortcode and is refused in production.
- [ ] **Confirm the merchant model:** can merchants' own tills/PayBills be valid `PartyB` values under JATA's shortcode, or must each merchant have its own Daraja credentials? (§9.2)
- [ ] **Recover or create the authorized Business Administrator** on the M-PESA Org Portal.
- [ ] **Create and authorize the API operator (initiator)** with the roles the selected products need — at least the reversal role; confirm exact role names with Safaricom.
- [ ] **Daraja production app** approved for M-PESA Express (and C2B if used); obtain the production consumer key/secret and the production **passkey**.
- [ ] **Generate the SecurityCredential** from the initiator password with Safaricom's **production** certificate; install it securely.
- [ ] **Install production credentials** in Vercel *Production only*; keep sandbox credentials in *Preview/Development*.
- [ ] **Register C2B URLs** (§6) once Safaricom enables C2B; ask whether external validation is needed.
- [ ] **Ask Safaricom** whether outbound IP whitelisting applies, for a stable written list of callback source IPs, and whether the URL-keyword rule applies to JATA's paths.
- [ ] **Confirm in the sandbox** the reversal identifier type and full-reversal behaviour (§3).
- [ ] **Controlled live verification** after written authorization (below).

---

## 11. Go-live acceptance criteria — all must be met, with evidence

1. **Safaricom authorization (E):** written confirmation of the production shortcode, approved Daraja production app (M-PESA Express; C2B if used), issued production passkey, and the authorized reversal initiator with its role and certificate guidance.
2. **Production configuration (D):** Vercel *Production* holds every variable in §5 for the products used, with `MPESA_ENV=production`; *Preview/Development* hold sandbox values only; `GET /api/admin/payments/mpesa/readiness` as an admin reports `environment: "production"`, `collectionReady: true`, `reversalReady: true`, `missing: []`, `invalid: []`, `warnings: []`.
3. **Deployment:** this change is merged through the established review and CI (including the Postgres-backed suites), deployed, and each neutral callback route answers `GET` `{"status":"ok"}`.
4. **Registration:** C2B URLs registered (response `ResponseCode "0"`) and the date, operator and registered URL **hosts and paths** (never the token) recorded.
5. **Sandbox verification (C):** the full sequence run against the Daraja sandbox with evidence — STK success; customer cancel (`1032`); timeout (`1037`); wrong PIN (`2001`); lost callback recovered by Check status; duplicate callback; reversal accepted, completed, and a result for an unknown conversation; **and the reversal `RecieverIdentifierType`/full-amount behaviour confirmed**.
6. **Controlled live verification (F), separately authorized in writing, minimal amounts:** (a) one STK Push of KES 1 to an owned phone — settles exactly once, receipt recorded, till shows paid only afterwards; (b) a status check on that payment reports it consistently; (c) a reversal of that KES 1 payment — reserved, `AWAITING_PROVIDER`, then `COMPLETED` by the authenticated result, stock/POS adjusted once; (d) if C2B is used, one over-the-counter KES 1 payment is matched or recorded as a reconciliation exception, never lost.
7. **Clean books:** after those steps, no refund in `UNKNOWN`, no `UNCONFIRMED`/`AMOUNT_MISMATCH` exception left unexplained, and the M-PESA statement reconciles to JATA's records.
8. **Outstanding defects (§9)** are each either resolved or consciously accepted in writing by the owner — in particular §9.1 (reconciliation) and §9.2 (`PartyB`).

Until every item is met and evidenced, the integration is **not production-ready** and must not be labelled GO LIVE.
