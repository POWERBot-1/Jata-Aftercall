/**
 * Loyalty 2.0 — points and rewards, with the stamp card left alone.
 *
 * These tests hold the two programmes apart. Every scenario below runs against the Business Hub
 * fake (unique indexes enforced, `P2002` raised as PostgreSQL would) and, where a scenario depends
 * on real transactional rollback or true concurrency, the DATABASE_URL-backed suite in
 * `tests/integration/business-hub-loyalty-points-postgres.test.ts` covers it — the fake's
 * `$transaction` is a pass-through and cannot roll back.
 *
 * The stamp assertions are the point of the last block: awarding, reversing and redeeming points
 * must leave `LoyaltyCard.stampsEarned` and `stampsRedeemed` exactly as the stamp engine set them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: null as any }));

vi.mock("@/lib/db", async () => {
  const { createBusinessHubFakeDb, businessHubSeed } = await import("@/tests/helpers/businessHubFakeDb");
  const fake = createBusinessHubFakeDb(businessHubSeed());
  (globalThis as any).__hubFake = fake;
  return { default: fake.db };
});

import {
  DEFAULT_POINTS_PROGRAMME,
  adjustPoints,
  awardPoints,
  calculatePoints,
  eligibleAmount,
  getOrCreateProgramme,
  listAccounts,
  listLedger,
  reconcileAccount,
  redeemPoints,
  reversePoints,
  runExpiry,
  saveProgramme,
  saveReward,
  setRewardActive,
  updateRedemptionStatus,
  validateProgrammeInput,
  validateRewardInput,
  walletForCardCode,
} from "@/lib/business-hub/loyaltyPoints";
import { awardStamp, enrolCard, getOrCreateProgram, redeemReward, saveProgram } from "@/lib/business-hub/loyalty";

type FakeDb = import("@/tests/helpers/posFakeDb").FakeDb;
const fake = () => (globalThis as any).__hubFake as FakeDb;

const BIZ_A = "bizA";
const BIZ_B = "bizB";

async function activateProgramme(
  businessId = BIZ_A,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const parsed = validateProgrammeInput({
    isActive: true,
    kesPerPoint: 100,
    pointsPerUnit: 1,
    ...overrides,
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  await saveProgramme({ businessId, input: parsed.value, actorId: "userA", actorLabel: "Owner A" });
}

async function enrol(businessId = BIZ_A, name = "Amina"): Promise<any> {
  const card = await enrolCard({
    businessId,
    input: { customerName: name, contactMethod: "PHONE", contactValue: "0712345678" },
    actorId: "userA",
    actorLabel: "Owner A",
  });
  return card;
}

async function makeReward(
  businessId = BIZ_A,
  overrides: Record<string, unknown> = {},
): Promise<any> {
  const parsed = validateRewardInput({ title: "Free chapati", pointsCost: 10, kind: "FIXED_POINTS", ...overrides });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return null;
  return saveReward({ businessId, input: parsed.value, actorId: "userA", actorLabel: "Owner A" });
}

beforeEach(() => {
  fake().reset();
  mocks.session = null;
});

describe("a programme is off until the owner configures it", () => {
  it("arrives switched off with no earning rate, redemption rate, expiry or reward value", async () => {
    const programme = await getOrCreateProgramme(BIZ_A);

    expect(programme.isActive).toBe(false);
    expect(programme.kesPerPoint).toBeNull();
    expect(programme.pointsPerUnit).toBeNull();
    expect(programme.expiryMonths).toBeNull();
    expect(programme.pointValueKES).toBeNull();
    expect(programme.minRedeemPoints).toBe(0);
    // Nothing is invented: the defaults are the same constants the UI renders.
    expect(DEFAULT_POINTS_PROGRAMME.kesPerPoint).toBeNull();
    expect(DEFAULT_POINTS_PROGRAMME.expiryMonths).toBeNull();
  });

  it("refuses to activate without a complete earning rate", () => {
    expect(validateProgrammeInput({ isActive: true, kesPerPoint: 100 }).ok).toBe(false);
    expect(validateProgrammeInput({ isActive: true, pointsPerUnit: 1 }).ok).toBe(false);
    expect(validateProgrammeInput({ isActive: true, kesPerPoint: 100, pointsPerUnit: 1 }).ok).toBe(true);
  });

  it("refuses an out-of-range rate rather than clamping it into something the owner did not choose", () => {
    expect(validateProgrammeInput({ isActive: false, kesPerPoint: 0, pointsPerUnit: 1 }).ok).toBe(false);
    expect(validateProgrammeInput({ isActive: false, kesPerPoint: 10, pointsPerUnit: 100000 }).ok).toBe(false);
    expect(validateProgrammeInput({ isActive: false, kesPerPoint: 10, pointsPerUnit: 1, expiryMonths: 0 }).ok).toBe(false);
    expect(validateProgrammeInput({ isActive: false, kesPerPoint: 10, pointsPerUnit: 1, expiryMonths: 999 }).ok).toBe(false);
  });

  it("will not award points while the programme is switched off", async () => {
    const card = await enrol();
    const result = await awardPoints({
      businessId: BIZ_A,
      cardId: card.id,
      transactionRef: "RCPT-1",
      amountKES: 1000,
      actorId: "userA",
      actorLabel: "Owner A",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(fake().rows("loyaltyPointsLedger")).toHaveLength(0);
  });
});

describe("earning", () => {
  it("calculates the same points for the same inputs, every time", () => {
    const programme = { kesPerPoint: 100, pointsPerUnit: 1, maxPointsPerTransaction: null };
    expect(calculatePoints(250, programme)).toBe(2);
    expect(calculatePoints(250, programme)).toBe(2);
    expect(calculatePoints(99, programme)).toBe(0);
    expect(calculatePoints(1000, { ...programme, pointsPerUnit: 3 })).toBe(30);
    // A cap limits one purchase; it is never a floor.
    expect(calculatePoints(100_000, { ...programme, maxPointsPerTransaction: 5 })).toBe(5);
    // An unset rate earns nothing rather than guessing one.
    expect(calculatePoints(1000, { kesPerPoint: null, pointsPerUnit: 1, maxPointsPerTransaction: null })).toBe(0);
  });

  it("only counts eligible items when the owner restricts the programme", () => {
    const open = { eligibleItems: [] };
    expect(eligibleAmount(open, { amountKES: 500 })).toEqual({ eligibleKES: 500, ineligible: false });

    const restricted = { eligibleItems: [{ itemKind: "PRODUCT", itemId: "prod_a1" }] };
    expect(
      eligibleAmount(restricted, { amountKES: 500, items: [{ itemKind: "PRODUCT", itemId: "prod_a1", amountKES: 100 }] }),
    ).toEqual({ eligibleKES: 100, ineligible: false });
    expect(
      eligibleAmount(restricted, { amountKES: 500, items: [{ itemKind: "PRODUCT", itemId: "prod_a2", amountKES: 400 }] }),
    ).toEqual({ eligibleKES: 0, ineligible: true });
  });

  it("records one verified purchase as one award", async () => {
    await activateProgramme();
    const card = await enrol();

    const result = await awardPoints({
      businessId: BIZ_A,
      cardId: card.id,
      transactionRef: "RCPT-100",
      amountKES: 350,
      actorId: "userA",
      actorLabel: "Owner A",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBeFalsy();
    expect(result.entry.points).toBe(3);
    expect(result.entry.type).toBe("EARNED");
    expect(result.entry.direction).toBe("CREDIT");
    expect(result.entry.source).toBe("OWNER_VERIFIED");
    expect(result.entry.sourceReference).toBe("RCPT-100");
    expect(result.account.availablePoints).toBe(3);
  });

  it("awards once when the same purchase reference is replayed", async () => {
    await activateProgramme();
    const card = await enrol();

    const first = await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-200", amountKES: 500 });
    const second = await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "rcpt-200", amountKES: 500 });
    const third = await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-200", amountKES: 900 });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!second.ok || !third.ok) return;
    // Case-insensitive and amount-independent: the reference is what identifies the purchase.
    expect(second.duplicate).toBe(true);
    expect(second.entry.id).toBe(third.entry?.id ?? second.entry.id);
    expect(third.duplicate).toBe(true);
    expect(fake().rows("loyaltyPointsLedger")).toHaveLength(1);

    const account = fake().rows("loyaltyPointsAccount")[0];
    expect(account.availablePoints).toBe(5);
  });

  it("never awards from an unverified payment event", async () => {
    await activateProgramme();
    const card = await enrol();

    const result = await awardPoints({
      businessId: BIZ_A,
      cardId: card.id,
      transactionRef: "PAY-1",
      amountKES: 500,
      source: "PAYMENT_PROVIDER",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    expect(fake().rows("loyaltyPointsLedger")).toHaveLength(0);
  });

  it("does not award a purchase below the owner's minimum", async () => {
    await activateProgramme(BIZ_A, { minPurchaseKES: 500 });
    const card = await enrol();

    const result = await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-1", amountKES: 499 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(fake().rows("loyaltyPointsLedger")).toHaveLength(0);
  });

  it("does not award when none of the items on the purchase are eligible", async () => {
    await activateProgramme(BIZ_A, { eligibleItems: [{ itemKind: "PRODUCT", itemId: "prod_a1" }] });
    const card = await enrol();

    const result = await awardPoints({
      businessId: BIZ_A,
      cardId: card.id,
      transactionRef: "RCPT-2",
      amountKES: 900,
      items: [{ itemKind: "PRODUCT", itemId: "prod_a2", amountKES: 900 }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(fake().rows("loyaltyPointsLedger")).toHaveLength(0);
  });

  it("refuses a customer from another business", async () => {
    await activateProgramme();
    const foreignCard = await enrol(BIZ_B, "Foreign");

    const result = await awardPoints({ businessId: BIZ_A, cardId: foreignCard.id, transactionRef: "RCPT-X", amountKES: 900 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

describe("redemption", () => {
  async function fund(cardId: string, ref: string, amountKES: number) {
    return awardPoints({ businessId: BIZ_A, cardId, transactionRef: ref, amountKES });
  }

  it("deducts the reward's cost exactly once and records a reference", async () => {
    await activateProgramme();
    const card = await enrol();
    const reward = await makeReward(BIZ_A, { title: "Free chapati", pointsCost: 10 });
    await fund(card.id, "RCPT-1", 1000); // 10 points

    const result = await redeemPoints({
      businessId: BIZ_A,
      cardId: card.id,
      rewardId: reward.id,
      idempotencyKey: "tap-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redemption.pointsSpent).toBe(10);
    expect(result.redemption.status).toBe("PENDING");
    expect(result.redemption.reference).toMatch(/^JATA-RWD-/);
    expect(result.account.availablePoints).toBe(0);
    expect(result.entry.type).toBe("REDEEMED");
    expect(result.entry.direction).toBe("DEBIT");
  });

  it("refuses a redemption the balance cannot cover", async () => {
    await activateProgramme();
    const card = await enrol();
    const reward = await makeReward(BIZ_A, { title: "Big hamper", pointsCost: 500 });
    await fund(card.id, "RCPT-1", 1000); // 10 points

    const result = await redeemPoints({ businessId: BIZ_A, cardId: card.id, rewardId: reward.id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    const account = fake().rows("loyaltyPointsAccount")[0];
    expect(account.availablePoints).toBe(10);
    expect(fake().rows("loyaltyRewardRedemption")).toHaveLength(0);
  });

  it("refuses redemption below the owner's threshold", async () => {
    await activateProgramme(BIZ_A, { minRedeemPoints: 50 });
    const card = await enrol();
    const reward = await makeReward(BIZ_A, { title: "Free chapati", pointsCost: 10 });
    await fund(card.id, "RCPT-1", 1000);

    const result = await redeemPoints({ businessId: BIZ_A, cardId: card.id, rewardId: reward.id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("cannot be double-spent by two redemptions at the same moment", async () => {
    await activateProgramme();
    const card = await enrol();
    const reward = await makeReward(BIZ_A, { title: "Free chapati", pointsCost: 8 });
    await fund(card.id, "RCPT-1", 1000); // 10 points — enough for one, not two.

    const [first, second] = await Promise.all([
      redeemPoints({ businessId: BIZ_A, cardId: card.id, rewardId: reward.id, idempotencyKey: "tap-a" }),
      redeemPoints({ businessId: BIZ_A, cardId: card.id, rewardId: reward.id, idempotencyKey: "tap-b" }),
    ]);

    const accepted = [first, second].filter((entry) => entry.ok);
    const refused = [first, second].filter((entry) => !entry.ok);
    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    if (refused[0] && !refused[0].ok) expect(refused[0].status).toBe(409);

    const account = fake().rows("loyaltyPointsAccount")[0];
    expect(account.availablePoints).toBe(2);
    expect(fake().rows("loyaltyRewardRedemption")).toHaveLength(1);
  });

  it("returns the same redemption when a request key is replayed", async () => {
    await activateProgramme();
    const card = await enrol();
    const reward = await makeReward(BIZ_A, { title: "Free chapati", pointsCost: 5 });
    await fund(card.id, "RCPT-1", 1000);

    const first = await redeemPoints({ businessId: BIZ_A, cardId: card.id, rewardId: reward.id, idempotencyKey: "tap-1" });
    const again = await redeemPoints({ businessId: BIZ_A, cardId: card.id, rewardId: reward.id, idempotencyKey: "tap-1" });

    expect(first.ok).toBe(true);
    expect(again.ok).toBe(true);
    if (!again.ok || !first.ok) return;
    expect(again.duplicate).toBe(true);
    expect(again.redemption.reference).toBe(first.redemption.reference);
    expect(fake().rows("loyaltyRewardRedemption")).toHaveLength(1);
    expect(fake().rows("loyaltyPointsAccount")[0].availablePoints).toBe(5);
  });

  it("refuses a reward from another business, and a paused reward", async () => {
    await activateProgramme();
    await activateProgramme(BIZ_B);
    const card = await enrol();
    const foreignReward = await makeReward(BIZ_B, { title: "Foreign reward", pointsCost: 1 });
    await fund(card.id, "RCPT-1", 1000);

    const crossTenant = await redeemPoints({ businessId: BIZ_A, cardId: card.id, rewardId: foreignReward.id });
    expect(crossTenant.ok).toBe(false);
    if (!crossTenant.ok) expect(crossTenant.status).toBe(404);

    const reward = await makeReward(BIZ_A, { title: "Free chapati", pointsCost: 5 });
    await setRewardActive({ businessId: BIZ_A, rewardId: reward.id, isActive: false });
    const paused = await redeemPoints({ businessId: BIZ_A, cardId: card.id, rewardId: reward.id });
    expect(paused.ok).toBe(false);
    if (!paused.ok) expect(paused.status).toBe(409);
  });

  it("returns the points with a compensating entry when a redemption is cancelled once", async () => {
    await activateProgramme();
    const card = await enrol();
    const reward = await makeReward(BIZ_A, { title: "Free chapati", pointsCost: 5 });
    await fund(card.id, "RCPT-1", 1000);
    const redeemed = await redeemPoints({ businessId: BIZ_A, cardId: card.id, rewardId: reward.id, idempotencyKey: "tap-1" });
    if (!redeemed.ok) return;

    const cancelled = await updateRedemptionStatus({
      businessId: BIZ_A,
      redemptionId: redeemed.redemption.id,
      status: "CANCELLED",
      reason: "Customer changed their mind",
    });
    const second = await updateRedemptionStatus({
      businessId: BIZ_A,
      redemptionId: redeemed.redemption.id,
      status: "CANCELLED",
      reason: "Customer changed their mind",
    });

    expect(cancelled.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(fake().rows("loyaltyPointsAccount")[0].availablePoints).toBe(10);
    // The original redemption row keeps its history; only a new entry returns the points.
    expect(fake().rows("loyaltyRewardRedemption")).toHaveLength(1);
  });
});

describe("reversals", () => {
  it("reverses a refunded purchase exactly once and keeps the original entry", async () => {
    await activateProgramme();
    const card = await enrol();
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-77", amountKES: 1000 });

    const first = await reversePoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-77", reason: "Refunded" });
    const second = await reversePoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-77", reason: "Refunded again" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);
    if (!first.ok) return;

    const ledger = fake().rows("loyaltyPointsLedger");
    expect(ledger).toHaveLength(2);
    const original = ledger.find((row: any) => row.type === "EARNED");
    const reversal = ledger.find((row: any) => row.type === "REVERSED");
    expect(original.points).toBe(10); // never rewritten
    expect(reversal.points).toBe(10);
    expect(reversal.reversalOfId).toBe(original.id);
    expect(reversal.direction).toBe("DEBIT");
    expect(fake().rows("loyaltyPointsAccount")[0].availablePoints).toBe(0);
  });

  it("reports the shortfall instead of clawing back spent points", async () => {
    await activateProgramme();
    const card = await enrol();
    const reward = await makeReward(BIZ_A, { title: "Free chapati", pointsCost: 6 });
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-9", amountKES: 1000 });
    await redeemPoints({ businessId: BIZ_A, cardId: card.id, rewardId: reward.id, idempotencyKey: "tap-1" });

    const result = await reversePoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-9", reason: "Refunded" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.points).toBe(4); // only the unspent part
    expect(result.shortfall).toBe(6);
    expect(result.account.availablePoints).toBe(0); // never negative without permission
  });

  it("refuses a reversal with no reason, and leaves the award where it was", async () => {
    await activateProgramme();
    const card = await enrol();
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-5", amountKES: 1000 });

    const result = await reversePoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-5", reason: "  " });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    expect(fake().rows("loyaltyPointsLedger").filter((row: any) => row.type === "REVERSED")).toHaveLength(0);
    expect(fake().rows("loyaltyPointsAccount")[0].availablePoints).toBe(10);
  });

  it("says so when nothing was ever awarded for that reference", async () => {
    await activateProgramme();
    const card = await enrol();
    const result = await reversePoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "NOPE", reason: "Refunded" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

describe("expiry", () => {
  it("expires unused points exactly once, even when the run is repeated", async () => {
    await activateProgramme(BIZ_A, { expiryMonths: 1 });
    const card = await enrol();
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-1", amountKES: 1000 });

    const later = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
    const first = await runExpiry({ businessId: BIZ_A, now: later });
    const second = await runExpiry({ businessId: BIZ_A, now: later });
    const third = await runExpiry({ businessId: BIZ_A, now: later });

    expect(first.expired).toBe(1);
    expect(first.pointsExpired).toBe(10);
    expect(second.expired).toBe(0);
    expect(third.expired).toBe(0);

    const ledger = fake().rows("loyaltyPointsLedger");
    expect(ledger.filter((row: any) => row.type === "EXPIRED")).toHaveLength(1);
    const earned = ledger.find((row: any) => row.type === "EARNED");
    expect(earned.points).toBe(10); // the original award is preserved
    expect(fake().rows("loyaltyPointsAccount")[0].availablePoints).toBe(0);
    expect(fake().rows("loyaltyPointsAccount")[0].lifetimeExpired).toBe(10);
  });

  it("does not expire points that have already been spent", async () => {
    await activateProgramme(BIZ_A, { expiryMonths: 1 });
    const card = await enrol();
    const reward = await makeReward(BIZ_A, { title: "Free chapati", pointsCost: 10 });
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-1", amountKES: 1000 });
    await redeemPoints({ businessId: BIZ_A, cardId: card.id, rewardId: reward.id, idempotencyKey: "tap-1" });

    const result = await runExpiry({ businessId: BIZ_A, now: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000) });

    expect(result.pointsExpired).toBe(0);
    expect(fake().rows("loyaltyPointsLedger").filter((row: any) => row.type === "EXPIRED")).toHaveLength(0);
  });

  it("never runs when expiry is switched off", async () => {
    await activateProgramme(BIZ_A, { expiryMonths: null });
    const card = await enrol();
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-1", amountKES: 1000 });

    const result = await runExpiry({ businessId: BIZ_A, now: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000) });

    expect(result.skipped).toMatch(/never expire/i);
    expect(result.expired).toBe(0);
    expect(fake().rows("loyaltyPointsLedger").filter((row: any) => row.type === "EXPIRED")).toHaveLength(0);
    expect(fake().rows("loyaltyPointsAccount")[0].availablePoints).toBe(10);
  });

  it("leaves an award with no expiry date alone, and shows the date to the customer", async () => {
    await activateProgramme(BIZ_A, { expiryMonths: 1 });
    const card = await enrol();
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-1", amountKES: 1000 });

    const wallet = await walletForCardCode(card.code);
    expect(wallet && "nextExpiryAt" in wallet ? wallet.nextExpiryAt : null).toBeTruthy();

    const before = await runExpiry({ businessId: BIZ_A, now: new Date() });
    expect(before.expired).toBe(0);
  });
});

describe("manual adjustments", () => {
  it("refuses an adjustment without a reason", async () => {
    await activateProgramme();
    const card = await enrol();

    const result = await adjustPoints({ businessId: BIZ_A, cardId: card.id, points: 10, reason: "typo" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("records the reason, the actor and a compensating entry in both directions", async () => {
    await activateProgramme();
    const card = await enrol();

    const credit = await adjustPoints({
      businessId: BIZ_A,
      cardId: card.id,
      points: 25,
      reason: "Goodwill for the delayed order",
      actorId: "userA",
      actorLabel: "Owner A",
    });
    const debit = await adjustPoints({
      businessId: BIZ_A,
      cardId: card.id,
      points: -10,
      reason: "Double counted at the counter",
      actorId: "userA",
      actorLabel: "Owner A",
    });

    expect(credit.ok).toBe(true);
    expect(debit.ok).toBe(true);
    if (!credit.ok || !debit.ok) return;
    expect(credit.entry.type).toBe("MANUAL_ADJUSTMENT");
    expect(credit.entry.actorUserId).toBe("userA");
    expect(credit.entry.explanation).toContain("Goodwill");
    expect(debit.entry.direction).toBe("DEBIT");
    expect(fake().rows("loyaltyPointsAccount")[0].availablePoints).toBe(15);
  });

  it("will not take a wallet below zero", async () => {
    await activateProgramme();
    const card = await enrol();

    const result = await adjustPoints({ businessId: BIZ_A, cardId: card.id, points: -5, reason: "Correction" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("replays a keyed adjustment instead of applying it twice", async () => {
    await activateProgramme();
    const card = await enrol();

    const first = await adjustPoints({ businessId: BIZ_A, cardId: card.id, points: 10, reason: "Correction", idempotencyKey: "adj-1" });
    const again = await adjustPoints({ businessId: BIZ_A, cardId: card.id, points: 10, reason: "Correction", idempotencyKey: "adj-1" });

    expect(first.ok).toBe(true);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.duplicate).toBe(true);
    expect(fake().rows("loyaltyPointsAccount")[0].availablePoints).toBe(10);
  });
});

describe("the ledger is the truth", () => {
  it("reconciles with the balance after every kind of movement", async () => {
    await activateProgramme(BIZ_A, { expiryMonths: 1 });
    const card = await enrol();
    const reward = await makeReward(BIZ_A, { title: "Free chapati", pointsCost: 4 });

    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "R-1", amountKES: 1000 }); // +10
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "R-2", amountKES: 500 }); // +5
    await redeemPoints({ businessId: BIZ_A, cardId: card.id, rewardId: reward.id, idempotencyKey: "tap-1" }); // -4
    await adjustPoints({ businessId: BIZ_A, cardId: card.id, points: 3, reason: "Goodwill" }); // +3
    await reversePoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "R-2", reason: "Refunded" }); // -5
    await runExpiry({ businessId: BIZ_A, now: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000) });

    const account = fake().rows("loyaltyPointsAccount")[0];
    const reconciliation = await reconcileAccount(BIZ_A, account.id);

    expect(reconciliation.reconciled).toBe(true);
    expect(reconciliation.credits - reconciliation.debits).toBe(reconciliation.available);
    expect(reconciliation.available).toBe(account.availablePoints);
  });

  it("keeps every movement, with the type the spec asks for", async () => {
    await activateProgramme(BIZ_A, { expiryMonths: 1 });
    const card = await enrol();
    const reward = await makeReward(BIZ_A, { title: "Free chapati", pointsCost: 1 });

    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "R-1", amountKES: 1000 });
    await redeemPoints({ businessId: BIZ_A, cardId: card.id, rewardId: reward.id, idempotencyKey: "tap-1" });
    await adjustPoints({ businessId: BIZ_A, cardId: card.id, points: 1, reason: "Goodwill" });
    await runExpiry({ businessId: BIZ_A, now: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000) });

    const types = new Set(fake().rows("loyaltyPointsLedger").map((row: any) => row.type));
    expect(types.has("EARNED")).toBe(true);
    expect(types.has("REDEEMED")).toBe(true);
    expect(types.has("MANUAL_ADJUSTMENT")).toBe(true);
    expect(types.has("EXPIRED")).toBe(true);
  });

  it("lists a customer's history newest first, without another customer's rows", async () => {
    await activateProgramme();
    const amina = await enrol(BIZ_A, "Amina");
    const brian = await enrol(BIZ_A, "Brian");
    await awardPoints({ businessId: BIZ_A, cardId: amina.id, transactionRef: "R-1", amountKES: 1000 });
    await awardPoints({ businessId: BIZ_A, cardId: brian.id, transactionRef: "R-2", amountKES: 1000 });

    const history = await listLedger(BIZ_A, { accountId: fake().rows("loyaltyPointsAccount").find((row: any) => row.cardId === amina.id)?.id });

    expect(history).toHaveLength(1);
    expect(history[0].sourceReference).toBe("R-1");
  });
});

describe("tenant isolation", () => {
  it("keeps each business's wallets, rewards and ledger to itself", async () => {
    await activateProgramme(BIZ_A);
    await activateProgramme(BIZ_B);
    const cardA = await enrol(BIZ_A, "Amina");
    const cardB = await enrol(BIZ_B, "Brian");
    await awardPoints({ businessId: BIZ_A, cardId: cardA.id, transactionRef: "R-1", amountKES: 1000 });
    await awardPoints({ businessId: BIZ_B, cardId: cardB.id, transactionRef: "R-1", amountKES: 1000 });

    const walletsA = await listAccounts(BIZ_A);
    expect(walletsA).toHaveLength(1);
    expect(walletsA[0].customerName).toBe("Amina");
    expect(await listAccounts(BIZ_B)).toHaveLength(1);
    expect((await listAccounts(BIZ_B))[0].customerName).toBe("Brian");

    const statsA = await (await import("@/lib/business-hub/loyaltyPoints")).pointsStats(BIZ_A);
    expect(statsA.pointsIssued).toBe(10);
    expect(statsA.wallets).toBe(1);
  });

  it("refuses to move points across businesses even when both are active", async () => {
    await activateProgramme(BIZ_A);
    await activateProgramme(BIZ_B);
    const cardA = await enrol(BIZ_A, "Amina");
    const cardB = await enrol(BIZ_B, "Brian");
    await awardPoints({ businessId: BIZ_A, cardId: cardA.id, transactionRef: "R-1", amountKES: 1000 });

    // Business B reversing a business A purchase: the reference does not exist in B's ledger.
    const reversal = await reversePoints({ businessId: BIZ_B, cardId: cardB.id, transactionRef: "R-1", reason: "Refund" });
    expect(reversal.ok).toBe(false);
    if (!reversal.ok) expect(reversal.status).toBe(404);

    // Business B adjusting a business A customer.
    const adjustment = await adjustPoints({ businessId: BIZ_B, cardId: cardA.id, points: 10, reason: "Correction" });
    expect(adjustment.ok).toBe(false);
    if (!adjustment.ok) expect(adjustment.status).toBe(404);
  });
});

describe("the customer's own view", () => {
  it("shows the wallet, how points are earned and what is affordable", async () => {
    await activateProgramme(BIZ_A, {
      description: "Earn while you eat.",
      terms: "Points are added after we verify your purchase.",
      redemptionRules: "Collect in store.",
    });
    const card = await enrol(BIZ_A, "Amina");
    await makeReward(BIZ_A, { title: "Free chapati", pointsCost: 5 });
    await makeReward(BIZ_A, { title: "Full meal", pointsCost: 500 });
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "R-1", amountKES: 1000 });

    const wallet = await walletForCardCode(card.code);
    if (!wallet || !("active" in wallet) || wallet.active !== true) throw new Error("wallet should be active");

    expect(wallet.availablePoints).toBe(10);
    expect(wallet.lifetimeEarned).toBe(10);
    expect(wallet.earning.kesPerPoint).toBe(100);
    expect(wallet.earning.terms).toBe("Points are added after we verify your purchase.");
    expect(wallet.rewards.find((reward) => reward.title === "Free chapati")?.affordable).toBe(true);
    expect(wallet.rewards.find((reward) => reward.title === "Full meal")?.affordable).toBe(false);
    expect(wallet.transactions[0].type).toBe("EARNED");
  });

  it("tells an anonymous caller nothing when the programme is off — and no contact details ever", async () => {
    const card = await enrol(BIZ_A, "Amina");

    const inactive = await walletForCardCode(card.code);
    expect(inactive && "active" in inactive ? inactive.active : null).toBe(false);
    expect(JSON.stringify(inactive)).not.toContain("0712345678");

    await activateProgramme();
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "R-1", amountKES: 1000 });
    const wallet = await walletForCardCode(card.code);
    const serialised = JSON.stringify(wallet);
    expect(serialised).not.toContain("0712345678");
    expect(serialised).not.toContain("ownerNotes");
    expect(serialised).not.toContain("accountId");
    expect(serialised).not.toContain("@example.com");
  });

  it("returns nothing for a code that does not exist", async () => {
    expect(await walletForCardCode("NO-SUCH-CODE")).toBeNull();
  });

  it("never lets a customer choose how many points to spend — the reward's cost is the amount", async () => {
    await activateProgramme();
    const card = await enrol(BIZ_A, "Amina");
    const reward = await makeReward(BIZ_A, { title: "Free chapati", pointsCost: 7 });
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "R-1", amountKES: 1000 });

    const result = await redeemPoints({ businessId: BIZ_A, cardId: card.id, rewardId: reward.id, idempotencyKey: "tap-1" });

    if (!result.ok) throw new Error("redemption should succeed");
    expect(result.redemption.pointsSpent).toBe(7); // the catalogue's cost, not a number from the caller
    expect(result.account.availablePoints).toBe(3);
  });
});

describe("the stamp card is untouched", () => {
  it("keeps enrolling, awarding and redeeming stamps while points are running", async () => {
    await saveProgram({
      businessId: BIZ_A,
      input: { isEnabled: true, stampGoal: 2, maxStampsPerVisit: 1, rewardDescription: "Free drink", terms: null },
      actorId: "userA",
      actorLabel: "Owner A",
    });
    await activateProgramme();
    const card = await enrol(BIZ_A, "Amina");

    await awardStamp({ businessId: BIZ_A, cardId: card.id, transactionRef: "ST-1", stamps: 1 });
    await awardStamp({ businessId: BIZ_A, cardId: card.id, transactionRef: "ST-2", stamps: 1 });
    const beforeRedeem = fake().rows("loyaltyCard").find((row: any) => row.id === card.id);
    expect(beforeRedeem.stampsEarned).toBe(2);
    expect(beforeRedeem.stampsRedeemed ?? 0).toBe(0);

    const redemption = await redeemReward({ businessId: BIZ_A, cardId: card.id, actorId: "userA", actorLabel: "Owner A" });
    expect(redemption.ok).toBe(true);

    // Points do not move the stamp counters, and stamps do not move the points.
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "R-1", amountKES: 1000 });
    const after = fake().rows("loyaltyCard").find((row: any) => row.id === card.id);
    expect(after.stampsEarned).toBe(2);
    expect(after.stampsRedeemed).toBe(2); // set by the stamp engine's own redemption
    expect(fake().rows("loyaltyStampEvent")).toHaveLength(2);
    expect(fake().rows("loyaltyRedemption")).toHaveLength(1);
    expect(fake().rows("loyaltyPointsAccount")[0].availablePoints).toBe(10);
  });

  it("keeps stamp balances out of the points balance", async () => {
    await activateProgramme();
    const card = await enrol(BIZ_A, "Amina");
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "R-1", amountKES: 1000 });

    const wallet = await walletForCardCode(card.code);
    if (!wallet || !("availablePoints" in wallet)) throw new Error("wallet expected");
    expect(wallet.availablePoints).toBe(10);

    const stampProgram = await getOrCreateProgram(BIZ_A);
    expect(stampProgram.stampGoal).toBeGreaterThan(0);
    const stampCard = fake().rows("loyaltyCard").find((row: any) => row.id === card.id);
    expect(stampCard.stampsEarned ?? 0).toBe(0); // points never minted a stamp
  });
});
