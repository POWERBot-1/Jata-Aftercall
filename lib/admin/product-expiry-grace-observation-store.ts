/**
 * Bounded, read-only product expiry/grace inventory.
 * Every model is keyset-paginated independently; callers resume with opaque cursors.
 * No database writes or customer-access decisions occur here.
 */
import prisma from "@/lib/db";
import {
  summarizeSubscriptionExpiry,
  type LifecycleExpiryEvidence,
  type LifecycleProduct,
} from "@/lib/admin/product-expiry-grace-observation";

export type LifecycleInventoryCursors = Partial<Record<"core" | "pos" | "autopilot" | "mjengo" | "erpPro", string>>;
type RawRow = { id: string; businessId: string; status: string; expiresAt: Date | null; graceUntil: Date | null };
type Page<T> = { rows: T[]; nextCursor?: string };

async function page<T extends { id: string }>(
  delegate: { findMany(args: unknown): Promise<T[]> },
  cursor: string | undefined,
  limit: number,
  select: Record<string, unknown>,
): Promise<Page<T>> {
  const rows = await delegate.findMany({
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { id: "asc" },
    take: limit + 1,
    select,
  });
  return { rows: rows.slice(0, limit), ...(rows.length > limit ? { nextCursor: rows[limit - 1].id } : {}) };
}

function mapRows(product: LifecycleProduct, rows: RawRow[]): LifecycleExpiryEvidence[] {
  return rows.map((row) => ({
    product, businessId: row.businessId, subscriptionId: row.id, status: row.status,
    expiresAt: row.expiresAt, graceUntil: row.graceUntil,
  }));
}

export async function loadProductExpiryGraceObservation(input: {
  now?: Date; limit?: number; cursors?: LifecycleInventoryCursors;
} = {}) {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 50)));
  const cursors = input.cursors ?? {};
  const db = prisma as any;

  const [core, pos, autopilot, mjengo, erpPro] = await Promise.all([
    page<RawRow & { plan: { key: string } }>(db.subscription, cursors.core, limit, {
      id: true, businessId: true, status: true, expiresAt: true, graceUntil: true,
      plan: { select: { key: true } },
    }),
    page<RawRow>(db.posSubscription, cursors.pos, limit, { id: true, businessId: true, status: true, expiresAt: true, graceUntil: true }),
    page<RawRow>(db.autopilotSubscription, cursors.autopilot, limit, { id: true, businessId: true, status: true, expiresAt: true, graceUntil: true }),
    page<RawRow>(db.mjengoSubscription, cursors.mjengo, limit, { id: true, businessId: true, status: true, expiresAt: true, graceUntil: true }),
    page<RawRow>(db.erpProSubscription, cursors.erpPro, limit, { id: true, businessId: true, status: true, expiresAt: true, graceUntil: true }),
  ]);

  const rows: LifecycleExpiryEvidence[] = [
    ...core.rows.flatMap((row: RawRow & { plan: { key: string } }) => {
      const key = row.plan.key.trim().toUpperCase();
      const product: LifecycleProduct | null =
        ["MONTHLY", "ANNUAL"].includes(key) ? "BUSINESS_PAGE" :
        key === "INTERACTIVE_BUSINESS" ? "WEBSITE_STUDIO" :
        ["AI_BUSINESS_FRONT_DESK", "AI_FRONT_DESK_STANDARD", "AI_FRONT_DESK_PRO", "AI_FRONT_DESK_VOICE"].includes(key) ? "AI_FRONT_DESK" : null;
      return product ? mapRows(product, [row]) : [];
    }),
    ...mapRows("BUSINESS_POS", pos.rows),
    ...mapRows("AUTOPILOT", autopilot.rows),
    ...mapRows("MJENGO_OS", mjengo.rows),
    ...mapRows("ERP_PRO", erpPro.rows),
  ];

  const nextCursors: LifecycleInventoryCursors = {
    ...(core.nextCursor ? { core: core.nextCursor } : {}),
    ...(pos.nextCursor ? { pos: pos.nextCursor } : {}),
    ...(autopilot.nextCursor ? { autopilot: autopilot.nextCursor } : {}),
    ...(mjengo.nextCursor ? { mjengo: mjengo.nextCursor } : {}),
    ...(erpPro.nextCursor ? { erpPro: erpPro.nextCursor } : {}),
  };
  return {
    ...summarizeSubscriptionExpiry(rows, now),
    pageSizePerProductTable: limit,
    nextCursors,
    complete: Object.keys(nextCursors).length === 0,
  };
}
