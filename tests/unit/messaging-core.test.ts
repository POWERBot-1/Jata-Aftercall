/**
 * Messaging engine — segmentation, consent, templates, Sender ID lifecycle, wallet and import.
 *
 * These are the rules that keep a bulk-SMS product honest: the cost quoted is the cost billed, a
 * number is never treated as consent, quiet hours delay rather than drop, a Sender ID cannot
 * approve itself, and money only moves against a verified reference.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "@/tests/helpers/posFakeDb";
import { erpSeed } from "@/tests/helpers/erpSeed";
import { calculateSegments, DEFAULT_SMS_TARIFFS, estimateSmsCost } from "@/lib/messaging/segments";
import { evaluateEligibility, isOptOutMessage } from "@/lib/messaging/consent";
import { renderTemplate, validateTemplate } from "@/lib/messaging/templates";
import {
  applySenderIdOutcome,
  canTransitionSender,
  kycRequirements,
  replyCapability,
  senderIdCanSend,
  submitSenderApplication,
  validateSenderIdName,
} from "@/lib/messaging/senderId";
import { creditWallet, releaseReserved, reserveFunds, walletSummary } from "@/lib/messaging/billing";
import { commitImport, guessMapping, parseCsv, validateImportRows } from "@/lib/messaging/import";

const NOW = new Date("2026-10-27T07:00:00Z"); // 10:00 in Nairobi
let fake: FakeDb;

beforeEach(() => {
  fake = createFakeDb(erpSeed());
});

function consent(overrides: Partial<{ marketing: boolean; transactional: boolean; suppressed: boolean }> = {}) {
  return {
    contact: {
      id: "ct_a1",
      name: "Jane",
      phoneNormalized: "254712111111",
      status: "ACTIVE",
      consent: { marketing: overrides.marketing ?? true, transactional: overrides.transactional ?? true },
      suppressed: overrides.suppressed ?? false,
    },
    channel: "SMS" as const,
    purpose: "MARKETING" as const,
    now: NOW,
  };
}

describe("segmentation", () => {
  it("bills 160 GSM characters as one segment and 161 as two", () => {
    expect(calculateSegments("a".repeat(160)).segments).toBe(1);
    expect(calculateSegments("a".repeat(161)).segments).toBe(2);
    expect(calculateSegments("a".repeat(306)).segments).toBe(2);
    expect(calculateSegments("a".repeat(307)).segments).toBe(3);
  });

  it("counts an extension character twice", () => {
    expect(calculateSegments("{" + "a".repeat(158)).units).toBe(160);
    expect(calculateSegments("{" + "a".repeat(158)).segments).toBe(1);
    expect(calculateSegments("{" + "a".repeat(159)).segments).toBe(2);
  });

  it("switches the whole message to UCS-2 when one emoji is present", () => {
    const result = calculateSegments("Hello 😀");
    expect(result.encoding).toBe("UCS2");
    expect(result.segments).toBe(1);
    expect(calculateSegments("😀".repeat(36)).segments).toBe(2); // 72 UTF-16 units
  });

  it("prices segments times recipients from a tariff marked unverified", () => {
    const cost = estimateSmsCost("a".repeat(161), { network: "SAFARICOM", recipientCount: 10 });
    const rate = DEFAULT_SMS_TARIFFS.find((entry) => entry.network === "SAFARICOM")!.perSegmentCents;
    expect(cost.segments).toBe(2);
    expect(cost.totalCents).toBe(rate * 2 * 10);
    expect(cost.verified).toBe(false);
  });
});

describe("consent", () => {
  it("mails a consented contact inside permitted hours", () => {
    expect(evaluateEligibility(consent()).eligible).toBe(true);
  });

  it("never treats possession of a phone number as marketing consent", () => {
    const result = evaluateEligibility(consent({ marketing: false }));
    expect(result.eligible).toBe(false);
    expect(result.code).toBe("NO_MARKETING_CONSENT");
  });

  it("lets a suppression beat a recorded consent", () => {
    const result = evaluateEligibility(consent({ suppressed: true }));
    expect(result.code).toBe("SUPPRESSED");
  });

  it("requires an explicit transactional opt-in when the customer refused service messages", () => {
    const result = evaluateEligibility({ ...consent({ transactional: false }), purpose: "TRANSACTIONAL" });
    expect(result.eligible).toBe(false);
    expect(result.code).toBe("NO_TRANSACTIONAL_PERMISSION");
  });

  it("delays outside 08:00–20:00 Nairobi instead of dropping the message", () => {
    const late = new Date("2026-10-27T18:30:00Z"); // 21:30 Nairobi
    const result = evaluateEligibility({ ...consent(), now: late });
    expect(result.eligible).toBe(false);
    expect(result.code).toBe("OUTSIDE_PERMITTED_HOURS");
    expect(result.nextAllowedAt!.getTime()).toBeGreaterThan(late.getTime());
  });

  it("caps marketing at four messages in a rolling 30 days", () => {
    const result = evaluateEligibility({ ...consent(), marketingMessagesLast30Days: 4 });
    expect(result.eligible).toBe(false);
    expect(result.code).toBe("FREQUENCY_CAP_REACHED");
  });

  it("rejects a malformed or removed contact", () => {
    expect(evaluateEligibility({ ...consent(), contact: { ...consent().contact, phoneNormalized: "" } }).code).toBe("INVALID_CONTACT");
    expect(evaluateEligibility({ ...consent(), contact: { ...consent().contact, status: "DELETED" } }).code).toBe("INVALID_CONTACT");
  });

  it("recognises opt-out keywords only as a whole message", () => {
    expect(isOptOutMessage("STOP")).toBe(true);
    expect(isOptOutMessage("stop")).toBe(true);
    expect(isOptOutMessage("UNSUBSCRIBE")).toBe(true);
    expect(isOptOutMessage("stop by the shop at 5")).toBe(false);
  });
});

describe("templates", () => {
  it("rejects unknown placeholders and insecure links", () => {
    expect(validateTemplate({ body: "Hi {{frist_name}}", channel: "SMS", category: "TRANSACTIONAL" }).ok).toBe(false);
    expect(validateTemplate({ body: "Pay at http://insecure.example", channel: "SMS", category: "TRANSACTIONAL" }).ok).toBe(false);
    expect(validateTemplate({ body: "Pay at https://pay.example/123", channel: "SMS", category: "TRANSACTIONAL" }).ok).toBe(true);
  });

  it("will not send WhatsApp without an approved template", () => {
    const base = { body: "Your order {{order_number}} is ready", channel: "WHATSAPP" as const, category: "TRANSACTIONAL" as const };
    expect(validateTemplate(base).ok).toBe(false);
    expect(validateTemplate({ ...base, whatsappTemplateName: "order_ready", whatsappTemplateStatus: "PENDING" }).ok).toBe(false);
    expect(validateTemplate({ ...base, whatsappTemplateName: "order_ready", whatsappTemplateStatus: "APPROVED" }).ok).toBe(true);
  });

  it("warns when marketing copy has no unsubscribe link or reads like an advert in a transactional message", () => {
    const marketing = validateTemplate({ body: "Big offer this week at {{business}}", channel: "SMS", category: "MARKETING" });
    expect(marketing.warnings.join(" ")).toMatch(/unsubscribe/i);

    const transactional = validateTemplate({ body: "Your invoice is due — 20% off if you pay today", channel: "SMS", category: "TRANSACTIONAL" });
    expect(transactional.warnings.join(" ")).toMatch(/promotion/i);
  });

  it("renders fallbacks instead of the word undefined", () => {
    const rendered = renderTemplate("Hi {{first_name}}, thanks from {{business}}", { business: "Nyumbani" });
    expect(rendered.body).toContain("Nyumbani");
    expect(rendered.body.toLowerCase()).not.toContain("undefined");
    expect(rendered.missing).toContain("first_name");
  });
});

describe("Sender ID lifecycle", () => {
  it("validates the name format before submission without claiming approval", () => {
    expect(validateSenderIdName("NYUMBANI").ok).toBe(true);
    expect(validateSenderIdName("AB").ok).toBe(false);
    expect(validateSenderIdName("0712345678").ok).toBe(false);
    expect(validateSenderIdName("KRA").ok).toBe(false);
    expect(validateSenderIdName("NYUMBANI").preliminary).toBe(true);
  });

  it("never lets a customer approve or activate its own Sender ID", () => {
    expect(canTransitionSender("SUBMITTED", "APPROVED", "CUSTOMER").allowed).toBe(false);
    expect(canTransitionSender("UNDER_REVIEW", "ACTIVE", "CUSTOMER").allowed).toBe(false);
    expect(canTransitionSender("SUBMITTED", "UNDER_REVIEW", "PROVIDER").allowed).toBe(true);
  });

  it("blocks submission until every KYC item and the fee acknowledgement are present", async () => {
    fake.rows("msgSenderId").find((row) => row.id === "snd_a2")!.status = "READY_TO_SUBMIT";
    const requirements = kycRequirements("SMS");

    const missing = await submitSenderApplication(fake.db, {
      businessId: "bizA",
      senderIdId: "snd_a2",
      requirements,
      provided: ["kra_pin"],
      businessProfileComplete: true,
      feeAcknowledged: true,
    });
    expect(missing.ok).toBe(false);
    expect(missing.missing.length).toBeGreaterThan(0);

    const unacknowledged = await submitSenderApplication(fake.db, {
      businessId: "bizA",
      senderIdId: "snd_a2",
      requirements,
      provided: requirements.map((requirement) => requirement.key),
      businessProfileComplete: true,
      feeAcknowledged: false,
    });
    expect(unacknowledged.ok).toBe(false);
    expect(unacknowledged.message).toMatch(/fees/i);

    // The application is saved, not lost: the first attempt put it into INFORMATION_REQUIRED and
    // refusing the unacknowledged second attempt does not reset the checklist state.
    expect(fake.rows("msgSenderId").find((row) => row.id === "snd_a2")!.status).toBe("INFORMATION_REQUIRED");
  });

  it("records a submission with the provider reference and an audit event", async () => {
    fake.rows("msgSenderId").find((row) => row.id === "snd_a2")!.status = "READY_TO_SUBMIT";
    const result = await submitSenderApplication(fake.db, {
      businessId: "bizA",
      senderIdId: "snd_a2",
      requirements: kycRequirements("SMS"),
      provided: kycRequirements("SMS").map((requirement) => requirement.key),
      businessProfileComplete: true,
      feeAcknowledged: true,
      provider: { submitApplication: async () => ({ ok: true, reference: "PRV-88" }) },
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("SUBMITTED");
    expect(result.reference).toBe("PRV-88");
    expect(fake.rows("msgSenderIdEvent")).toHaveLength(1);
  });

  it("requires a note for a manual admin decision", async () => {
    await expect(
      applySenderIdOutcome(fake.db, { businessId: "bizA", senderIdId: "snd_a2", status: "UNDER_REVIEW", actor: "ADMIN" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("only sends from an ACTIVE Sender ID and says when it cannot", () => {
    expect(senderIdCanSend({ status: "ACTIVE" }).ok).toBe(true);
    const pending = senderIdCanSend({ status: "SUBMITTED" });
    expect(pending.ok).toBe(false);
    expect(senderIdCanSend(null).ok).toBe(false);
  });

  it("states that an alphanumeric Sender ID is outbound-only", () => {
    const sms = replyCapability({ channel: "SMS", replyCapable: false });
    expect(sms.twoWay).toBe(false);
    expect(sms.note).toMatch(/outbound/i);
    expect(replyCapability({ channel: "WHATSAPP" }).twoWay).toBe(true);
  });
});

describe("wallet", () => {
  it("requires a verified reference and an idempotency key", async () => {
    await expect(creditWallet(fake.db, { businessId: "bizA", amountCents: 1000, idempotencyKey: "k1", reference: "" })).rejects.toMatchObject({
      code: "REFERENCE_REQUIRED",
    });
    await expect(creditWallet(fake.db, { businessId: "bizA", amountCents: 1000, idempotencyKey: "", reference: "MPESA-123" })).rejects.toMatchObject({
      code: "IDEMPOTENCY_REQUIRED",
    });
  });

  it("credits once for a repeated key", async () => {
    const input = { businessId: "bizA", amountCents: 5000, idempotencyKey: "topup-1", reference: "MPESA-123" };
    await creditWallet(fake.db, input);
    const again = await creditWallet(fake.db, input);
    expect(again.idempotent).toBe(true);
    expect((await walletSummary(fake.db, "bizA")).balanceCents).toBe(105_000);
  });

  it("reserves without spending, and refuses to overspend", async () => {
    const reserved = await reserveFunds(fake.db, { businessId: "bizA", amountCents: 30_000, campaignId: "camp1", idempotencyKey: "res-1" });
    expect(reserved.reserved).toBe(30_000);
    const summary = await walletSummary(fake.db, "bizA");
    expect(summary.balanceCents).toBe(100_000);
    expect(summary.availableCents).toBe(70_000);

    await expect(
      reserveFunds(fake.db, { businessId: "bizA", amountCents: 80_000, campaignId: "camp2", idempotencyKey: "res-2" }),
    ).rejects.toMatchObject({ status: 402 });
  });

  it("releases a reservation for a skipped recipient", async () => {
    await reserveFunds(fake.db, { businessId: "bizA", amountCents: 1000, campaignId: "camp1", idempotencyKey: "res-1" });
    await releaseReserved(fake.db, { businessId: "bizA", campaignId: "camp1", amountCents: 1000, idempotencyKey: "rel-1" });
    const summary = await walletSummary(fake.db, "bizA");
    expect(summary.reservedCents).toBe(0);
    expect(summary.balanceCents).toBe(100_000);
  });
});

describe("contact import", () => {
  const csv = [
    "name,phone,email,tags,consent,consent source",
    'Jane Wanjiku,0712 999 888,jane@example.com,vip;loyal,yes,In-store form 2026-10',
    "Tom Otieno,0733 111 222,,,no,",
    "Broken,+254 712 000 000,,,,",
    "Jane Again,0712999888,,,yes,Duplicate",
  ].join("\n");

  it("parses quoted CSV and guesses the columns", () => {
    const parsed = parseCsv(csv);
    expect(parsed.headers[0]).toBe("name");
    expect(parsed.rows).toHaveLength(4);
    const mapping = guessMapping(parsed.headers);
    expect(mapping.phone).toBeGreaterThanOrEqual(0);
    expect(mapping.consent).toBeGreaterThanOrEqual(0);
  });

  it("normalises numbers, reports duplicates and only records consent with a source", () => {
    const parsed = parseCsv(csv);
    const preview = validateImportRows({
      headers: parsed.headers,
      rows: parsed.rows,
      mapping: guessMapping(parsed.headers),
      existingPhones: ["254733111222"],
    });
    expect(preview.candidates.map((candidate) => candidate.phone)).toEqual(["254712999888", "254712000000"]);
    expect(preview.candidates[0].consent).toBe(true);
    expect(preview.duplicatesInFile.length).toBe(1); // Jane Again
    expect(preview.duplicatesExisting.length).toBe(1); // Tom already a contact
    expect(preview.consentGranted).toBe(1);
  });

  it("writes contacts and consent records tenant-scoped", async () => {
    const parsed = parseCsv(csv);
    const preview = validateImportRows({ headers: parsed.headers, rows: parsed.rows, mapping: guessMapping(parsed.headers), existingPhones: [] });
    const result = await commitImport(fake.db, { businessId: "bizA", preview, actorId: "userA" });

    expect(result.imported).toBeGreaterThan(0);
    expect(fake.rows("msgContact").filter((row) => row.businessId === "bizA").length).toBeGreaterThan(3);
    const consentRows = fake.rows("msgConsentRecord").filter((row) => row.source === "IMPORT");
    expect(consentRows.length).toBe(result.consentRecorded);
    expect(consentRows.every((row) => row.businessId === "bizA")).toBe(true);
    expect(fake.rows("msgContact").filter((row) => row.businessId === "bizB")).toHaveLength(1);
  });
});
