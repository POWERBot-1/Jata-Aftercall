/** Server-only Paystack integration. Never return or log secret configuration. */
import crypto from "crypto";
import prisma from "./db";
import { isProviderTransactionId, isSettleablePaymentStatus, subscriptionWindow } from "./paymentVerification";
import { PAYMENT_CURRENCY } from "./paymentCurrency";
import { POS_PLAN_KEY } from "./pos/entitlement";
import { settlePosPayment } from "./pos/settlement";
import { containsInlineImageDataUrl, serializeJsonWithoutInlineImageData } from "./media/persistence-policy";

const PAYSTACK_BASE = "https://api.paystack.co";

function getSecret(): string {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new Error("PAYSTACK_NOT_CONFIGURED");
  return secret;
}

export type InitializeParams = {
  email: string;
  amount: number;
  currency: typeof PAYMENT_CURRENCY;
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
};

export async function initializeTransaction(params: InitializeParams): Promise<{ authorization_url: string; reference: string; access_code: string }> {
  if (!/^[A-Za-z0-9.=-]+$/.test(params.reference) || params.currency !== PAYMENT_CURRENCY) {
    throw new Error("PAYSTACK_INITIALIZATION_INPUT_INVALID");
  }
  const response = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getSecret()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: params.email, amount: String(params.amount), currency: params.currency, reference: params.reference,
      callback_url: params.callbackUrl, metadata: params.metadata,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  const authorizationUrl = typeof result?.data?.authorization_url === "string" ? result.data.authorization_url : "";
  let safeCheckoutUrl = false;
  try {
    const parsed = new URL(authorizationUrl);
    safeCheckoutUrl = parsed.protocol === "https:" && parsed.hostname === "checkout.paystack.com";
  } catch { /* invalid provider URL */ }
  if (!response.ok || !result?.status || !safeCheckoutUrl || result.data.reference !== params.reference) {
    throw new Error("PAYSTACK_INITIALIZATION_FAILED");
  }
  return result.data;
}

export type VerifiedTransaction = {
  status: string;
  amount: number;
  currency: string;
  reference: string;
  id: number | string;
  gateway_response?: string;
  paid_at?: string;
};

export async function verifyTransaction(reference: string): Promise<VerifiedTransaction> {
  const response = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${getSecret()}` },
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  const data = result?.data;
  const validId = typeof data?.id === "number" ? Number.isSafeInteger(data.id) : isProviderTransactionId(data?.id);
  if (!response.ok || !result?.status || !data || typeof data.status !== "string" ||
      typeof data.reference !== "string" || !Number.isSafeInteger(data.amount) ||
      typeof data.currency !== "string" || !/^[A-Z]{3}$/.test(data.currency) || !validId) {
    throw new Error("PAYSTACK_VERIFICATION_FAILED");
  }
  return data as VerifiedTransaction;
}

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature || !process.env.PAYSTACK_SECRET_KEY) return false;
  const expected = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && crypto.timingSafeEqual(expected, supplied);
}

export async function isWebhookProcessed(id: string): Promise<boolean> {
  return Boolean(await prisma.processedWebhook.findUnique({ where: { id }, select: { id: true } }));
}

export type SettlementResult = { subscription: unknown; alreadySettled: boolean };

/**
 * Called only after a matching successful Paystack verification (or an authorized test mock).
 * A single database transaction changes payment, subscription and business state. The unique
 * payment reference and PAID status compare-and-set prevent concurrent retries extending twice.
 */
export async function activateSubscriptionForPayment(
  paymentId: string,
  eventId?: string,
  verification?: { paystackId?: string; raw?: unknown },
): Promise<SettlementResult> {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new Error("PAYMENT_NOT_FOUND");
    if (!payment.businessId || !payment.planId) throw new Error("PAYMENT_CONTEXT_INVALID");
    if (payment.currency !== PAYMENT_CURRENCY) throw new Error("PAYMENT_CURRENCY_MISMATCH");

    if (eventId) {
      const alreadySeen = await tx.processedWebhook.findUnique({ where: { id: eventId } });
      if (alreadySeen) {
        return { subscription: await tx.subscription.findUnique({ where: { businessId: payment.businessId } }), alreadySettled: true };
      }
    }

    const current = await tx.subscription.findUnique({ where: { businessId: payment.businessId } });
    const repairingLegacyPaidPayment = payment.status === "PAID" && !current;
    if (payment.status === "PAID" && current) {
      if (eventId) await tx.processedWebhook.create({ data: { id: eventId } });
      return { subscription: current, alreadySettled: true };
    }
    /*
     * What may settle, and on what evidence.
     *
     *   PENDING                     — only with provider transaction evidence from the caller.
     *   FAILED/CANCELLED/EXPIRED    — the same evidence is required to correct a stale local state.
     *   PAID (with a subscription)  — already handled above, idempotent.
     *   PAID without a subscription — legacy repair of the already-paid row.
     *   REFUNDED / anything else    — never: money already returned is not money received.
     *
     * The webhook and verify route both verify the transaction with Paystack and match its
     * reference, amount, currency and successful status before calling this function. Requiring
     * the transaction id here also makes a bare internal call fail closed for every new settlement.
     */
    // Every new settlement needs the transaction id from a provider verification the caller
    // performed and matched against this payment. PENDING is not permission to skip verification.
    // The explicit legacy repair path only repairs a payment already recorded as PAID.
    const providerEvidence = isProviderTransactionId(verification?.paystackId);

    if (!isSettleablePaymentStatus(payment.status) && !repairingLegacyPaidPayment) throw new Error("PAYMENT_NOT_SETTLEABLE");
    if (!repairingLegacyPaidPayment && !providerEvidence) throw new Error("PAYMENT_EVIDENCE_REQUIRED");

    const plan = await tx.planConfig.findUnique({ where: { id: payment.planId } });
    if (!plan) throw new Error("PLAN_NOT_FOUND");

    // Remembered before any write: the state this verified success settled from, reported in the
    // audit trail so a revived payment can be reconciled later. (Read from the row rather than
    // assumed, and captured before the compare-and-set for the same reason.)
    const settledFrom = payment.status;

    // JATA AFTERCALL Business POS (spec §4, §43–§45): an additive product with its own
    // subscription row, settled from the same verified payment and the same idempotency
    // guards. Every other plan key keeps exactly the behaviour it had before (§80).
    if (plan.key === POS_PLAN_KEY) {
      return settlePosPayment(tx, { payment, plan, eventId, verification, repairingLegacyPaidPayment });
    }

    const now = new Date();
    const { startAt, expiresAt } = subscriptionWindow(now, plan.durationDays, current);

    if (!repairingLegacyPaidPayment) {
      const rawForStorage = verification?.raw === undefined
        ? undefined
        : serializeJsonWithoutInlineImageData(verification.raw);
      // The verified transaction id is evidence for this call, but optional provider text must
      // not make the money-state transaction fail a database write policy. Omit only the unsafe
      // identifier; retain the provider-verified settlement and its existing CAS/entitlement path.
      const paystackIdForStorage = verification?.paystackId &&
        !containsInlineImageDataUrl(verification.paystackId)
        ? verification.paystackId
        : undefined;
      const changed = await tx.payment.updateMany({
        // Compare-and-set on the state that was read: a concurrent settlement of any kind makes
        // this write match nothing, and the branch below then resolves idempotently.
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
          if (eventId) await tx.processedWebhook.create({ data: { id: eventId } });
          return { subscription: await tx.subscription.findUnique({ where: { businessId: payment.businessId } }), alreadySettled: true };
        }
        throw new Error("PAYMENT_STATE_CHANGED");
      }
    }

    const subscription = await tx.subscription.upsert({
      where: { businessId: payment.businessId },
      update: {
        userId: payment.userId, planId: plan.id, status: "ACTIVE", startAt, expiresAt,
        graceUntil: new Date(expiresAt.getTime() + 3 * 86400000),
      },
      create: {
        businessId: payment.businessId, userId: payment.userId, planId: plan.id,
        status: "ACTIVE", startAt, expiresAt, graceUntil: new Date(expiresAt.getTime() + 3 * 86400000),
      },
    });
    await tx.business.update({ where: { id: payment.businessId }, data: { status: "ACTIVE" } });
    if (plan.key === "AI_BUSINESS_FRONT_DESK") {
      await tx.aIPackageEntitlement?.upsert?.({
        where: { businessId: payment.businessId },
        update: {
          packageKey: "AI_BUSINESS_FRONT_DESK",
          status: "ACTIVE",
          activatedAt: startAt,
          expiresAt,
        },
        create: {
          businessId: payment.businessId,
          packageKey: "AI_BUSINESS_FRONT_DESK",
          status: "ACTIVE",
          activatedAt: startAt,
          expiresAt,
        },
      });
    }
    if (eventId) await tx.processedWebhook.create({ data: { id: eventId } });
    await tx.auditEvent.create({
      data: {
        actorId: payment.userId, action: "SUBSCRIPTION_ACTIVATED", targetType: "SUBSCRIPTION",
        targetId: subscription.id,
        metadata: JSON.stringify({
          paymentReference: payment.reference,
          planKey: plan.key,
          businessId: payment.businessId,
          // Observability for a revived payment: the stored state a verified success corrected.
          ...(settledFrom === "PENDING" ? {} : { settledFrom }),
        }),
      },
    });
    return { subscription, alreadySettled: false };
  });
}

export function toKobo(kes: number): number { return Math.round(kes * 100); }
export function fromKobo(kobo: number): number { return kobo / 100; }
