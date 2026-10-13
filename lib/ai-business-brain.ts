/**
 * AI Business Brain (§6, §7, §9, §10, §35) — authoritative business data for the AI package.
 * Every read is tenant-scoped; structured transactional data takes precedence over
 * free-form documents (§7). Never exposes payment credentials (§6, §10, §43).
 */

import { authoritativeUnitPrice } from "./ai-grounding";
import prisma from "./db";
import { getExtendedAIConfig, type ExtendedAIConfig } from "./ai-config";

export type KnowledgeConflict = {
  productId: string;
  productName: string;
  field: "price" | "stockStatus";
  structuredValue: string;
  conflictingValue: string;
  sourceTitle: string;
  sourceType: "knowledge_document" | "faq";
  resolution: "STRUCTURED_DATA_WINS";
};

/**
 * Identifies stale or conflicting knowledge in uploaded documents or FAQs so the owner
 * can review and resolve them, while structured transactional data always wins (§7, §33).
 */
export function detectKnowledgeConflicts(params: {
  products: Array<{
    id: string;
    name: string;
    basePriceKES?: number | null;
    variantPriceKES?: number | null;
    salePriceKES?: number | null;
    salePriceStartsAt?: Date | null;
    salePriceEndsAt?: Date | null;
    stockStatus?: string | null;
  }>;
  knowledge: Array<{ title: string; content: string; sourceType?: string }>;
  faqs?: Array<{ question: string; approvedAnswer: string }>;
}): KnowledgeConflict[] {
  const conflicts: KnowledgeConflict[] = [];
  const sources: Array<{ title: string; text: string; kind: "knowledge_document" | "faq" }> = [
    ...params.knowledge.map((k) => ({ title: k.title, text: `${k.title} ${k.content}`, kind: "knowledge_document" as const })),
    ...(params.faqs || []).map((f) => ({ title: f.question, text: `${f.question} ${f.approvedAnswer}`, kind: "faq" as const })),
  ];

  for (const product of params.products) {
    const productNameLower = product.name.trim().toLowerCase();
    if (!productNameLower || productNameLower.length < 2) continue;
    // The price a customer pays now (sale window applied). Comparing against the base price would flag a correct sale.
    const authoritativePrice = authoritativeUnitPrice(product as any) ?? null;
    const authoritativeStock = product.stockStatus || "IN_STOCK";

    for (const src of sources) {
      const textLower = src.text.toLowerCase();
      const idx = textLower.indexOf(productNameLower);
      if (idx === -1) continue;

      // Inspect window around the product mention for conflicting KES price or "=" assignment
      const windowStart = Math.max(0, idx - 40);
      const windowEnd = Math.min(src.text.length, idx + product.name.length + 80);
      const snippet = src.text.slice(windowStart, windowEnd);

      if (authoritativePrice !== null) {
        const priceMatches = [
          ...snippet.matchAll(/(?:kes|ksh|shs?|=|:)\s*([\d,]{2,9})/gi),
          ...snippet.matchAll(/([\d,]{2,9})\s*(?:kes|ksh|shillings|\/=)/gi),
        ];
        for (const match of priceMatches) {
          const parsed = Number(String(match[1]).replace(/,/g, ""));
          if (Number.isFinite(parsed) && parsed > 0 && parsed !== authoritativePrice) {
            conflicts.push({
              productId: product.id,
              productName: product.name,
              field: "price",
              structuredValue: `KES ${authoritativePrice}`,
              conflictingValue: `KES ${parsed}`,
              sourceTitle: src.title,
              sourceType: src.kind,
              resolution: "STRUCTURED_DATA_WINS",
            });
            break;
          }
        }
      }

      if (authoritativeStock === "OUT_OF_STOCK" || authoritativeStock === "DISCONTINUED") {
        if (/\b(in stock|available now|ready now)\b/i.test(snippet) && !/\b(not|out of)\b/i.test(snippet)) {
          conflicts.push({
            productId: product.id,
            productName: product.name,
            field: "stockStatus",
            structuredValue: authoritativeStock,
            conflictingValue: "IN_STOCK",
            sourceTitle: src.title,
            sourceType: src.kind,
            resolution: "STRUCTURED_DATA_WINS",
          });
        }
      }
    }
  }

  return conflicts;
}

export async function getBusinessBrain(businessId: string) {
  if (!businessId || typeof businessId !== "string") {
    throw new Error("Business ID required — tenant isolation enforced.");
  }

  const [business, products, services, faqs, knowledge, aiConfig] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        description: true,
        location: true,
        phone: true,
        whatsapp: true,
        openingHours: true,
        socialLinks: true,
        aftercallMsg: true,
        theme: true,
        language: true,
        isPublished: true,
        status: true,
      },
    }),
    prisma.product.findMany({
      where: { businessId },
      select: {
        id: true,
        name: true,
        description: true,
        sku: true,
        category: true,
        basePriceKES: true,
        variantPriceKES: true,
        salePriceKES: true,
        salePriceStartsAt: true,
        salePriceEndsAt: true,
        currency: true,
        stockStatus: true,
        quantity: true,
        preOrderAllowed: true,
        minOrder: true,
        maxOrder: true,
        deliveryEligible: true,
        variantOptions: true,
        imageUrl: true,
        isActive: true,
      },
    }),
    prisma.service.findMany({
      where: { businessId },
      select: {
        id: true,
        title: true,
        description: true,
        priceFrom: true,
        priceToKES: true,
        priceLabel: true,
        pricingType: true,
        durationMinutes: true,
        depositKES: true,
        availability: true,
        bookingEnabled: true,
        sortOrder: true,
        isActive: true,
      },
    }),
    prisma.fAQ.findMany({
      where: { businessId, isActive: true },
      select: { id: true, question: true, approvedAnswer: true },
    }),
    prisma.knowledgeDocument.findMany({
      where: { businessId, isApproved: true },
      select: { id: true, title: true, content: true, sourceType: true },
    }),
    prisma.aIConfiguration.findUnique({ where: { businessId } }),
  ]);

  if (!business) {
    throw new Error(`Business ${businessId} not found — tenant isolation enforced.`);
  }

  // Load additive authoritative records safely (variants, offer/promotions, public payment info,
  // resolved unanswered questions, nominated notification recipients).
  const [variants, offer, merchantPayment, resolvedQuestions, notificationRecipients] = await Promise.all([
    prisma.productVariant?.findMany?.({
      where: { businessId },
      select: { id: true, productId: true, label: true, options: true, priceKES: true, sku: true, stockStatus: true },
    }).catch(() => []) ?? [],
    prisma.offer?.findUnique?.({
      where: { businessId },
      select: { id: true, title: true, subtitle: true, validUntil: true, isActive: true, badge: true, ctaLabel: true },
    }).catch(() => null) ?? null,
    prisma.merchantPaymentConfig?.findUnique?.({
      where: { businessId },
      select: { id: true, publicInfo: true, isActive: true },
    }).catch(() => null) ?? null,
    prisma.unansweredQuestion?.findMany?.({
      where: { businessId, isResolved: true },
      select: { id: true, question: true, approvedAnswer: true },
    }).catch(() => []) ?? [],
    prisma.notificationRecipient?.findMany?.({
      where: { businessId, isActive: true },
      select: { id: true, label: true, phone: true, email: true, whatsappEnabled: true, smsEnabled: true, emailEnabled: true },
    }).catch(() => []) ?? [],
  ]);

  const extendedConfig: ExtendedAIConfig = await getExtendedAIConfig(businessId, aiConfig, business.category);

  // Merge owner-approved unanswered questions into authoritative FAQs (§35)
  const mergedFaqs = [...faqs];
  for (const rq of Array.isArray(resolvedQuestions) ? resolvedQuestions : []) {
    if (rq?.question && rq?.approvedAnswer) {
      const alreadyExists = mergedFaqs.some((f) => f.question.toLowerCase() === rq.question.toLowerCase());
      if (!alreadyExists) {
        mergedFaqs.push({ id: rq.id, question: rq.question, approvedAnswer: rq.approvedAnswer });
      }
    }
  }

  // Attach variants to their parent products
  const variantsByProduct = new Map<string, Array<{ id: string; productId: string; label: string; options?: string | null; priceKES?: number | null; sku?: string | null; stockStatus: string }>>();
  for (const v of Array.isArray(variants) ? variants : []) {
    const list = variantsByProduct.get(v.productId) || [];
    list.push(v);
    variantsByProduct.set(v.productId, list);
  }

  const enrichedProducts = products.map((p) => ({
    ...p,
    variants: variantsByProduct.get(p.id) || [],
  }));

  // Filter out internal system configuration rows from free-form knowledge documents
  const customerKnowledge = knowledge.filter((k) => k.sourceType !== "ai_front_desk_config");

  const conflicts = detectKnowledgeConflicts({
    products: enrichedProducts,
    knowledge: customerKnowledge,
    faqs: mergedFaqs,
  });

  const activeOffer =
    offer && offer.isActive !== false && (!offer.validUntil || new Date(offer.validUntil) > new Date())
      ? offer
      : null;

  return {
    business,
    products: enrichedProducts,
    services,
    faqs: mergedFaqs,
    knowledge: customerKnowledge,
    aiConfig,
    extendedConfig,
    delivery: extendedConfig.delivery,
    policies: extendedConfig.policies,
    promotions: activeOffer ? [activeOffer] : [],
    paymentMethods:
      merchantPayment && merchantPayment.isActive !== false
        ? { publicInfo: merchantPayment.publicInfo, isConfigured: Boolean(merchantPayment.publicInfo) }
        : { publicInfo: null, isConfigured: false },
    notificationRecipients: Array.isArray(notificationRecipients) ? notificationRecipients : [],
    conflicts,
    knowledgeVersion: extendedConfig.publishedVersion || extendedConfig.draftVersion || 1,
  };
}
