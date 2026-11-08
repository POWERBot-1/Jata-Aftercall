/**
 * Public Loyalty Rewards state — what the public page is told about a business's programme.
 *
 * Three answers, and the difference between them is the whole point:
 *   • `inactive` — there is no programme, or the owner has switched it off. Nothing is published.
 *   • `unknown`  — the configuration could not be read. Still nothing is published, but the page
 *                  is told it could not be read so it can say so instead of going quiet.
 *   • `active`   — the values the owner configured are published verbatim; nothing is invented.
 *
 * Runs against the Business Hub fake (no PostgreSQL here). The same three states are exercised on
 * a real database by `tests/integration/business-hub-loyalty-points-postgres.test.ts` and in real
 * Chrome by `scripts/browser/business-hub-journey.check.mjs`. Nothing here writes to a deployment.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createBusinessHubFakeDb, businessHubSeed } = await import("@/tests/helpers/businessHubFakeDb");
  const fake = createBusinessHubFakeDb(businessHubSeed());
  (globalThis as any).__hubFake = fake;
  return { default: fake.db };
});

import { publicLoyaltyRewards, publicPointsEnabled, saveReward, validateProgrammeInput, validateRewardInput } from "@/lib/business-hub/loyaltyPoints";

type FakeDb = import("@/tests/helpers/posFakeDb").FakeDb;
const fake = () => (globalThis as any).__hubFake as FakeDb;
const db = () => fake().db;

const BIZ_A = "bizA";
const BIZ_B = "bizB";

async function saveProgramme(businessId: string, overrides: Record<string, unknown> = {}) {
  const parsed = validateProgrammeInput({ isActive: true, kesPerPoint: 100, pointsPerUnit: 1, ...overrides });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const { saveProgramme: write } = await import("@/lib/business-hub/loyaltyPoints");
  await write({ businessId, input: parsed.value, actorId: "userA", actorLabel: "Owner A" });
}

async function addReward(businessId = BIZ_A, title = "Free chapati", pointsCost = 10) {
  const parsed = validateRewardInput({ title, pointsCost, kind: "FIXED_POINTS" });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return null;
  return saveReward({ businessId, input: parsed.value, actorId: "userA", actorLabel: "Owner A" });
}

beforeEach(() => {
  fake().reset();
});

describe("publicLoyaltyRewards reports the state the public page must render", () => {
  it("is `inactive` when the business has never configured a programme", async () => {
    const state = await publicLoyaltyRewards(BIZ_A);
    expect(state.status).toBe("inactive");
    expect(state.earning).toBeNull();
    expect(state.redemption).toBeNull();
    expect(state.rewards).toEqual([]);
    expect(await publicPointsEnabled(BIZ_A)).toBe(false);
  });

  it("is `inactive` for a configured programme the owner has switched off", async () => {
    await saveProgramme(BIZ_A, { isActive: false });
    const state = await publicLoyaltyRewards(BIZ_A);
    expect(state.status).toBe("inactive");
    // Not published: a switched-off programme's rates are not the public's business.
    expect(state.earning).toBeNull();
    expect(state.redemption).toBeNull();
    expect(state.rewards).toEqual([]);
    expect(await publicPointsEnabled(BIZ_A)).toBe(false);
  });

  it("is `unknown` when the configuration cannot be read — not `inactive`", async () => {
    await saveProgramme(BIZ_A);
    const spy = vi.spyOn(db().loyaltyPointsProgramme, "findUnique").mockRejectedValue(new Error("connection lost"));
    try {
      const state = await publicLoyaltyRewards(BIZ_A);
      expect(state.status).toBe("unknown");
      expect(state.earning).toBeNull();
      expect(state.rewards).toEqual([]);
      // Fails closed: an unreadable programme never opens the lookup.
      expect(await publicPointsEnabled(BIZ_A)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("is `active` and publishes exactly what the owner configured", async () => {
    await saveProgramme(BIZ_A, {
      kesPerPoint: 100,
      pointsPerUnit: 2,
      minPurchaseKES: 250,
      minRedeemPoints: 20,
      pointValueKES: 5,
      expiryMonths: 12,
      description: "Earn while you eat.",
      terms: "Points are added after verification.",
      redemptionRules: "Collect in store.",
    });
    await addReward(BIZ_A, "Free pilau combo", 10);
    await addReward(BIZ_A, "Dessert platter", 30);

    const state = await publicLoyaltyRewards(BIZ_A);
    expect(state.status).toBe("active");
    expect(state.earning).toEqual({
      kesPerPoint: 100,
      pointsPerUnit: 2,
      minPurchaseKES: 250,
      expiryMonths: 12,
      description: "Earn while you eat.",
      terms: "Points are added after verification.",
    });
    expect(state.redemption).toEqual({ minRedeemPoints: 20, pointValueKES: 5, rules: "Collect in store." });
    expect(state.rewards.map((reward) => reward.title).sort()).toEqual(["Dessert platter", "Free pilau combo"]);
    // A public reward carries the customer-facing fields only — no item ids, no internal flags.
    for (const reward of state.rewards) {
      expect(Object.keys(reward).sort()).toEqual(
        ["description", "discountKES", "id", "kind", "pointsCost", "title"].sort(),
      );
    }
    expect(await publicPointsEnabled(BIZ_A)).toBe(true);
  });

  it("leaves unset values null instead of inventing a default", async () => {
    // The owner's own form refuses to switch a programme on without a rate, so a live programme
    // with unset values can only be a row written outside it. The public page still has to answer
    // honestly for one: no rate is published, and no rate is invented.
    await db().loyaltyPointsProgramme.create({
      data: { businessId: BIZ_A, isActive: true, kesPerPoint: null, pointsPerUnit: null, expiryMonths: null, pointValueKES: null },
    });
    const state = await publicLoyaltyRewards(BIZ_A);
    expect(state.status).toBe("active");
    expect(state.earning?.kesPerPoint).toBeNull();
    expect(state.earning?.pointsPerUnit).toBeNull();
    expect(state.earning?.expiryMonths).toBeNull();
    expect(state.redemption?.pointValueKES).toBeNull();
    expect(state.rewards).toEqual([]);
  });

  it("never publishes an inactive reward", async () => {
    await saveProgramme(BIZ_A);
    const reward = await addReward(BIZ_A, "Withdrawn reward", 5);
    await db().loyaltyReward.update({ where: { id: reward.id }, data: { isActive: false } });
    await addReward(BIZ_A, "Live reward", 8);
    const state = await publicLoyaltyRewards(BIZ_A);
    expect(state.rewards.map((entry) => entry.title)).toEqual(["Live reward"]);
  });

  it("reads each business's own programme — one tenant's state never answers for another", async () => {
    await saveProgramme(BIZ_A, { kesPerPoint: 100 });
    await saveProgramme(BIZ_B, { isActive: false, kesPerPoint: 300 });
    expect((await publicLoyaltyRewards(BIZ_A)).status).toBe("active");
    expect((await publicLoyaltyRewards(BIZ_A)).earning?.kesPerPoint).toBe(100);
    const other = await publicLoyaltyRewards(BIZ_B);
    expect(other.status).toBe("inactive");
    expect(other.earning).toBeNull();
  });

  it("creates nothing: a public page view must not write a programme row", async () => {
    await publicLoyaltyRewards(BIZ_A);
    await publicPointsEnabled(BIZ_A);
    expect(fake().rows("loyaltyPointsProgramme")).toHaveLength(0);
    expect(fake().rows("loyaltyReward")).toHaveLength(0);
  });
});
