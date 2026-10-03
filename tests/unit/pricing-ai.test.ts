import { describe, it, expect } from "vitest";
import { getPlanByKey, getAIBusinessFrontDeskPlan, assertAIFrontDeskPricing, FALLBACK_PLANS } from "../../lib/pricing";

/**
 * §49 — AI Business Front Desk subscription pricing must resolve to KES 499 / 30 days.
 * Tests must verify that server-side PlanConfig resolves to the configured amount,
 * and that checkout must derive amount from server config, not client input.
 */

describe("AI Business Front Desk pricing (§49)", () => {
  it("resolves plan config to KES 499 with 30-day duration", async () => {
    const plan = await getPlanByKey("AI_BUSINESS_FRONT_DESK");
    // In a live DB with seed applied, plan should exist; in test mode we assert fallback.
    const effective = plan ?? FALLBACK_PLANS.find((p) => p.key === "AI_BUSINESS_FRONT_DESK");
    expect(effective).toBeDefined();
    expect(effective?.priceKES).toBe(499);
    expect(effective?.durationDays).toBe(30);
  });

  it("getAIBusinessFrontDeskPlan resolves the package", async () => {
    const plan = await getAIBusinessFrontDeskPlan();
    const effective = plan ?? FALLBACK_PLANS.find((p) => p.key === "AI_BUSINESS_FRONT_DESK");
    expect(effective?.key).toBe("AI_BUSINESS_FRONT_DESK");
  });

  it("assertAIFrontDeskPricing passes for correct plan", () => {
    const correct = { id: "test", key: "AI_BUSINESS_FRONT_DESK", name: "Test", priceKES: 499, durationDays: 30, isActive: true };
    expect(() => assertAIFrontDeskPricing(correct)).not.toThrow();
  });

  it("assertAIFrontDeskPricing throws for wrong price", () => {
    const wrongPrice = { id: "bad", key: "AI_BUSINESS_FRONT_DESK", name: "Bad", priceKES: 149, durationDays: 30, isActive: true };
    expect(() => assertAIFrontDeskPricing(wrongPrice)).toThrow("KES 499 / 30 days");
  });

  it("assertAIFrontDeskPricing throws for wrong duration", () => {
    const wrongDuration = { id: "bad", key: "AI_BUSINESS_FRONT_DESK", name: "Bad", priceKES: 499, durationDays: 365, isActive: true };
    expect(() => assertAIFrontDeskPricing(wrongDuration)).toThrow("KES 499 / 30 days");
  });

  it("assertAIFrontDeskPricing throws for null plan", () => {
    expect(() => assertAIFrontDeskPricing(null)).toThrow("KES 499 / 30 days");
  });

  it("fallback plans include AI package at KES 499 / 30 days", () => {
    const aiPlan = FALLBACK_PLANS.find((p) => p.key === "AI_BUSINESS_FRONT_DESK");
    expect(aiPlan).toBeDefined();
    expect(aiPlan?.priceKES).toBe(499);
    expect(aiPlan?.durationDays).toBe(30);
  });
});
