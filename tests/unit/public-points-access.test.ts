/**
 * Loyalty 2.0 — public Points & Rewards access on a Business Page.
 *
 * The public page shows the points section and the stamp card from two independent flags:
 * `isLoyaltyEnabled` (the stamp programme) and `publicPointsEnabled` (the points programme). These
 * tests hold that separation — every combination is asserted, neither programme is required for the
 * other, and a page that cannot PROVE points are active shows no points section at all.
 *
 * Runs against the Business Hub fake; the real-database suite and the browser journey own the
 * behaviour that needs PostgreSQL row locks and a real browser.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createBusinessHubFakeDb, businessHubSeed } = await import("@/tests/helpers/businessHubFakeDb");
  const fake = createBusinessHubFakeDb(businessHubSeed());
  (globalThis as any).__hubFake = fake;
  return { default: fake.db };
});

import { isLoyaltyEnabled, awardStamp, enrolCard, saveProgram } from "@/lib/business-hub/loyalty";
import {
  awardPoints,
  findProgramme,
  normaliseCardCode,
  publicPointsEnabled,
  saveReward,
  validateProgrammeInput,
  validateRewardInput,
  walletForCardCode,
} from "@/lib/business-hub/loyaltyPoints";
import { normaliseCardCode as sharedCardCode } from "@/lib/business-hub/cardCode";

type FakeDb = import("@/tests/helpers/posFakeDb").FakeDb;
const fake = () => (globalThis as any).__hubFake as FakeDb;
const db = () => fake().db;

const BIZ_A = "bizA";
const BIZ_B = "bizB";

async function activatePoints(businessId = BIZ_A, overrides: Record<string, unknown> = {}): Promise<void> {
  const parsed = validateProgrammeInput({ isActive: true, kesPerPoint: 100, pointsPerUnit: 1, ...overrides });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const { saveProgramme } = await import("@/lib/business-hub/loyaltyPoints");
  await saveProgramme({ businessId, input: parsed.value, actorId: "userA", actorLabel: "Owner A" });
}

async function enableStamps(businessId = BIZ_A): Promise<void> {
  await saveProgram({
    businessId,
    input: { isEnabled: true, stampGoal: 2, maxStampsPerVisit: 1, rewardDescription: "Free pilau combo", terms: null },
    actorId: "userA",
    actorLabel: "Owner A",
  });
}

async function enrol(businessId = BIZ_A, name = "Amina"): Promise<any> {
  return enrolCard({
    businessId,
    input: { customerName: name, contactMethod: "PHONE", contactValue: "0712345678" },
    actorId: "userA",
    actorLabel: "Owner A",
  });
}

async function addReward(businessId = BIZ_A, title = "Free chapati", pointsCost = 10): Promise<any> {
  const parsed = validateRewardInput({ title, pointsCost, kind: "FIXED_POINTS" });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return null;
  return saveReward({ businessId, input: parsed.value, actorId: "userA", actorLabel: "Owner A" });
}

beforeEach(() => {
  fake().reset();
});

// ── 1. the four programme combinations ────────────────────────────────────────────────────────

describe("the public page's two sections are driven by two independent flags", () => {
  /** The page renders `#points-rewards` when `points` is true and `#loyalty` when `stamps` is true. */
  async function sectionsFor(businessId: string) {
    const [stamps, points] = await Promise.all([isLoyaltyEnabled(businessId), publicPointsEnabled(businessId)]);
    return { stamps, points };
  }

  it("stamps off / points off → neither section", async () => {
    expect(await sectionsFor(BIZ_A)).toEqual({ stamps: false, points: false });
  });

  it("stamps on / points off → the stamp card only", async () => {
    await enableStamps(BIZ_A);
    expect(await sectionsFor(BIZ_A)).toEqual({ stamps: true, points: false });
  });

  it("stamps off / points on → the points section only", async () => {
    await activatePoints(BIZ_A);
    expect(await sectionsFor(BIZ_A)).toEqual({ stamps: false, points: true });
  });

  it("stamps on / points on → both sections", async () => {
    await enableStamps(BIZ_A);
    await activatePoints(BIZ_A);
    expect(await sectionsFor(BIZ_A)).toEqual({ stamps: true, points: true });
  });

  it("activating one programme never activates the other", async () => {
    await activatePoints(BIZ_A);
    expect(await isLoyaltyEnabled(BIZ_A)).toBe(false);
    await enableStamps(BIZ_A);
    expect(await publicPointsEnabled(BIZ_A)).toBe(true); // still on, and still independent
  });

  it("one business's configuration never decides another's", async () => {
    await activatePoints(BIZ_A);
    expect(await publicPointsEnabled(BIZ_B)).toBe(false);
    await enableStamps(BIZ_A);
    expect(await isLoyaltyEnabled(BIZ_B)).toBe(false);
  });
});

// ── 2. the activation decision itself ─────────────────────────────────────────────────────────

describe("publicPointsEnabled reads the authoritative configuration and fails closed", () => {
  it("is false when no programme row exists", async () => {
    expect(await findProgramme(BIZ_A)).toBeNull();
    expect(await publicPointsEnabled(BIZ_A)).toBe(false);
  });

  it("is false for a configured but inactive programme", async () => {
    const parsed = validateProgrammeInput({ isActive: false, kesPerPoint: 100, pointsPerUnit: 1 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { saveProgramme } = await import("@/lib/business-hub/loyaltyPoints");
    await saveProgramme({ businessId: BIZ_A, input: parsed.value, actorId: "userA", actorLabel: "Owner A" });
    expect((await findProgramme(BIZ_A))?.isActive).toBe(false);
    expect(await publicPointsEnabled(BIZ_A)).toBe(false);
  });

  it("is true only when the programme is genuinely active", async () => {
    await activatePoints(BIZ_A);
    expect((await findProgramme(BIZ_A))?.isActive).toBe(true);
    expect(await publicPointsEnabled(BIZ_A)).toBe(true);
  });

  it("is false when the programme lookup fails — a page that cannot prove activation shows nothing", async () => {
    await activatePoints(BIZ_A);
    const spy = vi.spyOn(db().loyaltyPointsProgramme, "findUnique").mockRejectedValue(new Error("connection lost"));
    try {
      expect(await publicPointsEnabled(BIZ_A)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("never creates a programme as a side effect of being asked", async () => {
    await publicPointsEnabled(BIZ_A);
    expect(fake().rows("loyaltyPointsProgramme")).toHaveLength(0);
  });
});

// ── 3. card codes, as customers actually type them ────────────────────────────────────────────

describe("card-code normalisation", () => {
  it("strips spacing and ignores case", () => {
    expect(normaliseCardCode(" jata-4f9k-2q7m ")).toBe("JATA-4F9K-2Q7M");
    expect(normaliseCardCode("jata 4f9k 2q7m")).toBe("JATA4F9K2Q7M");
    expect(normaliseCardCode("JATA4F9K2Q7M")).toBe("JATA4F9K2Q7M");
  });

  it("turns nothing into nothing, so an empty submission is never a lookup", () => {
    expect(normaliseCardCode("")).toBe("");
    expect(normaliseCardCode("   ")).toBe("");
    expect(normaliseCardCode(null)).toBe("");
    expect(normaliseCardCode(undefined)).toBe("");
  });

  it("caps what a pasted value can become", () => {
    expect(normaliseCardCode("A".repeat(500)).length).toBe(60);
    expect(normaliseCardCode("A".repeat(500)).endsWith("A")).toBe(true);
  });

  it("is the same function the browser form uses", () => {
    expect(sharedCardCode).toBe(normaliseCardCode);
  });
});

// ── 4. the wallet lookup a public page performs ───────────────────────────────────────────────

describe("the public wallet lookup", () => {
  it("returns the customer's own balance, earning rule and rewards", async () => {
    await activatePoints(BIZ_A);
    await addReward(BIZ_A, "Free chapati", 10);
    const card = await enrol(BIZ_A, "Amina");
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-1", amountKES: 1200 });

    const wallet = await walletForCardCode(card.code);
    expect(wallet).not.toBeNull();
    if (!wallet || !("active" in wallet) || wallet.active !== true) return;
    expect(wallet.availablePoints).toBe(12);
    expect(wallet.customerName).toBe("Amina");
    expect(wallet.businessSlug).toBe("nyumbani-kitchen");
    expect(wallet.earning).toMatchObject({ kesPerPoint: 100, pointsPerUnit: 1 });
    expect(wallet.rewards.map((reward) => reward.title)).toEqual(["Free chapati"]);
  });

  it("accepts the same code typed loosely, because that is how customers type it", async () => {
    await activatePoints(BIZ_A);
    const card = await enrol(BIZ_A, "Amina");
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-1", amountKES: 500 });

    const loose = ` ${card.code.toLowerCase()} `;
    const wallet = await walletForCardCode(loose);
    expect(wallet).not.toBeNull();
    if (!wallet || !("active" in wallet) || wallet.active !== true) return;
    expect(wallet.availablePoints).toBe(5);
  });

  it("returns nothing for an unknown code, an empty code or a failed lookup", async () => {
    await activatePoints(BIZ_A);
    const card = await enrol(BIZ_A, "Amina");

    expect(await walletForCardCode("JATA-NOT-A-CARD")).toBeNull();
    expect(await walletForCardCode("")).toBeNull();
    expect(await walletForCardCode("    ")).toBeNull();

    const spy = vi.spyOn(db().loyaltyCard, "findUnique").mockRejectedValue(new Error("connection lost"));
    try {
      expect(await walletForCardCode(card.code)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("says the programme is off — with the business name only — when it is not active", async () => {
    await enrol(BIZ_A, "Amina");
    const inactive = await walletForCardCode((await enrol(BIZ_A, "Amina")).code);
    expect(inactive).toEqual({ businessName: "Nyumbani Kitchen", businessSlug: "nyumbani-kitchen", active: false });
  });

  it("never returns a contact value, a card id, an account id or an owner note", async () => {
    await activatePoints(BIZ_A);
    const card = await enrol(BIZ_A, "Amina");
    await awardPoints({
      businessId: BIZ_A,
      cardId: card.id,
      transactionRef: "RCPT-1",
      amountKES: 500,
      note: "Regular customer — ask Mary",
    });

    const wallet = await walletForCardCode(card.code);
    const serialised = JSON.stringify(wallet);
    expect(serialised).not.toMatch(/0712345678/);
    expect(serialised).not.toMatch(/mary@example\.com/i);
    expect(serialised).not.toMatch(/ask mary/i);
    // Identifiers are for the owner's screen, never the customer's.
    expect(serialised).not.toMatch(/"(accountId|cardId|id)"/);
  });

  it("answers a second business's card with that business's own programme", async () => {
    await activatePoints(BIZ_A);
    await activatePoints(BIZ_B);
    await addReward(BIZ_A, "Chapati at A", 10);
    await addReward(BIZ_B, "Cement at B", 20);
    const cardB = await enrol(BIZ_B, "Brian");

    const wallet = await walletForCardCode(cardB.code);
    if (!wallet || !("active" in wallet) || wallet.active !== true) throw new Error("expected an active wallet");
    expect(wallet.businessSlug).toBe("mwangi-hardware");
    expect(wallet.rewards.map((reward) => reward.title)).toEqual(["Cement at B"]);
  });

  it("is read-only: looking at a wallet changes no balance and writes no ledger row", async () => {
    await activatePoints(BIZ_A);
    const card = await enrol(BIZ_A, "Amina");
    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-1", amountKES: 500 });
    const before = JSON.stringify({
      accounts: fake().rows("loyaltyPointsAccount"),
      ledger: fake().rows("loyaltyPointsLedger"),
    });

    await walletForCardCode(card.code);
    await walletForCardCode(card.code);

    expect(
      JSON.stringify({
        accounts: fake().rows("loyaltyPointsAccount"),
        ledger: fake().rows("loyaltyPointsLedger"),
      }),
    ).toBe(before);
  });
});

// ── 5. the two mechanisms stay independent ────────────────────────────────────────────────────

describe("points and stamps do not depend on each other", () => {
  it("awards points on a business whose stamp programme is off", async () => {
    await activatePoints(BIZ_A);
    const card = await enrol(BIZ_A, "Amina");
    // Enrolling a card can create the stamp programme, so "stamps off" is set explicitly: points
    // must not be awardable only while the stamp card happens to be on.
    await saveProgram({
      businessId: BIZ_A,
      input: { isEnabled: false, stampGoal: 2, maxStampsPerVisit: 1, rewardDescription: "Free pilau combo", terms: null },
      actorId: "userA",
      actorLabel: "Owner A",
    });
    expect(await isLoyaltyEnabled(BIZ_A)).toBe(false);

    const result = await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-1", amountKES: 1000 });
    expect(result.ok).toBe(true);
    expect(fake().rows("loyaltyStampEvent")).toHaveLength(0);
  });

  it("awards stamps on a business whose points programme is off, and writes no points", async () => {
    await enableStamps(BIZ_A);
    const card = await enrol(BIZ_A, "Amina");

    const stamped = await awardStamp({
      businessId: BIZ_A,
      cardId: card.id,
      transactionRef: "TXN-1",
      stamps: 1,
      actorId: "userA",
      actorLabel: "Owner A",
    });
    expect(stamped?.ok ?? true).toBe(true);
    expect(await publicPointsEnabled(BIZ_A)).toBe(false);
    expect(fake().rows("loyaltyPointsLedger")).toHaveLength(0);
    expect(fake().rows("loyaltyStampEvent")).toHaveLength(1);
  });

  it("keeps the stamp card's own counters untouched while points move", async () => {
    await enableStamps(BIZ_A);
    await activatePoints(BIZ_A);
    const card = await enrol(BIZ_A, "Amina");
    await awardStamp({ businessId: BIZ_A, cardId: card.id, transactionRef: "TXN-1", stamps: 1, actorId: "userA", actorLabel: "Owner A" });
    const stampsBefore = fake().rows("loyaltyCard").find((row: any) => row.id === card.id);

    await awardPoints({ businessId: BIZ_A, cardId: card.id, transactionRef: "RCPT-1", amountKES: 1000 });

    const stampsAfter = fake().rows("loyaltyCard").find((row: any) => row.id === card.id);
    expect(stampsAfter.stampsEarned).toBe(stampsBefore.stampsEarned);
    expect(stampsAfter.stampsRedeemed).toBe(stampsBefore.stampsRedeemed);
  });
});
