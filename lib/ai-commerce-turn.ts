/**
 * Business-anchored order, delivery, booking and policy turns.
 * Prices, fees, times and policies are read from the tenant Business Brain only.
 */

import type { getBusinessBrain } from "./ai-business-brain";
import { resolveDeliveryZoneFee } from "./ai-config";
import { productFocusPinnedAfterMention, type ConversationContext } from "./ai-conversation";
import { executeBusinessTool, type AIToolName } from "./ai-tools";
import { buildCartFromLines, parseConversationalOrder, type CartLine } from "./cart";
import { recordDemandInsight } from "./intelligence";
import {
  applyBulkUnitPrice,
  authoritativeUnitPrice,
  detectPolicyEnquiry,
  extractContactDetails,
  extractDeliveryArea,
  extractQuantityNear,
  extractStandaloneQuantity,
  formatDeliveryAnswer,
  formatKes,
  formatProductPriceLine,
  formatZoneList,
  isBookingIntent,
  isClosedQuestion,
  isConfirmation,
  isHumanHandoff,
  isOrderingIntent,
  isPreorderIntent,
  isBareDeliveryFollowUp,
  matchCatalogue,
  matchConfiguredZoneName,
  refersToPreviousProduct,
  stockIsConfirmed,
  detectUnlistedProductRequest,
  unlistedOrderItems,
  type CatalogueProduct,
} from "./ai-grounding";
const FALLBACK_UNKNOWN_MESSAGE = "I don't have that information yet. Let me connect you with the business.";
const HUMAN_HANDOFF_MESSAGE = "I'll pass this to the business team.";

type TurnSource = "structured_data" | "faq" | "knowledge_document" | "fallback" | "security_guard";
type TurnConfidence = "high" | "medium" | "low";

type Brain = Awaited<ReturnType<typeof getBusinessBrain>>;

export type CommerceTurn = {
  reply: string;
  responseType: "KNOWN" | "UNKNOWN" | "ACTION_REQUIRED";
  source: TurnSource;
  confidence: TurnConfidence;
  escalatedToHuman: boolean;
  toolsInvoked: AIToolName[];
  informationFound: string[];
  informationNotFound: string[];
  conv: ConversationContext;
  cartSummary?: {
    lineItems: Array<{
      productId?: string;
      name: string;
      variantDesc?: string;
      quantity: number;
      unitPriceKES: number;
      lineSubtotalKES: number;
    }>;
    subtotalKES: number;
    deliveryFeeKES: number;
    discountKES: number;
    taxKES: number;
    totalKES: number;
    currency: string;
  } | null;
  orderCreated?: unknown;
};

export async function resolveCommerceTurn(params: {
  businessId: string;
  message: string;
  brain: Brain;
  conv: ConversationContext;
  preview: boolean;
  customerName?: string | null;
  customerPhone?: string | null;
}): Promise<CommerceTurn | null> {
  const { brain, preview, businessId } = params;
  const message = params.message.trim();
  const lower = message.toLowerCase();
  let conv = {
    ...params.conv,
    collectedCustomerName: params.conv.collectedCustomerName || params.customerName || null,
    collectedCustomerPhone: params.conv.collectedCustomerPhone || params.customerPhone || null,
  };

  // Refunds, complaints and human requests stay with the existing handoff branch.
  if (
    /\b(refund|money\s+back|cancel\s+(?:my\s+)?order|complaint|damaged|wrong\s+order|dispute)\b/i.test(lower) ||
    (isHumanHandoff(message) && /\b(speak|talk|call|human|person|manager|owner|agent|staff|someone)\b/i.test(lower))
  ) {
    return null;
  }

  const policyKey = detectPolicyEnquiry(message);
  if (policyKey) {
    const answer = policyAnswer(brain, policyKey);
    if (!answer) {
      return {
        reply: brain.extendedConfig.fallbackMessage || FALLBACK_UNKNOWN_MESSAGE,
        responseType: "UNKNOWN",
        source: "fallback",
        confidence: "low",
        escalatedToHuman: true,
        toolsInvoked: [],
        informationFound: [],
        informationNotFound: [`Policy: ${policyKey}`],
        conv,
      };
    }
    return {
      reply: answer,
      responseType: "KNOWN",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: false,
      toolsInvoked: [],
      informationFound: [`Configured ${policyKey} rule`],
      informationNotFound: [],
      conv,
    };
  }

  if (isClosedQuestion(message)) {
    const configured = brain.extendedConfig.afterHoursMessage?.trim();
    if (!configured) {
      return {
        reply: brain.extendedConfig.fallbackMessage || FALLBACK_UNKNOWN_MESSAGE,
        responseType: "UNKNOWN",
        source: "fallback",
        confidence: "low",
        escalatedToHuman: true,
        toolsInvoked: [],
        informationFound: [],
        informationNotFound: ["After-hours behavior"],
        conv,
      };
    }
    return {
      reply: configured,
      responseType: "KNOWN",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: brain.extendedConfig.afterHoursBehavior === "handoff",
      toolsInvoked: [],
      informationFound: ["Configured after-hours behavior"],
      informationNotFound: [],
      conv,
    };
  }

  const pendingLines = conv.pendingCartLines || [];
  const explicitConfirm = /^\s*confirm\b/i.test(message) || /^(yes|ndio|ndiyo|sawa|proceed|go ahead)\b/i.test(lower);
  if (pendingLines.length > 0 && (explicitConfirm || (isConfirmation(message) && !isOrderingIntent(message)))) {
    return placeConfiguredOrder({ businessId, message, brain, conv, preview });
  }

  const deliveryMention = /\b(deliver(?:y|ed|ing)?|shipping|dispatch|mnafanya\s+delivery|mnadeliver|peleka)\b/i.test(lower);
  const ordering = isOrderingIntent(message) || (pendingLines.length > 0 && extractStandaloneQuantity(message) !== null);
  if (ordering && brain.products.length > 0) {
    const orderTurn = await progressOrder({ businessId, message, brain, conv, preview, deliveryMention });
    if (orderTurn) return orderTurn;
  }

  if (!ordering && isBareDeliveryFollowUp(message)) {
    return answerBareDeliveryFollowUp({ brain, conv });
  }

  // A bare place answer inside a delivery conversation ("Syokimau", "Athi River") is a delivery
  // destination, never an unlisted product. Only configured zones qualify, so no zone is invented.
  if (!ordering && deliveryContext(conv)) {
    const zoneName = matchConfiguredZoneName(message, brain.delivery?.zones || []);
    if (zoneName && matchCatalogue(message, brain.products).length === 0) {
      return establishedZoneAnswer({ brain, conv, zoneName });
    }
  }

  if (isBookingIntent(message) && !ordering) {
    return progressBooking({ businessId, message, brain, conv, preview });
  }

  if (isPreorderIntent(message) && !ordering) {
    return progressPreorder({ message, brain, conv });
  }

  if (deliveryMention) {
    return progressDelivery({ businessId, message, brain, conv, preview });
  }

  return null;
}

function policyAnswer(brain: Brain, key: NonNullable<ReturnType<typeof detectPolicyEnquiry>>): string | null {
  const policies = brain.policies;
  switch (key) {
    case "refund":
      return policies.refundPolicy || null;
    case "cancellation":
      return policies.cancellationPolicy || null;
    case "exchange":
      return policies.exchangePolicy || policies.returnPolicy || null;
    case "credit":
      return policies.creditPolicy || null;
    case "minimum_order":
      return typeof policies.minimumOrderKES === "number" && policies.minimumOrderKES > 0
        ? `The minimum order is ${formatKes(policies.minimumOrderKES)}.`
        : null;
    case "bulk":
      return policies.bulkOrderRules || null;
    case "delivery":
      return policies.deliveryConditions || null;
    case "booking":
      return policies.bookingConditions || policies.bookingRules || null;
    case "preorder":
      return policies.preorderConditions || null;
    case "modification":
      return brain.extendedConfig.modificationRules || null;
    case "after_hours":
      return brain.extendedConfig.afterHoursMessage || null;
    case "walk_in":
      if (brain.extendedConfig.walkInsAccepted === true) return "Yes. Walk-ins are accepted.";
      if (brain.extendedConfig.walkInsAccepted === false) return "Walk-ins are not accepted.";
      return null;
    default:
      return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Configured zones already named in this tenant's conversation. Other tenants' zones are ignored. */
function establishedDeliveryZones(conv: ConversationContext, brain: Brain): string[] {
  const zones = brain.delivery?.zones || [];
  const found: string[] = [];
  const add = (name: string | null | undefined) => {
    const cleaned = (name || "").trim();
    if (cleaned.length < 3) return;
    const canonical = zones.find((zone) => zone.name.toLowerCase() === cleaned.toLowerCase());
    if (!canonical || found.some((item) => item.toLowerCase() === canonical.name.toLowerCase())) return;
    found.push(canonical.name);
  };
  for (const turn of conv.turns) {
    if (turn.role !== "customer") continue;
    const area = extractDeliveryArea(turn.text);
    if (area.zone) add(area.zone);
    for (const zone of zones) {
      if (zone.name.trim().length < 3) continue;
      if (new RegExp(`\\b${escapeRegExp(zone.name)}\\b`, "i").test(turn.text)) add(zone.name);
    }
  }
  add(conv.pendingDeliveryZone);
  return found;
}

function clarifyDeliveryArea(zones: string[], conv: ConversationContext): CommerceTurn {
  return {
    reply: `Which delivery area should I use? ${zones.join(", ")}.`,
    responseType: "ACTION_REQUIRED",
    source: "structured_data",
    confidence: "high",
    escalatedToHuman: false,
    toolsInvoked: ["get_delivery_fee"],
    informationFound: zones,
    informationNotFound: ["Exact delivery area"],
    conv: { ...conv, pendingDeliveryZone: null, pendingFulfilment: "DELIVERY" },
  };
}

async function progressDelivery(params: {
  businessId: string;
  message: string;
  brain: Brain;
  conv: ConversationContext;
  preview: boolean;
}): Promise<CommerceTurn> {
  const { brain, preview, businessId } = params;
  const toolsInvoked: AIToolName[] = ["get_delivery_fee"];
  const area = extractDeliveryArea(params.message);
  const established = establishedDeliveryZones(params.conv, brain);
  if (area.refersToPrevious && !area.zone && established.length > 1) {
    return clarifyDeliveryArea(established, params.conv);
  }
  const zoneName = area.zone || (area.refersToPrevious && established.length === 1 ? established[0] : null);

  if (!brain.delivery.deliveryEnabled && brain.delivery.pickupEnabled) {
    return {
      reply: `We currently offer customer pickup${brain.business.location ? ` at ${brain.business.location}` : ""}. Delivery is not enabled at this time.`,
      responseType: "KNOWN",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: false,
      toolsInvoked,
      informationFound: ["Pickup-only fulfilment policy"],
      informationNotFound: [],
      conv: params.conv,
    };
  }

  if (zoneName) {
    const zoneResult = resolveDeliveryZoneFee(brain.delivery, zoneName);
    if (zoneResult.allowed && zoneResult.matchedZone) {
      const asksTime = /\b(how long|how much time|eta|take)\b/i.test(params.message);
      const etaMissing = !zoneResult.matchedZone.estimatedTime?.trim();
      const reply = formatDeliveryAnswer(zoneResult.matchedZone);
      return {
        reply:
          etaMissing && asksTime
            ? `${reply} I don't have an expected delivery time configured for ${zoneResult.matchedZone.name}.`
            : reply,
        responseType: etaMissing && asksTime ? "UNKNOWN" : "KNOWN",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        toolsInvoked,
        informationFound: [`Delivery zone ${zoneResult.matchedZone.name}: ${formatKes(zoneResult.feeKES)}`],
        informationNotFound: etaMissing ? [`Delivery time for ${zoneResult.matchedZone.name}`] : [],
        conv: { ...params.conv, pendingDeliveryZone: zoneResult.matchedZone.name, pendingFulfilment: "DELIVERY" },
      };
    }
    if (!preview) await recordDemandInsight(businessId, "OUT_OF_ZONE", zoneName);
    const configured =
      brain.delivery.zones.length > 0
        ? `We currently deliver only to: ${brain.delivery.zones.map((zone) => `${zone.name} (${formatKes(zone.feeKES)})`).join(", ")}.`
        : "Delivery zones have not been configured for that area.";
    return {
      reply: `We do not currently have delivery configured for ${zoneName}. ${configured} ${HUMAN_HANDOFF_MESSAGE}`,
      responseType: "UNKNOWN",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: false,
      toolsInvoked,
      informationFound: [],
      informationNotFound: [`Delivery zone: ${zoneName}`],
      conv: params.conv,
    };
  }

  if (area.refersToPrevious && !params.conv.pendingDeliveryZone) {
    return {
      reply: brain.extendedConfig.fallbackMessage || FALLBACK_UNKNOWN_MESSAGE,
      responseType: "UNKNOWN",
      source: "fallback",
      confidence: "low",
      escalatedToHuman: true,
      toolsInvoked,
      informationFound: [],
      informationNotFound: ["Delivery destination"],
      conv: params.conv,
    };
  }

  if (brain.delivery.deliveryEnabled && brain.delivery.zones.length > 0) {
    const asksTime = /\b(how long|how much time|eta|take)\b/i.test(params.message);
    const missingTimes = brain.delivery.zones.filter((zone) => !zone.estimatedTime?.trim()).map((zone) => zone.name);
    const timeNote =
      asksTime && missingTimes.length > 0
        ? ` I don't have an expected delivery time configured for ${missingTimes.join(", ")}.`
        : "";
    return {
      reply: `Yes, we offer delivery. Configured zones: ${formatZoneList(brain.delivery)}.${
        brain.delivery.pickupEnabled ? " Pickup is also available." : ""
      }${timeNote}`,
      responseType: asksTime && missingTimes.length === brain.delivery.zones.length ? "UNKNOWN" : "KNOWN",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: false,
      toolsInvoked,
      informationFound: [`Delivery zones (${brain.delivery.zones.length})`],
      informationNotFound: missingTimes.map((name) => `Delivery time for ${name}`),
      conv: params.conv,
    };
  }

  return {
    reply: brain.extendedConfig.fallbackMessage || FALLBACK_UNKNOWN_MESSAGE,
    responseType: "UNKNOWN",
    source: "fallback",
    confidence: "low",
    escalatedToHuman: true,
    toolsInvoked,
    informationFound: [],
    informationNotFound: ["Delivery fees & zones"],
    conv: params.conv,
  };
}

function mergeCartLines(existing: CartLine[], updates: CartLine[]): CartLine[] {
  const merged = existing.map((line) => ({ ...line }));
  for (const update of updates) {
    const index = merged.findIndex((line) => line.productId && line.productId === update.productId);
    if (index >= 0) merged[index] = { ...merged[index], ...update };
    else merged.push(update);
  }
  return merged;
}

function deliveryContext(conv: ConversationContext): boolean {
  return conv.pendingFulfilment === "DELIVERY" || Boolean(conv.pendingDeliveryZone);
}

function establishedZoneAnswer(params: { brain: Brain; conv: ConversationContext; zoneName: string }): CommerceTurn {
  const zone = (params.brain.delivery?.zones || []).find(
    (item) => item.name.toLowerCase() === params.zoneName.toLowerCase(),
  );
  const feeLine = zone ? formatDeliveryAnswer(zone) : `The established delivery area is ${params.zoneName}.`;
  const pending = params.conv.pendingCartLines || [];
  const pendingSummary = pending.map((line) => `${line.quantity} × ${line.name}`).join(", ");
  // Only ask for the item and quantity when the conversation does not already have them.
  const reply = pendingSummary
    ? `${feeLine} Your cart already has ${pendingSummary}. Should I add delivery to ${zone?.name || params.zoneName}?`
    : `${feeLine} What item and quantity would you like?`;
  return {
    reply,
    responseType: "KNOWN",
    source: "structured_data",
    confidence: "high",
    escalatedToHuman: false,
    toolsInvoked: ["get_delivery_fee"],
    informationFound: zone ? [`Delivery zone ${zone.name}: ${formatKes(zone.feeKES)}`] : [params.zoneName],
    informationNotFound: [],
    conv: { ...params.conv, pendingDeliveryZone: zone.name, pendingFulfilment: "DELIVERY" },
  };
}

function answerBareDeliveryFollowUp(params: { brain: Brain; conv: ConversationContext }): CommerceTurn {
  const established = establishedDeliveryZones(params.conv, params.brain);
  if (established.length > 1) return clarifyDeliveryArea(established, params.conv);
  if (established.length === 1) {
    return establishedZoneAnswer({ brain: params.brain, conv: params.conv, zoneName: established[0] });
  }
  return {
    reply: "I still need the delivery area before I can confirm a fee.",
    responseType: "ACTION_REQUIRED",
    source: "structured_data",
    confidence: "high",
    escalatedToHuman: false,
    toolsInvoked: ["get_delivery_fee"],
    informationFound: [],
    informationNotFound: ["Delivery destination"],
    conv: params.conv,
  };
}

function resolveReferencedProduct(input: {
  active?: CatalogueProduct;
  discussed: CatalogueProduct[];
  pending: CartLine[];
  demonstrative: boolean;
  namedCount: number;
  pinned?: boolean;
}): CatalogueProduct | "ask" | null {
  if (input.namedCount > 0) return null;
  if (input.demonstrative) {
    if (input.pinned && input.active) return input.active;
    if (input.discussed.length > 1) return "ask";
    if (input.active) return input.active;
    if (input.discussed.length === 1) return input.discussed[0];
    return "ask";
  }
  if (input.pending.length > 1) {
    if (input.active && input.pending.some((line) => line.productId === input.active!.id)) {
      return input.active;
    }
    return "ask";
  }
  if (input.pending.length === 1) {
    const singlePendingId = input.pending[0]?.productId;
    const singleProduct = input.discussed.find((p) => p.id === singlePendingId);
    return singleProduct || input.active || input.discussed[0] || null;
  }
  if (input.pinned && input.active) return input.active;
  if (input.discussed.length > 1) return null;
  if (input.active && input.discussed.length <= 1) return input.active;
  if (input.discussed.length === 1) return input.discussed[0];
  return null;
}

async function progressOrder(params: {
  businessId: string;
  message: string;
  brain: Brain;
  conv: ConversationContext;
  preview: boolean;
  deliveryMention: boolean;
}): Promise<CommerceTurn | null> {
  const { brain, message } = params;
  if (brain.extendedConfig.pauseAllOrdering || brain.extendedConfig.orderingAllowed === false) {
    return {
      reply: `Ordering is temporarily paused for ${brain.business.name}. I can still answer questions about configured prices, hours and policies. ${HUMAN_HANDOFF_MESSAGE}`,
      responseType: "ACTION_REQUIRED",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: true,
      toolsInvoked: [],
      informationFound: ["Ordering pause control active"],
      informationNotFound: [],
      conv: params.conv,
    };
  }

  const products = brain.products.filter((product) => product.isActive !== false) as CatalogueProduct[];
  const parsed = parseConversationalOrder(message, products);
  let focusId: string | null = null;
  let productFocusPinned = Boolean(params.conv.productFocusPinned);
  const zoneNames = [
    ...(brain.delivery?.zones || []).map((zone) => zone.name),
    ...(brain.business.location ? [brain.business.location] : []),
  ];
  if (parsed.matchedLines.length === 0 && parsed.outOfStockItems.length === 0) {
    const unlistedRequest = detectUnlistedProductRequest({
      message,
      candidate: message,
      frame: "order",
      products,
      extraKnownPhrases: zoneNames,
    });
    // A plausible unlisted product belongs to the front-desk unlisted-product reply, not a catalogue guess.
    if (unlistedRequest.plausible) return null;
  }
  if (parsed.outOfStockItems.length > 0 && parsed.matchedLines.length === 0) {
    // Existing front-desk handler owns the out-of-stock / PRE-ORDER wording and null cart.
    return null;
  }

  let lines: CartLine[] = parsed.matchedLines.map((line) => {
    const product = products.find((item) => item.id === line.productId);
    const quantity = extractQuantityNear(message, line.name) || line.quantity;
    const base = product ? authoritativeUnitPrice(product) ?? line.unitPriceKES : line.unitPriceKES;
    const priced = applyBulkUnitPrice(line.name, base, quantity, brain.extendedConfig.bulkPricing);
    return { ...line, quantity, unitPriceKES: priced.unitPriceKES };
  });

  if (lines.length === 1) {
    focusId = lines[0].productId || null;
  } else if (lines.length > 1) {
    const unquantified = lines.filter((l) => l.explicitQuantity === false);
    if (unquantified.length === 1) {
      focusId = unquantified[0].productId || null;
    } else {
      focusId = null;
    }
  }

  // A follow-up names only the changed item. Keep the rest of this conversation's cart.
  if (lines.length > 0 && params.conv.pendingCartLines.length > 0) {
    lines = mergeCartLines(params.conv.pendingCartLines, lines);
  }

  if (lines.length === 0) {
    const namedElsewhere = matchCatalogue(message, products);
    const demonstrative = refersToPreviousProduct(message);
    const quantity = extractStandaloneQuantity(message) ?? (demonstrative ? 1 : null);
    const active = products.find((product) => product.id === params.conv.activeProductId);
    const discussed = products.filter((product) => params.conv.discussedProductIds.includes(product.id));
    const pending = params.conv.pendingCartLines || [];
    const referenced = resolveReferencedProduct({
      active,
      discussed,
      pending,
      demonstrative,
      namedCount: namedElsewhere.length,
      pinned: params.conv.productFocusPinned && Boolean(active),
    });
    if (referenced === "ask") {
      const choices = (discussed.length > 1 ? discussed : products).slice(0, 6);
      return {
        reply: `Which item or grade should I use? ${choices.map((product) => product.name).join(", ")}.`,
        responseType: "ACTION_REQUIRED",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        toolsInvoked: ["search_products"],
        informationFound: choices.map((product) => product.name),
        informationNotFound: ["Exact product"],
        conv: params.conv,
      };
    }
    if (referenced && quantity && namedElsewhere.length === 0) {
      if (!stockIsConfirmed(referenced) || referenced.stockStatus === "OUT_OF_STOCK" || referenced.stockStatus === "DISCONTINUED") {
        if (referenced.stockStatus === "OUT_OF_STOCK" || referenced.stockStatus === "DISCONTINUED") {
          return {
            reply: `${referenced.name} is currently ${referenced.stockStatus}. I cannot add it as available stock.`,
            responseType: "ACTION_REQUIRED",
            source: "structured_data",
            confidence: "high",
            escalatedToHuman: false,
            toolsInvoked: ["check_inventory"],
            informationFound: [`Stock status for ${referenced.name}: ${referenced.stockStatus}`],
            informationNotFound: [],
            conv: params.conv,
          };
        }
      }
      const base = authoritativeUnitPrice(referenced);
      if (base === null) {
        return {
          reply: brain.extendedConfig.fallbackMessage || FALLBACK_UNKNOWN_MESSAGE,
          responseType: "UNKNOWN",
          source: "fallback",
          confidence: "low",
          escalatedToHuman: true,
          toolsInvoked: [],
          informationFound: [],
          informationNotFound: [`Price for ${referenced.name}`],
          conv: params.conv,
        };
      }
      const priced = applyBulkUnitPrice(referenced.name, base, quantity, brain.extendedConfig.bulkPricing);
      lines = mergeCartLines(pending, [{ productId: referenced.id, name: referenced.name, quantity, unitPriceKES: priced.unitPriceKES }]);
      focusId = referenced.id;
    } else if (namedElsewhere.length > 1 && quantity) {
      const choices = namedElsewhere
        .map((product) => formatProductPriceLine(product, quantity, brain.extendedConfig.bulkPricing))
        .join(" ");
      const area = extractDeliveryArea(message);
      const uniqueZone = establishedDeliveryZones(params.conv, brain);
      const destination = area.refersToPrevious
        ? uniqueZone.length === 1
          ? uniqueZone[0]
          : null
        : params.deliveryMention
          ? area.zone || params.conv.pendingDeliveryZone
          : null;
      return {
        reply: `I can take ${quantity}${destination ? ` for delivery to ${destination}` : ""}, but I need the exact item. ${choices}`,
        responseType: "ACTION_REQUIRED",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        toolsInvoked: ["search_products"],
        informationFound: namedElsewhere.map((product) => product.name),
        informationNotFound: [],
        conv: {
          ...params.conv,
          discussedProductIds: Array.from(new Set([...params.conv.discussedProductIds, ...namedElsewhere.map((product) => product.id)])),
          activeProductId: null,
          activeProductName: null,
          productFocusPinned: false,
          pendingDeliveryZone: destination || params.conv.pendingDeliveryZone,
          pendingFulfilment: destination ? "DELIVERY" : params.conv.pendingFulfilment,
        },
      };
    } else if (quantity && params.conv.discussedProductIds.length > 1 && !(params.conv.productFocusPinned && active)) {
      const discussed = products.filter((product) => params.conv.discussedProductIds.includes(product.id));
      const area = extractDeliveryArea(message);
      const uniqueZone = establishedDeliveryZones(params.conv, brain);
      const destination = area.refersToPrevious
        ? uniqueZone.length === 1
          ? uniqueZone[0]
          : null
        : params.deliveryMention
          ? area.zone || params.conv.pendingDeliveryZone
          : params.conv.pendingDeliveryZone;
      return {
        reply: `I have the quantity (${quantity})${destination ? ` and delivery to ${destination}` : ""}, but not which item. ${discussed
          .map((product) => formatProductPriceLine(product, quantity, brain.extendedConfig.bulkPricing))
          .join(". ")}.`,
        responseType: "ACTION_REQUIRED",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        toolsInvoked: ["search_products"],
        informationFound: discussed.map((product) => product.name),
        informationNotFound: ["Exact product"],
        conv: { ...params.conv, pendingDeliveryZone: destination || params.conv.pendingDeliveryZone },
      };
    } else if (isOrderingIntent(message) && !params.deliveryMention) {
      const names = products.slice(0, 6).map((product) => product.name);
      if (names.length === 0) return null;
      return {
        reply: `I can take an order from the configured catalogue: ${names.join(", ")}. Which item and quantity would you like?`,
        responseType: "ACTION_REQUIRED",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        toolsInvoked: ["search_products"],
        informationFound: ["Configured catalogue"],
        informationNotFound: [],
        conv: params.conv,
      };
    } else {
      return null;
    }
  }

  const limitNote = quantityLimitNote(lines, products);
  if (limitNote) {
    return {
      reply: limitNote,
      responseType: "ACTION_REQUIRED",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: false,
      toolsInvoked: ["check_inventory"],
      informationFound: ["Configured quantity limits"],
      informationNotFound: [],
      conv: params.conv,
    };
  }

  const area = extractDeliveryArea(message);
  const established = establishedDeliveryZones(params.conv, brain);
  // Place references such as "to the same place." are delivery destinations only
  // when this conversation already has one unambiguous configured zone.
  const referring = area.refersToPrevious;
  const zoneName = params.deliveryMention && area.zone
    ? area.zone
    : referring && established.length === 1
      ? established[0]
      : null;
  if (focusId && parsed.matchedLines.some((line) => line.productId === focusId)) {
    productFocusPinned =
      parsed.matchedLines.length === 1
        ? productFocusPinnedAfterMention(params.conv.discussedProductIds || [], focusId)
        : true;
  } else if (focusId) {
    productFocusPinned = true;
  } else if (parsed.matchedLines.length > 1) {
    productFocusPinned = false;
  }
  const resolvedActiveId = focusId || (lines.length === 1 ? lines[0]?.productId : null) || null;
  const resolvedActiveName =
    products.find((product) => product.id === resolvedActiveId)?.name ||
    (lines.length === 1 ? lines[0]?.name : null) ||
    null;
  const nextDiscussedIds = Array.from(
    new Set([
      ...params.conv.discussedProductIds,
      ...lines.map((line) => line.productId).filter((id): id is string => Boolean(id)),
    ]),
  );

  if (referring && established.length > 1) {
    return clarifyDeliveryArea(established, {
      ...params.conv,
      pendingCartLines: lines,
      activeProductId: resolvedActiveId,
      activeProductName: resolvedActiveName,
      discussedProductIds: nextDiscussedIds,
      productFocusPinned,
    });
  }
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceKES, 0);
  let deliveryFee = 0;
  let deliveryNote = "";
  let nextConv = {
    ...params.conv,
    pendingCartLines: lines,
    activeProductId: resolvedActiveId,
    activeProductName: resolvedActiveName,
    discussedProductIds: nextDiscussedIds,
    productFocusPinned,
  };
  if (zoneName) {
    const zoneResult = resolveDeliveryZoneFee(brain.delivery, zoneName, subtotal);
    if (!zoneResult.allowed || !zoneResult.matchedZone) {
      if (!params.preview) await recordDemandInsight(params.businessId, "OUT_OF_ZONE", zoneName);
      return {
        reply: `I can prepare that order, but we do not currently have delivery configured for ${zoneName}. ${
          brain.delivery.zones.length ? `Configured areas: ${brain.delivery.zones.map((zone) => zone.name).join(", ")}.` : ""
        }`,
        responseType: "UNKNOWN",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        toolsInvoked: ["get_delivery_fee"],
        informationFound: [],
        informationNotFound: [`Delivery zone: ${zoneName}`],
        conv: nextConv,
      };
    }
    deliveryFee = zoneResult.feeKES;
    nextConv = { ...nextConv, pendingDeliveryZone: zoneResult.matchedZone.name, pendingFulfilment: "DELIVERY" };
    deliveryNote = ` Delivery to ${zoneResult.matchedZone.name} is ${formatKes(deliveryFee)}${
      zoneResult.matchedZone.estimatedTime ? ` and normally takes ${zoneResult.matchedZone.estimatedTime}` : ""
    }.`;
  } else if (referring || (params.deliveryMention && area.refersToPrevious)) {
    deliveryNote = " I still need the delivery area before I can add a delivery fee.";
    nextConv = { ...nextConv, pendingFulfilment: "DELIVERY", pendingDeliveryZone: null };
  }

  const minimum = brain.policies.minimumOrderKES;
  if (typeof minimum === "number" && minimum > 0 && subtotal < minimum) {
    return {
      reply: `That comes to ${formatKes(subtotal)}, which is below the configured minimum order of ${formatKes(minimum)}.`,
      responseType: "ACTION_REQUIRED",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: false,
      toolsInvoked: ["calculate_order"],
      informationFound: [`Minimum order ${formatKes(minimum)}`],
      informationNotFound: [],
      conv: nextConv,
    };
  }

  const cart = buildCartFromLines(lines, { deliveryFeeKES: deliveryFee });
  const lineSummary = cart.lineItems.map((line) => `${line.quantity} × ${line.name} (${formatKes(line.lineSubtotalKES)})`).join(", ");
  const stockNotes = lines
    .map((line) => products.find((product) => product.id === line.productId))
    .filter((product): product is CatalogueProduct => Boolean(product && !stockIsConfirmed(product)))
    .map((product) => `${product.name}: stock has not been confirmed`);
  const oosWarning =
    parsed.outOfStockItems.length > 0
      ? ` Note: ${parsed.outOfStockItems.map((item) => `${item.name} is currently ${item.stockStatus}`).join("; ")}.`
      : "";
  // A listed line must never cause a requested unlisted item in the same message to disappear silently.
  const unlistedItems = unlistedOrderItems(message, products, zoneNames);
  const unlistedWarning =
    unlistedItems.length > 0
      ? ` Note: I don't have ${unlistedItems.join(", ")} listed, so it is not included in this cart.`
      : "";
  // The missed demand for that item is recorded the same way the front-desk unlisted-product branch
  // records it, so a mixed order does not lose the signal (review observation OBS-4).
  if (!params.preview) {
    for (const item of unlistedItems) {
      await recordDemandInsight(params.businessId, "UNAVAILABLE_PRODUCT", item);
    }
  }
  const missing = missingOrderDetails(nextConv, brain, params.deliveryMention || referring);
  const tomorrow = isPreorderIntent(message)
    ? brain.extendedConfig.preordersAllowed
      ? " This is a request for tomorrow. I will not promise a time that is not configured."
      : " Ordering for a future day is not enabled, so this can only be taken as a request for the business to confirm."
    : "";

  return {
    reply: `I have prepared your cart: ${lineSummary}. Subtotal: ${formatKes(cart.subtotalKES)}. Total: ${formatKes(cart.totalKES)}.${deliveryNote}${oosWarning}${unlistedWarning}${
      stockNotes.length ? ` ${stockNotes.join(". ")}.` : ""
    }${tomorrow}${missing ? ` ${missing}` : " Please confirm if you would like to proceed, and share your name and phone number."}`,
    responseType: "ACTION_REQUIRED",
    source: "structured_data",
    confidence: "high",
    escalatedToHuman: false,
    toolsInvoked: ["calculate_order"],
    informationFound: cart.lineItems.map((line) => `${line.name}: ${formatKes(line.unitPriceKES)}`),
    informationNotFound: stockNotes,
    conv: nextConv,
    cartSummary: cart,
  };
}

function quantityLimitNote(lines: CartLine[], products: CatalogueProduct[]): string | null {
  for (const line of lines) {
    const product = products.find((item) => item.id === line.productId);
    if (!product) continue;
    if (typeof product.minOrder === "number" && product.minOrder > 1 && line.quantity < product.minOrder) {
      return `${product.name} has a configured minimum of ${product.minOrder}.`;
    }
    if (typeof product.maxOrder === "number" && product.maxOrder > 0 && line.quantity > product.maxOrder) {
      return `${product.name} has a configured maximum of ${product.maxOrder}.`;
    }
    if (typeof product.quantity === "number" && line.quantity > product.quantity) {
      return `${product.name} has ${product.quantity} available, which is less than ${line.quantity}. I cannot confirm that quantity.`;
    }
  }
  return null;
}

function missingOrderDetails(conv: ConversationContext, brain: Brain, deliveryMention: boolean): string {
  const required = brain.extendedConfig.requiredCustomerFields || ["name", "phone"];
  const missing: string[] = [];
  if (required.includes("name") && !conv.collectedCustomerName) missing.push("your name");
  if (required.includes("phone") && !conv.collectedCustomerPhone) missing.push("your phone number");
  if ((deliveryMention || conv.pendingFulfilment === "DELIVERY") && !conv.pendingDeliveryZone) missing.push("the delivery area");
  if (!deliveryMention && brain.delivery.deliveryEnabled && brain.delivery.pickupEnabled && !conv.pendingFulfilment) {
    missing.push("whether you want pickup or delivery");
  }
  if (missing.length === 0) return "";
  return `To continue, I still need ${missing.join(", ")}.`;
}

async function placeConfiguredOrder(params: {
  businessId: string;
  message: string;
  brain: Brain;
  conv: ConversationContext;
  preview: boolean;
}): Promise<CommerceTurn> {
  const contact = extractContactDetails(params.message);
  const conv = {
    ...params.conv,
    collectedCustomerName: contact.name || params.conv.collectedCustomerName,
    collectedCustomerPhone: contact.phone || params.conv.collectedCustomerPhone,
  };
  const area = extractDeliveryArea(params.message);
  if (area.refersToPrevious) {
    const established = establishedDeliveryZones(conv, params.brain);
    if (established.length > 1) return clarifyDeliveryArea(established, conv);
    if (established.length === 1) {
      conv.pendingDeliveryZone = established[0];
      conv.pendingFulfilment = "DELIVERY";
    }
  } else if (area.zone) {
    conv.pendingDeliveryZone = area.zone;
    conv.pendingFulfilment = "DELIVERY";
  }
  if (/\bpick\s?up\b/i.test(params.message)) conv.pendingFulfilment = "PICKUP";
  const missing = missingOrderDetails(conv, params.brain, conv.pendingFulfilment === "DELIVERY");
  if (missing) {
    return {
      reply: missing,
      responseType: "ACTION_REQUIRED",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: false,
      toolsInvoked: [],
      informationFound: ["Pending cart"],
      informationNotFound: [missing],
      conv,
    };
  }

  const lines = conv.pendingCartLines;
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceKES, 0);
  let deliveryFee = 0;
  if (conv.pendingFulfilment === "DELIVERY" && conv.pendingDeliveryZone) {
    const zoneResult = resolveDeliveryZoneFee(params.brain.delivery, conv.pendingDeliveryZone, subtotal);
    if (!zoneResult.allowed) {
      return {
        reply: `We do not currently have delivery configured for ${conv.pendingDeliveryZone}.`,
        responseType: "UNKNOWN",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        toolsInvoked: ["get_delivery_fee"],
        informationFound: [],
        informationNotFound: [`Delivery zone: ${conv.pendingDeliveryZone}`],
        conv,
      };
    }
    deliveryFee = zoneResult.feeKES;
  }
  const signature = lines.map((line) => `${line.productId}:${line.quantity}`).join("|");
  try {
    const created = await executeBusinessTool(
      "create_order",
      {
        customerName: conv.collectedCustomerName,
        customerPhone: conv.collectedCustomerPhone,
        items: lines,
        deliveryFeeKES: deliveryFee,
        fulfilmentType: conv.pendingFulfilment === "DELIVERY" ? "DELIVERY" : "PICKUP",
        deliveryLocation: conv.pendingDeliveryZone,
        idempotencyKey: `${conv.conversationId}:${signature}`,
        confirmedByCustomer: true,
      },
      { businessId: params.businessId, preview: params.preview, conversationId: conv.conversationId, brain: params.brain },
    );
    if (!created.ok) {
      return {
        reply: created.error || `${HUMAN_HANDOFF_MESSAGE}`,
        responseType: "ACTION_REQUIRED",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: true,
        toolsInvoked: ["create_order"],
        informationFound: [],
        informationNotFound: [],
        conv,
      };
    }
    const order = created.data as { orderReference?: string; totalKES?: number; preview?: boolean };
    const payment = params.brain.paymentMethods.publicInfo
      ? ` Payment instructions: ${params.brain.paymentMethods.publicInfo}.`
      : " Payment instructions are not configured yet, so I cannot tell you where to pay.";
    const previewNote = params.preview ? " Preview only: no live order or notification was sent." : " The business has been notified.";
    const cart = buildCartFromLines(lines, { deliveryFeeKES: deliveryFee });
    return {
      reply: `Order ${order.orderReference || "request"} is recorded for ${conv.collectedCustomerName}. Total: ${formatKes(order.totalKES ?? cart.totalKES)}.${payment}${previewNote} Payment is confirmed only after server verification.`,
      responseType: "ACTION_REQUIRED",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: false,
      toolsInvoked: ["create_order", "send_owner_notification"],
      informationFound: ["Order summary", params.brain.paymentMethods.publicInfo ? "Public payment instructions" : "Payment instructions missing"],
      informationNotFound: params.brain.paymentMethods.publicInfo ? [] : ["Payment instructions"],
      conv: { ...conv, status: "CONVERTED", pendingCartLines: [] },
      cartSummary: cart,
      orderCreated: created.data,
    };
  } catch (error) {
    return {
      reply: `${HUMAN_HANDOFF_MESSAGE} ${error instanceof Error ? error.message : "The order could not be recorded."}`,
      responseType: "ACTION_REQUIRED",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: true,
      toolsInvoked: ["create_order"],
      informationFound: [],
      informationNotFound: [],
      conv,
    };
  }
}

async function progressBooking(params: {
  businessId: string;
  message: string;
  brain: Brain;
  conv: ConversationContext;
  preview: boolean;
}): Promise<CommerceTurn> {
  if (!params.brain.extendedConfig.bookingsAllowed) {
    return {
      reply: `Bookings are not accepted at ${params.brain.business.name}.`,
      responseType: "KNOWN",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: false,
      toolsInvoked: [],
      informationFound: ["Bookings disabled"],
      informationNotFound: [],
      conv: params.conv,
    };
  }
  const services = params.brain.services.filter((service) => service.isActive !== false);
  if (services.length === 0) {
    return {
      reply: params.brain.extendedConfig.fallbackMessage || FALLBACK_UNKNOWN_MESSAGE,
      responseType: "UNKNOWN",
      source: "fallback",
      confidence: "low",
      escalatedToHuman: true,
      toolsInvoked: [],
      informationFound: [],
      informationNotFound: ["Bookable services"],
      conv: params.conv,
    };
  }
  const matched = services.find((service) => params.message.toLowerCase().includes(service.title.toLowerCase()));
  const contact = extractContactDetails(params.message);
  const conv = {
    ...params.conv,
    collectedCustomerName: contact.name || params.conv.collectedCustomerName,
    collectedCustomerPhone: contact.phone || params.conv.collectedCustomerPhone,
  };
  if (!matched) {
    return {
      reply: `Which service should I request? Configured services: ${services.map((service) => `${service.title}${service.priceFrom != null ? ` (${formatKes(service.priceFrom)})` : ""}`).join(", ")}.`,
      responseType: "ACTION_REQUIRED",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: false,
      toolsInvoked: ["search_products"],
      informationFound: ["Configured services"],
      informationNotFound: [],
      conv,
    };
  }
  if (!conv.collectedCustomerName || !conv.collectedCustomerPhone) {
    const price = matched.priceFrom != null ? ` ${matched.title} is ${formatKes(matched.priceFrom)}.` : "";
    return {
      reply: `I can request a booking for ${matched.title}.${price} I don't have live availability, so the business must confirm the time. Please share your name, phone number and preferred time.`,
      responseType: "ACTION_REQUIRED",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: false,
      toolsInvoked: [],
      informationFound: [`Service: ${matched.title}`],
      informationNotFound: ["Customer contact"],
      conv,
    };
  }
  const created = await executeBusinessTool(
    "create_booking",
    {
      serviceName: matched.title,
      customerName: conv.collectedCustomerName,
      customerPhone: conv.collectedCustomerPhone,
      startAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
    { businessId: params.businessId, preview: params.preview, conversationId: conv.conversationId, brain: params.brain },
  );
  return {
    reply: `Booking request for ${matched.title} is with ${params.brain.business.name}. I have not confirmed a specific slot — the business will confirm.${
      params.preview ? " Preview only: no live booking notification was sent." : " The business has been notified."
    }`,
    responseType: "ACTION_REQUIRED",
    source: "structured_data",
    confidence: "high",
    escalatedToHuman: false,
    toolsInvoked: ["create_booking"],
    informationFound: [`Booking request: ${matched.title}`],
    informationNotFound: ["Confirmed appointment slot"],
    conv,
    orderCreated: created.data,
  };
}

function progressPreorder(params: { message: string; brain: Brain; conv: ConversationContext }): CommerceTurn {
  if (!params.brain.extendedConfig.preordersAllowed) {
    return {
      reply: `Pre-orders are not accepted at ${params.brain.business.name}.`,
      responseType: "KNOWN",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: false,
      toolsInvoked: [],
      informationFound: ["Pre-orders disabled"],
      informationNotFound: [],
      conv: params.conv,
    };
  }
  const condition = params.brain.policies.preorderConditions?.trim();
  return {
    reply: condition
      ? `Pre-orders are accepted. ${condition}`
      : "Pre-orders are accepted. Tell me the item and quantity, and the business will confirm timing. I will not invent a delivery date.",
    responseType: "KNOWN",
    source: "structured_data",
    confidence: "high",
    escalatedToHuman: false,
    toolsInvoked: [],
    informationFound: ["Pre-orders enabled"],
    informationNotFound: condition ? [] : ["Pre-order timing"],
    conv: params.conv,
  };
}
