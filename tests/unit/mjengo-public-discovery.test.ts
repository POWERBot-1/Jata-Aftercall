import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("mjengo: public product discovery", () => {
  it("has a dedicated public MJENGO OS product page", () => {
    const page = readFileSync(path.join(root, "app/products/mjengo-os/page.tsx"), "utf8");
    expect(page).toContain("MJENGO OS");
    expect(page).toContain("mjengoCheckoutRefusal");
    expect(page).toContain("KES");
  });

  it("links MJENGO OS from the homepage, product catalogue and marketing footer", () => {
    const homepage = readFileSync(path.join(root, "app/page.tsx"), "utf8");
    const catalogue = readFileSync(path.join(root, "app/products/page.tsx"), "utf8");
    const footer = readFileSync(path.join(root, "components/marketing/MarketingShell.tsx"), "utf8");
    expect(homepage).toContain('href="/products/mjengo-os"');
    expect(catalogue).toContain('href="/products/mjengo-os"');
    expect(footer).toContain('href="/products/mjengo-os"');
  });

  it("keeps the public page informational while the server checkout gate refuses activation", () => {
    const catalogue = readFileSync(path.join(root, "app/products/page.tsx"), "utf8");
    const detail = readFileSync(path.join(root, "app/products/mjengo-os/page.tsx"), "utf8");
    expect(catalogue).toContain("mjengoRefusal");
    expect(detail).toContain("The product information is visible");
    expect(detail).toContain("checkout remains fail-closed");
  });

  it("sends an unpaid authorized owner to the server-verified checkout route", () => {
    const layout = readFileSync(path.join(root, "app/dashboard/mjengo/[businessId]/layout.tsx"), "utf8");
    expect(layout).toContain("getMjengoOsPlan");
    expect(layout).toContain("mjengoCheckoutRefusal");
    expect(layout).toContain("/checkout?businessId=");
  });
});
