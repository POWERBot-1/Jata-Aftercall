/**
 * AI Front Desk publication lifecycle (P0 remediation).
 *
 * The LIVE label is a *derived* fact, never a stored flag a caller can assert:
 *
 *   business.isPublished            → the page was published (persisted publication state)
 *   AIConfiguration.operationalStatus → the owner's operational switch (LIVE/PAUSED/...)
 *   AIPackageEntitlement / Subscription / Payment → the server-verified paid entitlement
 *
 * A Front Desk is only LIVE when all three agree. Any other combination has its own honest
 * state, so a record simply existing — or a publish request having been attempted — can never
 * produce a LIVE label:
 *
 *   DRAFT      not published (or published but the owner never activated the desk)
 *   PREVIEW    the owner is looking at their own private preview
 *   LIVE       published AND entitled AND switched on
 *   PAUSED     published and entitled, owner paused the desk
 *   MAINTENANCE published and entitled, owner put the desk in maintenance
 *   SUSPENDED  published earlier but no longer entitled (expired/cancelled/refunded/unpaid)
 *
 * Nothing here accepts a client-supplied flag, a URL parameter, a cached browser value or a
 * "payment succeeded" redirect: every input is read from the database by the server. When the
 * billing lookup cannot be completed the answer is a refusal (fail closed), never an allowance.
 */

import prisma from "./db";
import { getAIPackageStatus, type AIEntitlementStatus, type AIPackageStatusResult } from "./ai-entitlement";
import { getExtendedAIConfig } from "./ai-config";

export const AI_FRONT_DESK_STATES = [
  "DRAFT",
  "PREVIEW",
  "LIVE",
  "PAUSED",
  "MAINTENANCE",
  "SUSPENDED",
] as const;

export type AIFrontDeskState = (typeof AI_FRONT_DESK_STATES)[number];

/** The operational switch an owner may write. "PREVIEW" is a view, not a stored operational state. */
export const AI_OWNER_ACTIVATABLE_STATES = ["LIVE", "PAUSED", "MAINTENANCE", "DRAFT", "CONFIGURED", "PREVIEW"] as const;

export type AIFrontDeskDenialCode =
  | "NOT_PUBLISHED"
  | "SUBSCRIPTION_REQUIRED"
  | "BILLING_UNAVAILABLE";

export type AIFrontDeskPublication = {
  state: AIFrontDeskState;
  /** True only for LIVE: this is the one state customers may reach and be answered by. */
  publiclyOperational: boolean;
  isPublished: boolean;
  operationalStatus: string;
  entitled: boolean;
  /** Currency of the entitlement row, so the UI can explain *why* access is missing. */
  entitlementStatus: AIEntitlementStatus | "UNKNOWN";
  reason: string;
};

/**
 * Pure derivation. Every input is server-loaded; the function has no notion of a request body.
 */
export function deriveAIFrontDeskPublication(input: {
  isPublished: boolean;
  operationalStatus?: string | null;
  entitlement?: Pick<AIPackageStatusResult, "entitled" | "status" | "reason"> | null;
  preview?: boolean;
}): AIFrontDeskPublication {
  const operationalStatus = String(input.operationalStatus || "DRAFT").toUpperCase();
  const entitled = input.entitlement?.entitled === true;
  const entitlementStatus = (input.entitlement?.status as AIEntitlementStatus | undefined) ?? "UNKNOWN";
  const isPublished = input.isPublished === true;

  const base: Omit<AIFrontDeskPublication, "state" | "publiclyOperational" | "reason"> = {
    isPublished,
    operationalStatus,
    entitled,
    entitlementStatus,
  };

  // An owner's private preview is always a PREVIEW, never LIVE: the label must not promise
  // customers something that has not been published and paid for.
  if (input.preview) {
    return {
      ...base,
      state: "PREVIEW",
      publiclyOperational: false,
      reason: "Private preview — this Front Desk is not visible to customers.",
    };
  }

  if (!isPublished) {
    return {
      ...base,
      state: "DRAFT",
      publiclyOperational: false,
      reason: "Draft — publish after an active AI Business Front Desk subscription is confirmed.",
    };
  }

  if (!entitled) {
    return {
      ...base,
      state: "SUSPENDED",
      publiclyOperational: false,
      reason:
        input.entitlement?.reason ||
        "This Front Desk is not covered by an active, verified subscription, so it is not serving customers.",
    };
  }

  if (operationalStatus === "PAUSED") {
    return {
      ...base,
      state: "PAUSED",
      publiclyOperational: false,
      reason: "Paused by the owner. Existing records stay available; customers are handed to a person.",
    };
  }

  if (operationalStatus === "MAINTENANCE") {
    return {
      ...base,
      state: "MAINTENANCE",
      publiclyOperational: false,
      reason: "In maintenance. Customers are handed to a person until the owner switches it back on.",
    };
  }

  if (operationalStatus !== "LIVE") {
    // Published and paid for, but the operational switch was never turned on (DRAFT/CONFIGURED).
    return {
      ...base,
      state: "DRAFT",
      publiclyOperational: false,
      reason: "Published configuration is not activated yet — switch the Front Desk on to answer customers.",
    };
  }

  return {
    ...base,
    state: "LIVE",
    publiclyOperational: true,
    reason: "Live and covered by an active, server-verified subscription.",
  };
}

/**
 * Reads the three authoritative records for one tenant and derives the state.
 *
 * `businessId` must already have been authorised for the calling user *before* this runs; this
 * function answers "what is the state", not "may this person look at it".
 */
export async function getAIFrontDeskPublication(
  businessId: string,
  options: { preview?: boolean } = {},
): Promise<AIFrontDeskPublication> {
  let isPublished = false;
  let operationalStatus = "DRAFT";
  let entitlement: AIPackageStatusResult | null = null;

  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { isPublished: true, status: true },
    });
    isPublished = business?.isPublished === true && business?.status !== "SUSPENDED";
  } catch {
    isPublished = false;
  }

  try {
    const config = await getExtendedAIConfig(businessId);
    operationalStatus = config.operationalStatus;
  } catch {
    operationalStatus = "DRAFT";
  }

  try {
    entitlement = await getAIPackageStatus(businessId);
  } catch {
    // Fail closed: an unavailable billing service is not a paid subscription.
    entitlement = null;
  }

  return deriveAIFrontDeskPublication({
    isPublished,
    operationalStatus,
    entitlement:
      entitlement ?? { entitled: false, status: "NONE", reason: "Billing verification is unavailable right now." },
    preview: options.preview,
  });
}

/**
 * The gate every live-operational code path calls before it answers a customer.
 *
 * `preview: true` is the owner's own sandbox (callers must already have proved tenant access);
 * everything else needs a published, activated, entitled Front Desk. The result is explicit so
 * routes can pick an honest HTTP status and a plain-language message.
 */
export type AIFrontDeskAuthorization = {
  allowed: boolean;
  /** Null when allowed. */
  code: AIFrontDeskDenialCode | null;
  reason: string;
  publication: AIFrontDeskPublication;
};

export async function authorizeAIFrontDeskOperation(input: {
  businessId: string;
  preview?: boolean;
}): Promise<AIFrontDeskAuthorization> {
  if (input.preview) {
    const publication = await getAIFrontDeskPublication(input.businessId, { preview: true });
    return { allowed: true, code: null, reason: "Private preview.", publication };
  }

  const publication = await getAIFrontDeskPublication(input.businessId);

  if (publication.state === "LIVE") {
    return { allowed: true, code: null, reason: publication.reason, publication };
  }

  if (!publication.isPublished) {
    return {
      allowed: false,
      code: "NOT_PUBLISHED",
      reason: "This AI Front Desk is not published yet.",
      publication,
    };
  }

  if (publication.entitlementStatus === "UNKNOWN") {
    return {
      allowed: false,
      code: "BILLING_UNAVAILABLE",
      reason: "We could not confirm the subscription right now. Please try again in a moment.",
      publication,
    };
  }

  return {
    allowed: false,
    code: "SUBSCRIPTION_REQUIRED",
    reason: publication.reason,
    publication,
  };
}

/**
 * Whether a requested operational switch may be written.
 *
 * Switching a desk *off* (paused / maintenance / draft) is always allowed: an owner must never
 * be locked out of stopping customer answers. Switching it *on* needs a verified entitlement —
 * this is what stops a direct `POST /api/ai/status` from granting a live Front Desk.
 */
export function canApplyOperationalStatus(
  next: string,
  entitlement: Pick<AIPackageStatusResult, "entitled"> | null | undefined,
): { allowed: boolean; code?: AIFrontDeskDenialCode; reason?: string } {
  const normalized = String(next || "").toUpperCase();
  if (!(AI_OWNER_ACTIVATABLE_STATES as readonly string[]).includes(normalized)) {
    return { allowed: false, code: "NOT_PUBLISHED", reason: "That operational status is not recognised." };
  }
  if (normalized !== "LIVE") return { allowed: true };
  if (entitlement?.entitled === true) return { allowed: true };
  return {
    allowed: false,
    code: "SUBSCRIPTION_REQUIRED",
    reason:
      "An active AI Business Front Desk subscription (verified by our server) is required before the desk can be switched LIVE.",
  };
}
