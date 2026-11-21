/**
 * Read-only subscription ↔ payment integrity inventory.
 *
 * This module reports provenance and identity exceptions only. It never repairs subscriptions,
 * changes payment status, grants entitlements, or interprets provider settlement as payment proof.
 */
import prisma from "@/lib/db";

export type SubscriptionPaymentEvidence = {
  subscriptionId: string;
  businessId: string;
  userId: string;
  planId: string;
  status: string;
  paymentId: string | null;
  paymentReference: string | null;
  payment: null | {
    id: string;
    reference: string;
    businessId: string | null;
    userId: string;
    planId: string | null;
    purpose: string;
    status: string;
  };
};

export type SubscriptionPaymentException =
  | "ACTIVE_SUBSCRIPTION_WITHOUT_PAYMENT"
  | "SUBSCRIPTION_PAYMENT_NOT_FOUND"
  | "ACTIVE_SUBSCRIPTION_WITH_UNPAID_PAYMENT"
  | "SUBSCRIPTION_PAYMENT_IDENTITY_MISMATCH";

export type SubscriptionPaymentFinding = {
  exception: SubscriptionPaymentException;
  subscriptionId: string;
  paymentId?: string;
};

export type SubscriptionPaymentReport = {
  subscriptionsReviewed: number;
  findings: SubscriptionPaymentFinding[];
  counts: Record<SubscriptionPaymentException, number>;
  scope: "READ_ONLY_SUBSCRIPTION_PAYMENT_INVENTORY";
};

const active = (status: string) => status === "ACTIVE" || status === "EXPIRING";

export function summarizeSubscriptionPaymentLifecycle(
  evidence: SubscriptionPaymentEvidence[],
): SubscriptionPaymentReport {
  const findings: SubscriptionPaymentFinding[] = [];
  const counts: SubscriptionPaymentReport["counts"] = {
    ACTIVE_SUBSCRIPTION_WITHOUT_PAYMENT: 0,
    SUBSCRIPTION_PAYMENT_NOT_FOUND: 0,
    ACTIVE_SUBSCRIPTION_WITH_UNPAID_PAYMENT: 0,
    SUBSCRIPTION_PAYMENT_IDENTITY_MISMATCH: 0,
  };
  const seen = new Set<string>();
  const push = (finding: SubscriptionPaymentFinding) => {
    findings.push(finding);
    counts[finding.exception] += 1;
  };

  for (const row of evidence) {
    if (!row.subscriptionId || seen.has(row.subscriptionId)) {
      throw new Error("SUBSCRIPTION_PAYMENT_SUBSCRIPTION_ID_AMBIGUOUS");
    }
    seen.add(row.subscriptionId);

    if (!row.paymentId) {
      if (active(row.status)) {
        push({ exception: "ACTIVE_SUBSCRIPTION_WITHOUT_PAYMENT", subscriptionId: row.subscriptionId });
      }
      continue;
    }

    if (!row.payment) {
      push({ exception: "SUBSCRIPTION_PAYMENT_NOT_FOUND", subscriptionId: row.subscriptionId, paymentId: row.paymentId });
      continue;
    }

    const payment = row.payment;
    const identityMismatch =
      payment.id !== row.paymentId ||
      payment.businessId !== row.businessId ||
      payment.userId !== row.userId ||
      payment.planId !== row.planId ||
      payment.purpose !== "SUBSCRIPTION" ||
      (row.paymentReference !== null && payment.reference !== row.paymentReference);

    if (identityMismatch) {
      push({ exception: "SUBSCRIPTION_PAYMENT_IDENTITY_MISMATCH", subscriptionId: row.subscriptionId, paymentId: row.paymentId });
      continue;
    }

    if (active(row.status) && payment.status !== "PAID") {
      push({ exception: "ACTIVE_SUBSCRIPTION_WITH_UNPAID_PAYMENT", subscriptionId: row.subscriptionId, paymentId: row.paymentId });
    }
  }

  return {
    subscriptionsReviewed: evidence.length,
    findings,
    counts,
    scope: "READ_ONLY_SUBSCRIPTION_PAYMENT_INVENTORY",
  };
}

/**
 * Fetches bounded pages from the application database. This is a SELECT-only inventory;
 * callers must still use an isolated/read-only database for acceptance testing.
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
