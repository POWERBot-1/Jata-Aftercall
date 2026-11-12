/**
 * MJENGO OS entitlement — KES 2,000 / 30 days, independent product.
 *
 * MJENGO OS is a separate business-management product inside JATA AFTERCALL.
 * It has its own plan key, subscription row, entitlement row, and workspace.
 * - BUSINESS_POS (KES 499) never grants MJENGO OS.
 * - MJENGO_OS (KES 2,000) never grants BUSINESS_POS.
 * - No customer is transferred; existing POS access is preserved.
 * - Browser never dictates price; `assertMjengoPricing` is server-authoritative.
 */

import prisma from "../db";

export const MJENGO_PLAN_KEY = "MJENGO_OS";
export const MJENGO_PLAN_NAME = "MJENGO OS";
export const MJENGO_PLAN_PRICE_KES = 2000;
export const MJENGO_PLAN_DURATION_DAYS = 30;
export const MJENGO_GRACE_DAYS = 3;

export type MjengoLifecycleStatus =
  | "SETUP"
  | "CONFIGURED"
  | "AWAITING_PAYMENT"
  | "ACTIVE"
  | "PAST_DUE"
  | "EXPIRED"
  | "SUSPENDED"
  | "CANCELLED";

export type MjengoEntitlementStatus =
  | "NONE"
  | "PENDING"
  | "ACTIVE"
  | "PAST_DUE"
  | "EXPIRED"
  | "SUSPENDED"
  | "CANCELLED";

export type MjengoEntitlementState = {
  entitled: boolean;
  status: MjengoEntitlementStatus;
  lifecycle: MjengoLifecycleStatus;
  planKey: string;
  priceKES: number;
  expiresAt: Date | null;
  graceUntil: Date | null;
  reason: string;
  nextAction: "setup" | "pay" | "renew" | "none";
  inGrace: boolean;
};

export type MjengoSubscriptionLike = {
  status?: string | null;
  planKey?: string | null;
  startAt?: Date | string | null;
  expiresAt?: Date | string | null;
  graceUntil?: Date | string | null;
  cancelledAt?: Date | string | null;
} | null;

export type MjengoEntitlementInput = {
  subscription?: MjengoSubscriptionLike;
  entitlement?: { status?: string | null } | null;
  paidPayment?: { status?: string | null; planKey?: string | null } | null;
  configured?: boolean;
  now?: Date;
};

const PLAN_META = { planKey: MJENGO_PLAN_KEY, priceKES: MJENGO_PLAN_PRICE_KES } as const;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function assertMjengoPricing(plan: { key?: string; priceKES?: number; durationDays?: number } | null | undefined): boolean {
  if (!plan || plan.key !== MJENGO_PLAN_KEY) return false;
  return plan.priceKES === MJENGO_PLAN_PRICE_KES && plan.durationDays === MJENGO_PLAN_DURATION_DAYS;
}

export function mjengoFeatureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MJENGO_OS_DISABLED === "true") return false;
  if (env.MJENGO_OS_ENABLED === "true") return true;
  return env.NODE_ENV !== "production";
}

/**
 * Single decision point: may this business use MJENGO OS?
 * Order: cancellation → paid evidence → subscription validity/grace → configuration.
 * Server-authoritative; browser flag never consulted.
 */
export function deriveMjengoEntitlement(input: MjengoEntitlementInput): MjengoEntitlementState {
  const now = input.now ?? new Date();
  const subscription = input.subscription ?? null;
  const configured = Boolean(input.configured);
  const paid = Boolean(input.paidPayment && input.paidPayment.status === "PAID" && input.paidPayment.planKey === MJENGO_PLAN_KEY);
  const base = {
    ...PLAN_META,
    expiresAt: toDate(subscription?.expiresAt),
    graceUntil: toDate(subscription?.graceUntil),
  };

  if (input.entitlement?.status === "CANCELLED" || subscription?.status === "CANCELLED") {
    return {
      ...base, entitled: false, inGrace: false, status: "CANCELLED", lifecycle: "CANCELLED",
      reason: "MJENGO OS was cancelled. Subscribe again to bring your workspace back.",
      nextAction: "pay",
    };
  }

  if (!subscription) {
    if (paid) {
      return {
        ...base, entitled: false, inGrace: false, status: "PENDING", lifecycle: "AWAITING_PAYMENT",
        reason: "Payment received — your workspace is being switched on. This usually takes a moment.",
        nextAction: "none",
      };
    }
    return {
      ...base, entitled: false, inGrace: false, status: "NONE", lifecycle: configured ? "CONFIGURED" : "SETUP",
      reason: configured
        ? "Your business is configured. Add MJENGO OS for KES 2,000/month to go live."
        : "Set up your business first, then add MJENGO OS for KES 2,000/month.",
      nextAction: configured ? "pay" : "setup",
    };
  }

  if (subscription.planKey && subscription.planKey !== MJENGO_PLAN_KEY) {
    return {
      ...base, entitled: false, inGrace: false, status: "NONE", lifecycle: configured ? "CONFIGURED" : "SETUP",
      reason: "Your current plan does not include MJENGO OS. Add it for KES 2,000/month.",
      nextAction: "pay",
    };
  }

  const activeStatuses = ["ACTIVE", "EXPIRING", "PAST_DUE"];
  const subscriptionActive = activeStatuses.includes(String(subscription.status ?? "").toUpperCase());
  if (!subscriptionActive && !paid) {
    return {
      ...base, entitled: false, inGrace: false, status: "PENDING", lifecycle: "AWAITING_PAYMENT",
      reason: "Complete the KES 2,000 payment to activate MJENGO OS.",
      nextAction: "pay",
    };
  }

  if (String(subscription.status).toUpperCase() === "SUSPENDED" || String(input.entitlement?.status).toUpperCase() === "SUSPENDED") {
    return {
      ...base, entitled: false, inGrace: false, status: "SUSPENDED", lifecycle: "SUSPENDED",
      reason: "MJENGO OS is suspended. Contact JATA support to restore it.",
      nextAction: "none",
    };
  }

  const validUntil = base.graceUntil ?? base.expiresAt;
  if (validUntil && now.getTime() > validUntil.getTime()) {
    return {
      ...base, entitled: false, inGrace: false, status: "EXPIRED", lifecycle: "EXPIRED",
      reason: "Your MJENGO OS subscription has expired. Renew to keep operating. Your records are safe.",
      nextAction: "renew",
    };
  }

  if (base.expiresAt && now.getTime() > base.expiresAt.getTime()) {
    return {
      ...base, entitled: true, inGrace: Boolean(base.graceUntil && now.getTime() <= base.graceUntil.getTime()),
      status: "PAST_DUE", lifecycle: "PAST_DUE",
      reason: "MJENGO OS is in its grace period. Renew to avoid interruption.",
      nextAction: "renew",
    };
  }

  if (!subscriptionActive) {
    return {
      ...base, entitled: false, inGrace: false, status: "PENDING", lifecycle: "AWAITING_PAYMENT",
      reason: paid ? "Payment received — your workspace is being switched on." : "Complete the KES 2,000 payment to activate MJENGO OS.",
      nextAction: paid ? "none" : "pay",
    };
  }

  return {
    ...base, entitled: true, inGrace: false, status: "ACTIVE", lifecycle: "ACTIVE",
    reason: "MJENGO OS is live.",
    nextAction: "none",
  };
}

// MJENGO uses dedicated tables so ERP PRO and MJENGO OS can coexist for one business.
export async function getMjengoEntitlement(businessId: string): Promise<MjengoEntitlementState> {
  const [subscription, entitlement, paidPayment] = await Promise.all([
    (prisma as any).mjengoSubscription?.findUnique?.({
      where: { businessId },
      select: { status: true, planKey: true, startAt: true, expiresAt: true, graceUntil: true },
    }).catch(() => null) ?? null,
    (prisma as any).mjengoEntitlement?.findUnique?.({
      where: { businessId },
      select: { status: true },
    }).catch(() => null) ?? null,
    (prisma as any).payment?.findFirst?.({
      where: { businessId, status: "PAID", planKey: MJENGO_PLAN_KEY } as any,
      select: { status: true, planKey: true },
      orderBy: { createdAt: "desc" },
    }).catch(() => null) ?? null,
  ]);

  // Check if business has any ERP configuration as proxy for "configured"
  const configured = await (prisma as any).erpConfiguration?.findUnique?.({ where: { businessId } }).then(() => true).catch(() => false) ?? false;

  return deriveMjengoEntitlement({
    subscription: subscription as any ?? null,
    entitlement: entitlement as any ?? null,
    paidPayment: paidPayment as any ?? null,
    configured,
  });
}

export async function syncMjengoEntitlement(businessId: string): Promise<MjengoEntitlementState> {
  const state = await getMjengoEntitlement(businessId);
  try {
    await (prisma as any).mjengoEntitlement?.upsert?.({
      where: { businessId },
      update: { status: state.status, expiresAt: state.expiresAt } as never,
      create: { businessId, packageKey: MJENGO_PLAN_KEY, status: state.status, expiresAt: state.expiresAt } as never,
    });
  } catch {
    // persistence must never fail settlement; derivation is truth
  }
  return state;
}
