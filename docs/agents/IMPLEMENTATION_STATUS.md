# Agent programme — partial implementation and release blockers

This branch is **not** a complete agent network and is not ready for release. The public page intentionally says registration is unavailable; it must not be mistaken for an application flow. No financial policy, provider, payout, production setting or data has been activated or changed.

## Discovery

- `User` has CUSTOMER and ADMIN roles; session checks in `lib/auth.ts` verify session version against the database. An agent capability needs a separately enforced server-side profile and status; possessing a link must not grant ADMIN.
- `lib/registration.ts` creates a business during owner registration. It is not an agent-only registration flow. Existing `/r/[code]` and `Referral` are business referrals, tied to an eligible published business. They cannot simply be relabelled as agent referrals.
- `lib/team-access.ts` has a phone verification process that requires an administrator to start it and deliver a code out of band. It is not a self-service public OTP provider. A configured, approved verification and delivery path is required before automatic activation can safely be implemented.
- `lib/messaging/providers.ts` defines adapters, including mock/sandbox. Configuration and authorization of a live provider for these operational messages are unverified. `lib/notification.ts` is business-scoped and its in-memory deduplication is not a durable agent outbox.
- Paystack webhook validation and transaction handling exist in `app/api/paystack/webhook/route.ts` and `lib/paystack.ts`. Commission must be integrated at authoritative persisted transitions, including refunds, rather than trusted from a browser or duplicated payment service.
- No agent report scheduler was identified. A scheduler and durable, idempotent report/outbox processing remain necessary. Existing CI workflows are not a production scheduler.
- `scripts/build.sh` runs migrations when DATABASE_URL is set. Do not use production credentials for local checks; production migrations require owner authorization.

## Required follow-up before release

1. Implement self-service account creation without forcing a business, durable abuse controls, terms acceptance, phone ownership verification and a review/activation state machine. The existing admin-assisted team verification does not satisfy this requirement.
2. Add reviewed migrations and transactional, unique agent identity, invitation, first-eligible attribution and audited correction models. Enforce server-side ownership, consent, self-referral protection, expiration and replay prevention.
3. Connect verified onboarding and payment events to attribution, agent dashboard and a disabled-by-default versioned commission policy and append-only ledger. Test idempotency, refunds, reconciliation and cross-account isolation against disposable PostgreSQL and Paystack sandbox fixtures.
4. Add durable outbox delivery, retries and accurate provider states, administration and independently scheduled Nairobi-period reports. Configure designated recipients only server-side; prove authorized delivery before claiming it works.
5. Obtain owner decisions on rates, eligible payments, gross/net treatment, refunds, recurring sales, thresholds, legal review, approval and settlement. Do not enable commissions or payouts without approval.
6. Run accessibility, viewport, regression, integration and end-to-end checks and capture real screenshots. Open a release review only when the full acceptance criteria are met.

The existing process-local rate limiter is not a distributed abuse control for serverless instances. Any new public agent endpoint needs an appropriate durable limit or other effective cross-instance protection. The existing registration and business referral paths must remain regression-tested.
