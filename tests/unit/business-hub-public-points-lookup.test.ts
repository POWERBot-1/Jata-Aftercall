/**
 * The public points wallet lookup — what a customer's card code is allowed to open.
 *
 * This is the half a rendered-markup test cannot reach: the code the customer types, the business
 * they are standing on, and what comes back for each combination. It runs against the Business Hub
 * fake (unique indexes enforced, `P2002` raised as PostgreSQL would). The concurrency and rollback
 * half stays in `tests/integration/business-hub-loyalty-points-postgres.test.ts`.
 *
 * Two rules are held here above all:
 *   1. A code resolves to the one card the business issued, however it is typed — and to nothing at
 *      all when it is empty, unknown, or issued by a different business.
 *   2. The payload is the customer's own wallet and nothing else: no contact value, no owner note,
 *      no internal identifier.
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
  awardPoints,
  normaliseCardCode,
  saveProgramme,
  saveReward,
  validateProgrammeInput,
  validateRewardInput,
  walletForCardCode,
} from "@/lib/business-hub/loyaltyPoints";
import { awardStamp, enrolCard, getOrCreateProgram, saveProgram } from "@/lib/business-hub/loyalty";

type FakeDb = import("@/tests/helpers/posFakeDb").FakeDb;
const fake = () => (globalThis as any).__hubFake as FakeDb;

const BIZ_A = "bizA";
const BIZ_B = "bizB";
const SLUG_A = "nyumbani-kitchen";
const SLUG_B = "mwangi-hardware";

async function activateProgramme(businessId = BIZ_A): Promise<void> {
  const parsed = validateProgrammeInput({ isActive: true, kesPerPoint: 100, pointsPerUnit: 1 });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  await saveProgramme({ businessId, input: parsed.value, actorId: "userA", actorLabel: "Owner A" });
}

async function enrol(businessId = BIZ_A, name = "Amina"): Promise<any> {
  return enrolCard({
    businessId,
    input: { customerName: name, contactMethod: "PHONE", contactValue: "0712345678" },
    actorId: "userA",
    actorLabel: "Owner A",
  });
}

beforeEach(() => {
  fake().reset();
  mocks.session = null;
});

describe("a card code is normalised before it is looked up", () => {
  it("folds case and removes spaces", () => {
    expect(normaliseCardCode("jata-4f9k-2q7m")).toBe("JATA-4F9K-2Q7M");
    expect(normaliseCardCode(" jata 4f9k 2q7m ")).toBe("JATA4F9K2Q7M");
    expect(normaliseCardCode("Jata-4F9K-2Q7M")).toBe("JATA-4F9K-2Q7M");
  });

  it("is empty for anything that is not a code, so an empty lookup can never match a row", () => {
    expect(normaliseCardCode("")).toBe("");
    expect(normaliseCardCode("   ")).toBe("");
    expect(normaliseCardCode(null)).toBe("");
    expect(normaliseCardCode(undefined)).toBe("");
  });

  it("opens the same wallet however the code is typed", async () => {
    await activateProgramme();
    const card = await enrol();
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "R-1", amountKES: 1000 });

    const typed = await walletForCardCode(` ${card.code.toLowerCase().split("").join(" ")} `);
    const exact = await walletForCardCode(card.code);

    expect(typed).not.toBeNull();
    expect(typed).toEqual(exact);
    if (typed && "availablePoints" in typed) expect(typed.availablePoints).toBe(10);
  });
});

describe("a lookup that cannot be honoured returns nothing", () => {
  it("returns null for an empty code", async () => {
    await activateProgramme();
    await enrol();
    expect(await walletForCardCode("")).toBeNull();
    expect(await walletForCardCode("    ")).toBeNull();
  });

  it("returns null for a code that does not exist", async () => {
    await activateProgramme();
    await enrol();
    expect(await walletForCardCode("NOT-A-CODE")).toBeNull();
  });

  it("returns null when the business row is gone, rather than a wallet with no owner", async () => {
    await activateProgramme();
    const card = await enrol();
    await fake().db.business.delete({ where: { id: BIZ_A } });
    expect(await walletForCardCode(card.code)).toBeNull();
  });

  it("shows no wallet at all when the programme cannot be read", async () => {
    await activateProgramme();
    const card = await enrol();
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "R-1", amountKES: 1000 });
    const original = fake().db.loyaltyPointsProgramme.findUnique;
    fake().db.loyaltyPointsProgramme.findUnique = async () => {
      throw new Error("the points service is unavailable");
    };
    try {
      const wallet = await walletForCardCode(card.code);
      // Fail closed: an unreadable programme is never presented as an active one, and no balance
      // is guessed. The answer carries no points data at all — only the business it belongs to.
      expect(wallet?.active).toBe(false);
      expect(Object.keys(wallet ?? {}).sort()).toEqual(["active", "businessName", "businessSlug"]);
      expect(JSON.stringify(wallet)).not.toMatch(/availablePoints|lifetimeEarned|rewards/);
    } finally {
      fake().db.loyaltyPointsProgramme.findUnique = original;
    }
  });

  it("says the programme is off, with no balance, when the owner has not switched it on", async () => {
    await enrol();
    const card = fake().rows("loyaltyCard")[0];
    const wallet = await walletForCardCode(card.code);

    expect(wallet).not.toBeNull();
    expect(wallet?.active).toBe(false);
    // The business is named so the page can explain itself, and nothing else is disclosed.
    expect(Object.keys(wallet ?? {}).sort()).toEqual(["active", "businessName", "businessSlug"]);
    expect(JSON.stringify(wallet)).not.toMatch(/availablePoints|0712345678/);
  });
});

describe("one business's page cannot open another business's wallet", () => {
  it("refuses a card issued by a different business", async () => {
    await activateProgramme(BIZ_A);
    await activateProgramme(BIZ_B);
    const mine = await enrol(BIZ_A, "Amina");
    const theirs = await enrol(BIZ_B, "Brian");
    await awardPoints({ businessId: BIZ_B, cardId: theirs.id, transactionRef: "B-1", amountKES: 1000 });

    // Their card, asked for from my page: refused, exactly as a code that does not exist.
    expect(await walletForCardCode(theirs.code, { businessSlug: SLUG_A })).toBeNull();
    // My card, from my page: opened.
    const mineWallet = await walletForCardCode(mine.code, { businessSlug: SLUG_A });
    expect(mineWallet?.active).toBe(true);
    // Their card, from their own page: opened. The refusal is about the page, not the card.
    const theirsWallet = await walletForCardCode(theirs.code, { businessSlug: SLUG_B });
    expect(theirsWallet?.active).toBe(true);
    if (theirsWallet && "availablePoints" in theirsWallet) expect(theirsWallet.availablePoints).toBe(10);
  });

  it("still answers when no business is named, so a QR code that carries no slug keeps working", async () => {
    await activateProgramme();
    const card = await enrol();
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "R-1", amountKES: 500 });

    const wallet = await walletForCardCode(card.code);
    expect(wallet?.active).toBe(true);
    if (wallet && "availablePoints" in wallet) expect(wallet.availablePoints).toBe(5);
  });
});

describe("the wallet a customer is shown is their own, and nothing else", () => {
  it("carries no contact value, owner note or internal identifier", async () => {
    await activateProgramme();
    const card = await enrol();
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "R-1", amountKES: 1000 });
    const parsed = validateRewardInput({ title: "Free chapati", pointsCost: 10, kind: "FIXED_POINTS" });
    if (parsed.ok) await saveReward({ businessId: BIZ_A, input: parsed.value, actorId: "userA", actorLabel: "Owner A" });

    const wallet = await walletForCardCode(card.code);
    const payload = JSON.stringify(wallet);

    // The customer's own card holds a phone number; the public wallet must never echo it.
    expect(fake().rows("loyaltyCard")[0].contactValue).toBe("0712345678");
    expect(payload).not.toContain("0712345678");
    expect(payload).not.toContain("contactValue");
    expect(payload).not.toContain("contactMethod");
    // No internal identifiers: the wallet is keyed by the code the customer already holds.
    expect(payload).not.toContain(card.id);
    expect(payload).not.toContain("accountId");
    expect(payload).not.toContain("programmeId");
    expect(payload).not.toContain("businessId");
    // And nothing that belongs to another customer.
    expect(payload).not.toContain("Brian");
  });

  it("names the customer and the rewards they can afford, and nothing about the owner", async () => {
    await activateProgramme();
    const card = await enrol(BIZ_A, "Amina");
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "R-1", amountKES: 1000 });
    const parsed = validateRewardInput({ title: "Free chapati", pointsCost: 10, kind: "FIXED_POINTS" });
    if (parsed.ok) await saveReward({ businessId: BIZ_A, input: parsed.value, actorId: "userA", actorLabel: "Owner A" });

    const wallet = await walletForCardCode(card.code);
    if (!wallet || !("availablePoints" in wallet)) throw new Error("the wallet should be active");
    expect(wallet.customerName).toBe("Amina");
    expect(wallet.availablePoints).toBe(10);
    expect(wallet.rewards).toHaveLength(1);
    expect(wallet.rewards[0].affordable).toBe(true);
    expect(Object.keys(wallet)).not.toContain("actorLabel");
  });
});

describe("points and stamps answer for themselves", () => {
  it("opens a points wallet while the stamp programme is switched off", async () => {
    await saveProgram({
      businessId: BIZ_A,
      input: { isEnabled: false, stampGoal: 4, maxStampsPerVisit: 1, rewardDescription: null, terms: null },
      actorId: "userA",
      actorLabel: "Owner A",
    });
    const card = await enrol();
    await activateProgramme();
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "R-1", amountKES: 1000 });

    const programme = await getOrCreateProgram(BIZ_A);
    expect(programme.isEnabled).toBe(false);

    const wallet = await walletForCardCode(card.code);
    expect(wallet?.active).toBe(true);
    if (wallet && "availablePoints" in wallet) expect(wallet.availablePoints).toBe(10);
  });

  it("keeps stamping while the points programme is off, and a stamp award changes no points", async () => {
    await saveProgram({
      businessId: BIZ_A,
      input: { isEnabled: true, stampGoal: 4, maxStampsPerVisit: 1, rewardDescription: "Free pilau", terms: null },
      actorId: "userA",
      actorLabel: "Owner A",
    });
    const card = await enrol();

    await awardStamp({
      businessId: BIZ_A,
      cardId: card.id,
      transactionRef: "STAMP-1",
      actorId: "userA",
      actorLabel: "Owner A",
    });

    const stamped = fake().rows("loyaltyCard").find((row: any) => row.id === card.id);
    expect(stamped.stampsEarned).toBe(1);
    // Points were never configured, so there is no wallet and no ledger row — and the stamp card
    // did not quietly create one.
    expect(fake().rows("loyaltyPointsAccount")).toHaveLength(0);
    expect(fake().rows("loyaltyPointsLedger")).toHaveLength(0);
  });

  it("leaves the stamp balance untouched when points are awarded on the same card", async () => {
    await saveProgram({
      businessId: BIZ_A,
      input: { isEnabled: true, stampGoal: 4, maxStampsPerVisit: 1, rewardDescription: "Free pilau", terms: null },
      actorId: "userA",
      actorLabel: "Owner A",
    });
    const card = await enrol();
    await awardStamp({
      businessId: BIZ_A,
      cardId: card.id,
      transactionRef: "STAMP-1",
      actorId: "userA",
      actorLabel: "Owner A",
    });
    await activateProgramme();
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "R-1", amountKES: 1000 });

    const stamped = fake().rows("loyaltyCard").find((row: any) => row.id === card.id);
    expect(stamped.stampsEarned).toBe(1);
    // A card that has never redeemed carries no redeemed count yet; what matters is that points
    // did not add one or take one away.
    expect(Number(stamped.stampsRedeemed ?? 0)).toBe(0);
    const wallet = await walletForCardCode(card.code);
    if (!wallet || !("availablePoints" in wallet)) throw new Error("the wallet should be active");
    expect(wallet.availablePoints).toBe(10);
  });
});
