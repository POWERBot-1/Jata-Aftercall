# Loyalty 2.0 — configurable points and rewards

**Status:** implemented, not released. The programme is shipped **switched off** with no earning
rate; nothing is awarded and nothing can be redeemed until a business owner configures and
activates it. Production activation is an owner decision and is not part of this change.

**Migration:** `prisma/migrations/20261129000000_loyalty_points_rewards` (additive only).
**Code:** `lib/business-hub/loyaltyPoints.ts` · owner screen `app/dashboard/businesses/[id]/loyalty/points`
**Customer surface:** `components/business-hub/PointsWallet.tsx`, reached from the existing loyalty
card lookup on the business page.

---

## 1. What this is, and what it is not

Loyalty 2.0 is a **second, independent loyalty mechanism** that sits beside the digital stamp card.

| | Stamp card (existing) | Points (new) |
|---|---|---|
| Unit | one stamp per verified visit | points per KES of eligible spend |
| Configuration | stamps per reward | earning rate, minimum spend, cap, threshold, expiry, eligible items, rewards |
| Balance | `LoyaltyCard.stampsEarned` / `stampsRedeemed` | `LoyaltyPointsAccount.availablePoints` |
| History | `LoyaltyStampEvent`, `LoyaltyRedemption` | `LoyaltyPointsLedger`, `LoyaltyRewardRedemption` |

The two never mix. No code path reads or writes another mechanism's balance, no screen adds them
together, and no migration touches a stamp table. A business may run either or both.

Points are **not money**:

* no Paystack call, refund, payment or transfer is made anywhere in this feature;
* points cannot be withdrawn, exchanged for cash or used to settle an invoice;
* an order request is **not** a purchase — the public order-request flow takes no payment, so it
  can never award points. Points exist only for a **verified purchase**;
* `source: PAYMENT_PROVIDER` exists in the schema for future authoritative payment verification.
  It is not implemented, and `awardPoints` **refuses** it, so an unverified payment event cannot be
  laundered into points.

## 2. Earning

```
points = floor(eligibleKES / kesPerPoint) × pointsPerUnit        (capped by maxPointsPerTransaction)
```

* `eligibleKES` is the purchase total, or — when the owner restricted the programme to specific
  products or services — the total of the eligible lines only.
* The calculation is a pure function (`calculatePoints`) and is deterministic: the same inputs
  always produce the same number of points. There is no pro-rata rounding and no random component.
* A purchase below `minPurchaseKES` earns nothing; a purchase containing no eligible item earns
  nothing. Both are reported to the owner rather than silently accepted.
* `awardPoints` refuses to run at all unless the programme is active **and** a rate is set, so a
  half-configured programme cannot start issuing points.

**Verification.** Points are awarded when a person with permission on the business records the
purchase and its reference (`source: OWNER_VERIFIED`). That is a human attestation and the UI says
so in as many words. Automatic payment verification is not part of this release.

**Replay protection.** The idempotency key is `EARN:<normalised transaction reference>`, held by a
unique index on `(businessId, idempotencyKey)`. Replaying the same reference — a second tap, two
staff members entering the same receipt, a retried request — returns the **original** ledger entry
with `duplicate: true` and writes nothing new.

## 3. Redemption

1. The reward must belong to the business and be published.
2. The wallet must hold at least `minRedeemPoints`, and at least the reward's cost.
3. The cost is the **catalogue's** `pointsCost`. A caller never supplies an amount.
4. Inside one transaction: the balance is decremented with a compare-and-set
   (`UPDATE … WHERE availablePoints >= cost`), the redemption is created, the ledger entry is
   written, and the oldest earning lots are consumed first (expiring points before points that
   never expire).

The compare-and-set is the double-spend guard: two simultaneous redemptions serialise on the
account row, the second matches zero rows, and it is refused. The double-tap guard is the unique
index on `(businessId, idempotencyKey)`: a retried request returns the original redemption.

Cancelling a redemption returns the points with a compensating ledger entry; a redemption can only
be cancelled once.

## 4. The ledger

`LoyaltyPointsLedger` is append-only. Every row carries: business, account, type, direction,
magnitude, balance after, reference, idempotency key, source, source reference, the entry it
reverses, explanation, actor, timestamp and — for an earning lot — its expiry date and the portion
still unspent.

Types: `EARNED`, `REDEEMED`, `EXPIRED`, `REVERSED`, `MANUAL_ADJUSTMENT`.

**Corrections are compensating entries, never edits.** The only field ever updated in place is an
earning lot's `remainingPoints`, consumed by redemptions and expiry. Historical rows are never
rewritten and never removed.

**Reconciliation.** `available = Σcredits − Σdebits`. `reconcileAccount` recomputes it from the
ledger and the owner's per-customer screen shows the result, so a drift cannot sit unnoticed.

## 5. Reversals (refunds and cancellations)

`reversePoints(transactionRef)` finds the original `EARNED` entry and writes a `REVERSED` entry
that points at it.

* The idempotency key is `REVERSE:<original entry id>` — a refund processed twice reverses once.
* The original entry is preserved, not modified.
* By default only the **unspent** portion is taken back, and the shortfall is reported to the owner.
  Nothing pushes a customer into a balance the business never agreed to recover.
* If an owner explicitly enables `allowNegativeBalanceOnReversal`, the full award is reversed and
  the wallet may go negative. No automatic recovery, reminder or debt collection exists either way —
  that is a business decision, not a platform behaviour.
* A reversal requires a reason (enforced in the library, not only in the route) and a
  `high_risk` permission.

## 6. Expiry

* Off by default. When `expiryMonths` is `NULL`, `runExpiry` does nothing and says so.
* When enabled, an earning lot expires `expiryMonths` after it was earned, and only the portion
  still unspent.
* Idempotent per lot: the key `EXPIRE:<lot id>` can only be written once, so a scheduler that runs
  twice, or resumes after an interruption, never expires the same points twice.
* The original award is preserved; the expiry is a separate ledger entry.

## 7. Manual adjustments

`adjustPoints` requires a signed amount, a reason of at least five characters and a
`configure`-level permission. A credit adds a `MANUAL_ADJUSTMENT`/`CREDIT` entry; a debit adds a
`MANUAL_ADJUSTMENT`/`DEBIT` entry and is refused when the wallet does not hold the points. An
optional `idempotencyKey` makes a retried adjustment safe.

## 8. Permissions and tenant isolation

Every owner route calls `authorizeOwner(businessId, level)` — the same guard the rest of the
Business Hub uses. No route grants a JATA platform Control capability to an ordinary owner.

| Action | Level |
|---|---|
| Read programme, wallets, ledger, rewards | `read` |
| Record a purchase, move a redemption | `operate` |
| Configure the programme, rewards, adjustments, wallet status, expiry | `configure` |
| Reverse points | `high_risk` |

Tenant isolation is enforced by scoping every read and write with `businessId`, by the foreign
keys, and by the unique keys being `(businessId, …)`. A customer from another business, a reward
from another business and a redemption from another business are all refused.

The public wallet (`GET /api/public/loyalty-points/[code]`) is reachable by card code alone and
returns **only** that wallet's balance, history, rewards and the business's published terms. No
contact value, no owner note, no identifier, and nothing at all when the programme is off.

## 9. Settings reference — what each one does

| Setting | Effect |
|---|---|
| **Switch points on** | Nothing is awarded or redeemed while this is off. It cannot be turned on until a rate is set. |
| **Points earned / for every (KES)** | `pointsPerUnit` points per whole `kesPerPoint` of eligible spend. Both are required; neither has a default. |
| **Minimum purchase** | Purchases below this amount earn nothing. |
| **Cap per transaction** | The most points one purchase can earn. Empty = no cap. |
| **Minimum points to redeem** | A wallet must hold this much before any redemption is allowed. |
| **What one point is worth** | A display and discount guide for customers. Points are not cash. |
| **Points expire (months)** | Unused points expire this many months after earning. Off = never. |
| **Allow a reversal below zero** | See §5. Off by default. |
| **Only some items earn** | Restricts earning to the chosen products and services. Empty = everything earns. |
| **Description / terms / redemption rules** | Shown to customers in the wallet. |

## 10. Rollback

Every object the migration creates is new and nothing outside it references them, so reversing the
migration removes the feature completely and restores the previous behaviour. No stamp-card row,
no subscription, no payment and no entitlement is affected either way.

Because the repository's migration guard rejects any migration whose SQL text contains a
destructive statement, the reverse statements live here rather than in `migration.sql`.

Run against the same database, in this order (children before parents):

```sql
-- 1. Redemptions (references LoyaltyPointsAccount and LoyaltyReward)
DROP TABLE "LoyaltyRewardRedemption";

-- 2. The ledger (references Business, LoyaltyPointsAccount and, via reversalOfId, itself)
DROP TABLE "LoyaltyPointsLedger";

-- 3. Wallets (references Business, LoyaltyPointsProgramme and LoyaltyCard)
DROP TABLE "LoyaltyPointsAccount";

-- 4. The reward catalogue (references Business and LoyaltyPointsProgramme)
DROP TABLE "LoyaltyReward";

-- 5. Eligible items and the programme itself
DROP TABLE "LoyaltyPointsEligibleItem";
DROP TABLE "LoyaltyPointsProgramme";

-- 6. The enum types, once no column uses them
DROP TYPE "RedemptionStatus";
DROP TYPE "RewardKind";
DROP TYPE "PointsSource";
DROP TYPE "PointsDirection";
DROP TYPE "PointsTransactionType";
```

Then remove the row for `20261129000000_loyalty_points_rewards` from `_prisma_migrations` (or let
`prisma migrate resolve --rolled-back` record it) and delete the migration directory.

**Data warning.** The statements above remove every points balance, ledger entry and redemption
recorded while the feature was in use. Take a backup first, and export the ledger if the business
needs to keep its history. The stamp-card tables (`LoyaltyProgram`, `LoyaltyCard`,
`LoyaltyStampEvent`, `LoyaltyRedemption`) are untouched by both this migration and its reverse.

## 11. Test coverage

| Suite | File |
|---|---|
| Rules, refusals, stamp non-regression (42 tests, offline) | `tests/unit/business-hub-loyalty-points.test.ts` |
| Schema ⇄ migration parity (12 tests, offline) | `tests/prisma/loyalty-points-migration-parity.test.ts` |
| Real PostgreSQL: rollback, concurrency, unique indexes | `tests/integration/business-hub-loyalty-points-postgres.test.ts` |
| Real Chrome: owner configuration, purchase, wallet, redemption, six viewports | `scripts/browser/business-hub-journey.check.mjs` |

The offline suites use the Business Hub fake, whose `$transaction` is a pass-through without
rollback. Anything that depends on real transactional rollback or real row locking is asserted in
the PostgreSQL suite and the browser journey, never in the fake.

## 12. Open decisions for the owner

1. **Activation.** Which businesses switch points on, and with which rate. Nothing awards points
   until this is decided per business.
2. **Verification.** Earning is owner-verified in this release. Automatic verification from an
   authoritative payment event needs an integration and an explicit approval before it is built.
3. **Negative balances.** Whether a business wants reversals to be able to take a wallet below
   zero, and what it then does about recovery. Off by default, no platform behaviour either way.
4. **Expiry.** Whether points expire at all, and after how long. Off by default.
