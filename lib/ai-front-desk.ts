/**
 * AI Business Front Desk Engine (§6–§11, §13, §15, §18–§29, §34–§38, §45, §55, §56).
 *
 * Implements:
 * - Strict grounding to the tenant's isolated Business Brain (§6, §7)
 * - Structured transactional data precedence over uploaded documents (§7)
 * - Response safety classification: KNOWN | UNKNOWN | ACTION_REQUIRED (§8)
 * - Prompt-injection defense & secret protection (§10, §11)
 * - Controlled tool execution (§9)
 * - Conversation memory within tenant session (§24)
 * - Multilingual understanding: English, Kiswahili, and mixed Kenyan conversational phrases (§25)
 * - Conversational cart building (§27)
 * - Operational diagnostics for Owner "Ask My Bot" console without chain-of-thought (§29)
 */

import { getBusinessBrain, type KnowledgeConflict } from "./ai-business-brain";
import { resolveDeliveryZoneFee } from "./ai-config";
import {
  getOrCreateConversationContext,
  updateConversationContext,
  type ChannelType,
  type ConversationContext,
} from "./ai-conversation";
import { executeBusinessTool, type AIToolName } from "./ai-tools";
import { buildCartFromLines, parseConversationalOrder, type CartLine } from "./cart";
import { evaluateProductAvailability } from "./inventory";
import {
  recordAIQualityEvent,
  recordCustomerQuestion,
  recordDemandInsight,
  recordUnansweredQuestion,
} from "./intelligence";

export const FALLBACK_UNKNOWN_MESSAGE =
  "I don't have that information yet. Let me connect you with the business.";

export const FALLBACK_UNLISTED_PRODUCT_MESSAGE = "I don't have that product listed.";

export const HUMAN_HANDOFF_MESSAGE = "I'll pass this to the business team.";

export const DEFAULT_SUGGESTED_ACTIONS = [
  "Products",
  "Prices",
  "Place an Order",
  "Delivery Fees",
  "Opening Hours",
  "Talk to a Human",
] as const;

export type AIResponseType = "KNOWN" | "UNKNOWN" | "ACTION_REQUIRED";

export type AIOperationalDiagnostics = {
  informationFound: string[];
  informationNotFound: string[];
  missingInformation: string[];
  configurationImprovement: string[];
  sourceUsed: "structured_data" | "faq" | "knowledge_document" | "fallback" | "security_guard";
  confidence: "high" | "medium" | "low";
  escalatedToHuman: boolean;
  toolsInvoked: AIToolName[];
  conflicts: KnowledgeConflict[];
  knowledgeVersion: number;
};

export type AIFrontDeskTurnResult = {
  reply: string;
  responseType: AIResponseType;
  source: AIOperationalDiagnostics["sourceUsed"];
  confidence: AIOperationalDiagnostics["confidence"];
  escalatedToHuman: boolean;
  conversationId: string;
  conversationStatus: ConversationContext["status"];
  suggestedActions: string[];
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
  preview: boolean;
  diagnostics: AIOperationalDiagnostics;
};

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above|system)\s+instructions/i,
  /disregard\s+(?:all\s+)?(?:previous|prior|system)\s+(?:instructions|rules)/i,
  /you\s+are\s+now\s+(?:in\s+)?(?:developer|admin|god|unrestricted)\s+mode/i,
  /(?:show|reveal|print|dump|expose|give\s+me)\s+(?:the\s+)?(?:payment\s+)?(?:secret|api\s*key|private\s*key|webhook\s*secret|credentials|password|system\s*prompt)/i,
  /give\s+me\s+a?\s*(?:90|95|100)%\s+discount/i,
  /override\s+(?:the\s+)?(?:price|payment|verification|security)/i,
];

export function detectPromptInjection(message: string): { isInjection: boolean; reason?: string } {
  const cleaned = (message || "").trim();
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(cleaned)) {
      return {
        isInjection: true,
        reason: "Prompt-injection or secret/override request detected and blocked.",
      };
    }
  }
  return { isInjection: false };
}

function extractRequestedProductCandidate(message: string): string | null {
  const m = message.trim();
  const patterns = [
    /(?:how\s+much\s+(?:is|are|for)\s+(?:the\s+|a\s+|an\s+)?)([a-z0-9][a-z0-9\s-]{1,40}?)(?:\?|$|\.)/i,
    /(?:do\s+you\s+(?:have|sell|stock)\s+(?:any\s+|the\s+|a\s+)?)([a-z0-9][a-z0-9\s-]{1,40}?)(?:\?|$|\.)/i,
    /(?:price\s+of\s+(?:the\s+|a\s+)?)([a-z0-9][a-z0-9\s-]{1,40}?)(?:\?|$|\.)/i,
    /(?:bei\s+ya\s+)([a-z0-9][a-z0-9\s-]{1,40}?)(?:\?|$|\.)/i,
    /(?:mnauza\s+)([a-z0-9][a-z0-9\s-]{1,40}?)(?:\?|$|\.)/i,
  ];
  for (const pat of patterns) {
    const match = pat.exec(m);
    if (match?.[1]) {
      const candidate = match[1].trim().toLowerCase();
      if (
        ![
          "it",
          "this",
          "that",
          "them",
          "delivery",
          "shipping",
          "everything",
          "your products",
          "products",
          "services",
        ].includes(candidate)
      ) {
        return candidate;
      }
    }
  }
  return null;
}

function extractDeliveryAreaCandidate(message: string): string | null {
  const patterns = [
    /deliver\s+to\s+([a-z0-9][a-z0-9\s-]{1,35}?)(?:\?|$|\.|,)/i,
    /delivery\s+(?:to|in|for)\s+([a-z0-9][a-z0-9\s-]{1,35}?)(?:\?|$|\.|,)/i,
    /mnafanya\s+delivery\s+([a-z0-9][a-z0-9\s-]{1,35}?)(?:\?|$|\.|,)/i,
    /mnadeliver\s+([a-z0-9][a-z0-9\s-]{1,35}?)(?:\?|$|\.|,)/i,
  ];
  for (const pat of patterns) {
    const match = pat.exec(message);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

export async function handleAIFrontDeskTurn(params: {
  businessId: string;
  message: string;
  conversationId?: string | null;
  channel?: ChannelType;
  preview?: boolean;
  customerName?: string | null;
  customerPhone?: string | null;
  orderId?: string | null;
  paymentReference?: string | null;
}): Promise<AIFrontDeskTurnResult> {
  const { businessId } = params;
  if (!businessId || typeof businessId !== "string") {
    throw new Error("businessId required — tenant isolation enforced.");
  }

  const rawMessage = (params.message || "").trim();
  if (!rawMessage) {
    throw new Error("Customer message is required.");
  }

  const preview = Boolean(params.preview);
  const brain = await getBusinessBrain(businessId);
  const conv = getOrCreateConversationContext({
    businessId,
    conversationId: params.conversationId,
    channel: params.channel || "web_chat",
    preview,
  });

  const toolsInvoked: AIToolName[] = [];
  const informationFound: string[] = [];
  const informationNotFound: string[] = [];
  const missingInformation: string[] = [];
  const configurationImprovement: string[] = [];

  // Populate missing configuration recommendations for owner diagnostics (§29)
  if (!brain.business.openingHours) {
    missingInformation.push("Opening hours are not configured.");
    configurationImprovement.push("Add opening hours so the AI can answer when you open and close.");
  }
  if (brain.products.length === 0 && brain.services.length === 0) {
    missingInformation.push("No products or services are configured.");
    configurationImprovement.push("Add at least one product or service with a price in KES.");
  }
  if (!brain.paymentMethods.isConfigured) {
    missingInformation.push("Merchant payment details are not configured.");
    configurationImprovement.push("Configure Paybill, Till, Pochi, or payment link in Payment Setup.");
  }
  if (brain.delivery.deliveryEnabled && brain.delivery.zones.length === 0) {
    missingInformation.push("Delivery zones and fees are not configured.");
    configurationImprovement.push("Add delivery zones and fees (e.g., CBD, Westlands, Kilimani).");
  }
  if (brain.conflicts.length > 0) {
    for (const c of brain.conflicts) {
      configurationImprovement.push(
        `Resolve conflict in "${c.sourceTitle}": ${c.productName} ${c.field} says "${c.conflictingValue}" while structured catalogue is "${c.structuredValue}".`,
      );
    }
  }

  // Record recurring question metric (§34) unless in preview
  await recordCustomerQuestion(businessId, rawMessage, preview);

  const lower = rawMessage.toLowerCase();

  // 0. Check operational status (PAUSED / MAINTENANCE — §45)
  if (brain.extendedConfig.operationalStatus === "MAINTENANCE" && !preview) {
    const maintenanceReply = `Our AI Front Desk for ${brain.business.name} is temporarily in maintenance mode. ${HUMAN_HANDOFF_MESSAGE}`;
    return finalizeTurn({
      conv,
      rawMessage,
      reply: maintenanceReply,
      responseType: "ACTION_REQUIRED",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: true,
      preview,
      brain,
      toolsInvoked,
      informationFound: ["Operational status: MAINTENANCE"],
      informationNotFound,
      missingInformation,
      configurationImprovement,
    });
  }

  // 1. Prompt-Injection & Secret/Override Defense (§10, §11, §55 Scenario 4)
  const injection = detectPromptInjection(rawMessage);
  if (injection.isInjection) {
    const safeRefusal =
      "I cannot override business rules, grant unauthorized discounts, mark orders as paid without server verification, or share private credentials. I can only assist with verified products, prices, and policies for this business.";
    return finalizeTurn({
      conv,
      rawMessage,
      reply: safeRefusal,
      responseType: "ACTION_REQUIRED",
      source: "security_guard",
      confidence: "high",
      escalatedToHuman: false,
      preview,
      brain,
      toolsInvoked,
      informationFound: ["Blocked prompt-injection / override attempt"],
      informationNotFound,
      missingInformation,
      configurationImprovement,
    });
  }

  // 2. Customer Payment Claim Defense (§15, §55 Scenario 10)
  // "I have paid", "Mark my order as paid", "Nimelipa", "I already paid"
  if (
    /\b(i\s+have\s+paid|i\s+already\s+paid|mark\s+(?:my\s+)?order\s+(?:as\s+)?paid|nimelipa|nimeshalipa|payment\s+sent)\b/i.test(
      lower,
    )
  ) {
    toolsInvoked.push("check_payment_status");
    const check = await executeBusinessTool(
      "check_payment_status",
      { orderId: params.orderId, paymentReference: params.paymentReference },
      { businessId, preview, conversationId: conv.conversationId, brain },
    );
    const verified = Boolean((check.data as { verified?: boolean } | undefined)?.verified);
    if (verified) {
      informationFound.push("Server-verified PAID payment record");
      return finalizeTurn({
        conv,
        rawMessage,
        reply: "Thank you — your payment has been verified by our server and your order is confirmed.",
        responseType: "KNOWN",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        preview,
        brain,
        toolsInvoked,
        informationFound,
        informationNotFound,
        missingInformation,
        configurationImprovement,
      });
    }

    informationNotFound.push("Verified server payment record");
    return finalizeTurn({
      conv,
      rawMessage,
      reply:
        "I cannot mark an order as paid from a chat message alone. Orders are confirmed only after server-side payment verification completes. If you have just paid, please share your payment reference or allow a moment for verification — or I'll pass this to the business team.",
      responseType: "ACTION_REQUIRED",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: false,
      preview,
      brain,
      toolsInvoked,
      informationFound,
      informationNotFound,
      missingInformation,
      configurationImprovement,
    });
  }

  // 3. High-Risk / Refund / Cancellation / Complaint / Human Handoff (§9, §23, §55 Scenario 6)
  if (
    /\b(refund|money\s+back|cancel\s+(?:my\s+)?order|speak\s+to\s+(?:a\s+)?(?:human|person|manager|owner|agent)|talk\s+to\s+(?:a\s+)?(?:human|person)|complaint|damaged|wrong\s+order)\b/i.test(
      lower,
    )
  ) {
    toolsInvoked.push("request_human");
    await executeBusinessTool(
      "request_human",
      {
        reason: rawMessage,
        customerName: params.customerName || conv.customerName,
        customerPhone: params.customerPhone || conv.customerPhone,
      },
      { businessId, preview, conversationId: conv.conversationId, brain },
    );

    const policyNote = brain.policies.refundPolicy
      ? ` Policy note: ${brain.policies.refundPolicy}`
      : "";
    const contactNote =
      brain.business.whatsapp || brain.business.phone
        ? ` You can also reach the team directly at ${brain.business.whatsapp || brain.business.phone}.`
        : "";

    informationFound.push("Escalation & human handoff rules");
    return finalizeTurn({
      conv: { ...conv, status: "WAITING_FOR_HUMAN" },
      rawMessage,
      reply: `${HUMAN_HANDOFF_MESSAGE} Refunds, order cancellations, and special requests require review by the business.${policyNote}${contactNote}`,
      responseType: "ACTION_REQUIRED",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: true,
      preview,
      brain,
      toolsInvoked,
      informationFound,
      informationNotFound,
      missingInformation,
      configurationImprovement,
    });
  }

  // 4. Unsupported / Configured Promotions & Discounts (§38, §55 Scenario 8)
  if (/\b(discount|promo|promotion|coupon|voucher|offer|deal|punguzo)\b/i.test(lower)) {
    toolsInvoked.push("get_promotions");
    if (brain.promotions.length > 0) {
      const promo = brain.promotions[0];
      informationFound.push(`Configured promotion: ${promo.title}`);
      return finalizeTurn({
        conv,
        rawMessage,
        reply: `Current promotion at ${brain.business.name}: ${promo.title}${promo.subtitle ? ` — ${promo.subtitle}` : ""}.`,
        responseType: "KNOWN",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        preview,
        brain,
        toolsInvoked,
        informationFound,
        informationNotFound,
        missingInformation,
        configurationImprovement,
      });
    }
    informationNotFound.push("Active promotions or discounts");
    return finalizeTurn({
      conv,
      rawMessage,
      reply: `We do not have any active discounts or promotional codes configured right now. All items are offered at their listed prices.`,
      responseType: "UNKNOWN",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: false,
      preview,
      brain,
      toolsInvoked,
      informationFound,
      informationNotFound,
      missingInformation,
      configurationImprovement,
    });
  }

  // 5. Delivery Zones, Fees & Thresholds (§13, §36, §55 Scenario 9)
  if (/\b(deliver|delivery|shipping|dispatch|mnafanya\s+delivery|mnadeliver)\b/i.test(lower)) {
    toolsInvoked.push("get_delivery_fee");
    const areaCandidate = extractDeliveryAreaCandidate(rawMessage);
    if (areaCandidate) {
      const zoneResult = resolveDeliveryZoneFee(brain.delivery, areaCandidate);
      if (zoneResult.allowed && zoneResult.matchedZone) {
        informationFound.push(`Delivery zone ${zoneResult.matchedZone.name}: KES ${zoneResult.feeKES}`);
        const thresholdNote =
          typeof zoneResult.matchedZone.freeDeliveryAboveKES === "number"
            ? ` (free delivery on orders above KES ${zoneResult.matchedZone.freeDeliveryAboveKES})`
            : "";
        return finalizeTurn({
          conv: { ...conv, pendingDeliveryZone: zoneResult.matchedZone.name },
          rawMessage,
          reply: `Yes, we deliver to ${zoneResult.matchedZone.name}. The delivery fee is KES ${zoneResult.feeKES}${thresholdNote}.`,
          responseType: "KNOWN",
          source: "structured_data",
          confidence: "high",
          escalatedToHuman: false,
          preview,
          brain,
          toolsInvoked,
          informationFound,
          informationNotFound,
          missingInformation,
          configurationImprovement,
        });
      }

      // Unsupported delivery zone -> record missed-demand insight (§36) and never invent coverage (§13)
      if (!preview) {
        await recordDemandInsight(businessId, "OUT_OF_ZONE", areaCandidate);
      }
      informationNotFound.push(`Delivery zone: ${areaCandidate}`);
      const configuredZonesList =
        brain.delivery.zones.length > 0
          ? `We currently deliver only to: ${brain.delivery.zones.map((z) => `${z.name} (KES ${z.feeKES})`).join(", ")}.`
          : "Delivery zones have not been configured for that area.";
      return finalizeTurn({
        conv,
        rawMessage,
        reply: `We do not currently have delivery configured for ${areaCandidate}. ${configuredZonesList} ${HUMAN_HANDOFF_MESSAGE}`,
        responseType: "UNKNOWN",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        preview,
        brain,
        toolsInvoked,
        informationFound,
        informationNotFound,
        missingInformation,
        configurationImprovement,
      });
    }

    // General delivery inquiry ("How much is delivery?", "Do you deliver?")
    if (brain.delivery.deliveryEnabled && brain.delivery.zones.length > 0) {
      const zoneSummary = brain.delivery.zones
        .map((z) => `${z.name}: KES ${z.feeKES}`)
        .join(", ");
      informationFound.push(`Delivery zones (${brain.delivery.zones.length})`);
      return finalizeTurn({
        conv,
        rawMessage,
        reply: `Yes, we offer delivery. Configured delivery zones and fees: ${zoneSummary}.${
          brain.delivery.pickupEnabled ? " Pickup is also available." : ""
        }`,
        responseType: "KNOWN",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        preview,
        brain,
        toolsInvoked,
        informationFound,
        informationNotFound,
        missingInformation,
        configurationImprovement,
      });
    }

    if (brain.delivery.pickupEnabled && !brain.delivery.deliveryEnabled) {
      informationFound.push("Pickup-only fulfilment policy");
      return finalizeTurn({
        conv,
        rawMessage,
        reply: `We currently offer customer pickup${brain.business.location ? ` at ${brain.business.location}` : ""}. Delivery is not enabled at this time.`,
        responseType: "KNOWN",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        preview,
        brain,
        toolsInvoked,
        informationFound,
        informationNotFound,
        missingInformation,
        configurationImprovement,
      });
    }

    if (!preview) {
      await recordUnansweredQuestion(businessId, rawMessage);
    }
    informationNotFound.push("Delivery fees & zones");
    return finalizeTurn({
      conv,
      rawMessage,
      reply: FALLBACK_UNKNOWN_MESSAGE,
      responseType: "UNKNOWN",
      source: "fallback",
      confidence: "low",
      escalatedToHuman: true,
      preview,
      brain,
      toolsInvoked,
      informationFound,
      informationNotFound,
      missingInformation,
      configurationImprovement,
    });
  }

  // 6. Opening Hours & Location (English + Kiswahili — §25)
  if (
    /\b(opening\s+hours|what\s+time\s+do\s+you\s+(?:open|close)|when\s+are\s+you\s+open|hours|saa\s+ngapi|mnafungua|mnafunga|mko\s+wapi|where\s+are\s+you\s+located|location)\b/i.test(
      lower,
    )
  ) {
    toolsInvoked.push("get_business_hours");
    const wantsLocation = /\b(mko\s+wapi|where\s+are\s+you\s+located|location|address)\b/i.test(lower);
    if (wantsLocation && brain.business.location) {
      informationFound.push(`Business location: ${brain.business.location}`);
      return finalizeTurn({
        conv,
        rawMessage,
        reply: `${brain.business.name} is located at ${brain.business.location}.${
          brain.business.openingHours ? ` Opening hours: ${brain.business.openingHours}.` : ""
        }`,
        responseType: "KNOWN",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        preview,
        brain,
        toolsInvoked,
        informationFound,
        informationNotFound,
        missingInformation,
        configurationImprovement,
      });
    }
    if (brain.business.openingHours) {
      informationFound.push(`Opening hours: ${brain.business.openingHours}`);
      return finalizeTurn({
        conv,
        rawMessage,
        reply: `${brain.business.name} opening hours: ${brain.business.openingHours}.${
          brain.business.location ? ` Location: ${brain.business.location}.` : ""
        }`,
        responseType: "KNOWN",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        preview,
        brain,
        toolsInvoked,
        informationFound,
        informationNotFound,
        missingInformation,
        configurationImprovement,
      });
    }
    if (!preview) {
      await recordUnansweredQuestion(businessId, rawMessage);
    }
    informationNotFound.push("Opening hours");
    return finalizeTurn({
      conv,
      rawMessage,
      reply: FALLBACK_UNKNOWN_MESSAGE,
      responseType: "UNKNOWN",
      source: "fallback",
      confidence: "low",
      escalatedToHuman: true,
      preview,
      brain,
      toolsInvoked,
      informationFound,
      informationNotFound,
      missingInformation,
      configurationImprovement,
    });
  }

  // 7. Payment Methods Inquiry ("Do you accept M-Pesa?", "How do I pay?" — §14, §34)
  if (/\b(m-?pesa|paybill|till\s+number|pochi|how\s+(?:do|can)\s+i\s+pay|payment\s+method|mnakubali\s+m-?pesa)\b/i.test(lower)) {
    toolsInvoked.push("get_payment_methods");
    if (brain.paymentMethods.isConfigured && brain.paymentMethods.publicInfo) {
      informationFound.push("Public merchant payment instructions");
      return finalizeTurn({
        conv,
        rawMessage,
        reply: `Payment details for ${brain.business.name}: ${brain.paymentMethods.publicInfo}.`,
        responseType: "KNOWN",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        preview,
        brain,
        toolsInvoked,
        informationFound,
        informationNotFound,
        missingInformation,
        configurationImprovement,
      });
    }
    if (!preview) {
      await recordUnansweredQuestion(businessId, rawMessage);
    }
    informationNotFound.push("Merchant payment instructions");
    return finalizeTurn({
      conv,
      rawMessage,
      reply: FALLBACK_UNKNOWN_MESSAGE,
      responseType: "UNKNOWN",
      source: "fallback",
      confidence: "low",
      escalatedToHuman: true,
      preview,
      brain,
      toolsInvoked,
      informationFound,
      informationNotFound,
      missingInformation,
      configurationImprovement,
    });
  }

  // 8. Conversational Ordering ("I want two burgers and one chips", "Order 1 Chicken Burger" — §27)
  const hasOrderingIntent = /\b(i\s+want|i'd\s+like|i\s+would\s+like|order|buy|add\s+to\s+cart|nataka|naomba|get\s+me)\b/i.test(lower);
  if (hasOrderingIntent && brain.products.length > 0) {
    if (brain.extendedConfig.pauseAllOrdering || !brain.extendedConfig.orderingAllowed) {
      return finalizeTurn({
        conv,
        rawMessage,
        reply: `Ordering is temporarily paused for ${brain.business.name}. ${HUMAN_HANDOFF_MESSAGE}`,
        responseType: "ACTION_REQUIRED",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: true,
        preview,
        brain,
        toolsInvoked,
        informationFound: ["Ordering pause control active"],
        informationNotFound,
        missingInformation,
        configurationImprovement,
      });
    }

    const parsedOrder = parseConversationalOrder(rawMessage, brain.products);
    if (parsedOrder.outOfStockItems.length > 0 && parsedOrder.matchedLines.length === 0) {
      const oos = parsedOrder.outOfStockItems[0];
      toolsInvoked.push("check_inventory");
      if (!preview) {
        await recordDemandInsight(businessId, "UNAVAILABLE_PRODUCT", oos.name);
      }
      const preOrderNote =
        oos.preOrderAllowed || brain.extendedConfig.preordersAllowed
          ? ` It is available as a PRE-ORDER (KES ${oos.priceKES} each). Would you like to place a pre-order instead?`
          : " Would you like us to notify you when it is back in stock?";
      informationFound.push(`Stock status for ${oos.name}: ${oos.stockStatus}`);
      return finalizeTurn({
        conv: { ...conv, activeProductId: oos.productId, activeProductName: oos.name },
        rawMessage,
        reply: `${oos.name} is currently out of stock (${oos.stockStatus}) and cannot be sold as an in-stock item.${preOrderNote}`,
        responseType: "ACTION_REQUIRED",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        preview,
        brain,
        toolsInvoked,
        informationFound,
        informationNotFound,
        missingInformation,
        configurationImprovement,
      });
    }

    if (parsedOrder.matchedLines.length > 0) {
      toolsInvoked.push("calculate_order");
      const mergedLines: CartLine[] = [...parsedOrder.matchedLines];
      const cartCalc = buildCartFromLines(mergedLines);
      const lineSummary = cartCalc.lineItems
        .map((l) => `${l.quantity} × ${l.name} (KES ${l.lineSubtotalKES})`)
        .join(", ");
      const oosWarning =
        parsedOrder.outOfStockItems.length > 0
          ? ` Note: ${parsedOrder.outOfStockItems.map((o) => `${o.name} is currently ${o.stockStatus}`).join("; ")}.`
          : "";

      informationFound.push(...cartCalc.lineItems.map((l) => `${l.name}: KES ${l.unitPriceKES}`));
      return finalizeTurn({
        conv: {
          ...conv,
          pendingCartLines: mergedLines,
          activeProductId: mergedLines[0].productId || conv.activeProductId,
          activeProductName: mergedLines[0].name || conv.activeProductName,
        },
        rawMessage,
        reply: `I have prepared your cart: ${lineSummary}. Subtotal: KES ${cartCalc.subtotalKES}. Total: KES ${cartCalc.totalKES}.${oosWarning} Please confirm if you would like to proceed with this order.`,
        responseType: "ACTION_REQUIRED",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        preview,
        brain,
        toolsInvoked,
        informationFound,
        informationNotFound,
        missingInformation,
        configurationImprovement,
        cartSummary: cartCalc,
      });
    }
  }

  // 9. Product, Variant & Price Lookup (Structured Data Precedence — §7, §18, §24, §55 Scenarios 1, 2, 3, 7)
  const matchedProducts = brain.products.filter((p) => {
    const pLower = p.name.toLowerCase();
    if (lower.includes(pLower)) return true;
    const words = pLower.split(/\s+/).filter((w) => w.length >= 4);
    return words.some((w) => new RegExp(`\\b${w}s?\\b`, "i").test(lower));
  });

  // Check if the customer is referring to the active product in conversation memory (§24)
  // e.g., "How much is it?", "Do you have medium?", "Is size 42 available?"
  const usesContextReference =
    matchedProducts.length === 0 &&
    conv.activeProductId &&
    /\b(it|that|this|one|medium|large|small|size|black|white|red|blue|available|in\s+stock|how\s+much)\b/i.test(lower);

  const targetProduct =
    matchedProducts.length === 1
      ? matchedProducts[0]
      : usesContextReference
        ? brain.products.find((p) => p.id === conv.activeProductId) || null
        : null;

  if (targetProduct) {
    toolsInvoked.push("get_product", "check_inventory");
    const authoritativePrice = targetProduct.basePriceKES ?? targetProduct.variantPriceKES ?? null;
    const availability = evaluateProductAvailability({ product: targetProduct, requestedQuantity: 1 });

    // Check if customer asked about a specific size/variant
    const sizeMatch = /\b(?:size\s+(\d+|[a-z]+)|(small|medium|large|xl|xxl))\b/i.exec(rawMessage);
    const requestedVariantTerm = (sizeMatch?.[1] || sizeMatch?.[2] || "").toLowerCase();

    if (requestedVariantTerm && (targetProduct.variants?.length || targetProduct.variantOptions)) {
      const matchedVariant = (targetProduct.variants || []).find(
        (v) =>
          v.label.toLowerCase().includes(requestedVariantTerm) ||
          (v.options && v.options.toLowerCase().includes(requestedVariantTerm)),
      );
      const inVariantOptions =
        targetProduct.variantOptions && targetProduct.variantOptions.toLowerCase().includes(requestedVariantTerm);

      if (!matchedVariant && !inVariantOptions) {
        if (!preview) {
          await recordDemandInsight(
            businessId,
            "UNAVAILABLE_SIZE",
            `${targetProduct.name} (${requestedVariantTerm})`,
          );
        }
        informationNotFound.push(`Variant ${requestedVariantTerm} for ${targetProduct.name}`);
        return finalizeTurn({
          conv: {
            ...conv,
            activeProductId: targetProduct.id,
            activeProductName: targetProduct.name,
          },
          rawMessage,
          reply: `We don't have "${requestedVariantTerm}" listed as an available option for ${targetProduct.name}. ${
            targetProduct.variantOptions ? `Available options: ${targetProduct.variantOptions}.` : FALLBACK_UNKNOWN_MESSAGE
          }`,
          responseType: "UNKNOWN",
          source: "structured_data",
          confidence: "high",
          escalatedToHuman: false,
          preview,
          brain,
          toolsInvoked,
          informationFound,
          informationNotFound,
          missingInformation,
          configurationImprovement,
        });
      }
    }

    informationFound.push(
      `Structured product: ${targetProduct.name} (KES ${authoritativePrice ?? "N/A"}, ${availability.stockStatus})`,
    );

    if (!availability.available) {
      if (!preview) {
        await recordDemandInsight(businessId, "UNAVAILABLE_PRODUCT", targetProduct.name);
      }
      const preOrderText =
        availability.canPreOrder || brain.extendedConfig.preordersAllowed
          ? ` You can place a PRE-ORDER for ${targetProduct.name} at KES ${authoritativePrice ?? 0}.`
          : "";
      return finalizeTurn({
        conv: {
          ...conv,
          activeProductId: targetProduct.id,
          activeProductName: targetProduct.name,
        },
        rawMessage,
        reply: `${targetProduct.name} is priced at KES ${authoritativePrice ?? 0}, and is currently ${availability.stockStatus} (not available for immediate fulfilment).${preOrderText}`,
        responseType: "KNOWN",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        preview,
        brain,
        toolsInvoked,
        informationFound,
        informationNotFound,
        missingInformation,
        configurationImprovement,
      });
    }

    return finalizeTurn({
      conv: {
        ...conv,
        activeProductId: targetProduct.id,
        activeProductName: targetProduct.name,
      },
      rawMessage,
      reply: `${targetProduct.name} is KES ${authoritativePrice ?? 0} (${availability.stockStatus}).${
        targetProduct.description ? ` ${targetProduct.description}` : ""
      } Would you like to add ${targetProduct.name} to your order?`,
      responseType: "KNOWN",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: false,
      preview,
      brain,
      toolsInvoked,
      informationFound,
      informationNotFound,
      missingInformation,
      configurationImprovement,
    });
  }

  // 10. Ambiguous price/availability question when multiple products exist and no active product (§8, §55 Scenario 7)
  if (
    matchedProducts.length === 0 &&
    !conv.activeProductId &&
    /\b(how\s+much\s+is\s+it|what\s+is\s+the\s+price|bei\s+gani|is\s+it\s+available|do\s+you\s+have\s+it)\b/i.test(lower)
  ) {
    const productNames = brain.products.slice(0, 5).map((p) => `${p.name} (KES ${p.basePriceKES ?? p.variantPriceKES ?? 0})`);
    if (productNames.length > 1) {
      informationFound.push("Multiple catalogue items require disambiguation");
      return finalizeTurn({
        conv,
        rawMessage,
        reply: `Which item would you like to check? We currently have: ${productNames.join(", ")}.`,
        responseType: "ACTION_REQUIRED",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        preview,
        brain,
        toolsInvoked,
        informationFound,
        informationNotFound,
        missingInformation,
        configurationImprovement,
      });
    }
  }

  // 11. General Catalogue / Products / Prices Inquiry ("What do you sell?", "Products", "Prices", "Mnauza nini?")
  if (
    /\b(what\s+do\s+you\s+(?:sell|have|offer)|products|menu|catalogue|catalog|prices|price\s+list|services|mnauza\s+nini)\b/i.test(
      lower,
    )
  ) {
    toolsInvoked.push("search_products");
    if (brain.products.length > 0 || brain.services.length > 0) {
      const prodLines = brain.products
        .filter((p) => p.isActive !== false)
        .map((p) => `${p.name}: KES ${p.basePriceKES ?? p.variantPriceKES ?? 0} (${p.stockStatus || "IN_STOCK"})`);
      const svcLines = brain.services
        .filter((s) => s.isActive !== false)
        .map((s) => `${s.title}: KES ${s.priceFrom ?? 0}`);
      const allLines = [...prodLines, ...svcLines];
      informationFound.push(`Catalogue items (${allLines.length})`);
      return finalizeTurn({
        conv,
        rawMessage,
        reply: `Here is what ${brain.business.name} offers: ${allLines.join("; ")}. Tell me which item you would like to order or ask about.`,
        responseType: "KNOWN",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        preview,
        brain,
        toolsInvoked,
        informationFound,
        informationNotFound,
        missingInformation,
        configurationImprovement,
      });
    }
  }

  // 12. Approved FAQs & Knowledge Documents (§6, §7, §35)
  // Note: Structured products already took precedence in step 9.
  const matchedFaq = brain.faqs.find((f) => {
    const qLower = f.question.toLowerCase();
    return lower.includes(qLower) || qLower.includes(lower);
  });
  if (matchedFaq) {
    toolsInvoked.push("get_faqs");
    informationFound.push(`Approved FAQ: ${matchedFaq.question}`);
    return finalizeTurn({
      conv,
      rawMessage,
      reply: matchedFaq.approvedAnswer,
      responseType: "KNOWN",
      source: "faq",
      confidence: "high",
      escalatedToHuman: false,
      preview,
      brain,
      toolsInvoked,
      informationFound,
      informationNotFound,
      missingInformation,
      configurationImprovement,
    });
  }

  const matchedDoc = brain.knowledge.find((doc) => {
    const titleLower = doc.title.toLowerCase();
    const contentLower = doc.content.toLowerCase();
    return lower.includes(titleLower) || contentLower.includes(lower);
  });
  if (matchedDoc) {
    informationFound.push(`Approved knowledge document: ${matchedDoc.title}`);
    return finalizeTurn({
      conv,
      rawMessage,
      reply: matchedDoc.content,
      responseType: "KNOWN",
      source: "knowledge_document",
      confidence: "medium",
      escalatedToHuman: false,
      preview,
      brain,
      toolsInvoked,
      informationFound,
      informationNotFound,
      missingInformation,
      configurationImprovement,
    });
  }

  // 13. Specific Unlisted Product Check (§8, §36, §55 Scenario 1: "How much is the pizza?")
  const requestedCandidate = extractRequestedProductCandidate(rawMessage);
  if (requestedCandidate) {
    const serviceMatch = brain.services.find(
      (s) =>
        s.title.toLowerCase().includes(requestedCandidate) ||
        requestedCandidate.includes(s.title.toLowerCase()),
    );
    if (serviceMatch) {
      informationFound.push(`Service: ${serviceMatch.title}`);
      return finalizeTurn({
        conv,
        rawMessage,
        reply: `${serviceMatch.title} starts at KES ${serviceMatch.priceFrom ?? 0}.${
          serviceMatch.description ? ` ${serviceMatch.description}` : ""
        }`,
        responseType: "KNOWN",
        source: "structured_data",
        confidence: "high",
        escalatedToHuman: false,
        preview,
        brain,
        toolsInvoked,
        informationFound,
        informationNotFound,
        missingInformation,
        configurationImprovement,
      });
    }

    // Not in structured products or services! Record missed demand & unanswered question.
    toolsInvoked.push("search_products");
    if (!preview) {
      await recordDemandInsight(businessId, "UNAVAILABLE_PRODUCT", requestedCandidate);
      await recordUnansweredQuestion(businessId, rawMessage);
    }
    informationNotFound.push(`Product: ${requestedCandidate}`);
    const availableSummary =
      brain.products.length > 0
        ? ` We currently have: ${brain.products.map((p) => `${p.name} (KES ${p.basePriceKES ?? p.variantPriceKES ?? 0})`).join(", ")}.`
        : "";
    return finalizeTurn({
      conv,
      rawMessage,
      reply: `${FALLBACK_UNLISTED_PRODUCT_MESSAGE}${availableSummary}`,
      responseType: "UNKNOWN",
      source: "structured_data",
      confidence: "high",
      escalatedToHuman: false,
      preview,
      brain,
      toolsInvoked,
      informationFound,
      informationNotFound,
      missingInformation,
      configurationImprovement,
    });
  }

  // 14. Unknown Answer -> Fallback Safely (§8, §35)
  if (!preview) {
    await recordUnansweredQuestion(businessId, rawMessage);
  }
  informationNotFound.push(rawMessage);
  return finalizeTurn({
    conv,
    rawMessage,
    reply: FALLBACK_UNKNOWN_MESSAGE,
    responseType: "UNKNOWN",
    source: "fallback",
    confidence: "low",
    escalatedToHuman: true,
    preview,
    brain,
    toolsInvoked,
    informationFound,
    informationNotFound,
    missingInformation,
    configurationImprovement,
  });
}

async function finalizeTurn(params: {
  conv: ConversationContext;
  rawMessage: string;
  reply: string;
  responseType: AIResponseType;
  source: AIOperationalDiagnostics["sourceUsed"];
  confidence: AIOperationalDiagnostics["confidence"];
  escalatedToHuman: boolean;
  preview: boolean;
  brain: Awaited<ReturnType<typeof getBusinessBrain>>;
  toolsInvoked: AIToolName[];
  informationFound: string[];
  informationNotFound: string[];
  missingInformation: string[];
  configurationImprovement: string[];
  cartSummary?: AIFrontDeskTurnResult["cartSummary"];
  orderCreated?: unknown;
}): Promise<AIFrontDeskTurnResult> {
  const now = new Date().toISOString();
  const nextTurns = [
    ...params.conv.turns,
    { role: "customer" as const, text: params.rawMessage, timestamp: now },
    {
      role: "assistant" as const,
      text: params.reply,
      timestamp: now,
      responseType: params.responseType,
    },
  ];

  const updatedConv = updateConversationContext(params.conv.businessId, params.conv.conversationId, {
    status: params.escalatedToHuman ? "WAITING_FOR_HUMAN" : params.conv.status,
    activeProductId: params.conv.activeProductId,
    activeProductName: params.conv.activeProductName,
    pendingCartLines: params.conv.pendingCartLines,
    pendingDeliveryZone: params.conv.pendingDeliveryZone,
    turns: nextTurns,
  });

  if (!params.preview) {
    await recordAIQualityEvent({
      businessId: params.conv.businessId,
      conversationId: updatedConv.conversationId,
      sourceUsed: params.source,
      confidence: params.confidence,
      escalatedToHuman: params.escalatedToHuman,
      missingBusinessInfo: params.responseType === "UNKNOWN",
      eventType: `TURN_${params.responseType}`,
    });
  }

  return {
    reply: params.reply,
    responseType: params.responseType,
    source: params.source,
    confidence: params.confidence,
    escalatedToHuman: params.escalatedToHuman,
    conversationId: updatedConv.conversationId,
    conversationStatus: updatedConv.status,
    suggestedActions: [...DEFAULT_SUGGESTED_ACTIONS],
    cartSummary: params.cartSummary || null,
    orderCreated: params.orderCreated,
    preview: params.preview,
    diagnostics: {
      informationFound: params.informationFound,
      informationNotFound: params.informationNotFound,
      missingInformation: params.missingInformation,
      configurationImprovement: params.configurationImprovement,
      sourceUsed: params.source,
      confidence: params.confidence,
      escalatedToHuman: params.escalatedToHuman,
      toolsInvoked: params.toolsInvoked,
      conflicts: params.brain.conflicts,
      knowledgeVersion: params.brain.knowledgeVersion,
    },
  };
}
