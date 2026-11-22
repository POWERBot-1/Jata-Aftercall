/**
 * Read-only product entitlement inventory adapter.
 * Queries existing product subscription/entitlement tables; never writes or repairs records.
 */
import prisma from "@/lib/db";
import {
  summarizeProductEntitlementLifecycle,
  type ProductKey,
  type ProductLifecycleEvidence,
} from "@/lib/admin/product-entitlement-reconciliation";

type SubscriptionRow = {
  product: ProductKey;
  businessId: string;
  id: string;
  userId: string;
  planId: string;
  status: string;
  expiresAt: Date | null;
  graceUntil: Date | null;
  cancelledAt: Date | null;
  paymentId: string | null;
  paymentReference: string | null;
};

type EntitlementRow = {
  product: ProductKey;
  businessId: string;
  id: string;
  status: string;
  expiresAt: Date | null;
};

function corePlanProduct(key: string): ProductKey | null {
  const normalized = key.trim().toUpperCase();
  if (normalized === "INTERACTIVE_BUSINESS") return "WEBSITE_STUDIO";
  if (["AI_BUSINESS_FRONT_DESK", "AI_FRONT_DESK_STANDARD", "AI_FRONT_DESK_PRO", "AI_FRONT_DESK_VOICE"].includes(normalized)) return "AI_FRONT_DESK";
  return null;
}

export async function loadProductEntitlementLifecycleReport() {
  const [core, posSubs, autopilotSubs, mjengoSubs, erpProSubs, interactive, ai, posEnts, autopilotEnts, mjengoEnts, erpProEnts] =
    await Promise.all([
      prisma.subscription.findMany({
        select: { id: true, businessId: true, userId: true, planId: true, status: true, expiresAt: true, graceUntil: true, paymentId: true, paymentReference: true, plan: { select: { key: true } } },
      }),
      prisma.posSubscription.findMany({ select: { id: true, businessId: true, userId: true, planId: true, status: true, expiresAt: true, graceUntil: true, cancelledAt: true, paymentId: true, paymentReference: true } }),
      prisma.autopilotSubscription.findMany({ select: { id: true, businessId: true, userId: true, planId: true, status: true, expiresAt: true, graceUntil: true, cancelledAt: true, paymentId: true, paymentReference: true } }),
      prisma.mjengoSubscription.findMany({ select: { id: true, businessId: true, userId: true, planId: true, status: true, expiresAt: true, graceUntil: true, cancelledAt: true, paymentId: true, paymentReference: true } }),
      prisma.erpProSubscription.findMany({ select: { id: true, businessId: true, userId: true, planId: true, status: true, expiresAt: true, graceUntil: true, cancelledAt: true, paymentId: true, paymentReference: true } }),
      prisma.interactiveBusinessEntitlement.findMany({ select: { id: true, businessId: true, status: true, expiresAt: true } }),
      prisma.aIPackageEntitlement.findMany({ select: { id: true, businessId: true, status: true, expiresAt: true } }),
      prisma.posEntitlement.findMany({ select: { id: true, businessId: true, status: true, expiresAt: true } }),
      prisma.autopilotEntitlement.findMany({ select: { id: true, businessId: true, status: true, expiresAt: true } }),
      prisma.mjengoEntitlement.findMany({ select: { id: true, businessId: true, status: true, expiresAt: true } }),
      prisma.erpProEntitlement.findMany({ select: { id: true, businessId: true, status: true, expiresAt: true } }),
    ]);

  const subscriptions: SubscriptionRow[] = [
    ...core.flatMap((row) => {
      const product = corePlanProduct(row.plan.key);
      return product ? [{ product, businessId: row.businessId, id: row.id, userId: row.userId, planId: row.planId, status: row.status, expiresAt: row.expiresAt, graceUntil: row.graceUntil, cancelledAt: null, paymentId: row.paymentId, paymentReference: row.paymentReference }] : [];
    }),
    ...posSubs.map((row) => ({ product: "BUSINESS_POS" as const, businessId: row.businessId, id: row.id, userId: row.userId, planId: row.planId, status: row.status, expiresAt: row.expiresAt, graceUntil: row.graceUntil, cancelledAt: row.cancelledAt, paymentId: row.paymentId, paymentReference: row.paymentReference })),
    ...autopilotSubs.map((row) => ({ product: "AUTOPILOT" as const, businessId: row.businessId, id: row.id, userId: row.userId, planId: row.planId, status: row.status, expiresAt: row.expiresAt, graceUntil: row.graceUntil, cancelledAt: row.cancelledAt, paymentId: row.paymentId, paymentReference: row.paymentReference })),
    ...mjengoSubs.map((row) => ({ product: "MJENGO_OS" as const, businessId: row.businessId, id: row.id, userId: row.userId, planId: row.planId, status: row.status, paymentId: row.paymentId, paymentReference: row.paymentReference })),
    ...erpProSubs.map((row) => ({ product: "ERP_PRO" as const, businessId: row.businessId, id: row.id, userId: row.userId, planId: row.planId, status: row.status, paymentId: row.paymentId, paymentReference: row.paymentReference })),
  ];

  const entitlements: EntitlementRow[] = [
    ...interactive.map((row) => ({ product: "WEBSITE_STUDIO" as const, businessId: row.businessId, id: row.id, status: row.status, expiresAt: row.expiresAt })),
    ...ai.map((row) => ({ product: "AI_FRONT_DESK" as const, businessId: row.businessId, id: row.id, status: row.status, expiresAt: row.expiresAt })),
    ...posEnts.map((row) => ({ product: "BUSINESS_POS" as const, businessId: row.businessId, id: row.id, status: row.status })),
    ...autopilotEnts.map((row) => ({ product: "AUTOPILOT" as const, businessId: row.businessId, id: row.id, status: row.status })),
    ...mjengoEnts.map((row) => ({ product: "MJENGO_OS" as const, businessId: row.businessId, id: row.id, status: row.status })),
    ...erpProEnts.map((row) => ({ product: "ERP_PRO" as const, businessId: row.businessId, id: row.id, status: row.status })),
  ];

  const paymentIds = [...new Set(subscriptions.flatMap((row) => row.paymentId ? [row.paymentId] : []))];
  const payments = paymentIds.length
    ? await prisma.payment.findMany({
        where: { id: { in: paymentIds } },
        select: {
          id: true, status: true, businessId: true, userId: true, planId: true, reference: true, purpose: true,
          environment: true, reconciliationStatus: true, providerSettledAt: true,
          providerSettlementReference: true, settledRefundMinor: true, settledChargebackMinor: true,
        },
      })
    : [];
  type PaymentEvidenceRow = {
    id: string; status: string; businessId: string | null; userId: string | null;
    planId: string | null; reference: string; purpose: string; environment: string;
    reconciliationStatus: string; providerSettledAt: Date | null;
    providerSettlementReference: string | null; settledRefundMinor: bigint | null;
    settledChargebackMinor: bigint | null;
  };
  const paymentById = new Map<string, PaymentEvidenceRow>(
    payments.map((payment) => {
      const row = payment as PaymentEvidenceRow;
      return [row.id, row];
    }),
  );
  const keyOf = (product: ProductKey, businessId: string) => product + ":" + businessId;
  const subByKey = new Map<string, SubscriptionRow[]>();
  const entByKey = new Map<string, EntitlementRow[]>();
  for (const row of subscriptions) {
    const key = keyOf(row.product, row.businessId);
    subByKey.set(key, [...(subByKey.get(key) ?? []), row]);
  }
  for (const row of entitlements) {
    const key = keyOf(row.product, row.businessId);
    entByKey.set(key, [...(entByKey.get(key) ?? []), row]);
  }

  const allKeys = new Set([...subByKey.keys(), ...entByKey.keys()]);
  const evidence: ProductLifecycleEvidence[] = [];
  for (const key of allKeys) {
    const subs = subByKey.get(key) ?? [];
    const ents = entByKey.get(key) ?? [];
    // Preserve duplicates as separate evidence rows so the pure classifier can report them.
    for (const sub of subs.length ? subs : [null]) {
      for (const ent of ents.length ? ents : [null]) {
        const product = (sub?.product ?? ent?.product)!;
        const payment = sub?.paymentId ? paymentById.get(sub.paymentId) : null;
        evidence.push({
          product,
          businessId: sub?.businessId ?? ent!.businessId,
          subscriptionId: sub?.id ?? null,
          subscriptionStatus: sub?.status ?? null,
          subscriptionExpiresAt: sub?.expiresAt ?? null,
          subscriptionGraceUntil: sub?.graceUntil ?? null,
          subscriptionCancelledAt: sub?.cancelledAt ?? null,
          paymentId: sub?.paymentId ?? null,
          paymentStatus: payment?.status ?? null,
          paymentPlanId: payment?.planId ?? null,
          paymentReference: payment?.reference ?? null,
          subscriptionPaymentReference: sub?.paymentReference ?? null,
          paymentPurpose: payment?.purpose ?? null,
          paymentEnvironment: payment?.environment ?? null,
          paymentReconciliationStatus: payment?.reconciliationStatus ?? null,
          providerSettledAt: payment?.providerSettledAt ?? null,
          providerSettlementReference: payment?.providerSettlementReference ?? null,
          settledRefundMinor: payment?.settledRefundMinor ?? null,
          settledChargebackMinor: payment?.settledChargebackMinor ?? null,
          subscriptionPlanId: sub?.planId ?? null,
          paymentBusinessId: payment?.businessId ?? null,
          paymentUserId: payment?.userId ?? null,
          subscriptionUserId: sub?.userId ?? null,
          entitlementId: ent?.id ?? null,
          entitlementStatus: ent?.status ?? null,
          entitlementExpiresAt: ent?.expiresAt ?? null,
          asOf: new Date(),
        });
      }
    }
  }

  return summarizeProductEntitlementLifecycle(evidence, ["BUSINESS_PAGE", "LEGACY_ERP"]);
}
