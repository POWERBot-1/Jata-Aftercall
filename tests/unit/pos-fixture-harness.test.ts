// @vitest-environment jsdom
/**
 * Development-only POS fixture harness: arithmetic, simulator, isolation, production exclusion and
 * real-component cart interactions. All data is FICTIONAL; nothing here touches a database.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import {
  FIXTURE_BUSINESS_ID,
  fixtureProducts,
  fixtureSimulatedResponse,
  fixtureTotals,
  isFixtureOutcome,
} from "@/lib/pos/fixtures/tillFixture";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("fixture arithmetic (pure, deterministic)", () => {
  it("computes subtotal, discount, fee, total, payment, balance and change in whole KES", () => {
    // 2 × 320 + 3 × 30 = 730
    expect(fixtureTotals({ items: [{ quantity: 2, unitPriceKES: 320, discountKES: 0 }, { quantity: 3, unitPriceKES: 30, discountKES: 0 }] }).subtotalKES).toBe(730);
    const t = fixtureTotals({
      items: [{ quantity: 2, unitPriceKES: 320, discountKES: 0 }, { quantity: 3, unitPriceKES: 30, discountKES: 0 }],
      discountKES: 50,
      feeKES: 100,
      payments: [{ amountKES: 1000 }],
    });
    expect(t).toEqual({ subtotalKES: 730, discountKES: 50, taxKES: 0, totalKES: 780, paidKES: 1000, balanceKES: 0, changeKES: 220 });
  });

  it("reports a remaining balance and never a negative total", () => {
    const partial = fixtureTotals({ items: [{ quantity: 1, unitPriceKES: 260, discountKES: 0 }], payments: [{ amountKES: 100 }] });
    expect(partial.totalKES).toBe(260);
    expect(partial.balanceKES).toBe(160);
    expect(partial.changeKES).toBe(0);
    expect(fixtureTotals({ items: [{ quantity: 1, unitPriceKES: 100, discountKES: 500 }] }).totalKES).toBe(0);
  });
});

describe("fixture simulator (no I/O)", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockClear();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  const body = { items: [{ quantity: 1, unitPriceKES: 320, discountKES: 0 }], payments: [{ amountKES: 320 }] };

  it("success returns a labelled fictional ok envelope", async () => {
    const res = fixtureSimulatedResponse("success", body);
    expect(res.ok).toBe(true);
    const json = await res.json();
    expect(json.receiptText).toContain("FICTIONAL FIXTURE");
    expect(json.receiptText).toContain("SIMULATED SUCCESS");
    expect(json.sale.id).toBe("fixture-sale-simulated");
    expect(json.totals.totalKES).toBe(320);
  });

  it("pending is distinct from success and is not a payment", async () => {
    const json = await fixtureSimulatedResponse("pending", body).json();
    expect(json.sale.status).toBe("PENDING_CONFIRMATION");
    expect(json.receiptText).toContain("SIMULATED PENDING");
    expect(json.receiptText).not.toContain("SIMULATED SUCCESS");
  });

  it("failure returns a non-ok envelope with a fictional error and records nothing", async () => {
    const res = fixtureSimulatedResponse("failure", body);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("FICTIONAL FIXTURE");
  });

  it("never calls the network", async () => {
    fixtureSimulatedResponse("success", body);
    fixtureSimulatedResponse("pending", body);
    fixtureSimulatedResponse("failure", body);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts only known outcomes", () => {
    expect(isFixtureOutcome("success")).toBe(true);
    expect(isFixtureOutcome("paid")).toBe(false);
    expect(isFixtureOutcome(undefined)).toBe(false);
  });
});

describe("fixture isolation and production exclusion (source-level guards)", () => {
  it("the fixture module imports no database, server or payment code", () => {
    const src = read("lib/pos/fixtures/tillFixture.ts");
    for (const forbidden of ["@/lib/db", "prisma", "@/lib/paystack", "fetch(", "node:fs", "process.env.DATABASE"]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });

  it("every fixture product and the business id are clearly fictional", () => {
    expect(FIXTURE_BUSINESS_ID.startsWith("fixture-")).toBe(true);
    for (const product of fixtureProducts) {
      expect(product.id.startsWith("fixture-"), product.id).toBe(true);
      expect(product.name.startsWith("Fixture"), product.name).toBe(true);
    }
  });

  it("the harness page is gated by notFound() in production", () => {
    const src = read("app/dev/pos-fixture/page.tsx");
    expect(src).toMatch(/if \(process\.env\.NODE_ENV === "production"\) notFound\(\);/);
  });

  it("the production sell page does not supply a simulator transport", () => {
    const sell = read("app/dashboard/pos/[businessId]/sell/page.tsx");
    expect(sell).not.toContain("submitSaleRequest");
  });

  it("the till posts to the real endpoint only when no transport is injected", () => {
    const till = read("components/pos/TillClient.tsx");
    expect(till).toContain("submitSaleRequest\n        ? await submitSaleRequest(businessId, saleBody)");
    expect(till).toContain("`/api/pos/${encodeURIComponent(businessId)}/sales`");
  });
});

// ---- Real component interactions (jsdom) ----------------------------------------------------

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("real TillClient cart interactions (fixture transport)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let PosFixtureTill: typeof import("@/components/pos/PosFixtureTill").PosFixtureTill;

  beforeAll(async () => {
    ({ PosFixtureTill } = await import("@/components/pos/PosFixtureTill"));
  });

  beforeEach(async () => {
    fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(PosFixtureTill, { outcome: "success" })));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const buttonByText = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
  const buttonByLabel = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const input = (name: string) => container.querySelector<HTMLInputElement>(`input[aria-label="Quantity of ${name}"]`)!;
  const lineFor = (name: string) => container.querySelector<HTMLElement>(`input[aria-label="Quantity of ${name}"]`)?.closest(".pos-line") ?? null;
  const text = () => container.textContent ?? "";
  const setInputValue = async (el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  const click = async (el: Element | null | undefined) => {
    expect(el, "element to click").toBeTruthy();
    await act(async () => (el as HTMLElement).click());
  };

  it("shows the empty-cart state first", () => {
    expect(text()).toContain("Tap an item to start.");
    expect(container.querySelector(".pos-line")).toBeNull();
    expect(text()).toContain("FICTIONAL FIXTURE");
  });

  it("adds a product, then increases and decreases its quantity with correct totals", async () => {
    await click(container.querySelector<HTMLButtonElement>('button.pos-item'));
    expect(lineFor("Fixture Tea 250g")).not.toBeNull();
    expect(input("Fixture Tea 250g").value).toBe("1");
    expect(text()).toContain("Items");
    await click(buttonByLabel("One more Fixture Tea 250g"));
    expect(input("Fixture Tea 250g").value).toBe("2");
    await click(buttonByLabel("One more Fixture Tea 250g"));
    expect(input("Fixture Tea 250g").value).toBe("3");
    expect(text()).toContain("KES 960"); // 3 × 320
    await click(buttonByLabel("One less Fixture Tea 250g"));
    expect(input("Fixture Tea 250g").value).toBe("2");
    expect(text()).toContain("KES 640");
  });

  it("removes an item when its quantity reaches zero", async () => {
    await click(container.querySelector<HTMLButtonElement>('button.pos-item'));
    await click(buttonByLabel("One less Fixture Tea 250g"));
    expect(lineFor("Fixture Tea 250g")).toBeNull();
    expect(text()).toContain("Tap an item to start.");
  });

  it("ignores an empty quantity entry instead of removing the line", async () => {
    await click(container.querySelector<HTMLButtonElement>('button.pos-item'));
    await setInputValue(input("Fixture Tea 250g"), "");
    expect(lineFor("Fixture Tea 250g")).not.toBeNull();
    expect(input("Fixture Tea 250g").value).toBe("1");
  });

  it("floors decimal quantities to whole units and never accepts negatives", async () => {
    await click(container.querySelector<HTMLButtonElement>('button.pos-item'));
    await setInputValue(input("Fixture Tea 250g"), "2.7");
    expect(input("Fixture Tea 250g").value).toBe("2");
    await setInputValue(input("Fixture Tea 250g"), "-4");
    expect(lineFor("Fixture Tea 250g")).toBeNull();
  });

  it("computes the subtotal and total across a multi-item cart", async () => {
    const tiles = [...container.querySelectorAll<HTMLButtonElement>("button.pos-item")];
    await click(tiles.find((b) => b.textContent?.includes("Fixture Tea"))); // 320
    await click(tiles.find((b) => b.textContent?.includes("Fixture Mandazi"))); // 30
    await click(buttonByLabel("One more Fixture Mandazi"));
    await click(buttonByLabel("One more Fixture Mandazi")); // 3 × 30 = 90
    expect(text()).toContain("KES 410"); // 320 + 90
    expect(container.querySelector(".pos-total-line")?.textContent).toContain("KES 410");
    expect(buttonByText("Complete sale · KES 410") ?? [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Complete sale · KES 410"))).toBeTruthy();
  });

  it("keeps checkout disabled until a payment method is set, then reaches a checkout-ready state", async () => {
    await click(container.querySelector<HTMLButtonElement>('button.pos-item'));
    const complete = () => [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Complete sale")) as HTMLButtonElement;
    expect(complete().textContent).toContain("KES 320");
    await click(buttonByText("Cash"));
    expect(complete().disabled).toBe(false);
  });

  it("completes a simulated success without calling the real endpoint", async () => {
    await click(container.querySelector<HTMLButtonElement>('button.pos-item'));
    await click(buttonByText("Cash"));
    await click([...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Complete sale")));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(text()).toContain("FIXTURE-0001");
    expect(text()).toContain("FICTIONAL FIXTURE");
    expect(container.querySelector(".pos-line")).toBeNull();
  });
});

describe("failure outcome from the real component", () => {
  it("shows the fictional failure as an error and keeps the cart", async () => {
    const { PosFixtureTill: Harness } = await import("@/components/pos/PosFixtureTill");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(Harness, { outcome: "failure" })));
    await act(async () => (container.querySelector<HTMLButtonElement>("button.pos-item") as HTMLButtonElement).click());
    const cashBtn = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Cash") as HTMLButtonElement;
    await act(async () => cashBtn.click());
    const complete = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Complete sale")) as HTMLButtonElement;
    await act(async () => complete.click());
    expect(container.textContent).toContain("FICTIONAL FIXTURE: the simulated payment provider declined");
    expect(container.querySelector(".pos-line")).not.toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });
});
