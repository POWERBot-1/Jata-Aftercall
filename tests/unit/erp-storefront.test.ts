/**
 * Public storefront (POS / ERP - PRO).
 *
 * The shop is the only unauthenticated surface in the product, so the tests concentrate on what an
 * attacker controls: the product reference, the basket, the phone number and the replay key. Every
 * price is recomputed from the database, and stock is only moved when the business confirms.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "@/tests/helpers/posFakeDb";
import { erpSeed } from "@/tests/helpers/erpSeed";
import {
  advanceStoreOrder,
  confirmStoreOrder,
  loadPublicCatalogue,
  ORDER_STATUS_LABELS,
  orderTransitions,
  placeStoreOrder,
  publicOrderView,
  StorefrontError,
} from "@/lib/erp/storefront";

let fake: FakeDb;

const OPEN = new Date("2026-10-27T09:00:00+03:00");

function enableShop(overrides: Record<string, unknown> = {}) {
  fake.rows("erpConfiguration").find((row) => row.businessId === "bizA")!.storefrontJson = JSON.stringify({
    enabled: true,
    headline: "Chapati, straight off the grill",
    allowPickup: true,
    allowDelivery: true,
    openHour: 0,
    closeHour: 24,
    ...overrides,
  });
}

beforeEach(() => {
  fake = createFakeDb(erpSeed());
});

describe("catalogue", () => {
  it("is closed until the owner opens it", async () => {
    await expect(loadPublicCatalogue(fake.db, "nyumbani-shop")).rejects.toMatchObject({ code: "STORE_CLOSED" });
  });

  it("returns signed references, not product ids", async () => {
    enableShop();
    const catalogue = await loadPublicCatalogue(fake.db, "nyumbani-shop");
    expect(catalogue.businessName).toBe("Nyumbani Kitchen");
    expect(catalogue.products).toHaveLength(2);
    for (const product of catalogue.products) {
      expect(product.ref).not.toContain("p_a");
      expect(product.ref.length).toBeGreaterThanOrEqual(20);
    }
    expect(catalogue.products.find((product) => product.name === "Chapati")?.priceCents).toBe(5000);
  });

  it("hides a product that is out of stock", async () => {
    enableShop();
    fake.rows("posInventoryItem").find((row) => row.productId === "p_a2")!.quantity = 0;
    const catalogue = await loadPublicCatalogue(fake.db, "nyumbani-shop");
    expect(catalogue.products.map((product) => product.name)).toEqual(["Chapati"]);
  });

  it("does not reveal any other tenant's shop", async () => {
    enableShop();
    await expect(loadPublicCatalogue(fake.db, "mwangi-shop")).rejects.toMatchObject({ code: "STORE_CLOSED" });
  });
});

describe("placing an order", () => {
  async function refFor(name: string) {
    const catalogue = await loadPublicCatalogue(fake.db, "nyumbani-shop");
    return catalogue.products.find((product) => product.name === name)!.ref;
  }

  beforeEach(() => enableShop());

  it("computes the total from the database, not from anything the browser sends", async () => {
    const ref = await refFor("Chapati");
    const result = await placeStoreOrder(fake.db, {
      slug: "nyumbani-shop",
      customerName: "Jane Wanjiku",
      customerPhone: "0712 111 111",
      fulfilment: "PICKUP",
      items: [{ ref, quantity: 3 }],
      now: OPEN,
    });

    expect(result.order.subtotalCents).toBe(15_000);
    expect(result.order.totalCents).toBe(15_000);
    expect(result.order.status).toBe("PENDING");
    expect(result.order.orderNumber).toMatch(/^ORD-\d{6}$/);
    expect(result.order.publicToken.length).toBeGreaterThan(20);
  });

  it("records the VAT inside the price rather than adding it on top", async () => {
    const ref = await refFor("Chapati");
    const result = await placeStoreOrder(fake.db, {
      slug: "nyumbani-shop",
      customerName: "Jane Wanjiku",
      customerPhone: "0712111111",
      fulfilment: "PICKUP",
      items: [{ ref, quantity: 10 }],
      now: OPEN,
    });
    expect(result.order.subtotalCents).toBe(50_000);
    expect(result.order.taxCents).toBe(Math.round((50_000 * 1600) / 11_600));
    expect(result.order.totalCents).toBe(50_000);
  });

  it("rejects a forged product reference", async () => {
    await expect(
      placeStoreOrder(fake.db, {
        slug: "nyumbani-shop",
        customerName: "Jane Wanjiku",
        customerPhone: "0712111111",
        fulfilment: "PICKUP",
        items: [{ ref: "p_a1", quantity: 1 }],
        now: OPEN,
      }),
    ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
  });

  it("rejects a honeypot submission silently", async () => {
    const ref = await refFor("Chapati");
    await expect(
      placeStoreOrder(fake.db, {
        slug: "nyumbani-shop",
        customerName: "Bot",
        customerPhone: "0712111111",
        fulfilment: "PICKUP",
        items: [{ ref, quantity: 1 }],
        trap: "http://spam.example",
        now: OPEN,
      }),
    ).rejects.toMatchObject({ code: "REJECTED" });
  });

  it("validates the phone number and enforces the minimum order", async () => {
    const ref = await refFor("Chapati");
    await expect(
      placeStoreOrder(fake.db, {
        slug: "nyumbani-shop",
        customerName: "Jane",
        customerPhone: "12345",
        fulfilment: "PICKUP",
        items: [{ ref, quantity: 1 }],
        now: OPEN,
      }),
    ).rejects.toMatchObject({ code: "PHONE_INVALID" });

    enableShop({ minimumOrderCents: 100_000 });
    await expect(
      placeStoreOrder(fake.db, {
        slug: "nyumbani-shop",
        customerName: "Jane",
        customerPhone: "0712111111",
        fulfilment: "PICKUP",
        items: [{ ref, quantity: 1 }],
        now: OPEN,
      }),
    ).rejects.toMatchObject({ code: "BELOW_MINIMUM" });
  });

  it("requires a delivery address inside the served areas", async () => {
    const ref = await refFor("Chapati");
    enableShop({ deliveryAreas: ["Westlands", "Kilimani"], deliveryFeeCents: 20_000 });

    await expect(
      placeStoreOrder(fake.db, {
        slug: "nyumbani-shop",
        customerName: "Jane",
        customerPhone: "0712111111",
        fulfilment: "DELIVERY",
        deliveryAddress: "Somewhere in Mombasa",
        items: [{ ref, quantity: 1 }],
        now: OPEN,
      }),
    ).rejects.toMatchObject({ code: "OUTSIDE_DELIVERY_AREA" });

    const delivered = await placeStoreOrder(fake.db, {
      slug: "nyumbani-shop",
      customerName: "Jane",
      customerPhone: "0712111111",
      fulfilment: "DELIVERY",
      deliveryAddress: "ABC Place, Westlands",
      items: [{ ref, quantity: 1 }],
      now: OPEN,
    });
    expect(delivered.order.deliveryCents).toBe(20_000);
    expect(delivered.order.totalCents).toBe(5_000 + 20_000);
  });

  it("replays the same order for the same phone and key, but not for a different customer", async () => {
    const ref = await refFor("Chapati");
    const input = {
      slug: "nyumbani-shop",
      customerName: "Jane Wanjiku",
      customerPhone: "0712111111",
      fulfilment: "PICKUP" as const,
      items: [{ ref, quantity: 1 }],
      idempotencyKey: "web-1",
      now: OPEN,
    };
    const first = await placeStoreOrder(fake.db, input);
    const second = await placeStoreOrder(fake.db, input);
    expect(second.replayed).toBe(true);
    expect(second.order.id).toBe(first.order.id);
    expect(fake.rows("erpStoreOrder")).toHaveLength(1);

    await expect(
      placeStoreOrder(fake.db, { ...input, customerPhone: "0722222222" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("refuses to sell more than the shelf holds", async () => {
    const ref = await refFor("Chapati");
    fake.rows("posInventoryItem").find((row) => row.productId === "p_a1")!.quantity = 2;
    await expect(
      placeStoreOrder(fake.db, {
        slug: "nyumbani-shop",
        customerName: "Jane",
        customerPhone: "0712111111",
        fulfilment: "PICKUP",
        items: [{ ref, quantity: 5 }],
        now: OPEN,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  });

  it("does not touch stock until the business confirms", async () => {
    const ref = await refFor("Chapati");
    const placed = await placeStoreOrder(fake.db, {
      slug: "nyumbani-shop",
      customerName: "Jane",
      customerPhone: "0712111111",
      fulfilment: "PICKUP",
      items: [{ ref, quantity: 2 }],
      now: OPEN,
    });

    const before = fake.rows("posInventoryItem").find((row) => row.productId === "p_a1")!.quantity;
    expect(before).toBe(40);

    const confirmed = await confirmStoreOrder(fake.db, { businessId: "bizA", orderId: placed.order.id, actorId: "userA" });
    expect(confirmed.alreadyConfirmed).toBe(false);
    expect(confirmed.order.status).toBe("CONFIRMED");
    expect(fake.rows("posInventoryItem").find((row) => row.productId === "p_a1")!.quantity).toBe(38);

    const movement = fake.rows("posInventoryMovement")[0];
    expect(movement.reason).toBe("SALE");
    expect(movement.refType).toBe("STORE_ORDER");
    expect(movement.delta).toBe(-2);

    const again = await confirmStoreOrder(fake.db, { businessId: "bizA", orderId: placed.order.id });
    expect(again.alreadyConfirmed).toBe(true);
    expect(fake.rows("posInventoryMovement")).toHaveLength(1);
  });

  it("leaves an order pending when stock disappeared after the order was placed", async () => {
    const ref = await refFor("Chapati");
    const placed = await placeStoreOrder(fake.db, {
      slug: "nyumbani-shop",
      customerName: "Jane",
      customerPhone: "0712111111",
      fulfilment: "PICKUP",
      items: [{ ref, quantity: 2 }],
      now: OPEN,
    });
    fake.rows("posInventoryItem").find((row) => row.productId === "p_a1")!.quantity = 0;

    await expect(confirmStoreOrder(fake.db, { businessId: "bizA", orderId: placed.order.id })).rejects.toBeInstanceOf(StorefrontError);
    expect(fake.rows("erpStoreOrder").find((row) => row.id === placed.order.id)!.status).toBe("PENDING");
  });

  it("moves an order through the allowed transitions only", async () => {
    const ref = await refFor("Chapati");
    const placed = await placeStoreOrder(fake.db, {
      slug: "nyumbani-shop",
      customerName: "Jane",
      customerPhone: "0712111111",
      fulfilment: "PICKUP",
      items: [{ ref, quantity: 1 }],
      now: OPEN,
    });
    await confirmStoreOrder(fake.db, { businessId: "bizA", orderId: placed.order.id });
    await advanceStoreOrder(fake.db, { businessId: "bizA", orderId: placed.order.id, status: "READY" });
    await advanceStoreOrder(fake.db, { businessId: "bizA", orderId: placed.order.id, status: "FULFILLED" });
    await expect(
      advanceStoreOrder(fake.db, { businessId: "bizA", orderId: placed.order.id, status: "CANCELLED" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("will not confirm another tenant's order", async () => {
    const ref = await refFor("Chapati");
    const placed = await placeStoreOrder(fake.db, {
      slug: "nyumbani-shop",
      customerName: "Jane",
      customerPhone: "0712111111",
      fulfilment: "PICKUP",
      items: [{ ref, quantity: 1 }],
      now: OPEN,
    });
    await expect(confirmStoreOrder(fake.db, { businessId: "bizB", orderId: placed.order.id })).rejects.toMatchObject({ status: 404 });
  });
});

describe("customer order view", () => {
  it("shows the last three digits only and no internal ids", async () => {
    const view = publicOrderView(
      { orderNumber: "ORD-000001", status: "PENDING", fulfilment: "PICKUP", createdAt: OPEN, customerName: "Jane", customerPhone: "254712111111", subtotalCents: 5000, deliveryCents: 0, taxCents: 690, totalCents: 5000 },
      [{ name: "Chapati", quantity: 1, unitAmountCents: 5000, lineTotalCents: 5000 }],
      { name: "Nyumbani Kitchen", phone: "254712000000" },
    );
    expect(view.phoneLast3).toBe("111");
    expect(view.businessPhoneLast3).toBe("000");
    expect(JSON.stringify(view)).not.toContain("254712111111");
  });
});

describe("order status menu", () => {
  it("offers only the transitions the engine accepts", () => {
    expect(orderTransitions("PENDING")).toEqual(["CONFIRMED", "REJECTED", "CANCELLED"]);
    expect(orderTransitions("CONFIRMED")).toEqual(["READY", "CANCELLED"]);
    expect(orderTransitions("READY")).toEqual(["FULFILLED", "CANCELLED"]);
    expect(orderTransitions("FULFILLED")).toEqual([]);
    expect(orderTransitions("carrier-pigeon")).toEqual([]);
  });

  it("advances through the exact statuses it advertises", async () => {
    enableShop({ minOrderCents: 0, minimumOrderCents: 0 });
    const catalogue = await loadPublicCatalogue(fake.db, "nyumbani-shop");
    const ref = catalogue.products[0].ref;
    const placed = await placeStoreOrder(fake.db, {
      slug: "nyumbani-shop",
      customerName: "Jane",
      customerPhone: "0712111111",
      fulfilment: "PICKUP",
      items: [{ ref, quantity: 1 }],
      now: OPEN,
    });
    await confirmStoreOrder(fake.db, { businessId: "bizA", orderId: placed.order.id });
    for (const status of orderTransitions("CONFIRMED")) {
      if (status !== "CANCELLED") {
        await expect(
          advanceStoreOrder(fake.db, { businessId: "bizA", orderId: placed.order.id, status }),
        ).resolves.toMatchObject({ status });
      }
    }
    expect(orderTransitions("FULFILLED")).toHaveLength(0);
  });

  it("labels every status, so no screen falls back to shouting at the customer", () => {
    for (const status of ["PENDING", "CONFIRMED", "READY", "FULFILLED", "REJECTED", "CANCELLED"]) {
      expect(ORDER_STATUS_LABELS[status]).toBeTruthy();
      expect(ORDER_STATUS_LABELS[status]).not.toBe(ORDER_STATUS_LABELS[status].toUpperCase());
    }
  });
});
