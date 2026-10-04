/**
 * Payment notifications (§26, §27, §66, §100, §115) — a queue that can fail without touching money.
 *
 * The order is mandatory (§65): the customer pays, the provider confirms, JATA verifies and marks
 * the payment paid, and only then is anyone told anything. A merchant is never told "you have been
 * paid" before the confirmation exists, and a customer is never told "payment successful" on the
 * strength of a redirect.
 *
 * Delivery is separated from confirmation (§66, §100): the messages are queued inside the payment
 * transaction, then delivered afterwards. A message that cannot be delivered is recorded as
 * FAILED — the payment stays PAID — and retried on its own schedule.
 */

import prisma from "@/lib/db";
import { logPaymentAudit } from "./audit";
import { db, type PaymentClient } from "./context";
import { formatMinor, maskPhone } from "./money";
import type { PaymentStatus } from "./states";

export type NotificationKind = "CONFIRMATION" | "REVERSAL" | "FAILURE";

export type QueuedNotification = {
  audience: "MERCHANT" | "CUSTOMER";
  channel: string;
  recipientMasked: string | null;
  title: string;
  message: string;
  idempotencyKey: string;
};

function orderReference(transaction: any): string {
  const context = typeof transaction.paymentContext === "string"
    ? safeParse(transaction.paymentContext)
    : transaction.paymentContext;
  const receipt = transaction.receiptNumber ?? context?.pos?.request?.notes ?? null;
  if (receipt) return String(receipt);
  if (transaction.orderId) return `#${String(transaction.orderId).slice(-6)}`;
  const tail = String(transaction.jataPaymentId ?? "").split("-").slice(-2).join("-");
  return tail ? `#${tail}` : "";
}

function safeParse(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** §115 — the exact copy the customer and the merchant see. No technical terminology anywhere. */
export function notificationCopy(params: {
  kind: NotificationKind;
  audience: "MERCHANT" | "CUSTOMER";
  businessName: string;
  amountMinor: number;
  currency: string;
  orderReference: string;
  providerLabel: string;
  providerTransactionId: string | null;
  failureReason?: string | null;
}): { title: string; message: string } {
  const amount = formatMinor(params.amountMinor, params.currency);
  const reference = params.orderReference ? `Order ${params.orderReference}` : "";
  const receipt = params.providerTransactionId ? `Transaction:\n${params.providerTransactionId}` : "";

  if (params.kind === "CONFIRMATION") {
    if (params.audience === "CUSTOMER") {
      return {
        title: "PAYMENT SUCCESSFUL ✓",
        message: [`${amount} paid to ${params.businessName}.`, reference, receipt, "Thank you."].filter(Boolean).join("\n"),
      };
    }
    return {
      title: "PAYMENT RECEIVED ✓",
      message: [amount, reference, params.providerLabel, params.providerTransactionId, "Customer payment confirmed."].filter(Boolean).join("\n"),
    };
  }

  if (params.kind === "REVERSAL") {
    return {
      title: "PAYMENT REVERSED",
      message: [
        `${amount}`,
        reference,
        `${params.providerLabel} reversed this payment.`,
        "Please review this order — the money has been returned to the customer.",
      ].filter(Boolean).join("\n"),
    };
  }

  return {
    title: "PAYMENT NOT COMPLETED",
    message: [
      amount,
      reference,
      params.failureReason ?? "The payment was not confirmed.",
      params.audience === "CUSTOMER" ? "You can try again or use another payment method." : "The order is still unpaid.",
    ].filter(Boolean).join("\n"),
  };
}

/**
 * Queues the merchant and customer messages for a payment that has reached a final state. Runs
 * inside the payment's own transaction, so a confirmed payment always has its messages on record;
 * a duplicate confirmation (or a replay) cannot queue the same message twice, because the
 * idempotency key is unique in the database (§33, §66).
 */
export async function ensureNotificationsForConfirmation(params: {
  businessId: string;
  transaction: any;
  destinationId: string | null;
  saleId: string | null;
  client: PaymentClient;
  kind?: NotificationKind;
}): Promise<{ queued: number }> {
  const { businessId, transaction, client } = params;
  const kind: NotificationKind = params.kind ?? "CONFIRMATION";
  if (!client.paymentNotification?.create) return { queued: 0 };

  const business = await client.business.findUnique({
    where: { id: businessId },
    select: { name: true, phone: true, whatsapp: true },
  });
  const providerLabel = String(transaction.provider ?? "").toUpperCase() === "MPESA" ? "M-PESA" : String(transaction.provider ?? "Provider");
  const reference = transaction.receiptNumber ?? orderReference({ ...transaction, paymentContext: params.transaction.paymentContext });
  const base = {
    kind,
    businessName: String(business?.name ?? "your business"),
    amountMinor: kind === "CONFIRMATION" ? Number(transaction.amountPaidMinor ?? transaction.amountMinor) : Number(transaction.amountRefundedMinor ?? transaction.amountMinor),
    currency: String(transaction.currency ?? "KES"),
    orderReference: String(reference ?? ""),
    providerLabel,
    providerTransactionId: transaction.providerTransactionId ?? null,
    failureReason: transaction.failureReason ?? null,
  };

  const merchant = notificationCopy({ ...base, audience: "MERCHANT" });
  const customer = notificationCopy({ ...base, audience: "CUSTOMER" });
  const merchantPhone = maskPhone(business?.whatsapp ?? business?.phone) ?? null;
  const customerPhone = transaction.customerPhoneMasked ?? null;

  const queued: QueuedNotification[] = [
    {
      audience: "MERCHANT",
      channel: "POS",
      recipientMasked: null,
      title: merchant.title,
      message: merchant.message,
      idempotencyKey: `pmt:${transaction.id}:${kind}:MERCHANT:POS`,
    },
    {
      audience: "CUSTOMER",
      channel: "SCREEN",
      recipientMasked: customerPhone,
      title: customer.title,
      message: customer.message,
      idempotencyKey: `pmt:${transaction.id}:${kind}:CUSTOMER:SCREEN`,
    },
  ];

  if (merchantPhone) {
    queued.push({
      audience: "MERCHANT",
      channel: "SMS",
      recipientMasked: merchantPhone,
      title: merchant.title,
      message: merchant.message,
      idempotencyKey: `pmt:${transaction.id}:${kind}:MERCHANT:SMS`,
    });
  }
  if (customerPhone) {
    queued.push({
      audience: "CUSTOMER",
      channel: "SMS",
      recipientMasked: customerPhone,
      title: customer.title,
      message: customer.message,
      idempotencyKey: `pmt:${transaction.id}:${kind}:CUSTOMER:SMS`,
    });
  }

  let created = 0;
  for (const entry of queued) {
    const existing = await client.paymentNotification.findFirst({ where: { idempotencyKey: entry.idempotencyKey } });
    if (existing) continue;
    await client.paymentNotification.create({
      data: {
        businessId,
        transactionId: transaction.id,
        audience: entry.audience,
        channel: entry.channel,
        recipientMasked: entry.recipientMasked,
        title: entry.title,
        message: entry.message,
        status: "PENDING",
        idempotencyKey: entry.idempotencyKey,
        scheduledAt: new Date(),
      },
    });
    created += 1;
  }

  // The POS message is delivered the moment it exists: it is rendered from the same record the
  // dashboard and the live stream read. External channels are delivered (or honestly skipped) by
  // `deliverPendingPaymentNotifications`, after the payment transaction has committed.
  return { queued: created };
}

export type DeliveryOutcome = { delivered: number; failed: number; skipped: number };

type GatewayConfig = { url: string; token: string; ready: boolean };

function gateway(): GatewayConfig {
  const url = String(process.env.JATA_NOTIFICATION_GATEWAY_URL ?? "").trim();
  const token = String(process.env.JATA_NOTIFICATION_GATEWAY_TOKEN ?? "").trim();
  return { url, token, ready: Boolean(url) };
}

/**
 * Delivers queued messages. Called after the payment transaction commits, by the webhook pipeline
 * and by the retry job — never inside the money path (§100).
 */
export async function deliverPendingPaymentNotifications(params: {
  businessId?: string;
  limit?: number;
  now?: Date;
  client?: PaymentClient;
  fetchImpl?: typeof fetch;
} = {}): Promise<DeliveryOutcome> {
  const client = params.client ?? prisma;
  const now = params.now ?? new Date();
  const config = gateway();
  const fetchImpl = params.fetchImpl ?? fetch;

  const pending = await client.paymentNotification.findMany({
    where: {
      ...(params.businessId ? { businessId: params.businessId } : {}),
      status: "PENDING",
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(params.limit ?? 50, 200),
  });

  let delivered = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of pending ?? []) {
    const channel = String(row.channel ?? "POS").toUpperCase();
    const inApp = channel === "POS" || channel === "SCREEN" || channel === "IN_APP";
    if (inApp) {
      await client.paymentNotification.update({
        where: { id: row.id },
        data: { status: "SENT", sentAt: now, attempts: Number(row.attempts ?? 0) + 1 },
      });
      delivered += 1;
      await stampNotified(client, row, now);
      continue;
    }

    if (!config.ready) {
      // No SMS/e-mail/WhatsApp gateway is configured in this deployment, so JATA does not claim
      // the message was sent — it records the truth: queued, not deliverable here (§66, §129).
      await client.paymentNotification.update({
        where: { id: row.id },
        data: {
          status: "SKIPPED",
          attempts: Number(row.attempts ?? 0) + 1,
          lastError: `No ${channel.toLowerCase()} provider is configured in this deployment.`,
        },
      });
      skipped += 1;
      continue;
    }

    try {
      const response = await fetchImpl(config.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) },
        body: JSON.stringify({
          channel,
          to: row.recipientMasked,
          title: row.title,
          message: row.message,
          businessId: row.businessId,
          reference: row.idempotencyKey,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`gateway_${response.status}`);
      await client.paymentNotification.update({
        where: { id: row.id },
        data: { status: "SENT", sentAt: new Date(), attempts: Number(row.attempts ?? 0) + 1 },
      });
      delivered += 1;
      await stampNotified(client, row, new Date());
    } catch (error) {
      const attempts = Number(row.attempts ?? 0) + 1;
      const maxAttempts = Number(row.maxAttempts ?? 3);
      await client.paymentNotification.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          attempts,
          lastError: (error as Error).message.slice(0, 200),
          scheduledAt: attempts < maxAttempts ? new Date(now.getTime() + attempts * 60_000) : null,
        },
      });
      failed += 1;
    }
  }

  return { delivered, failed, skipped };
}

async function stampNotified(client: PaymentClient, notification: any, at: Date): Promise<void> {
  if (!notification.transactionId) return;
  const field = String(notification.audience) === "MERCHANT" ? "merchantNotifiedAt" : "customerNotifiedAt";
  const transaction = await client.paymentTransaction.findFirst({ where: { id: notification.transactionId, businessId: notification.businessId } });
  if (!transaction?.[field]) {
    await client.paymentTransaction.updateMany({ where: { id: notification.transactionId, businessId: notification.businessId }, data: { [field]: at } });
  }
}

/** §66, §102: retry a message on its own, without touching the payment it belongs to. */
export async function retryPaymentNotification(params: {
  businessId: string;
  notificationId: string;
  actorId?: string | null;
  actorName?: string | null;
  client?: PaymentClient;
}) {
  const client = params.client ?? db();
  const row = await client.paymentNotification.findFirst({ where: { id: params.notificationId, businessId: params.businessId } });
  if (!row) return { ok: false as const, code: "NOT_FOUND", message: "That message was not found." };
  if (row.status === "SENT") return { ok: false as const, code: "ALREADY_SENT", message: "That message was already sent." };
  await client.paymentNotification.update({
    where: { id: row.id },
    data: { status: "PENDING", attempts: 0, lastError: null, scheduledAt: new Date() },
  });
  await logPaymentAudit({
    businessId: params.businessId,
    transactionId: row.transactionId ?? null,
    actorKind: params.actorId ? "MERCHANT_STAFF" : "JATA_SYSTEM",
    actorId: params.actorId ?? null,
    actorName: params.actorName ?? null,
    action: "NOTIFICATION_RETRIED",
    summary: "Message queued for another delivery attempt.",
    afterState: { channel: row.channel, audience: row.audience },
  }, client);
  // A retry of a real channel is delivered immediately when a gateway exists; otherwise the row
  // simply becomes PENDING again and the next delivery pass reports the honest outcome.
  const outcome = await deliverPendingPaymentNotifications({ businessId: params.businessId, client });
  return { ok: true as const, outcome };
}

export function notificationStatusLabel(status: string): string {
  switch (status) {
    case "SENT":
      return "Sent";
    case "PENDING":
      return "Queued";
    case "FAILED":
      return "Could not be sent";
    case "SKIPPED":
      return "Not sent — channel not configured";
    default:
      return status;
  }
}

export type { PaymentStatus };
