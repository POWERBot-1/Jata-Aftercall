/**
 * Loyalty 2.0 — points and rewards against a real PostgreSQL database.
 *
 * The offline suite (`tests/unit/business-hub-loyalty-points.test.ts`) proves the rules against a
 * fake client whose `$transaction` is a pass-through with no rollback and no row locking. Three of
 * the guarantees this feature is sold on cannot be proven there, and are proven here:
 *
 *   1. ROLLBACK. A redemption whose ledger insert fails leaves nothing behind: no redemption, no
 *      partial deduction. Only a real transaction can show that.
 *   2. DOUBLE-SPEND. Two redemptions racing on one wallet serialise on the account row; the
 *      compare-and-set lets exactly one through.
 *   3. THE UNIQUE INDEXES. One ledger row per idempotency key and one redemption per key are
 *      PostgreSQL constraints, not application memory — including under a concurrent double write.
 *
 * It also re-runs the stamp-card journey beside the points journey, because the promise is that
 * adding points changes nothing about stamps.
 *
 * Environment: DATABASE_URL naming an ISOLATED, migrated database — never production. The suite is
 * skipped without it; a skipped test is not a passing test, and this file's results are reported
 * separately from the no-database suite.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db";
import {
  adjustPoints,
  awardPoints,
  getOrCreateProgramme,
  listAccounts,
  reconcileAccount,
  redeemPoints,
  reversePoints,
  runExpiry,
  saveProgramme,
  saveReward,
  validateProgrammeInput,
  validateRewardInput,
  walletForCardCode,
} from "@/lib/business-hub/loyaltyPoints";
import { awardStamp, enrolCard, redeemReward, saveProgram } from "@/lib/business-hub/loyalty";

const enabled = Boolean(process.env.DATABASE_URL?.trim());
const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

let businessA = "";
let businessB = "";
let ownerA = "";
let ownerB = "";
let cardA = "";
let cardACode = "";
let cardB = "";
let slugA = "";
let slugB = "";

async function activate(businessId: string, overrides: Record<string, unknown> = {}) {
  const parsed = validateProgrammeInput({ isActive: true, kesPerPoint: 100, pointsPerUnit: 1, ...overrides });
  expect(parsed.ok, "the configuration should be valid").toBe(true);
  if (!parsed.ok) throw new Error("invalid configuration");
  await saveProgramme({ businessId, input: parsed.value, actorId: ownerA, actorLabel: "Owner A" });
}

/** The same configuration, switched off — so a scenario sets the state it asserts instead of inheriting it. */
async function deactivate(businessId: string) {
  const parsed = validateProgrammeInput({ isActive: false, kesPerPoint: 100, pointsPerUnit: 1 });
  expect(parsed.ok, "the configuration should be valid").toBe(true);
  if (!parsed.ok) throw new Error("invalid configuration");
  await saveProgramme({ businessId, input: parsed.value, actorId: ownerA, actorLabel: "Owner A" });
}

async function reward(businessId: string, title: string, pointsCost: number) {
  const parsed = validateRewardInput({ title, pointsCost, kind: "FIXED_POINTS" });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("invalid reward");
  return saveReward({ businessId, input: parsed.value, actorId: ownerA, actorLabel: "Owner A" });
}

/** A fresh wallet, so each scenario starts from a known balance. */
async function freshCard(name: string, businessId = businessA) {
  const card = await enrolCard({
    businessId,
    input: { customerName: name, contactMethod: "PHONE", contactValue: "0712345678" },
    actorId: ownerA,
    actorLabel: "Owner A",
  });
  return card as { id: string; code: string };
}

function accountFor(cardId: string) {
  return prisma.loyaltyPointsAccount.findUnique({ where: { cardId } });
}

async function resetWallet(cardId: string) {
  await prisma.loyaltyRewardRedemption.deleteMany({ where: { account: { cardId } } }).catch(() => undefined);
  await prisma.loyaltyPointsLedger.deleteMany({ where: { account: { cardId } } }).catch(() => undefined);
  await prisma.loyaltyPointsAccount.deleteMany({ where: { cardId } }).catch(() => undefined);
}

describe.skipIf(!enabled)("points and rewards against real PostgreSQL", () => {
  beforeAll(async () => {
    const ownerARow = await prisma.user.create({
      data: { email: `points-a-${stamp}@example.test`, name: "Points Owner A", passwordHash: "not-a-real-login", sessionVersion: 0 },
    });
    const ownerBRow = await prisma.user.create({
      data: { email: `points-b-${stamp}@example.test`, name: "Points Owner B", passwordHash: "not-a-real-login", sessionVersion: 0 },
    });
    ownerA = ownerARow.id;
    ownerB = ownerBRow.id;

    const businessARow = await prisma.business.create({
      data: { ownerId: ownerA, slug: `points-a-${stamp}`, name: "Points A", category: "retail", status: "ACTIVE", isPublished: true, theme: "clean" },
    });
    const businessBRow = await prisma.business.create({
      data: { ownerId: ownerB, slug: `points-b-${stamp}`, name: "Points B", category: "retail", status: "ACTIVE", isPublished: true, theme: "clean" },
    });
    businessA = businessARow.id;
    businessB = businessBRow.id;
    slugA = businessARow.slug;
    slugB = businessBRow.slug;

    // The stamp programme exists first, so the regression check below is a real before/after.
    await saveProgram({
      businessId: businessA,
      input: { isEnabled: true, stampGoal: 2, maxStampsPerVisit: 1, rewardDescription: "Free pilau", terms: null },
      actorId: ownerA,
      actorLabel: "Owner A",
    });

    const card = await freshCard("Amina");
    cardA = card.id;
    cardACode = card.code;
    const other = await freshCard("Brian", businessB);
    cardB = other.id;
  }, 120_000);

  afterAll(async () => {
    if (!enabled) return;
    const businesses = [businessA, businessB].filter(Boolean);
    for (const businessId of businesses) {
      await prisma.loyaltyRewardRedemption.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.loyaltyPointsLedger.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.loyaltyPointsAccount.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.loyaltyReward.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.loyaltyPointsEligibleItem.deleteMany({ where: { programme: { businessId } } }).catch(() => undefined);
      await prisma.loyaltyPointsProgramme.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.orderRequestItem.deleteMany({ where: { orderRequest: { businessId } } }).catch(() => undefined);
      await prisma.orderRequest.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.loyaltyRedemption.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.loyaltyStampEvent.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.loyaltyCard.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.loyaltyProgram.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.businessHubActivity.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.business.delete({ where: { id: businessId } }).catch(() => undefined);
    }
    for (const userId of [ownerA, ownerB].filter(Boolean)) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect?.().catch(() => undefined);
  }, 120_000);

  it("1 · the stamp card still enrols, awards and redeems while points are configured", async () => {
    await activate(businessA);
    await awardStamp({ businessId: businessA, cardId: cardA, transactionRef: `ST-A-${stamp}`, stamps: 1, actorId: ownerA, actorLabel: "Owner A" });
    await awardStamp({ businessId: businessA, cardId: cardA, transactionRef: `ST-B-${stamp}`, stamps: 1, actorId: ownerA, actorLabel: "Owner A" });

    const before = await prisma.loyaltyCard.findUnique({ where: { id: cardA } });
    expect(before?.stampsEarned).toBe(2);

    const redeemed = await redeemReward({ businessId: businessA, cardId: cardA, actorId: ownerA, actorLabel: "Owner A" });
    expect(redeemed.ok).toBe(true);

    // Points activity must not move a stamp counter, in either direction.
    await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: `PT-A-${stamp}`, amountKES: 1000, actorId: ownerA, actorLabel: "Owner A" });
    const after = await prisma.loyaltyCard.findUnique({ where: { id: cardA } });
    expect(after?.stampsEarned).toBe(2);
    expect(after?.stampsRedeemed).toBe(2);
    expect(await prisma.loyaltyStampEvent.count({ where: { businessId: businessA } })).toBe(2);
    expect(await prisma.loyaltyRedemption.count({ where: { businessId: businessA } })).toBe(1);
    // …and the points landed on the points side, not the stamp side.
    expect((await accountFor(cardA))?.availablePoints).toBe(10);
  });

  it("2 · a programme is inactive with no rate until the owner configures and activates it", async () => {
    const fresh = await prisma.business.create({
      data: { ownerId: ownerA, slug: `points-fresh-${stamp}`, name: "Points Fresh", category: "retail", status: "ACTIVE", isPublished: false, theme: "clean" },
    });
    try {
      const created = await getOrCreateProgramme(fresh.id);
      expect(created.isActive).toBe(false);
      expect(created.kesPerPoint).toBeNull();
      expect(created.pointsPerUnit).toBeNull();
      expect(created.expiryMonths).toBeNull();

      // Activation is refused rather than defaulted: no rate, no programme.
      const withoutRate = validateProgrammeInput({ isActive: true });
      expect(withoutRate.ok).toBe(false);

      const card = await freshCard("Fresh Customer", fresh.id);
      const refused = await awardPoints({ businessId: fresh.id, cardId: card.id, transactionRef: "R-1", amountKES: 1000 });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.status).toBe(409);
      expect(await prisma.loyaltyPointsLedger.count({ where: { businessId: fresh.id } })).toBe(0);

      await activate(fresh.id);
      expect((await getOrCreateProgramme(fresh.id)).isActive).toBe(true);
    } finally {
      await prisma.loyaltyPointsLedger.deleteMany({ where: { businessId: fresh.id } }).catch(() => undefined);
      await prisma.loyaltyPointsAccount.deleteMany({ where: { businessId: fresh.id } }).catch(() => undefined);
      await prisma.loyaltyPointsProgramme.deleteMany({ where: { businessId: fresh.id } }).catch(() => undefined);
      await prisma.loyaltyCard.deleteMany({ where: { businessId: fresh.id } }).catch(() => undefined);
      await prisma.loyaltyProgram.deleteMany({ where: { businessId: fresh.id } }).catch(() => undefined);
      await prisma.business.delete({ where: { id: fresh.id } }).catch(() => undefined);
    }
  });

  it("3 · a verified purchase accrues exactly the configured rate", async () => {
    await resetWallet(cardA);
    await activate(businessA);
    const result = await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: `ACC-1-${stamp}`, amountKES: 350, actorId: ownerA, actorLabel: "Owner A" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.points).toBe(3); // floor(350/100) × 1
    expect(result.entry.source).toBe("OWNER_VERIFIED");
    expect((await accountFor(cardA))?.availablePoints).toBe(3);
  });

  it("4 · replaying a purchase — sequentially or concurrently — awards once", async () => {
    await resetWallet(cardA);
    await activate(businessA);
    const reference = `DUP-${stamp}`;
    const [first, second] = await Promise.all([
      awardPoints({ businessId: businessA, cardId: cardA, transactionRef: reference, amountKES: 1000 }),
      awardPoints({ businessId: businessA, cardId: cardA, transactionRef: reference, amountKES: 1000 }),
    ]);
    const third = await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: reference.toLowerCase(), amountKES: 1000 });

    const duplicates = [first, second, third].filter((entry) => entry.ok && entry.duplicate).length;
    // Every call must be answered, and two of them must be recognised as the same purchase. A
    // refusal is reported with its status and message, so a failure here names its own cause.
    expect(
      [first, second, third].filter((entry) => !entry.ok).map((entry) => (entry.ok ? "" : `${entry.status} — ${entry.error}`)),
    ).toEqual([]);
    expect(duplicates).toBe(2);
    expect(await prisma.loyaltyPointsLedger.count({ where: { businessId: businessA, account: { cardId: cardA } } })).toBe(1);
    expect((await accountFor(cardA))?.availablePoints).toBe(10);

    // The raw constraint is what makes that true, and it survives a direct double insert. The key
    // is copied from the row the engine actually wrote rather than rebuilt here: the engine stores
    // the normalised (upper-case) form, so a hand-typed key would not collide and this would
    // silently assert nothing. A distinct `reference` keeps the proof on the idempotency key —
    // the reference constraint is not what is being exercised.
    const account = await accountFor(cardA);
    const [awarded] = await prisma.loyaltyPointsLedger.findMany({
      where: { businessId: businessA, account: { cardId: cardA } },
      take: 1,
    });
    expect(awarded?.idempotencyKey).toBe(`EARN:${account!.id}:${reference.toUpperCase()}`);
    await expect(
      prisma.loyaltyPointsLedger.create({
        data: {
          businessId: businessA,
          accountId: account!.id,
          type: "EARNED",
          direction: "CREDIT",
          points: 1,
          reference: `JATA-PTS-CONFLICT-${stamp}`,
          idempotencyKey: awarded.idempotencyKey,
          source: "OWNER_VERIFIED",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("4b · the same receipt number on another customer's card is their own purchase", async () => {
    /**
     * The replay guard is per wallet, not per business. Two customers can be handed the same
     * receipt number — a till that restarts its numbering, a short reference like "CASH" — and the
     * second award must earn on its own wallet instead of coming back as a replay of the first
     * customer's entry.
     */
    await resetWallet(cardA);
    await activate(businessA);
    const reference = `SHARED-${stamp}`;
    const other = await freshCard("Shared Receipt", businessA);

    try {
      const mine = await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: reference, amountKES: 1000 });
      const theirs = await awardPoints({ businessId: businessA, cardId: other.id, transactionRef: reference, amountKES: 1000 });

      expect(mine.ok).toBe(true);
      expect(theirs.ok).toBe(true);
      if (!theirs.ok) return;
      expect(theirs.duplicate).toBeFalsy();
      expect(theirs.entry?.id).not.toBe(mine.ok ? mine.entry?.id : "same");
      expect(theirs.entry?.points).toBe(10);

      // Two ledger rows, one per wallet, each credited exactly once.
      expect(await prisma.loyaltyPointsLedger.count({ where: { businessId: businessA, account: { cardId: cardA } } })).toBe(1);
      expect(await prisma.loyaltyPointsLedger.count({ where: { businessId: businessA, account: { cardId: other.id } } })).toBe(1);
      expect((await accountFor(cardA))?.availablePoints).toBe(10);
      expect((await accountFor(other.id))?.availablePoints).toBe(10);
    } finally {
      // This card exists only for this test, so it does not disturb the counts the others assert.
      await prisma.loyaltyPointsLedger.deleteMany({ where: { account: { cardId: other.id } } }).catch(() => undefined);
      await prisma.loyaltyPointsAccount.deleteMany({ where: { cardId: other.id } }).catch(() => undefined);
      await prisma.loyaltyCard.delete({ where: { id: other.id } }).catch(() => undefined);
    }
  });

  it("5 · an order request earns nothing, and an unverified payment event is refused", async () => {
    await resetWallet(cardA);
    await activate(businessA);

    // A customer asking for a quote is not a purchase: no payment is taken, so no points.
    const request = await prisma.orderRequest.create({
      data: {
        businessId: businessA,
        reference: `JATA-REQ-${stamp}`,
        requestKey: `points-journey-${stamp}`,
        customerName: "Amina",
        contactMethod: "PHONE",
        contactValue: "0712345678",
        itemCount: 1,
      },
    });
    expect(request.id).toBeTruthy();
    expect(await prisma.loyaltyPointsLedger.count({ where: { businessId: businessA, account: { cardId: cardA } } })).toBe(0);

    const unverified = await awardPoints({
      businessId: businessA,
      cardId: cardA,
      transactionRef: `PAY-${stamp}`,
      amountKES: 1000,
      source: "PAYMENT_PROVIDER",
    });
    expect(unverified.ok).toBe(false);
    if (!unverified.ok) expect(unverified.status).toBe(400);
    expect(await prisma.loyaltyPointsLedger.count({ where: { businessId: businessA, account: { cardId: cardA } } })).toBe(0);
  });

  it("6 · an ineligible purchase is refused, not rounded up", async () => {
    await resetWallet(cardA);
    await activate(businessA, { minPurchaseKES: 500 });
    const below = await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: `MIN-${stamp}`, amountKES: 499 });
    expect(below.ok).toBe(false);
    if (!below.ok) expect(below.status).toBe(409);

    await activate(businessA, { eligibleItems: [{ itemKind: "SERVICE", itemId: "svc-none" }] });
    const wrongItem = await awardPoints({
      businessId: businessA,
      cardId: cardA,
      transactionRef: `ITEM-${stamp}`,
      amountKES: 900,
      items: [{ itemKind: "PRODUCT", itemId: "prod-other", amountKES: 900 }],
    });
    expect(wrongItem.ok).toBe(false);
    if (!wrongItem.ok) expect(wrongItem.status).toBe(409);
    expect(await prisma.loyaltyPointsLedger.count({ where: { businessId: businessA, account: { cardId: cardA } } })).toBe(0);
  });

  it("7 · a redemption deducts the catalogue cost and leaves an auditable row", async () => {
    await resetWallet(cardA);
    await activate(businessA);
    const rewardRow = await reward(businessA, `Free chapati ${stamp}`, 6);
    await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: `RED-${stamp}`, amountKES: 1000 });

    const result = await redeemPoints({ businessId: businessA, cardId: cardA, rewardId: rewardRow.id, idempotencyKey: `pg-tap-1-${stamp}` });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redemption.pointsSpent).toBe(6);
    expect((await accountFor(cardA))?.availablePoints).toBe(4);

    const ledger = await prisma.loyaltyPointsLedger.findMany({ where: { account: { cardId: cardA } } });
    expect(ledger.map((row: any) => row.type).sort()).toEqual(["EARNED", "REDEEMED"]);

    // The same key on a second tap returns that same redemption and spends nothing more.
    const repeat = await redeemPoints({ businessId: businessA, cardId: cardA, rewardId: rewardRow.id, idempotencyKey: `pg-tap-1-${stamp}` });
    expect(repeat.ok).toBe(true);
    if (repeat.ok) {
      expect(repeat.duplicate).toBe(true);
      expect(repeat.redemption.id).toBe(result.redemption.id);
    }
    expect((await accountFor(cardA))?.availablePoints).toBe(4);
    expect(await prisma.loyaltyRewardRedemption.count({ where: { businessId: businessA, account: { cardId: cardA } } })).toBe(1);
  });

  it("8 · a redemption the balance cannot cover is refused with nothing written", async () => {
    await resetWallet(cardA);
    await activate(businessA);
    const rewardRow = await reward(businessA, `Big hamper ${stamp}`, 500);
    await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: `INS-${stamp}`, amountKES: 1000 });

    const result = await redeemPoints({ businessId: businessA, cardId: cardA, rewardId: rewardRow.id, idempotencyKey: `pg-tap-2-${stamp}` });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect((await accountFor(cardA))?.availablePoints).toBe(10);
    expect(await prisma.loyaltyRewardRedemption.count({ where: { businessId: businessA, account: { cardId: cardA } } })).toBe(0);
  });

  it("9 · concurrent redemptions cannot spend the same points twice", async () => {
    await resetWallet(cardA);
    await activate(businessA);
    const rewardRow = await reward(businessA, `Raced reward ${stamp}`, 8);
    await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: `RACE-${stamp}`, amountKES: 1000 });
    const account = await accountFor(cardA);

    // The same compare-and-set, at the SQL level: five attempts, ten points, eight per reward.
    const decrements = await Promise.all(
      [0, 1, 2, 3, 4].map(() =>
        prisma.$executeRaw`UPDATE "LoyaltyPointsAccount" SET "availablePoints" = "availablePoints" - 8 WHERE "id" = ${account!.id} AND "availablePoints" >= 8`,
      ),
    );
    expect(decrements.reduce((total, count) => total + count, 0)).toBe(1);
    await prisma.loyaltyPointsAccount.update({ where: { id: account!.id }, data: { availablePoints: 10 } });

    const attempts = await Promise.all(
      [0, 1, 2, 3, 4].map((index) =>
        redeemPoints({ businessId: businessA, cardId: cardA, rewardId: rewardRow.id, idempotencyKey: `pg-race-${stamp}-${index}` }),
      ),
    );
    const accepted = attempts.filter((attempt) => attempt.ok);
    expect(accepted.length).toBeGreaterThanOrEqual(1); // the race must not refuse everybody
    expect(accepted.length).toBeLessThanOrEqual(1); // and it must not let two through
    expect((await accountFor(cardA))?.availablePoints).toBe(10 - 8 * accepted.length);
    expect(await prisma.loyaltyRewardRedemption.count({ where: { businessId: businessA, account: { cardId: cardA } } })).toBe(accepted.length);
  });

  it("10 · a redemption whose ledger entry fails rolls back completely", async () => {
    await resetWallet(cardA);
    await activate(businessA);
    const rewardRow = await reward(businessA, `Rollback reward ${stamp}`, 5);
    await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: `RB-${stamp}`, amountKES: 1000 });

    // The ledger key a redemption writes is namespaced by wallet, so it is LEARNED from a
    // redemption the database itself wrote rather than spelled out here — this test is about the
    // rollback, not about the key's format.
    const probeKey = `pg-probe-${stamp}`;
    const probe = await redeemPoints({ businessId: businessA, cardId: cardA, rewardId: rewardRow.id, idempotencyKey: probeKey });
    expect(probe.ok).toBe(true);
    const probeLedger = await prisma.loyaltyPointsLedger.findFirst({
      where: { account: { cardId: cardA }, type: "REDEEMED" },
    });
    const blockedClientKey = `pg-blocked-${stamp}`;
    const blockedLedgerKey = String(probeLedger?.idempotencyKey ?? "").replace(probeKey, blockedClientKey);
    expect(blockedLedgerKey).not.toBe("");

    // Undo the probe: the wallet is back to ten points with its earning lot intact.
    await prisma.loyaltyRewardRedemption.deleteMany({ where: { account: { cardId: cardA } } });
    await prisma.loyaltyPointsLedger.deleteMany({ where: { account: { cardId: cardA }, type: "REDEEMED" } });
    const earnedLotBefore = await prisma.loyaltyPointsLedger.findFirst({
      where: { account: { cardId: cardA }, type: "EARNED" },
    });
    await prisma.loyaltyPointsLedger.update({
      where: { id: earnedLotBefore!.id },
      data: { remainingPoints: earnedLotBefore!.points },
    });
    const account = await accountFor(cardA);
    await prisma.loyaltyPointsAccount.update({
      where: { id: account!.id },
      data: { availablePoints: 10, lifetimeRedeemed: 0 },
    });

    // Occupy that key. The redemption row would succeed and the deduction would succeed — only
    // the ledger write fails, so the transaction is the only thing standing between the customer
    // and a spend with no history.
    await prisma.loyaltyPointsLedger.create({
      data: {
        businessId: businessA,
        accountId: account!.id,
        type: "MANUAL_ADJUSTMENT",
        direction: "CREDIT",
        points: 1,
        reference: `JATA-PTS-RB-${stamp}`,
        idempotencyKey: blockedLedgerKey,
        source: "OWNER_ADJUSTMENT",
        explanation: "occupies the key so the redemption's ledger write fails",
      },
    });

    const result = await redeemPoints({ businessId: businessA, cardId: cardA, rewardId: rewardRow.id, idempotencyKey: blockedClientKey });
    expect(result.ok).toBe(false);

    // Nothing was left behind: no redemption, no deduction, no partial history. The earning lot
    // the redemption consumed inside the failed transaction is back to its full value too.
    expect((await accountFor(cardA))?.availablePoints).toBe(10);
    expect(await prisma.loyaltyRewardRedemption.count({ where: { businessId: businessA, account: { cardId: cardA } } })).toBe(0);
    expect(await prisma.loyaltyPointsLedger.count({ where: { businessId: businessA, type: "REDEEMED" } })).toBe(0);
    const earnedLotAfter = await prisma.loyaltyPointsLedger.findFirst({
      where: { account: { cardId: cardA }, type: "EARNED" },
    });
    expect(earnedLotAfter?.remainingPoints).toBe(10);
  });

  it("11 · a refund reverses once, keeps the original entry, and reports a shortfall it cannot claw back", async () => {
    await resetWallet(cardA);
    await activate(businessA);
    await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: `REF-${stamp}`, amountKES: 1000 });

    const first = await reversePoints({ businessId: businessA, cardId: cardA, transactionRef: `REF-${stamp}`, reason: "Refunded at the counter", actorId: ownerA, actorLabel: "Owner A" });
    const second = await reversePoints({ businessId: businessA, cardId: cardA, transactionRef: `REF-${stamp}`, reason: "Refunded at the counter", actorId: ownerA, actorLabel: "Owner A" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);

    const ledger = await prisma.loyaltyPointsLedger.findMany({ where: { account: { cardId: cardA } } });
    const earned = ledger.find((row: any) => row.type === "EARNED");
    const reversed = ledger.find((row: any) => row.type === "REVERSED");
    expect(earned?.points).toBe(10); // preserved, not rewritten
    expect(reversed?.reversalOfId).toBe(earned?.id);
    expect((await accountFor(cardA))?.availablePoints).toBe(0);

    // With points already spent, the reversal takes back the unspent part and says so.
    await resetWallet(cardA);
    const rewardRow = await reward(businessA, `Spent reward ${stamp}`, 6);
    await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: `REF2-${stamp}`, amountKES: 1000 });
    await redeemPoints({ businessId: businessA, cardId: cardA, rewardId: rewardRow.id, idempotencyKey: `pg-ref2-${stamp}` });
    const short = await reversePoints({ businessId: businessA, cardId: cardA, transactionRef: `REF2-${stamp}`, reason: "Refunded", actorId: ownerA, actorLabel: "Owner A" });
    expect(short.ok).toBe(true);
    if (!short.ok) return;
    expect(short.entry.points).toBe(4);
    expect(short.shortfall).toBe(6);
    expect((await accountFor(cardA))?.availablePoints).toBe(0); // never negative by default
  });

  it("12 · expiry runs exactly once per award, and never when it is switched off", async () => {
    await resetWallet(cardA);
    await activate(businessA, { expiryMonths: 1 });
    await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: `EXP-${stamp}`, amountKES: 1000 });

    const later = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
    const first = await runExpiry({ businessId: businessA, now: later });
    const second = await runExpiry({ businessId: businessA, now: later });
    expect(first.expired).toBe(1);
    expect(first.pointsExpired).toBe(10);
    expect(second.expired).toBe(0);
    expect(await prisma.loyaltyPointsLedger.count({ where: { businessId: businessA, type: "EXPIRED" } })).toBe(1);
    expect((await accountFor(cardA))?.lifetimeExpired).toBe(10);

    await resetWallet(cardA);
    await activate(businessA, { expiryMonths: null });
    await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: `EXP-OFF-${stamp}`, amountKES: 1000 });
    const off = await runExpiry({ businessId: businessA, now: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000) });
    expect(off.skipped).toMatch(/never expire/i);
    expect(off.pointsExpired).toBe(0);
    expect((await accountFor(cardA))?.availablePoints).toBe(10);
  });

  it("13 · an adjustment needs a reason and an authorised actor, and is recorded against both", async () => {
    await resetWallet(cardA);
    await activate(businessA);
    const withoutReason = await adjustPoints({ businessId: businessA, cardId: cardA, points: 10, reason: "  ", actorId: ownerA, actorLabel: "Owner A" });
    expect(withoutReason.ok).toBe(false);
    if (!withoutReason.ok) expect(withoutReason.status).toBe(400);

    const credit = await adjustPoints({ businessId: businessA, cardId: cardA, points: 20, reason: "Goodwill for the delayed order", actorId: ownerA, actorLabel: "Owner A" });
    expect(credit.ok).toBe(true);
    if (!credit.ok) return;
    expect(credit.entry.actorUserId).toBe(ownerA);
    expect(credit.entry.explanation).toContain("Goodwill");

    const tooFar = await adjustPoints({ businessId: businessA, cardId: cardA, points: -500, reason: "Correction", actorId: ownerA, actorLabel: "Owner A" });
    expect(tooFar.ok).toBe(false);
    if (!tooFar.ok) expect(tooFar.status).toBe(409);

    const debit = await adjustPoints({ businessId: businessA, cardId: cardA, points: -5, reason: "Double counted", actorId: ownerA, actorLabel: "Owner A" });
    expect(debit.ok).toBe(true);
    expect((await accountFor(cardA))?.availablePoints).toBe(15);
  });

  it("14 · the balance always reconciles with the ledger", async () => {
    await resetWallet(cardA);
    await activate(businessA, { expiryMonths: 1 });
    const rewardRow = await reward(businessA, `Reconcile reward ${stamp}`, 4);
    await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: `R1-${stamp}`, amountKES: 1000 });
    await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: `R2-${stamp}`, amountKES: 500 });
    await redeemPoints({ businessId: businessA, cardId: cardA, rewardId: rewardRow.id, idempotencyKey: `pg-rec-1-${stamp}` });
    await adjustPoints({ businessId: businessA, cardId: cardA, points: 3, reason: "Goodwill", actorId: ownerA, actorLabel: "Owner A" });
    await reversePoints({ businessId: businessA, cardId: cardA, transactionRef: `R2-${stamp}`, reason: "Refunded", actorId: ownerA, actorLabel: "Owner A" });
    await runExpiry({ businessId: businessA, now: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000) });

    const account = await accountFor(cardA);
    const reconciliation = await reconcileAccount(businessA, account!.id);
    expect(reconciliation.reconciled).toBe(true);
    expect(reconciliation.credits - reconciliation.debits).toBe(reconciliation.available);
    expect(reconciliation.available).toBe(account!.availablePoints);
  });

  it("15 · another business's customers, rewards and purchases are refused", async () => {
    await resetWallet(cardA);
    await activate(businessA);
    await activate(businessB);
    await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: `X1-${stamp}`, amountKES: 1000 });

    // Business A cannot award to business B's customer.
    const crossAward = await awardPoints({ businessId: businessA, cardId: cardB, transactionRef: `X2-${stamp}`, amountKES: 1000 });
    expect(crossAward.ok).toBe(false);
    if (!crossAward.ok) expect(crossAward.status).toBe(404);

    // Business A cannot redeem business B's reward.
    const foreignReward = await reward(businessB, `Foreign reward ${stamp}`, 1);
    const crossRedeem = await redeemPoints({ businessId: businessA, cardId: cardA, rewardId: foreignReward.id, idempotencyKey: `pg-x-${stamp}` });
    expect(crossRedeem.ok).toBe(false);
    if (!crossRedeem.ok) expect(crossRedeem.status).toBe(404);

    // Business B cannot reverse a business A purchase.
    const crossReverse = await reversePoints({ businessId: businessB, cardId: cardB, transactionRef: `X1-${stamp}`, reason: "Refunded", actorId: ownerB, actorLabel: "Owner B" });
    expect(crossReverse.ok).toBe(false);
    if (!crossReverse.ok) expect(crossReverse.status).toBe(404);

    // Business B cannot adjust a business A wallet.
    const crossAdjust = await adjustPoints({ businessId: businessB, cardId: cardA, points: 10, reason: "Correction", actorId: ownerB, actorLabel: "Owner B" });
    expect(crossAdjust.ok).toBe(false);
    if (!crossAdjust.ok) expect(crossAdjust.status).toBe(404);

    const walletsB = await listAccounts(businessB);
    expect(walletsB.some((wallet: any) => wallet.cardId === cardA)).toBe(false);
    expect((await accountFor(cardA))?.availablePoints).toBe(10);
  });

  it("16 · a customer sees their own wallet only, and cannot change their own balance", async () => {
    await resetWallet(cardA);
    await activate(businessA, {
      description: "Earn while you eat.",
      terms: "Points are added after we verify your purchase.",
      redemptionRules: "Collect in store.",
    });
    const rewardRow = await reward(businessA, `Wallet reward ${stamp}`, 4);
    await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: `W1-${stamp}`, amountKES: 1000 });

    const wallet = await walletForCardCode(cardACode);
    expect(wallet).toBeTruthy();
    if (!wallet || !("availablePoints" in wallet)) return;
    expect(wallet.availablePoints).toBe(10);
    expect(wallet.earning.kesPerPoint).toBe(100);
    expect(wallet.rewards.some((entry: any) => entry.title === rewardRow.title)).toBe(true);

    // The public read carries no contact value, no owner note and no internal id.
    const serialised = JSON.stringify(wallet);
    expect(serialised).not.toContain("0712345678");
    expect(serialised).not.toContain("ownerNotes");
    expect(serialised).not.toContain("accountId");

    // Redeeming is the only public write, and it spends the catalogue cost — not a number the
    // customer supplied. There is no public route that sets a balance.
    const redeemed = await redeemPoints({ businessId: businessA, cardId: cardA, rewardId: rewardRow.id, idempotencyKey: `pg-wallet-${stamp}` });
    expect(redeemed.ok).toBe(true);
    if (!redeemed.ok) return;
    expect(redeemed.redemption.pointsSpent).toBe(4);
    expect((await accountFor(cardA))?.availablePoints).toBe(6);

    // A wallet is worth nothing to a caller who does not hold the card code.
    expect(await walletForCardCode("NO-SUCH-CODE")).toBeNull();
  });

  it("17 · deleting a business takes its points data with it, and leaves the schema intact", async () => {
    const throwaway = await prisma.business.create({
      data: { ownerId: ownerA, slug: `points-cascade-${stamp}`, name: "Points Cascade", category: "retail", status: "ACTIVE", isPublished: false, theme: "clean" },
    });
    const parsed = validateProgrammeInput({ isActive: true, kesPerPoint: 100, pointsPerUnit: 1 });
    if (parsed.ok) await saveProgramme({ businessId: throwaway.id, input: parsed.value, actorId: ownerA, actorLabel: "Owner A" });
    const card = await freshCard("Cascade Customer", throwaway.id);
    await awardPoints({ businessId: throwaway.id, cardId: card.id, transactionRef: `CAS-${stamp}`, amountKES: 1000 });
    expect(await prisma.loyaltyPointsLedger.count({ where: { businessId: throwaway.id } })).toBe(1);

    await prisma.business.delete({ where: { id: throwaway.id } });

    expect(await prisma.loyaltyPointsLedger.count({ where: { businessId: throwaway.id } })).toBe(0);
    expect(await prisma.loyaltyPointsAccount.count({ where: { businessId: throwaway.id } })).toBe(0);
    expect(await prisma.loyaltyPointsProgramme.count({ where: { businessId: throwaway.id } })).toBe(0);
  });

  it("18 · a card code is normalised, and only opens the wallet of the business whose page asked", async () => {
    await resetWallet(cardA);
    await activate(businessA);
    await awardPoints({ businessId: businessA, cardId: cardA, transactionRef: `NORM-${stamp}`, amountKES: 1000 });

    // Typed the way a person types it: lower case, with spaces, wrapped in whitespace.
    const spaced = ` ${cardACode.toLowerCase().split("").join(" ")} `;
    for (const typed of [cardACode, cardACode.toLowerCase(), spaced]) {
      const wallet = await walletForCardCode(typed);
      expect(wallet, typed).toBeTruthy();
      if (!wallet || !("availablePoints" in wallet)) continue;
      expect(wallet.availablePoints).toBe(10);
    }

    // Empty and unknown codes resolve to nothing, never to a row the database happens to hold.
    expect(await walletForCardCode("")).toBeNull();
    expect(await walletForCardCode("   ")).toBeNull();
    expect(await walletForCardCode(`no-such-code-${stamp}`)).toBeNull();

    // Page scoping: this business's card opens on this business's page and nowhere else.
    const onItsOwnPage = await walletForCardCode(cardACode, { businessSlug: slugA });
    expect(onItsOwnPage?.active).toBe(true);
    expect(await walletForCardCode(cardACode, { businessSlug: slugB })).toBeNull();

    // And another business's card is refused here, with no hint that it exists elsewhere.
    const otherCard = await prisma.loyaltyCard.findUnique({ where: { id: cardB } });
    expect(otherCard).toBeTruthy();
    expect(await walletForCardCode(otherCard!.code, { businessSlug: slugA })).toBeNull();

    // What that card shows on its OWN page is that business's own programme's decision, not this
    // test's to inherit: the cross-tenant scenario above leaves business B active, so both states
    // are set here and asserted in turn rather than assumed from whatever ran before.
    await activate(businessB);
    expect((await walletForCardCode(otherCard!.code, { businessSlug: slugB }))?.active).toBe(true);
    await deactivate(businessB);
    expect((await walletForCardCode(otherCard!.code, { businessSlug: slugB }))?.active).toBe(false);
    expect(await walletForCardCode(otherCard!.code, { businessSlug: slugA })).toBeNull();

    // The refusal is not a wallet with a balance in it, and never carries a contact value.
    const serialised = JSON.stringify(await walletForCardCode(cardACode, { businessSlug: slugA }));
    expect(serialised).not.toContain("0712345678");
    expect(serialised).not.toContain("accountId");
    expect(serialised).not.toContain("businessId");
  });
});
