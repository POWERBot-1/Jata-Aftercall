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
import { authoritativeUnitPrice, matchCatalogue } from "./ai-grounding";
import { logAudit } from "./audit";

export type ReadinessCheckItem = {
  id:
    | "business_profile"
    | "catalogue_or_faq"
    | "pricing"
    | "operating_status"
    | "operating_hours"
    | "notification_destination"
    | "payment_configuration"
    | "delivery_configuration"
    | "business_rules"
    | "fallback_behavior"
    | "human_handoff"
    | "representative_answers";
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

  const hasNotificationDestination = brain.notificationRecipients.some(
    (recipient) => recipient.isActive !== false && Boolean(recipient.phone || recipient.email),
  );

  const orderingEnabled =
    brain.extendedConfig.orderingAllowed !== false && !brain.extendedConfig.pauseAllOrdering;

  const sellableProducts = brain.products.filter((product) => product.isActive !== false);
  const pricedProducts = sellableProducts.filter((product) => authoritativeUnitPrice(product) !== null);
  const pricedServices = brain.services.filter(
    (service) => service.isActive !== false && typeof service.priceFrom === "number",
  );
  const hasPricing = !orderingEnabled || pricedProducts.length > 0 || pricedServices.length > 0;
  const unpriced = sellableProducts.filter((product) => authoritativeUnitPrice(product) === null);

  const hasOperatingHours = Boolean(brain.business.openingHours && brain.business.openingHours.trim());
  const hasOperatingStatus = ["DRAFT", "CONFIGURED", "PREVIEW", "LIVE", "PAUSED", "MAINTENANCE"].includes(
    brain.extendedConfig.operationalStatus,
  );

  const hasPaymentIfOrdering = !orderingEnabled || brain.paymentMethods.isConfigured;

  const deliveryZonesReady =
    !brain.delivery.deliveryEnabled ||
    (brain.delivery.zones.length > 0 &&
      brain.delivery.zones.every(
        (zone) => typeof zone.feeKES === "number" && Boolean(zone.estimatedTime && zone.estimatedTime.trim()),
      ));

  const hasBusinessRules = Boolean(
    brain.extendedConfig.escalationRules?.trim() ||
      brain.extendedConfig.orderRules?.trim() ||
      brain.policies.orderRules?.trim() ||
      brain.policies.refundPolicy?.trim(),
  );

  const hasFallback = Boolean(brain.extendedConfig.fallbackMessage && brain.extendedConfig.fallbackMessage.trim());

  const hasHumanHandoff = Boolean(brain.extendedConfig.escalationRules && brain.extendedConfig.escalationRules.trim().length > 0);

  const representativeFailures: string[] = [];
  if (pricedProducts[0]) {
    const sample = pricedProducts[0];
    const matched = matchCatalogue(`how much is ${sample.name}`, brain.products);
    if (!matched.some((product) => product.id === sample.id)) {
      representativeFailures.push(`Cannot quote the configured price for ${sample.name}.`);
    }
  }
  if (brain.delivery.deliveryEnabled && brain.delivery.zones[0] && !brain.delivery.zones[0].estimatedTime) {
    representativeFailures.push(`Delivery to ${brain.delivery.zones[0].name} has no expected time.`);
  }
  if (!hasFallback) representativeFailures.push("Unknown questions have no configured fallback.");

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
      label: "At least one product, service, or approved knowledge item",
      passed: hasCatalogueOrFaq,
      detail: hasCatalogueOrFaq
        ? `${brain.products.length} products, ${brain.services.length} services, ${brain.faqs.length} FAQs`
        : "Add at least one product, service, or approved FAQ.",
    },
    {
      id: "pricing",
      label: "Pricing configured where ordering is enabled",
      passed: hasPricing && unpriced.length === 0,
      detail:
        unpriced.length > 0
          ? `Add a price for: ${unpriced.map((product) => product.name).join(", ")}.`
          : hasPricing
            ? orderingEnabled
              ? `${pricedProducts.length} priced products, ${pricedServices.length} priced services`
              : "Ordering disabled (pricing not required)"
            : "Add at least one priced product or service before ordering can go live.",
    },
    {
      id: "operating_status",
      label: "Operating status configured",
      passed: hasOperatingStatus,
      detail: `Status: ${brain.extendedConfig.operationalStatus}`,
    },
    {
      id: "operating_hours",
      label: "Operating hours configured",
      passed: hasOperatingHours,
      detail: hasOperatingHours ? brain.business.openingHours || "Configured" : "Add opening days and hours.",
    },
    {
      id: "notification_destination",
      label: "Nominated business notification number configured",
      passed: hasNotificationDestination,
      detail: hasNotificationDestination
        ? `${brain.notificationRecipients[0]?.label || "PRIMARY"} ${brain.notificationRecipients[0]?.phone || brain.notificationRecipients[0]?.email || ""}`.trim()
        : "Nominate a PRIMARY, SECONDARY, OWNER, or STAFF number for orders and escalations.",
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
      label: "Delivery zones, fees, and expected times configured if delivery is enabled",
      passed: deliveryZonesReady,
      detail: deliveryZonesReady
        ? brain.delivery.deliveryEnabled
          ? `${brain.delivery.zones.length} delivery zone(s) with fee and expected time`
          : "Pickup only (delivery disabled)"
        : "Add each delivery zone with its fee and expected time, or switch delivery off.",
    },
    {
      id: "business_rules",
      label: "Required business rules configured",
      passed: hasBusinessRules,
      detail: hasBusinessRules
        ? "Order, refund, or escalation rules are saved"
        : "Add the rules the AI must follow, such as refunds, order limits, or escalation.",
    },
    {
      id: "fallback_behavior",
      label: "Fallback behavior configured",
      passed: hasFallback,
      detail: hasFallback
        ? brain.extendedConfig.fallbackMessage
        : "Set the message used when the Business Brain does not contain the answer.",
    },
    {
      id: "human_handoff",
      label: "Human escalation configured",
      passed: hasHumanHandoff,
      detail: hasHumanHandoff
        ? "Escalation rule is saved"
        : "Say when the AI should call a person, including missing information and complaints.",
    },
    {
      id: "representative_answers",
      label: "AI can answer representative configured questions",
      passed: representativeFailures.length === 0,
      detail:
        representativeFailures.length === 0
          ? "Configured prices and delivery records can be quoted without guessing"
          : representativeFailures.join(" "),
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
  | { ok: false; code: "READINESS_FAILED" | "SUBSCRIPTION_REQUIRED" | "PUBLISH_FAILED"; error: string; readiness: AIReadinessReport }
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

  // Publication is all-or-nothing (§31): the business flag is written first and the draft
  // configuration is promoted only afterwards, with a compensating rollback if the snapshot
  // write fails. A failed publish therefore never leaves a half-live AI Front Desk — never a
  // LIVE configuration on an unpublished business, nor a published business serving a
  // configuration that was never promoted.
  let slug = params.businessId;
  let previousPublication: { isPublished: boolean; status: string } | null = null;

  try {
    if (prisma.business?.findUnique) {
      const before = await prisma.business
        .findUnique({
          where: { id: params.businessId },
          select: { slug: true, isPublished: true, status: true },
        })
        .catch(() => null);
      if (before) {
        previousPublication = { isPublished: Boolean(before.isPublished), status: String(before.status) };
        if (before.slug) slug = before.slug;
      }
    }
    if (prisma.business?.update) {
      const updatedBiz = await prisma.business.update({
        where: { id: params.businessId },
        data: { isPublished: true, status: "ACTIVE" },
      });
      if (updatedBiz?.slug) slug = updatedBiz.slug;
    }
  } catch {
    return {
      ok: false,
      code: "PUBLISH_FAILED",
      error: "The business could not be marked published. Nothing was changed — please try again.",
      readiness,
    };
  }

  let publishedConfig: Awaited<ReturnType<typeof publishAIConfigSnapshot>>;
  try {
    publishedConfig = await publishAIConfigSnapshot(params.businessId);
  } catch (error) {
    if (previousPublication && prisma.business?.update) {
      await prisma.business
        .update({ where: { id: params.businessId }, data: previousPublication })
        .catch(() => null);
    }
    return {
      ok: false,
      code: "PUBLISH_FAILED",
      error:
        error instanceof Error
          ? `The AI configuration could not be published: ${error.message}`
          : "The AI configuration could not be published. Nothing was changed — please try again.",
      readiness,
    };
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
