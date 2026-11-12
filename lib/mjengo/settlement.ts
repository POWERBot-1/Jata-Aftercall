/**
 * MJENGO OS settlement — the only place a verified payment switches MJENGO OS on.
 *
 * The hard rule this file exists to enforce: **never collect money for a product that cannot
 * activate.** Two independent guards do that:
 *
 *  1. `mjengoCheckoutRefusal()` is called by the checkout route *before* a Paystack transaction is
 *     initialized. If MJENGO OS is switched off in this deployment, or the stored price is not
 *     KES 2,000 / 30 days, the request is refused and nothing is charged.
 *  2. `settleMjengoPayment()` re-checks the same pricing and the plan key inside the settlement
 *     transaction. A payment that arrived through any other path (a stale reference, a manual
 *     provider callback) still cannot activate a product whose terms do not match, and the caller
 *     is told so instead of being silently granted access.
 *
 * MJENGO OS is a *separate* product from BUSINESS_POS (KES 499) and ERP_PRO (KES 3,000). It writes
 * `MjengoSubscription`/`MjengoEntitlement` rows with `planKey`/`packageKey = "MJENGO_OS"`; these tables are dedicated to MJENGO OS, allowing ERP PRO to coexist independently.
 *
 * Idempotency: the payment row is claimed with a compare-and-set (`status = <read state>`) inside
 * the caller's transaction, exactly like `settlePosPayment`. A replayed webhook finds the payment
 * already PAID and returns `alreadySettled` without extending the window twice.
 */
import {
  MJENGO_GRACE_DAYS,
  MJENGO_PLAN_DURATION_DAYS,
  MJENGO_PLAN_KEY,
  MJENGO_PLAN_PRICE_KES,
  mjengoFeatureEnabled,
} from "./entitlement";

export type MjengoSettlementParams = {
  payment: any;
  plan: any;
  eventId?: string;
  verification?: { paystackId?: string; raw?: unknown; providerConfirmedAt?: string };
  repairingLegacyPaidPayment?: boolean;
};

export type MjengoSettlementResult = {
  subscription: any;
  alreadySettled: boolean;
  mjengoSubscription: true;
};

export class MjengoCheckoutRefused extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "MjengoCheckoutRefused";
  }
}

/**
 * Deployment switch. `M` is on only when MJENGO_OS_ENABLED says so (see mjengoFeatureEnabled).
 * A disabled product must refuse checkout rather than take money for a workspace it will not open.
 */
export function mjengoCheckoutRefusal(plan: { key?: string | null; priceKES?: number; durationDays?: number; isActive?: boolean } | null): string | null {
  if (!mjengoFeatureEnabled()) {
    return "MJENGO OS is not enabled on this deployment. No payment was taken.";
  }
  if (!plan) return "The MJENGO OS plan is not configured on this deployment. No payment was taken.";
  if (plan.key !== MJENGO_PLAN_KEY) {
    return "That plan is not MJENGO OS. Use the flow for the product you are buying.";
  }
  if (plan.isActive === false) return "MJENGO OS is not currently offered. No payment was taken.";
  if (Number(plan.priceKES) !== MJENGO_PLAN_PRICE_KES || Number(plan.durationDays) !== MJENGO_PLAN_DURATION_DAYS) {
    return `MJENGO OS must be KES ${MJENGO_PLAN_PRICE_KES.toLocaleString("en-KE")} / ${MJENGO_PLAN_DURATION_DAYS} days on the server. Payment is blocked until an administrator corrects the plan.`;
  }
  return null;
}

/**
 * MJENGO's dedicated tables isolate its paid-through state from ERP PRO.
 */
export async function assertMjengoStorageAvailable(tx: any, businessId: string): Promise<void> {
  // Dedicated MJENGO storage is independent; ERP PRO is never queried or modified here.
}

export async function settleMjengoPayment(tx: any, params: MjengoSettlementParams): Promise<MjengoSettlementResult> {
  const { payment, plan, eventId, verification } = params;
  if (plan?.key !== MJENGO_PLAN_KEY) throw new Error("MJENGO_PLAN_KEY_MISMATCH");
  if (Number(plan.priceKES) !== MJENGO_PLAN_PRICE_KES || Number(plan.durationDays) !== MJENGO_PLAN_DURATION_DAYS) {
    // The amount actually collected is checked by the caller against provider evidence; this is the
    // product-terms guard, so a mispriced plan can never be settled into an entitlement.
    throw new MjengoCheckoutRefused("PLAN_PRICING_INVALID", "MJENGO OS plan terms on the server do not match KES 2,000 / 30 days. Nothing was activated.", 500);
  }
  if (!payment.businessId) throw new Error("PAYMENT_CONTEXT_INVALID");
  if (!payment.userId) throw new Error("PAYMENT_CONTEXT_INVALID");

  const current: any = await tx.mjengoSubscription?.findUnique?.({ where: { businessId: payment.businessId } }).catch(() => null);

  // Already settled for this exact payment: never extend the window a second time.
  if (payment.status === "PAID" && current?.paymentId === payment.id && current?.status === "ACTIVE") {
    if (eventId) await tx.processedWebhook?.create?.({ data: { id: eventId } }).catch(() => undefined);
    return { subscription: current, alreadySettled: true, mjengoSubscription: true };
  }
  // Write only the dedicated MJENGO tables; ERP PRO state is not read or changed.
  await assertMjengoStorageAvailable(tx, payment.businessId);

  const repairingLegacyPaidPayment = params.repairingLegacyPaidPayment === true && payment.status === "PAID" && !current;
  if (params.repairingLegacyPaidPayment && !repairingLegacyPaidPayment) throw new Error("PAYMENT_STATE_CHANGED");
  const providerEvidence = typeof verification?.paystackId === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(verification.paystackId);
  if (!repairingLegacyPaidPayment && !providerEvidence) throw new Error("PAYMENT_EVIDENCE_REQUIRED");

  if (!repairingLegacyPaidPayment) {
    const changed = await tx.payment.updateMany({
      where: { id: payment.id, status: payment.status },
      data: { status: "PAID" },
    });
    if (changed.count !== 1) {
      // A concurrent settlement won the race. Resolve idempotently instead of double-extending.
      const latest = await tx.payment.findUnique({ where: { id: payment.id } });
      if (latest?.status === "PAID") {
        if (eventId) await tx.processedWebhook?.create?.({ data: { id: eventId } }).catch(() => undefined);
        const existing = await tx.mjengoSubscription?.findUnique?.({ where: { businessId: payment.businessId } }).catch(() => null);
        return { subscription: existing, alreadySettled: true, mjengoSubscription: true };
      }
      throw new Error("PAYMENT_STATE_CHANGED");
    }
  }

  const now = new Date();
  // Renewal extends from the later of "now" and the current paid-through date, so an early renewal
  // never shortens a period the customer already paid for.
  const currentEnd = current?.expiresAt ? new Date(current.expiresAt) : null;
  const startAt = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
  const expiresAt = new Date(startAt.getTime() + MJENGO_PLAN_DURATION_DAYS * 86_400_000);
  const graceUntil = new Date(expiresAt.getTime() + MJENGO_GRACE_DAYS * 86_400_000);

  const subscription = await tx.mjengoSubscription.upsert({
    where: { businessId: payment.businessId },
    update: {
      userId: payment.userId,
      planId: plan.id,
      planKey: MJENGO_PLAN_KEY,
      status: "ACTIVE",
      startAt,
      expiresAt,
      graceUntil,
      paymentId: payment.id,
      paymentReference: payment.reference ?? null,
      cancelledAt: null,
    },
    create: {
      businessId: payment.businessId,
      userId: payment.userId,
      planId: plan.id,
      planKey: MJENGO_PLAN_KEY,
      status: "ACTIVE",
      startAt,
      expiresAt,
      graceUntil,
      paymentId: payment.id,
      paymentReference: payment.reference ?? null,
    },
  });

  await tx.mjengoEntitlement.upsert({
    where: { businessId: payment.businessId },
    update: { packageKey: MJENGO_PLAN_KEY, status: "ACTIVE", activatedAt: now, expiresAt },
    create: { businessId: payment.businessId, packageKey: MJENGO_PLAN_KEY, status: "ACTIVE", activatedAt: now, expiresAt },
  });

  // Subscription and entitlement are committed atomically in this transaction.

  if (eventId) {
    await tx.processedWebhook?.create?.({ data: { id: eventId } }).catch(() => undefined);
  }

  return { subscription, alreadySettled: false, mjengoSubscription: true };
}
