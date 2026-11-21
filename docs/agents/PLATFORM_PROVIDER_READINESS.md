# Platform provider readiness inventory

## Purpose

The Control provider panel needs to distinguish configuration presence from actual service health. A non-empty environment variable is not proof that a provider is reachable, authorized, approved for live traffic, delivering messages, accepting calls, storing objects, or settling money.

## Implemented

- `lib/control/provider-readiness.ts` inspects server-side configuration presence for Paystack, Cloudflare R2 and Telnyx Voice.
- Only variable names, booleans, a configuration state and an observation timestamp are returned. Secret values are never serialized.
- A fully configured provider is still reported as `CONFIGURED_NOT_VERIFIED`.
- Missing or whitespace-only values remain `AWAITING_CONFIGURATION`.
- The Control overview labels the source as a configuration inventory and the section as `PENDING`; it does not claim provider health.
- The existing Control authorization and tenant-scope checks remain in force. This does not change the owner-approved all-DENY policy.

## Explicitly not implemented by this tranche

- No provider network probes, webhook test messages, payment initialization, object writes, phone calls or customer communications.
- No environment-variable read/write UI and no feature-flag mutation endpoint.
- No production credential changes, provider activation, paid service, live billing or deployment.
- No MRR, ARR, commission accrual, payout or financial reconciliation claim.

## Required next evidence

1. Paystack isolated sandbox lifecycle with verified webhook signature, replay/idempotency, refund/chargeback and settlement reconciliation evidence.
2. R2 isolated preview bucket write/read/delete round-trip with tenant-bound object keys and cleanup proof.
3. Telnyx Kenya inbound/outbound test-call evidence, media-worker connection, webhook signature/replay and emergency kill-switch test.
4. Provider-specific timeout, retry, circuit-breaker and last-success evidence from non-production probes.
5. Independent review of any future Control display policy before any role grant or financial/PII exposure.

Until these exist, provider state must remain pending/unverified. The programme-completeness gate must not be weakened to close this requirement.
