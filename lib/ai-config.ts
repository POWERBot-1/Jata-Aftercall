/**
 * AI Front Desk Extended Configuration, Delivery Rules, Policies & Pause Controls
 * (§12, §13, §31, §37, §42, §45, §48)
 *
 * Strictly tenant-scoped by businessId. Never stores secrets or payment credentials (§10).
 */

import prisma from "./db";
import {
  resolveTemplateForCategory,
  type DeliveryModeKey,
  type OfferTypeKey,
  type OrderingModeKey,
} from "./ai-templates";

export const AI_OPERATIONAL_STATUSES = [
  "DRAFT",
  "CONFIGURED",
  "PREVIEW",
  "LIVE",
  "PAUSED",
  "MAINTENANCE",
] as const;

export type OperationalStatus = (typeof AI_OPERATIONAL_STATUSES)[number];
export type AIOperationalStatus = OperationalStatus;

export type DeliveryZoneConfig = {
  id?: string;
  name: string;
  feeKES: number;
  freeDeliveryAboveKES?: number | null;
  estimatedTime?: string;
  sameDayAvailable?: boolean;
};

export type DeliveryZoneRule = DeliveryZoneConfig;

export type DeliveryConfiguration = {
  mode: DeliveryModeKey; // PICKUP | DELIVERY | BOTH
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  zones: DeliveryZoneConfig[];
  freeDeliveryThresholdKES?: number | null;
  estimatedTimeDefault?: string | null;
  sameDayDelivery: boolean;
  pickupInstructions?: string | null;
  deliveryInstructions?: string | null;
  serviceArea?: string | null;
};

export type BusinessPoliciesConfig = {
  refundPolicy?: string | null;
  returnPolicy?: string | null;
  cancellationPolicy?: string | null;
  warrantyPolicy?: string | null;
  bookingRules?: string | null;
  orderRules?: string | null;
  guaranteePolicy?: string | null;
  privacyNotice?: string | null;
  retentionDays?: number;
};

export type ExtendedAIConfig = {
  businessId: string;
  tone: "professional" | "friendly" | "casual" | "premium" | "local" | "formal";
  toneOfVoice: string;
  language: "en" | "sw" | "mixed";
  languageBehavior: string;
  salesBehavior: "informational" | "recommend" | "upsell" | "cross_sell" | "promotions";
  orderingAllowed: boolean;
  bookingsAllowed: boolean;
  preordersAllowed: boolean;
  autoReplyEnabled: boolean;
  humanEscalation: "always" | "business_hours" | "specified_topics" | "uncertain";
  welcomeMessage: string | null;
  greetingMessage: string | null;
  fallbackMessage: string;
  afterHoursMessage: string | null;
  escalationRules: string | null;
  escalationThreshold?: string | null;
  bookingRules?: string | null;
  orderRules?: string | null;
  offerType: OfferTypeKey;
  orderingMode: OrderingModeKey;
  operationalStatus: OperationalStatus;
  pauseAllOrdering: boolean;
  templateKey: string;
  templateCategory: string;
  delivery: DeliveryConfiguration;
  policies: BusinessPoliciesConfig;
  escalationTopics: string[];
  draftVersion: number;
  publishedVersion: number;
  publishedAt?: string | null;
  publishedById?: string | null;
};

const SYSTEM_CONFIG_SOURCE_TYPE = "ai_front_desk_config";
const SYSTEM_CONFIG_TITLE = "__JATA_AI_FRONT_DESK_CONFIG__";

// Tenant-isolated in-memory store used as a synchronous mirror when Prisma mocks in unit tests
// do not implement knowledgeDocument writes. Keyed strictly by businessId.
const tenantConfigStore = new Map<string, Partial<ExtendedAIConfig>>();

export const DEFAULT_DELIVERY_CONFIG: DeliveryConfiguration = {
  mode: "BOTH",
  pickupEnabled: true,
  deliveryEnabled: false,
  zones: [],
  freeDeliveryThresholdKES: null,
  estimatedTimeDefault: "30–60 mins",
  sameDayDelivery: true,
  pickupInstructions: null,
  deliveryInstructions: null,
  serviceArea: null,
};

export const DEFAULT_POLICIES_CONFIG: BusinessPoliciesConfig = {
  refundPolicy: null,
  returnPolicy: null,
  cancellationPolicy: null,
  warrantyPolicy: null,
  bookingRules: null,
  orderRules: null,
  guaranteePolicy: null,
  privacyNotice:
    "Customer conversation and order details are used solely to fulfil your request with this business and are never shared with third-party marketing lists.",
  retentionDays: 90,
};

export function sanitizeDeliveryConfig(
  raw: unknown,
  fallbackMode: DeliveryModeKey = "BOTH",
): DeliveryConfiguration {
  if (!raw || typeof raw !== "object") {
    return {
      ...DEFAULT_DELIVERY_CONFIG,
      mode: fallbackMode,
      pickupEnabled: fallbackMode !== "DELIVERY",
      deliveryEnabled: false,
    };
  }
  const obj = raw as Record<string, unknown>;
  const rawZones = Array.isArray(obj.zones) ? obj.zones : [];
  const zones: DeliveryZoneConfig[] = rawZones
    .slice(0, 50)
    .map((entry, idx) => {
      if (!entry || typeof entry !== "object") return null;
      const z = entry as Record<string, unknown>;
      const name = typeof z.name === "string" ? z.name.trim().slice(0, 80) : "";
      if (!name) return null;
      const feeKES = Math.max(0, Math.round(Number(z.feeKES ?? z.fee ?? 0) || 0));
      const freeDeliveryAboveKES =
        typeof z.freeDeliveryAboveKES === "number" && Number.isFinite(z.freeDeliveryAboveKES)
          ? Math.max(0, Math.round(z.freeDeliveryAboveKES))
          : null;
      const item: DeliveryZoneConfig = {
        id: typeof z.id === "string" && z.id ? z.id.slice(0, 40) : `zone-${idx + 1}`,
        name,
        feeKES,
        freeDeliveryAboveKES,
        estimatedTime:
          typeof z.estimatedTime === "string" ? z.estimatedTime.trim().slice(0, 60) : undefined,
        sameDayAvailable: z.sameDayAvailable !== false,
      };
      return item;
    })
    .filter((z): z is DeliveryZoneConfig => z !== null);

  const explicitDelivery =
    typeof obj.deliveryEnabled === "boolean" ? obj.deliveryEnabled : zones.length > 0;
  const explicitPickup =
    typeof obj.pickupEnabled === "boolean" ? obj.pickupEnabled : fallbackMode !== "DELIVERY";

  const mode: DeliveryModeKey =
    obj.mode === "PICKUP" || obj.mode === "DELIVERY" || obj.mode === "BOTH"
      ? obj.mode
      : explicitPickup && explicitDelivery
        ? "BOTH"
        : explicitDelivery
          ? "DELIVERY"
          : "PICKUP";

  const freeThreshold =
    obj.freeDeliveryThresholdKES !== undefined &&
    obj.freeDeliveryThresholdKES !== null &&
    obj.freeDeliveryThresholdKES !== ""
      ? Math.max(0, Math.round(Number(obj.freeDeliveryThresholdKES) || 0))
      : null;

  return {
    mode,
    pickupEnabled: explicitPickup,
    deliveryEnabled: explicitDelivery,
    zones,
    freeDeliveryThresholdKES: freeThreshold && freeThreshold > 0 ? freeThreshold : null,
    estimatedTimeDefault:
      typeof obj.estimatedTimeDefault === "string"
        ? obj.estimatedTimeDefault.trim().slice(0, 80) || null
        : "30–60 mins",
    sameDayDelivery: obj.sameDayDelivery !== false,
    pickupInstructions:
      typeof obj.pickupInstructions === "string"
        ? obj.pickupInstructions.trim().slice(0, 500) || null
        : null,
    deliveryInstructions:
      typeof obj.deliveryInstructions === "string"
        ? obj.deliveryInstructions.trim().slice(0, 500) || null
        : null,
    serviceArea:
      typeof obj.serviceArea === "string" ? obj.serviceArea.trim().slice(0, 200) || null : null,
  };
}

export function sanitizePoliciesConfig(raw: unknown): BusinessPoliciesConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_POLICIES_CONFIG };
  const obj = raw as Record<string, unknown>;
  const retentionDays = Math.max(7, Math.min(3650, Math.round(Number(obj.retentionDays) || 90)));
  return {
    refundPolicy:
      typeof obj.refundPolicy === "string" ? obj.refundPolicy.trim().slice(0, 1000) || null : null,
    returnPolicy:
      typeof obj.returnPolicy === "string" ? obj.returnPolicy.trim().slice(0, 1000) || null : null,
    cancellationPolicy:
      typeof obj.cancellationPolicy === "string"
        ? obj.cancellationPolicy.trim().slice(0, 1000) || null
        : null,
    warrantyPolicy:
      typeof obj.warrantyPolicy === "string"
        ? obj.warrantyPolicy.trim().slice(0, 1000) || null
        : null,
    bookingRules:
      typeof obj.bookingRules === "string" ? obj.bookingRules.trim().slice(0, 1000) || null : null,
    orderRules:
      typeof obj.orderRules === "string" ? obj.orderRules.trim().slice(0, 1000) || null : null,
    guaranteePolicy:
      typeof obj.guaranteePolicy === "string"
        ? obj.guaranteePolicy.trim().slice(0, 1000) || null
        : null,
    privacyNotice:
      typeof obj.privacyNotice === "string" && obj.privacyNotice.trim()
        ? obj.privacyNotice.trim().slice(0, 1000)
        : DEFAULT_POLICIES_CONFIG.privacyNotice,
    retentionDays,
  };
}

/**
 * Look up the configured delivery fee for a customer-requested zone (§13).
 * Never promises delivery outside configured zones!
 */
export function resolveDeliveryZoneFee(
  delivery: DeliveryConfiguration,
  requestedZone?: string | null,
  subtotalKES = 0,
): {
  allowed: boolean;
  mode: DeliveryModeKey;
  zone?: DeliveryZoneConfig;
  matchedZone?: DeliveryZoneConfig;
  feeKES: number;
  freeDeliveryApplied: boolean;
  reason?: string;
} {
  if (!delivery.deliveryEnabled && delivery.mode === "PICKUP") {
    return {
      allowed: false,
      mode: "PICKUP",
      feeKES: 0,
      freeDeliveryApplied: false,
      reason: "This business offers pickup only and does not offer delivery.",
    };
  }

  const query = (requestedZone || "").trim().toLowerCase();
  if (!query) {
    if (delivery.zones.length === 0) {
      return {
        allowed: delivery.deliveryEnabled,
        mode: delivery.mode,
        feeKES: 0,
        freeDeliveryApplied: false,
        reason: delivery.deliveryEnabled
          ? undefined
          : "Delivery zones are not configured for this business.",
      };
    }
    const defaultZone = delivery.zones[0];
    const threshold = defaultZone.freeDeliveryAboveKES ?? delivery.freeDeliveryThresholdKES;
    const freeApplied =
      typeof threshold === "number" && threshold > 0 && subtotalKES >= threshold;
    return {
      allowed: true,
      mode: delivery.mode,
      zone: defaultZone,
      matchedZone: defaultZone,
      feeKES: freeApplied ? 0 : defaultZone.feeKES,
      freeDeliveryApplied: freeApplied,
    };
  }

  if (delivery.zones.length > 0) {
    const matched = delivery.zones.find(
      (z) =>
        z.name.toLowerCase() === query ||
        query.includes(z.name.toLowerCase()) ||
        z.name.toLowerCase().includes(query),
    );
    if (!matched) {
      return {
        allowed: false,
        mode: delivery.mode,
        feeKES: 0,
        freeDeliveryApplied: false,
        reason: `We do not currently deliver to ${(requestedZone || "").trim()}. Configured delivery areas: ${delivery.zones.map((z) => z.name).join(", ")}.`,
      };
    }
    const threshold = matched.freeDeliveryAboveKES ?? delivery.freeDeliveryThresholdKES;
    const freeApplied =
      typeof threshold === "number" && threshold > 0 && subtotalKES >= threshold;
    return {
      allowed: true,
      mode: delivery.mode,
      zone: matched,
      matchedZone: matched,
      feeKES: freeApplied ? 0 : matched.feeKES,
      freeDeliveryApplied: freeApplied,
    };
  }

  if (delivery.serviceArea) {
    const areas = delivery.serviceArea
      .toLowerCase()
      .split(/[,;/]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const inArea = areas.some((area) => query.includes(area) || area.includes(query));
    if (!inArea) {
      return {
        allowed: false,
        mode: delivery.mode,
        feeKES: 0,
        freeDeliveryApplied: false,
        reason: `We do not currently deliver to ${(requestedZone || "").trim()}. Service area: ${delivery.serviceArea}.`,
      };
    }
    return {
      allowed: true,
      mode: delivery.mode,
      feeKES: 0,
      freeDeliveryApplied: false,
    };
  }

  return {
    allowed: false,
    mode: delivery.mode,
    feeKES: 0,
    freeDeliveryApplied: false,
    reason: `Delivery is not configured for ${(requestedZone || "").trim()}.`,
  };
}

export async function getExtendedAIConfig(
  businessId: string,
  baseRow?: Record<string, any> | null,
  businessCategory?: string | null,
): Promise<ExtendedAIConfig> {
  const tpl = resolveTemplateForCategory(businessCategory);
  const aiRow =
    baseRow !== undefined
      ? baseRow
      : (await prisma.aIConfiguration?.findUnique?.({ where: { businessId } }).catch(() => null)) ??
        null;

  let storedJson: Partial<ExtendedAIConfig> = {};
  try {
    if (prisma.knowledgeDocument?.findFirst) {
      const doc = await prisma.knowledgeDocument.findFirst({
        where: { businessId, sourceType: SYSTEM_CONFIG_SOURCE_TYPE, isApproved: false },
      });
      if (doc?.content) {
        storedJson = JSON.parse(doc.content) as Partial<ExtendedAIConfig>;
      }
    }
  } catch {
    // Fallback to in-memory tenant store
  }

  const mem = tenantConfigStore.get(businessId) || {};
  const merged = { ...storedJson, ...mem };

  const toneOfVoice = String(
    aiRow?.toneOfVoice || merged.toneOfVoice || merged.tone || tpl.defaultTone || "Friendly",
  );
  const tone = (merged.tone || tpl.defaultTone || "friendly") as ExtendedAIConfig["tone"];
  const languageBehavior = String(
    aiRow?.languageBehavior || merged.languageBehavior || "English + Swahili",
  );
  const language = (merged.language || tpl.defaultLanguage || "mixed") as ExtendedAIConfig["language"];
  const salesBehavior = (merged.salesBehavior ||
    tpl.defaultSalesBehavior ||
    "recommend") as ExtendedAIConfig["salesBehavior"];
  const orderingAllowed =
    typeof merged.orderingAllowed === "boolean"
      ? merged.orderingAllowed
      : typeof aiRow?.orderingAllowed === "boolean"
        ? aiRow.orderingAllowed
        : tpl.orderingAllowed;
  const bookingsAllowed =
    typeof merged.bookingsAllowed === "boolean"
      ? merged.bookingsAllowed
      : typeof aiRow?.bookingsAllowed === "boolean"
        ? aiRow.bookingsAllowed
        : true;
  const preordersAllowed =
    typeof merged.preordersAllowed === "boolean"
      ? merged.preordersAllowed
      : typeof aiRow?.preordersAllowed === "boolean"
        ? aiRow.preordersAllowed
        : tpl.preordersAllowed;
  const autoReplyEnabled =
    typeof merged.autoReplyEnabled === "boolean"
      ? merged.autoReplyEnabled
      : typeof aiRow?.autoReplyEnabled === "boolean"
        ? aiRow.autoReplyEnabled
        : true;
  const humanEscalation = (merged.humanEscalation ||
    "uncertain") as ExtendedAIConfig["humanEscalation"];
  const greetingMessage =
    aiRow?.greetingMessage ?? merged.greetingMessage ?? merged.welcomeMessage ?? tpl.welcomeMessage;
  const fallbackMessage =
    aiRow?.fallbackMessage ||
    merged.fallbackMessage ||
    "I don't have that information yet. Let me connect you with the business.";
  const afterHoursMessage = aiRow?.afterHoursMessage ?? merged.afterHoursMessage ?? null;
  const escalationRules = aiRow?.escalationRules ?? merged.escalationRules ?? null;

  return {
    businessId,
    tone,
    toneOfVoice,
    language,
    languageBehavior,
    salesBehavior,
    orderingAllowed,
    bookingsAllowed,
    preordersAllowed,
    autoReplyEnabled,
    humanEscalation,
    welcomeMessage: greetingMessage,
    greetingMessage,
    fallbackMessage,
    afterHoursMessage,
    escalationRules,
    escalationThreshold: merged.escalationThreshold ?? null,
    bookingRules: merged.bookingRules ?? null,
    orderRules: merged.orderRules ?? null,
    offerType: (merged.offerType as OfferTypeKey) || tpl.offerType,
    orderingMode: (merged.orderingMode as OrderingModeKey) || tpl.orderingMode,
    operationalStatus: (merged.operationalStatus as OperationalStatus) || "LIVE",
    pauseAllOrdering: Boolean(merged.pauseAllOrdering),
    templateKey: merged.templateKey || tpl.key,
    templateCategory: merged.templateCategory || tpl.label,
    delivery: sanitizeDeliveryConfig(merged.delivery, tpl.deliveryMode),
    policies: sanitizePoliciesConfig(merged.policies),
    escalationTopics: Array.isArray(merged.escalationTopics)
      ? merged.escalationTopics.map(String).slice(0, 20)
      : ["refund", "complaint", "discount_negotiation", "custom_quote"],
    draftVersion: typeof merged.draftVersion === "number" ? merged.draftVersion : 1,
    publishedVersion: typeof merged.publishedVersion === "number" ? merged.publishedVersion : 0,
    publishedAt: merged.publishedAt || null,
    publishedById: merged.publishedById || null,
  };
}

export async function saveExtendedAIConfig(
  businessId: string,
  updates: Omit<Partial<ExtendedAIConfig>, "delivery" | "policies"> & {
    delivery?: Partial<DeliveryConfiguration>;
    policies?: Partial<BusinessPoliciesConfig>;
  },
  options?: { requirePersistence?: boolean },
): Promise<ExtendedAIConfig> {
  const current = await getExtendedAIConfig(businessId);
  const next: ExtendedAIConfig = {
    ...current,
    ...updates,
    businessId,
    delivery:
      updates.delivery !== undefined
        ? sanitizeDeliveryConfig(updates.delivery, current.delivery.mode)
        : current.delivery,
    policies:
      updates.policies !== undefined
        ? sanitizePoliciesConfig(updates.policies)
        : current.policies,
    draftVersion: (current.draftVersion || 1) + 1,
  };

  tenantConfigStore.set(businessId, next);

  try {
    if (prisma.knowledgeDocument?.findFirst) {
      const existingDoc = await prisma.knowledgeDocument.findFirst({
        where: { businessId, sourceType: SYSTEM_CONFIG_SOURCE_TYPE, isApproved: false },
      });
      const content = JSON.stringify(next);
      if (existingDoc && prisma.knowledgeDocument?.update) {
        await prisma.knowledgeDocument.update({
          where: { id: existingDoc.id },
          data: { content },
        });
      } else if (prisma.knowledgeDocument?.create) {
        await prisma.knowledgeDocument.create({
          data: {
            businessId,
            title: SYSTEM_CONFIG_TITLE,
            content,
            sourceType: SYSTEM_CONFIG_SOURCE_TYPE,
            isApproved: false,
          },
        });
      }
    }
  } catch (error) {
    if (options?.requirePersistence) {
      // Publishing must not claim success when the snapshot was never durably written
      // (§31): restore the in-memory mirror to the pre-publish configuration and surface the
      // failure so the caller can roll the publication back.
      tenantConfigStore.set(businessId, current);
      throw error instanceof Error ? error : new Error("AI_CONFIG_PERSISTENCE_FAILED");
    }
    // Kept in tenantConfigStore when DB is mocked/offline
  }

  return next;
}

export async function publishAIConfigSnapshot(businessId: string): Promise<ExtendedAIConfig> {
  const current = await getExtendedAIConfig(businessId);
  return saveExtendedAIConfig(
    businessId,
    {
      operationalStatus: current.operationalStatus === "PAUSED" ? "PAUSED" : "LIVE",
      publishedVersion: current.draftVersion || 1,
      publishedAt: new Date().toISOString(),
    },
    { requirePersistence: true },
  );
}

export function resetInMemoryAIConfigForTests() {
  tenantConfigStore.clear();
}

export const resetExtendedAIConfigForTests = resetInMemoryAIConfigForTests;
