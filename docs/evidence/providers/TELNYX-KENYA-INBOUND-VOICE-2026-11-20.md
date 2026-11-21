# Telnyx Kenya inbound voice onboarding evidence — 2026-11-20

## Current evidence classification

- Voice foundation automated tests on PR #130 candidate: PASS (GitHub run 44797022577; exact tested SHA at time of run: c14a38fb32a0f4032c5ccdeddf6df5c3a54e369c).
- Telnyx support capability guidance: CONFIRMED IN WRITING (email from Quinn, 2026-11-05).
- Kenyan DID inventory for this account: NOT VERIFIED.
- KYC submission/approval: NOT COMPLETED.
- DID purchased/provisioned: NOT COMPLETED.
- Inbound PSTN call from Safaricom/Airtel to a Telnyx Kenya DID: NOT TESTED.
- Production inbound AI call: NOT ACCEPTED.

## Public Telnyx Kenya availability and KYC references (checked 2026-11-20)

Telnyx's published 29 October 2024 market-expansion note explicitly lists Kenya as supporting Local, Mobile and Toll-Free numbers; its PSTN replacement/local-calling page also lists +254. This establishes market-level product support, not current inventory or account-level eligibility. References: https://telnyx.com/release-notes/local-calling-apac-emea and https://support-v2.telnyx.com/en/articles/6622229-pstn-replacement-local-calling-with-telnyx.

The current Kenya DID requirements page confirms business identity details (authorised representative name and contact phone, company name), worldwide business address, proof of address dated within three months, business-use requirement, and service-usage description for Local numbers. Reference: https://support-v2.telnyx.com/en/articles/5466736-kenya-did-requirements.

Telnyx's international-number activation guidance states that inbound calling remains inactive until required documents are uploaded and verified, which can take a few working days; if no number is returned in portal search, a direct DID request can be submitted. References: https://support.telnyx.com/en/articles/5469551-international-numbers-required-documents and https://support.telnyx.com/en/articles/3562148-requesting-numbers.

## Telnyx written response (2026-11-20)

Quinn confirmed the following onboarding path and pricing components in writing:
- Kenya DID KYC: business identity, authorised representative name/contact, company name, worldwide address, proof of address dated within three months, business-use confirmation; local numbers also require a service-usage description.
- Kenya inventory: Telnyx lists Local, Toll-Free and Mobile DID requirements; national numbers are not listed for Kenya. Actual +254 inventory and eligibility must be checked in the portal/support flow.
- Safaricom porting: international port eligibility requires the port request flow, Letter of Authorization and recent invoice; forwarding to a Telnyx DID is carrier-dependent and Safaricom must confirm it.
- Indicative published components: Voice API/Call Control $0.002/min; Voice AI Agents $0.05/min (includes orchestration, hosted STT and TTS); standalone STT starts at $0.0015/min; global DID pricing starts at $1/month. Kenya DID rental, inbound telephony by destination, media streaming, taxes and surcharges remain unquoted and must be confirmed in the portal order summary. LLM tokens are additional.
- KYC document review is via the portal order flow and may take a few working days. Telnyx recommends live chat/support for pre-review before any purchase.

The owner requested illustrative 100/300/500 inbound-minute scenarios only (not committed usage), plus exact Kenya inbound and media-streaming rates, billing minimums, additive charge clarification, and a remote Numbering/KYC pre-review. Quinn replied on 2026-11-20 that Kenya SIP/inbound pricing must be checked in the pricing page or portal; telephony/SIP, Voice API/Call Control, Media Streaming, LLM tokens, taxes and carrier surcharges should be treated as separate/additional line items unless the portal quote says otherwise. Telnyx directed JATA to Mission Control live chat for a Numbering/KYC pre-review and live +254 inventory check before creating an order. The exact Kenya rates, inventory and KYC approval remain unconfirmed.

## Telnyx written response (2026-11-05)

Telnyx support stated:
- Telnyx publishes Kenya DID requirements for Local, Toll-Free and Mobile numbers; documentation does not confirm Safaricom/Airtel-specific inbound routing. Live inventory and inbound behavior must be validated in the Portal.
- Port-in requests are supported through Mission Control, with international-number eligibility checked per number.
- Programmable Voice / Call Control supports answer, transfer, hangup and call-status webhooks.
- Real-time Media Streaming over WebSockets, Conversation Relay and AI Assistant on calls are documented capabilities.
- Kenya-specific number rental and minute rates must be checked in pricing/Portal.
- Telnyx could not confirm a fully zero-cost Kenyan inbound PSTN sandbox for ordinary Safaricom/Airtel callers. Trial inbound calling is limited to a verified phone number.
- Kenya DID business KYC requires authorised representative/contact details, company name, worldwide address, proof of address dated within three months, and a usage description for local numbers. Inbound calling may not activate until documents are verified.

## Facilitation action

Written follow-ups were sent to Quinn on 2026-11-20 requesting:
1. Exact acceptable Kenyan company, tax, authorised representative, address and proof-of-address document checklist and secure submission channel.
2. Current +254 Local/Toll-Free/Mobile DID inventory and routing restrictions.
3. Confirmation whether JATA's existing Safaricom business number can be ported or SIP-forwarded.
4. Full itemised pricing and hard-spend/balance controls.
5. Production webhook/media-streaming requirements.
6. KYC pre-review before any paid number activation.

The follow-ups explicitly prohibit number orders, porting, paid activation, wallet funding or financial commitments. The latest written pricing guidance was received; exact Kenya rates, live inventory, pre-review and KYC outcome remain pending.

## Owner-safe next steps

- Obtain the exact KYC checklist and secure submission channel.
- Owner supplies/reviews required business identity and proof-of-address documents; do not transmit identity documents without owner approval.
- Request inventory confirmation and written itemised pricing.
- Only after KYC and technical design review, obtain owner approval for any paid DID activation.
- Perform an inbound call from an ordinary Kenyan mobile network, validate webhook signature/replay handling, bidirectional media and tenant routing, then complete the live-call acceptance.

No DID purchase, port-in, wallet funding, account top-up or paid activation was performed by this evidence exercise.
