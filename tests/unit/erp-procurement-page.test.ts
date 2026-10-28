/**
 * The procurement screen, as each role receives it.
 *
 * The domain suite proves the rules; this proves what a person actually sees: a draft offers
 * "Submit", an approved order offers "Mark as ordered", an ordered one offers the receive form with
 * the outstanding quantity per line, a received one offers the bill form, and a viewer is offered no
 * controls at all — with the reason stated rather than a silently empty page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  role: "MANAGER" as string,
  orders: [] as any[],
  suppliers: [] as any[],
  products: [] as any[],
  summary: { draft: 0, awaiting: 0, open: 0, received: 0 },
}));

vi.mock("@/lib/erp/workspace", () => ({
  loadErpWorkspace: vi.fn(async () => ({
    role: state.role,
    basePath: "/dashboard/erp/biz-1",
    session: { userId: "manager-1", email: "person@example.test", role: "USER" },
  })),
}));

vi.mock("@/lib/erp/loaders", () => ({
  loadProcurementCentre: vi.fn(async () => ({
    orders: state.orders,
    suppliers: state.suppliers,
    products: state.products,
    summary: state.summary,
  })),
}));

vi.mock("@/app/dashboard/erp/[businessId]/actions", () => ({
  createPurchaseOrderAction: "/dashboard/erp/biz-1/procurement/create",
  submitPurchaseOrderAction: "/dashboard/erp/biz-1/procurement/submit",
  orderPurchaseOrderAction: "/dashboard/erp/biz-1/procurement/order",
  receivePurchaseOrderAction: "/dashboard/erp/biz-1/procurement/receive",
  cancelPurchaseOrderAction: "/dashboard/erp/biz-1/procurement/cancel",
  recordPurchaseBillAction: "/dashboard/erp/biz-1/procurement/bill",
}));

const { default: ProcurementPage } = await import("@/app/dashboard/erp/[businessId]/procurement/page");

function line(overrides: Record<string, unknown> = {}) {
  return {
    id: "line-1",
    description: "40 bags of cement",
    productId: "prod-1",
    quantity: 40,
    unitCostCents: 75_000,
    receivedQuantity: 0,
    ...overrides,
  };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "po-1",
    orderNumber: "PO-000001",
    supplierId: "sup-1",
    supplierName: "Cement Traders",
    status: "DRAFT",
    totalCents: 3_480_000,
    expectedAt: new Date("2026-11-05T00:00:00.000Z"),
    notes: null,
    requestedName: "Manager One",
    createdAt: new Date("2026-10-31T09:00:00.000Z"),
    cancelReason: null,
    lines: [line()],
    receipts: [],
    bills: [],
    ...overrides,
  };
}

async function render() {
  const element = await ProcurementPage({
    params: Promise.resolve({ businessId: "biz-1" }),
    searchParams: Promise.resolve({} as any),
  });
  return renderToStaticMarkup(element as any);
}

beforeEach(() => {
  state.role = "MANAGER";
  state.orders = [];
  state.suppliers = [{ id: "sup-1", name: "Cement Traders", termsDays: 30, creditEnabled: true }];
  state.products = [{ id: "prod-1", name: "Cement 50kg", sku: "CEM50", unitKey: "bag", costKES: 75_000, trackInventory: true }];
  state.summary = { draft: 0, awaiting: 0, open: 0, received: 0 };
});

describe("procurement screen", () => {
  it("shows an empty state that explains the chain before anything exists", async () => {
    const html = await render();
    expect(html).toContain("No purchase orders yet");
    expect(html).toContain("Nothing is bought until it is approved");
  });

  it("offers a draft the submit control and no receive or bill form", async () => {
    state.orders = [order()];
    state.summary = { draft: 1, awaiting: 0, open: 0, received: 0 };
    const html = await render();
    expect(html).toContain("PO-000001");
    expect(html).toContain("Submit for approval or approve");
    expect(html).not.toContain("Record what arrived");
    expect(html).not.toContain("Post bill");
  });

  it("offers an approved order the ordered control", async () => {
    state.orders = [order({ status: "APPROVED" })];
    const html = await render();
    expect(html).toContain("Mark as ordered");
    expect(html).not.toContain("Submit for approval or approve");
  });

  it("asks how much arrived, line by line, on an ordered order", async () => {
    state.orders = [order({ status: "ORDERED", lines: [line({ receivedQuantity: 10 })] })];
    const html = await render();
    expect(html).toContain("Record what arrived");
    expect(html).toContain("30 outstanding");
    expect(html).toContain("name=\"qty:line-1\"");
  });

  it("offers the supplier bill form once goods have moved, and shows the variance route", async () => {
    state.orders = [order({ status: "RECEIVED", lines: [line({ receivedQuantity: 40 })] })];
    const html = await render();
    expect(html).toContain("Post bill");
    expect(html).toContain("Supplier invoice no.");
    expect(html).not.toContain("Record what arrived");
  });

  it("shows a cancelled order as cancelled with its reason and no controls", async () => {
    state.orders = [order({ status: "CANCELLED", cancelReason: "Supplier raised the price" })];
    const html = await render();
    expect(html).toContain("Cancelled");
    expect(html).toContain("Supplier raised the price");
    expect(html).not.toContain("Submit for approval or approve");
    expect(html).not.toContain("Post bill");
  });

  it("tells a viewer why there are no controls instead of showing an empty form", async () => {
    state.role = "VIEWER";
    state.orders = [order()];
    const html = await render();
    expect(html).toContain("Your role can see procurement but not raise or receive orders");
    expect(html).not.toContain("Save draft order");
    expect(html).not.toContain("Submit for approval or approve");
    // A viewer still reads the order itself.
    expect(html).toContain("PO-000001");
  });

  it("points at the POS supplier screen when there is nobody to buy from", async () => {
    state.suppliers = [];
    const html = await render();
    expect(html).toContain("Add a supplier in the POS suppliers screen first");
    expect(html).toContain("disabled");
  });
});
