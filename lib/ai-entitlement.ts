/**
 * AI Package Entitlement (§3, §4, §31, §32, §49, §50) — multi-tenant entitlement enforcement.
 *
 * A business accesses live AI Business Front Desk functionality only when it has an ACTIVE
 * subscription to AI_BUSINESS_FRONT_DESK (KES 499 / 30 days) backed by a verified PAID
 * server-side payment. When expired/cancelled/unpaid, the configured JATA subscription/grace
 * policy applies, while historical transaction records remain accessible.
 */

import prisma from "./db";

export const AI_FRONT_DESK_PLAN_KEY = "AI_BUSINESS_FRONT_DESK";
export const AI_FRONT_DESK_PRICE_KES = 499;
export const AI_FRONT_DESK_DURATION_DAYS = 30;

export type AIEntitlementStatus =
  | "NONE"
  | "PENDING"
  | "ACTIVE"
  | "PAST_DUE"
  | "EXPIRED"
  | "SUSPENDED"
  | "CANCELLED"
  | "GRACE_PERIOD"
  | "PREVIEW_ONLY"
  | "UNSUBSCRIBED";

export type AIPackageStatusResult = {
  active: boolean;
  entitled: boolean;
  status: AIEntitlementStatus;
  priceKES: number;
  currency: string;
  billingCycleDays: number;
  expiresAt?: Date;
  graceUntil?: Date;
  packageKey?: string;
  historicalAccessAllowed: boolean;
  reason: string;
};

export type AIPackageEntitlementSummary = AIPackageStatusResult;

type SubscriptionLike = {
  status: string;
  planId?: string | null;
  expiresAt?: Date | null;
  graceUntil?: Date | null;
  plan?: { key?: string } | null;
} | null;

type EntitlementRowLike = {
  status?: string | null;
  packageKey?: string | null;
  packageName?: string | null;
  priceKES?: number | null;
  currency?: string | null;
  billingCycleDays?: number | null;
  activatedAt?: Date | null;
  startsAt?: Date | null;
  expiresAt?: Date | null;
} | null;

/**
 * Pure entitlement evaluation so the commercial gate is deterministic and unit-testable.
 * Client-supplied flags are never accepted here.
 */
export function deriveAIEntitlement(input: {
  subscription?: SubscriptionLike;
  entitlement?: EntitlementRowLike;
  paidPayment?: { status?: string | null } | null;
  planKey?: string | null;
  now?: Date;
}): AIPackageStatusResult {
  const now = input.now ?? new Date();
  const subscription = input.subscription ?? null;
  const entitlement = input.entitlement ?? null;
  const resolvedPlanKey =
    input.planKey ||
    subscription?.plan?.key ||
    entitlement?.packageKey ||
    entitlement?.packageName ||
    AI_FRONT_DESK_PLAN_KEY;

  const baseFields = {
    priceKES: entitlement?.priceKES ?? AI_FRONT_DESK_PRICE_KES,
    currency: entitlement?.currency ?? "KES",
    billingCycleDays: entitlement?.billingCycleDays ?? AI_FRONT_DESK_DURATION_DAYS,
    packageKey: resolvedPlanKey,
    historicalAccessAllowed: true,
  };

  if (!subscription && !entitlement) {
    return {
      ...baseFields,
      active: false,
      entitled: false,
      status: "NONE",
      reason: "Choose the AI Business Front Desk plan (KES 499/month) to activate live AI.",
    };
  }

  if (
    resolvedPlanKey &&
    resolvedPlanKey !== AI_FRONT_DESK_PLAN_KEY &&
    entitlement?.packageKey !== AI_FRONT_DESK_PLAN_KEY &&
    entitlement?.packageName !== AI_FRONT_DESK_PLAN_KEY
  ) {
    return {
      ...baseFields,
      active: false,
      entitled: false,
      status: "NONE",
      reason: "Current subscription plan does not include the AI Business Front Desk package.",
    };
  }

  if (entitlement?.status === "SUSPENDED" || subscription?.status === "SUSPENDED") {
    return {
      ...baseFields,
      active: false,
      entitled: false,
      status: "SUSPENDED",
      expiresAt: subscription?.expiresAt ?? entitlement?.expiresAt ?? undefined,
      graceUntil: subscription?.graceUntil ?? undefined,
      packageKey: AI_FRONT_DESK_PLAN_KEY,
      reason: "AI Business Front Desk is suspended. Historical records remain accessible.",
    };
  }

  if (entitlement?.status === "CANCELLED" || subscription?.status === "CANCELLED") {
    return {
      ...baseFields,
      active: false,
      entitled: false,
      status: "CANCELLED",
      expiresAt: subscription?.expiresAt ?? entitlement?.expiresAt ?? undefined,
      graceUntil: subscription?.graceUntil ?? undefined,
      packageKey: AI_FRONT_DESK_PLAN_KEY,
      reason: "AI Business Front Desk subscription was cancelled. Renew to re-enable live AI.",
    };
  }

  const hasVerifiedPayment =
    input.paidPayment?.status === "PAID" || entitlement?.status === "ACTIVE";
  const isBillingActive =
    subscription?.status === "ACTIVE" ||
    subscription?.status === "EXPIRING" ||
    entitlement?.status === "ACTIVE";

  if (!hasVerifiedPayment && !isBillingActive) {
    return {
      ...baseFields,
      active: false,
      entitled: false,
      status: "PENDING",
      packageKey: AI_FRONT_DESK_PLAN_KEY,
      reason: "Complete server-verified payment (KES 499/month) to activate AI Business Front Desk.",
    };
  }

  if (entitlement && entitlement.status !== "ACTIVE" && !input.paidPayment) {
    return {
      ...baseFields,
      active: false,
      entitled: false,
      status: "PENDING",
      expiresAt: subscription?.expiresAt ?? entitlement?.expiresAt ?? undefined,
      packageKey: entitlement.packageKey || entitlement.packageName || AI_FRONT_DESK_PLAN_KEY,
      reason: "AI package entitlement is pending payment verification.",
    };
  }

  const rawExpires = subscription?.expiresAt ?? entitlement?.expiresAt ?? null;
  const expiresAt = rawExpires ? new Date(rawExpires) : null;
  const graceUntil = subscription?.graceUntil ? new Date(subscription.graceUntil) : null;
  const validUntil = graceUntil ?? expiresAt;

  if (!expiresAt) {
    return {
      ...baseFields,
      active: Boolean(entitlement?.status === "ACTIVE" && !subscription),
      entitled: Boolean(entitlement?.status === "ACTIVE" && !subscription),
      status: entitlement?.status === "ACTIVE" && !subscription ? "ACTIVE" : "PENDING",
      packageKey: AI_FRONT_DESK_PLAN_KEY,
      reason:
        entitlement?.status === "ACTIVE" && !subscription
          ? "Active"
          : "Subscription expiry window is not active yet.",
    };
  }

  if (validUntil && now.getTime() > validUntil.getTime()) {
    return {
      ...baseFields,
      active: false,
      entitled: false,
      status: "EXPIRED",
      expiresAt,
      graceUntil: graceUntil ?? undefined,
      packageKey: AI_FRONT_DESK_PLAN_KEY,
      reason: "Your AI Business Front Desk subscription has expired. Historical records remain accessible.",
    };
  }

  if (now.getTime() > expiresAt.getTime() && graceUntil && now.getTime() <= graceUntil.getTime()) {
    return {
      ...baseFields,
      active: isBillingActive,
      entitled: isBillingActive,
      status: isBillingActive ? "PAST_DUE" : "EXPIRED",
      expiresAt,
      graceUntil,
      packageKey: AI_FRONT_DESK_PLAN_KEY,
      reason: "Subscription is within the JATA grace period. Renew to prevent interruption.",
    };
  }

  if (!isBillingActive) {
    return {
      ...baseFields,
      active: false,
      entitled: false,
      status: "PENDING",
      expiresAt,
      graceUntil: graceUntil ?? undefined,
      packageKey: AI_FRONT_DESK_PLAN_KEY,
      reason: "Subscription is not active yet.",
    };
  }

  return {
    ...baseFields,
    active: true,
    entitled: true,
    status: "ACTIVE",
    expiresAt,
    graceUntil: graceUntil ?? undefined,
    packageKey: entitlement?.packageKey || entitlement?.packageName || AI_FRONT_DESK_PLAN_KEY,
    reason: "Active",
  };
}

export async function getAIPackageStatus(businessId: string): Promise<AIPackageStatusResult> {
  if (!businessId) {
    return {
      active: false,
      entitled: false,
      status: "NONE",
      priceKES: AI_FRONT_DESK_PRICE_KES,
      currency: "KES",
      billingCycleDays: AI_FRONT_DESK_DURATION_DAYS,
      historicalAccessAllowed: false,
      reason: "Business ID is required.",
    };
  }

  const [entitlement, subscription, paidPayment] = await Promise.all([
    prisma.aIPackageEntitlement?.findUnique?.({ where: { businessId } }).catch(() => null) ?? null,
    prisma.subscription?.findUnique?.({ where: { businessId } }).catch(() => null) ?? null,
    prisma.payment?.findFirst?.({
      where: { businessId, status: "PAID" },
      select: { status: true, planId: true },
    }).catch(() => null) ?? null,
  ]);

  let planKey: string | null = null;
  if (subscription?.planId && prisma.planConfig?.findUnique) {
    try {
      const plan = await prisma.planConfig.findUnique({ where: { id: subscription.planId } });
      planKey = plan?.key ?? null;
    } catch {
      planKey = null;
    }
  }

  if (!entitlement && !paidPayment) {
    return {
      active: false,
      entitled: false,
      status: subscription ? "PENDING" : "NONE",
      priceKES: AI_FRONT_DESK_PRICE_KES,
      currency: "KES",
      billingCycleDays: AI_FRONT_DESK_DURATION_DAYS,
      expiresAt: subscription?.expiresAt ?? undefined,
      graceUntil: subscription?.graceUntil ?? undefined,
      packageKey: planKey || undefined,
      historicalAccessAllowed: true,
      reason: "AI Business Front Desk entitlement is not active yet.",
    };
  }

  return deriveAIEntitlement({
    subscription,
    entitlement,
    paidPayment,
    planKey,
  });
}

export async function syncAIPackageEntitlement(businessId: string): Promise<AIPackageStatusResult> {
  const state = await getAIPackageStatus(businessId);
  if (prisma.aIPackageEntitlement?.upsert) {
    await prisma.aIPackageEntitlement.upsert({
      where: { businessId },
      update: {
        packageKey: AI_FRONT_DESK_PLAN_KEY,
        status: state.active ? "ACTIVE" : state.status === "NONE" ? "PENDING" : state.status,
        ...(state.active ? { activatedAt: new Date() } : {}),
        expiresAt: state.expiresAt ?? null,
      },
      create: {
        businessId,
        packageKey: AI_FRONT_DESK_PLAN_KEY,
        status: state.active ? "ACTIVE" : "PENDING",
        activatedAt: state.active ? new Date() : null,
        expiresAt: state.expiresAt ?? null,
      },
    });
  }
  return state;
}

export function assertAIFrontDeskPlanPricing(
  plan:
    | {
        key: string;
        priceKES?: number;
        priceKes?: number;
        durationDays: number;
        isActive?: boolean;
      }
    | null
    | undefined,
): { ok: boolean; error?: string } {
  if (!plan || plan.key !== AI_FRONT_DESK_PLAN_KEY) {
    return { ok: false, error: `Expected plan key ${AI_FRONT_DESK_PLAN_KEY}` };
  }
  const resolvedPrice = Number(plan.priceKES ?? plan.priceKes ?? 0);
  if (resolvedPrice !== AI_FRONT_DESK_PRICE_KES || plan.durationDays !== AI_FRONT_DESK_DURATION_DAYS) {
    return {
      ok: false,
      error: `Expected KES ${AI_FRONT_DESK_PRICE_KES} / ${AI_FRONT_DESK_DURATION_DAYS} days`,
    };
  }
  return { ok: true };
}
