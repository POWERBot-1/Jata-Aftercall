/**
 * Message length, cost estimation and contact eligibility.
 *
 * The eligibility table is the product's ethical core: possession of a number is not consent, an
 * opt-out always wins, quiet hours delay rather than drop, and the frequency cap stops a business
 * from becoming a nuisance.
 */
import { describe, expect, it } from "vitest";
import { calculateSegments, DEFAULT_SMS_TARIFFS, estimateSmsCost } from "@/lib/messaging/segments";
import { evaluateEligibility, isOptOutMessage, nextPermittedSend } from "@/lib/messaging/consent";
import { renderTemplate, validateTemplate } from "@/lib/messaging/templates";

const quiet = { permittedHours: { startHour: 0, endHour: 24 } } as const;

function contact(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    name: "Jane",
    phoneNormalized: "254712345678",
    status: "ACTIVE",
    consent: { marketing: true, transactional: true },
    suppressed: false,
    ...overrides,
  };
}

describe("segments", () => {
  it("uses 160/153 septets for GSM-7 and 70/67 units for Unicode", () => {
    expect(calculateSegments("a".repeat(160)).segments).toBe(1);
    expect(calculateSegments("a".repeat(161)).segments).toBe(2);
    expect(calculateSegments("a".repeat(153)).segments).toBe(1);
    expect(calculateSegments("ж".repeat(70)).segments).toBe(1);
    expect(calculateSegments("ж".repeat(71)).segments).toBe(2);
  });

  it("counts extension characters as two septets", () => {
    expect(calculateSegments("{" + "a".repeat(159)).segments).toBe(2);
    expect(calculateSegments("{" + "a".repeat(158)).segments).toBe(1);
  });

  it("treats an emoji as two UTF-16 units", () => {
    expect(calculateSegments("😀").encoding).toBe("UCS2");
    expect(calculateSegments("😀").units).toBe(2);
  });

  it("prices per segment and per recipient from the configured tariff", () => {
    const cost = estimateSmsCost("a".repeat(161), { network: "SAFARICOM", recipientCount: 3 });
    const tariff = DEFAULT_SMS_TARIFFS.find((entry) => entry.network === "SAFARICOM")!;
    expect(cost.segments).toBe(2);
    expect(cost.totalCents).toBe(tariff.perSegmentCents * 2 * 3);
    expect(cost.verified).toBe(false);
  });
});

describe("consent eligibility", () => {
  const now = new Date("2026-10-27T10:00:00+03:00");

  it("allows a consented marketing contact inside quiet hours", () => {
    const result = evaluateEligibility({ contact: contact(), channel: "SMS", purpose: "MARKETING", now, ...quiet });
    expect(result.eligible).toBe(true);
  });

  it("refuses marketing without recorded consent even though the phone number exists", () => {
    const result = evaluateEligibility({ contact: contact({ consent: { marketing: false, transactional: true } }), channel: "SMS", purpose: "MARKETING", now, ...quiet });
    expect(result.eligible).toBe(false);
    expect(result.code).toBe("NO_MARKETING_CONSENT");
  });

  it("lets an opt-out beat a recorded consent", () => {
    const result = evaluateEligibility({ contact: contact({ suppressed: true }), channel: "SMS", purpose: "MARKETING", now, ...quiet });
    expect(result.eligible).toBe(false);
    expect(result.code).toBe("SUPPRESSED");
  });

  it("refuses an inactive or malformed contact", () => {
    expect(evaluateEligibility({ contact: contact({ status: "DELETED" }), channel: "SMS", purpose: "TRANSACTIONAL", now, ...quiet }).code).toBe("INVALID_CONTACT");
    expect(evaluateEligibility({ contact: contact({ phoneNormalized: null }), channel: "SMS", purpose: "TRANSACTIONAL", now, ...quiet }).code).toBe("INVALID_CONTACT");
  });

  it("requires transactional permission when the customer has refused service messages", () => {
    const result = evaluateEligibility({ contact: contact({ consent: { marketing: false, transactional: false } }), channel: "SMS", purpose: "TRANSACTIONAL", now, ...quiet });
    expect(result.eligible).toBe(false);
    expect(result.code).toBe("NO_TRANSACTIONAL_PERMISSION");
  });

  it("delays outside permitted hours rather than silently dropping the message", () => {
    const late = new Date("2026-10-27T22:30:00+03:00");
    const result = evaluateEligibility({ contact: contact(), channel: "SMS", purpose: "MARKETING", now: late, permittedHours: { startHour: 8, endHour: 20 } });
    expect(result.eligible).toBe(false);
    expect(result.code).toBe("OUTSIDE_PERMITTED_HOURS");
    expect(result.nextAllowedAt).toBeInstanceOf(Date);
    expect(result.nextAllowedAt!.getTime()).toBeGreaterThan(late.getTime());
  });

  it("enforces the 30-day marketing frequency cap", () => {
    const result = evaluateEligibility({ contact: contact(), channel: "SMS", purpose: "MARKETING", now, marketingMessagesLast30Days: 4, ...quiet });
    expect(result.eligible).toBe(false);
    expect(result.code).toBe("FREQUENCY_CAP_REACHED");
  });

  it("recognises whole-message opt-out keywords only", () => {
    expect(isOptOutMessage("STOP")).toBe(true);
    expect(isOptOutMessage("  unsubscribe ")).toBe(true);
    expect(isOptOutMessage("please stop by the shop")).toBe(false);
  });

  it("computes the next permitted send window in Nairobi time", () => {
    const next = nextPermittedSend(new Date("2026-10-27T21:00:00+03:00"), { startHour: 8, endHour: 20 });
    expect(next).toBeInstanceOf(Date);
    expect(next!.getTime()).toBeGreaterThan(new Date("2026-10-27T21:00:00+03:00").getTime() - 1);
  });
});

describe("templates", () => {
  it("rejects unknown placeholders rather than rendering a blank", () => {
    const result = validateTemplate({ body: "Hello {{first_name}}, you owe {{secret_field}}", channel: "SMS", category: "TRANSACTIONAL" });
    expect(result.ok).toBe(false);
    expect(result.unknownVariables).toContain("secret_field");
  });

  it("requires https links", () => {
    const result = validateTemplate({ body: "Pay here: http://insecure.example/pay", channel: "SMS", category: "TRANSACTIONAL" });
    expect(result.ok).toBe(false);
  });

  it("does not allow WhatsApp sending without an approved template", () => {
    const pending = validateTemplate({ body: "Your order is ready", channel: "WHATSAPP", category: "TRANSACTIONAL", whatsappTemplateName: "order_ready", whatsappTemplateStatus: "PENDING" });
    const approved = validateTemplate({ body: "Your order is ready", channel: "WHATSAPP", category: "TRANSACTIONAL", whatsappTemplateName: "order_ready", whatsappTemplateStatus: "APPROVED" });
    expect(pending.ok).toBe(false);
    expect(approved.ok).toBe(true);
  });

  it("warns when marketing omits the unsubscribe link", () => {
    const result = validateTemplate({ body: "Big offer this week at {{business}}", channel: "SMS", category: "MARKETING" });
    expect(result.ok).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/unsubscribe/i);
  });

  it("renders with readable fallbacks and refuses an insecure link value", () => {
    const ok = renderTemplate("Hi {{first_name}}, from {{business}}", { first_name: "", business: "Nyumbani" });
    expect(ok.body).toMatch(/Hi .*from Nyumbani/);
    expect(ok.missing).toContain("first_name");
    const bad = renderTemplate("Pay {{link}}", { link: "javascript:alert(1)" });
    expect(bad.ok).toBe(false);
  });
});
