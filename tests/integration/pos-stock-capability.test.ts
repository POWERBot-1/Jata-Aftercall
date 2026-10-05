/**
 * Stock levels are a capability, and the till and the ledger must agree on it (§33, §47).
 *
 * A business that only records movements — a salon that sells a retail item, a bar, a farm —
 * must keep taking money when the number is zero. A business that tracks quantities wants the
 * till to refuse what it does not have. The capability is the contract, so `checkAvailability`
 * (which decides whether a sale is allowed) and `recordMovement` (which writes it) have to read
 * the *same* rule. When they disagree, the till refuses a sale it had just decided to allow —
 * or, worse, silently lets stock go negative for a business that counts every unit.
 *
 * This suite is the regression for that disagreement: it drives the real engine against the
 * in-memory database for all three configurations — no inventory at all, movements without
 * stock levels, and stock levels enforced.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createFakeDb, standardSeed } = await import("@/tests/helpers/posFakeDb");
  const fake = createFakeDb(standardSeed());
  (globalThis as any).__posFake = fake;
  return { default: fake.db };
});

import prisma from "@/lib/db";
import { effectiveConfiguration, loadConfiguration, saveDraft } from "@/lib/pos/provisioning";
import { finalize } from "@/lib/pos/configuration";
import { checkAvailability, negativeStockAllowed, stockLevelsEnforced } from "@/lib/pos/inventory";
import { createSale, type PosActor } from "@/lib/pos/sales";
import { recordMovement } from "@/lib/pos/store";
import { settlePosPayment } from "@/lib/pos/settlement";
import { POS_PLAN_KEY } from "@/lib/pos/entitlement";
import type { PosConfiguration } from "@/lib/pos/types";
import type { FakeDb } from "@/tests/helpers/posFakeDb";

const fake = () => (globalThis as any).__posFake as FakeDb;
const rows = (name: string) => fake().rows(name);
const business = { name: "Nyumbani Kitchen", phone: "0712000000", whatsapp: null, location: "Nairobi", logoUrl: null, email: null };

const retailAnswers = {
  business_type: "retail",
  sells: ["products"],
  payment_methods: ["cash"],
  keeps_stock: true,
  units: ["piece"],
  keeps_customers: false,
  has_staff: false,
  staff_count: 1,
  staff_roles: ["CASHIER"],
  tracks_expenses: false,
};

function actor(): PosActor {
  return {
    actorId: "userA",
    actorName: "Owner A",
    roleKey: "OWNER",
    permissions: ["CREATE_SALE", "VIEW_SALES", "VIEW_INVENTORY", "ADJUST_STOCK"],
    staffId: null,
    branchId: null,
  };
}

async function goLive() {
  await saveDraft({ businessId: "bizA", answers: retailAnswers, actorId: "userA", context: { businessName: business.name } });
  fake().rows("payment").push({
    id: "pay_stock_1",
    reference: "jata-pos-stock-1",
    businessId: "bizA",
    userId: "userA",
    planId: "plan_pos",
    amount: 49_900,
    currency: "KES",
    status: "PENDING",
  });
  await prisma.$transaction(async (tx: any) =>
    settlePosPayment(tx, {
      payment: { id: "pay_stock_1", reference: "jata-pos-stock-1", businessId: "bizA", userId: "userA", planId: "plan_pos", amount: 49_900, currency: "KES", status: "PENDING" },
      plan: { id: "plan_pos", key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 },
      eventId: "evt_stock_1",
    }),
  );
  const record = await loadConfiguration("bizA");
  return effectiveConfiguration(record, "LIVE")!;
}

/** The same configuration with the stock-levels capability switched to `enforced`. */
function withStockLevels(config: PosConfiguration, enforced: boolean): PosConfiguration {
  const capabilities = new Set(config.capabilities ?? []);
  if (enforced) {
    capabilities.add("products");
    capabilities.add("stock_levels");
  } else {
    capabilities.delete("stock_levels");
  }
  return finalize({ ...config, capabilities: [...capabilities] });
}

/** No stock row for `p_a1` at all: the question every one of these tests turns on. */
function clearStock(productId = "p_a1") {
  const remaining = rows("posInventoryItem").filter((row) => row.productId !== productId);
  rows("posInventoryItem").length = 0;
  rows("posInventoryItem").push(...remaining);
}

const oneChapati = { items: [{ productId: "p_a1", quantity: 1 }], payments: [{ method: "cash", amountKES: 50 }] };

beforeEach(() => {
  fake().reset();
});

describe("the capability is the one rule both sides read (§33, §47)", () => {
  it("treats stock levels as enforced only when the capability is on", async () => {
    const config = await goLive();
    const enforced = withStockLevels(config, true);
    const movementOnly = withStockLevels(config, false);

    expect(enforced.inventory.enabled).toBe(true);
    expect(stockLevelsEnforced(enforced)).toBe(true);
    expect(stockLevelsEnforced(movementOnly)).toBe(false);
    // The two predicates are exact opposites, so there is no third state a caller can fall into.
    expect(negativeStockAllowed(enforced)).toBe(!stockLevelsEnforced(enforced));
    expect(negativeStockAllowed(movementOnly)).toBe(!stockLevelsEnforced(movementOnly));
    // No configuration at all is the strict answer, never the permissive one.
    expect(stockLevelsEnforced(null)).toBe(false);
    expect(negativeStockAllowed(undefined)).toBe(true);
  });

  it("the availability check and the movement writer agree for every configuration", async () => {
    const config = await goLive();
    for (const enforced of [true, false]) {
      const cfg = withStockLevels(config, enforced);
      clearStock();
      const availability = checkAvailability(cfg, [{ productId: "p_a1", name: "Chapati", kind: "PRODUCT", quantity: 1, unitPriceKES: 50 }], {});
      if (enforced) {
        expect(availability.ok, "stock levels enforced must refuse").toBe(false);
        // …and the writer must refuse too, by throwing rather than going negative.
        await expect(
          recordMovement("bizA", { productId: "p_a1", reason: "SALE", delta: -1, quantity: 1 }, undefined, { configuration: cfg }),
        ).rejects.toThrow();
      } else {
        expect(availability.ok, "movements-only must allow").toBe(true);
        await expect(
          recordMovement("bizA", { productId: "p_a1", reason: "SALE", delta: -1, quantity: 1 }, undefined, { configuration: cfg }),
        ).resolves.toBeTruthy();
      }
    }
  });

  it("a caller that names no configuration gets the strict rule, never a silent bypass", async () => {
    clearStock();
    // Passing nothing is not permission: silence must never weaken stock protection.
    await expect(recordMovement("bizA", { productId: "p_a1", reason: "SALE", delta: -1, quantity: 1 })).rejects.toThrow();
    expect(rows("posInventoryItem").filter((row) => row.productId === "p_a1")).toHaveLength(0);
  });
});

describe("selling under each configuration (§33, §47)", () => {
  it("a business that records movements without stock levels sells on at zero, and the ledger shows it", async () => {
    const config = withStockLevels(await goLive(), false);
    clearStock();

    const outcome = await createSale({ businessId: "bizA", business, configuration: config, actor: actor(), request: oneChapati as any });
    expect(outcome.ok, `expected the sale to succeed: ${(outcome as any).code} ${(outcome as any).message}`).toBe(true);

    // The sale exists, the movement is recorded and the number is allowed to go below zero:
    // the ledger never lies, but a number this business does not maintain never blocks a sale.
    expect(rows("posSale")).toHaveLength(1);
    const movements = rows("posInventoryMovement").filter((row) => row.reason === "SALE");
    expect(movements).toHaveLength(1);
    expect(Number(movements[0].delta)).toBe(-1);
    expect(rows("posInventoryItem").find((row) => row.productId === "p_a1")?.quantity).toBe(-1);
  });

  it("a business that keeps stock levels is refused a sale it cannot cover", async () => {
    const config = withStockLevels(await goLive(), true);
    clearStock();

    const outcome = await createSale({ businessId: "bizA", business, configuration: config, actor: actor(), request: oneChapati as any });
    expect(outcome.ok).toBe(false);
    expect((outcome as any).code).toBe("INSUFFICIENT_STOCK");

    // Nothing was written: no sale, no movement, no money row, no phantom stock row.
    expect(rows("posSale")).toHaveLength(0);
    expect(rows("posInventoryMovement")).toHaveLength(0);
    expect(rows("posPayment")).toHaveLength(0);
    expect(rows("posInventoryItem").filter((row) => row.productId === "p_a1")).toHaveLength(0);
  });

  it("a business that keeps stock levels sells normally when the stock is there", async () => {
    const config = withStockLevels(await goLive(), true);
    // The seed holds 40 chapati in the stock room.
    expect(rows("posInventoryItem").find((row) => row.productId === "p_a1")?.quantity).toBe(40);

    const outcome = await createSale({ businessId: "bizA", business, configuration: config, actor: actor(), request: oneChapati as any });
    expect(outcome.ok, `expected the sale to succeed: ${(outcome as any).code} ${(outcome as any).message}`).toBe(true);
    expect(rows("posInventoryItem").find((row) => row.productId === "p_a1")?.quantity).toBe(39);
    expect(rows("posInventoryMovement").filter((row) => row.reason === "SALE")).toHaveLength(1);

    // …and is stopped exactly at the last unit rather than one past it.
    const everything = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: actor(),
      request: { items: [{ productId: "p_a1", quantity: 39 }], payments: [{ method: "cash", amountKES: 1950 }] } as any,
    });
    expect(everything.ok).toBe(true);
    expect(rows("posInventoryItem").find((row) => row.productId === "p_a1")?.quantity).toBe(0);

    const oneTooMany = await createSale({ businessId: "bizA", business, configuration: config, actor: actor(), request: oneChapati as any });
    expect(oneTooMany.ok).toBe(false);
    expect((oneTooMany as any).code).toBe("INSUFFICIENT_STOCK");
    expect(rows("posInventoryItem").find((row) => row.productId === "p_a1")?.quantity).toBe(0);
  });

  it("a business with stock switched off entirely never consults a number", async () => {
    const config = await goLive();
    clearStock();
    const noInventory = finalize({ ...config, inventory: { ...config.inventory, enabled: false } });
    expect(stockLevelsEnforced(noInventory)).toBe(false);

    const outcome = await createSale({ businessId: "bizA", business, configuration: noInventory, actor: actor(), request: oneChapati as any });
    expect(outcome.ok, `expected the sale to succeed: ${(outcome as any).code} ${(outcome as any).message}`).toBe(true);
  });

  it("a corrective count may still take stock below zero for a business that counts it", async () => {
    // `stock_adjustments` corrects an over-recorded count: it is the one movement a business
    // that enforces stock levels may legitimately take below zero, and it says so explicitly.
    const config = withStockLevels(await goLive(), true);
    const movement = await recordMovement(
      "bizA",
      { productId: "p_a1", reason: "ADJUSTMENT", delta: -60, quantity: 60, note: "Counted 20 too many" },
      undefined,
      { allowNegative: true, configuration: config },
    );
    expect(movement).toBeTruthy();
    expect(rows("posInventoryItem").find((row) => row.productId === "p_a1")?.quantity).toBe(-20);
  });
});
