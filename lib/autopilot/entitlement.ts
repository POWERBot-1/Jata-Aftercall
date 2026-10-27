/**
 * JATA Autopilot — Subscription & Entitlement Engine (§12, §13)
 *
 * Separate from AFTERCALL (`Subscription`) and Business POS (`PosSubscription`).
 * Subscribing, renewing, pausing, or lapsing JATA Autopilot never alters any
 * other product subscription, and expired/cancelled accounts retain read access
 * to their historical diagnosis, proposals, and audit trail.
 */

import prisma from "@/lib/db";
import { hasTeamFreeAccessForBusiness, TEAM_FREE_ACCESS_LABEL } from "@/lib/team-access";
import {
  AUTOPILOT_PLAN_KEYS,
  type AutopilotEntitlementStatus,
  type AutopilotPlanKey,
  type AutopilotSubscriptionStatus,
  type AutopilotTier,
} from "./types";

export const AUTOPILOT_BILLING_DAYS = 30;
export const AUTOPILOT_GRACE_DAYS = 3;
export const AUTOPILOT_EXPIRING_DAYS = 5;

export const AUTOPILOT_PLAN_CATALOG: Record<
  AutopilotPlanKey,
  {
    key: AutopilotPlanKey;
    tier: AutopilotTier;
    name: string;
    priceKES: number;
    durationDays: number;
    description: string;
  }
> = {
  JATA_AUTOPILOT: {
    key: "JATA_AUTOPILOT",
    tier: "STANDARD",
    name: "JATA Autopilot",
    priceKES: 2499,
    durationDays: AUTOPILOT_BILLING_DAYS,
    description:
      "Business health diagnosis, 15 Industry Packs, approval queue, FAQ & offer actions, and metered AI operations — 30 days.",
  },
  JATA_AUTOPILOT_PRO: {
    key: "JATA_AUTOPILOT_PRO",
    tier: "PRO",
    name: "JATA Autopilot Pro",
    priceKES: 6999,
    durationDays: AUTOPILOT_BILLING_DAYS,
    description:
      "Higher AI reasoning & multimodal document quotas, supervised/advanced playbooks, and consented follow-up workflows — 30 days.",
  },
  JATA_AUTOPILOT_ENTERPRISE: {
    key: "JATA_AUTOPILOT_ENTERPRISE",
    tier: "ENTERPRISE",
    name: "JATA Autopilot Enterprise",
    priceKES: 19999,
    durationDays: AUTOPILOT_BILLING_DAYS,
    description:
      "Multi-branch executive operations, expanded multimodal & voice allowances, and dedicated governance controls — 30 days.",
  },
};

export function isAutopilotPlanKey(value: unknown): value is AutopilotPlanKey {
  return (
    typeof value === "string" &&
    (AUTOPILOT_PLAN_KEYS as readonly string[]).includes(value)
  );
}

export function tierForAutopilotPlanKey(planKey?: string | null): AutopilotTier {
  if (planKey === "JATA_AUTOPILOT_ENTERPRISE") return "ENTERPRISE";
  if (planKey === "JATA_AUTOPILOT_PRO") return "PRO";
  return "STANDARD";
}

export interface AutopilotSubscriptionRecord {
  status: string;
  planKey: string;
  startAt: Date | null;
  expiresAt: Date | null;
  graceUntil: Date | null;
  cancelledAt: Date | null;
  paymentReference: string | null;
}

export interface AutopilotEntitlementDecision {
  entitled: boolean;
  previewMode: boolean;
  readHistoryAllowed: true;
  tier: AutopilotTier;
  planKey: AutopilotPlanKey;
  subscriptionStatus: AutopilotSubscriptionStatus;
  entitlementStatus: AutopilotEntitlementStatus;
  expiresAt: string | null;
  graceUntil: string | null;
  daysRemaining: number | null;
  banner: {
    tone: "preview" | "active" | "expiring" | "grace" | "expired" | "suspended";
    headline: string;
    detail: string;
    ctaLabel: string | null;
  };
}

const DAY_MS = 86_400_000;

export function assertAutopilotPlanPricing(plan: {
  key?: string | null;
  currency?: string | null;
  priceKES?: number | null;
  durationDays?: number | null;
  isActive?: boolean | null;
} | null | undefined): { ok: true } | { ok: false; reason: string } {
  if (!plan || !isAutopilotPlanKey(plan.key)) {
    return { ok: false, reason: `Expected an Autopilot plan key, got ${String(plan?.key)}.` };
  }
  const spec = AUTOPILOT_PLAN_CATALOG[plan.key];
  if (plan.isActive === false) {
    return { ok: false, reason: `${spec.name} plan is inactive.` };
  }
  if (plan.currency !== undefined && plan.currency !== null && plan.currency !== "KES") {
    return { ok: false, reason: `${spec.name} bills in KES, got ${plan.currency}.` };
  }
  if (typeof plan.priceKES !== "number" || !Number.isInteger(plan.priceKES) || plan.priceKES !== spec.priceKES) {
    return {
      ok: false,
      reason: `${spec.name} authoritative price is KES ${spec.priceKES}, got ${String(plan.priceKES)}.`,
    };
  }
  if (plan.durationDays !== AUTOPILOT_BILLING_DAYS) {
    return {
      ok: false,
      reason: `${spec.name} billing cycle is ${AUTOPILOT_BILLING_DAYS} days, got ${String(plan.durationDays)}.`,
    };
  }
  return { ok: true };
}

/**
 * Pure deterministic entitlement evaluator.
 * Preview/diagnosis remains available before purchase; live autonomous execution
 * and external customer dispatches require an active or grace-period entitlement.
 */
export function deriveAutopilotEntitlement(
  sub: AutopilotSubscriptionRecord | null,
  now: Date = new Date(),
): AutopilotEntitlementDecision {
  const planKey: AutopilotPlanKey =
    sub && isAutopilotPlanKey(sub.planKey) ? sub.planKey : "JATA_AUTOPILOT";
  const tier = tierForAutopilotPlanKey(planKey);

  if (!sub || sub.status === "NONE" || sub.status === "PENDING") {
    return {
      entitled: false,
      previewMode: true,
      readHistoryAllowed: true,
      tier,
      planKey,
      subscriptionStatus: sub?.status === "PENDING" ? "PENDING" : "NONE",
      entitlementStatus: "NONE",
      expiresAt: null,
      graceUntil: null,
      daysRemaining: null,
      banner: {
        tone: "preview",
        headline:
          sub?.status === "PENDING"
            ? "Payment pending — Command Center in preview mode"
            : "Preview mode — activate JATA Autopilot from KES 2,499 / month",
        detail:
          "Inspect grounded business health diagnostics and review draft proposals safely. Activate a plan to run live actions and scheduled workflows.",
        ctaLabel: "Subscribe — KES 2,499/mo",
      },
    };
  }

  if (sub.status === "SUSPENDED") {
    return {
      entitled: false,
      previewMode: false,
      readHistoryAllowed: true,
      tier,
      planKey,
      subscriptionStatus: "SUSPENDED",
      entitlementStatus: "SUSPENDED",
      expiresAt: sub.expiresAt?.toISOString() ?? null,
      graceUntil: null,
      daysRemaining: 0,
      banner: {
        tone: "suspended",
        headline: "JATA Autopilot subscription suspended",
        detail:
          "Autonomous actions and outbound workflows are halted while billing is resolved. Historical diagnoses and audit trails remain readable.",
        ctaLabel: "Renew Autopilot",
      },
    };
  }

  if (sub.status === "EXPIRED") {
    return {
      entitled: false,
      previewMode: false,
      readHistoryAllowed: true,
      tier,
      planKey,
      subscriptionStatus: "EXPIRED",
      entitlementStatus: "EXPIRED",
      expiresAt: sub.expiresAt?.toISOString() ?? null,
      graceUntil: sub.graceUntil?.toISOString() ?? null,
      daysRemaining: 0,
      banner: {
        tone: "expired",
        headline: "JATA Autopilot plan expired",
        detail:
          "All business data, proposals, and audit logs remain preserved. Renew to unlock live execution again.",
        ctaLabel: "Renew Autopilot",
      },
    };
  }

  const expiresAt = sub.expiresAt ? new Date(sub.expiresAt) : null;
  const graceUntil =
    sub.graceUntil
      ? new Date(sub.graceUntil)
      : expiresAt
        ? new Date(expiresAt.getTime() + AUTOPILOT_GRACE_DAYS * DAY_MS)
        : null;

  if (!expiresAt) {
    return {
      entitled: false,
      previewMode: true,
      readHistoryAllowed: true,
      tier,
      planKey,
      subscriptionStatus: "NONE",
      entitlementStatus: "NONE",
      expiresAt: null,
      graceUntil: null,
      daysRemaining: null,
      banner: {
        tone: "preview",
        headline: "Preview mode — activate JATA Autopilot",
        detail: "Subscribe to unlock live execution, rollback automation, and metered AI operations.",
        ctaLabel: "Subscribe — KES 2,499/mo",
      },
    };
  }

  const msLeft = expiresAt.getTime() - now.getTime();
  const daysLeft = Math.ceil(msLeft / DAY_MS);

  if (sub.status === "CANCELLED" && msLeft <= 0) {
    return {
      entitled: false,
      previewMode: false,
      readHistoryAllowed: true,
      tier,
      planKey,
      subscriptionStatus: "CANCELLED",
      entitlementStatus: "CANCELLED",
      expiresAt: expiresAt.toISOString(),
      graceUntil: null,
      daysRemaining: 0,
      banner: {
        tone: "expired",
        headline: "Autopilot subscription ended",
        detail:
          "Your historical diagnoses, proposals, and audit logs remain intact. Re-subscribe any time to resume execution.",
        ctaLabel: "Re-activate Autopilot",
      },
    };
  }

  if (msLeft > 0) {
    const expiring = daysLeft <= AUTOPILOT_EXPIRING_DAYS;
    return {
      entitled: true,
      previewMode: false,
      readHistoryAllowed: true,
      tier,
      planKey,
      subscriptionStatus: expiring ? "EXPIRING" : "ACTIVE",
      entitlementStatus: "ACTIVE",
      expiresAt: expiresAt.toISOString(),
      graceUntil: graceUntil?.toISOString() ?? null,
      daysRemaining: daysLeft,
      banner: expiring
        ? {
            tone: "expiring",
            headline: `${AUTOPILOT_PLAN_CATALOG[planKey].name} renews in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
            detail: "Renew early to keep your supervised playbooks and daily diagnostics uninterrupted.",
            ctaLabel: "Renew plan",
          }
        : {
            tone: "active",
            headline: `${AUTOPILOT_PLAN_CATALOG[planKey].name} active`,
            detail: `Active through ${expiresAt.toISOString().slice(0, 10)} (${daysLeft} days remaining).`,
            ctaLabel: null,
          },
    };
  }

  if (graceUntil && now.getTime() < graceUntil.getTime()) {
    const graceDays = Math.max(1, Math.ceil((graceUntil.getTime() - now.getTime()) / DAY_MS));
    return {
      entitled: true,
      previewMode: false,
      readHistoryAllowed: true,
      tier,
      planKey,
      subscriptionStatus: "PAST_DUE",
      entitlementStatus: "GRACE",
      expiresAt: expiresAt.toISOString(),
      graceUntil: graceUntil.toISOString(),
      daysRemaining: 0,
      banner: {
        tone: "grace",
        headline: `Past due — ${graceDays} grace day${graceDays === 1 ? "" : "s"} left`,
        detail: "Renew now so approved actions and diagnostics continue without pause.",
        ctaLabel: "Renew Autopilot",
      },
    };
  }

  return {
    entitled: false,
    previewMode: false,
    readHistoryAllowed: true,
    tier,
    planKey,
    subscriptionStatus: "EXPIRED",
    entitlementStatus: "EXPIRED",
    expiresAt: expiresAt.toISOString(),
    graceUntil: graceUntil?.toISOString() ?? null,
    daysRemaining: 0,
    banner: {
      tone: "expired",
      headline: "JATA Autopilot plan expired",
      detail:
        "All business data, proposals, and audit logs remain preserved. Renew to unlock live execution again.",
      ctaLabel: "Renew Autopilot",
    },
  };
}

/** Synthetic non-billing entitlement for a verified team account (no payment record is created). */
export function teamFreeAutopilotEntitlement(now: Date = new Date()): AutopilotEntitlementDecision {
  return {
    entitled: true,
    previewMode: false,
    readHistoryAllowed: true,
    tier: "STANDARD",
    planKey: "JATA_AUTOPILOT",
    subscriptionStatus: "ACTIVE",
    entitlementStatus: "ACTIVE",
    expiresAt: null,
    graceUntil: null,
    daysRemaining: null,
    banner: {
      tone: "active",
      headline: TEAM_FREE_ACCESS_LABEL,
      detail: `Full Autopilot features are included with your verified team entitlement as of ${now.toISOString().slice(0, 10)}. No payment or renewal is required.`,
      ctaLabel: null,
    },
  };
}

export async function getAutopilotEntitlement(
  businessId: string,
  now: Date = new Date(),
): Promise<AutopilotEntitlementDecision> {
  if (await hasTeamFreeAccessForBusiness(businessId)) return teamFreeAutopilotEntitlement(now);
  try {
    const sub = await prisma.autopilotSubscription.findUnique({ where: { businessId } });
    return deriveAutopilotEntitlement(sub, now);
  } catch {
    return deriveAutopilotEntitlement(null, now);
  }
}

export async function syncAutopilotEntitlement(
  businessId: string,
  now: Date = new Date(),
): Promise<AutopilotEntitlementDecision> {
  const sub = await prisma.autopilotSubscription.findUnique({ where: { businessId } });
  const decision = (await hasTeamFreeAccessForBusiness(businessId))
    ? teamFreeAutopilotEntitlement(now)
    : deriveAutopilotEntitlement(sub, now);
  await prisma.autopilotEntitlement.upsert({
    where: { businessId },
    create: {
      businessId,
      packageKey: decision.planKey,
      tier: decision.tier,
      status: decision.entitlementStatus,
      activatedAt: decision.entitled ? now : null,
      expiresAt: sub?.expiresAt ?? null,
    },
    update: {
      packageKey: decision.planKey,
      tier: decision.tier,
      status: decision.entitlementStatus,
      expiresAt: sub?.expiresAt ?? null,
      ...(decision.entitled ? { activatedAt: now } : {}),
    },
  });
  return decision;
}
