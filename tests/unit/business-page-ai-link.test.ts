/**
 * Production audit 2026-10-04 — "Ask AI Front Desk" must only be offered when it exists.
 *
 * Every classic /b/<slug> page showed an "Ask AI Front Desk →" link unconditionally. For any
 * business without the paid AI package (all four production demo pages) /b/<slug>/ai answers
 * 404, so customers were handed a button that led to "Page not found".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ entitled: false, throwEntitlement: false }));

const business = {
  id: "biz-1", slug: "acme", name: "Acme", category: "Shop", phone: "0722000000", whatsapp: "0722000000",
  location: "Nairobi", lat: null, lng: null, description: "d", theme: "clean", aftercallMsg: null,
  openingHours: null, socialLinks: null, isPublished: true, ownerId: "owner-1", status: "ACTIVE", logoUrl: null,
  services: [], offer: null, subscription: null, members: [{ userId: "owner-1", role: "OWNER" }],
};

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: () => { throw new Error("REDIRECT"); } }));
vi.mock("@/lib/db", () => ({
  default: {
    business: { findUnique: vi.fn(async () => business) },
    businessExperience: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => null) }));
vi.mock("@/lib/referral", () => ({ ensureReferralCode: vi.fn(async () => null), referralPath: vi.fn(() => "/r/x") }));
vi.mock("@/lib/ai-entitlement", () => ({
  getAIPackageStatus: vi.fn(async () => {
    if (state.throwEntitlement) throw new Error("db down");
    return { entitled: state.entitled };
  }),
}));

import PublicBusinessPage from "@/app/b/[slug]/page";

const render = async () =>
  renderToStaticMarkup(await PublicBusinessPage({ params: Promise.resolve({ slug: "acme" }), searchParams: Promise.resolve({}) }));

describe("public business page AI entry", () => {
  beforeEach(() => { state.entitled = false; state.throwEntitlement = false; });

  it("is hidden for a business without a live AI Business Front Desk", async () => {
    const html = await render();
    expect(html).toContain("View services");
    expect(html).not.toContain("Ask AI Front Desk");
    expect(html).not.toContain("/b/acme/ai");
  });

  it("is shown for a business whose AI package is entitled", async () => {
    state.entitled = true;
    const html = await render();
    expect(html).toContain("Ask AI Front Desk");
    expect(html).toContain('href="/b/acme/ai"');
  });

  it("fails closed (hidden) if the entitlement check itself fails", async () => {
    state.throwEntitlement = true;
    const html = await render();
    expect(html).not.toContain("Ask AI Front Desk");
  });
});
