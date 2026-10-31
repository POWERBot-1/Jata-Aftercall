/**
 * Finalized captures are alternative revisions, not accounting adjustments to be summed.
 * A capture freezes the current state of sales created in the period AND the period's settled
 * payment ledger in one repeatable-read transaction. It is not a reconstruction of the state
 * at period end: later corrections must be explicit, reasoned new revisions.
 */
import prisma from "@/lib/db";
import { logPosAuditInTransaction } from "./audit";
import { paymentBreakdown, summarizeSales, type SaleRecord } from "./reports";

const LIMIT = 5000;
export class SnapshotError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export function snapshotPeriod(from: unknown, to: unknown, now = new Date()) {
  const parse = (value: unknown) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
  };
  const start = parse(from); const last = parse(to);
  if (!start || !last || start > last) throw new SnapshotError("INVALID_PERIOD", "Choose a valid start and end date.");
  const end = new Date(last.getTime() + 86_400_000); // exclusive UTC boundary
  if (end > now || end.getTime() - start.getTime() > 366 * 86_400_000) {
    throw new SnapshotError("INVALID_PERIOD", "Choose a completed UTC date range of no more than 366 days.");
  }
  return { start, end };
}

function bounded(rows: any[], label: string) {
  if (rows.length > LIMIT) throw new SnapshotError("TOO_MANY_ROWS", `${label} exceeds the capture limit; choose a shorter period.`);
  return rows;
}

export async function finalizeReportSnapshot(input: {
  businessId: string; branchId: string | null; actorId: string; actorName?: string | null;
  from: unknown; to: unknown; supersedesId?: unknown; reason?: unknown;
}) {
  const { start, end } = snapshotPeriod(input.from, input.to);
  // Credit entries are tenant-wide and do not carry a branch. Until they can be scoped without
  // losing non-sale entries, do not finalize a misleading partial branch reconciliation.
  if (input.branchId) throw new SnapshotError("BRANCH_UNSUPPORTED", "Finalized captures are available for the whole business only.");
  const scopeKey = input.branchId ?? "";
  const supersedesId = typeof input.supersedesId === "string" ? input.supersedesId.trim() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
  if (supersedesId && !reason) throw new SnapshotError("REASON_REQUIRED", "Explain why this capture is being revised.");
  try {
    return await prisma.$transaction(async (tx: any) => {
      const where = { businessId: input.businessId, scopeKey, periodStart: start, periodEnd: end };
      const latest = await tx.posReportSnapshot.findFirst({ where, orderBy: { revision: "desc" } });
      if (latest && latest.id !== supersedesId) throw new SnapshotError("REVISION_CONFLICT", "This period already has a capture. Select its latest revision to create a correction.");
      if (!latest && supersedesId) throw new SnapshotError("REVISION_CONFLICT", "The selected capture is not the latest revision for this period.");
      const scoped = input.branchId ? { branchId: input.branchId } : {};
      const time = { gte: start, lt: end };
      const capturedAt = new Date();
      // take LIMIT+1 and refuse rather than silently finalize an incomplete report.
      const [sales, ledger, expenses, audit, credit, movements] = await Promise.all([
        tx.posSale.findMany({ where: { businessId: input.businessId, ...scoped, createdAt: time }, orderBy: { id: "asc" }, take: LIMIT + 1,
          include: { payments: { select: { id: true, method: true, amountKES: true, direction: true, status: true, purpose: true, createdAt: true } } } }),
        tx.posPayment.findMany({ where: { businessId: input.businessId, ...scoped, status: "SETTLED", createdAt: time }, orderBy: { id: "asc" }, take: LIMIT + 1,
          select: { id: true, saleId: true, customerId: true, supplierId: true, branchId: true, method: true, amountKES: true, direction: true, purpose: true, reference: true, createdAt: true } }),
        tx.posExpense.findMany({ where: { businessId: input.businessId, ...scoped, occurredAt: time }, orderBy: { id: "asc" }, take: LIMIT + 1,
          select: { id: true, branchId: true, categoryKey: true, reference: true, occurredAt: true, createdAt: true, amountKES: true, method: true } }),
        tx.posAuditEvent.findMany({ where: { businessId: input.businessId, ...scoped, action: { in: ["POS_SALE_REFUNDED", "POS_SALE_VOIDED"] }, createdAt: time }, orderBy: { id: "asc" }, take: LIMIT + 1,
          select: { id: true, action: true, targetId: true, createdAt: true, metadata: true } }),
        tx.posCreditEntry.findMany({ where: { businessId: input.businessId, createdAt: time,  }, orderBy: { id: "asc" }, take: LIMIT + 1,
          select: { id: true, partyType: true, partyId: true, saleId: true, paymentId: true, direction: true, amountKES: true, balanceAfterKES: true, createdAt: true } }),
        tx.posInventoryMovement.findMany({ where: { businessId: input.businessId, ...scoped, createdAt: time }, orderBy: { id: "asc" }, take: LIMIT + 1,
          select: { id: true, productId: true, branchId: true, refType: true, refId: true, reason: true, delta: true, unitKey: true, createdAt: true } }),
      ]);
      for (const [label, rows] of Object.entries({ Sales: sales, Payments: ledger, Expenses: expenses, Audits: audit, Credit: credit, Movements: movements })) bounded(rows as any[], label);
      const cohortActions = bounded(await tx.posAuditEvent.findMany({
        where: { businessId: input.businessId, ...scoped, targetType: "SALE", targetId: { in: sales.map((s: any) => s.id) }, action: { in: ["POS_SALE_REFUNDED", "POS_SALE_VOIDED"] } },
        orderBy: { id: "asc" }, take: LIMIT + 1, select: { id: true, action: true, targetId: true, createdAt: true, metadata: true },
      }), "Sale corrections");
      // Prisma's nested relation has no independent take; refuse large captured payment sets too.
      if (sales.reduce((n: number, s: any) => n + s.payments.length, 0) > LIMIT) throw new SnapshotError("TOO_MANY_ROWS", "Sale payments exceed the capture limit; choose a shorter period.");
      const records: SaleRecord[] = sales.map((s: any) => ({ ...s, payments: s.payments.filter((p: any) => p.status === "SETTLED") }));
      const totals = summarizeSales(records);
      const tenders = paymentBreakdown(records);
      const periodMethods: Record<string, { inKES: number; outKES: number }> = {};
      for (const p of ledger) {
        const key = String(p.method).toLowerCase();
        periodMethods[key] ??= { inKES: 0, outKES: 0 };
        if (p.direction === "IN") periodMethods[key].inKES += p.amountKES;
        if (p.direction === "OUT") periodMethods[key].outKES += p.amountKES;
      }
      const cash = periodMethods.cash ?? { inKES: 0, outKES: 0 };
      const payload = JSON.parse(JSON.stringify({
        version: 1, capturedAt, basis: "sale-cohort-at-finalization-and-period-ledger", timezone: "UTC",
        saleBalanceNotice: "Sale balances are original unpaid amounts, not current amounts owed; account-level repayments are not allocated.",
        note: "A finalized capture of current sale-cohort status and period ledger; not an as-of period-end reconstruction. Collected totals include recorded settled sale-linked payments only; completeness of older payment records is unverified. Sale balances are original unpaid amounts; repayments are not allocated and these are not current amounts owed. Revisions replace, never add to, prior captures.",
        saleCohort: { totals, tenders, refundAndVoidEvents: cohortActions, sales: sales.map((s: any) => ({ id: s.id, createdAt: s.createdAt, status: s.status, totalKES: s.totalKES, paidKES: s.paidKES, balanceKES: s.balanceKES, refundedKES: s.refundedKES, creditRefundedKES: s.creditRefundedKES, payments: s.payments })) },
        periodLedger: { methods: periodMethods, cashInKES: cash.inKES, cashOutKES: cash.outKES, cashNetKES: cash.inKES - cash.outKES, payments: ledger, expenses, refundAndVoidEvents: audit, creditEntries: credit, inventoryMovements: movements },
      }));
      const snapshot = await tx.posReportSnapshot.create({ data: { ...where, revision: (latest?.revision ?? 0) + 1, supersedesId: latest?.id ?? null, reason: reason || null, finalizedById: input.actorId, payload } });
      await logPosAuditInTransaction(tx, { businessId: input.businessId, actorId: input.actorId, actorName: input.actorName, branchId: input.branchId,
        action: "POS_REPORT_FINALIZED", targetType: "REPORT_SNAPSHOT", targetId: snapshot.id,
        metadata: { periodStart: start.toISOString(), periodEndExclusive: end.toISOString(), revision: snapshot.revision, supersedesId: snapshot.supersedesId, reason: reason || null } });
      return snapshot;
    }, { isolationLevel: "RepeatableRead", timeout: 30000 });
  } catch (error: any) {
    if (error?.code === "P2002" || error?.code === "P2034") throw new SnapshotError("REVISION_CONFLICT", "This period was finalized concurrently. Reload the captures before retrying.");
    throw error;
  }
}

export async function listReportSnapshots(businessId: string, branchId: string | null) {
  return prisma.posReportSnapshot.findMany({ where: { businessId, scopeKey: branchId ?? "" }, orderBy: [{ periodStart: "desc" }, { revision: "desc" }], take: 100,
    select: { id: true, periodStart: true, periodEnd: true, revision: true, supersedesId: true, reason: true, finalizedAt: true, finalizedById: true } });
}
/** Do not expose unverified balances from older captures; never modify the immutable DB row. */
export function withoutUnverifiedCreditProjection(snapshot: any) {
  const payload = snapshot?.payload;
  const ledger = payload?.periodLedger;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return snapshot;
  const safeLedger = ledger && typeof ledger === "object" && !Array.isArray(ledger) ? { ...ledger } : ledger;
  if (safeLedger) delete safeLedger.creditProjection;
  return { ...snapshot, payload: {
    ...payload,
    ...(safeLedger ? { periodLedger: safeLedger } : {}),
    saleBalanceNotice: "Sale balances are original unpaid amounts, not current amounts owed; account-level repayments are not allocated.",
  } };
}

export async function getReportSnapshot(businessId: string, branchId: string | null, id: string) {
  const snapshot = await prisma.posReportSnapshot.findFirst({ where: { businessId, scopeKey: branchId ?? "", id } });
  return snapshot ? withoutUnverifiedCreditProjection(snapshot) : null;
}
