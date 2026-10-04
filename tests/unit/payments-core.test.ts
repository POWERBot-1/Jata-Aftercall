/**
 * The parts of the JATA Payment Wallet that must be right before anything else is: money, states,
 * ids, destination identification and the honesty of capability claims.
 *
 * These are the invariants the spec calls non-negotiable: integer minor units (never a float),
 * a state machine instead of a boolean, tenant-scoped references, and no capability shown unless
 * the provider and JATA's own connector can actually deliver it (§8, §24, §33, §52, §88, §120).
 */

import { describe, expect, it } from "vitest";
import {
  decimalStringToMinor,
  formatKES,
  isValidPhoneKE,
  kesToMinor,
  maskDestination,
  maskPhone,
  minorToKes,
  normalizePhoneKE,
  sumMinor,
  toMinor,
} from "@/lib/payments/money";
import {
  canBeRefunded,
  canStillBeConfirmed,
  canTransition,
  isPaidStatus,
  isPaymentStatus,
  nextStates,
  paymentStatusLabel,
  PAYMENT_STATUSES,
} from "@/lib/payments/states";
import { idempotencyKeyFor, jataPaymentId, providerReferenceFor, receiptToken } from "@/lib/payments/ids";
import {
  effectiveCapabilities,
  identifyDestination,
  routeDestination,
  validateDestination,
} from "@/lib/payments/destinations";
import { capabilityClaimsFor, destinationView } from "@/lib/payments/wallet";
import { PROVIDER_CAPABILITIES } from "@/lib/payments/types";
import { isOk } from "@/lib/payments/result";

describe("money is integer minor units (§24)", () => {
  it("converts KES to cents without floating point drift", () => {
    expect(kesToMinor(499)).toBe(49_900);
    expect(kesToMinor(0.1 + 0.2)).toBe(30);
    expect(kesToMinor(1234.56)).toBe(123_456);
    expect(minorToKes(49_900)).toBe(499);
    expect(sumMinor([10, 20, 30])).toBe(60);
  });

  it("never invents fractions of a cent", () => {
    expect(kesToMinor(1.005)).toBe(100);
    expect(kesToMinor(-5)).toBe(-500);
    expect(decimalStringToMinor("1234.567")).toBe(123_457);
    expect(decimalStringToMinor("1234.56")).toBe(123_456);
    expect(decimalStringToMinor("nonsense")).toBeNull();
    expect(toMinor(499, "KES")).toBe(49_900);
    expect(formatKES(499)).toContain("499");
  });

  it("masks anything a customer typed so a screen or a log never shows it whole", () => {
    expect(maskDestination("4123456", "TILL")).toBe("TILL •••3456");
    expect(maskPhone("0712345678")).not.toBe("0712345678");
    expect(maskPhone("0712345678")).toContain("678");
    expect(isValidPhoneKE("0712345678")).toBe(true);
    expect(isValidPhoneKE("254712345678")).toBe(true);
    expect(normalizePhoneKE("0712345678")).toBe("254712345678");
    expect(normalizePhoneKE("123")).toBeNull();
  });
});

describe("payments move through states, never through a boolean (§23, §33)", () => {
  it("knows every state the schema defines", () => {
    for (const status of PAYMENT_STATUSES) {
      expect(isPaymentStatus(status)).toBe(true);
      expect(paymentStatusLabel(status).length).toBeGreaterThan(2);
    }
    expect(isPaymentStatus("PAID_BY_CUSTOMER_SAYS_SO")).toBe(false);
  });

  it("allows only the transitions the machine defines", () => {
    expect(canTransition("CREATED", "PAYMENT_REQUESTED")).toBe(true);
    expect(canTransition("PENDING", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "PAID")).toBe(true);
    expect(canTransition("PAID", "PARTIALLY_REFUNDED")).toBe(true);
    expect(canTransition("PAID", "PENDING")).toBe(false);
    expect(canTransition("FAILED", "PAID")).toBe(false);
    expect(nextStates("PAID")).toContain("PARTIALLY_REFUNDED");
  });

  it("treats only provider-confirmed states as money received", () => {
    expect(isPaidStatus("PAID")).toBe(true);
    expect(isPaidStatus("CONFIRMED")).toBe(false);
    expect(isPaidStatus("PENDING")).toBe(false);
    expect(canStillBeConfirmed("EXPIRED")).toBe(true);
    expect(canStillBeConfirmed("PAID")).toBe(false);
    expect(canBeRefunded("PAID")).toBe(true);
    expect(canBeRefunded("FULLY_REFUNDED")).toBe(false);
  });
});

describe("references (§32, §33, §64)", () => {
  it("builds a merchant-readable payment id that does not collide", () => {
    const first = jataPaymentId(1048, new Date("2026-10-04T10:00:00Z"));
    const second = jataPaymentId(1049, new Date("2026-10-04T10:00:00Z"));
    expect(first).toMatch(/^JTP-20261004-1048-[A-Z0-9]+$/);
    expect(first).not.toBe(second);
  });

  it("derives an idempotency key per tenant, scope and request", () => {
    const base = { businessId: "bizA", scope: "pos:sale", requestKey: "till-tap-1" };
    expect(idempotencyKeyFor(base)).toBe(idempotencyKeyFor({ ...base }));
    expect(idempotencyKeyFor(base)).not.toBe(idempotencyKeyFor({ ...base, businessId: "bizB" }));
    expect(providerReferenceFor("JTP-1", "MPESA")).toContain("JTP-1");
  });

  it("issues receipt tokens that cannot be guessed", () => {
    const token = receiptToken();
    expect(token.length).toBeGreaterThanOrEqual(24);
    expect(receiptToken()).not.toBe(token);
  });
});

describe("destination identification (§11, §16, §38)", () => {
  it("recognises what a merchant actually types", () => {
    const till = identifyDestination({ kind: "MPESA_TILL", providerDestinationId: "4123456" });
    expect(till.ok).toBe(true);
    if (!isOk(till)) return;
    expect(till.draft.provider).toBe("MPESA");
    expect(till.draft.providerDestinationId).toBe("4123456");

    const paybill = identifyDestination({ kind: "MPESA_PAYBILL", providerDestinationId: "247247", providerAccountRef: "ACC-123" });
    expect(isOk(paybill)).toBe(true);
    if (!isOk(paybill)) return;
    expect(paybill.draft.providerAccountRef).toBe("ACC-123");

    const bank = identifyDestination({ kind: "BANK_ACCOUNT", providerDestinationId: "0123456789", bankName: "Equity", accountName: "Nyumbani Kitchen Ltd" });
    expect(isOk(bank)).toBe(true);
    if (!isOk(bank)) return;
    expect(bank.draft.provider).toBe("BANK");

    expect(isOk(validateDestination({ kind: "PAYSTACK", providerDestinationId: "acct_123" }))).toBe(true);
  });

  it("refuses nonsense in plain language instead of passing it to a provider", () => {
    const missing = identifyDestination({ kind: "MPESA_TILL", providerDestinationId: "" });
    expect(isOk(missing)).toBe(false);
    if (isOk(missing)) return;
    expect(missing.message).toMatch(/till number/i);

    const unknownKind = identifyDestination({ kind: "CRYPTO", providerDestinationId: "abc" });
    expect(isOk(unknownKind)).toBe(false);
    if (isOk(unknownKind)) return;
    expect(unknownKind.code).toBe("KIND_REQUIRED");

    const tooShort = identifyDestination({ kind: "MPESA_TILL", providerDestinationId: "12" });
    expect(isOk(tooShort)).toBe(false);
  });

  it("routes to the primary destination, or the one the till named — and only from this tenant's list", () => {
    // `routeDestination` is handed a list that is already tenant-scoped (`listDestinations`), so a
    // destination id from another business simply is not in it — and is refused (§5, §75).
    const mine = [
      { id: "d1", businessId: "bizA", isActive: true, isPrimary: false, provider: "MPESA" },
      { id: "d2", businessId: "bizA", isActive: true, isPrimary: true, provider: "MPESA" },
    ] as never[];
    const primary = routeDestination(mine);
    expect(isOk(primary)).toBe(true);
    if (isOk(primary)) expect(primary.destination.id).toBe("d2");

    const requested = routeDestination(mine, "d1");
    expect(isOk(requested)).toBe(true);
    if (isOk(requested)) expect(requested.destination.id).toBe("d1");

    const foreign = routeDestination(mine, "d_of_another_business");
    expect(isOk(foreign)).toBe(false);

    const none = routeDestination([]);
    expect(isOk(none)).toBe(false);
    if (!isOk(none)) expect(none.code).toBe("NO_DESTINATION");
  });
});

describe("JATA only claims what a destination can really do (§8, §52, §88, §120)", () => {
  const everything = [...PROVIDER_CAPABILITIES];

  it("strips capability down when JATA's own connector is not configured", () => {
    const capped = effectiveCapabilities({ providerCapabilities: everything, connectorReady: false, verificationLevel: "FORMAT" });
    expect(capped).toEqual(["PAYMENT_INSTRUCTIONS"]);
    expect(capped).not.toContain("REAL_TIME_CONFIRMATION");
  });

  it("does not claim real-time confirmation for a destination that was only format-checked", () => {
    const capped = effectiveCapabilities({ providerCapabilities: everything, connectorReady: true, verificationLevel: "FORMAT" });
    expect(capped).not.toContain("REAL_TIME_CONFIRMATION");
    expect(capped).not.toContain("WEBHOOKS");
    expect(capped).not.toContain("REFUNDS");
    expect(capped).toContain("PAYMENT_INSTRUCTIONS");
    expect(capabilityClaimsFor(capped).find((claim) => claim.label === "Payment instructions")?.available).toBe(true);
  });

  it("claims automatic confirmation only once the destination is live-verified", () => {
    const capped = effectiveCapabilities({ providerCapabilities: everything, connectorReady: true, verificationLevel: "LIVE" });
    expect(capped).toContain("REAL_TIME_CONFIRMATION");
    expect(capped).toContain("REFUNDS");
    const claims = capabilityClaimsFor(capped);
    expect(claims.find((claim) => claim.label === "Real-time confirmation")?.available).toBe(true);
  });

  it("says plainly that a manually confirmed destination is not automatic", () => {
    const claims = capabilityClaimsFor(["PAYMENT_INSTRUCTIONS"]);
    expect(claims.find((claim) => claim.label === "Real-time confirmation")?.available).toBe(false);
    expect(claims.find((claim) => claim.label === "Payment instructions")?.available).toBe(true);

    const view = destinationView({
      id: "d1",
      kind: "BANK_ACCOUNT",
      provider: "BANK",
      providerDestinationId: "0123456789",
      bankName: "Equity",
      providerAccountRef: "",
      status: "UNAVAILABLE",
      capabilities: ["PAYMENT_INSTRUCTIONS"],
      verificationSource: "FORMAT",
    });
    expect(view.statusLabel).toBe("NOT AVAILABLE");
    expect(view.automaticConfirmation).toBe(false);
    expect(view.label).toContain("6789");
    expect(view.label).not.toContain("0123456789");
  });
});
