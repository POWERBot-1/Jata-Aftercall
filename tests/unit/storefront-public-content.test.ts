/** Public Website Studio pages must not expose inactive or expired services/offers. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExperienceDocument } from "@/lib/experience/document";

const state = vi.hoisted(() => ({ offer: null as any, studioWebsite: null as any, serviceCalls: [] as any[] }));

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
    studioWebsite: { findFirst: vi.fn(async () => state.studioWebsite) },
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
  state.studioWebsite = null;
  state.serviceCalls.length = 0;
});

describe("public Website Studio content visibility", () => {

  /**
   * "Never published" and "explicitly unpublished" are different states and must behave
   * differently. Conflating them caused two customer-visible failures:
   *   • treating a merely-provisioned site as unpublished blanked live websites;
   *   • treating an unpublished site as merely-provisioned resurrected a legacy page the
   *     owner had taken down.
   * Both halves are asserted so neither can regress silently.
   */
  it("preserves legacy publication for a newly provisioned default site until Studio publication", async () => {
    state.studioWebsite = {
      id: "default-site",
      status: "DRAFT",
      content: { draftJson: null, publishedJson: null, draftVersion: 0, publishedVersion: 0 },
    };
    const page = await loadStorefront("default-site-legacy-fallback");
    // Provisioning a tenant for Studio must not take its existing website offline.
    expect(page).not.toBeNull();
    expect(page?.document.brand.businessName).toBe("Example business");
  });

  it("does not resurrect the legacy publication after an explicit default Studio unpublish", async () => {
    state.studioWebsite = {
      id: "default-site",
      status: "UNPUBLISHED",
      content: { draftJson: null, publishedJson: null, draftVersion: 0, publishedVersion: 0 },
    };
    const page = await loadStorefront("default-site-unpublished");
    // The owner asked for it to be gone; an older legacy snapshot must never reappear.
    expect(page).toBeNull();
  });

  it("never exposes a published snapshot of a suspended site", async () => {
    state.studioWebsite = {
      id: "default-site",
      status: "SUSPENDED",
      content: {
        draftJson: null,
        publishedJson: JSON.stringify(createExperienceDocument({ categoryKey: "retail", businessName: "Example business" })),
        draftVersion: 1,
        publishedVersion: 1,
      },
    };
    expect(await loadStorefront("default-site-suspended")).toBeNull();
  });

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
