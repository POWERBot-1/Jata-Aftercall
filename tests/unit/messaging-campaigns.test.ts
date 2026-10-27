/**
 * Audience selection, wallet reservations and campaign approval (POS / ERP - PRO).
 *
 * The point of these tests is that a campaign cannot reach a phone number just because the number
 * is stored. Consent is read from consent *records*, suppression always wins, and approval is a
 * separate, priced, funded step — never a side effect of "send".
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "@/tests/helpers/posFakeDb";
import { erpSeed } from "@/tests/helpers/erpSeed";
import { approveCampaign, createCampaign, pauseCampaign, planCampaign, previewAudience } from "@/lib/messaging/campaigns";
import { creditWallet, reserveFunds, walletSummary } from "@/lib/messaging/billing";

let fake: FakeDb;

beforeEach(() => {
  fake = createFakeDb(erpSeed());
});

const body = "Hi {{first_name}}, we have fresh chapati today at {{business}}.";
/** 09:00 in Nairobi — inside the 08:00–20:00 permitted window. */
const OPEN = new Date("2026-10-27T09:00:00+03:00");

describe("audience preview", () => {
  it("includes only contacts with a recorded marketing consent", async () => {
    const preview = await previewAudience(fake.db, {
      businessId: "bizA",
      definition: { mode: "ALL_ELIGIBLE" },
      channel: "SMS",
      purpose: "MARKETING",
      body,
      now: OPEN,
    });

    expect(preview.members.map((member) => member.contactId)).toEqual(["ct_a1"]);
    const excluded = preview.excluded.find((entry) => entry.contactId === "ct_a2");
    expect(excluded?.code).toBe("NO_MARKETING_CONSENT");
    expect(preview.estimatedCostCents).toBeGreaterThan(0);
    expect(preview.costNote).toMatch(/not a confirmed provider tariff/i);
  });

  it("excludes a suppressed number even when consent was recorded", async () => {
    fake.rows("msgSuppression").push({
      id: "sup1",
      businessId: "bizA",
      phoneNormalized: "254712111111",
      reason: "OPT_OUT",
      channel: "ALL",
      createdAt: new Date(),
    });
    const preview = await previewAudience(fake.db, {
      businessId: "bizA",
      definition: { mode: "ALL_ELIGIBLE" },
      channel: "SMS",
      purpose: "MARKETING",
      body,
      now: OPEN,
    });
    expect(preview.members).toHaveLength(0);
    expect(preview.excluded[0].code).toBe("SUPPRESSED");
  });

  it("never mixes tenants", async () => {
    const preview = await previewAudience(fake.db, {
      businessId: "bizB",
      definition: { mode: "ALL_ELIGIBLE" },
      channel: "SMS",
      purpose: "MARKETING",
      body,
      now: OPEN,
    });
    expect(preview.members.map((member) => member.contactId)).toEqual(["ct_b1"]);
  });

  it("applies the 30-day marketing frequency cap from submitted messages", async () => {
    fake.rows("msgCampaign").push({
      id: "camp_old",
      businessId: "bizA",
      name: "September offer",
      channel: "SMS",
      purpose: "MARKETING",
      status: "COMPLETED",
      createdAt: new Date(Date.now() - 3 * 86_400_000),
    });
    for (let index = 0; index < 4; index += 1) {
      fake.rows("msgCampaignRecipient").push({
        id: `r_${index}`,
        businessId: "bizA",
        campaignId: "camp_old",
        contactId: "ct_a1",
        phoneNormalized: "254712111111",
        status: "SUBMITTED",
        createdAt: new Date(Date.now() - 2 * 86_400_000),
      });
    }
    const preview = await previewAudience(fake.db, {
      businessId: "bizA",
      definition: { mode: "ALL_ELIGIBLE" },
      channel: "SMS",
      purpose: "MARKETING",
      body,
      now: OPEN,
    });
    expect(preview.excluded.find((entry) => entry.contactId === "ct_a1")?.code).toBe("FREQUENCY_CAP_REACHED");
  });
});

describe("campaign planning", () => {
  it("materialises one durable recipient row per contact with an exclusion reason", async () => {
    const campaign = await createCampaign(fake.db, {
      businessId: "bizA",
      name: "Chapati Friday",
      channel: "SMS",
      purpose: "MARKETING",
      body,
      audience: { mode: "ALL_ELIGIBLE" },
      senderIdId: "snd_a1",
    });

    const planned = await planCampaign(fake.db, { businessId: "bizA", campaignId: campaign.id, now: OPEN });
    expect(planned.campaign.status).toBe("READY_FOR_REVIEW");
    expect(planned.campaign.eligibleRecipients).toBe(1);
    expect(planned.campaign.excludedRecipients).toBe(1);

    const recipients = fake.rows("msgCampaignRecipient").filter((row) => row.campaignId === campaign.id);
    expect(recipients).toHaveLength(2);
    expect(recipients.find((row) => row.phoneNormalized === "254733222222")?.status).toBe("BLOCKED");
    expect(recipients.find((row) => row.phoneNormalized === "254733222222")?.exclusionReason).toMatch(/consent/i);
  });

  it("is idempotent: planning twice does not duplicate recipients", async () => {
    const campaign = await createCampaign(fake.db, {
      businessId: "bizA",
      name: "Chapati Friday",
      channel: "SMS",
      purpose: "MARKETING",
      body,
      audience: { mode: "ALL_ELIGIBLE" },
      senderIdId: "snd_a1",
    });
    await planCampaign(fake.db, { businessId: "bizA", campaignId: campaign.id, now: OPEN });
    const before = fake.rows("msgCampaignRecipient").length;
    await planCampaign(fake.db, { businessId: "bizA", campaignId: campaign.id, now: OPEN });
    expect(fake.rows("msgCampaignRecipient")).toHaveLength(before);
  });

  it("refuses a campaign whose template is invalid", async () => {
    await expect(
      createCampaign(fake.db, {
        businessId: "bizA",
        name: "Bad link",
        channel: "SMS",
        purpose: "MARKETING",
        body: "Pay here http://insecure.example",
        audience: { mode: "ALL_ELIGIBLE" },
      }),
    ).rejects.toMatchObject({ code: "TEMPLATE_INVALID" });
  });
});

describe("wallet", () => {
  it("separates available credit from reserved credit", async () => {
    const summary = await walletSummary(fake.db, "bizA");
    expect(summary.balanceCents).toBe(100_000);
    expect(summary.reservedCents).toBe(0);
    expect(summary.availableCents).toBe(100_000);
  });

  it("requires a verified reference before crediting", async () => {
    await expect(
      creditWallet(fake.db, { businessId: "bizA", amountCents: 5000, idempotencyKey: "topup-1", reference: "" }),
    ).rejects.toMatchObject({ code: "REFERENCE_REQUIRED" });
  });

  it("credits once per idempotency key", async () => {
    const input = { businessId: "bizA", amountCents: 5000, idempotencyKey: "topup-1", reference: "MPESA-QR7X9" };
    await creditWallet(fake.db, input);
    await creditWallet(fake.db, input);
    const summary = await walletSummary(fake.db, "bizA");
    expect(summary.balanceCents).toBe(105_000);
  });

  it("refuses a reservation larger than the available balance", async () => {
    await expect(
      reserveFunds(fake.db, { businessId: "bizA", amountCents: 200_000, campaignId: "camp_x", idempotencyKey: "res-1" }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDIT" });
  });

  it("reserves without spending, and is idempotent", async () => {
    const first = await reserveFunds(fake.db, { businessId: "bizA", amountCents: 5_000, campaignId: "camp_x", idempotencyKey: "res-1" });
    const second = await reserveFunds(fake.db, { businessId: "bizA", amountCents: 5_000, campaignId: "camp_x", idempotencyKey: "res-1" });
    expect(first.reserved).toBe(5_000);
    expect(second.idempotent).toBe(true);

    const summary = await walletSummary(fake.db, "bizA");
    expect(summary.balanceCents).toBe(100_000);
    expect(summary.reservedCents).toBe(5_000);
    expect(summary.availableCents).toBe(95_000);
  });
});

describe("approval", () => {
  async function planned() {
    const campaign = await createCampaign(fake.db, {
      businessId: "bizA",
      name: "Chapati Friday",
      channel: "SMS",
      purpose: "MARKETING",
      body,
      audience: { mode: "ALL_ELIGIBLE" },
      senderIdId: "snd_a1",
    });
    await planCampaign(fake.db, { businessId: "bizA", campaignId: campaign.id, now: OPEN });
    return campaign;
  }

  it("refuses approval until the cost is explicitly confirmed", async () => {
    const campaign = await planned();
    await expect(
      approveCampaign(fake.db, { businessId: "bizA", campaignId: campaign.id, role: "OWNER", costConfirmed: false }),
    ).rejects.toMatchObject({ code: "COST_NOT_CONFIRMED" });
  });

  it("refuses approval without an approved sender id", async () => {
    const campaign = await createCampaign(fake.db, {
      businessId: "bizA",
      name: "No sender yet",
      channel: "SMS",
      purpose: "MARKETING",
      body,
      audience: { mode: "ALL_ELIGIBLE" },
    });
    await planCampaign(fake.db, { businessId: "bizA", campaignId: campaign.id, now: OPEN });
    await expect(
      approveCampaign(fake.db, { businessId: "bizA", campaignId: campaign.id, role: "OWNER", costConfirmed: true }),
    ).rejects.toMatchObject({ code: "SENDER_NOT_APPROVED" });
  });

  it("refuses approval from a role with no spending authority", async () => {
    const campaign = await planned();
    await expect(
      approveCampaign(fake.db, { businessId: "bizA", campaignId: campaign.id, role: "STAFF", costConfirmed: true }),
    ).rejects.toMatchObject({ code: "APPROVAL_DENIED" });
  });

  it("refuses approval when a manager's limit is below the campaign cost", async () => {
    await creditWallet(fake.db, { businessId: "bizA", amountCents: 2_000_000, idempotencyKey: "topup-big", reference: "MPESA-LIMIT-TEST" });
    const campaign = await planned();
    fake.rows("msgCampaign").find((row) => row.id === campaign.id)!.estimatedCostCents = 1_500_000;
    await expect(
      approveCampaign(fake.db, { businessId: "bizA", campaignId: campaign.id, role: "MANAGER", costConfirmed: true, actorId: "cashierA" }),
    ).rejects.toMatchObject({ code: "APPROVAL_DENIED" });
  });

  it("reserves funds and records who approved, without sending", async () => {
    const campaign = await planned();
    const approved = await approveCampaign(fake.db, {
      businessId: "bizA",
      campaignId: campaign.id,
      role: "OWNER",
      actorId: "userA",
      actorName: "Owner A",
      costConfirmed: true,
    });
    expect(approved.campaign.status).toBe("APPROVED");
    expect(approved.reservedCents).toBeGreaterThan(0);

    const wallet = await walletSummary(fake.db, "bizA");
    expect(wallet.reservedCents).toBe(approved.reservedCents);
    expect(fake.rows("msgCampaignRecipient").every((row) => ["QUEUED", "BLOCKED"].includes(row.status))).toBe(true);
  });

  it("refuses approval from another tenant", async () => {
    const campaign = await planned();
    await expect(
      approveCampaign(fake.db, { businessId: "bizB", campaignId: campaign.id, role: "OWNER", costConfirmed: true }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("pausing demands a written reason", async () => {
    const campaign = await planned();
    await approveCampaign(fake.db, { businessId: "bizA", campaignId: campaign.id, role: "OWNER", costConfirmed: true });
    await expect(pauseCampaign(fake.db, { businessId: "bizA", campaignId: campaign.id, reason: " " })).rejects.toMatchObject({
      code: "REASON_REQUIRED",
    });
    const paused = await pauseCampaign(fake.db, { businessId: "bizA", campaignId: campaign.id, reason: "Wrong audience selected" });
    expect(paused.status).toBe("PAUSED");
  });
});
