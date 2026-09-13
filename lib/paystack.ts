/**
 * Paystack integration — server-side only.
 * - Never expose secret to client.
 * - Verification via https://api.paystack.co/transaction/verify/:reference
 * - Webhook signature: HMAC SHA512 of raw body with secret, header x-paystack-signature
 * - Idempotency: ProcessedWebhook table + Payment.reference uniqueness
 */
import crypto from "crypto";
import prisma from "./db";

const PAYSTACK_BASE = "https://api.paystack.co";

function getSecret(): string {
  const s = process.env.PAYSTACK_SECRET_KEY;
  if (!s) throw new Error("PAYSTACK_SECRET_KEY not configured");
  return s;
}

export function getMerchantId(): string {
  return process.env.PAYSTACK_MERCHANT_ID || "2006074";
}

export type InitializeParams = {
  email: string;
  amount: number; // in kobo (lowest currency unit)
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
};

export async function initializeTransaction(params: InitializeParams): Promise<{ authorization_url: string; reference: string; access_code: string }> {
  const secret = getSecret();
  const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: params.email,
      amount: params.amount,
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
    }),
  });
  const data = await res.json();
  if (!data.status) {
    throw new Error(data.message || "Paystack initialize failed");
  }
  return data.data;
}

export async function verifyTransaction(reference: string): Promise<{
  status: string;
  amount: number;
  currency: string;
  reference: string;
  id: number;
  gateway_response: string;
  paid_at?: string;
}> {
  const secret = getSecret();
  const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const data = await res.json();
  if (!data.status) {
    throw new Error(data.message || "Paystack verify failed");
  }
  return data.data;
}

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = getSecret();
  const hash = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  // timingSafeEqual requires same length buffers
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "utf8"), Buffer.from(signature, "utf8"));
  } catch {
    return false;
  }
}

// Idempotency helpers

export async function isWebhookProcessed(id: string): Promise<boolean> {
  const found = await prisma.processedWebhook.findUnique({ where: { id } });
  return !!found;
}

export async function markWebhookProcessed(id: string): Promise<void> {
  await prisma.processedWebhook.upsert({
    where: { id },
    update: {},
    create: { id },
  });
}

/**
 * Activate or extend subscription after verified PAID payment.
 * Idempotent: if payment already PAID, skip extension.
 * Amount / currency are validated before calling this.
 */
export async function activateSubscriptionForPayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { business: true },
  });
  if (!payment) throw new Error("Payment not found");
  if (payment.status !== "PAID") throw new Error("Payment not PAID");
  if (!payment.businessId || !payment.planId) throw new Error("Payment missing business/plan");

  const plan = await prisma.planConfig.findUnique({ where: { id: payment.planId } });
  if (!plan) throw new Error("Plan not found");

  const now = new Date();
  const existing = await prisma.subscription.findUnique({ where: { businessId: payment.businessId } });

  // Idempotency: if subscription already active and expiresAt is beyond now + duration, likely duplicate; but we allow extension only once per payment.
  // Check if this payment already extended — we store subscription extension via updatedAt proximity, but simplest: if subscription's startAt close to payment created, skip.
  // Better: ensure only one activation per payment.reference — Payment.status PAID is set once; re-entry with same paymentId should not re-extend.
  // Use a guard: if payment already used, subscription won't change on second call due to reference uniqueness.
  // We implement by checking if subscription expiresAt > now and was recently updated — but to keep idempotent, we make extension happen only if payment's updatedAt is after subscription's updatedAt? Instead we store payment reference in subscription? Simplify: use a ProcessedWebhook-like check.
  // Instead, we track that activate is called with paymentId — we create ProcessedWebhook entry for payment.reference-activate.
  const activationKey = `activate:${payment.reference}`;
  if (await isWebhookProcessed(activationKey)) {
    return existing;
  }

  const durationMs = plan.durationDays * 24 * 60 * 60 * 1000;
  const graceMs = 3 * 24 * 60 * 60 * 1000; // 3 days grace configurable (spec §40)
  let startAt = now;
  let expiresAt = new Date(now.getTime() + durationMs);

  if (existing && existing.expiresAt && existing.expiresAt > now) {
    // Extend from current expiry
    expiresAt = new Date(existing.expiresAt.getTime() + durationMs);
    startAt = existing.startAt || now;
  }

  const sub = await prisma.subscription.upsert({
    where: { businessId: payment.businessId },
    update: {
      planId: plan.id,
      status: "ACTIVE",
      startAt,
      expiresAt,
      graceUntil: new Date(expiresAt.getTime() + graceMs),
      userId: payment.userId,
    },
    create: {
      businessId: payment.businessId,
      userId: payment.userId,
      planId: plan.id,
      status: "ACTIVE",
      startAt,
      expiresAt,
      graceUntil: new Date(expiresAt.getTime() + graceMs),
    },
  });

  // Also activate business
  await prisma.business.update({
    where: { id: payment.businessId },
    data: { status: "ACTIVE" },
  });

  await markWebhookProcessed(activationKey);

  await prisma.auditEvent.create({
    data: {
      actorId: payment.userId,
      action: "SUBSCRIPTION_ACTIVATED",
      targetType: "SUBSCRIPTION",
      targetId: sub.id,
      metadata: JSON.stringify({ paymentReference: payment.reference, planKey: plan.key, businessId: payment.businessId }),
    },
  });

  return sub;
}

export function toKobo(kes: number): number {
  return Math.round(kes * 100);
}

export function fromKobo(kobo: number): number {
  return kobo / 100;
}
