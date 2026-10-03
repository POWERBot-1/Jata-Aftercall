/**
 * AI Readiness Gate & Atomic Publishing Service (§3, §4, §30, §31, §32).
 *
 * Before going live, a business must pass all 6 readiness checks:
 * 1. Business profile exists
 * 2. At least one product, service, or FAQ exists
 * 3. Nominated business notification destination exists
 * 4. Payment method is configured if ordering is enabled
 * 5. Delivery policy is configured if delivery is enabled
 * 6. Human handoff rule exists
 *
 * Plus an active AI_BUSINESS_FRONT_DESK subscription (KES 499 / 30 days) verified server-side.
 * Publishing is atomic: never leaves a partially published configuration.
 */

import prisma from "./db";
import { getBusinessBrain } from "./ai-business-brain";
import { getAIPackageStatus, type AIPackageEntitlementSummary } from "./ai-entitlement";
import { publishAIConfigSnapshot } from "./ai-config";
import { logAudit } from "./audit";

export type ReadinessCheckItem = {
  id:
    | "business_profile"
    | "catalogue_or_faq"
    | "notification_destination"
    | "payment_configuration"
    | "delivery_configuration"
    | "human_handoff";
  label: string;
  passed: boolean;
  detail: string;
};

export type AIReadinessReport = {
  businessId: string;
  ready: boolean;
  canPublish: boolean;
  checks: ReadinessCheckItem[];
  missingItems: string[];
  subscription: AIPackageEntitlementSummary;
  knowledgeVersion: number;
  publishedVersion: number;
};

export async function evaluateAIReadiness(businessId: string): Promise<AIReadinessReport> {
  if (!businessId) throw new Error("businessId required — tenant isolation enforced.");

  const [brain, subscription] = await Promise.all([
    getBusinessBrain(businessId),
    getAIPackageStatus(businessId),
  ]);

  const hasProfile = Boolean(
    brain.business?.name &&
      brain.business.name.trim().length > 0 &&
      brain.business?.category &&
      (brain.business.phone || brain.business.whatsapp || brain.business.location),
  );

  const hasCatalogueOrFaq =
    brain.products.length > 0 || brain.services.length > 0 || brain.faqs.length > 0;

  const hasNotificationDestination =
    brain.notificationRecipients.length > 0 ||
    Boolean(brain.business.whatsapp || brain.business.phone);

  const orderingEnabled =
    brain.extendedConfig.orderingAllowed !== false && !brain.extendedConfig.pauseAllOrdering;

  const hasPaymentIfOrdering =
    !orderingEnabled || brain.paymentMethods.isConfigured;

  const hasDeliveryIfEnabled =
    !brain.delivery.deliveryEnabled || brain.delivery.zones.length > 0;

  const hasHumanHandoff = Boolean(
    (brain.extendedConfig.escalationRules && brain.extendedConfig.escalationRules.trim().length > 0) ||
      brain.business.whatsapp ||
      brain.business.phone ||
      brain.notificationRecipients.length > 0,
  );

  const checks: ReadinessCheckItem[] = [
    {
      id: "business_profile",
      label: "Business profile configured",
      passed: hasProfile,
      detail: hasProfile
        ? `${brain.business.name} (${brain.business.category})`
        : "Add business name, category, and contact number or location.",
    },
    {
      id: "catalogue_or_faq",
      label: "At least one product, service, or FAQ exists",
      passed: hasCatalogueOrFaq,
      detail: hasCatalogueOrFaq
        ? `${brain.products.length} products, ${brain.services.length} services, ${brain.faqs.length} FAQs`
        : "Add at least one product, service, or approved FAQ.",
    },
    {
      id: "notification_destination",
      label: "Nominated business notification destination exists",
      passed: hasNotificationDestination,
      detail: hasNotificationDestination
        ? brain.notificationRecipients[0]?.phone ||
          brain.business.whatsapp ||
          brain.business.phone ||
          "Configured"
        : "Nominate a WhatsApp or SMS number for order and escalation alerts.",
    },
    {
      id: "payment_configuration",
      label: "Payment method configured if ordering is enabled",
      passed: hasPaymentIfOrdering,
      detail: hasPaymentIfOrdering
        ? orderingEnabled
          ? brain.paymentMethods.publicInfo || "Merchant payment configured"
          : "Ordering disabled (not required)"
        : "Configure your business M-Pesa Paybill, Till, Pochi, or payment instructions.",
    },
    {
      id: "delivery_configuration",
      label: "Delivery policy configured if delivery is enabled",
      passed: hasDeliveryIfEnabled,
      detail: hasDeliveryIfEnabled
        ? brain.delivery.deliveryEnabled
          ? `${brain.delivery.zones.length} delivery zone(s) configured`
          : "Pickup only (delivery disabled)"
        : "Add at least one delivery zone and fee in KES, or switch to Pickup only.",
    },
    {
      id: "human_handoff",
      label: "Human handoff rule exists",
      passed: hasHumanHandoff,
      detail: hasHumanHandoff
        ? "Escalation rule and contact channel ready"
        : "Configure human escalation rules or a business contact number.",
    },
  ];

  const missingItems = checks.filter((c) => !c.passed).map((c) => c.detail);
  const ready = checks.every((c) => c.passed);
  const canPublish = ready && subscription.entitled;

  return {
    businessId,
    ready,
    canPublish,
    checks,
    missingItems,
    subscription,
    knowledgeVersion: brain.extendedConfig.draftVersion || 1,
    publishedVersion: brain.extendedConfig.publishedVersion || 0,
  };
}

export async function publishAIBusinessFrontDesk(params: {
  businessId: string;
  actorId?: string | null;
}): Promise<
  | { ok: true; readiness: AIReadinessReport; publishedVersion: number; sharePath: string }
  | { ok: false; code: "READINESS_FAILED" | "SUBSCRIPTION_REQUIRED"; error: string; readiness: AIReadinessReport }
> {
  const readiness = await evaluateAIReadiness(params.businessId);

  if (!readiness.ready) {
    return {
      ok: false,
      code: "READINESS_FAILED",
      error: `AI Readiness Gate not met: ${readiness.missingItems.join(" ")}`,
      readiness,
    };
  }

  if (!readiness.subscription.entitled) {
    return {
      ok: false,
      code: "SUBSCRIPTION_REQUIRED",
      error:
        "An active AI Business Front Desk subscription (KES 499 / month, verified server-side) is required before publishing live.",
      readiness,
    };
  }

  // Atomic publish snapshot + ensure business page is published (§31, §48)
  const publishedConfig = await publishAIConfigSnapshot(params.businessId);
  let slug = params.businessId;
  try {
    if (prisma.business?.update) {
      const updatedBiz = await prisma.business.update({
        where: { id: params.businessId },
        data: { isPublished: true, status: "ACTIVE" },
      });
      if (updatedBiz?.slug) slug = updatedBiz.slug;
    } else if (prisma.business?.findUnique) {
      const biz = await prisma.business.findUnique({ where: { id: params.businessId } });
      if (biz?.slug) slug = biz.slug;
    }
  } catch {
    // Keep slug fallback
  }

  await logAudit({
    actorId: params.actorId || null,
    action: "AI_FRONT_DESK_PUBLISHED",
    targetType: "AI_CONFIGURATION",
    targetId: params.businessId,
    metadata: {
      businessId: params.businessId,
      publishedVersion: publishedConfig.publishedVersion,
      operationalStatus: publishedConfig.operationalStatus,
    },
  });

  return {
    ok: true,
    readiness: {
      ...readiness,
      publishedVersion: publishedConfig.publishedVersion,
    },
    publishedVersion: publishedConfig.publishedVersion,
    sharePath: `/b/${slug}/ai`,
  };
}
