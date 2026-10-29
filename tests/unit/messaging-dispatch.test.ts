/**
 * Dispatch, retries, reconciliation and callbacks (POS / ERP - PRO).
 *
 * The sandbox provider never leaves the machine. What these tests prove is the queue's discipline:
 * a message is claimed once, a timeout is *never* treated as a failure (so it is not resent), a
 * retryable failure backs off, a sustained failure trips the breaker, and a delivery callback is
 * de-duplicated so a wallet cannot be charged twice for the same message.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "@/tests/helpers/posFakeDb";
import { erpSeed } from "@/tests/helpers/erpSeed";
import { approveCampaign, createCampaign, planCampaign } from "@/lib/messaging/campaigns";
import { walletSummary } from "@/lib/messaging/billing";
import { backoffMs, dispatchBatch, handleProviderCallback, reconcileCampaign } from "@/lib/messaging/pipeline";
import { MockMessagingProvider, type MessagingProviderAdapter, type SendResult } from "@/lib/messaging/providers";

let fake: FakeDb;

beforeEach(() => {
  fake = createFakeDb(erpSeed());
});

afterEach(() => {
  delete process.env.MESSAGING_WEBHOOK_SECRET;
});

const OPEN = new Date("2026-10-27T09:00:00+03:00");
const body = "Hi {{first_name}}, your order is ready at {{business}}.";

async function approvedCampaign() {
  const campaign = await createCampaign(fake.db, {
    businessId: "bizA",
    name: "Order ready",
    channel: "SMS",
    purpose: "MARKETING",
    body,
    audience: { mode: "ALL_ELIGIBLE" },
    senderIdId: "snd_a1",
  });
  await planCampaign(fake.db, { businessId: "bizA", campaignId: campaign.id, now: OPEN });
  await approveCampaign(fake.db, {
    businessId: "bizA",
    campaignId: campaign.id,
    role: "OWNER",
    actorId: "userA",
    costConfirmed: true,
  });
  return campaign;
}

/** The one contact with recorded marketing consent in the fixture. */
function recipientOf(campaignId: string) {
  return fake.rows("msgCampaignRecipient").find((row) => row.campaignId === campaignId && row.phoneNormalized === "254712111111")!;
}

describe("backoff", () => {
  it("grows exponentially and never exceeds the cap", () => {
    const first = backoffMs(1, "rec-1");
    const second = backoffMs(2, "rec-1");
    const capped = backoffMs(20, "rec-1");
    expect(first).toBeGreaterThanOrEqual(120_000);
    expect(second).toBeGreaterThan(first);
    expect(capped).toBeLessThanOrEqual(3_600_000);
  });

  it("is deterministic for the same recipient, so a retry is reproducible", () => {
    expect(backoffMs(3, "rec-9")).toBe(backoffMs(3, "rec-9"));
    expect(backoffMs(3, "rec-9")).not.toBe(backoffMs(3, "rec-10"));
  });
});

describe("dispatch", () => {
  it("sends an approved campaign through the sandbox provider and charges the wallet once", async () => {
    const campaign = await approvedCampaign();
    const provider = new MockMessagingProvider();
    const summary = await dispatchBatch(fake.db, { businessId: "bizA", campaignId: campaign.id, provider, now: OPEN });

    expect(summary.submitted).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.campaignStatus).toBe("COMPLETED");
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0].body).toContain("{{first_name}}");

    const recipient = recipientOf(campaign.id);
    expect(recipient.status).toBe("SUBMITTED");
    expect(recipient.providerMessageId).toMatch(/^mock_/);

    const wallet = await walletSummary(fake.db, "bizA");
    expect(wallet.reservedCents).toBe(0);
    expect(wallet.balanceCents).toBe(100_000 - recipient.costCents);
  });

  it("does not send the same recipient twice", async () => {
    const campaign = await approvedCampaign();
    const provider = new MockMessagingProvider();
    await dispatchBatch(fake.db, { businessId: "bizA", campaignId: campaign.id, provider, now: OPEN });
    const second = await dispatchBatch(fake.db, { businessId: "bizA", campaignId: campaign.id, provider, now: OPEN });
    expect(second.claimed).toBe(0);
    expect(provider.sent).toHaveLength(1);
  });

  it("treats an unknown provider outcome as pending, never as a failure to resend", async () => {
    const campaign = await approvedCampaign();
    const provider = new MockMessagingProvider({ unknownFirst: 1 });
    const first = await dispatchBatch(fake.db, { businessId: "bizA", campaignId: campaign.id, provider, now: OPEN });
    expect(first.unknown).toBe(1);
    expect(first.campaignStatus).toBe("AWAITING_RECONCILIATION");

    const recipient = recipientOf(campaign.id);
    expect(recipient.status).toBe("UNKNOWN");
    expect(new Date(recipient.nextAttemptAt).getTime()).toBeGreaterThan(OPEN.getTime());

    const second = await dispatchBatch(fake.db, { businessId: "bizA", campaignId: campaign.id, provider, now: OPEN });
    expect(second.claimed).toBe(0);
    expect(provider.sent).toHaveLength(1);
  });

  it("backs off a retryable failure and succeeds on the next attempt", async () => {
    const campaign = await approvedCampaign();
    const provider = new MockMessagingProvider({ failFirst: 1 });
    const first = await dispatchBatch(fake.db, { businessId: "bizA", campaignId: campaign.id, provider, now: OPEN });
    expect(first.retried).toBe(1);

    const recipient = recipientOf(campaign.id);
    expect(recipient.status).toBe("QUEUED");
    expect(recipient.attempts).toBe(1);
    expect(new Date(recipient.nextAttemptAt).getTime()).toBeGreaterThan(OPEN.getTime());

    const tooSoon = await dispatchBatch(fake.db, { businessId: "bizA", campaignId: campaign.id, provider, now: OPEN });
    expect(tooSoon.claimed).toBe(0);

    const later = new Date(OPEN.getTime() + 10 * 60_000);
    const second = await dispatchBatch(fake.db, { businessId: "bizA", campaignId: campaign.id, provider, now: later });
    expect(second.submitted).toBe(1);
    expect(provider.sent).toHaveLength(2);
    expect(recipientOf(campaign.id).status).toBe("SUBMITTED");
  });

  it("trips the circuit breaker instead of hammering a failing provider", async () => {
    fake.rows("msgContact").push({
      id: "ct_a3",
      businessId: "bizA",
      name: "Achieng Odhiambo",
      phoneNormalized: "254799888777",
      status: "ACTIVE",
      tagsJson: "[]",
      source: "IMPORT",
    });
    fake.rows("msgConsentRecord").push({
      id: "cons_a3m",
      businessId: "bizA",
      contactId: "ct_a3",
      channel: "SMS",
      purpose: "MARKETING",
      granted: true,
      source: "WEB_FORM",
      wordingVersion: "2026-01",
      capturedAt: new Date("2026-09-01T09:00:00Z"),
    });

    const campaign = await approvedCampaign();
    const provider = new MockMessagingProvider({ outcome: "FAILED" });
    const summary = await dispatchBatch(fake.db, {
      businessId: "bizA",
      campaignId: campaign.id,
      provider,
      now: OPEN,
      circuitBreakerThreshold: 1,
    });

    expect(summary.paused).toBe(true);
    expect(summary.campaignStatus).toBe("PAUSED");
    expect(summary.failed).toBe(1);
    expect(provider.sent).toHaveLength(1);
  });

  it("obeys the platform kill switch without sending anything", async () => {
    const campaign = await approvedCampaign();
    fake.rows("erpConfiguration").find((row) => row.businessId === "bizA")!.featureFlagsJson = JSON.stringify({ messagingKillSwitch: true });
    const provider = new MockMessagingProvider();
    const summary = await dispatchBatch(fake.db, { businessId: "bizA", campaignId: campaign.id, provider, now: OPEN });

    expect(summary.paused).toBe(true);
    expect(provider.sent).toHaveLength(0);
    expect(recipientOf(campaign.id).status).toBe("QUEUED");
  });

  it("re-checks consent at send time and releases the reservation for a blocked contact", async () => {
    const campaign = await approvedCampaign();
    // The customer opts out after the campaign was approved.
    fake.rows("msgConsentRecord")
      .filter((row) => row.contactId === "ct_a1" && row.purpose === "MARKETING")
      .forEach((row) => {
        row.granted = false;
        row.capturedAt = new Date("2026-10-27T08:00:00Z");
      });

    const provider = new MockMessagingProvider();
    const summary = await dispatchBatch(fake.db, { businessId: "bizA", campaignId: campaign.id, provider, now: OPEN });
    expect(summary.blocked).toBe(1);
    expect(provider.sent).toHaveLength(0);

    const recipient = recipientOf(campaign.id);
    expect(recipient.status).toBe("BLOCKED");
    expect(recipient.costCents).toBe(0);

    const wallet = await walletSummary(fake.db, "bizA");
    expect(wallet.reservedCents).toBe(0);
  });

  it("refuses to dispatch an unapproved campaign", async () => {
    const campaign = await createCampaign(fake.db, {
      businessId: "bizA",
      name: "Draft only",
      channel: "SMS",
      purpose: "MARKETING",
      body,
      audience: { mode: "ALL_ELIGIBLE" },
      senderIdId: "snd_a1",
    });
    const provider = new MockMessagingProvider();
    const summary = await dispatchBatch(fake.db, { businessId: "bizA", campaignId: campaign.id, provider, now: OPEN });
    expect(summary.claimed).toBe(0);
    expect(provider.sent).toHaveLength(0);
  });
});

describe("reconciliation", () => {
  function providerWithStatus(status: "DELIVERED" | "FAILED" | "PENDING", messageId?: string): MessagingProviderAdapter {
    return {
      key: "test",
      channel: "SMS",
      live: false,
      configured: true,
      async send(): Promise<SendResult> {
        return { outcome: "UNKNOWN", providerMessageId: messageId ?? "pm_1", message: "No answer" };
      },
      async status() {
        return { status, detail: "Checked with the provider" };
      },
      async health() {
        return { ok: true, state: "HEALTHY", checkedAt: new Date(), message: "ok" };
      },
      verifyCallback: () => ({ ok: true, reason: "ok" }),
      parseCallbacks: () => [],
    };
  }

  it("charges a delivered message exactly once", async () => {
    const campaign = await approvedCampaign();
    await dispatchBatch(fake.db, { businessId: "bizA", campaignId: campaign.id, provider: providerWithStatus("DELIVERED"), now: OPEN });

    const result = await reconcileCampaign(fake.db, { businessId: "bizA", campaignId: campaign.id, provider: providerWithStatus("DELIVERED"), now: OPEN });
    expect(result.delivered).toBe(1);
    expect(recipientOf(campaign.id).status).toBe("DELIVERED");

    const after = await walletSummary(fake.db, "bizA");
    expect(after.balanceCents).toBe(100_000 - recipientOf(campaign.id).costCents);
    expect(after.reservedCents).toBe(0);

    const again = await reconcileCampaign(fake.db, { businessId: "bizA", campaignId: campaign.id, provider: providerWithStatus("DELIVERED"), now: OPEN });
    expect(again.checked).toBe(0);
  });

  it("releases the reservation when the provider confirms failure", async () => {
    const campaign = await approvedCampaign();
    await dispatchBatch(fake.db, { businessId: "bizA", campaignId: campaign.id, provider: providerWithStatus("PENDING"), now: OPEN });
    const result = await reconcileCampaign(fake.db, { businessId: "bizA", campaignId: campaign.id, provider: providerWithStatus("FAILED"), now: OPEN });
    expect(result.failed).toBe(1);
    expect((await walletSummary(fake.db, "bizA")).reservedCents).toBe(0);
  });
});

describe("provider callbacks", () => {
  it("refuses an unsigned callback", async () => {
    process.env.MESSAGING_WEBHOOK_SECRET = "test-secret";
    const result = await handleProviderCallback(fake.db, {
      businessId: "bizA",
      providerKey: "mock",
      rawBody: JSON.stringify({ events: [] }),
      headers: {},
    });
    expect(result.ok).toBe(false);
  });

  it("verifies the signature, marks delivery and never double-charges on a repeated event", async () => {
    const campaign = await approvedCampaign();
    const provider = new MockMessagingProvider();
    await dispatchBatch(fake.db, { businessId: "bizA", campaignId: campaign.id, provider, now: OPEN });
    const recipient = recipientOf(campaign.id);

    process.env.MESSAGING_WEBHOOK_SECRET = "test-secret";
    const payload = JSON.stringify({ events: [{ id: "evt_1", messageId: recipient.providerMessageId, status: "DELIVERED" }] });
    const signature = createHmac("sha256", "test-secret").update(payload, "utf8").digest("hex");

    const first = await handleProviderCallback(fake.db, {
      businessId: "bizA",
      providerKey: "mock",
      rawBody: payload,
      headers: { "x-signature": `sha256=${signature}` },
    });
    expect(first.ok).toBe(true);
    expect(first.processed).toBe(1);
    expect(recipientOf(campaign.id).status).toBe("DELIVERED");

    const balanceAfterFirst = (await walletSummary(fake.db, "bizA")).balanceCents;

    const again = await handleProviderCallback(fake.db, {
      businessId: "bizA",
      providerKey: "mock",
      rawBody: payload,
      headers: { "x-signature": signature },
    });
    expect(again.duplicates).toBe(1);
    expect((await walletSummary(fake.db, "bizA")).balanceCents).toBe(balanceAfterFirst);
  });

  it("ignores a valid callback for a message that is not this tenant's", async () => {
    process.env.MESSAGING_WEBHOOK_SECRET = "test-secret";
    const payload = JSON.stringify({ events: [{ id: "evt_x", messageId: "pm_unknown", status: "DELIVERED" }] });
    const signature = createHmac("sha256", "test-secret").update(payload, "utf8").digest("hex");
    const result = await handleProviderCallback(fake.db, {
      businessId: "bizA",
      providerKey: "mock",
      rawBody: payload,
      headers: { "x-signature": signature },
    });
    expect(result.ok).toBe(true);
    expect(result.ignored).toBe(1);
  });
});
