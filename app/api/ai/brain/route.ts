import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { getBusinessBrain } from "@/lib/ai-business-brain";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";

/**
 * Business Brain (§7) — structured, authoritative business data retrieval.
 * Never returns secrets (§6, §43). Structured transactional data takes precedence.
 */

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  const url = new URL(req.url);
  const businessId = url.searchParams.get("businessId");
  const guard = await guardTenantMutation(session, businessId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const brain = await getBusinessBrain(businessId!);
    // Redact anything that could be sensitive; return only structured facts.
    return NextResponse.json({
      businessId,
      businessProfile: {
        id: brain.business?.id,
        name: brain.business?.name,
        category: brain.business?.category,
        description: brain.business?.description,
        location: brain.business?.location,
        theme: brain.business?.theme,
        language: brain.business?.language,
        isPublished: brain.business?.isPublished,
        status: brain.business?.status,
      },
      products: brain.products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        category: p.category,
        basePriceKES: p.basePriceKES,
        variantPriceKES: p.variantPriceKES,
        currency: p.currency,
        stockStatus: p.stockStatus,
        preOrderAllowed: p.preOrderAllowed,
        deliveryEligible: p.deliveryEligible,
      })),
      services: brain.services.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        priceFrom: s.priceFrom,
        priceLabel: s.priceLabel,
        sortOrder: s.sortOrder,
      })),
      faqs: brain.faqs,
      aiConfig: brain.aiConfig ? {
        tone: brain.aiConfig.tone,
        language: brain.aiConfig.language,
        salesBehavior: brain.aiConfig.salesBehavior,
        orderingAllowed: brain.aiConfig.orderingAllowed,
        preordersAllowed: brain.aiConfig.preordersAllowed,
        humanEscalation: brain.aiConfig.humanEscalation,
        welcomeMessage: brain.aiConfig.welcomeMessage,
      } : null,
      knowledgeCount: brain.knowledge.length,
      sourceNote: "Structured transactional data takes precedence over free-form documents (§7).",
    });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
