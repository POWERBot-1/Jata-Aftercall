import { describe, expect, it } from "vitest";
import {
  PUBLISH_REQUIRES_PAYMENT,
  canSetPublished,
  hasVerifiedPublicationRight,
} from "@/lib/publication";

const in30Days = new Date(Date.now() + 30 * 86400000);
const in33Days = new Date(Date.now() + 33 * 86400000);

describe("payment-before-publication gate", () => {
  it("requires payment for publication", () => {
    expect(PUBLISH_REQUIRES_PAYMENT).toBe(true);
  });

  it("unpaid owner cannot publish", () => {
    expect(canSetPublished(true)).toBe(false);
    expect(canSetPublished(true, { verifiedPayment: false })).toBe(false);
  });

  it("verified payment permits publication", () => {
    expect(canSetPublished(true, { verifiedPayment: true })).toBe(true);
  });

  it("admin remains the operator override", () => {
    expect(canSetPublished(true, { isAdmin: true })).toBe(true);
    expect(canSetPublished(true, { isAdmin: true, verifiedPayment: false })).toBe(true);
  });

  it("unpublishing is always allowed", () => {
    expect(canSetPublished(false)).toBe(true);
    expect(canSetPublished(false, { verifiedPayment: false })).toBe(true);
    expect(canSetPublished(false, { isAdmin: true })).toBe(true);
  });

  it("rejects non-boolean publish values", () => {
    expect(canSetPublished("true" as unknown as boolean, { verifiedPayment: true })).toBe(false);
    expect(canSetPublished(1 as unknown as boolean, { isAdmin: true })).toBe(false);
  });
});

describe("hasVerifiedPublicationRight — payment evidence", () => {
  const paid = { status: "PAID" };
  const active = { status: "ACTIVE", expiresAt: in30Days, graceUntil: in33Days };

  it("accepts a verified PAID payment backing a valid ACTIVE subscription", () => {
    expect(hasVerifiedPublicationRight({ paidPayment: paid, subscription: active })).toBe(true);
  });

  it("accepts EXPIRING within the grace window", () => {
    expect(hasVerifiedPublicationRight({ paidPayment: paid, subscription: { status: "EXPIRING", expiresAt: in30Days, graceUntil: in33Days } })).toBe(true);
  });

  it("rejects when there is no payment record at all", () => {
    expect(hasVerifiedPublicationRight({ paidPayment: null, subscription: active })).toBe(false);
  });

  it("rejects a PENDING, FAILED or CANCELLED payment even with a subscription row", () => {
    for (const status of ["PENDING", "FAILED", "CANCELLED", "EXPIRED", "REFUNDED"]) {
      expect(hasVerifiedPublicationRight({ paidPayment: { status }, subscription: active }), status).toBe(false);
    }
  });

  it("rejects a PAID payment with no subscription", () => {
    expect(hasVerifiedPublicationRight({ paidPayment: paid, subscription: null })).toBe(false);
  });

  it("rejects a PAID payment with a non-active subscription (pending, cancelled, or refunded/suspended)", () => {
    for (const status of ["PENDING", "CANCELLED", "EXPIRED", "SUSPENDED"]) {
      expect(hasVerifiedPublicationRight({ paidPayment: paid, subscription: { status, expiresAt: in30Days, graceUntil: in33Days } }), status).toBe(false);
    }
  });

  it("rejects an ACTIVE subscription backed by no PAID payment", () => {
    expect(hasVerifiedPublicationRight({ paidPayment: { status: "PENDING" }, subscription: active })).toBe(false);
    expect(hasVerifiedPublicationRight({ paidPayment: null, subscription: active })).toBe(false);
  });

  it("rejects once past the grace window", () => {
    const past = new Date(Date.now() - 86400000);
    expect(hasVerifiedPublicationRight({ paidPayment: paid, subscription: { status: "ACTIVE", expiresAt: past, graceUntil: past } })).toBe(false);
  });

  it("allows within grace even after expiresAt", () => {
    const yesterday = new Date(Date.now() - 86400000);
    expect(hasVerifiedPublicationRight({ paidPayment: paid, subscription: { status: "ACTIVE", expiresAt: yesterday, graceUntil: in33Days } })).toBe(true);
  });

  it("falls back to expiresAt when graceUntil is missing", () => {
    expect(hasVerifiedPublicationRight({ paidPayment: paid, subscription: { status: "ACTIVE", expiresAt: in30Days } })).toBe(true);
    const past = new Date(Date.now() - 86400000);
    expect(hasVerifiedPublicationRight({ paidPayment: paid, subscription: { status: "ACTIVE", expiresAt: past } })).toBe(false);
  });
});
