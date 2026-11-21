/**
 * R-MJ-09 / R-MJ-11 — every "Get MJENGO OS" call to action on the public product page enters the
 * journey at the public /mjengo entry. It sits outside the /dashboard layout, whose bare /login
 * redirect would otherwise drop the MJENGO destination for a signed-out visitor.
 *
 * Rendered, not grepped: the server component is awaited and rendered to markup with the stored plan
 * mocked, signed in and signed out, so a CTA that depends on the session is caught.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  session: null as null | { userId: string; role: string; email: string },
  plan: { id: "plan_mjengo", key: "MJENGO_OS", name: "MJENGO OS", priceKES: 2000, durationDays: 30, isActive: true } as any,
}));
vi.mock("@/lib/auth", () => ({ getSession: async () => state.session }));
vi.mock("@/lib/pricing", () => ({ getMjengoOsPlan: async () => state.plan }));
vi.mock("@/lib/db", () => ({ default: {} }));

import MjengoOsProductPage from "@/app/products/mjengo-os/page";

async function ctaHrefs(): Promise<string[]> {
  const html = renderToStaticMarkup(await MjengoOsProductPage());
  return [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)]
    .filter((match) => match[2].trim() === "Get MJENGO OS")
    .map((match) => match[1]);
}

describe("mjengo public product page: Get MJENGO OS CTAs (R-MJ-09)", () => {
  beforeEach(() => {
    state.session = null;
    state.plan = { id: "plan_mjengo", key: "MJENGO_OS", name: "MJENGO OS", priceKES: 2000, durationDays: 30, isActive: true };
    delete process.env.MJENGO_OS_DISABLED;
  });

  it("signed out: every CTA enters at /mjengo (never /dashboard/mjengo or a bare /login, which drop the intent)", async () => {
    const hrefs = await ctaHrefs();
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
    expect(new Set(hrefs)).toEqual(new Set(["/mjengo"]));
  });

  it("signed in: every CTA enters at /mjengo (never /dashboard/subscription, which does not sell MJENGO OS)", async () => {
    state.session = { userId: "u1", role: "CUSTOMER", email: "owner@test.invalid" };
    const hrefs = await ctaHrefs();
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
    expect(hrefs).not.toContain("/dashboard/subscription");
    expect(new Set(hrefs)).toEqual(new Set(["/mjengo"]));
  });

  it("a refused plan (mispriced) shows no price, hides the hero CTA, and the remaining CTAs still enter the gated journey", async () => {
    state.plan = { ...state.plan, priceKES: 499 };
    const html = renderToStaticMarkup(await MjengoOsProductPage());
    expect(html).toContain("Pricing currently unavailable");
    expect(html).toContain("Checkout is currently unavailable");
    expect(html).not.toContain("KES 499");
    const hero = html.slice(html.indexOf('id="mjengo-hero"'), html.indexOf('id="mjengo-problems"'));
    expect(hero).not.toContain("Get MJENGO OS");
    // /mjengo → /dashboard/mjengo re-applies mjengoCheckoutRefusal before any checkout link is rendered.
    expect(new Set(await ctaHrefs())).toEqual(new Set(["/mjengo"]));
  });
});
