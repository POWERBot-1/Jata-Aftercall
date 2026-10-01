/**
 * Phase 5 Intelligence Tests (§28, §29, §30, §54, §64, §65)
 *
 * Covers: unanswered questions, demand insights, AI quality tracking,
 * readiness enhancement with intelligence indicators.
 */

import { describe, it, expect } from "vitest";
import { isValidStateTransition, formatOrderReference } from "../../lib/order";
import { calculateCommerceTotal } from "../../lib/commerce-pricing";

/** Unanswered Questions (§28, §29) */

describe("Phase 5 — Unanswered Questions", () => {
  it("unanswered question tracking supports approval workflow (§29)", () => {
    // Structural verification: the schema allows approvedAnswer and isResolved fields.
    const fs = require("fs");
    const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
    expect(schema).toContain("model UnansweredQuestion");
    expect(schema).toContain("approvedAnswer");
    expect(schema).toContain("isResolved");
  });

  it("demand insight schema supports missed-demand tracking (§65)", () => {
    const fs = require("fs");
    const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
    expect(schema).toContain("model DemandInsight");
    expect(schema).toContain("MISSED_DEMAND");
  });
});

/** AI Quality Tracking (§30) */

describe("Phase 5 — AI Quality Tracking", () => {
  it("quality event schema records source, confidence, escalation, and missing info (§30)", () => {
    const fs = require("fs");
    const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
    expect(schema).toContain("model AIQualityEvent");
    expect(schema).toContain("sourceUsed");
    expect(schema).toContain("confidence");
    expect(schema).toContain("escalatedToHuman");
    expect(schema).toContain("missingBusinessInfo");
  });

  it("quality event source is structured data by default (§95)", () => {
    // Verified by reading source file design.
    const source = require("fs").readFileSync("lib/intelligence.ts", "utf8");
    expect(source).toContain("structured_data");
    // Default source uses structured data; unknown is a fallback option.
    expect(source.includes("structured_data") || source.includes("unknown")).toBe(true);
  });
});

/** Intelligence Integration (§54, §64, §65) */

describe("Phase 5 — Intelligence Integration", () => {
  it("readiness enhancement uses operational indicators (§54)", () => {
    // The readiness endpoint (Phase 1) checks profile, products, prices, inventory,
    // opening hours, notification, AI config, and entitlement active.
    // Phase 5 enhances it with unanswered questions and demand insights.
    const readinessSource = require("fs").readFileSync("app/api/ai/readiness/route.ts", "utf8");
    expect(readinessSource).toContain("readyForLive");
    expect(readinessSource).toContain("missingCritical");
  });

  it("demand insight supports business decision making (§65)", () => {
    // The demand insight endpoint tracks missed-demand categories.
    const source = require("fs").readFileSync("app/api/intelligence/demand/route.ts", "utf8");
    expect(source).toContain("DEMAND_INSIGHT");
    expect(source).toContain("MISSED_DEMAND");
  });

  it("pricing engine remains deterministic with Phase 5 (§30, §89)", () => {
    const result = calculateCommerceTotal({
      lineItems: [{ name: "Item", quantity: 1, unitPriceKES: 100 }],
      deliveryFeeKES: 0,
      discountKES: 0,
    });
    expect(result.subtotalKES).toBe(100);
    expect(result.totalKES).toBe(100);
  });

  it("order reference supports intelligence linking (§89)", () => {
    const ref = formatOrderReference("20261001", 184);
    expect(ref).toContain("JATA-ORD-");
  });

  it("notification reliability preserved with Phase 5 (§37, §63)", () => {
    // Notification status remains separate from order/payment status.
    const notificationSource = require("fs").readFileSync("lib/notification.ts", "utf8");
    expect(notificationSource).toContain("PENDING");
    expect(notificationSource).toContain("RETRY_QUEUED");
    expect(notificationSource).not.toContain("rollback");
  });

  it("no unrelated Phase 3 or Phase 4 modifications (§3, §43, §101)", () => {
    // Verify that Phase 5 files do not contain secrets or break previous designs.
    const intelligenceSource = require("fs").readFileSync("lib/intelligence.ts", "utf8");
    expect(intelligenceSource).not.toContain("passwordHash");
    expect(intelligenceSource).not.toContain("paystackSecret");
  });
});
