import { describe, expect, it } from "vitest";
import {
  observeSubscriptionExpiry,
  summarizeSubscriptionExpiry,
  type LifecycleExpiryEvidence,
} from "@/lib/admin/product-expiry-grace-observation";

const now = new Date("2026-11-22T12:00:00.000Z");
const row = (overrides: Partial<LifecycleExpiryEvidence> = {}): LifecycleExpiryEvidence => ({
  product: "BUSINESS_POS",
  businessId: "biz_1",
  subscriptionId: "sub_1",
  status: "ACTIVE",
  expiresAt: new Date("2026-11-20T12:00:00.000Z"),
  graceUntil: new Date("2026-11-23T12:00:00.000Z"),
  ...overrides,
});

describe("read-only product expiry and grace observation", () => {
  it("identifies current subscriptions before their expiry", () => {
    expect(observeSubscriptionExpiry(row({ expiresAt: new Date("2026-11-24T12:00:00Z") }), now).state).toBe("CURRENT");
  });

  it("identifies grace only when an explicit grace deadline is stored", () => {
    expect(observeSubscriptionExpiry(row(), now).state).toBe("GRACE");
  });

  it("identifies expiry only after the explicit grace deadline", () => {
    expect(observeSubscriptionExpiry(row({ graceUntil: new Date("2026-11-21T12:00:00Z") }), now).state).toBe("EXPIRED");
  });

  it("does not invent a grace period when graceUntil is missing", () => {
    expect(observeSubscriptionExpiry(row({ graceUntil: null }), now).state).toBe("GRACE_POLICY_UNKNOWN");
  });

  it("flags malformed expiry timestamps and inverted grace windows for review", () => {
    expect(observeSubscriptionExpiry(row({ expiresAt: "not-a-date" as unknown as Date }), now).state).toBe("INVALID_GRACE_WINDOW");
    expect(observeSubscriptionExpiry(row({ graceUntil: new Date("2026-11-19T12:00:00Z") }), now).state).toBe("INVALID_GRACE_WINDOW");
    expect(observeSubscriptionExpiry(row({ graceUntil: "not-a-date" as unknown as Date }), now).state).toBe("INVALID_GRACE_WINDOW");
  });

  it("does not classify cancelled or suspended rows as candidates for expiry mutation", () => {
    expect(observeSubscriptionExpiry(row({ status: "CANCELLED" }), now).state).toBe("INACTIVE");
    expect(observeSubscriptionExpiry(row({ status: "SUSPENDED" }), now).state).toBe("INACTIVE");
  });

  it("keeps no-expiry rows visible without granting or revoking access", () => {
    expect(observeSubscriptionExpiry(row({ expiresAt: null, graceUntil: null }), now).state).toBe("NO_EXPIRY");
  });

  it("summarizes every product row without collapsing duplicate evidence", () => {
    const result = summarizeSubscriptionExpiry([
      row(),
      row({ subscriptionId: "sub_2", graceUntil: null }),
      row({ subscriptionId: "sub_3", status: "CANCELLED" }),
    ], now);
    expect(result.total).toBe(3);
    expect(result.counts.GRACE).toBe(1);
    expect(result.counts.GRACE_POLICY_UNKNOWN).toBe(1);
    expect(result.counts.INACTIVE).toBe(1);
  });
});
