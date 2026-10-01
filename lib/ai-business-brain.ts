/**
 * AI Business Brain (§7, §9, §10) — authoritative business data for the AI package.
 * Every read is tenant-scoped; structured transactional data takes precedence over
 * free-form documents (§7). Never exposes payment secrets (§6, §43).
 */

import prisma from "./db";

export async function getBusinessBrain(businessId: string) {
  const [business, products, services, faqs, knowledge, aiConfig] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, category: true, description: true, location: true, phone: true, whatsapp: true, openingHours: true, socialLinks: true, theme: true, language: true, isPublished: true, status: true } }),
    prisma.product.findMany({ where: { businessId }, select: { id: true, name: true, description: true, sku: true, category: true, basePriceKES: true, variantPriceKES: true, currency: true, stockStatus: true, quantity: true, preOrderAllowed: true, minOrder: true, maxOrder: true, deliveryEligible: true } }),
    prisma.service.findMany({ where: { businessId }, select: { id: true, title: true, description: true, priceFrom: true, priceLabel: true, sortOrder: true } }),
    prisma.fAQ.findMany({ where: { businessId, isActive: true }, select: { question: true, approvedAnswer: true } }),
    prisma.knowledgeDocument.findMany({ where: { businessId, isApproved: true }, select: { title: true, content: true, sourceType: true } }),
    prisma.aIConfiguration.findUnique({ where: { businessId } }),
  ]);

  if (!business) {
    throw new Error(`Business ${businessId} not found — tenant isolation enforced.`);
  }

  return {
    business,
    products,
    services,
    faqs,
    knowledge,
    aiConfig,
  };
}
