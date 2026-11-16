# Owner-authorized programme decisions — 2026-11-16

**Authority:** The owner explicitly authorized the assistant in the 2026-11-16 conversation to act on their behalf, enact the best decisions where possible, and proceed independently on isolated staging, financial reporting definitions, the all-DENY access policy, commission policy, Website Studio visual evidence, recoverability, and read-only official-domain/payment inspection.

**Scope boundary:** This record authorizes documentation, isolated disposable testing, read-only provider inspection, and non-production implementation. It does not authorize spending, plan upgrades, paid service provisioning, production database or environment changes, DNS/email changes, live payment/refund/payout, provider activation, Control grants, production deployment, or merge. If a safe staging environment requires spend or production credentials, stop and report the exact dependency.

## 1. Financial reporting definitions — adopted

These definitions govern proposed JATA AFTERCALL management reporting. They do not replace statutory accounts, tax advice, or the authoritative payment ledger.

- **MRR:** Sum of the monthly-normalized recurring subscription consideration for subscriptions that are currently active, paid/settled, and not in trial, pending, expired, cancelled, suspended, or otherwise delinquent status. Annual recurring subscription amounts are divided by 12. One-time fees, setup charges, deposits, and non-recurring products are excluded. Use the effective subscription price after recurring discounts. Report currency and as-of timestamp.
- **ARR:** MRR × 12. Label as annualized recurring run-rate, never cash received or booked statutory revenue.
- **Gross cash collected:** Sum of successful, settled customer payment amounts in the reporting period, from the authoritative payment records. Pending, initiated, failed, reversed, and test-mode transactions are excluded.
- **Refunds and chargebacks:** Report separately by settlement date and original payment reference. **Net cash collected** = gross cash collected − settled refunds − settled chargebacks. Do not silently net them away.
- **Payment fees:** Report separately as transaction costs when authoritative fee data exists. Do not estimate missing fees.
- **Tax:** Report separately only from authoritative tax records. Do not infer tax from gross payment totals.
- **Subscriptions:** Show counts by actual persisted lifecycle status; distinguish trial, active, pending, past-due/grace, expired, cancelled and suspended. A count is not revenue.
- **AI usage:** Show provider-reported units and provider-billed/authoritative costs separately. If a provider meter or cost source is unavailable, show UNAVAILABLE, not a fabricated estimate.
- **Jobs and incidents:** Show persisted queue/job states (queued, running, succeeded, failed, dead-letter) and incident severity, opened/resolved timestamps and last successful check. Do not imply a worker or integration is healthy merely because it is configured.
- **Reconciliation:** Payment rows, subscription entitlements, refunds, chargebacks and ledger totals must reconcile by immutable provider/payment identifiers. Duplicate webhook deliveries are idempotent. A mismatch is an exception, not an amount to auto-correct.

### Privacy and display controls — adopted

- Default to aggregate metrics and least-privilege field exposure.
- Mask customer/agent email addresses and phone numbers in routine overview screens; reveal no more than needed for a separately authorized support case.
- Never display card/bank credentials, Paystack secrets, webhook signatures, access tokens, full identity documents, or raw authentication/session material.
- Do not expose payment details, personal data, commission amounts, audit exports, or cross-tenant records through /control while the owner-approved all-DENY 90-cell matrix remains in force.
- No Control operator is provisioned by this decision. The existing all-DENY policy and CONTROL_ROLE_ACCESS_ENABLED=false remain unchanged.

**Implementation status:** Definitions adopted; implementation and authoritative-source verification still required. ADMIN-005 remains BLOCKED until the metrics are implemented, reconciled and independently tested. This decision does not mark ADMIN-005 PASS.

## 2. Agent commission policy — conservative operating policy adopted; accrual remains disabled

### Attribution and eligibility

1. Attribute a referral only when a valid JATA-issued referral identifier is present in the business signup/checkout flow and is persisted before the qualifying payment.
2. Use **first-touch attribution**, with a **30-calendar-day attribution window** from the first valid recorded referral interaction to the initial qualifying payment.
3. One business/subscription acquisition has one attributed agent. No stacking, multi-agent split, self-referral, retroactive claim, or silent reassignment.
4. Corrections require a reason, evidence, independent approval and immutable audit. Attribution is not editable by the attributed agent.
5. Only the first successfully settled, non-test payment for a new eligible subscription is a qualifying event. Initiated, pending, failed, duplicate, test, complimentary, internal, refunded-before-settlement, or chargebacked transactions do not qualify.
6. Commission basis is the eligible subscription consideration actually settled, after discounts and excluding separately itemized taxes, payment-provider fees, refunds and chargebacks. If the authoritative source cannot distinguish these amounts, do not calculate commission.
7. Renewals, upgrades, add-ons, reactivations and cross-sells are **not commissionable** under this initial policy. They require a separately versioned schedule and approval.
8. Refunds and chargebacks reverse the corresponding original commission in full or proportionately to the refunded eligible consideration. Reversals reference the original ledger entry; never delete or overwrite it.
9. Duplicate or out-of-order provider events must be idempotent. No accrual is created until payment settlement and entitlement state are independently reconciled.

### Rates, holds and payouts

- No numeric rate is invented or inferred. The rate schedule must be explicit by eligible plan/product and policy version before any accrual can be enabled.
- Until that rate schedule is approved and configured, the effective commission rate is NOT CONFIGURED, not an implied 0% payout promise. The evaluator must refuse accrual.
- No renewal commission, hierarchy override, bonus, cap, tax treatment beyond the stated net basis, or exception is implied.
- No payout is enabled. Any future payout requires a separately approved payout method, minimum threshold, schedule, hold period, reconciliation, maker-checker approval and proof of payee ownership.
- The ledger must be append-only: accrual, reversal and adjustment are separate immutable entries linked to source events and policy version.

**Implementation status:** The conservative eligibility/attribution/reversal rules are adopted as the target policy. Numeric rate schedule and payout operations remain deliberately unconfigured. ADMIN-006 and ADMIN-013 remain BLOCKED; no accrual writer or payout path may be activated until the rate schedule and remaining payout terms are separately completed and tested. This decision is not permission to move money.

## 3. Access control — reaffirmed

The owner reaffirms DENY for all 90 role/capability combinations. No role is explicitly approved for ALLOW. No operator identity, Control grant, role assignment, positive permission test or production access is authorized. Keep CONTROL_ROLE_ACCESS_ENABLED=false. Any future exception requires a separate exact-cell decision and implementation review.

## 4. Recovery acceptance — adopted targets

- Target **RPO ≤ 15 minutes** for authoritative payment, subscription and ledger data, subject to provider capability and plan confirmation.
- Target **RTO ≤ 4 hours** for restoration of the core customer-facing service.
- A logical backup must be encrypted, integrity-checked, restorable into a separate isolated database, and reconciled for schema, table counts, critical financial rows and Prisma migration ledger.
- Maintain a separate provider-native recovery path (Neon PITR/snapshot) and test it independently; disposable PostgreSQL CI is not evidence of Neon PITR.
- Preserve at least one independent backup copy with access controls separate from the primary database credentials. Retention and storage location must be confirmed against existing provider capability and cost before provisioning.
- A recovery drill passes only when timed restore, data-integrity checks, application smoke tests and evidence review all pass. No production restore or destructive migration test is authorized.

**Implementation status:** Targets adopted. The current disposable restore rehearsal is FAIL on schema comparison; provider-native Neon recovery is NOT TESTED. No recovery acceptance is claimed.

## 5. Staging and integration test boundary

- Use only disposable PostgreSQL/Neon staging resources, isolated storage, Paystack sandbox credentials and non-production webhook endpoints.
- No Preview deployment may run payment or database integration until Preview has its own staging DATABASE_URL/DIRECT_URL, Paystack test-only keys and webhook secret, isolated storage bucket/credentials, non-production callback URLs and safe auth configuration.
- Current Vercel inspection found Paystack environment variables targeted at both Preview and Production, and no dedicated Preview database URL. This is an unsafe configuration for live integration testing. Do not execute payment flows or deploy a preview for integration until isolated values exist and are verified without disclosing secrets.
- Do not create paid Neon/Cloudflare/Vercel resources, upgrade plans, or incur usage charges under this authorization. Use existing free/disposable capacity where available; stop if cost is required.
- Test payment lifecycle using sandbox events only: checkout initialization, signature verification, webhook idempotency, settled-payment entitlement, duplicate/out-of-order events, failure, refund and chargeback reversal. No live transaction.

## 6. Website Studio visual evidence

- Continue exact-head historical-baseline and candidate capture using the documented 20-family set, draft/published states, six viewports and reduced-motion.
- Preserve screenshots and machine-readable observations; independently inspect them. Capture queue/re-entry/cancellation/cleanup and AI Front Desk renderer integration where applicable.
- Do not mark visual criteria PASS from a successful screenshot workflow alone. Independent review and complete route/state coverage remain required.

## 7. Official-domain and payment inspection

- Authorized: read-only inspection of Vercel project/domain metadata, public HTTP responses, TLS certificate and security headers, redirect behavior, cookie attributes where observable, Paystack sandbox configuration metadata and non-production webhook flow.
- No DNS, HostAfrica, Vercel environment, production database, Paystack live settings, email records, provider configuration or payment state may be changed.
- Never decrypt or print secrets. Report only key names, target environments, presence/absence and safe metadata.
- Vercel domain metadata already shows apex and www attached and verified, but neither has a Vercel redirect target. Independent TLS/HSTS/cookie and authoritative HostAfrica mail/DNS evidence remain outstanding.

## 8. Release posture

All adopted decisions are inputs to implementation, not proof of completion. Keep the programme-completeness and release gates strict. Do not merge, deploy to Production, provision an operator, enable commission accruals, initiate payouts, or change production resources under this record.
