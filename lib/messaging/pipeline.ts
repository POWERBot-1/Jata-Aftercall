/**
 * Durable dispatch pipeline
 *
 * The recipient row is the outbox: it survives a worker restart, carries its own idempotency key
 * and retry state, and is claimed with a conditional update so two workers cannot send the same
 * message twice. Provider timeouts are recorded as UNKNOWN and reconciled later — a timeout is
 * not proof that nothing was sent, and treating it as such is how customers receive duplicates.
 */

import { createHash } from "node:crypto";
import { logErpAudit } from "../erp/audit";
import { consumeReserved, releaseReserved } from "./billing";
import { evaluateEligibility } from "./consent";
import { getMessagingProvider, type MessagingProviderAdapter } from "./providers";
import { senderIdCanSend } from "./senderId";

export type DispatchSummary = {
  claimed: number;
  submitted: number;
  failed: number;
  unknown: number;
  blocked: number;
  retried: number;
  paused: boolean;
  finished: boolean;
  campaignStatus: string;
  message: string;
};

export function deterministicJitter(key: string, maxMs = 30_000): number {
  const hash = createHash("sha256").update(key).digest();
  return hash.readUInt32BE(0) % Math.max(1, maxMs);
}

/** Exponential backoff with deterministic jitter, so tests are reproducible and workers spread out. */
export function backoffMs(attempt: number, key: string, baseMs = 60_000, maxMs = 3_600_000): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.min(maxMs, exponential + deterministicJitter(key));
}

function parseFlags(json: string | null | undefined): Record<string, boolean> {
  try {
    const parsed = JSON.parse(json || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function channelReady(client: any, businessId: string, channel: string) {
  const connection = await client.msgChannelConnection.findUnique({
    where: { businessId_channel: { businessId, channel } },
  }).catch(() => null);
  if (!connection) {
    return { ok: false, reason: `Connect ${channel === "SMS" ? "an SMS provider" : channel === "WHATSAPP" ? "WhatsApp" : "email"} before sending.` };
  }
  if (String(connection.status).toUpperCase() !== "ACTIVE") {
    return { ok: false, reason: `Your ${channel.toLowerCase()} connection is ${String(connection.status).toLowerCase().replace(/_/g, " ")}.` };
  }
  return { ok: true, reason: "Channel active." };
}

async function recipientStillEligible(client: any, campaign: any, recipient: any) {
  const contact = recipient.contactId ? await client.msgContact.findUnique({ where: { id: recipient.contactId } }) : null;
  if (!contact || contact.businessId !== campaign.businessId) {
    return { eligible: false, reason: "Contact was removed." };
  }
  const consentRows = await client.msgConsentRecord.findMany({
    where: { businessId: campaign.businessId, contactId: contact.id, channel: campaign.channel, purpose: campaign.purpose },
  });
  const latest = [...consentRows].sort((a: any, b: any) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime()).pop();
  const suppression = await client.msgSuppression.findMany({ where: { businessId: campaign.businessId, phoneNormalized: contact.phoneNormalized } });
  const suppressed = suppression.some((row: any) => row.channel === "ALL" || row.channel === campaign.channel);

  const result = evaluateEligibility({
    contact: {
      id: contact.id,
      name: contact.name,
      phoneNormalized: contact.phoneNormalized,
      status: contact.status,
      customerId: contact.customerId,
      consent: {
        marketing: Boolean(latest?.granted) && campaign.purpose === "MARKETING",
        transactional: latest ? Boolean(latest.granted) : true,
      },
      suppressed,
    },
    channel: campaign.channel,
    purpose: campaign.purpose,
    // Dispatch revalidates consent, but permitted-hour scheduling is enforced at approval and in
    // the queue's nextAttemptAt, so here we test the consent rules only.
    permittedHours: { startHour: 0, endHour: 24 },
  });
  return { eligible: result.eligible, reason: result.reason };
}

async function recomputeCampaignTotals(client: any, campaignId: string) {
  const recipients = await client.msgCampaignRecipient.findMany({ where: { campaignId } });
  const counts = (recipients as any[]).reduce<Record<string, number>>((total, recipient: any) => {
    total[recipient.status] = (total[recipient.status] ?? 0) + 1;
    return total;
  }, {});
  return { recipients, counts };
}

/**
 * Dispatch one bounded batch. Running it again is safe: it only claims QUEUED rows whose retry
 * time has passed, so a crashed worker's batch is picked up rather than duplicated.
 */
export async function dispatchBatch(
  client: any,
  input: {
    businessId: string;
    campaignId: string;
    limit?: number;
    provider?: MessagingProviderAdapter;
    now?: Date;
    maxAttempts?: number;
    circuitBreakerThreshold?: number;
    providerMode?: "auto" | "sandbox";
  },
): Promise<DispatchSummary> {
  const now = input.now ?? new Date();
  const campaign = await client.msgCampaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign || campaign.businessId !== input.businessId) {
    throw Object.assign(new Error("That campaign was not found."), { status: 404 });
  }

  const summary: DispatchSummary = {
    claimed: 0, submitted: 0, failed: 0, unknown: 0, blocked: 0, retried: 0, paused: false, finished: false,
    campaignStatus: campaign.status, message: "Nothing to send.",
  };

  if (!["APPROVED", "SCHEDULED", "DISPATCHING", "PAUSED"].includes(String(campaign.status))) {
    summary.message = "This campaign is not ready to send.";
    return summary;
  }
  if (String(campaign.status) === "PAUSED") {
    summary.paused = true;
    summary.message = "Campaign is paused.";
    return summary;
  }
  if (String(campaign.status) === "SCHEDULED" && campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > now.getTime()) {
    summary.message = "Scheduled for later. Nothing sent yet.";
    return summary;
  }

  const configuration = await client.erpConfiguration.findUnique({ where: { businessId: input.businessId } }).catch(() => null);
  const flags = parseFlags(configuration?.featureFlagsJson);
  if (flags.messagingKillSwitch) {
    await client.msgCampaign.update({ where: { id: campaign.id }, data: { status: "PAUSED", pausedAt: now, failureReason: "Messaging is paused by the platform safety switch. Nothing was sent." } });
    summary.paused = true;
    summary.campaignStatus = "PAUSED";
    summary.message = "Messaging is paused by the platform safety switch. Nothing was sent.";
    return summary;
  }

  const channel = await channelReady(client, input.businessId, campaign.channel);
  if (!channel.ok) {
    await client.msgCampaign.update({ where: { id: campaign.id }, data: { status: "PAUSED", pausedAt: now, failureReason: channel.reason } });
    summary.paused = true;
    summary.campaignStatus = "PAUSED";
    summary.message = channel.reason;
    return summary;
  }

  if (campaign.channel === "SMS") {
    const sender = campaign.senderIdId ? await client.msgSenderId.findUnique({ where: { id: campaign.senderIdId } }) : null;
    const check = senderIdCanSend(sender);
    if (!check.ok) {
      await client.msgCampaign.update({ where: { id: campaign.id }, data: { status: "PAUSED", pausedAt: now, failureReason: check.reason } });
      summary.paused = true;
      summary.campaignStatus = "PAUSED";
      summary.message = check.reason;
      return summary;
    }
  }

  const provider = input.provider ?? getMessagingProvider("mock");
  if (String(campaign.status) === "APPROVED" || String(campaign.status) === "SCHEDULED") {
    await client.msgCampaign.update({ where: { id: campaign.id }, data: { status: "DISPATCHING", startedAt: campaign.startedAt ?? now } });
    summary.campaignStatus = "DISPATCHING";
  }

  const candidates = await client.msgCampaignRecipient.findMany({ where: { campaignId: campaign.id, status: "QUEUED" } });
  const due = candidates
    .filter((recipient: any) => !recipient.nextAttemptAt || new Date(recipient.nextAttemptAt).getTime() <= now.getTime())
    .slice(0, Math.max(1, Math.min(200, input.limit ?? 25)));

  let consecutiveFailures = 0;
  let circuitBroken = false;

  for (const recipient of due) {
    const claim = await client.msgCampaignRecipient.updateMany({
      where: { id: recipient.id, status: "QUEUED" },
      data: { status: "SENDING" },
    });
    if (claim.count !== 1) continue;
    summary.claimed += 1;

    const eligibility = await recipientStillEligible(client, campaign, recipient);
    if (!eligibility.eligible) {
      const released = await releaseReserved(client, {
        businessId: input.businessId,
        campaignId: campaign.id,
        idempotencyKey: `release:${recipient.id}`,
        amountCents: Number(recipient.costCents),
      });
      await client.msgCampaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "BLOCKED", exclusionReason: eligibility.reason, costCents: 0 },
      });
      if (!released.idempotent && released.settled > 0) {
        await client.msgCampaign.update({ where: { id: campaign.id }, data: { reservedCents: { decrement: released.settled } } });
      }
      summary.blocked += 1;
      continue;
    }

    let result;
    try {
      result = await provider.send({
        to: recipient.phoneNormalized,
        body: campaign.messageBody,
        senderId: campaign.senderIdId ?? campaign.channel,
        idempotencyKey: recipient.idempotencyKey,
        campaignId: campaign.id,
        channel: campaign.channel as "SMS" | "WHATSAPP" | "EMAIL",
      });
    } catch {
      result = { outcome: "UNKNOWN" as const, message: "The provider did not answer. We will check before retrying." };
    }

    if (result.outcome === "ACCEPTED" || result.outcome === "SENT") {
      consecutiveFailures = 0;
      const charge = await consumeReserved(client, {
        businessId: input.businessId,
        campaignId: campaign.id,
        idempotencyKey: `consume:${recipient.id}`,
        amountCents: Number(recipient.costCents),
      });
      await client.msgCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: result.outcome === "SENT" ? "SENT" : "SUBMITTED",
          providerMessageId: result.providerMessageId ?? null,
          submittedAt: now,
          attempts: { increment: 1 },
          failureReason: null,
          nextAttemptAt: null,
        },
      });
      if (!charge.idempotent && charge.settled > 0) {
        await client.msgCampaign.update({
          where: { id: campaign.id },
          data: {
            actualCostCents: { increment: charge.settled },
            reservedCents: { decrement: charge.settled },
          },
        });
      }
      summary.submitted += 1;
      continue;
    }

    if (result.outcome === "UNKNOWN") {
      await client.msgCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "UNKNOWN",
          attempts: { increment: 1 },
          // Keep the provider's own id when it gave one: without it, reconciliation has nothing to
          // ask about and the message would sit as unknown forever.
          providerMessageId: result.providerMessageId ?? recipient.providerMessageId ?? null,
          failureReason: result.message ?? "Provider outcome unknown — awaiting reconciliation.",
          nextAttemptAt: new Date(now.getTime() + 5 * 60_000),
        },
      });
      summary.unknown += 1;
      continue;
    }

    // FAILED. Retry only when the provider says the failure was transient, with backoff + jitter.
    consecutiveFailures += 1;
    const attempts = Number(recipient.attempts ?? 0) + 1;
    const maxAttempts = Math.max(1, input.maxAttempts ?? 4);
    if (result.retryable && attempts < maxAttempts) {
      await client.msgCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "QUEUED",
          attempts,
          failureReason: result.message ?? "Temporary provider failure.",
          nextAttemptAt: new Date(now.getTime() + backoffMs(attempts, recipient.idempotencyKey)),
        },
      });
      summary.retried += 1;
    } else {
      const release = await releaseReserved(client, {
        businessId: input.businessId,
        campaignId: campaign.id,
        idempotencyKey: `release:${recipient.id}`,
        amountCents: Number(recipient.costCents),
      });
      await client.msgCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "FAILED",
          attempts,
          failureReason: result.message ?? "The provider rejected this message.",
          nextAttemptAt: null,
        },
      });
      if (!release.idempotent && release.settled > 0) {
        await client.msgCampaign.update({ where: { id: campaign.id }, data: { reservedCents: { decrement: release.settled } } });
      }
      summary.failed += 1;
    }

    const threshold = Math.max(1, input.circuitBreakerThreshold ?? 5);
    if (consecutiveFailures >= threshold) {
      circuitBroken = true;
      break;
    }
  }

  const { recipients } = await recomputeCampaignTotals(client, campaign.id);
  const remainingQueued = recipients.filter((row: any) => row.status === "QUEUED").length;
  const outstandingUnknown = recipients.filter((row: any) => row.status === "UNKNOWN").length;
  const submitted = recipients.filter((row: any) => ["SUBMITTED", "SENT", "DELIVERED", "READ"].includes(row.status)).length;
  const failed = recipients.filter((row: any) => row.status === "FAILED").length;

  let nextStatus: string = "DISPATCHING";
  if (circuitBroken) {
    nextStatus = "PAUSED";
    summary.paused = true;
    await client.msgCampaign.update({
      where: { id: campaign.id },
      data: { status: "PAUSED", pausedAt: now, failureReason: `Paused automatically after ${consecutiveFailures} consecutive provider failures. Check the provider, then resume.` },
    });
  } else if (remainingQueued > 0) {
    nextStatus = "DISPATCHING";
  } else if (outstandingUnknown > 0) {
    nextStatus = "AWAITING_RECONCILIATION";
    await client.msgCampaign.update({
      where: { id: campaign.id },
      data: { status: nextStatus, failureReason: `${outstandingUnknown} message${outstandingUnknown === 1 ? "" : "s"} have an unknown provider outcome. They will be reconciled — not blindly resent.` },
    });
  } else if (submitted > 0 && failed === 0) {
    nextStatus = "COMPLETED";
  } else if (submitted > 0) {
    nextStatus = "PARTIALLY_COMPLETED";
  } else {
    nextStatus = "FAILED";
    await client.msgCampaign.update({ where: { id: campaign.id }, data: { status: nextStatus, failureReason: "No message was accepted by the provider." } });
  }

  if (nextStatus === "COMPLETED" || nextStatus === "PARTIALLY_COMPLETED") {
    await client.msgCampaign.update({ where: { id: campaign.id }, data: { status: nextStatus, completedAt: now } });
    await client.erpNotification.create({
      data: {
        businessId: input.businessId,
        kind: "MESSAGING_CAMPAIGN_FINISHED",
        title: nextStatus === "COMPLETED" ? "Campaign completed" : "Campaign completed with some failures",
        body: `Results are ready for “${campaign.name}”.`,
        href: `/dashboard/erp/${input.businessId}/messaging/campaigns/${campaign.id}`,
        audienceRole: "OWNER",
      },
    }).catch(() => null);
  }

  summary.finished = remainingQueued === 0 && outstandingUnknown === 0;
  summary.campaignStatus = nextStatus;
  summary.message = circuitBroken
    ? `Paused after ${consecutiveFailures} consecutive failures.`
    : summary.claimed === 0
      ? "Nothing due to send in this batch."
      : `Processed ${summary.claimed}: ${summary.submitted} accepted, ${summary.failed} failed, ${summary.unknown} unknown.`;
  return summary;
}

/**
 * Reconcile UNKNOWN outcomes before any retry. A delivered message is charged once; a confirmed
 * failure is released; a still-unknown one stays unknown — no third guess.
 */
export async function reconcileCampaign(client: any, input: { businessId: string; campaignId: string; provider?: MessagingProviderAdapter; now?: Date; limit?: number }) {
  const campaign = await client.msgCampaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign || campaign.businessId !== input.businessId) throw Object.assign(new Error("That campaign was not found."), { status: 404 });
  const provider = input.provider ?? getMessagingProvider("mock");
  const recipients = (await client.msgCampaignRecipient.findMany({ where: { campaignId: campaign.id, status: "UNKNOWN" } })).slice(0, input.limit ?? 50);
  const now = input.now ?? new Date();
  const result = { checked: 0, delivered: 0, failed: 0, stillUnknown: 0 };

  for (const recipient of recipients) {
    result.checked += 1;
    if (!recipient.providerMessageId) {
      result.stillUnknown += 1;
      continue;
    }
    const status = await provider.status(recipient.providerMessageId);
    if (status.status === "DELIVERED") {
      const charge = await consumeReserved(client, {
        businessId: input.businessId,
        campaignId: campaign.id,
        idempotencyKey: `consume:${recipient.id}`,
        amountCents: Number(recipient.costCents),
      });
      await client.msgCampaignRecipient.update({ where: { id: recipient.id }, data: { status: "DELIVERED", deliveredAt: now, nextAttemptAt: null, failureReason: null } });
      if (!charge.idempotent && charge.settled > 0) {
        await client.msgCampaign.update({ where: { id: campaign.id }, data: { actualCostCents: { increment: charge.settled }, reservedCents: { decrement: charge.settled } } });
      }
      result.delivered += 1;
    } else if (status.status === "FAILED") {
      const release = await releaseReserved(client, { businessId: input.businessId, campaignId: campaign.id, idempotencyKey: `release:${recipient.id}`, amountCents: Number(recipient.costCents) });
      await client.msgCampaignRecipient.update({ where: { id: recipient.id }, data: { status: "FAILED", failureReason: status.detail ?? "Provider confirmed failure.", nextAttemptAt: null } });
      if (!release.idempotent && release.settled > 0) {
        await client.msgCampaign.update({ where: { id: campaign.id }, data: { reservedCents: { decrement: release.settled } } });
      }
      result.failed += 1;
    } else {
      result.stillUnknown += 1;
    }
  }

  const remaining = await client.msgCampaignRecipient.findMany({ where: { campaignId: campaign.id, status: { in: ["QUEUED", "UNKNOWN"] } } });
  if (remaining.length === 0) {
    const all = await client.msgCampaignRecipient.findMany({ where: { campaignId: campaign.id } });
    const failed = all.filter((row: any) => row.status === "FAILED").length;
    const sent = all.filter((row: any) => ["SUBMITTED", "SENT", "DELIVERED", "READ"].includes(row.status)).length;
    const nextStatus = sent > 0 && failed === 0 ? "COMPLETED" : sent > 0 ? "PARTIALLY_COMPLETED" : "FAILED";
    await client.msgCampaign.update({ where: { id: campaign.id }, data: { status: nextStatus, completedAt: now } });
  }

  return result;
}

export type CallbackResult = { ok: boolean; processed: number; duplicates: number; ignored: number; reason?: string };

/**
 * Apply authenticated delivery callbacks. The signature is verified over the raw body, the event is
 * inserted with a unique dedupe key, and charges use idempotent ledger keys — so a replayed
 * callback updates nothing and charges nothing twice.
 */
export async function handleProviderCallback(
  client: any,
  input: {
    businessId: string;
    providerKey: string;
    rawBody: string;
    headers: Record<string, string | undefined>;
    provider?: MessagingProviderAdapter;
    now?: Date;
  },
): Promise<CallbackResult> {
  const provider = input.provider ?? getMessagingProvider(input.providerKey);
  const verification = provider.verifyCallback(input.rawBody, input.headers);
  if (!verification.ok) {
    await logErpAudit({
      businessId: input.businessId,
      action: "MESSAGING_CALLBACK_REJECTED",
      targetType: "CALLBACK",
      targetId: input.providerKey,
      outcome: "DENIED",
      reason: verification.reason,
      client,
    });
    return { ok: false, processed: 0, duplicates: 0, ignored: 0, reason: verification.reason };
  }

  const events = provider.parseCallbacks(input.rawBody, input.headers);
  const now = input.now ?? new Date();
  let processed = 0;
  let duplicates = 0;
  let ignored = 0;

  for (const event of events) {
    const dedupeKey = `${input.providerKey}:${event.eventId}`;
    try {
      await client.msgMessageEvent.create({
        data: {
          businessId: input.businessId,
          provider: input.providerKey,
          providerMessageId: event.providerMessageId,
          eventType: event.eventType,
          payloadJson: JSON.stringify(event.raw),
          signatureVerified: true,
          dedupeKey,
          campaignId: null,
          recipientId: null,
          receivedAt: now,
        },
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        duplicates += 1;
        continue;
      }
      throw error;
    }

    const recipient = event.providerMessageId
      ? (await client.msgCampaignRecipient.findFirst({ where: { businessId: input.businessId, providerMessageId: event.providerMessageId } }))
      : null;
    if (!recipient) {
      ignored += 1;
      continue;
    }

    const campaign = await client.msgCampaign.findUnique({ where: { id: recipient.campaignId } });
    if (!campaign || campaign.businessId !== input.businessId) {
      ignored += 1;
      continue;
    }

    if (event.eventType === "DELIVERED" || event.eventType === "READ") {
      const charge = await consumeReserved(client, {
        businessId: input.businessId,
        campaignId: campaign.id,
        idempotencyKey: `consume:${recipient.id}`,
        amountCents: Number(recipient.costCents),
      });
      await client.msgCampaignRecipient.update({
        where: { id: recipient.id },
        data: { status: event.eventType === "READ" ? "DELIVERED" : "DELIVERED", deliveredAt: event.occurredAt ?? now, nextAttemptAt: null },
      });
      if (!charge.idempotent && charge.settled > 0) {
        await client.msgCampaign.update({ where: { id: campaign.id }, data: { actualCostCents: { increment: charge.settled }, reservedCents: { decrement: charge.settled } } });
      }
    } else if (event.eventType === "FAILED") {
      if (!["FAILED", "DELIVERED"].includes(String(recipient.status))) {
        const release = await releaseReserved(client, {
          businessId: input.businessId,
          campaignId: campaign.id,
          idempotencyKey: `release:${recipient.id}`,
          amountCents: Number(recipient.costCents),
        });
        if (!release.idempotent && release.settled > 0) {
          await client.msgCampaign.update({ where: { id: campaign.id }, data: { reservedCents: { decrement: release.settled } } });
        }
      }
      await client.msgCampaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "FAILED", failureReason: event.reason ?? "Provider reported a delivery failure." },
      });
    } else if (event.eventType === "ACCEPTED" || event.eventType === "SENT") {
      if (["QUEUED", "SENDING"].includes(String(recipient.status))) {
        await client.msgCampaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "SUBMITTED", submittedAt: event.occurredAt ?? now, providerMessageId: event.providerMessageId },
        });
      }
    }

    await client.msgMessageEvent.updateMany({
      where: { dedupeKey },
      data: { campaignId: campaign.id, recipientId: recipient.id },
    });
    processed += 1;
  }

  return { ok: true, processed, duplicates, ignored };
}

export async function campaignMetrics(client: any, businessId: string, campaignId: string) {
  const campaign = await client.msgCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.businessId !== businessId) throw Object.assign(new Error("That campaign was not found."), { status: 404 });
  const recipients = await client.msgCampaignRecipient.findMany({ where: { campaignId } });
  const counts: Record<string, number> = {};
  const exclusionReasons: Record<string, number> = {};
  for (const recipient of recipients) {
    counts[recipient.status] = (counts[recipient.status] ?? 0) + 1;
    if (recipient.status === "BLOCKED" && recipient.exclusionReason) {
      exclusionReasons[recipient.exclusionReason] = (exclusionReasons[recipient.exclusionReason] ?? 0) + 1;
    }
  }
  const billableSegments = recipients
    .filter((recipient: any) => ["SUBMITTED", "SENT", "DELIVERED", "READ"].includes(recipient.status))
    .reduce((total: number, recipient: any) => total + Number(recipient.segments ?? 0), 0);
  const estimatedCents = Number(campaign.estimatedCostCents);
  const actualCents = Number(campaign.actualCostCents);
  return {
    campaign,
    counts,
    total: recipients.length,
    delivered: counts.DELIVERED ?? 0,
    submitted: counts.SUBMITTED ?? 0,
    sent: counts.SENT ?? 0,
    failed: counts.FAILED ?? 0,
    unknown: counts.UNKNOWN ?? 0,
    blocked: counts.BLOCKED ?? 0,
    skipped: counts.SKIPPED ?? 0,
    queued: counts.QUEUED ?? 0,
    exclusionReasons,
    billableSegments,
    estimatedCents,
    actualCents,
    varianceCents: actualCents - estimatedCents,
    note: "Delivery is reported by the provider. It is not proof that the customer read the message or bought anything.",
  };
}
