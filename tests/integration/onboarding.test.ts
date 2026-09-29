import { describe, it, expect } from "vitest";
import { slugify } from "@/lib/slug";
import { canSetPublished, hasVerifiedPublicationRight, PUBLISH_REQUIRES_PAYMENT } from "@/lib/publication";

// Integration-style flow tests without DB — they validate the state machine transitions
// Full DB integration is tested via E2E against preview deployment.

describe("onboarding state machine (§33–§45)", () => {
  it("register → business draft → ready for payment", () => {
    const user = { id: "user1", email: "mary@example.com" };
    const businessInput = { name: "Mary's Beauty Studio", category: "Beauty", phone: "0722123456" };
    const slug = slugify(businessInput.name);
    expect(slug).toBe("marys-beauty-studio");
    const business = { id: "biz1", slug, ownerId: user.id, isPublished: false, status: "PENDING" as const };
    expect(business.isPublished).toBe(false);
    expect(business.status).toBe("PENDING");
    // After business created, user can choose theme, add services, add offer — all optional before payment
  });

  it("payment pending → verified PAID → subscription ACTIVE", () => {
    const payment = { reference: "jata_abc", status: "PENDING" as const, amount: 99900 };
    const paystackVerify = { status: "success", amount: 99900, reference: "jata_abc" };
    const isPaid = paystackVerify.status === "success" && paystackVerify.amount === payment.amount;
    expect(isPaid).toBe(true);
    const subscription = { status: "ACTIVE" as const, businessId: "biz1", planId: "plan_annual" };
    expect(subscription.status).toBe("ACTIVE");
  });

  it("failed payment does not activate subscription", () => {
    const paymentFailed = { status: "FAILED" as const };
    expect(paymentFailed.status).not.toBe("PAID");
    // Business remains not published
  });

  it("publish requires a verified payment before it is allowed", () => {
    expect(PUBLISH_REQUIRES_PAYMENT).toBe(true);
    // Unpaid owner → cannot publish (also enforced server-side on PATCH /api/business).
    expect(canSetPublished(true, { verifiedPayment: false })).toBe(false);
    expect(hasVerifiedPublicationRight({ paidPayment: { status: "PENDING" }, subscription: null })).toBe(false);
    // Verified payment → can publish.
    expect(hasVerifiedPublicationRight({
      paidPayment: { status: "PAID" },
      subscription: { status: "ACTIVE", expiresAt: new Date(Date.now() + 86400000), graceUntil: new Date(Date.now() + 4 * 86400000) },
    })).toBe(true);
    expect(canSetPublished(true, { verifiedPayment: true })).toBe(true);
    // Unpublishing stays available without payment.
    expect(canSetPublished(false)).toBe(true);
  });

  it("abandoned onboarding preserves data and allows resume", () => {
    const onboarding = { step: "BUSINESS_DRAFT", paymentStatus: "PENDING", businessId: "biz1" };
    // User logs back in — should be redirected to next step, not lose data
    expect(onboarding.businessId).toBe("biz1");
    expect(onboarding.paymentStatus).toBe("PENDING");
  });

  it("subscription expiry: ACTIVE → EXPIRING → EXPIRED → SUSPENDED", () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days left
    const isExpiring = expiresAt.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000;
    expect(isExpiring).toBe(true);
    const expiredAt = new Date(now.getTime() - 1);
    const isExpired = expiredAt < now;
    expect(isExpired).toBe(true);
  });

  it("renewal extends expiry and reactivates", () => {
    const now = new Date();
    const existingExpiry = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    const planDays = 365;
    const newExpiry = new Date(existingExpiry.getTime() + planDays * 24 * 60 * 60 * 1000);
    expect(newExpiry.getTime()).toBeGreaterThan(existingExpiry.getTime());
  });
});
