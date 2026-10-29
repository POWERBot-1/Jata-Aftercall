/**
 * POS / ERP - PRO entitlement (KES 3,000/month)
 *
 * This is a *distinct* product from the Business POS. It has its own plan key, its own
 * subscription row and its own entitlement row, so a payment for one product can never switch
 * the other on. The decision function is pure and server-authoritative: a browser flag is never
 * consulted, and a payment *initiation* is never treated as payment success.
 *
 * Feature flag: the product ships disabled until its dependencies are verified. `ERP_PRO_ENABLED`
 * turns it on explicitly; development defaults to on so the workspace can be reviewed locally
 * without pretending it is live for customers.
 */

import prisma from "../db";

export const ERP_PLAN_KEY = "ERP_PRO";
export const ERP_PLAN_NAME = "JATA BOS PRO";
export const ERP_PLAN_PRICE_KES = 3000;
export const ERP_PLAN_DURATION_DAYS = 30;
export const ERP_GRACE_DAYS = 3;

export type ErpLifecycleStatus =
  | "SETUP"
  | "CONFIGURED"
  | "AWAITING_PAYMENT"
  | "ACTIVE"
  | "PAST_DUE"
  | "EXPIRED"
  | "SUSPENDED"
  | "CANCELLED";

export type ErpEntitlementStatus = "NONE" | "PENDING" | "ACTIVE" | "PAST_DUE" | "EXPIRED" | "CANCELLED";

export type ErpEntitlementState = {
  entitled: boolean;
  status: ErpEntitlementStatus;
  lifecycle: ErpLifecycleStatus;
  planKey: string;
  priceKES: number;
  expiresAt: Date | null;
  graceUntil: Date | null;
  /** Plain-language, safe to render. */
  reason: string;
  nextAction: "setup" | "pay" | "renew" | "none";
  /** True while access is allowed only because of the approved grace window. */
  inGrace: boolean;
};

export type ErpSubscriptionLike = {
  status?: string | null;
  planKey?: string | null;
  startAt?: Date | string | null;
  expiresAt?: Date | string | null;
  graceUntil?: Date | string | null;
  cancelledAt?: Date | string | null;
} | null;

export type EntitlementInput = {
  subscription?: ErpSubscriptionLike;
  entitlement?: { status?: string | null } | null;
  paidPayment?: { status?: string | null; planKey?: string | null } | null;
  configured?: boolean;
  now?: Date;
};

const PLAN_META = { planKey: ERP_PLAN_KEY, priceKES: ERP_PLAN_PRICE_KES } as const;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Server-side price assertion. The browser never supplies the amount. */
export function assertErpPlanPricing(plan: { key?: string; priceKES?: number; durationDays?: number } | null | undefined): boolean {
  if (!plan || plan.key !== ERP_PLAN_KEY) return false;
  return plan.priceKES === ERP_PLAN_PRICE_KES && plan.durationDays === ERP_PLAN_DURATION_DAYS;
}

/**
 * Is the product switched on for this deployment? Disabled feature flags never fall through to
 * "allowed": the safe default wins.
 */
export function erpFeatureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ERP_PRO_DISABLED === "true") return false;
  if (env.ERP_PRO_ENABLED === "true") return true;
  return env.NODE_ENV !== "production";
}

/**
 * The single decision point for "may this business use POS / ERP - PRO?".
 * Order: cancellation → paid plan evidence → subscription validity/grace → configuration.
 */
export function deriveErpEntitlement(input: EntitlementInput): ErpEntitlementState {
  const now = input.now ?? new Date();
  const subscription = input.subscription ?? null;
  const configured = Boolean(input.configured);
  const paid = Boolean(input.paidPayment && input.paidPayment.status === "PAID" && input.paidPayment.planKey === ERP_PLAN_KEY);
  const base = {
    ...PLAN_META,
    expiresAt: toDate(subscription?.expiresAt),
    graceUntil: toDate(subscription?.graceUntil),
  };

  if (input.entitlement?.status === "CANCELLED" || subscription?.status === "CANCELLED") {
    return {
      ...base, entitled: false, inGrace: false, status: "CANCELLED", lifecycle: "CANCELLED",
      reason: "JATA BOS PRO was cancelled. Subscribe again to bring your workspace back.",
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
        ? "Your workspace is set up. Subscribe for KES 3,000/month to make it live."
        : "Set up your business, then choose the KES 3,000/month plan to go live.",
      nextAction: configured ? "pay" : "setup",
    };
  }

  if (subscription.planKey && subscription.planKey !== ERP_PLAN_KEY) {
    return {
      ...base, entitled: false, inGrace: false, status: "NONE", lifecycle: "SETUP",
      reason: "Your current plan does not include JATA BOS PRO. Add it for KES 3,000/month.",
      nextAction: "pay",
    };
  }

  const status = String(subscription.status ?? "PENDING").toUpperCase();
  const expiresAt = toDate(subscription.expiresAt);
  const graceUntil = toDate(subscription.graceUntil);
  const expired = Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
  // Grace is the window *after* the paid period ends, not before it: it keeps a trading business
  // open while a renewal is settled, and it is always labelled as a grace state in the UI.
  const graceActive = Boolean(
    expired && status !== "EXPIRED" && graceUntil && graceUntil.getTime() > now.getTime(),
  );

  if (status === "SUSPENDED") {
    return {
      ...base, entitled: false, inGrace: false, status: "SUSPENDED" as ErpEntitlementStatus, lifecycle: "SUSPENDED",
      reason: "This workspace is suspended. Contact JATA support to resolve it.",
      nextAction: "none",
    };
  }

  if (status === "ACTIVE" && !expired) {
    return {
      ...base, entitled: true, inGrace: false, status: "ACTIVE", lifecycle: "ACTIVE",
      reason: "JATA BOS PRO is active on your KES 3,000/month plan.",
      nextAction: "none",
    };
  }

  // Past due but inside an approved grace window: access is allowed and clearly labelled.
  if (graceActive) {
    return {
      ...base, entitled: true, inGrace: true, status: "PAST_DUE", lifecycle: "PAST_DUE",
      reason: `Your subscription needs attention. Access continues until ${graceUntil!.toLocaleDateString("en-KE")}.`,
      nextAction: "renew",
    };
  }

  if (expired || status === "EXPIRED") {
    return {
      ...base, entitled: false, inGrace: false, status: "EXPIRED", lifecycle: "EXPIRED",
      reason: "Your JATA BOS PRO subscription has expired. Renew for KES 3,000/month to keep trading.",
      nextAction: "renew",
    };
  }

  if (status === "PAST_DUE") {
    return {
      ...base, entitled: false, inGrace: false, status: "PAST_DUE", lifecycle: "PAST_DUE",
      reason: "Your last payment has not been confirmed. Settle it to restore access.",
      nextAction: "renew",
    };
  }

  // PENDING (or unknown) is never entitlement.
  return {
    ...base, entitled: false, inGrace: false, status: "PENDING", lifecycle: "AWAITING_PAYMENT",
    reason: "Waiting for the payment to be confirmed by the server.",
    nextAction: "none",
  };
}

/**
 * Load and derive. Never throws for a missing tenant record: a business without an ERP row is a
 * business in setup, not an error.
 */
export async function syncErpEntitlement(businessId: string, client: any = prisma): Promise<ErpEntitlementState> {
  // The plan row is resolved by key on the server so a stale or edited price cannot grant access.
  const plan = (await client.planConfig?.findUnique?.({ where: { key: ERP_PLAN_KEY } }).catch?.(() => null)) ?? null;
  const payment = plan?.id
    ? (await client.payment?.findFirst?.({ where: { businessId, planId: plan.id, status: "PAID" }, orderBy: { createdAt: "desc" } }).catch?.(() => null)) ?? null
    : null;

  let subscription = (await client.erpSubscription?.findUnique?.({ where: { businessId } }).catch?.(() => null)) ?? null;
  const entitlement = (await client.erpEntitlement?.findUnique?.({ where: { businessId } }).catch?.(() => null)) ?? null;
  const configuration = (await client.erpConfiguration?.findUnique?.({ where: { businessId } }).catch?.(() => null)) ?? null;

  // Provision from a *verified* paid Payment, once per payment. A payment is never inferred from a
  // redirect or a query string, and the same payment cannot extend the period twice.
  if (payment && subscription?.paymentId !== payment.id) {
    const now = new Date();
    const currentExpiry = subscription?.expiresAt ? new Date(subscription.expiresAt) : null;
    const extendFrom = currentExpiry && currentExpiry.getTime() > now.getTime() && subscription?.status === "ACTIVE" ? currentExpiry : now;
    const expiresAt = new Date(extendFrom.getTime() + ERP_PLAN_DURATION_DAYS * 86_400_000);
    const graceUntil = new Date(expiresAt.getTime() + ERP_GRACE_DAYS * 86_400_000);
    const data = {
      status: "ACTIVE",
      planId: plan.id,
      planKey: ERP_PLAN_KEY,
      startAt: subscription?.startAt ?? now,
      expiresAt,
      graceUntil,
      paymentId: payment.id,
      paymentReference: payment.reference ?? null,
      cancelledAt: null,
    };
    try {
      subscription = subscription
        ? await client.erpSubscription.update({ where: { businessId }, data })
        : await client.erpSubscription.create({ data: { businessId, userId: payment.userId ?? "system", ...data } });
    } catch {
      // A failed provisioning write must not turn a paid business into an error page. The derived
      // state below still reports AWAITING_PAYMENT honestly until the write succeeds.
    }
  }

  const paidForErp = Boolean(payment && plan && payment.planId === plan.id && payment.status === "PAID");
  const state = deriveErpEntitlement({
    subscription,
    entitlement,
    paidPayment: paidForErp ? { status: "PAID", planKey: ERP_PLAN_KEY } : null,
    configured: Boolean(configuration),
  });

  // Keep the persisted mirror in step with the derived decision. Best-effort: a read must never
  // fail because a mirror write did.
  try {
    const mirrorStatus = state.status === "NONE" && state.lifecycle === "SETUP" ? "NONE" : state.status;
    if (entitlement) {
      if (entitlement.status !== mirrorStatus) {
        await client.erpEntitlement.update({ where: { businessId }, data: { status: mirrorStatus, expiresAt: state.expiresAt, activatedAt: state.entitled ? entitlement.activatedAt ?? new Date() : entitlement.activatedAt } });
      }
    } else if (state.entitled) {
      await client.erpEntitlement.create({ data: { businessId, packageKey: ERP_PLAN_KEY, status: mirrorStatus, activatedAt: new Date(), expiresAt: state.expiresAt } });
    }
  } catch {
    /* mirror only */
  }

  return state;
}

/** What the KES 3,000 subscription includes — and, just as clearly, what it does not. */
export const ERP_PLAN_INCLUSIONS = [
  "ERP workspace, POS and checkout on every device",
  "Accounting: chart of accounts, journals, invoices, payments and reports",
  "Inventory, purchasing, customers, suppliers and multi-branch operations",
  "Messaging campaigns — you pay the messaging provider for messages sent",
  "Sender ID application tracking and KYC workspace",
  "Automation rules, audit trail and industry packs",
] as const;

export const ERP_PLAN_EXCLUSIONS = [
  "SMS and WhatsApp message charges (billed separately by the provider)",
  "Sender ID registration or network fees (disclosed before any charge)",
  "Payment provider transaction fees",
  "KRA eTIMS certification or third-party integrator fees",
] as const;

export const ERP_PLAN_COMMERCIALS = {
  currency: "KES",
  priceKES: ERP_PLAN_PRICE_KES,
  period: "month",
  durationDays: ERP_PLAN_DURATION_DAYS,
  graceDays: ERP_GRACE_DAYS,
  taxes: "Applicable taxes are shown at checkout and are not included in the KES 3,000 price.",
  renewal: "Renews monthly. Cancel any time before the renewal date; access continues to the end of the paid period.",
  providerFeesNote: "SMS and WhatsApp are billed by your provider at their rates. Sender ID registration is charged by the provider and network, disclosed before you confirm.",
} as const;
