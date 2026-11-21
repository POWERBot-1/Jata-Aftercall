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
  status: string;
  paymentId: string | null;
};

type EntitlementRow = {
  product: ProductKey;
  businessId: string;
  id: string;
  status: string;
};

function corePlanProduct(key: string): ProductKey | null {
  const normalized = key.trim().toUpperCase();
  if (["BUSINESS_PAGE", "BUSINESS_PAGE_MONTHLY", "BUSINESS_PAGE_ANNUAL"].includes(normalized)) return "BUSINESS_PAGE";
  if (["AI_FRONT_DESK", "AI_BUSINESS_FRONT_DESK", "AI_FRONT_DESK_MONTHLY"].includes(normalized)) return "AI_FRONT_DESK";
  // Website Studio intentionally remains excluded until its own subscription/entitlement
  // provenance is confirmed from its dedicated workspace and billing schema.
  return null;
}

export async function loadProductEntitlementLifecycleReport() {
  const [core, posSubs, autopilotSubs, mjengoSubs, erpProSubs, interactive, ai, posEnts, autopilotEnts, mjengoEnts, erpProEnts] =
    await Promise.all([
      prisma.subscription.findMany({
        select: { id: true, businessId: true, userId: true, status: true, paymentId: true, plan: { select: { key: true } } },
      }),
      prisma.posSubscription.findMany({ select: { id: true, businessId: true, userId: true, status: true, paymentId: true } }),
      prisma.autopilotSubscription.findMany({ select: { id: true, businessId: true, userId: true, status: true, paymentId: true } }),
      prisma.mjengoSubscription.findMany({ select: { id: true, businessId: true, userId: true, status: true, paymentId: true } }),
      prisma.erpProSubscription.findMany({ select: { id: true, businessId: true, userId: true, status: true, paymentId: true } }),
      prisma.interactiveBusinessEntitlement.findMany({ select: { id: true, businessId: true, status: true } }),
      prisma.aIPackageEntitlement.findMany({ select: { id: true, businessId: true, status: true } }),
      prisma.posEntitlement.findMany({ select: { id: true, businessId: true, status: true } }),
      prisma.autopilotEntitlement.findMany({ select: { id: true, businessId: true, status: true } }),
      prisma.mjengoEntitlement.findMany({ select: { id: true, businessId: true, status: true } }),
      prisma.erpProEntitlement.findMany({ select: { id: true, businessId: true, status: true } }),
    ]);

  const subscriptions: SubscriptionRow[] = [
    ...core.flatMap((row) => {
      const product = corePlanProduct(row.plan.key);
      return product ? [{ product, businessId: row.businessId, id: row.id, userId: row.userId, status: row.status, paymentId: row.paymentId }] : [];
    }),
    ...posSubs.map((row) => ({ product: "BUSINESS_POS" as const, businessId: row.businessId, id: row.id, userId: row.userId, status: row.status, paymentId: row.paymentId })),
    ...autopilotSubs.map((row) => ({ product: "AUTOPILOT" as const, businessId: row.businessId, id: row.id, userId: row.userId, status: row.status, paymentId: row.paymentId })),
    ...mjengoSubs.map((row) => ({ product: "MJENGO_OS" as const, businessId: row.businessId, id: row.id, userId: row.userId, status: row.status, paymentId: row.paymentId })),
    ...erpProSubs.map((row) => ({ product: "ERP_PRO" as const, businessId: row.businessId, id: row.id, userId: row.userId, status: row.status, paymentId: row.paymentId })),
  ];

  const entitlements: EntitlementRow[] = [
    ...interactive.map((row) => ({ product: "BUSINESS_PAGE" as const, businessId: row.businessId, id: row.id, status: row.status })),
    ...ai.map((row) => ({ product: "AI_FRONT_DESK" as const, businessId: row.businessId, id: row.id, status: row.status })),
    ...posEnts.map((row) => ({ product: "BUSINESS_POS" as const, businessId: row.businessId, id: row.id, status: row.status })),
    ...autopilotEnts.map((row) => ({ product: "AUTOPILOT" as const, businessId: row.businessId, id: row.id, status: row.status })),
    ...mjengoEnts.map((row) => ({ product: "MJENGO_OS" as const, businessId: row.businessId, id: row.id, status: row.status })),
    ...erpProEnts.map((row) => ({ product: "ERP_PRO" as const, businessId: row.businessId, id: row.id, status: row.status })),
  ];

  const paymentIds = [...new Set(subscriptions.flatMap((row) => row.paymentId ? [row.paymentId] : []))];
  const payments = paymentIds.length
    ? await prisma.payment.findMany({
        where: { id: { in: paymentIds } },
        select: { id: true, status: true, businessId: true, userId: true },
      })
    : [];
  const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
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
          paymentId: sub?.paymentId ?? null,
          paymentStatus: payment?.status ?? null,
          paymentBusinessId: payment?.businessId ?? null,
          paymentUserId: payment?.userId ?? null,
          subscriptionUserId: sub?.userId ?? null,
          entitlementId: ent?.id ?? null,
          entitlementStatus: ent?.status ?? null,
        });
      }
    }
  }

  return summarizeProductEntitlementLifecycle(evidence, ["WEBSITE_STUDIO", "LEGACY_ERP"]);
}
