/**
 * Business POS entitlement and commercial lifecycle (§4, §43, §44, §45, §66)
 *
 * The POS is a subscription product tied to the *business*, not to the browser session. It
 * becomes live only when the server has confirmed payment: configuration is not activation,
 * a preview is not production, and payment *initiation* is not payment success.
 *
 * The decision function here is pure so the boundary can be unit-tested and cannot be
 * bypassed by a client-supplied flag. It mirrors the Interactive Business entitlement gate
 * rather than inventing a parallel system (§80).
 */

import prisma from "../db";
import type { PosEntitlementStatus, PosLifecycleStatus } from "./types";

export const POS_PLAN_KEY = "BUSINESS_POS";
export const POS_PLAN_NAME = "JATA AFTERCALL — Business POS";
export const POS_PLAN_PRICE_KES = 499;
export const POS_PLAN_DURATION_DAYS = 30;
export const POS_PLAN_TAGLINE = "A POS configured around the way your business actually works.";

/** Server-authoritative price assertion (§31, §43). The browser never supplies the amount. */
export function assertPosPlanPricing(plan: { key?: string; priceKES?: number; durationDays?: number } | null | undefined): boolean {
  if (!plan || plan.key !== POS_PLAN_KEY) return false;
  return plan.priceKES === POS_PLAN_PRICE_KES && plan.durationDays === POS_PLAN_DURATION_DAYS;
}

export type PosSubscriptionLike = {
  status: string;
  planKey?: string | null;
  startAt?: Date | string | null;
  expiresAt?: Date | string | null;
  graceUntil?: Date | string | null;
} | null;

export type EntitlementInput = {
  subscription?: PosSubscriptionLike;
  entitlement?: { status?: string | null } | null;
  paidPayment?: { status?: string | null } | null;
  configurationStatus?: string | null;
  now?: Date;
};

export type PosEntitlementState = {
  entitled: boolean;
  status: PosEntitlementStatus;
  lifecycle: PosLifecycleStatus;
  planKey: string;
  priceKES: number;
  expiresAt: Date | null;
  graceUntil: Date | null;
  /** Plain-language reason, safe to show an owner (§38). */
  reason: string;
  /** What the owner should do next — drives the product page. */
  nextAction: "configure" | "preview" | "pay" | "none" | "renew";
};

const PLAN_META = { planKey: POS_PLAN_KEY, priceKES: POS_PLAN_PRICE_KES } as const;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The single decision point for "is this business allowed to run the POS?".
 * Order matters: payment evidence first, then subscription validity, then configuration.
 */
export function derivePosEntitlement(input: EntitlementInput): PosEntitlementState {
  const now = input.now ?? new Date();
  const subscription = input.subscription ?? null;
  const configStatus = (input.configurationStatus ?? "DRAFT").toUpperCase();
  const paid = input.paidPayment?.status === "PAID";
  const planKey = subscription?.planKey ?? null;

  const base = {
    ...PLAN_META,
    expiresAt: toDate(subscription?.expiresAt),
    graceUntil: toDate(subscription?.graceUntil),
  };

  // ── Cancelled wins over everything: an owner who cancelled stays cancelled (§44).
  if (input.entitlement?.status === "CANCELLED" || subscription?.status === "CANCELLED") {
    return {
      ...base, entitled: false, status: "CANCELLED", lifecycle: "CANCELLED",
      reason: "The Business POS was cancelled. Subscribe again to bring it back.",
      nextAction: "pay",
    };
  }

  // ── No subscription record at all: still configuring, or never started.
  if (!subscription) {
    const lifecycle = lifecycleWithoutPayment(configStatus, paid);
    return {
      ...base,
      entitled: false,
      status: paid ? "PENDING" : "NONE",
      lifecycle,
      reason: paid
        ? "Payment received — your POS is being switched on."
        : lifecycle === "DRAFT"
          ? "Tell JATA how your business works and we'll configure your POS."
          : lifecycle === "PREVIEW"
            ? "Your preview is ready. Choose the plan to go live."
            : "Choose the KES 499/month plan to make your configured POS live.",
      nextAction: lifecycle === "DRAFT" || lifecycle === "CONFIGURED" ? "configure" : lifecycle === "PREVIEW" ? "preview" : "pay",
    };
  }

  // ── A subscription to a different product never grants the POS (§4, §45).
  if (planKey && planKey !== POS_PLAN_KEY) {
    return {
      ...base, entitled: false, status: "NONE", lifecycle: lifecycleWithoutPayment(configStatus, paid),
      reason: "Your current plan does not include the Business POS. Add it for KES 499/month.",
      nextAction: "pay",
    };
  }

  const activeStatuses = ["ACTIVE", "EXPIRING", "PAST_DUE"];
  const subscriptionActive = activeStatuses.includes(subscription.status);
  if (!subscriptionActive && !paid) {
    return {
      ...base, entitled: false, status: "PENDING", lifecycle: lifecycleWithoutPayment(configStatus, false),
      reason: "Complete the KES 499 payment to activate your Business POS.",
      nextAction: "pay",
    };
  }

  if (subscription.status === "SUSPENDED" || input.entitlement?.status === "SUSPENDED") {
    return {
      ...base, entitled: false, status: "SUSPENDED", lifecycle: "SUSPENDED",
      reason: "The Business POS is suspended. Contact JATA support to restore it.",
      nextAction: "none",
    };
  }

  const validUntil = base.graceUntil ?? base.expiresAt;
  if (validUntil && now.getTime() > validUntil.getTime()) {
    return {
      ...base, entitled: false, status: "EXPIRED", lifecycle: "SUSPENDED",
      reason: "Your Business POS subscription has expired. Renew to keep selling. Your records are safe.",
      nextAction: "renew",
    };
  }

  if (base.expiresAt && now.getTime() > base.expiresAt.getTime()) {
    return {
      ...base, entitled: true, status: "PAST_DUE", lifecycle: "LIVE",
      reason: "Your Business POS is in its grace period. Renew to avoid interruption.",
      nextAction: "renew",
    };
  }

  if (!subscriptionActive) {
    return {
      ...base, entitled: false, status: "PENDING", lifecycle: paid ? "PAYMENT_CONFIRMED" : "AWAITING_PAYMENT",
      reason: paid ? "Payment received — your POS is being switched on." : "Complete the KES 499 payment to activate your Business POS.",
      nextAction: paid ? "none" : "pay",
    };
  }

  // Active, in date, right plan: the POS is live. Configuration state decides the screen.
  return {
    ...base, entitled: true, status: "ACTIVE", lifecycle: "LIVE",
    reason: configStatus === "PUBLISHED" ? "Your business POS is live." : "Your POS is live. Publish your configuration to apply your latest changes.",
    nextAction: "none",
  };
}

/** Lifecycle before any payment exists (§44). */
export function lifecycleWithoutPayment(configurationStatus: string | null | undefined, paid: boolean): PosLifecycleStatus {
  const status = (configurationStatus ?? "DRAFT").toUpperCase();
  if (paid) return "PAYMENT_CONFIRMED";
  if (status === "PREVIEW") return "PREVIEW";
  if (status === "CONFIGURED" || status === "PUBLISHED") return "AWAITING_PAYMENT";
  if (status === "AWAITING_PAYMENT") return "AWAITING_PAYMENT";
  if (status === "SUSPENDED") return "SUSPENDED";
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "LIVE") return "AWAITING_PAYMENT"; // a live status without payment is never honoured
  return "DRAFT";
}

/** Is the lifecycle state one where the paid product may be used? (§44) */
export function isLiveLifecycle(lifecycle: PosLifecycleStatus): boolean {
  return lifecycle === "LIVE";
}

export const POS_LIFECYCLE_LABELS: Record<PosLifecycleStatus, { label: string; tone: "neutral" | "info" | "warn" | "success" | "danger"; help: string }> = {
  DRAFT: { label: "Not configured yet", tone: "neutral", help: "Answer a few questions and JATA configures your POS." },
  CONFIGURED: { label: "Configured", tone: "info", help: "Your POS is configured. Edit it, preview it, then choose the plan." },
  PREVIEW: { label: "In preview", tone: "info", help: "A preview is not production — nothing here is saved as a real sale." },
  AWAITING_PAYMENT: { label: "Awaiting payment", tone: "warn", help: "Choose JATA AFTERCALL Business POS — KES 499/month to go live." },
  PAYMENT_CONFIRMED: { label: "Payment confirmed", tone: "success", help: "Payment confirmed. Your POS is being switched on." },
  PROVISIONING: { label: "Setting up", tone: "info", help: "JATA is applying your configuration." },
  LIVE: { label: "Live", tone: "success", help: "Your business POS is live." },
  SUSPENDED: { label: "Suspended", tone: "danger", help: "The POS is paused. Renew or contact support." },
  CANCELLED: { label: "Cancelled", tone: "danger", help: "The POS was cancelled. Subscribe again to restore it." },
};

// ── Server reads and writes ───────────────────────────────────────────────────

/** Always scoped to one business id, resolved from authenticated membership (§5). */
export async function getPosEntitlement(businessId: string): Promise<PosEntitlementState> {
  const [subscription, entitlement, paidPayment, configuration] = await Promise.all([
    prisma.posSubscription?.findUnique?.({
      where: { businessId },
      select: { status: true, planKey: true, startAt: true, expiresAt: true, graceUntil: true },
    }) ?? null,
    prisma.posEntitlement?.findUnique?.({ where: { businessId }, select: { status: true } }) ?? null,
    // Payment evidence comes from the existing Payment ledger — one payment stack (§80).
    prisma.payment?.findFirst?.({
      where: { businessId, status: "PAID", plan: { key: POS_PLAN_KEY } },
      select: { status: true },
      orderBy: { createdAt: "desc" },
    }) ?? null,
    prisma.posConfiguration?.findUnique?.({ where: { businessId }, select: { status: true } }) ?? null,
  ]);

  return derivePosEntitlement({
    subscription: subscription ?? null,
    entitlement: entitlement ?? null,
    paidPayment: paidPayment ?? null,
    configurationStatus: configuration?.status ?? "DRAFT",
  });
}

/** Persist the derived status so admin views and lifecycle jobs can query it directly. */
export async function syncPosEntitlement(businessId: string): Promise<PosEntitlementState> {
  const state = await getPosEntitlement(businessId);
  const data = {
    status: state.status,
    activatedAt: state.entitled ? new Date() : null,
    expiresAt: state.expiresAt,
  };
  try {
    await prisma.posEntitlement?.upsert?.({
      where: { businessId },
      update: data as never,
      create: { businessId, packageKey: POS_PLAN_KEY, ...data } as never,
    });
  } catch {
    // Entitlement persistence must never fail a payment settlement; the derivation is the truth.
    console.error("pos entitlement sync failed");
  }
  return state;
}
