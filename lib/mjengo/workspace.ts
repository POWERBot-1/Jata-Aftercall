/**
 * MJENGO OS workspace data loaders.
 *
 * Every read here is tenant-scoped by `businessId` and returns only what the workspace renders:
 * counts and short lists that the underlying module already owns. Nothing is synthesised — an
 * unavailable model (offline build, module not deployed) returns an empty list, never an invented
 * number, and a payroll figure is never computed because no payroll ledger exists in this
 * codebase (see WORKFORCE below).
 *
 * The gate is applied by `requireMjengoAccess` in the page, before any loader runs. Loaders
 * therefore take the already-authorized businessId and never accept a client-supplied scope.
 */
import prisma from "@/lib/db";

export type MjengoCount = { label: string; value: number | null; note?: string };

const safe = async <T,>(run: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await run();
  } catch {
    return fallback;
  }
};

const model = (name: string): any => (prisma as any)?.[name];

/** Sales & orders — real POS sales plus storefront/Order rows for the same tenant. */
export async function loadSalesOverview(businessId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [sales, orders] = await Promise.all([
    safe(
      async () =>
        model("posSale")
          ? await model("posSale").findMany({
              where: { businessId, createdAt: { gte: since } },
              select: { id: true, receiptNumber: true, totalKES: true, paidKES: true, balanceKES: true, status: true, createdAt: true },
              orderBy: { createdAt: "desc" },
              take: 25,
            })
          : [],
      [] as any[],
    ),
    safe(
      async () =>
        model("order")
          ? await model("order").findMany({
              where: { businessId },
              select: { id: true, orderReference: true, status: true, totalKES: true, createdAt: true },
              orderBy: { createdAt: "desc" },
              take: 25,
            })
          : [],
      [] as any[],
    ),
  ]);
  const revenueKES = sales.reduce((sum: number, sale: any) => sum + (Number(sale.totalKES) || 0), 0);
  const outstandingKES = sales.reduce((sum: number, sale: any) => sum + (Number(sale.balanceKES) || 0), 0);
  return { sales, orders, revenueKES, outstandingKES, since };
}

/** Inventory — stock on hand, what is at or below its reorder level, and nothing else. */
export async function loadInventoryOverview(businessId: string) {
  const [items, products] = await Promise.all([
    safe(
      async () =>
        model("posInventoryItem")
          ? await model("posInventoryItem").findMany({
              where: { businessId },
              select: { productId: true, branchId: true, quantity: true, reorderLevel: true },
            })
          : [],
      [] as any[],
    ),
    safe(
      async () =>
        model("posProduct")
          ? await model("posProduct").findMany({
              where: { businessId, isActive: true },
              select: { id: true, name: true, unitKey: true, trackInventory: true, reorderLevel: true },
              orderBy: { name: "asc" },
              take: 200,
            })
          : [],
      [] as any[],
    ),
  ]);

  const names = new Map<string, any>(products.map((product: any) => [product.id, product]));
  // One row per product: the workspace shows total on hand, not a row per location.
  const byProduct = new Map<string, { productId: string; name: string; unitKey: string; quantity: number; reorderLevel: number }>();
  for (const item of items) {
    const product = names.get(item.productId);
    const current = byProduct.get(item.productId) ?? {
      productId: item.productId,
      name: product?.name ?? item.productId,
      unitKey: product?.unitKey ?? "piece",
      quantity: 0,
      reorderLevel: Number(item.reorderLevel ?? product?.reorderLevel ?? 0),
    };
    current.quantity += Number(item.quantity) || 0;
    byProduct.set(item.productId, current);
  }
  for (const product of products) {
    if (product.trackInventory === false || byProduct.has(product.id)) continue;
    byProduct.set(product.id, {
      productId: product.id,
      name: product.name,
      unitKey: product.unitKey ?? "piece",
      quantity: 0,
      reorderLevel: Number(product.reorderLevel ?? 0),
    });
  }
  const stock = [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name));
  const low = stock.filter((line) => line.reorderLevel > 0 && line.quantity <= line.reorderLevel);
  return { stock, low, tracked: products.filter((product: any) => product.trackInventory !== false).length };
}

/** Procurement — suppliers, purchase orders awaiting receipt, requisitions awaiting a decision. */
export async function loadProcurementOverview(businessId: string) {
  const [suppliers, purchaseOrders, requisitions] = await Promise.all([
    safe(
      async () =>
        model("posSupplier")
          ? await model("posSupplier").findMany({
              where: { businessId, isActive: true },
              select: { id: true, name: true, balanceKES: true, termsDays: true },
              orderBy: { name: "asc" },
              take: 100,
            })
          : [],
      [] as any[],
    ),
    safe(
      async () =>
        model("erpPurchaseOrder")
          ? await model("erpPurchaseOrder").findMany({
              where: { businessId, status: { in: ["ORDERED", "PARTIALLY_RECEIVED", "APPROVED", "AWAITING_APPROVAL"] } },
              select: { id: true, orderNumber: true, supplierName: true, status: true, totalCents: true, expectedAt: true },
              orderBy: { createdAt: "desc" },
              take: 50,
            })
          : [],
      [] as any[],
    ),
    safe(
      async () =>
        model("erpRequisition")
          ? await model("erpRequisition").findMany({
              where: { businessId, status: { in: ["SUBMITTED", "DRAFT"] } },
              select: { id: true, requisitionNumber: true, status: true, totalCents: true, createdAt: true },
              orderBy: { createdAt: "desc" },
              take: 50,
            })
          : [],
      [] as any[],
    ),
  ]);
  const payableKES = suppliers.reduce((sum: number, supplier: any) => sum + (Number(supplier.balanceKES) || 0), 0);
  return { suppliers, purchaseOrders, requisitions, payableKES };
}

/** Customers & credit — receivable balances from the POS credit ledger, plus ERP invoice ageing. */
export async function loadCustomerCreditOverview(businessId: string) {
  const [customers, invoices] = await Promise.all([
    safe(
      async () =>
        model("posCustomer")
          ? await model("posCustomer").findMany({
              where: { businessId, isActive: true },
              select: { id: true, name: true, phone: true, balanceKES: true, creditLimitKES: true, creditEnabled: true },
              orderBy: { balanceKES: "desc" },
              take: 100,
            })
          : [],
      [] as any[],
    ),
    safe(
      async () =>
        model("erpInvoice")
          ? await model("erpInvoice").findMany({
              where: { businessId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
              select: { id: true, invoiceNumber: true, customerName: true, totalCents: true, paidCents: true, dueAt: true },
              orderBy: { dueAt: "asc" },
              take: 100,
            })
          : [],
      [] as any[],
    ),
  ]);
  const receivableKES = customers.reduce((sum: number, customer: any) => sum + Math.max(0, Number(customer.balanceKES) || 0), 0);
  const overdueInvoices = invoices.filter((invoice: any) => invoice.dueAt && new Date(invoice.dueAt).getTime() < Date.now());
  return { customers, invoices, overdueInvoices, receivableKES };
}

/** Accounting — the ledger the accounting module owns, plus its integrity state. */
export async function loadAccountingOverview(businessId: string) {
  const [journals, periods] = await Promise.all([
    safe(
      async () =>
        model("erpJournal")
          ? await model("erpJournal").findMany({
              where: { businessId },
              select: { id: true, journalNumber: true, entryDate: true, description: true, status: true, sourceType: true },
              orderBy: { entryDate: "desc" },
              take: 50,
            })
          : [],
      [] as any[],
    ),
    safe(
      async () =>
        model("erpPeriod")
          ? await model("erpPeriod").findMany({
              where: { businessId },
              select: { id: true, fiscalYear: true, month: true, status: true },
              orderBy: [{ fiscalYear: "desc" }, { month: "desc" }],
              take: 6,
            })
          : [],
      [] as any[],
    ),
  ]);
  // The integrity view is created by the ledger_immutability migration. If the database has not
  // been migrated, this read fails and the page must say "not available", not "healthy".
  let integrity: { available: boolean; anomalies: number } = { available: false, anomalies: 0 };
  try {
    const rows: any[] = await (prisma as any).$queryRawUnsafe(
      'SELECT COUNT(*)::int AS "anomalies" FROM "ErpJournalIntegrity" WHERE "businessId" = $1 AND ("balanced" = false OR "empty" = true)',
      businessId,
    );
    integrity = { available: true, anomalies: Number(rows?.[0]?.anomalies ?? 0) };
  } catch {
    integrity = { available: false, anomalies: 0 };
  }
  return { journals, periods, integrity };
}

/**
 * Workforce.
 *
 * There is no payroll ledger in this codebase: `PosStaff` stores staff identity, role and branch,
 * and no salary, deduction, payslip or statutory-remittance table exists. The workspace therefore
 * reports staff and absence-of-payroll honestly instead of computing a wage figure. Payroll is
 * labelled BLOCKED in the report, not simulated.
 */
export async function loadWorkforceOverview(businessId: string) {
  const staff = await safe(
    async () =>
      model("posStaff")
        ? await model("posStaff").findMany({
            where: { businessId },
            select: { id: true, name: true, role: true, isActive: true, branchId: true },
            orderBy: { name: "asc" },
            take: 100,
          })
        : [],
    [] as any[],
  );
  return {
    staff,
    payroll: { available: false as const, reason: "No payroll, payslip or statutory-remittance ledger exists in this deployment." },
  };
}

/** Reports — aggregates already computed by the module owners, not new business logic. */
export async function loadReportsOverview(businessId: string) {
  const [sales, inventory, credit, accounting] = await Promise.all([
    loadSalesOverview(businessId),
    loadInventoryOverview(businessId),
    loadCustomerCreditOverview(businessId),
    loadAccountingOverview(businessId),
  ]);
  return {
    revenueKES: sales.revenueKES,
    outstandingKES: sales.outstandingKES,
    inventoryTracked: inventory.tracked,
    lowStock: inventory.low.length,
    receivableKES: credit.receivableKES,
    journals: accounting.journals.length,
    integrity: accounting.integrity,
  };
}
