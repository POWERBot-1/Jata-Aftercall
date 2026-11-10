/**
 * OpenPage → JATA integration tests.
 *
 * These exercise the real adapter, generator and refinement engine plus the three
 * authenticated Website Studio routes. The routes are read-only: they can propose
 * candidates but cannot write a draft, publish, or touch another tenant.
 *
 * Draft-version compare-and-set and publication/rollback are owned by
 * `tests/integration/experience-draft-concurrency.test.ts`,
 * `tests/integration/experience-version-guard.test.ts` and
 * `tests/integration/experience-publish.test.ts`; the last test here proves the new
 * generation endpoints cannot bypass them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addSection, createExperienceDocument, normalizeExperienceDocument } from "@/lib/experience/document";
import { validateExperienceDocument } from "@/lib/experience/schema";
import { experienceToSiteConfig, siteConfigToExperience } from "@/lib/openpage/adapter";
import { briefFromRequirements, understandBrief } from "@/lib/openpage/requirements";
import { generateStudioCandidates } from "@/lib/openpage/generate";
import { refineWebsite } from "@/lib/openpage/refine";
import type { SiteConfig } from "@/lib/openpage/types";

const OWNED = "business-a";
const FOREIGN = "business-b";

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "OWNER" } as { userId: string; role: string } | null,
  business: {
    id: "business-a", name: "Choma Place", slug: "choma-place", category: "food",
    description: "Nyama choma in Kitengela", location: "Kitengela", phone: null as string | null,
    whatsapp: null as string | null, openingHours: null as string | null, isPublished: false,
  },
  experience: null as null | {
    draftJson: string; categoryKey: string; themeKey: string; draftVersion: number; publishedVersion: number;
  },
  update: vi.fn(),
  experienceVersionFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({
  TenantError: class TenantError extends Error { status = 403; },
  getOwnedBusinessIds: vi.fn(async () => [OWNED]),
  assertBusinessOwnership: vi.fn(async () => undefined),
  guardTenantMutation: vi.fn(async (_session: unknown, businessId: string) => {
    if (!businessId) return { ok: false as const, error: "Choose a business first.", status: 400 as const };
    if (businessId !== OWNED) return { ok: false as const, error: "You do not have access to that business.", status: 403 as const };
    return { ok: true as const };
  }),
}));
vi.mock("@/lib/db", () => ({
  default: {
    business: { findUnique: vi.fn(async () => mocks.business) },
    businessExperience: {
      findUnique: vi.fn(async () => mocks.experience),
      update: mocks.update,
      upsert: vi.fn(),
      create: vi.fn(),
    },
    product: { count: vi.fn(async () => 4), findMany: vi.fn(async () => []) },
    service: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    mediaAsset: { count: vi.fn(async () => 0) },
    experienceVersion: { findMany: mocks.experienceVersionFindMany },
    experienceDraftRevision: { deleteMany: vi.fn(), create: vi.fn(), findMany: vi.fn(async () => []) },
    auditEvent: { create: vi.fn() },
  },
}));

import { POST as understandRoute } from "@/app/api/studio/openpage/understand/route";
import { POST as generateRoute } from "@/app/api/studio/openpage/generate/route";
import { POST as refineRoute } from "@/app/api/studio/openpage/refine/route";
import { PATCH as experiencePatch } from "@/app/api/experience/route";

function request(body: unknown) {
  return new Request("https://jata.test/api/studio/openpage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function foodDocument() {
  const document = createExperienceDocument({
    categoryKey: "food",
    businessName: "Choma Place",
    description: "Nyama choma in Kitengela",
    location: "Kitengela",
  });
  return addSection(document, "gallery");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "user-a", role: "OWNER" };
  mocks.experience = {
    draftJson: JSON.stringify(foodDocument()),
    categoryKey: "food",
    themeKey: "food-grill",
    draftVersion: 3,
    publishedVersion: 2,
  };
  mocks.experienceVersionFindMany.mockResolvedValue([]);
  mocks.update.mockImplementation(async (args: { where: { draftVersion: number }; data: { draftJson: string; draftVersion: number } }) => {
    if (!mocks.experience || args.where.draftVersion !== mocks.experience.draftVersion) {
      throw Object.assign(new Error("Record not found"), { code: "P2025" });
    }
    mocks.experience = { ...mocks.experience, draftJson: args.data.draftJson, draftVersion: args.data.draftVersion };
    return { id: "exp-a", draftVersion: args.data.draftVersion, publishedVersion: 2, status: "PUBLISHED", updatedAt: new Date(0) };
  });
});

describe("SiteConfig ↔ Experience adapter", () => {
  it("round-trips a legacy v1 document without inventing art direction or dropping sections", () => {
    const original = foodDocument();
    const forward = experienceToSiteConfig(original, { seed: "round-trip" });
    expect(forward.mapped).toHaveLength(original.sections.length);
    expect(forward.config.blocks.length).toBeGreaterThanOrEqual(original.sections.length);

    const back = siteConfigToExperience(forward.config, original, { seed: "round-trip" });
    expect(validateExperienceDocument(back.document).ok).toBe(true);
    expect(back.document.version).toBe(1);
    expect(back.document.artDirection).toBeUndefined();
    expect(back.document.categoryKey).toBe(original.categoryKey);
    expect(back.document.themeKey).toBe(original.themeKey);
    expect(back.document.sections.map((section) => section.type)).toEqual(original.sections.map((section) => section.type));
    expect(back.document.sections.find((section) => section.type === "hero")?.title).toBe("Choma Place");
  });

  it("reports unsupported OpenPage blocks explicitly and never imports their invented facts", () => {
    const original = foodDocument();
    const forward = experienceToSiteConfig(original, { seed: "unsupported" });
    const config = {
      ...forward.config,
      pages: [{
        ...forward.config.pages![0],
        blocks: [
          ...forward.config.blocks,
          { id: "op_pricing_fake", type: "pricing", variant: "cards", props: { title: "Plans", plans: [{ name: "Gold", price: "KES 5,000" }] } },
          { id: "op_stats_fake", type: "stats", variant: "grid", props: { stats: [{ value: "200+", label: "Projects" }] } },
          { id: "op_team_fake", type: "team", variant: "grid", props: { members: [{ name: "Jane Doe", role: "Founder" }] } },
        ],
      }],
    } as unknown as SiteConfig;

    const back = siteConfigToExperience(config, original, { seed: "unsupported" });
    expect(back.unsupported.map((entry) => entry.blockType)).toEqual(expect.arrayContaining(["pricing", "stats", "team"]));
    expect(back.unsupported.filter((entry) => ["pricing", "stats", "team"].includes(entry.blockType || ""))).toHaveLength(3);
    expect(back.unsupported.every((entry) => entry.severity === "warning")).toBe(true);
    expect(back.unsupported.find((entry) => entry.blockType === "pricing")?.code).toBe("dropped_block");
    expect(back.unsupported.find((entry) => entry.blockType === "pricing")?.message).toContain("top-level block list is authoritative");
    const serialized = JSON.stringify(back.document);
    expect(serialized).not.toContain("KES 5,000");
    expect(serialized).not.toContain("Jane Doe");
    expect(serialized).not.toContain("200+");
    expect(validateExperienceDocument(back.document).ok).toBe(true);
  });

  it("reports top-level pricing, stats and team blocks as unsupported without importing invented facts", () => {
    const original = foodDocument();
    const blocks = [
      { id: "op_hero", type: "hero", variant: "centered", props: { headline: "Choma Place" } },
      { id: "op_pricing_fake", type: "pricing", variant: "simple", props: { title: "Plans", tiers: [{ name: "Gold", price: "KES 5,000" }] } },
      { id: "op_stats_fake", type: "stats", variant: "grid", props: { items: [{ value: "200+", label: "Projects" }] } },
      { id: "op_team_fake", type: "team", variant: "grid", props: { members: [{ name: "Jane Doe", role: "Founder" }] } },
    ];
    const config = {
      name: "Choma Place",
      pages: [{ id: "page-home", name: "Home", path: "/", blocks }],
      blocks,
    } as unknown as SiteConfig;

    const back = siteConfigToExperience(config, original, { seed: "unsupported-top-level" });
    const unsupported = back.unsupported.filter((entry) => entry.code === "unsupported_openpage_block");
    expect(unsupported.map((entry) => entry.blockType)).toEqual(expect.arrayContaining(["pricing", "stats", "team"]));
    expect(unsupported).toHaveLength(3);
    expect(unsupported.every((entry) => entry.severity === "warning")).toBe(true);
    const serialized = JSON.stringify(back.document);
    expect(serialized).not.toContain("KES 5,000");
    expect(serialized).not.toContain("Jane Doe");
    expect(serialized).not.toContain("200+");
    expect(validateExperienceDocument(back.document).ok).toBe(true);
  });

  it("retains existing JATA sections that have no OpenPage block", () => {
    const original = foodDocument();
    const config = {
      name: "Choma Place",
      pages: [{ id: "page-home", name: "Home", path: "/", blocks: [{ id: "op_hero", type: "hero", variant: "centered", props: { headline: "Choma Place" } }] }],
      blocks: [{ id: "op_hero", type: "hero", variant: "centered", props: { headline: "Choma Place" } }],
    } as unknown as SiteConfig;
    const back = siteConfigToExperience(config, original, { seed: "retain" });
    const types = back.document.sections.map((section) => section.type);
    expect(types).toEqual(expect.arrayContaining(["featured", "menu", "contact", "gallery"]));
  });
});

describe("generation and refinement", () => {
  it("generates three distinct, schema-valid candidates from one brief without writing anything", () => {
    const base = foodDocument();
    const facts = {
      name: "Choma Place", categoryKey: "food", description: "Nyama choma in Kitengela",
      location: "Kitengela", phone: null, whatsapp: null, openingHours: null,
      products: 4, services: 0, images: 0,
    };
    const requirements = understandBrief(
      "A warm nyama choma spot in Kitengela. Show the menu first, let people order and make it feel premium.",
      facts,
    );
    const result = generateStudioCandidates({
      baseDocument: base,
      businessId: OWNED,
      requirements,
      brief: briefFromRequirements(requirements),
      counts: { products: 4, services: 0 },
      seed: "fixed-test-seed",
    });

    expect(result.candidates).toHaveLength(3);
    expect(result.materiallyDistinct).toBe(true);
    expect(new Set(result.candidates.map((candidate) => candidate.family)).size).toBe(3);
    const structures = result.candidates.map((candidate) =>
      candidate.document.sections.map((section) => `${section.visible ? "v" : "h"}:${section.type}:${section.layout || "-"}`).join(">"),
    );
    expect(new Set(structures).size).toBe(3);
    for (const candidate of result.candidates) {
      expect(validateExperienceDocument(candidate.document).ok).toBe(true);
      expect(candidate.similarityToOthers).toBeLessThan(0.85);
      expect(candidate.generationKind).toBe("deterministic-jata-experience+openpage-plan");
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refuses protected-fact edits and keeps the document byte-identical", () => {
    const base = foodDocument();
    const facts = { name: "Choma Place", categoryKey: "food", description: null, location: "Kitengela", phone: null, whatsapp: null, openingHours: null, products: 4, services: 0, images: 0 };
    const requirements = understandBrief("restaurant menu", facts);
    const result = refineWebsite({ document: base, message: "Change the price to 100 and update my WhatsApp", requirements });
    expect(result.changed).toBe(false);
    expect(result.intent).toBe("protected_fact");
    expect(result.document).toEqual(base);
  });

  it("refines layout, order, visibility and theme through the adapter gate", () => {
    const base = foodDocument();
    const facts = { name: "Choma Place", categoryKey: "food", description: null, location: "Kitengela", phone: null, whatsapp: null, openingHours: null, products: 4, services: 0, images: 0 };
    const requirements = understandBrief("restaurant menu", facts);

    const premium = refineWebsite({ document: base, message: "Make it more premium", requirements, seed: "refine" });
    expect(premium.changed).toBe(true);
    expect(premium.intent).toBe("art_direction");
    expect(validateExperienceDocument(premium.document).ok).toBe(true);

    const menuFirst = refineWebsite({ document: base, message: "Put the menu first", requirements, seed: "refine" });
    expect(menuFirst.changed).toBe(true);
    expect(menuFirst.document.sections.findIndex((section) => section.type === "menu")).toBeLessThan(
      menuFirst.document.sections.findIndex((section) => section.type === "about"),
    );

    const hide = refineWebsite({ document: base, message: "Hide the gallery", requirements, seed: "refine" });
    expect(hide.changed).toBe(true);
    expect(hide.document.sections.find((section) => section.type === "gallery")?.visible).toBe(false);

    const shorter = refineWebsite({ document: base, message: "Make it shorter", requirements, seed: "refine" });
    expect(shorter.changed).toBe(true);
    expect(validateExperienceDocument(shorter.document).ok).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("save and reopen through the existing versioned draft API", () => {
  it("persists a generated candidate unchanged and returns the new draft version", async () => {
    const base = foodDocument();
    const facts = { name: "Choma Place", categoryKey: "food", description: null, location: "Kitengela", phone: null, whatsapp: null, openingHours: null, products: 4, services: 0, images: 0 };
    const requirements = understandBrief("restaurant menu", facts);
    const generated = generateStudioCandidates({
      baseDocument: base,
      businessId: OWNED,
      requirements,
      brief: briefFromRequirements(requirements),
      counts: { products: 4, services: 0 },
      seed: "save-reopen",
    }).candidates[0];

    const response = await experiencePatch(request({
      businessId: OWNED,
      document: generated.document,
      expectedDraftVersion: 3,
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.saved).toBe(true);
    expect(body.experience.draftVersion).toBe(4);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const persisted = mocks.update.mock.calls[0][0].data.draftJson as string;
    const reopened = normalizeExperienceDocument(JSON.parse(persisted));
    expect(reopened.themeKey).toBe(generated.document.themeKey);
    expect(reopened.artDirection).toEqual(generated.document.artDirection);
    expect(reopened.sections.map((section) => section.type)).toEqual(generated.document.sections.map((section) => section.type));
    expect(reopened.brand.heroImageUrl).toBe(generated.document.brand.heroImageUrl);
  });
});

describe("authenticated Studio routes", () => {
  it("understands a brief for the owning tenant and returns the current draft version", async () => {
    const response = await understandRoute(request({ businessId: OWNED, prompt: "A warm nyama choma restaurant in Kitengela with a menu first" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.saved).toBe(false);
    expect(body.baseDraftVersion).toBe(3);
    expect(body.requirements.businessType.categoryKey).toBe("food");
    expect(body.requirements.goal).toBe("sell");
  });

  it("generates candidates for the owning tenant without writing a draft or publishing", async () => {
    const response = await generateRoute(request({
      businessId: OWNED,
      prompt: "A warm nyama choma restaurant in Kitengela. Show the menu first and let people order.",
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.saved).toBe(false);
    expect(body.baseDraftVersion).toBe(3);
    expect(body.candidates.length).toBeGreaterThanOrEqual(3);
    expect(body.baseDraftVersion).toBe(3);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refines a preview for the owning tenant without writing a draft", async () => {
    const response = await refineRoute(request({
      businessId: OWNED,
      message: "Put the menu first",
      document: foodDocument(),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.saved).toBe(false);
    expect(body.baseDraftVersion).toBe(3);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("denies a foreign business before any database read", async () => {
    const prisma = (await import("@/lib/db")).default;
    const response = await generateRoute(request({ businessId: FOREIGN, prompt: "A warm restaurant with a menu" }));
    expect(response.status).toBe(403);
    expect(prisma.business.findUnique).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mocks.session = null;
    const response = await understandRoute(request({ businessId: OWNED, prompt: "A warm restaurant with a menu" }));
    expect(response.status).toBe(401);
  });

  it("rejects a client document that tries to switch the tenant's category", async () => {
    const foreignDocument = { ...foodDocument(), categoryKey: "salon" };
    const response = await refineRoute(request({
      businessId: OWNED,
      message: "Make it more premium",
      document: foreignDocument,
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.document.categoryKey).toBe("food");
  });
});
