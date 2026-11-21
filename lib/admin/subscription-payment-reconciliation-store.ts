/**
 * Database adapter for the read-only subscription/payment inventory.
 * Kept separate from the pure classifier so unit tests need no database client or credentials.
 */
import prisma from "@/lib/db";
import {
  summarizeSubscriptionPaymentLifecycle,
  type SubscriptionPaymentEvidence,
} from "@/lib/admin/subscription-payment-reconciliation";

/**
 * Fetches bounded pages using SELECT-only Prisma queries.
 * Use an isolated/read-only database for acceptance testing; this function performs no writes.
 */
export async function loadSubscriptionPaymentLifecycleReport() {
  const pageSize = 500;
  const evidence: SubscriptionPaymentEvidence[] = [];
  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.subscription.findMany({
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        businessId: true,
        userId: true,
        planId: true,
        status: true,
        paymentId: true,
        paymentReference: true,
        payment: {
          select: {
            id: true,
            reference: true,
            businessId: true,
            userId: true,
            planId: true,
            purpose: true,
            status: true,
          },
        },
      },
    });

    evidence.push(...page.map((row) => ({
      subscriptionId: row.id,
      businessId: row.businessId,
      userId: row.userId,
      planId: row.planId,
      status: row.status,
      paymentId: row.paymentId,
      paymentReference: row.paymentReference,
      payment: row.payment,
    })));

    if (page.length < pageSize) break;
    cursor = page[page.length - 1].id;
  }

  return summarizeSubscriptionPaymentLifecycle(evidence);
}
