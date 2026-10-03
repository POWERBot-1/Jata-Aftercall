/**
 * Business POS settlement (§4, §31, §43, §44, §45)
 *
 * Payment confirmation stays server-authoritative and runs inside the existing Paystack
 * settlement transaction. The POS is a *separate product subscription*: paying for it never
 * disturbs the business's JATA AFTERCALL plan, and an AFTERCALL renewal never switches the
 * POS on (§80 — additive, not entangled).
 *
 * Idempotency is preserved with the same two mechanisms the platform already uses: the
 * conditional PENDING → PAID update and the processed-webhook key.
 */

import { subscriptionWindow } from "../paymentVerification";
import { provisionAfterPayment } from "./provisioning";
import { POS_PLAN_KEY } from "./entitlement";

export type PosSettlementResult = {
  subscription: unknown;
  alreadySettled: boolean;
  posSubscription?: boolean;
};

export type PosSettlementParams = {
  payment: {
    id: string;
    reference: string;
    businessId: string;
    userId: string;
    planId: string;
    amount: number;
    currency: string;
    status: string;
  };
  plan: { id: string; key: string; priceKES: number; durationDays: number };
  eventId?: string;
  verification?: { paystackId?: string; raw?: unknown };
  /** A PAID payment with no subscription row (legacy repair) skips the PENDING guard. */
  repairingLegacyPaidPayment?: boolean;
};

/**
 * Activate the Business POS for a confirmed payment. Called with the transaction client that
 * already marked the payment PAID-guarded, so a replayed webhook cannot activate twice.
 */
export async function settlePosPayment(tx: any, params: PosSettlementParams): Promise<PosSettlementResult> {
  const { payment, plan, eventId, verification } = params;
  if (plan.key !== POS_PLAN_KEY) throw new Error("POS_PLAN_KEY_MISMATCH");
  if (!payment.businessId) throw new Error("PAYMENT_CONTEXT_INVALID");

  const current = await tx.posSubscription.findUnique({ where: { businessId: payment.businessId } });

  if (payment.status === "PAID" && current?.status === "ACTIVE") {
    if (eventId) await tx.processedWebhook.create({ data: { id: eventId } });
    return { subscription: current, alreadySettled: true, posSubscription: true };
  }

  if (!params.repairingLegacyPaidPayment) {
    const changed = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: {
        status: "PAID",
        ...(verification?.paystackId ? { paystackId: verification.paystackId } : {}),
        ...(verification?.raw !== undefined ? { raw: JSON.stringify(verification.raw) } : {}),
      },
    });
    if (changed.count !== 1) {
      const latest = await tx.payment.findUnique({ where: { id: payment.id } });
      if (latest?.status === "PAID") {
        if (eventId) await tx.processedWebhook.create({ data: { id: eventId } });
        const existing = await tx.posSubscription.findUnique({ where: { businessId: payment.businessId } });
        return { subscription: existing, alreadySettled: true, posSubscription: true };
      }
      throw new Error("PAYMENT_STATE_CHANGED");
    }
  }

  const now = new Date();
  const { startAt, expiresAt } = subscriptionWindow(now, plan.durationDays, current ?? null);
  const graceUntil = new Date(expiresAt.getTime() + 3 * 86_400_000);

  const subscription = await tx.posSubscription.upsert({
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

  await tx.posEntitlement.upsert({
    where: { businessId: payment.businessId },
    update: { status: "ACTIVE", activatedAt: now, expiresAt },
    create: { businessId: payment.businessId, packageKey: plan.key, status: "ACTIVE", activatedAt: now, expiresAt },
  });

  // DRAFT/CONFIGURED → PROVISIONING → LIVE happens in the same transaction (§43, §44):
  // a paid business is never left with an unpublished configuration.
  await provisionAfterPayment(tx, { businessId: payment.businessId, actorId: payment.userId });

  if (eventId) await tx.processedWebhook.create({ data: { id: eventId } });

  await tx.posAuditEvent.create({
    data: {
      businessId: payment.businessId,
      actorId: payment.userId,
      action: "POS_SUBSCRIPTION_ACTIVATED",
      targetType: "POS_SUBSCRIPTION",
      targetId: subscription.id,
      metadata: JSON.stringify({
        paymentReference: payment.reference,
        planKey: plan.key,
        amountKES: Math.round(payment.amount) / 100,
        expiresAt: expiresAt.toISOString(),
      }),
    },
  });

  return { subscription, alreadySettled: false, posSubscription: true };
}

/** Expiry lapses the entitlement without deleting anything (§45, §59-style safety). */
export async function lapseExpiredPosSubscriptions(tx: any, now: Date = new Date()): Promise<number> {
  const expired = await tx.posSubscription.findMany({
    where: { status: "ACTIVE", expiresAt: { lt: now }, OR: [{ graceUntil: null }, { graceUntil: { lt: now } }] },
    select: { businessId: true, id: true },
    take: 200,
  });
  for (const row of expired) {
    await tx.posSubscription.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
    await tx.posEntitlement.updateMany({ where: { businessId: row.businessId }, data: { status: "EXPIRED" } });
    await tx.posConfiguration.updateMany({ where: { businessId: row.businessId, status: "LIVE" }, data: { status: "SUSPENDED" } });
    await tx.posAuditEvent.create({
      data: { businessId: row.businessId, action: "POS_SUSPENDED", targetType: "POS_SUBSCRIPTION", targetId: row.id, metadata: JSON.stringify({ reason: "EXPIRED" }) },
    });
  }
  return expired.length;
}
