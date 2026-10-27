/**
 * Sender Identity Centre — application lifecycle
 *
 * A Sender ID is approved by the provider and the network, not by us and not by a form. This
 * module models the whole lifecycle honestly: a customer can prepare, validate, submit and
 * resubmit; only an authenticated provider event or a clearly-labelled authorised review can move
 * an application to approved or active. Fees are disclosed and acknowledged before an application
 * is submitted, but no money is taken here — charging is a separate, approved step.
 *
 * Branded alphanumeric sender IDs are treated as outbound-only. Genuine two-way messaging needs a
 * reply-capable number, short code or WhatsApp; the model records `replyCapable` rather than
 * implying it.
 */

import { logErpAudit } from "../erp/audit";

export const SENDER_STATUSES = [
  "DRAFT",
  "INFORMATION_REQUIRED",
  "READY_TO_SUBMIT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "ACTIVATION_PENDING",
  "ACTIVE",
  "REJECTED",
  "SUSPENDED",
  "EXPIRED",
] as const;

export type SenderStatus = (typeof SENDER_STATUSES)[number];

export const SENDER_STATUS_LABELS: Record<SenderStatus, string> = {
  DRAFT: "Draft",
  INFORMATION_REQUIRED: "Information required",
  READY_TO_SUBMIT: "Ready to submit",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  ACTIVATION_PENDING: "Activation pending",
  ACTIVE: "Active",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
  EXPIRED: "Expired",
};

export const SENDER_STATUS_TONE: Record<SenderStatus, "neutral" | "good" | "warn" | "bad"> = {
  DRAFT: "neutral",
  INFORMATION_REQUIRED: "warn",
  READY_TO_SUBMIT: "warn",
  SUBMITTED: "warn",
  UNDER_REVIEW: "warn",
  CHANGES_REQUESTED: "bad",
  APPROVED: "good",
  ACTIVATION_PENDING: "warn",
  ACTIVE: "good",
  REJECTED: "bad",
  SUSPENDED: "bad",
  EXPIRED: "bad",
};

export type SenderActor = "CUSTOMER" | "PROVIDER" | "ADMIN" | "SYSTEM";

/**
 * Allowed transitions. The customer can prepare and submit; it can never approve itself. A
 * provider outcome can be applied only through the authenticated adapter path.
 */
const CUSTOMER_TRANSITIONS: Partial<Record<SenderStatus, SenderStatus[]>> = {
  DRAFT: ["READY_TO_SUBMIT", "INFORMATION_REQUIRED"],
  INFORMATION_REQUIRED: ["READY_TO_SUBMIT"],
  READY_TO_SUBMIT: ["SUBMITTED"],
  CHANGES_REQUESTED: ["READY_TO_SUBMIT"],
  APPROVED: ["ACTIVATION_PENDING"], // only reachable with provider evidence; kept for completeness
};

const PROVIDER_TRANSITIONS: Partial<Record<SenderStatus, SenderStatus[]>> = {
  SUBMITTED: ["UNDER_REVIEW", "APPROVED", "REJECTED", "CHANGES_REQUESTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "CHANGES_REQUESTED"],
  APPROVED: ["ACTIVATION_PENDING", "ACTIVE"],
  ACTIVATION_PENDING: ["ACTIVE"],
  ACTIVE: ["SUSPENDED", "EXPIRED"],
  SUSPENDED: ["ACTIVE", "EXPIRED"],
};

export function canTransitionSender(from: string, to: string, actor: SenderActor): { allowed: boolean; reason: string } {
  const source = String(from).toUpperCase() as SenderStatus;
  const target = String(to).toUpperCase() as SenderStatus;
  if (!SENDER_STATUSES.includes(source) || !SENDER_STATUSES.includes(target)) {
    return { allowed: false, reason: "That status is not part of the application lifecycle." };
  }
  if (source === target) return { allowed: false, reason: "The application is already in that state." };

  if (actor === "CUSTOMER") {
    const allowed = CUSTOMER_TRANSITIONS[source] ?? [];
    if (!allowed.includes(target)) {
      return {
        allowed: false,
        reason:
          target === "APPROVED" || target === "ACTIVE"
            ? "Only the provider and the network can approve or activate a Sender ID. We'll show it here as soon as that happens."
            : "That step is not available yet. Complete the checklist first.",
      };
    }
    return { allowed: true, reason: "Allowed." };
  }

  if (actor === "ADMIN") {
    // An authorised manual review may record a decision, but it is labelled as manual in the event
    // log and never fabricates a provider reference.
    return { allowed: target !== "ACTIVE" || source === "APPROVED" || source === "ACTIVATION_PENDING" || source === "SUSPENDED",
      reason: "Recorded as an authorised manual review." };
  }

  if (actor === "SYSTEM") {
    return { allowed: true, reason: "System reconciliation." };
  }

  const allowed = PROVIDER_TRANSITIONS[source] ?? [];
  return allowed.includes(target)
    ? { allowed: true, reason: "Provider event accepted." }
    : { allowed: false, reason: `A provider cannot move ${SENDER_STATUS_LABELS[source]} to ${SENDER_STATUS_LABELS[target]}.` };
}

const RESERVED_WORDS = ["KRA", "GOV", "GOVERNMENT", "POLICE", "SAFARICOM", "AIRTEL", "TELKOM", "MPESA", "M-PESA", "JATA", "BANK", "SACCO", "UN", "WHO", "NGO", "TELECOM", "EMERGENCY", "112", "999"];

export type SenderIdValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Preliminary only — this is not approval. */
  preliminary: true;
};

/**
 * Validate a proposed Sender ID against known naming rules. This is a *pre-submission* check and
 * says so; it cannot know whether the network will accept the name.
 */
export function validateSenderIdName(name: string, options: { existing?: string[] } = {}): SenderIdValidation {
  const value = String(name ?? "").trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!/^[A-Za-z0-9]{3,11}$/.test(value)) {
    errors.push("Use 3 to 11 letters and numbers with no spaces, for example NYUMBANI or JATACARE.");
  }
  if (!/[A-Za-z]/.test(value)) {
    errors.push("A Sender ID cannot be only numbers. Customers would not know who it came from.");
  }
  const upper = value.toUpperCase();
  if (RESERVED_WORDS.some((word) => upper === word || upper.includes(word))) {
    errors.push(`"${value}" uses a name reserved for a regulator, network or another brand. Choose a name your business owns.`);
  }
  if (options.existing?.some((existing) => existing.toUpperCase() === upper)) {
    errors.push("You already have an application for that Sender ID.");
  }
  if (/^(TEST|DEMO|SAMPLE)/i.test(value)) {
    warnings.push("Generic names are often rejected by networks. A brand name your customers recognise works better.");
  }
  return { ok: errors.length === 0, errors, warnings, preliminary: true };
}

export type KycRequirement = {
  key: string;
  label: string;
  explanation: string;
  required: boolean;
};

/** The checklist shown to a customer, with the reason each item is needed. */
export function kycRequirements(channel: "SMS" | "WHATSAPP" = "SMS"): KycRequirement[] {
  const base: KycRequirement[] = [
    { key: "business_name", label: "Registered business name", explanation: "Must match the name on your registration certificate.", required: true },
    { key: "business_registration", label: "Business registration certificate", explanation: "Proves the business exists and who may act for it.", required: true },
    { key: "kra_pin", label: "KRA PIN", explanation: "The provider needs this to verify the business for messaging.", required: true },
    { key: "authorised_representative", label: "Authorised representative", explanation: "The person allowed to apply on behalf of the business.", required: true },
    { key: "id_document", label: "Representative ID or passport", explanation: "Used only to verify the representative. Stored securely and access-restricted.", required: true },
    { key: "brand_authority", label: "Proof you may use this name", explanation: "A trademark, domain, utility bill or letter showing the brand belongs to you.", required: true },
  ];
  if (channel === "WHATSAPP") {
    base.push({ key: "whatsapp_number", label: "Business phone number", explanation: "The number must not already be on a personal WhatsApp account.", required: true });
    base.push({ key: "facebook_business", label: "Meta Business account access", explanation: "WhatsApp Business Platform requires an approved business portfolio.", required: true });
  }
  return base;
}

export const SENDER_ID_FEES = [
  {
    code: "SENDER_ID_REGISTRATION",
    label: "Sender ID registration (provider and network)",
    amountCents: 0,
    currency: "KES",
    recurring: false,
    note: "The fee is set by the approved provider and the network. It is shown before you confirm and is never charged automatically here.",
  },
] as const;

export type SenderIdRecord = {
  id?: string;
  businessId: string;
  channel?: string;
  requestedId: string;
  status: string;
  purpose?: string;
  network?: string | null;
  applicationRef?: string | null;
  submittedAt?: Date | string | null;
  approvedAt?: Date | string | null;
  activatedAt?: Date | string | null;
  rejectionReason?: string | null;
  missingItemsJson?: string | null;
  feesJson?: string | null;
  feeAcknowledgedAt?: Date | string | null;
  replyCapable?: boolean;
};

export function missingKycItems(input: { requirements: KycRequirement[]; provided: string[]; businessProfileComplete: boolean }): string[] {
  const missing: string[] = [];
  if (!input.businessProfileComplete) missing.push("Business profile (legal name, KRA PIN, county)");
  for (const requirement of input.requirements) {
    if (requirement.required && !input.provided.includes(requirement.key)) missing.push(requirement.label);
  }
  return missing;
}

/** Can this Sender ID be used to send right now? No substitution, no optimistic fallback. */
export function senderIdCanSend(sender: { status?: string | null; channel?: string | null; requestedId?: string | null } | null | undefined): { ok: boolean; reason: string } {
  if (!sender) return { ok: false, reason: "Choose an approved Sender ID before sending." };
  const status = String(sender.status ?? "").toUpperCase();
  if (status !== "ACTIVE") {
    return {
      ok: false,
      reason: `Your Sender ID is ${SENDER_STATUS_LABELS[status as SenderStatus]?.toLowerCase() ?? "not active"}. You can prepare campaigns, but nothing can be sent until it is active.`,
    };
  }
  return { ok: true, reason: "Sender ID is active." };
}

/** Two-way capability, stated plainly. */
export function replyCapability(sender: { replyCapable?: boolean | null; channel?: string | null }): { twoWay: boolean; note: string } {
  if (String(sender.channel ?? "SMS").toUpperCase() === "WHATSAPP") {
    return { twoWay: true, note: "WhatsApp Business supports customer-initiated replies within the provider's messaging window." };
  }
  if (sender.replyCapable) {
    return { twoWay: true, note: "This number is configured for replies by the provider." };
  }
  return {
    twoWay: false,
    note: "A branded alphanumeric Sender ID is outbound-only. For replies, use WhatsApp or a reply-capable number or short code.",
  };
}

/**
 * Submit an application. Provider submission is delegated to an adapter; when no live provider is
 * configured the record is still submitted locally and clearly labelled as awaiting the provider —
 * never "approved".
 */
export async function submitSenderApplication(
  client: any,
  input: {
    businessId: string;
    senderIdId: string;
    actorId?: string | null;
    actorName?: string | null;
    requirements: KycRequirement[];
    provided: string[];
    businessProfileComplete: boolean;
    feeAcknowledged: boolean;
    provider?: { submitApplication: (payload: any) => Promise<{ ok: boolean; reference?: string; message?: string }> } | null;
  },
): Promise<{ ok: boolean; status: SenderStatus; missing: string[]; reference?: string | null; message: string }> {
  const sender = await client.msgSenderId.findUnique({ where: { id: input.senderIdId } });
  if (!sender || sender.businessId !== input.businessId) {
    throw Object.assign(new Error("That Sender ID application was not found."), { status: 404 });
  }

  const missing = missingKycItems({ requirements: input.requirements, provided: input.provided, businessProfileComplete: input.businessProfileComplete });
  if (missing.length) {
    await client.msgSenderId.update({
      where: { id: sender.id },
      data: { status: "INFORMATION_REQUIRED", missingItemsJson: JSON.stringify(missing) },
    });
    return { ok: false, status: "INFORMATION_REQUIRED", missing, message: "Some information is still needed before this can be submitted." };
  }
  if (!input.feeAcknowledged) {
    return {
      ok: false,
      status: (sender.status as SenderStatus) ?? "DRAFT",
      missing: ["Confirm the applicable fees"],
      message: "Review and confirm the fees before submitting. Nothing is charged automatically.",
    };
  }

  const check = canTransitionSender(sender.status, "SUBMITTED", "CUSTOMER");
  if (!check.allowed && sender.status !== "SUBMITTED" && sender.status !== "UNDER_REVIEW") {
    return { ok: false, status: sender.status as SenderStatus, missing: [], message: check.reason };
  }

  let reference: string | null = sender.applicationRef ?? null;
  let providerMessage = "Submitted. We'll track the provider's decision here.";
  if (input.provider) {
    try {
      const result = await input.provider.submitApplication({ businessId: input.businessId, requestedId: sender.requestedId, network: sender.network, purpose: sender.purpose });
      if (result.ok) {
        reference = result.reference ?? reference;
        providerMessage = result.message ?? providerMessage;
      } else {
        providerMessage = result.message ?? "The provider did not accept the submission yet. Your application is saved; try again from here.";
      }
    } catch {
      providerMessage = "We couldn't reach the provider just now. Your application is saved — try submitting again in a moment.";
    }
  }

  const updated = await client.msgSenderId.update({
    where: { id: sender.id },
    data: {
      status: "SUBMITTED",
      submittedAt: new Date(),
      applicationRef: reference,
      missingItemsJson: "[]",
      feeAcknowledgedAt: new Date(),
      resubmissionCount: sender.submittedAt ? Number(sender.resubmissionCount ?? 0) + 1 : Number(sender.resubmissionCount ?? 0),
    },
  });
  await client.msgSenderIdEvent.create({
    data: {
      businessId: input.businessId,
      senderIdId: sender.id,
      type: "SUBMITTED",
      fromStatus: sender.status,
      toStatus: "SUBMITTED",
      source: input.provider ? "CUSTOMER" : "CUSTOMER",
      actorId: input.actorId ?? null,
      note: providerMessage,
    },
  });
  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId,
    actorName: input.actorName,
    action: "SENDER_ID_SUBMITTED",
    targetType: "SENDER_ID",
    targetId: sender.id,
    after: { requestedId: sender.requestedId, applicationRef: reference, status: "SUBMITTED" },
    client,
  });

  return { ok: true, status: "SUBMITTED", missing: [], reference, message: providerMessage };
}

/**
 * Apply an outcome. Only provider/admin/system sources reach here; the caller must have verified
 * the provider signature upstream. Activation stamps `activatedAt`; rejection requires a reason.
 */
export async function applySenderIdOutcome(
  client: any,
  input: {
    businessId: string;
    senderIdId: string;
    status: SenderStatus;
    actor: "PROVIDER" | "ADMIN" | "SYSTEM";
    actorId?: string | null;
    note?: string | null;
    applicationRef?: string | null;
    rejectionReason?: string | null;
  },
) {
  if (input.actor === "ADMIN" && !input.note) {
    throw Object.assign(new Error("A manual review decision needs a note explaining it."), { status: 400 });
  }
  const sender = await client.msgSenderId.findUnique({ where: { id: input.senderIdId } });
  if (!sender || sender.businessId !== input.businessId) {
    throw Object.assign(new Error("That Sender ID application was not found."), { status: 404 });
  }
  const decision = canTransitionSender(sender.status, input.status, input.actor);
  if (!decision.allowed) throw Object.assign(new Error(decision.reason), { status: 409, code: "INVALID_TRANSITION" });

  // Capture the previous state before the update: an ORM may hand back a mutated row, and the
  // event log must describe the transition, not the destination twice.
  const fromStatus = sender.status;
  const now = new Date();
  const data: Record<string, unknown> = { status: input.status };
  if (input.applicationRef) data.applicationRef = input.applicationRef;
  if (input.status === "UNDER_REVIEW") data.underReviewAt = now;
  if (input.status === "APPROVED") data.approvedAt = now;
  if (input.status === "ACTIVE") {
    data.activatedAt = now;
    if (!sender.approvedAt) data.approvedAt = now;
  }
  if (input.status === "REJECTED") {
    data.rejectedAt = now;
    data.rejectionReason = input.rejectionReason ?? input.note ?? "The provider did not approve this Sender ID.";
  }
  if (input.status === "EXPIRED") data.expiresAt = now;

  const updated = await client.msgSenderId.update({ where: { id: sender.id }, data });
  await client.msgSenderIdEvent.create({
    data: {
      businessId: input.businessId,
      senderIdId: sender.id,
      type: `STATUS_${input.status}`,
      fromStatus,
      toStatus: input.status,
      source: input.actor,
      actorId: input.actorId ?? null,
      note: input.note ?? null,
    },
  });
  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId,
    action: `SENDER_ID_${input.status}`,
    targetType: "SENDER_ID",
    targetId: sender.id,
    reason: input.note ?? null,
    before: { status: sender.status },
    after: { status: input.status, applicationRef: input.applicationRef ?? sender.applicationRef },
    client,
  });
  return updated;
}
