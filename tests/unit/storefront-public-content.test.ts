/** Public Website Studio pages must not expose inactive or expired services/offers. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExperienceDocument } from "@/lib/experience/document";

const state = vi.hoisted(() => ({ offer: null as any, serviceCalls: [] as any[] }));

vi.mock("@/lib/db", () => ({
  default: {
    business: {
      findUnique: vi.fn(async ({ where }: any) => ({
        id: `business-${where.slug}`,
        slug: where.slug,
        name: "Example business",
        category: "Other",
        phone: null,
        whatsapp: null,
        location: null,
        lat: null,
        lng: null,
        description: null,
        logoUrl: null,
        isPublished: true,
        status: "ACTIVE",
      })),
    },
    businessExperience: {
      findUnique: vi.fn(async () => ({
        publishedJson: JSON.stringify(createExperienceDocument({ categoryKey: "retail", businessName: "Example business" })),
        draftJson: null,
        categoryKey: "retail",
        themeKey: "clean",
        status: "PUBLISHED",
        publishedVersion: 1,
      })),
    },
    product: { findMany: vi.fn(async () => []) },
    service: {
      findMany: vi.fn(async (args: any) => {
        state.serviceCalls.push(args);
        return [];
      }),
    },
    offer: { findUnique: vi.fn(async () => state.offer) },
  },
}));

import { loadStorefront } from "@/lib/experience/storefront";

beforeEach(() => {
  state.offer = null;
  state.serviceCalls.length = 0;
});

describe("public Website Studio content visibility", () => {
  it("queries active services and hides inactive or expired offers", async () => {
    state.offer = { title: "Expired example", subtitle: null, isActive: true, validUntil: new Date(Date.now() - 60_000) };
    const expired = await loadStorefront("expired-example");
    expect(expired?.offer).toBeNull();
    expect(state.serviceCalls[0]).toMatchObject({ where: { businessId: "business-expired-example", isActive: true } });

    state.offer = { title: "Inactive example", subtitle: null, isActive: false, validUntil: null };
    const inactive = await loadStorefront("inactive-example");
    expect(inactive?.offer).toBeNull();

    state.offer = { title: "Current example", subtitle: null, isActive: true, validUntil: new Date(Date.now() + 60_000) };
    const current = await loadStorefront("current-example");
    expect(current?.offer?.title).toBe("Current example");
  });
});
