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
  // Preserve the existing production contract: MJENGO is enabled unless an operator
  // explicitly disables it. Requiring a new opt-in variable here would silently turn
  // every existing production deployment into a 404 after this PR is released.
  return env.MJENGO_OS_DISABLED !== "true";
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

  // Suspension is decided before payment evidence. The webhook suspends MJENGO OS on a full refund,
  // and that same refund moves the payment PAID → REFUNDED, so a suspended business never has a PAID
  // payment. Checked after the unpaid branch (as before R-MJ-08), SUSPENDED was unreachable for every
  // refund: the owner was told to "complete the KES 2,000 payment" and offered a second checkout (402)
  // instead of the support path (403). See tests/prisma/mjengo-journey-postgres.test.ts.
  if (String(subscription.status).toUpperCase() === "SUSPENDED" || String(input.entitlement?.status).toUpperCase() === "SUSPENDED") {
    return {
      ...base, entitled: false, inGrace: false, status: "SUSPENDED", lifecycle: "SUSPENDED",
      reason: "MJENGO OS is suspended. Contact JATA support to restore it.",
      nextAction: "none",
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
/**
 * Whether the business has completed setup (an ERP configuration row exists — the workspace's
 * journal and settings live there). findUnique resolves `null` for a missing row rather than
 * throwing, so the result must come from the row itself: the previous `.then(() => true)` reported
 * every business as configured, which skipped the "set up first" step for brand-new businesses.
 * A lookup failure is treated as not configured (fail-closed for the lifecycle hint only; it never
 * grants access — entitlement is derived from settled MJENGO subscription/payment evidence).
 */
export async function hasMjengoConfiguration(businessId: string): Promise<boolean> {
  try {
    const row = await (prisma as any).erpConfiguration?.findUnique?.({ where: { businessId }, select: { id: true } });
    return Boolean(row);
  } catch {
    return false;
  }
}

export async function getMjengoEntitlement(businessId: string): Promise<MjengoEntitlementState> {
  const [subscription, entitlement, plan] = await Promise.all([
    (prisma as any).mjengoSubscription?.findUnique?.({
      where: { businessId },
      select: { status: true, planKey: true, startAt: true, expiresAt: true, graceUntil: true },
    }).catch(() => null) ?? null,
    (prisma as any).mjengoEntitlement?.findUnique?.({
      where: { businessId },
      select: { status: true },
    }).catch(() => null) ?? null,
    prisma.planConfig.findUnique({ where: { key: MJENGO_PLAN_KEY }, select: { id: true } }).catch(() => null),
  ]);
  // Payment stores planId (not planKey); resolve the canonical MJENGO plan before looking for
  // provider-settled payment evidence. Never infer a payment from the amount alone.
  const payment = plan
    ? await prisma.payment.findFirst({
        where: { businessId, status: "PAID", planId: plan.id },
        select: { status: true },
        orderBy: { createdAt: "desc" },
      }).catch(() => null)
    : null;
  const paidPayment = payment ? { status: payment.status, planKey: MJENGO_PLAN_KEY } : null;

  const configured = await hasMjengoConfiguration(businessId);

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
