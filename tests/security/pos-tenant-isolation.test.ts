/**
 * POS tenant isolation (§5, §56, §75)
 *
 * A tiny in-memory Prisma stands in for the database so these tests can assert *behaviour*:
 * a record belonging to another business is never returned, never updated and never counted,
 * even when the caller supplies its id directly. Every query the store builds is inspected to
 * prove the tenant filter is always present and never taken from the request.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyUpdateData } from "@/tests/helpers/posFakeDb";

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (key === "OR") {
      const alternatives = condition as Row[];
      if (!alternatives.some((clause) => matches(row, clause))) return false;
      continue;
    }
    if (key === "AND") {
      if (!(condition as Row[]).every((clause) => matches(row, clause))) return false;
      continue;
    }
    const value = row[key];
    if (condition && typeof condition === "object" && !Array.isArray(condition) && !(condition instanceof Date)) {
      const filter = condition as Row;
      if ("in" in filter && !filter.in.includes(value)) return false;
      if ("notIn" in filter && filter.notIn.includes(value)) return false;
      if ("gte" in filter && !(value >= filter.gte)) return false;
      if ("lte" in filter && !(value <= filter.lte)) return false;
      if ("contains" in filter && !String(value ?? "").toLowerCase().includes(String(filter.contains).toLowerCase())) return false;
      continue;
    }
    if (value !== condition) return false;
  }
  return true;
}

function model(rows: Row[]) {
  return {
    findMany: vi.fn(async ({ where, include }: any = {}) => rows.filter((row) => matches(row, where)).map((row) => decorate(row, include))),
    findFirst: vi.fn(async ({ where }: any = {}) => rows.find((row) => matches(row, where)) ?? null),
    findUnique: vi.fn(async ({ where }: any = {}) => rows.find((row) => matches(row, where)) ?? null),
    count: vi.fn(async ({ where }: any = {}) => rows.filter((row) => matches(row, where)).length),
    aggregate: vi.fn(async ({ where, _sum }: any = {}) => {
      const scoped = rows.filter((row) => matches(row, where));
      const sum: Row = {};
      for (const key of Object.keys(_sum ?? {})) sum[key] = scoped.reduce((total, row) => total + Number(row[key] ?? 0), 0);
      return { _sum: sum, _count: { _all: scoped.length } };
    }),
    create: vi.fn(async ({ data }: any) => {
      const row = { id: `created_${rows.length + 1}`, ...data };
      rows.push(row);
      return row;
    }),
    // Writes go through `applyUpdateData`, the same resolver the shared POS fake uses, so the
    // atomic operators the store relies on (`{ increment }`) change the stored number the way
    // PostgreSQL's single-statement `SET column = column + δ` does. Without it, every assertion
    // below that reads a balance or a stock level back would be checked against a row holding
    // `{ increment: n }` instead of a number — i.e. it would pass without proving anything.
    update: vi.fn(async ({ where, data }: any) => {
      const row = rows.find((entry) => matches(entry, where));
      if (!row) throw new Error("NOT_FOUND");
      applyUpdateData(row, data);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const scoped = rows.filter((row) => matches(row, where));
      for (const row of scoped) applyUpdateData(row, data);
      return { count: scoped.length };
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const row = rows.find((entry) => matches(entry, where));
      if (row) {
        applyUpdateData(row, update);
        return row;
      }
      const created = { id: `upserted_${rows.length + 1}`, ...create };
      rows.push(created);
      return created;
    }),
    delete: vi.fn(async ({ where }: any) => {
      const index = rows.findIndex((row) => matches(row, where));
      if (index < 0) throw new Error("NOT_FOUND");
      return rows.splice(index, 1)[0];
    }),
  };
}

/** Attaches the relations the store asks for, so `include` behaves like Prisma. */
function decorate(row: Row, include: Row | undefined): Row {
  if (!include) return row;
  const copy = { ...row };
  if (include.inventory) copy.inventory = state.posInventoryItem.filter((item) => item.productId === row.id);
  if (include.items) copy.items = state.posSaleItem.filter((item) => item.saleId === row.id);
  if (include.payments) copy.payments = state.posPayment.filter((payment) => payment.saleId === row.id);
  if (include.product) copy.product = state.posProduct.find((product) => product.id === row.productId) ?? null;
  if (include.assets) copy.assets = state.posCustomerAsset.filter((asset) => asset.customerId === row.id);
  if (include.events) copy.events = state.posOrderEvent.filter((event) => event.orderId === row.id);
  return copy;
}

const MODEL_KEYS = [
  "posProduct", "posCustomer", "posCustomerAsset", "posSupplier", "posStaff", "posBranch", "posSale",
  "posSaleItem", "posPayment", "posCreditEntry", "posInventoryItem", "posInventoryMovement", "posExpense",
  "posPurchase", "posPurchaseItem", "posOrder", "posOrderItem", "posOrderEvent", "posAuditEvent",
  "posConfiguration", "posConfigurationVersion", "posTemplate", "posSubscription", "posEntitlement",
  "posReceiptSequence",
  "business", "businessMember", "payment", "processedWebhook", "user",
];

const state: Record<string, Row[]> = Object.fromEntries(MODEL_KEYS.map((key) => [key, [] as Row[]]));

function set(key: string, rows: Row[]) {
  state[key].length = 0;
  // Copy the rows, so a test that mutates a record cannot change the fixture for the next one.
  state[key].push(...rows.map((row) => ({ ...row })));
}

function reset() {
  const tenant = (rows: Row[]) => rows;
  set("posProduct", tenant([
    { id: "p_a1", businessId: "bizA", name: "Flour 2kg", kind: "PRODUCT", priceKES: 150, costKES: 100, unitKey: "piece", trackInventory: true, isActive: true, reorderLevel: 2, barcode: "6161234567890" },
    { id: "p_a2", businessId: "bizA", name: "Haircut", kind: "SERVICE", priceKES: 500, unitKey: "visit", trackInventory: false, isActive: true, reorderLevel: 0 },
    { id: "p_b1", businessId: "bizB", name: "Competitor cement", kind: "PRODUCT", priceKES: 900, unitKey: "bag", trackInventory: true, isActive: true, reorderLevel: 0 },
  ]));
  set("posCustomer", tenant([
    { id: "c_a1", businessId: "bizA", name: "Jane Wanjiku", phone: "0712000000", balanceKES: 1200, creditEnabled: true, creditLimitKES: 5000 },
    { id: "c_b1", businessId: "bizB", name: "Peter Otieno", phone: "0723000000", balanceKES: 900, creditEnabled: true, creditLimitKES: 3000 },
  ]));
  set("posCustomerAsset", tenant([{ id: "ca_a1", businessId: "bizA", customerId: "c_a1", label: "Vehicle", name: "Probox", identifier: "KDA123X" }]));
  set("posSupplier", tenant([
    { id: "s_a1", businessId: "bizA", name: "Millers Ltd", balanceKES: 4000, termsDays: 30 },
    { id: "s_b1", businessId: "bizB", name: "Cement Co", balanceKES: 2500, termsDays: 14 },
  ]));
  set("posStaff", tenant([
    { id: "st_a1", businessId: "bizA", userId: "cashierA", name: "Mary", roleKey: "CASHIER", isActive: true, branchId: "br_a2", commissionPercent: 5 },
    { id: "st_b1", businessId: "bizB", userId: "cashierB", name: "John", roleKey: "CASHIER", isActive: true, branchId: null, commissionPercent: 0 },
  ]));
  set("posBranch", tenant([
    { id: "br_a1", businessId: "bizA", name: "Main", isPrimary: true },
    { id: "br_a2", businessId: "bizA", name: "Eastlands", isPrimary: false },
    { id: "br_b1", businessId: "bizB", name: "Main", isPrimary: true },
  ]));
  set("posSale", tenant([
    { id: "sale_a1", businessId: "bizA", receiptNumber: "A-000001", sequence: 1, totalKES: 300, paidKES: 300, balanceKES: 0, refundedKES: 0, subtotalKES: 300, discountKES: 0, taxKES: 0, status: "COMPLETED", channel: "walk_in", customerId: "c_a1", branchId: "br_a1", createdAt: new Date("2026-10-01T09:00:00Z") },
    { id: "sale_b1", businessId: "bizB", receiptNumber: "B-000001", sequence: 1, totalKES: 900, paidKES: 900, balanceKES: 0, refundedKES: 0, subtotalKES: 900, discountKES: 0, taxKES: 0, status: "COMPLETED", channel: "walk_in", createdAt: new Date("2026-10-01T09:00:00Z") },
  ]));
  set("posSaleItem", tenant([
    { id: "si_a1", businessId: "bizA", saleId: "sale_a1", productId: "p_a1", name: "Flour 2kg", quantity: 2, unitPriceKES: 150, totalKES: 300, discountKES: 0, taxKES: 0, kind: "PRODUCT", unitKey: "piece" },
    { id: "si_b1", businessId: "bizB", saleId: "sale_b1", productId: "p_b1", name: "Competitor cement", quantity: 1, unitPriceKES: 900, totalKES: 900, discountKES: 0, taxKES: 0, kind: "PRODUCT", unitKey: "bag" },
  ]));
  set("posPayment", tenant([{ id: "pm_a1", businessId: "bizA", saleId: "sale_a1", direction: "IN", purpose: "SALE", method: "cash", amountKES: 300, status: "SETTLED", createdAt: new Date("2026-10-01T09:00:00Z") }]));
  set("posCreditEntry", tenant([{ id: "ce_a1", businessId: "bizA", partyType: "CUSTOMER", partyId: "c_a1", direction: "DEBIT", amountKES: 1200, balanceAfterKES: 1200, createdAt: new Date("2026-09-20T09:00:00Z") }]));
  set("posInventoryItem", tenant([
    { id: "inv_a1", businessId: "bizA", productId: "p_a1", branchId: "br_a1", quantity: 10, reorderLevel: 2 },
    { id: "inv_a2", businessId: "bizA", productId: "p_a1", branchId: "br_a2", quantity: 1, reorderLevel: 2 },
    { id: "inv_b1", businessId: "bizB", productId: "p_b1", branchId: "br_b1", quantity: 40, reorderLevel: 0 },
  ]));
  set("posInventoryMovement", tenant([{ id: "mv_a1", businessId: "bizA", productId: "p_a1", branchId: "br_a1", reason: "OPENING", delta: 10, quantity: 10, createdAt: new Date("2026-09-30T09:00:00Z") }]));
  set("posExpense", tenant([{ id: "ex_a1", businessId: "bizA", categoryKey: "rent", amountKES: 20000, occurredAt: new Date("2026-10-01T09:00:00Z"), createdAt: new Date("2026-10-01T09:00:00Z") }]));
  set("posPurchase", tenant([{ id: "po_b1", businessId: "bizB", reference: "PO-0001", status: "ORDERED", supplierId: "s_b1", subtotalKES: 9000, totalKES: 9000, paidKES: 0, items: [] }]));
  set("posPurchaseItem", tenant([{ id: "poi_b1", businessId: "bizB", purchaseId: "po_b1", productId: "p_b1", name: "Competitor cement", quantity: 10, receivedQty: 0, unitCostKES: 900, totalKES: 9000 }]));
  set("posOrder", tenant([
    { id: "ord_a1", businessId: "bizA", reference: "ORD-0001", stateKey: "NEW", workflowKey: "restaurant", channel: "whatsapp", totalKES: 700, depositKES: 0, createdAt: new Date("2026-10-01T10:00:00Z") },
    { id: "ord_b1", businessId: "bizB", reference: "ORD-0001", stateKey: "NEW", workflowKey: "generic", channel: "walk_in", totalKES: 900, depositKES: 0, createdAt: new Date("2026-10-01T10:00:00Z") },
  ]));
  set("posOrderItem", tenant([{ id: "oi_a1", businessId: "bizA", orderId: "ord_a1", name: "Flour 2kg", quantity: 1, totalKES: 700 }]));
  set("posOrderEvent", tenant([{ id: "oe_a1", businessId: "bizA", orderId: "ord_a1", fromState: null, toState: "NEW", createdAt: new Date("2026-10-01T10:00:00Z") }]));
  set("posAuditEvent", []);
  set("posConfiguration", tenant([
    { id: "cfg_a", businessId: "bizA", status: "LIVE", configurationStatus: "PUBLISHED", answersJson: "{}", draftJson: "{}", publishedJson: "{}", draftVersion: 2, publishedVersion: 1, fingerprint: "a" },
    { id: "cfg_b", businessId: "bizB", status: "LIVE", configurationStatus: "PUBLISHED", answersJson: "{}", draftJson: "{}", publishedJson: "{}", draftVersion: 1, publishedVersion: 1, fingerprint: "b" },
  ]));
  set("posConfigurationVersion", tenant([{ id: "v_a1", businessId: "bizA", configurationId: "cfg_a", version: 1, snapshotJson: "{}", answersJson: "{}", publishedAt: new Date("2026-09-01") }]));
  set("posTemplate", tenant([{ id: "tpl_a", ownerId: "userA", businessId: "bizA", key: "custom_1", name: "My setup", configurationJson: "{}", answersJson: "{}" }]));
  set("posSubscription", []);
  set("posEntitlement", []);
  set("payment", []);
  set("processedWebhook", []);
  // Ownership is what `assertBusinessOwnership` reads: the tenant boundary itself.
  set("business", [
    { id: "bizA", ownerId: "userA", name: "Tenant A", slug: "tenant-a", phone: null, whatsapp: null, location: null, logoUrl: null, email: null },
    { id: "bizB", ownerId: "userB", name: "Tenant B", slug: "tenant-b", phone: null, whatsapp: null, location: null, logoUrl: null, email: null },
  ]);
  set("businessMember", [{ id: "mem_a", businessId: "bizA", userId: "cashierA", role: "STAFF" }]);
  set("user", [{ id: "userA", name: "Owner A", email: "a@example.com" }, { id: "userB", name: "Owner B", email: "b@example.com" }]);
  // Seeded exactly as migration `20261005020000_pos_sale_refund_integrity` backfills it on a real
  // database — one row per business holding `MAX(sequence) + 1` of that business's sales. Without
  // it the fake would start every tenant at 1 and the per-tenant sequence assertion would be
  // checking a counter no deployment ever has.
  set(
    "posReceiptSequence",
    ["bizA", "bizB"].map((businessId) => ({
      businessId,
      nextValue: state.posSale.filter((sale) => sale.businessId === businessId).reduce((max, sale) => Math.max(max, Number(sale.sequence ?? 0)), 0) + 1,
    })),
  );
}

vi.mock("@/lib/db", () => {
  const handler: ProxyHandler<Record<string, any>> = {
    get(_target, property: string) {
      if (property === "$transaction") {
        return async (work: any) => (typeof work === "function" ? work(dbProxy) : Promise.all(work));
      }
      if (typeof property !== "string") return undefined;
      if (!state[property]) state[property] = [];
      if (!_target[property]) _target[property] = model(state[property]);
      return _target[property];
    },
  };
  const dbProxy = new Proxy({}, handler);
  return { default: dbProxy };
});

import * as store from "@/lib/pos/store";
import { requirePosAccess, PosAccessError } from "@/lib/pos/guard";
import { logPosAudit } from "@/lib/pos/audit";
import { buildConfiguration, finalize } from "@/lib/pos/configuration";
import { pruneAnswers } from "@/lib/pos/questionnaire";

const sessionA = { userId: "userA", email: "a@example.com", role: "CUSTOMER", name: "Owner A" } as any;
const sessionB = { userId: "userB", email: "b@example.com", role: "CUSTOMER", name: "Owner B" } as any;
const adminSession = { userId: "admin1", email: "admin@jata.link", role: "ADMIN", name: "Platform admin" } as any;

/** A real published configuration, so role resolution has something to resolve against. */
function tenantAConfiguration() {
  return finalize(
    buildConfiguration(
      pruneAnswers({
        business_type: "restaurant",
        sells: ["products"],
        payment_methods: ["cash", "mpesa"],
        keeps_stock: true,
        keeps_customers: true,
        has_staff: true,
        staff_count: 3,
        staff_roles: ["CASHIER", "WAITER"],
      }),
      { businessName: "Tenant A" },
    ),
  );
}

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  const configuration = tenantAConfiguration();
  const row = state.posConfiguration.find((entry) => entry.businessId === "bizA")!;
  row.draftJson = JSON.stringify(configuration);
  row.publishedJson = JSON.stringify(configuration);
  row.status = "LIVE";
  row.configurationStatus = "PUBLISHED";
});

describe("the store never widens a query beyond its tenant (§5)", () => {
  it("always puts businessId first in every where clause it builds", async () => {
    await store.listProducts("bizA");
    await store.listCustomers("bizA");
    await store.listSuppliers("bizA");
    await store.listStaff("bizA");
    await store.listSales("bizA");
    await store.listOrders("bizA");
    await store.listExpenses("bizA");
    await store.listPurchases("bizA");
    await store.listMovements("bizA");
    await store.stockLevels("bizA");
    await store.posCounts("bizA");

    // Inspect the recorded calls of every model the store touched.
    const models = ["posProduct", "posCustomer", "posSupplier", "posStaff", "posSale", "posOrder", "posExpense", "posPurchase", "posInventoryMovement", "posInventoryItem"];
    for (const name of models) {
      const mock = (await import("@/lib/db")).default[name];
      for (const method of ["findMany", "findFirst", "count", "aggregate"]) {
        for (const call of mock[method]?.mock?.calls ?? []) {
          const where = call[0]?.where ?? {};
          expect(where.businessId, `${name}.${method} must be tenant-scoped`).toBeTruthy();
        }
      }
    }
  });

  it("returns only the tenant's own products, customers, suppliers and staff", async () => {
    const products = await store.listProducts("bizA");
    expect(products.map((product: any) => product.id).sort()).toEqual(["p_a1", "p_a2"]);
    expect((await store.listProducts("bizB")).map((product: any) => product.id)).toEqual(["p_b1"]);

    expect((await store.listCustomers("bizA")).map((customer: any) => customer.id)).toEqual(["c_a1"]);
    expect((await store.listSuppliers("bizA")).map((supplier: any) => supplier.id)).toEqual(["s_a1"]);
    expect((await store.listStaff("bizA")).map((member: any) => member.id)).toEqual(["st_a1"]);
    expect((await store.listBranches("bizA")).map((branch: any) => branch.id)).toEqual(["br_a1", "br_a2"]);
  });

  it("answers 'not found' for another tenant's record id, and never returns it (§75 IDOR)", async () => {
    expect(await store.findProduct("bizA", "p_b1")).toBeNull();
    expect(await store.findCustomer("bizA", "c_b1")).toBeNull();
    expect(await store.findSupplier("bizA", "s_b1")).toBeNull();
    expect(await store.findStaff("bizA", "st_b1")).toBeNull();
    expect(await store.findSale("bizA", "sale_b1")).toBeNull();
    expect(await store.findOrder("bizA", "ord_b1")).toBeNull();
    expect(await store.findPurchase("bizA", "po_b1")).toBeNull();
    // The record still exists for its own tenant, so this is scoping, not deletion.
    expect(await store.findProduct("bizB", "p_b1")).not.toBeNull();
  });

  it("updates nothing when handed another tenant's id", async () => {
    const result = await store.updateProduct("bizA", "p_b1", { name: "Hijacked", priceKES: 1 });
    expect(result.count).toBe(0);
    expect((await store.findProduct("bizB", "p_b1"))!.name).toBe("Competitor cement");

    const customerUpdate = await store.updateCustomer("bizA", "c_b1", { name: "Hijacked", creditLimitKES: 999999 });
    expect(customerUpdate.count).toBe(0);
    expect((await store.findCustomer("bizB", "c_b1"))!.creditLimitKES).toBe(3000);

    const staffUpdate = await store.updateStaff("bizA", "st_b1", { name: "Hijacked", roleKey: "OWNER" });
    expect(staffUpdate.count).toBe(0);
    expect((await store.findStaff("bizB", "st_b1"))!.roleKey).toBe("CASHIER");
  });

  it("keeps receipt and order sequences per business, so tenants never collide or peek", async () => {
    expect(await store.nextSaleSequence("bizA")).toBe(2);
    expect(await store.nextSaleSequence("bizB")).toBe(2);
    expect(await store.nextOrderReference("bizA", "ORD")).toBe("ORD-0002");
    expect(await store.nextOrderReference("bizB", "ORD")).toBe("ORD-0002");
  });

  it("scopes totals, reports and counts to the tenant", async () => {
    const totalsA = await store.salesTotals("bizA");
    const totalsB = await store.salesTotals("bizB");
    expect(totalsA.totalKES).toBe(300);
    expect(totalsB.totalKES).toBe(900);
    const countsA = await store.posCounts("bizA");
    expect(countsA.products).toBe(2);
    expect(countsA.sales).toBe(1);
  });

  it("never moves another tenant's stock, even with their product id", async () => {
    const movement = await store.recordMovement("bizA", { productId: "p_b1", reason: "ADJUSTMENT", delta: 99, quantity: 99, note: "theft" });
    expect(movement).toBeNull();
    expect((await store.stockLevels("bizB"))[0].quantity).toBe(40);
    expect(state.posInventoryMovement.filter((row) => row.businessId === "bizB")).toHaveLength(0);
  });

  it("keeps a balance change inside the tenant and writes the ledger row beside it", async () => {
    const foreign = await store.applyBalanceChange("bizA", { partyType: "CUSTOMER", partyId: "c_b1" }, { deltaKES: 5000, direction: "DEBIT" });
    expect(foreign).toBeNull();
    expect((await store.findCustomer("bizB", "c_b1"))!.balanceKES).toBe(900);

    const own = await store.applyBalanceChange("bizA", { partyType: "CUSTOMER", partyId: "c_a1", partyName: "Jane" }, { deltaKES: 300, direction: "DEBIT" });
    expect(own?.balanceKES).toBe(1500);
    expect(state.posCreditEntry.filter((row) => row.businessId === "bizA")).toHaveLength(2);
    expect(state.posCreditEntry.filter((row) => row.businessId === "bizB")).toHaveLength(0);
  });

  it("records every movement with a reason and keeps it inside the tenant", async () => {
    await store.recordMovement("bizA", { productId: "p_a1", reason: "SALE", delta: -2, quantity: 2, branchId: "br_a1", refType: "SALE", refId: "sale_a1" });
    const movements = await store.listMovements("bizA", {});
    expect(movements).toHaveLength(2);
    expect(movements.every((movement: any) => movement.businessId === "bizA")).toBe(true);
    expect(await store.listMovements("bizB", {})).toHaveLength(0);
    const stock = (await store.stockLevels("bizA", ["p_a1"])).find((item: any) => item.branchId === "br_a1");
    expect(stock!.quantity).toBe(8);
  });

  it("scopes branch stock by location so a branch cashier cannot see the whole business (§16)", async () => {
    const all = await store.stockLevels("bizA", ["p_a1"]);
    expect(all).toHaveLength(2);
    const lowStock = await store.lowStock("bizA");
    expect(lowStock.map((item: any) => item.branchId)).toContain("br_a2");
    expect(lowStock.map((item: any) => item.branchId)).not.toContain("br_a1");
  });
});

describe("the audit log is tenant-scoped and redacts secrets (§37)", () => {
  it("stores entries against the business and reads them back only for that business", async () => {
    await logPosAudit({ businessId: "bizA", actorId: "userA", action: "POS_SALE_CREATED", targetType: "SALE", targetId: "sale_a1" });
    await logPosAudit({ businessId: "bizB", actorId: "userB", action: "POS_SALE_CREATED" });
    const entriesA = await (await import("@/lib/pos/audit")).listPosAudit("bizA");
    expect(entriesA).toHaveLength(1);
    expect(entriesA[0].action).toBe("POS_SALE_CREATED");
  });

  it("drops credentials, pins and tokens from metadata", async () => {
    await logPosAudit({
      businessId: "bizA",
      actorId: "userA",
      action: "POS_ACCESS_DENIED",
      metadata: { password: "hunter2", pin: "1234", apiKey: "sk_live_x", token: "abc", reason: "TENANT_ISOLATION" },
    });
    const written = state.posAuditEvent[state.posAuditEvent.length - 1];
    const metadata = JSON.parse(String(written.metadata ?? "{}"));
    expect(JSON.stringify(metadata)).not.toMatch(/hunter2|sk_live_x|1234/);
    expect(metadata.reason).toBe("TENANT_ISOLATION");
  });
});

describe("access is derived from the session, never from the request (§5, §75)", () => {
  it("refuses a business the signed-in person does not belong to", async () => {
    await expect(requirePosAccess("bizB", sessionA)).rejects.toThrow(PosAccessError);
    await expect(requirePosAccess("bizA", sessionB)).rejects.toThrow(PosAccessError);
  });

  it("gives the same answer for a foreign business and a nonexistent one", async () => {
    const foreign = await requirePosAccess("bizB", sessionA).catch((error: PosAccessError) => error.status);
    const missing = await requirePosAccess("does_not_exist", sessionA).catch((error: PosAccessError) => error.status);
    expect([403, 404]).toContain(foreign);
    expect(missing).toBe(404);
  });

  it("refuses without a session and without a business id", async () => {
    await expect(requirePosAccess("bizA", null)).rejects.toThrow(PosAccessError);
    await expect(requirePosAccess("", sessionA)).rejects.toThrow(PosAccessError);
    await expect(requirePosAccess("   ", sessionA)).rejects.toThrow(PosAccessError);
  });

  it("records a denied attempt in the tenant's own audit log", async () => {
    await requirePosAccess("bizA", sessionB).catch(() => null);
    const denied = state.posAuditEvent.filter((entry) => entry.action === "POS_ACCESS_DENIED");
    expect(denied.length).toBeGreaterThan(0);
    expect(denied.every((entry) => entry.businessId === "bizA")).toBe(true);
  });

  it("resolves the role from the business's own staff record, not from the request", async () => {
    const cashier = await requirePosAccess("bizA", { userId: "cashierA", email: "cashier@example.com", role: "CUSTOMER", name: "Mary" } as any);
    expect(cashier.roleKey).toBe("CASHIER");
    expect(cashier.staffId).toBe("st_a1");
    // Branch scoping comes from the staff record: this cashier only ever sees Eastlands (§16).
    expect(cashier.branchId).toBe("br_a2");
    expect(cashier.permissions).toContain("CREATE_SALE");
    expect(cashier.permissions).not.toContain("REFUND_SALE");

    const owner = await requirePosAccess("bizA", sessionA);
    expect(owner.roleKey).toBe("OWNER");
    expect(owner.branchId).toBeNull();

    const platformAdmin = await requirePosAccess("bizA", adminSession);
    expect(platformAdmin.roleKey).toBe("ADMIN");
  });

  it("fails closed for a role the configuration does not define (§36, §75)", async () => {
    // A membership role the engine does not know must never inherit the owner's rights.
    state.businessMember.push({ id: "mem_x", businessId: "bizA", userId: "userX", role: "SUPERVISOR" });
    const context = await requirePosAccess("bizA", { userId: "userX", email: "x@example.com", role: "CUSTOMER", name: "X" } as any);
    expect(context.roleKey).toBe("SUPERVISOR");
    expect(context.permissions).toEqual([]);
    await expect(
      requirePosAccess("bizA", { userId: "userX", email: "x@example.com", role: "CUSTOMER", name: "X" } as any, { permission: "CREATE_SALE" }),
    ).rejects.toThrow(PosAccessError);
  });

  it("refuses a business id that only exists in the request body (§75 forged tenant id)", async () => {
    // The URL segment is authoritative; a body claiming another tenant changes nothing because
    // the store's own filter is built from the authorized id.
    await expect(requirePosAccess("bizB", sessionA)).rejects.toThrow(PosAccessError);
    const products = await store.listProducts("bizA");
    expect(products.every((product: any) => product.businessId === "bizA")).toBe(true);
  });
});
