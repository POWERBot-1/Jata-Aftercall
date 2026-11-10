# Owner decisions required — precise questions and evidence

**Date:** 2026-11-10 · **Branch:** `arena/3ecfbb83-jata-aftercall` · **PR:** #109 (open, unmerged)
**Purpose:** turn four vague blockers into answerable questions.

Every question below states what is blocked, what the code can already do, exactly which fields and
files are involved, and the specific decision needed. **No answer is proposed, implied or pre-filled.**
Where the repository is silent, that silence is stated rather than filled.

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
