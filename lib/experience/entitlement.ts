/**
 * Subscription entitlement for the Interactive Business package (§59)
 *
 * A business gets the premium experience only when it holds BOTH:
 *   1. a verified PAID payment, and
 *   2. a currently-valid subscription to the INTERACTIVE_BUSINESS plan
 *
 * This mirrors the existing publish gate (§3) instead of introducing a parallel system.
 * Expiry never deletes content: the entitlement simply lapses and the live site is
 * withdrawn from public view until renewal (§59).
 */

import prisma from "../db";

export const INTERACTIVE_PLAN_KEY = "INTERACTIVE_BUSINESS";
export const INTERACTIVE_PRICE_KES = 999;
export const INTERACTIVE_DURATION_DAYS = 30;

export type EntitlementStatus = "NONE" | "PENDING" | "ACTIVE" | "PAST_DUE" | "EXPIRED" | "CANCELLED";

export type EntitlementState = {
  entitled: boolean;
  status: EntitlementStatus;
  planKey?: string;
  expiresAt?: Date | null;
  graceUntil?: Date | null;
  /** Plain-language reason, safe to show an owner. */
  reason: string;
};

type SubscriptionLike = {
  status: string;
  expiresAt?: Date | null;
  graceUntil?: Date | null;
  plan?: { key?: string } | null;
  planKey?: string;
} | null;

/**
 * Pure decision function — no database access, so the entitlement boundary is unit-testable
 * and cannot be bypassed by a client-supplied flag.
 */
export function deriveEntitlement(input: {
  subscription: SubscriptionLike;
  entitlement?: { status?: string | null } | null;
  paidPayment?: { status?: string | null } | null;
  now?: Date;
}): EntitlementState {
  const now = input.now ?? new Date();
  const subscription = input.subscription;
  const planKey = subscription?.plan?.key || subscription?.planKey || null;

  if (!subscription) {
    return { entitled: false, status: "NONE", reason: "Choose the Interactive Business plan to unlock your premium website." };
  }
  if (planKey && planKey !== INTERACTIVE_PLAN_KEY) {
    return {
      entitled: false,
      status: "NONE",
      planKey,
      reason: "Your current plan does not include the Interactive Business website. Upgrade to use it.",
    };
  }
  // Payment must be verified before the premium package is usable (§3). An already-active
  // subscription counts as verified: renewals and admin activations settle the same way.
  const verifiedPayment = input.paidPayment?.status === "PAID";
  // PAST_DUE and EXPIRING are billing states of a subscription that was already paid for.
  const subscriptionActive =
    subscription.status === "ACTIVE" || subscription.status === "EXPIRING" || subscription.status === "PAST_DUE";
  if (!verifiedPayment && !subscriptionActive) {
    return { entitled: false, status: "PENDING", planKey: planKey || undefined, reason: "Complete your KES 999 payment to activate Interactive Business." };
  }
  if (input.entitlement?.status === "CANCELLED" || subscription.status === "CANCELLED") {
    return { entitled: false, status: "CANCELLED", planKey: planKey || undefined, reason: "This package was cancelled. Renew to restore your website." };
  }

  const expiresAt = subscription.expiresAt ?? null;
  const graceUntil = subscription.graceUntil ?? null;
  const validUntil = graceUntil ?? expiresAt;
  if (validUntil && now.getTime() > new Date(validUntil).getTime()) {
    return {
      entitled: false,
      status: "EXPIRED",
      planKey: planKey || undefined,
      expiresAt,
      graceUntil,
      reason: "Your Interactive Business subscription has expired. Renew to put your website back online.",
    };
  }
  if (expiresAt && now.getTime() > new Date(expiresAt).getTime()) {
    return {
      entitled: true,
      status: "PAST_DUE",
      planKey: planKey || undefined,
      expiresAt,
      graceUntil,
      reason: "Your subscription is in its grace period. Renew to avoid interruption.",
    };
  }
  if (subscription.status !== "ACTIVE" && subscription.status !== "EXPIRING") {
    return { entitled: false, status: "PENDING", planKey: planKey || undefined, reason: "Your subscription is not active yet." };
  }

  return {
    entitled: true,
    status: "ACTIVE",
    planKey: planKey || INTERACTIVE_PLAN_KEY,
    expiresAt,
    graceUntil,
    reason: "Active",
  };
}

/** Server-side read. Always scoped to one business id — never a client-supplied tenant. */
export async function getInteractiveEntitlement(businessId: string): Promise<EntitlementState> {
  const [subscription, entitlement, paidPayment] = await Promise.all([
    prisma.subscription.findUnique({
      where: { businessId },
      select: { status: true, expiresAt: true, graceUntil: true, plan: { select: { key: true, priceKES: true, durationDays: true } } },
    }),
    prisma.interactiveBusinessEntitlement.findUnique({ where: { businessId }, select: { status: true } }),
    prisma.payment.findFirst({ where: { businessId, status: "PAID" }, select: { status: true }, orderBy: { createdAt: "desc" } }),
  ]);

  return deriveEntitlement({ subscription, entitlement, paidPayment });
}

/** Persist the derived status so admin views and lifecycle jobs can query it directly. */
export async function syncInteractiveEntitlement(businessId: string): Promise<EntitlementState> {
  const state = await getInteractiveEntitlement(businessId);
  const data = {
    status: state.status,
    activatedAt: state.status === "ACTIVE" || state.status === "PAST_DUE" ? new Date() : undefined,
    expiresAt: state.expiresAt ?? undefined,
  };
  await prisma.interactiveBusinessEntitlement.upsert({
    where: { businessId },
    update: data as never,
    create: { businessId, packageKey: INTERACTIVE_PLAN_KEY, ...data } as never,
  });
  return state;
}

/** Server-authoritative price assertion for checkout (§26). */
export function assertInteractivePlanPricing(plan: { key: string; priceKES: number; durationDays: number } | null): boolean {
  if (!plan || plan.key !== INTERACTIVE_PLAN_KEY) return false;
  return plan.priceKES === INTERACTIVE_PRICE_KES && plan.durationDays === INTERACTIVE_DURATION_DAYS;
}
