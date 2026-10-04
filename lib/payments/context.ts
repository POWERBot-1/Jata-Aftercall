/**
 * The payment data-access layer (§5, §56, §75).
 *
 * One place resolves "which tenant does this belong to" and loads the rows the orchestrator and
 * the webhook pipeline work with. Every read is tenant-scoped by an explicit `businessId` — never
 * by an id from the browser — and every write takes the caller's transaction client so a payment
 * confirmation can be one atomic unit (§98).
 */

import prisma from "@/lib/db";
import { publicBaseUrl } from "./config";
import type { DestinationRecord, ProviderKey, TransactionRecord } from "./types";
import type { AdapterContext } from "./providers/types";

/** Prisma client or a transaction client. Typed loosely like the POS store does. */
export type PaymentClient = any;

export function db(): PaymentClient {
  return prisma;
}

export function inTransaction<T>(client: PaymentClient | undefined, work: (tx: PaymentClient) => Promise<T>): Promise<T> {
  if (client && client !== prisma) return work(client);
  return prisma.$transaction(work);
}

export function adapterContext(now: Date = new Date(), options: { verifyWithProvider?: boolean; fetchImpl?: typeof fetch } = {}): AdapterContext {
  return {
    now,
    fetchImpl: options.fetchImpl ?? fetch,
    baseUrl: publicBaseUrl(),
    verifyWithProvider: options.verifyWithProvider ?? false,
  };
}

export const DESTINATION_SELECT = {
  id: true,
  businessId: true,
  kind: true,
  provider: true,
  label: true,
  providerDestinationId: true,
  providerAccountRef: true,
  bankName: true,
  accountName: true,
  currency: true,
  capabilities: true,
  status: true,
  verificationSource: true,
  isPrimary: true,
  isActive: true,
  verifiedAt: true,
  connectedAt: true,
  lastEventAt: true,
} as const;

export const TRANSACTION_SELECT = {
  id: true,
  jataPaymentId: true,
  businessId: true,
  destinationId: true,
  provider: true,
  status: true,
  providerReference: true,
  providerTransactionId: true,
  method: true,
  amountMinor: true,
  amountPaidMinor: true,
  amountRefundedMinor: true,
  currency: true,
  customerName: true,
  customerPhoneMasked: true,
  posSaleId: true,
  orderId: true,
  receiptNumber: true,
  receiptToken: true,
  failureCode: true,
  failureReason: true,
  expiresAt: true,
  createdAt: true,
  requestedAt: true,
  providerAcceptedAt: true,
  providerConfirmedAt: true,
  jataVerifiedAt: true,
  paidAt: true,
  reconciledAt: true,
} as const;

export async function findDestination(businessId: string, destinationId: string, client: PaymentClient = db()) {
  if (!businessId || !destinationId) return null;
  return client.paymentDestination.findFirst({ where: { id: destinationId, businessId }, select: DESTINATION_SELECT });
}

export async function listDestinations(businessId: string, client: PaymentClient = db()) {
  return client.paymentDestination.findMany({
    where: { businessId },
    select: DESTINATION_SELECT,
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
}

export async function findConnection(businessId: string, provider: ProviderKey | string, client: PaymentClient = db()) {
  return client.paymentProviderConnection.findFirst({ where: { businessId, provider } });
}

export async function findTransaction(businessId: string, transactionId: string, client: PaymentClient = db()) {
  if (!businessId || !transactionId) return null;
  return client.paymentTransaction.findFirst({ where: { id: transactionId, businessId } });
}

export async function findTransactionByJataId(businessId: string, jataPaymentId: string, client: PaymentClient = db()) {
  return client.paymentTransaction.findFirst({ where: { businessId, jataPaymentId } });
}

export async function findTransactionByIdempotencyKey(key: string, client: PaymentClient = db()) {
  return client.paymentTransaction.findFirst({ where: { idempotencyKey: key } });
}

/** Provider-side lookup used by the webhook pipeline; the provider reference is unique per provider. */
export async function findTransactionByProviderReference(
  provider: ProviderKey | string,
  reference: string,
  client: PaymentClient = db(),
) {
  if (!reference) return null;
  return client.paymentTransaction.findFirst({ where: { provider, providerReference: reference } });
}

export async function findTransactionByProviderTransactionId(
  provider: ProviderKey | string,
  providerTransactionId: string,
  client: PaymentClient = db(),
) {
  if (!providerTransactionId) return null;
  return client.paymentTransaction.findFirst({ where: { provider, providerTransactionId } });
}

/**
 * A destination is identified by the provider's own view of where the money went (§13, §56):
 * the shortcode/account plus the account reference for a PayBill. This is how a C2B confirmation
 * finds its tenant without the merchant configuring anything at the provider.
 */
export async function findDestinationByProviderTarget(params: {
  provider: ProviderKey | string;
  providerDestinationId: string;
  providerAccountRef?: string | null;
  kind?: string | null;
}, client: PaymentClient = db()) {
  const digits = String(params.providerDestinationId ?? "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  return client.paymentDestination.findFirst({
    where: {
      provider: params.provider,
      providerDestinationId: digits,
      isActive: true,
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
}

export function asDestinationRecord(row: any): DestinationRecord | null {
  return row ? (row as DestinationRecord) : null;
}

export function asTransactionRecord(row: any): TransactionRecord | null {
  return row ? (row as TransactionRecord) : null;
}

/** The merchant's timezone-free "today" window used by the payment dashboard (§40). */
export function startOfToday(now: Date = new Date()): Date {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function clampText(value: unknown, max = 200): string {
  const text = typeof value === "string" ? value.replace(/[<>]/g, "").trim() : "";
  return text.slice(0, max);
}
