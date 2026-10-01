/**
 * AI Package Entitlement (§49, §50) — multi-tenant entitlement enforcement.
 * A business only accesses AI package functionality when it has an ACTIVE
 * subscription to AI_BUSINESS_FRONT_DESK backed by a verified PAID payment.
 */

import prisma from "./db";

export async function getAIPackageStatus(businessId: string): Promise<{ active: boolean; expiresAt?: Date; packageKey?: string }> {
  const entitlement = await prisma.aIPackageEntitlement.findUnique({ where: { businessId } });
  const subscription = await prisma.subscription.findUnique({ where: { businessId } });
  if (!entitlement || !subscription) return { active: false };
  const isActiveSubscription = subscription.status === "ACTIVE" && subscription.expiresAt && subscription.expiresAt > new Date();
  return {
    active: entitlement.status === "ACTIVE" && isActiveSubscription,
    expiresAt: subscription.expiresAt ?? undefined,
    packageKey: entitlement.packageKey,
  };
}
