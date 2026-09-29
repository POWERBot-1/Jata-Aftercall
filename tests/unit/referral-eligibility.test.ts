import { describe, expect, it } from "vitest";
import { isAttributionClaimable, isReferrerEligible, type ReferralRow, type ReferrerSnapshot } from "@/lib/referral";

const published: ReferrerSnapshot = {
  businessId: "biz-a",
  businessName: "Mary's Beauty Studio",
  ownerId: "user-a",
  ownerEmail: "mary@example.test",
  ownerPhone: "0722123456",
  isPublished: true,
  status: "ACTIVE",
};

describe("referrer eligibility", () => {
  it("accepts an existing, published, non-suspended referrer", () => {
    expect(isReferrerEligible({ referrer: published })).toEqual({ eligible: true, reason: "ok" });
  });

  it("rejects a nonexistent referrer (code not found)", () => {
    expect(isReferrerEligible({ referrer: null })).toEqual({ eligible: false, reason: "referrer_not_found" });
  });

  it("rejects an unpublished referrer", () => {
    expect(isReferrerEligible({ referrer: { ...published, isPublished: false } })).toEqual({ eligible: false, reason: "referrer_unpublished" });
  });

  it("rejects a suspended referrer", () => {
    expect(isReferrerEligible({ referrer: { ...published, status: "SUSPENDED" } })).toEqual({ eligible: false, reason: "referrer_suspended" });
  });

  it("rejects a referrer business whose owner is missing", () => {
    expect(isReferrerEligible({ referrer: { ...published, ownerId: "" } })).toEqual({ eligible: false, reason: "referrer_owner_missing" });
  });

  it("rejects a self-referral when the visitor is the referrer owner", () => {
    expect(isReferrerEligible({ referrer: published, viewerId: "user-a" })).toEqual({ eligible: false, reason: "self_referral" });
    expect(isReferrerEligible({ referrer: published, viewerId: "user-b" })).toEqual({ eligible: true, reason: "ok" });
    expect(isReferrerEligible({ referrer: published, viewerId: null })).toEqual({ eligible: true, reason: "ok" });
  });

  it("treats a non-boolean isPublished as unpublished", () => {
    expect(isReferrerEligible({ referrer: { ...published, isPublished: undefined as unknown as boolean } })).toEqual({
      eligible: false,
      reason: "referrer_unpublished",
    });
  });
});

describe("attribution claimability", () => {
  const future = new Date(Date.now() + 86400000);
  const past = new Date(Date.now() - 86400000);

  const makeRow = (overrides: Partial<ReferralRow> = {}): ReferralRow => ({
    id: "ref-1",
    code: "ABC123",
    referrerUserId: "user-a",
    referrerBusinessId: "biz-a",
    referredUserId: null,
    referredBusinessId: null,
    status: "PENDING",
    tokenHash: "hash",
    rejectReason: null,
    expiresAt: future,
    convertedAt: null,
    ...overrides,
  });

  it("accepts an unexpired PENDING attribution", () => {
    expect(isAttributionClaimable(makeRow())).toEqual({ eligible: true, reason: "ok" });
  });

  it("rejects a missing attribution", () => {
    expect(isAttributionClaimable(null)).toEqual({ eligible: false, reason: "attribution_invalid" });
  });

  it("rejects an already converted or rejected attribution (repeated attempts)", () => {
    expect(isAttributionClaimable(makeRow({ status: "CONVERTED" }))).toEqual({ eligible: false, reason: "attribution_claimed" });
    expect(isAttributionClaimable(makeRow({ status: "REJECTED" }))).toEqual({ eligible: false, reason: "attribution_claimed" });
    expect(isAttributionClaimable(makeRow({ status: "EXPIRED" }))).toEqual({ eligible: false, reason: "attribution_claimed" });
  });

  it("rejects an expired attribution", () => {
    expect(isAttributionClaimable(makeRow({ expiresAt: past }))).toEqual({ eligible: false, reason: "attribution_expired" });
  });

  it("rejects an attribution that expires exactly now", () => {
    const now = new Date("2026-09-29T10:00:00.000Z");
    expect(isAttributionClaimable(makeRow({ expiresAt: now }), now)).toEqual({ eligible: false, reason: "attribution_expired" });
  });
});
