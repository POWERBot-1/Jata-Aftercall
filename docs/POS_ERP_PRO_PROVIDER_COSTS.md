# POS / ERP - PRO — provider and delivery cost comparison

The KES 3,000/month subscription buys the software. It does **not** buy messages, numbers, Sender
ID registration, eTIMS integration fees, hardware, or payment-processing fees. This document puts
those costs side by side so a merchant can price a campaign before sending one.

Everything below is **indicative and dated**. Rates change without notice and depend on route,
volume tier, destination network and negotiated contract. The product itself never bills a customer
from this table: campaign cost comes from the tariff rows stored server-side
(`lib/messaging/billing.ts`), and every campaign shows its estimated cost and asks for confirmation
before approval.

Last checked: **2026-10-27**. Verification status: **unverified against a signed contract.** Nothing
here is a quote.

## 1. SMS to Kenyan numbers

| Provider type | Indicative rate per SMS (KES) | Notes |
| --- | --- | --- |
| Africa's Talking (published tiers) | 0.80 – 1.50 | Their public pricing page lists Safaricom at KES 1.50 on the basic plan and KES 0.80 on toll-free/bulk routes; volume tiers drop to 0.40 at the highest plan |
| Celcom Africa (published) | 0.25 – 0.60 | Slides with volume; cheapest at very high volumes |
| Other local bulk aggregators | 0.30 – 0.90 | Wide spread; delivery quality varies with route |
| International aggregators (Twilio, Plivo, Sinch) | ~KES 0.65 – 4.50 (USD 0.005 – 0.035) | Priced in USD; Kenya termination is not their cheapest corridor |
| Safaricom direct bulk | 0.11 – 1.06 by volume band | Only reachable through a direct commercial agreement |

**What this product assumes by default:** KES 0.90 per SMS segment, stored as a tariff row marked
`verified: false`. It is inside the observed range for a legitimate route and deliberately *not* the
cheapest advertised rate — underestimating cost is the failure mode that surprises a merchant with a
wallet that empties mid-campaign.

**Segment maths matters more than the headline rate.** A 160-character GSM-7 message is one segment;
161 characters is two. One non-GSM character (an emoji, a curly quote) switches the whole message to
UCS-2, where the limit is 70 characters per segment. A 300-character message with one emoji costs
**five** segments, not two. The composer shows this live, and the API refuses to approve a campaign
without a confirmed cost.

Worked example — 1,000 recipients, one 160-character GSM-7 message:

```
1,000 segments × KES 0.90 = KES 900
```

The same 1,000 recipients with one emoji in the text (UCS-2, 2 segments) = KES 1,800. Neither figure
includes Sender ID registration.

## 2. Sender ID registration

Sources disagree, so both positions are recorded rather than picking the friendlier one:

| Source | Claim |
| --- | --- |
| Africa's Talking pricing page | "It is currently free to raise Sender IDs" |
| Third-party Kenya SMS pricing summary (2025) | KES 8,700 one-time (KES 7,500 + 16% VAT) for Safaricom and Airtel registration |

**What the product does:** the Sender ID screen discloses the applicable fee, if the deployment
configures one, and never charges automatically. Applying is one deliberate action per business; a
second attempt on the same name is refused. No fee is invented in code — `SENDER_ID_FEES` carries a
`note` and an `amountCents` that defaults to 0 with an explicit "your provider may charge a
registration fee; this is not charged here" disclosure.

## 3. WhatsApp Business Platform (Kenya)

Meta moved to per-message billing and, from **1 October 2026**, charges for utility messages sent
inside the 24-hour service window. Kenya sits in Meta's "Rest of Africa" pricing region.

| Category | Rate (USD) | ≈ KES | When charged |
| --- | --- | --- | --- |
| Marketing template | 0.0225 | ~2.90 – 3.30 | Every delivered marketing message |
| Utility template | 0.0040 | ~0.52 | Every delivered utility message, including inside the 24-hour window |
| Authentication template | 0.0040 | ~0.52 | Every delivered authentication message |
| Service reply inside the 24-hour window | 0.0040 | ~0.52 | After 1,000 free delivered service messages per business number per month |

Sources: Meta's platform pricing documentation, plus Kenyan press coverage of the October 2026
change (Nation, Nairobi Wire, tech-ish). The KES figure moves with the exchange rate; the USD rate
is the one to budget in.

**Implication for this product:** WhatsApp marketing is roughly **3× the cost of an SMS** per
message at list rates, but a WhatsApp template can carry an image and a button, and a conversation
can continue. The composer prices both channels from tariff rows rather than assuming WhatsApp is
cheaper — it is not.

## 4. Payment processing (money the merchant receives)

Not part of the KES 3,000, and not marked up by this product.

| Rail | Typical merchant cost | Notes |
| --- | --- | --- |
| M-PESA (Daraja) | Tariffed by Safaricom per transaction band; historically ~0.5 – 1.2% equivalent depending on amount band and paybill vs till | The product never charges a merchant for a payment it did not process |
| Card (Paystack, as used elsewhere in JATA) | Per-transaction fee + possible FX | Disclosed by the provider, not by this table |

The storefront in this release **takes no payment**. Customers pay on delivery or collection and the
merchant records the receipt, so there is no gateway fee for a store order until the merchant chooses
one.

## 5. eTIMS

| Item | Cost |
| --- | --- |
| KRA eTIMS onboarding (self-onboarding via eCitizen/USSD/app) | No fee |
| Certified system-to-system integration (OSCU/VSCU via a vendor) | Vendor-quoted; commonly monthly or per-invoice. **Not contracted, not quoted, not integrated here.** |
| This product's eTIMS submission | **No cost, because it does not submit.** Invoices are prepared and validated locally. |

A merchant who needs filing should keep using their certified eTIMS solution alongside this product.
Nothing in this release replaces it, and no invoice is labelled accepted.

## 6. Infrastructure

| Component | Posture |
| --- | --- |
| Queueing | **In-database.** `MsgCampaignRecipient` rows with a compare-and-set claim stand in for a paid queue. No SQS/Cloud Tasks/Redis bill. The trade-off is throughput: batches are claimed by the request that runs them (`≤200` per API call), not by a worker fleet. |
| Hosting | Existing Vercel deployment. The ERP adds server components and route handlers, no new runtime. |
| Database | Existing Neon PostgreSQL. 38 new tables, all indexed by `businessId`; no new cluster. |
| Object storage | None added. Public shop images come from the existing product fields. |
| Observability | Existing logs plus `ErpAuditEvent`. No paid APM added. |

Nothing in this release creates a recurring third-party bill on its own. The first shilling spent is
a message the merchant explicitly approves, from a wallet the merchant explicitly topped up.

## 7. What a merchant actually pays in month one

| Line | Amount (KES) | Optional? |
| --- | --- | --- |
| POS / ERP - PRO subscription | 3,000 / month | No, if they want the ERP |
| Existing Business POS subscription (if held) | 499 / month | Separate product, untouched |
| Sender ID registration | 0 – ~8,700 one-time | Yes, and charged by the provider, not here |
| SMS wallet top-up | Merchant's choice | Yes, no auto top-up |
| WhatsApp fees | Per delivered message | Yes, requires a connected WhatsApp Business account |
| eTIMS integration | Quote from a certified vendor | Yes |
| Card/M-PESA fees on money received | Provider's tariff | Depends on rail used |

## Caveats a reader should keep in mind

1. Rates were read from public pages and news coverage on 2026-10-27, not from contracts.
2. Volume tiers mean the cheapest published rate is rarely the rate a small merchant gets.
3. Delivery rate is not the same as billed rate. Providers bill for submitted segments; a message
   that fails at the handset may still be charged. This product reconciles provider reports rather
   than assuming every submission was delivered.
4. Nothing here is a promise about a future price. If a provider changes its card, the tariff row
   changes and the next campaign is priced at the new rate — the old campaign keeps the cost it was
   approved at, because the reservation was already made.
