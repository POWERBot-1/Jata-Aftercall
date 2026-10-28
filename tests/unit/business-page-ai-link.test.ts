/**
 * Production audit 2026-10-04 — "Ask AI Front Desk" must only be offered when it exists.
 *
 * Every classic /b/<slug> page showed an "Ask AI Front Desk →" link unconditionally. For any
 * business without the paid AI package (all four production demo pages) /b/<slug>/ai answers
 * 404, so customers were handed a button that led to "Page not found".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ live: false, draft: false, throwEntitlement: false }));

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
// The link follows the derived lifecycle (lib/ai-publication.ts): a desk that is entitled but
// still a draft is not live, and /b/<slug>/ai would 404 — so the button stays hidden.
vi.mock("@/lib/ai-publication", () => ({
  getAIFrontDeskPublication: vi.fn(async () => {
    if (state.throwEntitlement) throw new Error("db down");
    if (state.draft) {
      return { state: "DRAFT", publiclyOperational: false, entitled: true, isPublished: true };
    }
    return {
      state: state.live ? "LIVE" : "SUSPENDED",
      publiclyOperational: state.live,
      entitled: state.live,
      isPublished: state.live,
    };
  }),
}));

import PublicBusinessPage from "@/app/b/[slug]/page";

const render = async () =>
  renderToStaticMarkup(await PublicBusinessPage({ params: Promise.resolve({ slug: "acme" }), searchParams: Promise.resolve({}) }));

describe("public business page AI entry", () => {
  beforeEach(() => { state.live = false; state.draft = false; state.throwEntitlement = false; });

  it("is hidden for a business without a live AI Business Front Desk", async () => {
    const html = await render();
    expect(html).toContain("View services");
    expect(html).not.toContain("Ask AI Front Desk");
    expect(html).not.toContain("/b/acme/ai");
  });

  it("is shown for a business whose Front Desk is live and entitled", async () => {
    state.live = true;
    const html = await render();
    expect(html).toContain("Ask AI Front Desk");
    expect(html).toContain('href="/b/acme/ai"');
  });

  it("is hidden for an entitled business that never activated its Front Desk", async () => {
    state.draft = true;
    const html = await render();
    expect(html).not.toContain("Ask AI Front Desk");
  });

  it("fails closed (hidden) if the lifecycle check itself fails", async () => {
    state.throwEntitlement = true;
    const html = await render();
    expect(html).not.toContain("Ask AI Front Desk");
  });
});
