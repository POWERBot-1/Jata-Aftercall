import type { Prisma } from "@prisma/client";
import { enqueueAutomationEvent } from "@/lib/automation/events";

/** The Business Page onboarding write and its event are intentionally one DB transaction. */
export async function createBusinessWithOnboardingEvent(
  tx: Prisma.TransactionClient,
  data: Prisma.BusinessCreateArgs["data"],
) {
  const business = await tx.business.create({ data });
  await enqueueAutomationEvent(tx, {
    id: `business_created_${business.id}`,
    type: "business.created",
    occurredAt: business.createdAt.toISOString(),
    tenantId: business.id,
    source: "business_page",
    data: { businessId: business.id, slug: business.slug, businessName: business.name, category: business.category },
  });
  return business;
}
