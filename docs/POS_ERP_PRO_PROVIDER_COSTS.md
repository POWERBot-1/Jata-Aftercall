# POS / ERP - PRO — provider cost comparison

**What this is.** Public list prices collected on **2026-10-27** from provider pages, to size the
messaging and compliance side of the product. It is **not** a quote, a contract or a commitment, and
no provider account, credential or trial was created for this work. Prices change; confirm with the
provider before quoting a customer.

**How the product uses these numbers.** Messaging is metered from a prepaid wallet in integer cents.
The wallet is credited only after a verified payment reference, and no top-up is automatic. The KES
3,000 / 30-day POS / ERP - PRO subscription is **separate** from these pass-through provider costs:
message and Sender ID fees are shown to the owner and charged from the wallet, never folded into the
subscription without a separate, explicit authorisation.

## SMS

| Route | Price (KES / segment) | Notes | Source |
| --- | --- | --- | --- |
| Africa's Talking — Safaricom | 1.50 list, 1.25 at the highest volume plan | Major aggregator; published tiered rate | africastalking.com/pricing |
| Africa's Talking — toll-free route | 0.80 list, 0.40 at the highest tier | Different sender path | africastalking.com/pricing |
| Kenya SMS resellers (bulk) | 0.25 – 0.90 by volume tier | Cheaper, quality and delivery SLAs vary widely | reseller price pages (celcomafrica, sent.dm, techweez summaries) |
| Safaricom direct bulk | 1.06 down to 0.11 at the deepest volume tier | Requires direct commercial agreement | Safaricom bulk SMS rate card (third-party summaries) |
| Platform reference rate used for estimates | 0.90 Safaricom / 0.85 Airtel / 0.80 Telkom / 0.90 multi | Deliberately a mid-market reference, marked `verified: false` in `lib/messaging/segments.ts` | `DEFAULT_SMS_TARIFFS` |

Billing unit: a **segment**, not a message. GSM-7 is 160 characters for a single segment and 153 per
segment when concatenated; UCS-2 is 70 / 67. Characters in the GSM-7 extension table (e.g. `{`, `}`,
`€`) cost two septets, so a 160-character "clean" message with one brace is really 161 septets and
splits. `calculateSegments` implements exactly that and is covered by unit tests.

**Sender ID registration.** Africa's Talking's pricing page states it is currently free to raise a
Sender ID; third-party pages quote a one-time KES 8,700 (KES 7,500 + 16% VAT) for Safaricom/Airtel
registrations. The two sources disagree, so the ERP shows a **KES 0 placeholder with an explicit
"fee set by the provider and the network, never charged automatically" note** (`SENDER_ID_FEES`) and
requires the owner to confirm. Branded alphanumeric Sender IDs are outbound-only in this product
unless the provider and network document replies.

## WhatsApp Cloud API

Kenya is priced in Meta's "Rest of Africa" region.

| Category | USD / delivered message | ≈ KES (at ~130) | Notes |
| --- | --- | --- | --- |
| Marketing | 0.0225 | ≈ 3 | Template messages; opt-in required |
| Utility / authentication | 0.0040 | ≈ 0.52 | Service messages inside a 24-hour window are charged from 2026-10-01; 1,000 free delivered service messages per business number per month |

Source: developers.facebook.com WhatsApp pricing page and Kenyan press coverage, Sept–Oct 2026.
WhatsApp has **no** per-segment model — it is per delivered message/template category — so the ERP
labels WhatsApp estimates as estimates and treats the provider invoice as authoritative.

## Kenya eTIMS (compliance, not messaging)

| Item | Cost | Status |
| --- | --- | --- |
| OSCU (always-online system-to-system) | No published per-invoice KRA fee found | Requires development, testing, vetting and certification before use |
| VSCU (bulk/intermittent) | No published per-invoice KRA fee found | Same certification path |
| eTIMS Lite (portal/app/USSD) | No published fee | Not a system-to-system integration; not what this product uses |
| Certified integrator | Commercial, quote-based | Not engaged; no cost incurred |

The ERP ships **no live eTIMS adapter**. `etimsSubmissionPosture().canSubmit` is always `false`, and
the disabled adapter fails closed with `PROVIDER_NOT_CONFIGURED`. Enabling it needs both
`ETIMS_LIVE_ENABLED="true"` and an `ETIMS_ADAPTER_KEY` for a certified adapter, and no such key
exists in this repository.

## Cost of running the software itself

Nothing in this pass required a paid service. The verification database was a disposable local
PostgreSQL 16.2 started from the `pgserver` wheel; no queueing infrastructure, no managed
messaging wallet and no cloud spend was introduced. Hosting remains the existing Next.js + Vercel +
Neon arrangement, whose cost this document does not attempt to re-price.

## What would change the numbers

* Volume: every SMS route above is tiered, and the gap between the cheapest reseller and Safaricom
  direct is roughly 10×, which is a commercial decision rather than an engineering one.
* Sender ID policy: whether branded IDs are free or KES 8,700 one-time materially changes onboarding
  cost per business.
* WhatsApp template category mix: marketing is ~5.6× utility, so campaign composition dominates.
* Any paid queue: deliberately avoided; the outbox is a table with a claim/lease pattern, not a
  hosted queue.

## Not claimed

No provider is connected. No price here has been verified by a signed quote. No message was sent and
no fee was incurred while building or testing this work.
