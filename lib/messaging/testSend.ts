/**
 * Test sends
 *
 * A test send is how a business owner sees the message on their own phone before spending money on
 * an audience. It is deliberately narrow: one recipient chosen by the sender, one message, no
 * campaign recipients created, no wallet reservation, and a stored record only when the provider
 * actually accepted it. A failed test is reported as a failure — never as "sent".
 */

import { logErpAudit } from "../erp/audit";
import { getMessagingProvider, type MessagingProviderAdapter, type SendResult } from "./providers";
import { senderIdCanSend, replyCapability } from "./senderId";
import { calculateSegments, estimateSmsCost } from "./segments";
import { normalizeKePhone } from "../phone";

export type TestSendResult = {
  ok: boolean;
  status: "ACCEPTED" | "FAILED" | "UNKNOWN" | "BLOCKED";
  message: string;
  providerMessageId?: string | null;
  segments: number;
  estimatedCostCents: number;
  to?: string | null;
};

export async function sendTestMessage(
  client: any,
  input: {
    businessId: string;
    actorId?: string | null;
    actorName?: string | null;
    to: string;
    body: string;
    channel?: "SMS" | "WHATSAPP" | "EMAIL";
    senderIdId?: string | null;
    campaignId?: string | null;
    provider?: MessagingProviderAdapter;
    now?: Date;
  },
): Promise<TestSendResult> {
  const channel = input.channel ?? "SMS";
  const to = normalizeKePhone(input.to);
  const segments = calculateSegments(input.body);
  const cost = channel === "SMS" ? estimateSmsCost(input.body, { recipientCount: 1 }) : null;

  if (!to) {
    return { ok: false, status: "BLOCKED", message: "Enter a valid Kenyan mobile number for the test.", segments: segments.segments, estimatedCostCents: 0 };
  }
  if (!input.body || input.body.trim().length < 5) {
    return { ok: false, status: "BLOCKED", message: "Write the message first, then send yourself a test.", segments: 0, estimatedCostCents: 0 };
  }
  if (segments.segments > 6) {
    return { ok: false, status: "BLOCKED", message: `That message is ${segments.segments} SMS parts. Shorten it before testing — each part is charged.`, segments: segments.segments, estimatedCostCents: cost?.totalCents ?? 0 };
  }

  const connection = await client.msgChannelConnection
    .findUnique({ where: { businessId_channel: { businessId: input.businessId, channel } } })
    .catch(() => null);
  if (!connection || String(connection.status).toUpperCase() !== "ACTIVE") {
    return {
      ok: false,
      status: "BLOCKED",
      message: `Connect ${channel === "WHATSAPP" ? "WhatsApp" : channel.toLowerCase()} before sending a test.`,
      segments: segments.segments,
      estimatedCostCents: 0,
    };
  }

  let senderIdLabel: string = channel;
  if (channel === "SMS") {
    const sender = input.senderIdId
      ? await client.msgSenderId.findUnique({ where: { id: input.senderIdId } }).catch(() => null)
      : null;
    const check = senderIdCanSend(sender);
    if (!check.ok) {
      return { ok: false, status: "BLOCKED", message: check.reason, segments: segments.segments, estimatedCostCents: 0 };
    }
    if (sender && sender.businessId !== input.businessId) {
      return { ok: false, status: "BLOCKED", message: "That Sender ID belongs to another business.", segments: segments.segments, estimatedCostCents: 0 };
    }
    senderIdLabel = String(sender.requestedId);
  }

  const provider = input.provider ?? getMessagingProvider("mock");
  let outcome: SendResult;
  try {
    outcome = await provider.send({
      to,
      body: `[TEST] ${input.body}`,
      senderId: senderIdLabel,
      idempotencyKey: `test:${input.businessId}:${input.campaignId ?? "ad-hoc"}:${Date.now()}`,
      campaignId: input.campaignId ?? "test",
      channel: channel as "SMS" | "WHATSAPP" | "EMAIL",
    });
  } catch {
    outcome = { outcome: "UNKNOWN", message: "The provider did not answer. The test may or may not have arrived." };
  }

  const accepted = outcome.outcome === "ACCEPTED" || outcome.outcome === "SENT";
  const status: TestSendResult["status"] = accepted ? "ACCEPTED" : outcome.outcome === "UNKNOWN" ? "UNKNOWN" : "FAILED";

  if (input.campaignId) {
    const campaign = await client.msgCampaign.findUnique({ where: { id: input.campaignId } }).catch(() => null);
    if (campaign && campaign.businessId === input.businessId && accepted) {
      await client.msgCampaign.update({
        where: { id: campaign.id },
        data: { testSentAt: new Date(input.now ?? Date.now()), testSentTo: maskForDisplay(to) },
      });
    }
  }

  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId,
    actorName: input.actorName,
    action: "TEST_MESSAGE",
    targetType: campaignType(input.campaignId),
    targetId: input.campaignId ?? to.slice(-4),
    after: { channel, recipientLast4: to.slice(-4), status, segments: segments.segments, provider: provider.key },
    client,
  });

  const note = channel === "SMS" ? ` ${segments.segments} SMS part${segments.segments === 1 ? "" : "s"}, about KES ${((cost?.totalCents ?? 0) / 100).toFixed(2)} at the reference tariff.` : "";
  const reply = channel === "SMS" ? ` ${replyCapability({ replyCapable: false, channel: "SMS" }).note}` : "";
  return {
    ok: accepted,
    status,
    to: maskForDisplay(to),
    segments: segments.segments,
    estimatedCostCents: cost?.totalCents ?? 0,
    providerMessageId: outcome.providerMessageId ?? null,
    message: accepted
      ? `Test handed to the provider for ${maskForDisplay(to)}.${note}${reply}`
      : `${outcome.message ?? "The provider rejected the test."} Nothing was charged.`,
  };
}

function campaignType(campaignId?: string | null) {
  return campaignId ? "CAMPAIGN" : "TEST_SEND";
}

/** Show enough of the number to recognise it without printing the whole subscriber number. */
export function maskForDisplay(phone: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 6) return "•••";
  return `${digits.slice(0, 4)}•••${digits.slice(-3)}`;
}
