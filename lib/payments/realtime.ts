/**
 * Realtime payment updates (§21, §25, §41, §112).
 *
 * The till must change to PAID with no refresh, and the live payments screen must fill itself in.
 * JATA does this by streaming *server state* — never a browser's opinion of what happened, and
 * never an optimistic "paid" that the server has not verified (§41, §112).
 *
 * Transport: Server-Sent Events backed by (a) an in-process publish of an event the moment a
 * payment changes inside this instance, and (b) a tenant-scoped database poll as the fallback and
 * the cross-instance path. Both carry the same, minimal payload; a client that misses every event
 * still gets the truth on its next poll (§41 "secure fallback mechanism").
 */

import prisma from "@/lib/db";
import type { PaymentClient } from "./context";

export type PaymentStreamEvent = {
  businessId: string;
  transactionId: string;
  status: string;
  at: string;
  /** Set when the change came from a provider confirmation rather than a local action. */
  source?: "PROVIDER" | "POS" | "SYSTEM";
};

type Listener = (event: PaymentStreamEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function publishPaymentEvent(event: PaymentStreamEvent): void {
  const bucket = listeners.get(event.businessId);
  if (!bucket) return;
  for (const listener of bucket) {
    try {
      listener(event);
    } catch {
      // A slow or broken subscriber must never affect a payment.
    }
  }
}

export function subscribeToPaymentEvents(businessId: string, listener: Listener): () => void {
  const bucket = listeners.get(businessId) ?? new Set<Listener>();
  bucket.add(listener);
  listeners.set(businessId, bucket);
  return () => {
    bucket.delete(listener);
    if (!bucket.size) listeners.delete(businessId);
  };
}

/** Test helper: how many subscribers a tenant currently has. */
export function listenerCount(businessId: string): number {
  return listeners.get(businessId)?.size ?? 0;
}

/**
 * Payments for this tenant changed since `since` — the polling half of the stream. Tenant-scoped
 * by construction, so a stream can never reveal another business's payments (§57).
 */
export async function paymentsChangedSince(
  businessId: string,
  since: Date,
  client: PaymentClient = prisma,
): Promise<PaymentStreamEvent[]> {
  const rows = await client.paymentTransaction.findMany({
    where: { businessId, updatedAt: { gt: since } },
    orderBy: { updatedAt: "asc" },
    take: 100,
    select: { id: true, status: true, updatedAt: true },
  });
  return (rows ?? []).map((row: any) => ({
    businessId,
    transactionId: String(row.id),
    status: String(row.status),
    at: new Date(row.updatedAt ?? Date.now()).toISOString(),
    source: "SYSTEM" as const,
  }));
}
