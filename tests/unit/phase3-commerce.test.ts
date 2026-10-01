/**
 * Phase 3 Commerce Tests (§30–§34, §58, §67, §89, §122)
 *
 * Covers: cart, orders, pricing engine, merchant payment config, pre-orders.
 */

import { describe, it, expect } from "vitest";
import { calculateLineSubtotal, calculateCommerceTotal } from "../../lib/commerce-pricing";
import { isValidStateTransition, formatOrderReference } from "../../lib/order";
import { buildCartFromLines } from "../../lib/cart";
import { createPreOrderSummary } from "../../lib/preorder";

/** Pricing Engine (§30, §33) */

describe("Phase 3 — Commerce Pricing Engine", () => {
  it("line subtotal is deterministic (quantity * unit price)", () => {
    expect(calculateLineSubtotal({ quantity: 2, unitPriceKES: 450 })).toBe(900);
    expect(calculateLineSubtotal({ quantity: 1, unitPriceKES: 500 })).toBe(500);
  });

  it("total includes delivery and discount (explicit only, never invented)", () => {
    const result = calculateCommerceTotal({
      lineItems: [{ name: "Chicken Burger", quantity: 2, unitPriceKES: 450 }],
      deliveryFeeKES: 200,
      discountKES: 0,
    });
    expect(result.subtotalKES).toBe(900);
    expect(result.deliveryFeeKES).toBe(200);
    expect(result.discountKES).toBe(0);
    expect(result.totalKES).toBe(1100);
  });

  it("discount exceeds subtotal throws (no invented discounts §32)", () => {
    expect(() => calculateCommerceTotal({
      lineItems: [{ name: "Item", quantity: 1, unitPriceKES: 100 }],
      discountKES: 500,
    })).toThrow("Discount cannot exceed subtotal");
  });

  it("negative quantity or price is rejected (§33)", () => {
    expect(() => calculateLineSubtotal({ quantity: -1, unitPriceKES: 100 })).toThrow();
    expect(() => calculateLineSubtotal({ quantity: 1, unitPriceKES: -50 })).toThrow();
  });
});

/** Cart (§58) */

describe("Phase 3 — Cart Service", () => {
  it("cart builds from structured lines with authoritative pricing", () => {
    const calc = buildCartFromLines([
      { productId: "p1", name: "Chicken Burger", quantity: 2, unitPriceKES: 450 },
    ]);
    expect(calc.subtotalKES).toBe(900);
    expect(calc.lineItems.length).toBe(1);
  });
});

/** Order State Machine (§34) */

describe("Phase 3 — Order State Machine", () => {
  it("valid transitions work correctly", () => {
    expect(isValidStateTransition("DRAFT", "PENDING_CUSTOMER_CONFIRMATION")).toBe(true);
    expect(isValidStateTransition("PENDING_CUSTOMER_CONFIRMATION", "PENDING_PAYMENT")).toBe(true);
    expect(isValidStateTransition("PENDING_PAYMENT", "PAYMENT_PROCESSING")).toBe(true);
    expect(isValidStateTransition("PAYMENT_PROCESSING", "PAYMENT_VERIFIED")).toBe(true);
    expect(isValidStateTransition("PAYMENT_VERIFIED", "CONFIRMED")).toBe(true);
  });

  it("invalid transitions are rejected server-side", () => {
    expect(isValidStateTransition("DRAFT", "COMPLETED")).toBe(false);
    expect(isValidStateTransition("COMPLETED", "PENDING_PAYMENT")).toBe(false);
  });

  it("order reference format includes JATA-ORD prefix", () => {
    const ref = formatOrderReference("20261001", 1);
    expect(ref).toContain("JATA-ORD-");
    expect(ref).toContain("20261001");
  });
});

/** Pre-Orders (§15) */

describe("Phase 3 — Pre-Orders", () => {
  it("pre-order summary clearly labels the transaction as a pre-order", () => {
    const summary = createPreOrderSummary({ productName: "Red Hoodie", quantity: 1, fullPriceKES: 2500, depositRequiredKES: 500 });
    expect(summary.label).toContain("PRE-ORDER");
    expect(summary.totalKES).toBe(2500);
    expect(summary.depositKES).toBe(500);
  });
});

/** Security Design (§3, §6, §9, §43) */

describe("Phase 3 — Commerce Security Design", () => {
  it("pricing engine does not invent discounts", () => {
    // The engine only applies discounts when explicitly provided; it never generates them.
    const result = calculateCommerceTotal({
      lineItems: [{ name: "Item", quantity: 1, unitPriceKES: 100 }],
      discountKES: undefined,
    });
    expect(result.discountKES).toBe(0);
  });

  it("merchant payment configuration exists and excludes secrets from response (§6)", () => {
    // Verified by reading the source file design.
    const fs = require("fs");
    const source = fs.readFileSync("app/api/merchant-payment/route.ts", "utf8");
    expect(source).toContain("publicInfo");
    expect(source).toContain("encryptedCredentials");
    // Ensure response never includes encryptedCredentials.
    const responseSection = source.split("return NextResponse.json({")[1]?.split("});")[0] || "";
    expect(responseSection).not.toContain("encryptedCredentials");
  });
});
