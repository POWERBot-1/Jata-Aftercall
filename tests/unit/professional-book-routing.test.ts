import React from "react";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExperienceDocument } from "@/lib/experience/document";
import { getExperienceProfile } from "@/lib/experience/categories";
import { resolveExperienceTheme } from "@/lib/experience/themes";
const h = vi.hoisted(() => ({ data: null as any }));
vi.mock("@/lib/auth", () => ({ getSession: async () => null }));
vi.mock("@/lib/db", () => ({ default: {} }));
vi.mock("@/lib/experience/storefront", () => ({ loadStorefront: async () => h.data }));
vi.mock("next/navigation", async (original) => ({ ...await original<typeof import("next/navigation")>(),
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
import BookPage from "@/app/b/[slug]/book/page";
const router = { bfcacheId: "qa-router-fixture", back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
const request = (service?: string) => ({ params: Promise.resolve({ slug: "owned-pro" }), searchParams: Promise.resolve({ service }) });
beforeEach(() => {
  const document = createExperienceDocument({ categoryKey: "professional", businessName: "Owned practice" });
  const profile = getExperienceProfile("professional");
  h.data = { business: { id: "owned-business", slug: "owned-pro", name: "Owned practice" }, document, profile,
    theme: resolveExperienceTheme(profile.defaultThemeKey), isPreview: false, items: [], services: [
      { id: "quote-service", name: "Owned quote work", kind: "service", price: null, pricingType: "QUOTE", bookingEnabled: false },
      { id: "fixed-service", name: "Owned consultation", kind: "service", price: 900, pricingType: "FIXED", bookingEnabled: true, durationMinutes: 30, depositKES: 0 },
    ] };
});
describe("professional requests are not forced into appointment assumptions", () => {
  it("routes quote work to a request-only enquiry, not mandatory date/slots", async () => {
    await expect(BookPage(request("quote-service"))).rejects.toThrow("REDIRECT /b/owned-pro/enquire?service=quote-service");
  });
  it("routes a fixed-price service with booking disabled to enquiry, not a rejected appointment", async () => {
    h.data.services[1].bookingEnabled = false;
    await expect(BookPage(request("fixed-service"))).rejects.toThrow("REDIRECT /b/owned-pro/enquire?service=fixed-service");
  });
  it("never substitutes an owned service for a foreign or unavailable requested ID", async () => {
    await expect(BookPage(request("foreign-service"))).rejects.toThrow("NOT_FOUND");
  });
  it("preserves fixed bookable service date/slot controls and excludes nonbookable quotes from appointment selection", async () => {
    const page = await BookPage(request("fixed-service"));
    const html = renderToString(React.createElement(AppRouterContext.Provider, { value: router }, page));
    expect(html).toContain("Choose a date"); expect(html).toContain("Owned consultation");
    expect(html).not.toContain("Owned quote work");
  });
});
describe("technical services share request-only routing without product/appointment assumptions", () => {
  it("routes technical quote work to enquiry and keeps real bookable visits on the appointment route", async () => {
    h.data.document = createExperienceDocument({ categoryKey: "technical", businessName: "Owned repairs" });
    h.data.profile = getExperienceProfile("technical");
    await expect(BookPage(request("quote-service"))).rejects.toThrow("REDIRECT /b/owned-pro/enquire?service=quote-service");
    const page = await BookPage(request("fixed-service"));
    const html = renderToString(React.createElement(AppRouterContext.Provider, { value: router }, page));
    expect(html).toContain("Choose a date"); expect(html).toContain("Owned consultation");
    expect(html).not.toContain("Owned quote work");
  });
  it("never substitutes services for foreign technical request IDs", async () => {
    h.data.document = createExperienceDocument({ categoryKey: "technical", businessName: "Owned repairs" });
    h.data.profile = getExperienceProfile("technical");
    await expect(BookPage(request("foreign-service"))).rejects.toThrow("NOT_FOUND");
  });
});
