# JATA AFTERCALL — Safaricom inbound AI receptionist

**Status: FOUNDATION ONLY — NOT LIVE / NOT CUSTOMER-SELLABLE**

Public business number supplied by the owner: **0724317010**  
E.164 form: **+254724317010**  
Current carrier: **Safaricom Kenya**  
Preferred public identity: retain the existing Safaricom number.

## Target call path

Safaricom caller → +254724317010 → owner-approved call forwarding → Telnyx inbound DID → signed Call Control webhook → tenant/number resolver → JATA Front Desk engine → streaming speech pipeline → caller.

Do not port the Safaricom number as the default route. Porting can affect the SIM's existing voice, SMS, M-Pesa and WhatsApp identity. First obtain Safaricom's written confirmation of supported forwarding to the selected destination, billing, caller-ID presentation and service coexistence.

## Implemented foundation in this change

- Server-only Ed25519 webhook verifier using the exact raw body and Telnyx timestamp/signature headers.
- Five-minute replay window.
- Voice webhook ingress endpoint.
- Unit coverage for valid signature, body tampering, stale timestamp and missing configuration.

The route intentionally returns HTTP 503 after successful signature verification. It does not acknowledge or discard calls it cannot process. No call is answered, transferred, recorded, streamed or billed by this code.

## Required before enabling live routing

1. Obtain Telnyx written Kenya-specific quote and KYC/number eligibility confirmation.
2. Provision an inbound Telnyx DID and configure a dedicated Voice API / Call Control application.
3. Configure TELNYX_PUBLIC_KEY in the deployment secret store; never commit it or paste it into chat.
4. Implement durable webhook event idempotency (unique provider event ID), event persistence, retries, and tenant-safe mapping from the called Telnyx DID to the correct JATA business.
5. Implement signed Call Control commands (answer, speak/gather or media streaming, hangup, transfer/human fallback) with command idempotency and strict call-state handling.
6. Implement the real-time media WebSocket service outside a standard Next.js request handler; Vercel HTTP functions are not the persistent audio WebSocket worker.
7. Connect streaming speech recognition and speech generation, with Kiswahili/English support, consent/recording controls and human handoff.
8. Add per-business usage metering, customer billing entitlement, provider spend caps/alerts, concurrency limits, abuse controls and kill switches.
9. Test calls from ordinary Safaricom and Airtel mobile numbers, then test caller ID, answer latency, two-way audio, interruption/barge-in, silence, hangup, transfer, retries and provider failure.
10. Only after all evidence passes: enable the Voice plan for checkout and activate Safaricom forwarding from the owner's handset.

## Safaricom forwarding safety

No forwarding code has been dialled and no SIM settings have been changed. Do not enable unconditional forwarding until the Telnyx destination is provisioned and tested. Prefer a controlled no-answer or busy-only forwarding pilot first, if Safaricom confirms support and charges. Keep a verified rollback instruction ready before any carrier change.

## Environment variables

- TELNYX_PUBLIC_KEY: Telnyx webhook signing public key (base64). Required for signature verification.
- Telnyx API credentials must be added only after an approved secret-management and spend-control review. Never store them in source control.
- Do not set a production voice-enable flag until all gates above are complete.

## Release evidence

| Gate | Status |
|---|---|
| Existing Safaricom number and carrier identified by owner | PASS |
| Webhook signature verification foundation | IMPLEMENTED; CI NOT YET RUN |
| Telnyx account / Kenyan DID eligibility | BLOCKED — provider confirmation pending |
| Tenant/DID mapping and durable event processing | NOT IMPLEMENTED |
| Real-time audio WebSocket worker | NOT IMPLEMENTED |
| Speech pipeline and human handoff | NOT IMPLEMENTED |
| Customer usage metering and billing | NOT IMPLEMENTED |
| Safaricom forwarding | NOT EXECUTED |
| End-to-end live inbound call | NOT TESTED |

**Release rule:** unavailable for customer purchase until every required gate has verifiable evidence. A successful webhook signature test is not evidence of a working telephone receptionist.
