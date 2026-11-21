/**
 * Read-only product expiry/grace observation adapter.
 * This module only selects existing subscription fields; it never updates entitlements,
 * suspends services, creates audit rows, or changes customer access.
 */
import prisma from "@/lib/db";
import {
  summarizeSubscriptionExpiry,
  type LifecycleExpiryEvidence,
  type LifecycleProduct,
} from "@/lib/admin/product-expiry-grace-observation";

type RawRow = {
  id: string;
  businessId: string;
  status: string;
  expiresAt: Date | null;
  graceUntil: Date | null;
};

function mapRows(product: LifecycleProduct, rows: RawRow[]): LifecycleExpiryEvidence[] {
  return rows.map((row) => ({
    product,
    businessId: row.businessId,
    subscriptionId: row.id,
    status: row.status,
    expiresAt: row.expiresAt,
    graceUntil: row.graceUntil,
  }));
}

export async function loadProductExpiryGraceObservation(now: Date = new Date()) {
  const db = prisma as any;
  const [core, pos, autopilot, mjengo, erpPro] = await Promise.all([
    db.subscription.findMany({
      select: { id: true, businessId: true, status: true, expiresAt: true, graceUntil: true, plan: { select: { key: true } } },
    }),
    db.posSubscription.findMany({ select: { id: true, businessId: true, status: true, expiresAt: true, graceUntil: true } }),
    db.autopilotSubscription.findMany({ select: { id: true, businessId: true, status: true, expiresAt: true, graceUntil: true } }),
    db.mjengoSubscription.findMany({ select: { id: true, businessId: true, status: true, expiresAt: true, graceUntil: true } }),
    db.erpProSubscription.findMany({ select: { id: true, businessId: true, status: true, expiresAt: true, graceUntil: true } }),
  ]);

  const rows: LifecycleExpiryEvidence[] = [
    ...core.flatMap((row: RawRow & { plan: { key: string } }) => {
      const key = row.plan.key.trim().toUpperCase();
      const product: LifecycleProduct | null =
        ["MONTHLY", "ANNUAL"].includes(key) ? "BUSINESS_PAGE" :
        key === "INTERACTIVE_BUSINESS" ? "WEBSITE_STUDIO" :
        ["AI_BUSINESS_FRONT_DESK", "AI_FRONT_DESK_STANDARD", "AI_FRONT_DESK_PRO", "AI_FRONT_DESK_VOICE"].includes(key) ? "AI_FRONT_DESK" : null;
      return product ? mapRows(product, [row]) : [];
    }),
    ...mapRows("BUSINESS_POS", pos),
    ...mapRows("AUTOPILOT", autopilot),
    ...mapRows("MJENGO_OS", mjengo),
    ...mapRows("ERP_PRO", erpPro),
  ];

  return summarizeSubscriptionExpiry(rows, now);
}
