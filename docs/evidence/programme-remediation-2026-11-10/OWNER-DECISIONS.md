# Owner decisions required — precise questions and evidence

**Date:** 2026-11-10 · **Branch:** `arena/3ecfbb83-jata-aftercall` · **PR:** #109 (open, unmerged)
**Purpose:** turn four vague blockers into answerable questions.

Every question below states what is blocked, what the code can already do, exactly which fields and
files are involved, and the specific decision needed. **No answer is proposed, implied or pre-filled.**
Where the repository is silent, that silence is stated rather than filled.

Each decision now also carries a **recommendation**, added at the owner's request and labelled as
such throughout. A recommendation is advice for you to accept, amend or reject — it is **not** a
decision, and nothing has been implemented on the strength of one. No security constant, financial
formula or policy value has been changed.

---

## Decision 1 — PII visibility in the Control console

**Blocks:** ADMIN-005, ADMIN-010. **Type:** policy, not engineering.

The console already reads authoritative rows. It currently *withholds* the fields below because
`ADMIN-005` says "no cross-tenant leakage" while `ADMIN-010` says "functional, not mocked" — and
nobody has said what an authorised operator is allowed to see.

| Surface | Field withheld today | Code |
|---|---|---|
| Business records | `Business.phone`, `.whatsapp`, `.location`, `.lat`, `.lng`, `.description`, owner identity | `app/api/control/businesses/route.ts:26` selects `id, name, slug, category, status, isPublished, createdAt, updatedAt` only |
| Owners/tenants | `User.email`, `.name`, `.phone` | never selected by any control route |
| Payments | `Payment.amount`, `.reference`, `.paystackId`, `.customerEmail`, `.raw` | `app/api/control/records/route.ts` selects `id, businessId, status, purpose, createdAt` |
| Commissions | ledger amounts, currency, agent and payment identity, payable balance | `control/records` selects `id, entryType, createdAt, payment.businessId` |
| Agents | agent name, phone, user identifier | `control/overview` returns counts and status groupings only |

**Question 1.** For each of the four rows below, say **VISIBLE**, **MASKED** (and how), or **HIDDEN**
— separately for a platform-wide grant and for a business-scoped grant:

1. Owner identity (name, email, phone) of a business in scope.
2. Payment amount and M-Pesa reference for a business in scope.
3. Commission ledger amounts and payable balance.
4. Agent identity (name, phone, user id) on an application.

**Why code cannot proceed:** any choice here is a privacy policy for real Kenyan customer data. Guessing
one would be inventing a data-protection decision, and the register forbids exactly that.

**Note on a related, separately blocked item:** refund/reversal authority in the console has **zero**
implemented surface — there is no route, no `payments.refund`-style permission key in
`lib/control/permissions.ts`, and no audit action for it. That is not a display decision; it needs its
own authorisation before anyone writes code.


### Recommendation (a recommendation, not an answer)

**MASKED for business-scoped grants; VISIBLE for platform-wide grants that carry `payments.read` /
`audit.read` explicitly; HIDDEN for anyone else.** Rationale: the console's whole purpose is
support and audit, which requires operator-visible amounts; but a per-business grant is the grant a
compromised account is most likely to hold, so it should not expose an owner's phone number or a
payer's email. Blast radius scales with grant breadth, so visibility should too.

**Implications.** More masking means more support escalations that need a second operator (cost:
speed) and smaller breach radius (benefit: privacy). Full VISIBLE would make ADMIN-005's
cross-tenant requirement depend almost entirely on the scope check being perfect; full HIDDEN would
block ADMIN-006's reconciliation, which cannot be done without amounts.

**Security/financial risk.** Amounts and M-Pesa references are financial data; `customerEmail` and
owner `phone` are personal data under Kenya's Data Protection Act. A wrong choice here is a
regulatory exposure, not a UI preference — which is why it is your decision, not mine.

**Evidence to validate the decision.** A masked-vs-visible matrix rendered in the console for one
platform grant and one business grant, captured at six viewports, plus an audit-log entry per read.

---

## Decision 2 — the required metric set, and what "MRR/ARR" may mean

**Blocks:** ADMIN-005, ADMIN-010.

The requirement names MRR/ARR, trial, usage, AI, system, job and incident metrics. The console has no
recurring-revenue figure at all.

**What the data actually supports — this is the crux:**

| Fact | Evidence |
|---|---|
| Price lives per plan | `PlanConfig.priceKES` (integer KES), `PlanConfig.durationDays` (`prisma/schema.prisma:763`) |
| Duration is **not** uniformly 30 days | seeded annual plan is `durationDays: 365`, monthly `30` (`app/dev/workspace-preview/page.tsx:118-121`) |
| A subscription records the plan it is on | `Subscription.planId` → `PlanConfig` (`schema.prisma:781`) |
| Payments record the amount actually paid | `Payment.amount` (`schema.prisma:810`) |

A monthly-equivalent figure is therefore **derivable**, but the derivation is a financial definition
someone must own: normalising a 365-day annual plan to a 30-day month changes the reported number.
Reporting raw annual amounts as "MRR" would be wrong; silently dividing by 12.17 is a choice.

**Question 2a.** May MRR be computed as `Σ (PlanConfig.priceKES × 30 / durationDays)` over
`Subscription.status = ACTIVE`? If not, give the formula you want.

**Question 2b.** Is ARR simply `MRR × 12`, or is it annual-plan revenue only? The two differ whenever
a customer is on a monthly plan.

**Question 2c.** For each remaining metric, confirm it is required or drop it:
trial, AI usage, job/queue health, incident, usage.
*Current state:* `system` reports application and database reachability read at request time;
`exceptions` counts failed/refunded payments, pending agent applications and failed notification rows;
`communications` reports outbox states. Verified absent from `prisma/schema.prisma`: **no trial
state** (`SubscriptionStatus` is PENDING/ACTIVE/EXPIRING/EXPIRED/SUSPENDED/CANCELLED — there is no
TRIAL, and no trial-end date on `Subscription`), **no AI-usage counter**, and **no job/queue or
incident model**. The closest existing thing to a "job" source is the notification
outbox/attempt/recovery tables, which are delivery records, not a job queue. Each of these needs a
decision on where an authoritative number would come from before anything is displayed — otherwise
the console would have to invent it.


### Recommendation (a recommendation, not an answer)

**Report what the records already assert, and label the derivation explicitly.** Concretely:
`MRR = Σ (PlanConfig.priceKES × 30 / PlanConfig.durationDays)` over `Subscription.status = ACTIVE`,
displayed as "MRR (30-day normalised)" with the formula shown next to the number; `ARR = MRR × 12`
labelled as derived; and a separate, unnormalised "cash collected in period" figure straight from
`Payment.amount` where `status = PAID`.

**Why not raw sums.** Summing `priceKES` across active subscriptions would report a KES 9,999 annual
plan as if it were monthly — roughly a 12× overstatement of run-rate. Dividing a 365-day plan by 12
(31.4 days) and by 30 (the actual normalisation) differ by ~4.7%, which is the difference between
two defensible numbers; picking one silently is a policy change dressed as arithmetic.

**Implications.** Normalisation makes the figure comparable and auditable but will never tie exactly
to bank receipts; cash-collected ties to M-Pesa but jumps at renewal. Whichever you pick, the label
must travel with the number or the console becomes an argument.

**Security/financial risk.** These numbers are the ones an investor, a lender or a buyer reads. A
mis-derived MRR is a securities-grade misstatement, not a display bug — hence owner approval.

**Evidence to validate the decision.** A fixture with one monthly and one annual active
subscription, showing the formula, the computed value, and the same period's cash-collected figure
side by side, reconciled by hand in the review.

---

## Decision 3 — control-plane access activation (the biggest single unblock)

**Blocks:** ADMIN-010, ADMIN-015, and any positive-role console evidence.

**Current state, verified this cycle:**

- `lib/control/role-policy.ts:10` — `export const CONTROL_ROLE_ACCESS_ENABLED = false as const;`
- `lib/control/access.ts:31` — every protected route returns `403 POLICY_PENDING` while it is false.
- **There is no environment variable, test flag or interface that can enable it.** Grep across
  `lib/`, `app/`, `scripts/` finds no override; the repository is the source of truth and the only
  occurrence is the constant.
- The owner-approved policy is **DENY for all 90 role/capability cells** (approved 2026-11-01).
- Consequently **no positive console journey can be executed anywhere** — not in CI, not locally.
  `scripts/browser/control-deny.check.mjs` proves the denial path and nothing more.

**Question 3a.** In a **disposable CI database only**, may `CONTROL_ROLE_ACCESS_ENABLED` be flipped to
`true` for the duration of an acceptance run, with the temporary grants created exclusively by the
test fixture? This requires editing `lib/control/role-policy.ts` — a security-sensitive constant — so
it needs explicit authorisation, not an engineering judgement call.

**Question 3b.** If yes, which role/capability cells may the fixture grant? The acceptance journey
needs at minimum `businesses.read` and (for suspend/reinstate proof) `businesses.suspend`,
`businesses.reinstate`. Naming them is an owner act; the repository currently permits a **strict**
subset — `tests/unit/control-plane-security.test.ts` pins that the database grant table may only ever
**narrow** the shipped policy, never widen it.

**Question 3c.** If no, should ADMIN-010/ADMIN-015 be formally recorded as permanently unachievable
rather than "blocked"? They cannot pass without the console being operable.


### Recommendation (a recommendation, not an answer)

**Yes to 3a, narrowly: a compile-time test seam, not an environment variable.** Add
`CONTROL_ROLE_ACCESS_ENABLED` as a function of an explicit build flag that defaults to `false` and
can only be flipped in a build compiled for the disposable harness, and require the flip to be
accompanied by an assertion that `DATABASE_URL` matches the disposable pattern. **No to an
env-var override at runtime** — a runtime switch on a security constant is a production footgun, and
the directive forbids one.

**Why not simply leave it `false`.** It is `false as const`, so no positive console journey can be
executed anywhere: ADMIN-010 and ADMIN-015 cannot pass without a code change, and a reviewer cannot
distinguish "denied by policy" from "cannot be exercised". That is a permanent blind spot in the
release evidence.

**Implications of flipping it.** Roughly 3 findings become testable (ADMIN-010, ADMIN-015, and the
positive half of ADMIN-005). Costs: a security-sensitive edit to `lib/control/role-policy.ts`, a new
CI-only build path to maintain, and the standing risk that someone compiles the wrong variant.

**Security/financial risk.** This constant is the only thing standing between an authenticated
customer and the control plane. Any wrong value grants platform-wide operator capability. The
existing tests make that a *narrowing-only* system: `tests/unit/control-plane-security.test.ts` pins
that DB grants may only ever narrow the shipped policy, never widen it. Keeping that invariant is a
precondition, not a detail.

**Evidence to validate the decision.** For each granted cell: an authenticated browser run showing
the granted action succeeding, a second run showing the same account refused a non-granted
capability, and an audit row per mutation — all on the disposable database, with the production
constant verified unchanged.

---

## Decision 4 — commission policy (blocks two full requirements)

**Blocks:** ADMIN-006, ADMIN-013.

`lib/agents/commission-calculation.ts` is a complete, tested evaluator whose own header says:

> "No policy or rate is shipped with the product. No production integration currently invokes this
> evaluator. Tests use explicit hypothetical rules, not approved financial terms."

The evaluator needs, as data, every one of the following. **Not one is in the repository.**

| Parameter | Type accepted by the code | Owner value |
|---|---|---|
| Rate | `FIXED` (minor units) **or** `PERCENTAGE` (basis points) | ? |
| Basis | `GROSS` or `NET` | ? |
| Eligible plans | subset of `PlanConfig` ids | ? |
| Qualifying events | `NEW_SALE`, `RENEWAL`, `UPGRADE` — which count? | ? |
| Effective window | `effectiveFrom`, `effectiveUntil` (exclusive) | ? |
| Renewal retention window | `AttributionSnapshot.validUntil` — "must be explicitly approved" per the code comment | ? |
| Rounding | `HALF_UP` or `DOWN` (percentage only) | ? |
| Reversal rule | what reverses an accrual, and what happens after a refund | ? |

**Question 4.** State values for the table above, or confirm that agent commission is **out of scope
for this release** — in which case ADMIN-006/ADMIN-013 should be re-scoped rather than left "blocked",
because they cannot pass without the numbers.


### Recommendation (a recommendation, not an answer)

**Scope agent commission OUT of this release, and leave the evaluator unshipped.** The evaluator is
complete and tested and explicitly ships no rate; leaving it dormant is safer than shipping any
invented number.

**If you would rather ship it,** the minimum viable policy that satisfies the code's own contract is:
`PERCENTAGE`, `basisPoints` you specify, basis `NET`, events `NEW_SALE` + `RENEWAL`, effective window
as a dated version, renewal retention window stated explicitly (the code comments call this out as
requiring approval), rounding `DOWN`, and reversal of the accrual on `REFUNDED`. **The rate is yours
to give; I will not propose one.**

**Implications.** Shipping commission needs a ledger, reversal handling, payout reporting and
finance sign-off — considerably more than the evaluator. Deferring keeps ADMIN-006/ADMIN-013 open and
must be re-scoped in the register rather than left "blocked" indefinitely.

**Security/financial risk.** Commission is money owed to a third party. A wrong rate or a wrong
attribution window is a payment error, and a retroactive fix is a reconciliation exercise.

**Evidence to validate the decision.** A dated policy version applied to fixtures covering
new-sale, renewal, upgrade, refund-reversal and out-of-window attribution, with the expected amount
computed independently of the code under test.

---

## What can proceed WITHOUT any owner decision

| Work | Why it is safe | Status |
|---|---|---|
| Six-viewport capture and retrieval | evidence machinery only | **done** — 6/6 at `b9dd943` |
| Share-edge measurement (gutter/symmetry assertions) | measures, changes no CSS | **done** — `752e334` |
| Evidence-manifest integrity | clerical; the gate is unchanged | **done** — `4828463` |
| Motion queue/cancellation browser evidence | no policy involved | **open** — needs the harness extended, not a decision |
| Documentation of every blocker with evidence | reporting only | **done** — this file, `README.md` |
| Full-resolution evidence channel (`visual-evidence` label) | rewrites the branch; owner's call but not a *policy* decision | **offered, not applied** |

## What CANNOT proceed without an owner decision

Console metrics and PII (1, 2) · any positive console journey (3) · all commission work (4) · and, by
extension, ADMIN-015's authenticated console screenshots, ADMIN-010, ADMIN-006, ADMIN-013.

That is **5 of the 24 findings** unblocked by answers 1–4, plus the 13 that additionally need
browser/DB/reviewer access this sandbox lacks.
