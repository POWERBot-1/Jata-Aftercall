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
 * `ErpSubscription`/`ErpEntitlement` rows with `planKey`/`packageKey = "MJENGO_OS"`; those tables
 * have a `@unique` businessId, so they are MJENGO-dedicated columns — see
 * `assertMjengoStorageAvailable()` for how a business that already holds an ERP_PRO row is handled.
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
  syncMjengoEntitlement,
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
 * `ErpSubscription.businessId` and `ErpEntitlement.businessId` are `@unique`, so one business holds
 * at most one row of each and MJENGO OS cannot coexist there with ERP_PRO.
 *
 * This is a real, documented limitation rather than a silent overwrite: if the row belongs to
 * another package, settlement refuses and the payment is left PAID-but-unsettled for reconciliation,
 * which the operations runbook must resolve by hand. Dedicated Mjengo* tables remove the conflict;
 * they are not in this change because adding a table per product is a schema decision for the owner.
 */
export async function assertMjengoStorageAvailable(tx: any, businessId: string): Promise<void> {
  const existing = await tx.erpEntitlement?.findUnique?.({ where: { businessId } }).catch(() => null);
  if (existing && existing.packageKey && existing.packageKey !== MJENGO_PLAN_KEY) {
    throw new MjengoCheckoutRefused(
      "STORAGE_CONFLICT",
      `STORAGE_CONFLICT: this business already holds a ${existing.packageKey} package row, and MJENGO OS storage is not separate yet. The payment is recorded but MJENGO OS was not activated — reconciliation is required.`,
      409,
    );
  }
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

  const current: any = await tx.erpSubscription?.findUnique?.({ where: { businessId: payment.businessId } }).catch(() => null);

  // Already settled for this exact payment: never extend the window a second time.
  if (payment.status === "PAID" && current?.paymentId === payment.id && current?.status === "ACTIVE") {
    if (eventId) await tx.processedWebhook?.create?.({ data: { id: eventId } }).catch(() => undefined);
    return { subscription: current, alreadySettled: true, mjengoSubscription: true };
  }
  // Both rows are `@unique` on businessId, so BOTH must belong to MJENGO OS (or be absent) before
  // anything is written. Checking only the subscription row would let an ERP_PRO entitlement be
  // silently overwritten — i.e. the customer pays for MJENGO and loses BOS PRO.
  if (current && current.planKey && current.planKey !== MJENGO_PLAN_KEY) {
    await assertMjengoStorageAvailable(tx, payment.businessId);
  }
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
        const existing = await tx.erpSubscription?.findUnique?.({ where: { businessId: payment.businessId } }).catch(() => null);
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

  const subscription = await tx.erpSubscription.upsert({
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

  await tx.erpEntitlement.upsert({
    where: { businessId: payment.businessId },
    update: { packageKey: MJENGO_PLAN_KEY, status: "ACTIVE", activatedAt: now, expiresAt },
    create: { businessId: payment.businessId, packageKey: MJENGO_PLAN_KEY, status: "ACTIVE", activatedAt: now, expiresAt },
  });

  // Derivation stays the source of truth; persistence below it is a convenience for reporting.
  await syncMjengoEntitlement(payment.businessId).catch(() => undefined);

  if (eventId) {
    await tx.processedWebhook?.create?.({ data: { id: eventId } }).catch(() => undefined);
  }

  return { subscription, alreadySettled: false, mjengoSubscription: true };
}
