/**
 * DEVELOPMENT / TEST FIXTURE ONLY — FICTIONAL DATA.
 *
 * Used exclusively by the development-only POS fixture harness (`/dev/pos-fixture`, 404 in
 * production). Nothing here is a merchant, a product, a customer, a sale, a payment or a
 * receipt. The simulator never performs I/O: it turns a submitted cart into a fictional response
 * so the real `TillClient` completion path can be exercised without touching a database.
 */
import type { MethodOption } from "@/lib/pos/money";
import type { TillCustomer, TillProduct } from "@/components/pos/TillClient";

export const FIXTURE_NOTICE = "FICTIONAL FIXTURE — no sale, payment, refund, stock change or receipt is recorded anywhere.";
export const FIXTURE_BUSINESS_ID = "fixture-business";
export const FIXTURE_BASE_PATH = "/dev/pos-fixture";

export type FixtureOutcome = "success" | "pending" | "failure";
export const FIXTURE_OUTCOMES: readonly FixtureOutcome[] = ["success", "pending", "failure"];

export function isFixtureOutcome(value: unknown): value is FixtureOutcome {
  return typeof value === "string" && (FIXTURE_OUTCOMES as readonly string[]).includes(value);
}

/** Fictional catalogue. Prices are whole KES and chosen only to exercise arithmetic. */
export const fixtureProducts: TillProduct[] = [
  { id: "fixture-tea", name: "Fixture Tea 250g", kind: "PRODUCT", priceKES: 320, unitKey: "pack", category: "Fixture grocery", stock: 12, barcode: null },
  { id: "fixture-mandazi", name: "Fixture Mandazi", kind: "PRODUCT", priceKES: 30, unitKey: "each", category: "Fixture bakery", stock: 40, barcode: null },
  { id: "fixture-cake", name: "Fixture Cake Slice", kind: "PRODUCT", priceKES: 260, unitKey: "slice", category: "Fixture bakery", stock: 3, barcode: null },
  { id: "fixture-juice", name: "Fixture Juice 500ml", kind: "PRODUCT", priceKES: 150, unitKey: "bottle", category: "Fixture drinks", stock: 0, barcode: null },
  { id: "fixture-service", name: "Fixture Sample Service", kind: "SERVICE", priceKES: 1200, unitKey: "visit", category: "Fixture services", stock: null, barcode: null },
];

export const fixtureCustomers: TillCustomer[] = [{ id: "fixture-customer", name: "Fixture Customer", phone: null, balanceKES: 0 }];

export const fixtureMethods: MethodOption[] = [
  { key: "cash", label: "Cash", needsReference: false },
  { key: "mpesa", label: "M-Pesa", needsReference: true },
];

export const fixtureWords = { sale: "Sale", customer: "Customer", product: "Product", products: "Products", order: "Order" };

export const fixtureFlags = {
  discounts: true,
  splitPayments: true,
  partialPayments: false,
  credit: false,
  taxEnabled: false,
  taxLabel: "",
  deliveryEnabled: false,
  deliveryFeeKES: 0,
  canEditPrice: false,
  canDiscount: true,
  channels: ["counter"],
};

/** Shape of the body TillClient sends (see `payload()` in components/pos/TillClient.tsx). */
type SaleBody = {
  items?: Array<{ quantity?: number; unitPriceKES?: number; discountKES?: number }>;
  discountKES?: number | null;
  feeKES?: number | null;
  payments?: Array<{ amountKES?: number }>;
};

/** Pure arithmetic used by the simulator. Whole-shilling integers, no rounding surprises. */
export function fixtureTotals(body: SaleBody) {
  const items = Array.isArray(body.items) ? body.items : [];
  const subtotalKES = items.reduce((sum, item) => sum + (item.unitPriceKES ?? 0) * (item.quantity ?? 0), 0);
  const discountKES = items.reduce((sum, item) => sum + (item.discountKES ?? 0), 0) + (body.discountKES ?? 0);
  const feeKES = body.feeKES ?? 0;
  const totalKES = Math.max(0, subtotalKES - discountKES + feeKES);
  const paidKES = (body.payments ?? []).reduce((sum, payment) => sum + (payment.amountKES ?? 0), 0);
  return {
    subtotalKES,
    discountKES,
    taxKES: 0,
    totalKES,
    paidKES,
    balanceKES: Math.max(0, totalKES - paidKES),
    changeKES: Math.max(0, paidKES - totalKES),
  };
}

/**
 * Turns a submitted cart into a FICTIONAL response. `success` and `pending` return an ok envelope
 * with a fictional sale id; `failure` returns a non-ok envelope. Nothing is stored or sent.
 */
export function fixtureSimulatedResponse(outcome: FixtureOutcome, body: unknown): Response {
  const sale = (body ?? {}) as SaleBody;
  if (outcome === "failure") {
    return new Response(
      JSON.stringify({ ok: false, error: "FICTIONAL FIXTURE: the simulated payment provider declined. No sale was recorded." }),
      { status: 422, headers: { "content-type": "application/json" } },
    );
  }
  const totals = fixtureTotals(sale);
  const pending = outcome === "pending";
  const receiptText = [
    FIXTURE_NOTICE,
    pending ? "SIMULATED PENDING: awaiting a fictional confirmation. Not a payment." : "SIMULATED SUCCESS: fictional receipt. Not a real sale.",
    `Subtotal KES ${totals.subtotalKES}`,
    `Total KES ${totals.totalKES}`,
  ].join("\n");
  return new Response(
    JSON.stringify({
      ok: true,
      sale: { id: "fixture-sale-simulated", receiptNumber: "FIXTURE-0001", status: pending ? "PENDING_CONFIRMATION" : "FIXTURE_PAID" },
      totals,
      receiptText,
      warnings: [FIXTURE_NOTICE],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
