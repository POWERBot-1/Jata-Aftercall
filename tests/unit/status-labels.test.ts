/**
 * Status labels (§27, §28, §29, §45)
 *
 * Owners never see raw enum values, and the tone of each state tells them whether to act.
 */

import { describe, expect, it } from "vitest";
import {
  bookingStatusLabel,
  entitlementStatusLabel,
  experienceStatusLabel,
  orderStatusLabel,
  paymentStatusLabel,
  subscriptionStatusLabel,
  toneClass,
} from "@/lib/statusLabels";

describe("operational status labels", () => {
  it("labels order stages for the owner", () => {
    expect(orderStatusLabel("NEW").label).toBe("New");
    expect(orderStatusLabel("READY").label).toBe("Ready");
    expect(orderStatusLabel("REFUNDED").label).toBe("Refunded");
    expect(orderStatusLabel("NONSENSE").label).toBe("Unknown");
  });

  it("labels booking states, including a no-show", () => {
    expect(bookingStatusLabel("PENDING").label).toBe("Pending");
    expect(bookingStatusLabel("NO_SHOW").label).toBe("No show");
    expect(bookingStatusLabel("NO_SHOW").tone).toBe("error");
  });

  it("labels entitlement states without exposing internals", () => {
    expect(entitlementStatusLabel("ACTIVE").label).toBe("Active");
    expect(entitlementStatusLabel("PAST_DUE").label).toBe("Past due");
    expect(entitlementStatusLabel(null).label).toBe("No package");
    expect(entitlementStatusLabel("EXPIRED").tone).toBe("error");
  });

  it("labels draft vs published websites", () => {
    expect(experienceStatusLabel("PUBLISHED").label).toBe("Live");
    expect(experienceStatusLabel("DRAFT").label).toBe("Draft");
    expect(experienceStatusLabel("UNPUBLISHED").label).toBe("Hidden");
  });

  it("keeps the existing labels intact", () => {
    expect(subscriptionStatusLabel("ACTIVE").label).toBe("Active");
    expect(paymentStatusLabel("PAID").label).toBe("Paid");
    expect(toneClass("success")).toContain("emerald");
  });
});
