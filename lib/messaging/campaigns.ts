/**
 * Audiences, campaign planning and approval
 *
 * Planning is where honesty is cheapest: the audience is resolved from stored consent and
 * suppression, every excluded contact gets a reason, the segment count and cost are calculated
 * from the actual message, and nothing is sent. Approval is a separate, permissioned, audited act
 * that revalidates the sender, the channel and the available credit before it reserves a shilling.
 */

import { logErpAudit } from "../erp/audit";
import { approvalDecision, type ErpRole } from "../erp/access";
import { calculateSegments, DEFAULT_SMS_TARIFFS, estimateSmsCost, estimateWhatsAppCost, type NetworkTariff } from "./segments";
import { evaluateEligibility, type CampaignPurpose, type ContactChannel } from "./consent";
import { validateTemplate } from "./templates";
import { reserveFunds, walletSummary, releaseReserved } from "./billing";
import { senderIdCanSend } from "./senderId";

export type AudienceDefinition = {
  mode: "ALL_ELIGIBLE" | "SELECTED" | "TAGS" | "OVERDUE_INVOICES" | "IMPORTED";
  contactIds?: string[];
  tags?: string[];
  minSpendCents?: number;
  includeCustomerIds?: string[];
};

export type AudienceExclusion = {
  contactId: string;
  name: string | null;
  phoneNormalized: string;
  code: string;
  reason: string;
};

export type AudienceMember = {
  contactId: string;
  name: string | null;
  phoneNormalized: string;
  customerId: string | null;
  segments: number;
  costCents: number;
};

export type AudiencePreview = {
  channel: ContactChannel;
  purpose: CampaignPurpose;
  members: AudienceMember[];
  excluded: AudienceExclusion[];
  totalContacts: number;
  eligibleCount: number;
  excludedCount: number;
  estimatedCostCents: number;
  segmentsPerMessage: number;
  encoding: string;
  perSegmentCents: number;
  costNote: string;
};

function parseTags(json: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function latestConsentMap(client: any, businessId: string, channel: ContactChannel, purpose: CampaignPurpose) {
  const records = await client.msgConsentRecord.findMany({ where: { businessId, channel, purpose } });
  const map = new Map<string, boolean>();
  const sorted = [...records].sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  for (const record of sorted) map.set(record.contactId, Boolean(record.granted));
  return map;
}

async function suppressionSet(client: any, businessId: string, channel: ContactChannel) {
  const records = await client.msgSuppression.findMany({ where: { businessId } });
  return new Set(
    records
      .filter((record: any) => record.channel === "ALL" || record.channel === channel)
      .map((record: any) => record.phoneNormalized),
  );
}

/** Marketing messages actually submitted (not merely queued) in the trailing 30 days. */
async function marketingCounts(client: any, businessId: string, now: Date) {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);
  const campaigns = await client.msgCampaign.findMany({ where: { businessId, purpose: "MARKETING" } });
  const marketingIds = new Set(campaigns.map((campaign: any) => campaign.id));
  if (!marketingIds.size) return new Map<string, number>();
  const recipients = await client.msgCampaignRecipient.findMany({ where: { businessId } });
  const counts = new Map<string, number>();
  for (const recipient of recipients) {
    if (!marketingIds.has(recipient.campaignId)) continue;
    if (!["SUBMITTED", "SENT", "DELIVERED"].includes(String(recipient.status))) continue;
    if (new Date(recipient.createdAt).getTime() < cutoff.getTime()) continue;
    counts.set(recipient.phoneNormalized, (counts.get(recipient.phoneNormalized) ?? 0) + 1);
  }
  return counts;
}

async function loadContacts(client: any, businessId: string, definition: AudienceDefinition) {
  const mode = definition.mode ?? "ALL_ELIGIBLE";
  const where: any = { businessId, status: "ACTIVE" };
  if (mode === "SELECTED" && definition.contactIds?.length) where.id = { in: definition.contactIds };
  if (mode === "IMPORTED" && definition.contactIds?.length) where.id = { in: definition.contactIds };
  if (mode === "TAGS" && definition.tags?.length) where.tagsJson = { contains: definition.tags[0] };
  if (definition.includeCustomerIds?.length) where.customerId = { in: definition.includeCustomerIds };
  let contacts = await client.msgContact.findMany({ where });

  if (mode === "TAGS" && definition.tags?.length) {
    const wanted = definition.tags.map((tag) => tag.toLowerCase());
    contacts = contacts.filter((contact: any) => parseTags(contact.tagsJson).some((tag) => wanted.includes(tag.toLowerCase())));
  }

  if (mode === "OVERDUE_INVOICES") {
    const asOf = new Date();
    const invoices = await client.erpInvoice.findMany({ where: { businessId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } } });
    const overdueCustomerIds = new Set(
      invoices
        .filter((invoice: any) => Number(invoice.balanceCents) > 0 && invoice.dueAt && new Date(invoice.dueAt).getTime() < asOf.getTime())
        .map((invoice: any) => invoice.customerId)
        .filter(Boolean),
    );
    contacts = contacts.filter((contact: any) => contact.customerId && overdueCustomerIds.has(contact.customerId));
  }

  return contacts;
}

/**
 * Resolve and price an audience. Pure read: no rows are created, so the preview a customer sees
 * is the truth they can rely on before approving anything.
 */
export async function previewAudience(
  client: any,
  input: {
    businessId: string;
    definition: AudienceDefinition;
    channel: ContactChannel;
    purpose: CampaignPurpose;
    body: string;
    now?: Date;
    tariffs?: NetworkTariff[];
    network?: NetworkTariff["network"];
    whatsAppRateCents?: number;
  },
): Promise<AudiencePreview> {
  const now = input.now ?? new Date();
  const contacts = await loadContacts(client, input.businessId, input.definition);
  const [marketingConsent, transactionalConsent, suppressed, marketing] = await Promise.all([
    latestConsentMap(client, input.businessId, input.channel, "MARKETING"),
    latestConsentMap(client, input.businessId, input.channel, "TRANSACTIONAL"),
    suppressionSet(client, input.businessId, input.channel),
    marketingCounts(client, input.businessId, now),
  ]);

  const segments = calculateSegments(input.body).segments;
  const smsCost = estimateSmsCost(input.body, { network: input.network ?? "MULTI", tariffs: input.tariffs, recipientCount: 1 });

  const members: AudienceMember[] = [];
  const excluded: AudienceExclusion[] = [];

  for (const contact of contacts) {
    const phoneNormalized = String(contact.phoneNormalized ?? "");
    const consent = {
      marketing: Boolean(marketingConsent.get(contact.id)) && input.purpose === "MARKETING",
      transactional: transactionalConsent.get(contact.id) !== false,
    };
    const result = evaluateEligibility({
      contact: {
        id: contact.id,
        name: contact.name,
        phoneNormalized,
        status: contact.status,
        customerId: contact.customerId,
        consent,
        suppressed: suppressed.has(phoneNormalized),
      },
      channel: input.channel,
      purpose: input.purpose,
      now,
      marketingMessagesLast30Days: marketing.get(phoneNormalized) ?? 0,
    });
    if (result.eligible) {
      const costCents = input.channel === "WHATSAPP"
        ? Math.max(0, Math.round(input.whatsAppRateCents ?? 0))
        : smsCost.perSegmentCents * segments;
      members.push({ contactId: contact.id, name: contact.name ?? null, phoneNormalized, customerId: contact.customerId ?? null, segments, costCents });
    } else {
      excluded.push({ contactId: contact.id, name: contact.name ?? null, phoneNormalized, code: result.code, reason: result.reason });
    }
  }

  const estimatedCostCents = members.reduce((total, member) => total + member.costCents, 0);
  const whatsApp = input.channel === "WHATSAPP" ? estimateWhatsAppCost(input.purpose === "MARKETING" ? "MARKETING" : "UTILITY", members.length, input.whatsAppRateCents ?? 0) : null;

  return {
    channel: input.channel,
    purpose: input.purpose,
    members,
    excluded,
    totalContacts: contacts.length,
    eligibleCount: members.length,
    excludedCount: excluded.length,
    estimatedCostCents,
    segmentsPerMessage: segments,
    encoding: calculateSegments(input.body).encoding,
    perSegmentCents: smsCost.perSegmentCents,
    costNote: whatsApp
      ? whatsApp.note
      : `Estimated at KES ${(smsCost.perSegmentCents / 100).toFixed(2)} per segment. ${smsCost.verified ? "" : "This rate is a configured reference, not a confirmed provider tariff."}`.trim(),
  };
}

export type CreateCampaignInput = {
  businessId: string;
  actorId?: string | null;
  actorName?: string | null;
  name: string;
  channel: ContactChannel;
  purpose: CampaignPurpose;
  body: string;
  audience: AudienceDefinition;
  audienceId?: string | null;
  templateId?: string | null;
  senderIdId?: string | null;
  scheduledAt?: Date | string | null;
  timeZone?: string;
  notes?: string | null;
  dedupeKey?: string | null;
  whatsappTemplateName?: string | null;
  whatsappTemplateStatus?: string | null;
};

export async function createCampaign(client: any, input: CreateCampaignInput) {
  if (!input.name || input.name.trim().length < 3) throw Object.assign(new Error("Give the campaign a name you'll recognise later."), { status: 400 });
  const validation = validateTemplate({
    body: input.body,
    channel: input.channel === "WHATSAPP" ? "WHATSAPP" : input.channel === "EMAIL" ? "EMAIL" : "SMS",
    category: input.purpose,
    whatsappTemplateName: input.whatsappTemplateName,
    whatsappTemplateStatus: input.whatsappTemplateStatus,
  });
  if (!validation.ok) throw Object.assign(new Error(validation.errors[0]), { status: 400, code: "TEMPLATE_INVALID" });

  const campaign = await client.msgCampaign.create({
    data: {
      businessId: input.businessId,
      name: input.name.trim(),
      channel: input.channel,
      purpose: input.purpose,
      status: "DRAFT",
      audienceId: input.audienceId ?? null,
      audienceJson: JSON.stringify(input.audience),
      templateId: input.templateId ?? null,
      messageBody: input.body,
      senderIdId: input.senderIdId ?? null,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      timeZone: input.timeZone ?? "Africa/Nairobi",
      notes: input.notes ?? null,
      dedupeKey: input.dedupeKey ?? null,
      createdById: input.actorId ?? null,
      approvalRequired: true,
    },
  });
  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId,
    actorName: input.actorName,
    action: "CAMPAIGN_CREATED",
    targetType: "CAMPAIGN",
    targetId: campaign.id,
    after: { name: campaign.name, channel: campaign.channel, purpose: campaign.purpose },
    client,
  });
  return campaign;
}

/**
 * Materialise the audience into recipient rows and store the priced estimate. Recipient rows are
 * the durable outbox; the unique (campaign, phone) index makes a repeated plan idempotent.
 */
export async function planCampaign(
  client: any,
  input: { businessId: string; campaignId: string; now?: Date; network?: NetworkTariff["network"]; whatsAppRateCents?: number; tariffs?: NetworkTariff[] },
) {
  const campaign = await client.msgCampaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign || campaign.businessId !== input.businessId) throw Object.assign(new Error("That campaign was not found."), { status: 404 });
  if (["DISPATCHING", "COMPLETED", "PARTIALLY_COMPLETED", "CANCELLED"].includes(String(campaign.status))) {
    throw Object.assign(new Error("This campaign can no longer be re-planned."), { status: 409 });
  }

  let definition: AudienceDefinition;
  try {
    definition = JSON.parse(campaign.audienceJson || "{}");
  } catch {
    definition = { mode: "ALL_ELIGIBLE" };
  }

  const preview = await previewAudience(client, {
    businessId: input.businessId,
    definition,
    channel: campaign.channel as ContactChannel,
    purpose: campaign.purpose as CampaignPurpose,
    body: campaign.messageBody,
    now: input.now ?? new Date(),
    network: input.network,
    whatsAppRateCents: input.whatsAppRateCents,
    tariffs: input.tariffs,
  });

  for (const member of preview.members) {
    const idempotencyKey = `campaign:${campaign.id}:contact:${member.contactId}`;
    const existing = await client.msgCampaignRecipient.findUnique({
      where: { campaignId_phoneNormalized: { campaignId: campaign.id, phoneNormalized: member.phoneNormalized } },
    }).catch(() => null);
    if (existing) continue;
    await client.msgCampaignRecipient.create({
      data: {
        businessId: input.businessId,
        campaignId: campaign.id,
        contactId: member.contactId,
        phoneNormalized: member.phoneNormalized,
        name: member.name,
        status: "QUEUED",
        segments: member.segments,
        costCents: member.costCents,
        idempotencyKey,
      },
    });
  }

  for (const excluded of preview.excluded) {
    const existing = await client.msgCampaignRecipient.findUnique({
      where: { campaignId_phoneNormalized: { campaignId: campaign.id, phoneNormalized: excluded.phoneNormalized } },
    }).catch(() => null);
    if (existing) {
      if (existing.status === "QUEUED") {
        await client.msgCampaignRecipient.update({
          where: { id: existing.id },
          data: { status: "BLOCKED", exclusionReason: excluded.reason, costCents: 0 },
        });
      }
      continue;
    }
    await client.msgCampaignRecipient.create({
      data: {
        businessId: input.businessId,
        campaignId: campaign.id,
        contactId: excluded.contactId,
        phoneNormalized: excluded.phoneNormalized,
        name: excluded.name,
        status: "BLOCKED",
        exclusionReason: excluded.reason,
        segments: preview.segmentsPerMessage,
        costCents: 0,
        idempotencyKey: `campaign:${campaign.id}:contact:${excluded.contactId}:blocked`,
      },
    });
  }

  const updated = await client.msgCampaign.update({
    where: { id: campaign.id },
    data: {
      status: "READY_FOR_REVIEW",
      totalRecipients: preview.totalContacts,
      eligibleRecipients: preview.eligibleCount,
      excludedRecipients: preview.excludedCount,
      estimatedCostCents: preview.estimatedCostCents,
    },
  });

  return { campaign: updated, preview };
}

export type ApproveCampaignInput = {
  businessId: string;
  campaignId: string;
  actorId?: string | null;
  actorName?: string | null;
  role: ErpRole;
  /** The owner has seen and accepted the actual estimated cost. */
  costConfirmed: boolean;
  separationOfDuties?: boolean;
};

/**
 * Approve a campaign: permission, amount, sender state, channel state, consent revalidation and
 * available credit — in that order — before anything is reserved. Approval does not send.
 */
export async function approveCampaign(client: any, input: ApproveCampaignInput) {
  const campaign = await client.msgCampaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign || campaign.businessId !== input.businessId) throw Object.assign(new Error("That campaign was not found."), { status: 404 });
  if (!["READY_FOR_REVIEW", "DRAFT", "PAUSED"].includes(String(campaign.status))) {
    throw Object.assign(new Error("This campaign is not waiting for approval."), { status: 409, code: "NOT_APPROVABLE" });
  }
  if (!input.costConfirmed) {
    throw Object.assign(new Error("Review the recipients and estimated cost, then confirm before approving."), { status: 400, code: "COST_NOT_CONFIRMED" });
  }

  const decision = approvalDecision({
    role: input.role,
    amountCents: Number(campaign.estimatedCostCents),
    initiatorId: campaign.createdById ?? null,
    approverId: input.actorId ?? null,
    separationOfDuties: input.separationOfDuties,
  });
  if (!decision.allowed) throw Object.assign(new Error(decision.reason), { status: 403, code: "APPROVAL_DENIED" });

  const sender = campaign.senderIdId ? await client.msgSenderId.findUnique({ where: { id: campaign.senderIdId } }) : null;
  if (campaign.channel === "SMS") {
    const senderCheck = senderIdCanSend(sender);
    if (!senderCheck.ok) throw Object.assign(new Error(senderCheck.reason), { status: 409, code: "SENDER_NOT_APPROVED" });
  }
  if (campaign.channel === "WHATSAPP") {
    const connection = await client.msgChannelConnection.findUnique({
      where: { businessId_channel: { businessId: input.businessId, channel: "WHATSAPP" } },
    }).catch(() => null);
    if (!connection || String(connection.status).toUpperCase() !== "ACTIVE") {
      throw Object.assign(new Error("Connect and verify WhatsApp before approving a WhatsApp campaign."), { status: 409, code: "CHANNEL_NOT_ACTIVE" });
    }
  }

  if (!campaign.estimatedCostCents || Number(campaign.eligibleRecipients) === 0) {
    throw Object.assign(new Error("There are no eligible recipients to approve. Review the exclusions first."), { status: 409, code: "NO_RECIPIENTS" });
  }

  const reservation = await reserveFunds(client, {
    businessId: input.businessId,
    amountCents: Number(campaign.estimatedCostCents),
    campaignId: campaign.id,
    idempotencyKey: `campaign:${campaign.id}:reserve`,
  });

  const approved = await client.msgCampaign.update({
    where: { id: campaign.id },
    data: {
      status: campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > Date.now() ? "SCHEDULED" : "APPROVED",
      approvedById: input.actorId ?? null,
      approvedAt: new Date(),
      reservedCents: reservation.reserved,
    },
  });

  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId,
    actorName: input.actorName,
    action: "CAMPAIGN_APPROVED",
    targetType: "CAMPAIGN",
    targetId: campaign.id,
    after: { estimatedCostCents: campaign.estimatedCostCents, eligibleRecipients: campaign.eligibleRecipients, status: approved.status },
    client,
  });

  return { campaign: approved, reservedCents: reservation.reserved, idempotent: reservation.idempotent };
}

/**
 * Pause stops new claims immediately. Messages already accepted by the provider are not recalled —
 * no system can do that, and pretending otherwise would be a lie.
 */
export async function pauseCampaign(client: any, input: { businessId: string; campaignId: string; actorId?: string | null; actorName?: string | null; reason: string }) {
  const campaign = await client.msgCampaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign || campaign.businessId !== input.businessId) throw Object.assign(new Error("That campaign was not found."), { status: 404 });
  if (!["APPROVED", "SCHEDULED", "DISPATCHING"].includes(String(campaign.status))) {
    throw Object.assign(new Error("Only a running or scheduled campaign can be paused."), { status: 409 });
  }
  // A pause stops messages, so it needs a reason a colleague can act on later.
  if (!input.reason || input.reason.trim().length < 5) {
    throw Object.assign(new Error("Say why the campaign is being paused — the reason is kept on the record."), { status: 400, code: "REASON_REQUIRED" });
  }
  const updated = await client.msgCampaign.update({
    where: { id: campaign.id },
    data: { status: "PAUSED", pausedAt: new Date(), failureReason: input.reason || null },
  });
  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId,
    actorName: input.actorName,
    action: "CAMPAIGN_PAUSED",
    targetType: "CAMPAIGN",
    targetId: campaign.id,
    reason: input.reason || null,
    client,
  });
  return updated;
}

export async function resumeCampaign(client: any, input: { businessId: string; campaignId: string; actorId?: string | null; actorName?: string | null }) {
  const campaign = await client.msgCampaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign || campaign.businessId !== input.businessId) throw Object.assign(new Error("That campaign was not found."), { status: 404 });
  if (String(campaign.status) !== "PAUSED") throw Object.assign(new Error("That campaign is not paused."), { status: 409 });
  const next = campaign.startedAt ? "DISPATCHING" : "APPROVED";
  const updated = await client.msgCampaign.update({ where: { id: campaign.id }, data: { status: next, pausedAt: null } });
  await logErpAudit({ businessId: input.businessId, actorId: input.actorId, actorName: input.actorName, action: "CAMPAIGN_RESUMED", targetType: "CAMPAIGN", targetId: campaign.id, client });
  return updated;
}

/**
 * Cancel releases the reservation for recipients that were never submitted. Already-submitted
 * messages stay submitted and are still charged — that is the documented cutoff.
 */
export async function cancelCampaign(client: any, input: { businessId: string; campaignId: string; actorId?: string | null; actorName?: string | null; reason: string }) {
  const campaign = await client.msgCampaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign || campaign.businessId !== input.businessId) throw Object.assign(new Error("That campaign was not found."), { status: 404 });
  if (["COMPLETED", "PARTIALLY_COMPLETED", "CANCELLED", "FAILED"].includes(String(campaign.status))) {
    throw Object.assign(new Error("This campaign has already finished."), { status: 409 });
  }
  if (!input.reason || input.reason.trim().length < 5) {
    throw Object.assign(new Error("Say why the campaign is being cancelled — the reason is kept on the record."), { status: 400, code: "REASON_REQUIRED" });
  }

  const queued = await client.msgCampaignRecipient.findMany({ where: { campaignId: campaign.id, status: { in: ["QUEUED", "BLOCKED", "UNKNOWN"] } } });
  let released = 0;
  for (const recipient of queued) {
    if (String(recipient.status) === "QUEUED" && Number(recipient.costCents) > 0) {
      const result = await releaseReserved(client, {
        businessId: input.businessId,
        campaignId: campaign.id,
        idempotencyKey: `release:${recipient.id}`,
        amountCents: Number(recipient.costCents),
      });
      if (!result.idempotent) released += result.settled;
    }
    await client.msgCampaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "SKIPPED", exclusionReason: String(recipient.status) === "BLOCKED" ? recipient.exclusionReason : "Campaign cancelled before sending." },
    });
  }

  const updated = await client.msgCampaign.update({
    where: { id: campaign.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), completedAt: new Date(), failureReason: input.reason || null },
  });
  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId,
    actorName: input.actorName,
    action: "CAMPAIGN_CANCELLED",
    targetType: "CAMPAIGN",
    targetId: campaign.id,
    reason: input.reason || null,
    after: { releasedReservationCents: released, skippedRecipients: queued.length },
    client,
  });
  return { campaign: updated, releasedCents: released, skipped: queued.length };
}

export async function campaignCostPreview(client: any, businessId: string, campaignId: string) {
  const campaign = await client.msgCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.businessId !== businessId) throw Object.assign(new Error("That campaign was not found."), { status: 404 });
  const wallet = await walletSummary(client, businessId);
  const estimated = Number(campaign.estimatedCostCents);
  return {
    estimatedCostCents: estimated,
    reservedCents: Number(campaign.reservedCents),
    actualCostCents: Number(campaign.actualCostCents),
    wallet,
    sufficient: wallet.availableCents >= estimated,
    shortfallCents: Math.max(0, estimated - wallet.availableCents),
  };
}

export const DEFAULT_TARIFFS = DEFAULT_SMS_TARIFFS;
