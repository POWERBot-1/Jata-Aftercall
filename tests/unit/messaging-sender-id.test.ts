/**
 * Sender Identity Centre (POS / ERP - PRO).
 *
 * A Sender ID is approved by a provider and a network, never by the customer and never by this
 * product. These tests pin that boundary: the lifecycle only moves forward through documented
 * transitions, missing KYC blocks submission, and an inactive Sender ID cannot send.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "@/tests/helpers/posFakeDb";
import { erpSeed } from "@/tests/helpers/erpSeed";
import {
  applySenderIdOutcome,
  canTransitionSender,
  kycRequirements,
  replyCapability,
  senderIdCanSend,
  submitSenderApplication,
  validateSenderIdName,
  SENDER_ID_FEES,
} from "@/lib/messaging/senderId";

let fake: FakeDb;

beforeEach(() => {
  fake = createFakeDb(erpSeed());
});

describe("name rules", () => {
  it("accepts a normal alphanumeric brand", () => {
    expect(validateSenderIdName("NYUMBANI").ok).toBe(true);
    expect(validateSenderIdName("CHAPATI254").ok).toBe(true);
  });

  it("rejects names that are too short, too long, all digits or contain symbols", () => {
    expect(validateSenderIdName("AB").ok).toBe(false);
    expect(validateSenderIdName("A".repeat(12)).ok).toBe(false);
    expect(validateSenderIdName("0712345678").ok).toBe(false);
    expect(validateSenderIdName("NYUM-BANI!").ok).toBe(false);
  });

  it("rejects reserved and impersonating names", () => {
    expect(validateSenderIdName("KRA").ok).toBe(false);
    expect(validateSenderIdName("SAFARICOM").ok).toBe(false);
    expect(validateSenderIdName("MPESA").ok).toBe(false);
  });

  it("asks for every document the channel needs, and never claims they are approved", () => {
    const sms = kycRequirements("SMS");
    const whatsapp = kycRequirements("WHATSAPP");
    expect(sms.length).toBeGreaterThanOrEqual(5);
    expect(whatsapp.length).toBeGreaterThan(sms.length);
    expect(sms.every((requirement) => requirement.label && requirement.explanation)).toBe(true);
  });

  it("discloses provider fees separately from the subscription", () => {
    expect(SENDER_ID_FEES.length).toBeGreaterThan(0);
    expect(SENDER_ID_FEES.every((fee) => fee.note.length > 10)).toBe(true);
    expect(SENDER_ID_FEES.every((fee) => fee.note.toLowerCase().includes("never charged automatically"))).toBe(true);
    expect(SENDER_ID_FEES.every((fee) => fee.amountCents === 0)).toBe(true);
  });
});

describe("lifecycle", () => {
  it("never lets a customer approve or activate its own Sender ID", () => {
    expect(canTransitionSender("SUBMITTED", "APPROVED", "CUSTOMER").allowed).toBe(false);
    expect(canTransitionSender("DRAFT", "ACTIVE", "CUSTOMER").allowed).toBe(false);
    expect(canTransitionSender("READY_TO_SUBMIT", "SUBMITTED", "CUSTOMER").allowed).toBe(true);
  });

  it("only the provider moves submitted applications to review and approval", () => {
    expect(canTransitionSender("SUBMITTED", "UNDER_REVIEW", "PROVIDER").allowed).toBe(true);
    expect(canTransitionSender("UNDER_REVIEW", "APPROVED", "PROVIDER").allowed).toBe(true);
    expect(canTransitionSender("APPROVED", "ACTIVE", "PROVIDER").allowed).toBe(true);
    expect(canTransitionSender("DRAFT", "ACTIVE", "PROVIDER").allowed).toBe(false);
  });

  it("requires a note for an authorised manual decision", async () => {
    await expect(
      applySenderIdOutcome(fake.db, { businessId: "bizA", senderIdId: "snd_a2", status: "UNDER_REVIEW", actor: "ADMIN" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("applies a provider outcome and records an event", async () => {
    const updated = await applySenderIdOutcome(fake.db, {
      businessId: "bizA",
      senderIdId: "snd_a2",
      status: "UNDER_REVIEW",
      actor: "PROVIDER",
      applicationRef: "PRV-123",
    });
    expect(updated.status).toBe("UNDER_REVIEW");
    const event = fake.rows("msgSenderIdEvent")[0];
    expect(event.fromStatus).toBe("SUBMITTED");
    expect(event.toStatus).toBe("UNDER_REVIEW");
    expect(event.source).toBe("PROVIDER");
  });

  it("refuses an invalid transition", async () => {
    await expect(
      applySenderIdOutcome(fake.db, { businessId: "bizA", senderIdId: "snd_a2", status: "ACTIVE", actor: "PROVIDER" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("submission", () => {
  const requirements = kycRequirements("SMS");

  it("blocks submission and records exactly what is missing", async () => {
    const result = await submitSenderApplication(fake.db, {
      businessId: "bizA",
      senderIdId: "snd_a2",
      requirements,
      provided: [requirements[0].key],
      businessProfileComplete: false,
      feeAcknowledged: true,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("INFORMATION_REQUIRED");
    expect(result.missing.length).toBeGreaterThan(0);

    const sender = fake.rows("msgSenderId").find((row) => row.id === "snd_a2")!;
    expect(sender.status).toBe("INFORMATION_REQUIRED");
    expect(JSON.parse(sender.missingItemsJson)).toEqual(result.missing);
  });

  it("refuses to submit until fees are acknowledged, and charges nothing", async () => {
    const result = await submitSenderApplication(fake.db, {
      businessId: "bizA",
      senderIdId: "snd_a2",
      requirements,
      provided: requirements.map((requirement) => requirement.key),
      businessProfileComplete: true,
      feeAcknowledged: false,
    });
    expect(result.ok).toBe(false);
    expect(fake.rows("msgSenderId").find((row) => row.id === "snd_a2")!.status).toBe("SUBMITTED");
    expect(fake.rows("msgLedgerEntry")).toHaveLength(0);
  });

  it("submits with complete information and a provider reference", async () => {
    fake.rows("msgSenderId").find((row) => row.id === "snd_a2")!.status = "READY_TO_SUBMIT";
    const result = await submitSenderApplication(fake.db, {
      businessId: "bizA",
      senderIdId: "snd_a2",
      requirements,
      provided: requirements.map((requirement) => requirement.key),
      businessProfileComplete: true,
      feeAcknowledged: true,
      provider: { submitApplication: async () => ({ ok: true, reference: "PRV-9911", message: "Received by provider" }) },
    });
    expect(result.ok).toBe(true);
    expect(result.reference).toBe("PRV-9911");

    const sender = fake.rows("msgSenderId").find((row) => row.id === "snd_a2")!;
    expect(sender.status).toBe("SUBMITTED");
    expect(sender.applicationRef).toBe("PRV-9911");
    expect(sender.feeAcknowledgedAt).toBeInstanceOf(Date);
  });

  it("keeps the application when the provider cannot be reached", async () => {
    fake.rows("msgSenderId").find((row) => row.id === "snd_a2")!.status = "READY_TO_SUBMIT";
    const result = await submitSenderApplication(fake.db, {
      businessId: "bizA",
      senderIdId: "snd_a2",
      requirements,
      provided: requirements.map((requirement) => requirement.key),
      businessProfileComplete: true,
      feeAcknowledged: true,
      provider: {
        submitApplication: async () => {
          throw new Error("timeout");
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/saved/i);
  });

  it("will not submit another tenant's application", async () => {
    await expect(
      submitSenderApplication(fake.db, {
        businessId: "bizB",
        senderIdId: "snd_a2",
        requirements,
        provided: requirements.map((requirement) => requirement.key),
        businessProfileComplete: true,
        feeAcknowledged: true,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("sending capability", () => {
  it("allows only an ACTIVE Sender ID to send", () => {
    expect(senderIdCanSend({ status: "ACTIVE" }).ok).toBe(true);
    expect(senderIdCanSend({ status: "SUBMITTED" }).ok).toBe(false);
    expect(senderIdCanSend({ status: "APPROVED" }).ok).toBe(false);
    expect(senderIdCanSend(null).ok).toBe(false);
  });

  it("states that a branded alphanumeric Sender ID cannot receive replies", () => {
    const sms = replyCapability({ channel: "SMS", replyCapable: false });
    expect(sms.twoWay).toBe(false);
    expect(sms.note).toMatch(/outbound/i);

    const whatsapp = replyCapability({ channel: "WHATSAPP" });
    expect(whatsapp.twoWay).toBe(true);
  });
});
