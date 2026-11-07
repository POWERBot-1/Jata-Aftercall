# JATA AFTERCALL agent commission policy

**Owner-authorized commercial terms:** 40% of the value of each successfully verified subscription plan sold. An agent becomes eligible for commission payment only after at least 10 qualifying plan sales in the same calendar month.

## Effective implementation interpretation

- Currency: KES.
- Commission basis: the actual gross subscription amount successfully charged and verified by Paystack, stored as integer KES minor units. The verified amount actually charged is authoritative; later changes to the catalogue price do not rewrite the historical sale value.
- Rate: 4,000 basis points (40%), calculated with integer arithmetic and half-up rounding at the KES minor-unit precision.
- Qualifying sale: one distinct Payment with purpose=SUBSCRIPTION, status=PAID, a valid Paystack transaction ID, a non-null business and plan, and a first-touch converted referral attribution to the agent.
- Agent condition: the referrer must have an AgentApplication with agentStatus=ACTIVE and a verified phone.
- Monthly threshold: 10 qualifying subscription plan payments in the same Africa/Nairobi calendar month. The count includes the current payment and is based on distinct persisted payment rows, not browser submissions.
- Accrual: a 40% immutable ACCRUAL ledger entry is created for each qualifying sale, even before the monthly threshold is reached. The threshold controls payment eligibility, not whether the sale's commission is calculated.
- Idempotency: sourceEventId=subscription-sale:<paymentId> prevents duplicate accrual on webhook/verify retries.
- Audit: the accrual and its audit event are written in the same database transaction as the successful subscription settlement.
- Refunds: an accrual must not be reversed based solely on a browser request or local status. A provider-verified full refund is required before a full reversal; partial refunds require review until a partial-reversal rule is explicitly approved.
- Payout: this policy does not authorize automatic transfer execution. A verified payee destination, payout controls, settlement reconciliation, and provider transfer integration are separate requirements. Until those exist, commission remains an immutable accrued liability and no external payout is initiated.

## Release and accounting boundaries

The evaluator and transactional accrual helper are not proof of provider delivery, cash settlement, agent payee ownership, tax treatment, statutory withholding, or payout execution. A payout must be separately reconciled and audited. Historical payments are not retroactively accrued by this change; only a newly processed verified settlement triggers the helper. No production financial records were modified during implementation.

## Technical sources

- lib/agents/commission-calculation.ts
- lib/agents/commission-accrual.ts
- lib/paystack.ts
- lib/pos/settlement.ts
- lib/autopilot/settlement.ts
- tests/unit/agent-commission-calculation.test.ts
- tests/unit/agent-commission-accrual.test.ts