import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("mjengo: public product discovery", () => {
  it("has a complete public product page with accurate workspace capabilities and SEO", () => {
    const page = read("app/products/mjengo-os/page.tsx");
    expect(page).toContain("MJENGO OS");
    expect(page).toContain("Take Control of Every Project, Material and Shilling.");
    expect(page).toContain("Sales & orders");
    expect(page).toContain("Inventory & materials");
    expect(page).toContain("Procurement & suppliers");
    expect(page).toContain("Customers & credit");
    expect(page).toContain("Accounting");
    expect(page).toContain("Workforce");
    expect(page).toContain("Business reports");
    expect(page).toContain("alternates: { canonical:");
    expect(page).toContain("openGraph:");
    expect(page).toContain("getMjengoOsPlan");
    expect(page).toContain("mjengoCheckoutRefusal");
    expect(page).toContain("Pricing currently unavailable");
  });

  it("links MJENGO OS from the homepage, catalogue and marketing footer", () => {
    const homepage = read("app/page.tsx");
    const catalogue = read("app/products/page.tsx");
    const footer = read("components/marketing/MarketingShell.tsx");
    expect(homepage).toContain('href="/products/mjengo-os"');
    expect(catalogue).toContain('href="/products/mjengo-os"');
    expect(footer).toContain('href="/products/mjengo-os"');
  });

  it("uses the stored MJENGO plan rather than hardcoded public prices", () => {
    const homepage = read("app/page.tsx");
    const catalogue = read("app/products/page.tsx");
    const pricing = read("app/pricing/page.tsx");
    const detail = read("app/products/mjengo-os/page.tsx");
    expect(homepage).toContain('storedPlans.find((plan) => plan.key === "MJENGO_OS")');
    expect(catalogue).toContain("getMjengoOsPlan()");
    expect(pricing).toContain("getMjengoOsPlan()");
    expect(detail).toContain("getMjengoOsPlan()");
    for (const source of [homepage, catalogue, pricing, detail]) {
      expect(source).not.toContain("KES 2,000 / 30 days");
    }
  });

  it("keeps public product information separate from server-verified checkout and entitlement", () => {
    const catalogue = read("app/products/page.tsx");
    const detail = read("app/products/mjengo-os/page.tsx");
    const layout = read("app/dashboard/mjengo/[businessId]/layout.tsx");
    expect(catalogue).toContain("mjengoRefusal");
    expect(detail).toContain("mjengoCheckoutRefusal");
    expect(detail).toContain("/dashboard/mjengo");
    expect(layout).toContain("getMjengoOsPlan");
    expect(layout).toContain("mjengoCheckoutRefusal");
    expect(layout).toContain("/checkout?businessId=");
  });

  it("includes MJENGO OS in the public pricing experience", () => {
    const pricing = read("app/pricing/page.tsx");
    expect(pricing).toContain('id="mjengo-plan"');
    expect(pricing).toContain("mjengoTerms");
    expect(pricing).toContain('href="/products/mjengo-os"');
  });
});
