/**
 * JATA Autopilot — Verified Payment Settlement & Renewal Window (§12, §13)
 *
 * Settles `AutopilotSubscription` and `AutopilotEntitlement` inside the same
 * atomic Prisma transaction as `lib/paystack.ts` without touching `Subscription`
 * or `PosSubscription`.
 */

import {
  containsInlineImageDataUrl,
  serializeJsonWithoutInlineImageData,
} from "@/lib/media/persistence-policy";
import { isProviderTransactionId } from "@/lib/paymentVerification";
import {
  AUTOPILOT_GRACE_DAYS,
  assertAutopilotPlanPricing,
  isAutopilotPlanKey,
  tierForAutopilotPlanKey,
} from "./entitlement";

export interface AutopilotSettlementParams {
  payment: {
    id: string;
    reference: string;
    businessId: string;
    userId: string;
    status: string;
    amount: number;
    currency: string;
  };
  plan: {
    id: string;
    key: string;
    priceKES: number;
    durationDays: number;
    currency?: string | null;
    isActive?: boolean | null;
  };
  eventId?: string;
  verification?: {
    paystackId?: string;
    raw?: unknown;
    providerConfirmedAt?: string;
  };
  repairingLegacyPaidPayment: boolean;
}

const DAY_MS = 86_400_000;

async function recordProcessedWebhookIdempotent(tx: any, eventId?: string): Promise<void> {
  if (!eventId) return;
  if (typeof tx.processedWebhook?.upsert === "function") {
    await tx.processedWebhook.upsert({
      where: { id: eventId },
      create: { id: eventId },
      update: {},
    });
    return;
  }
  try {
    await tx.processedWebhook.create({ data: { id: eventId } });
  } catch (err: any) {
    if (err?.code !== "P2002") throw err;
  }
}

export async function settleAutopilotPayment(
  tx: any,
  params: AutopilotSettlementParams,
): Promise<{ subscription: unknown; alreadySettled: boolean }> {
  const { payment, plan, eventId, verification, repairingLegacyPaidPayment } = params;

  if (!isAutopilotPlanKey(plan.key)) {
    throw new Error("AUTOPILOT_PLAN_KEY_INVALID");
  }
  const pricingCheck = assertAutopilotPlanPricing(plan);
  if (pricingCheck.ok === false) {
    throw new Error(`AUTOPILOT_PLAN_CONTRACT_VIOLATION: ${pricingCheck.reason}`);
  }
  if (payment.currency !== "KES") {
    throw new Error("PAYMENT_CURRENCY_MISMATCH");
  }
  const expectedMinorUnits = Math.round(plan.priceKES * 100);
  if (payment.amount !== expectedMinorUnits) {
    throw new Error("PAYMENT_AMOUNT_MISMATCH");
  }
  if (!repairingLegacyPaidPayment && !isProviderTransactionId(verification?.paystackId)) {
    throw new Error("PAYMENT_EVIDENCE_REQUIRED");
  }

  const settledFrom = payment.status;
  const current = await tx.autopilotSubscription.findUnique({
    where: { businessId: payment.businessId },
  });

  if (payment.status === "PAID" && current && current.paymentId === payment.id) {
    await recordProcessedWebhookIdempotent(tx, eventId);
    return { subscription: current, alreadySettled: true };
  }

  if (!repairingLegacyPaidPayment) {
    const rawForStorage =
      verification?.raw === undefined
        ? undefined
        : serializeJsonWithoutInlineImageData(verification.raw);
    const paystackIdForStorage =
      verification?.paystackId && !containsInlineImageDataUrl(verification.paystackId)
        ? verification.paystackId
        : undefined;
    const changed = await tx.payment.updateMany({
      where: { id: payment.id, status: settledFrom },
      data: {
        status: "PAID",
        ...(paystackIdForStorage ? { paystackId: paystackIdForStorage } : {}),
        ...(rawForStorage !== undefined ? { raw: rawForStorage } : {}),
      },
    });
    if (changed.count !== 1) {
      const latest = await tx.payment.findUnique({ where: { id: payment.id } });
      if (latest?.status === "PAID") {
        await recordProcessedWebhookIdempotent(tx, eventId);
        return {
          subscription: await tx.autopilotSubscription.findUnique({
            where: { businessId: payment.businessId },
          }),
          alreadySettled: true,
        };
      }
      throw new Error("PAYMENT_STATE_CHANGED");
    }
  }

  const now = new Date();
  const extendFrom =
    current?.status === "ACTIVE" &&
    current.expiresAt &&
    new Date(current.expiresAt).getTime() > now.getTime()
      ? new Date(current.expiresAt)
      : now;
  const startAt = current?.startAt && extendFrom > now ? new Date(current.startAt) : now;
  const expiresAt = new Date(extendFrom.getTime() + plan.durationDays * DAY_MS);
  const graceUntil = new Date(expiresAt.getTime() + AUTOPILOT_GRACE_DAYS * DAY_MS);
  const tier = tierForAutopilotPlanKey(plan.key);

  const autopilotSub = await tx.autopilotSubscription.upsert({
    where: { businessId: payment.businessId },
    update: {
      userId: payment.userId,
      planId: plan.id,
      planKey: plan.key,
      status: "ACTIVE",
      startAt,
      expiresAt,
      graceUntil,
      paymentId: payment.id,
      paymentReference: payment.reference,
      cancelledAt: null,
    },
    create: {
      businessId: payment.businessId,
      userId: payment.userId,
      planId: plan.id,
      planKey: plan.key,
      status: "ACTIVE",
      startAt,
      expiresAt,
      graceUntil,
      paymentId: payment.id,
      paymentReference: payment.reference,
    },
  });

  await tx.autopilotEntitlement.upsert({
    where: { businessId: payment.businessId },
    create: {
      businessId: payment.businessId,
      packageKey: plan.key,
      tier,
      status: "ACTIVE",
      activatedAt: now,
      expiresAt,
    },
    update: {
      packageKey: plan.key,
      tier,
      status: "ACTIVE",
      activatedAt: now,
      expiresAt,
    },
  });

  await recordProcessedWebhookIdempotent(tx, eventId);

  const settledAmountKES = Math.round(payment.amount) / 100;

  await tx.auditEvent.create({
    data: {
      actorId: payment.userId,
      action: "AUTOPILOT_SUBSCRIPTION_ACTIVATED",
      targetType: "AUTOPILOT_SUBSCRIPTION",
      targetId: autopilotSub.id,
      metadata: JSON.stringify({
        paymentReference: payment.reference,
        planKey: plan.key,
        tier,
        businessId: payment.businessId,
        amountKES: settledAmountKES,
        amountMinorKES: payment.amount,
        expiresAt: expiresAt.toISOString(),
        ...(settledFrom === "PENDING" ? {} : { settledFrom }),
      }),
    },
  });

  await tx.autopilotAuditEvent.create({
    data: {
      businessId: payment.businessId,
      actorKind: "OWNER",
      actorUserId: payment.userId,
      action: "autopilot.subscription.activated",
      targetType: "AutopilotSubscription",
      targetId: autopilotSub.id,
      metadataJson: JSON.stringify({
        paymentReference: payment.reference,
        planKey: plan.key,
        tier,
        amountKES: settledAmountKES,
        amountMinorKES: payment.amount,
        expiresAt: expiresAt.toISOString(),
      }),
    },
  });

  return { subscription: autopilotSub, alreadySettled: false };
}

export async function lapseExpiredAutopilotSubscriptions(
  tx: any,
  now: Date = new Date(),
): Promise<{ movedToGrace: number; expired: number }> {
  const subs = await tx.autopilotSubscription.findMany({
    where: { status: { in: ["ACTIVE", "EXPIRING", "PAST_DUE"] } },
  });
  let movedToGrace = 0;
  let expired = 0;
  for (const s of subs) {
    if (!s.expiresAt) continue;
    const exp = new Date(s.expiresAt).getTime();
    const grace = s.graceUntil
      ? new Date(s.graceUntil).getTime()
      : exp + AUTOPILOT_GRACE_DAYS * DAY_MS;
    if (now.getTime() >= grace && s.status !== "EXPIRED") {
      await tx.autopilotSubscription.update({
        where: { id: s.id },
        data: { status: "EXPIRED" },
      });
      await tx.autopilotEntitlement.updateMany({
        where: { businessId: s.businessId },
        data: { status: "EXPIRED" },
      });
      expired++;
    } else if (now.getTime() >= exp && now.getTime() < grace && s.status !== "PAST_DUE") {
      await tx.autopilotSubscription.update({
        where: { id: s.id },
        data: { status: "PAST_DUE" },
      });
      await tx.autopilotEntitlement.updateMany({
        where: { businessId: s.businessId },
        data: { status: "GRACE" },
      });
      movedToGrace++;
    }
  }
  return { movedToGrace, expired };
}
