/**
 * AI image lab integration — success, caching, quota and failure (§11–§17, §41, §51)
 *
 * The Studio's "Create with JATA" runs against the real orchestration module with a fake
 * database and the built-in (offline) provider, so the behaviour asserted here is the behaviour
 * that ships: real PNG bytes, a real MediaAsset row, a real AiGeneration audit row, honest
 * representative labelling, no duplicate spends — and, when a vendor fails, a plain sentence
 * instead of a stack trace and no broken half-state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  business: null as any,
  experience: null as any,
  entitlement: null as any,
  aiConfig: null as any,
  product: null as any,
  service: null as any,
  assets: [] as any[],
  generations: [] as any[],
  generationUpdates: [] as any[],
}));

vi.mock("@/lib/db", () => ({
  default: {
    business: { findUnique: vi.fn(async () => mocks.business) },
    businessExperience: { findUnique: vi.fn(async () => mocks.experience) },
    interactiveBusinessEntitlement: { findUnique: vi.fn(async () => mocks.entitlement) },
    aIConfiguration: { findUnique: vi.fn(async () => mocks.aiConfig) },
    product: { findFirst: vi.fn(async () => mocks.product) },
    service: { findFirst: vi.fn(async () => mocks.service) },
    mediaAsset: {
      findFirst: vi.fn(async ({ where }: any) => mocks.assets.find((asset) => asset.hash === where.hash && asset.businessId === where.businessId) || null),
      findMany: vi.fn(async ({ where }: any) => mocks.assets.filter((asset) => asset.businessId === where.businessId && (!where.id || where.id.in.includes(asset.id)))),
      create: vi.fn(async ({ data }: any) => {
        const asset = { id: `asset-${mocks.assets.length + 1}`, createdAt: new Date(), ...data };
        mocks.assets.push(asset);
        return asset;
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    aiGeneration: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `gen-${mocks.generations.length + 1}`, createdAt: new Date(), ...data };
        mocks.generations.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        mocks.generationUpdates.push({ where, data });
        // Mutate the stored row the way the database would, so quota and cache lookups see it.
        const row = mocks.generations.find((generation) => generation.id === where.id);
        if (row) Object.assign(row, data);
        return { id: where.id, ...data };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const rows = mocks.generations.filter((row) => row.businessId === where.businessId);
        if (where.kind) return rows.filter((row) => row.kind === where.kind).at(-1) || null;
        return rows.at(-1) || null;
      }),
      findMany: vi.fn(async ({ where }: any) => mocks.generations.filter((row) => row.businessId === where.businessId)),
    },
  },
}));

import { enhanceStudioImage, generateStudioImages, imageLabInfo, loadBusinessContext } from "@/lib/ai/imageLab";
import { localProvider } from "@/lib/ai/providers/local";
import { promptHash } from "@/lib/ai/generationStore";
import { INTERACTIVE_AI_QUOTA, PREVIEW_AI_QUOTA } from "@/lib/ai/quota";
import { tinyPngDataUrl } from "../helpers/imageFixtures";

const AI_ENV = ["JATA_AI_IMAGE_PROVIDER", "JATA_AI_TEXT_PROVIDER", "OPENAI_API_KEY", "GEMINI_API_KEY"] as const;
const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of AI_ENV) {
    original[key] = process.env[key];
    delete process.env[key];
  }
  mocks.business = { id: "business-a", name: "Mama Njeri's Kitchen", category: "Food & Restaurant", location: "Kilimani" };
  mocks.experience = {
    categoryKey: "food",
    themeKey: "food-grill",
    draftJson: JSON.stringify({
      categoryKey: "food",
      themeKey: "food-grill",
      brand: { businessName: "Mama Njeri's Kitchen", primaryColor: "#8B1E1E", accentColor: "#F2B544" },
      photographyStyle: "warm",
      sections: [],
    }),
  };
  mocks.entitlement = { status: "ACTIVE", packageKey: "INTERACTIVE_BUSINESS" };
  mocks.aiConfig = { toneOfVoice: "Warm and welcoming" };
  mocks.product = { name: "Chicken stew", description: "Served in a black bowl with chapati" };
  mocks.service = { title: "Bridal makeup", description: "At your home in Nairobi" };
  mocks.assets = [];
  mocks.generations = [];
  mocks.generationUpdates = [];
  vi.restoreAllMocks();
});

afterEach(() => {
  for (const key of AI_ENV) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("generating images for a business", () => {
  it("creates real, stored, clearly-labelled candidates and records the generation", async () => {
    const outcome = await generateStudioImages({
      businessId: "business-a",
      userId: "user-a",
      preset: "product-photo",
      subjectType: "PRODUCT",
      subjectId: "product-1",
      count: 2,
    });

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;

    expect(outcome.assets).toHaveLength(2);
    for (const asset of outcome.assets) {
      expect(asset.url.startsWith("data:image/png;base64,")).toBe(true);
      expect(asset.source).toBe("AI_GENERATED");
      // The built-in provider designs artwork — it must never be presented as a photo of the dish.
      expect(asset.label).toBe("REPRESENTATIVE");
      expect(asset.alt).toContain("Chicken stew");
      expect(asset.alt).toContain("JATA designed");
      expect(asset.aiGenerationId).toBe(outcome.generationId);
    }

    // The audit row is what the "JATA history" panel and the usage meter read.
    expect(mocks.generations).toHaveLength(1);
    expect(mocks.generations[0].businessId).toBe("business-a");
    expect(mocks.generations[0].userId).toBe("user-a");
    expect(mocks.generations[0].subjectId).toBe("product-1");
    expect(mocks.generations[0].prompt).toContain("Chicken stew");
    expect(mocks.generations[0].providerKey).toBe("jata-local");
    const finished = mocks.generationUpdates.at(-1);
    expect(finished.data.status).toBe("SUCCEEDED");
    expect(JSON.parse(finished.data.assetIds)).toHaveLength(2);

    // The owner is told, in plain words, what they got and what it is not.
    expect(outcome.notes.join(" ")).toContain("designed image");
    expect(outcome.notes.join(" ")).toContain("Nothing changes on your website until you choose an image");
    expect(outcome.quota.remainingImages).toBe(INTERACTIVE_AI_QUOTA.imagesPerMonth - 2);
  });

  it("never re-reads a product from another business as the subject", async () => {
    mocks.product = null; // The scoped lookup returns nothing for a foreign id.
    const outcome = await generateStudioImages({
      businessId: "business-a",
      preset: "product-photo",
      subjectType: "PRODUCT",
      subjectId: "someone-elses-product",
      count: 1,
    });
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.httpStatus).toBe(404);
    expect(outcome.error).toContain("not part of this business");
    expect(mocks.generations).toHaveLength(0);
    expect(mocks.assets).toHaveLength(0);
  });

  it("reuses the images it already created for an identical request instead of paying twice", async () => {
    const spy = vi.spyOn(localProvider, "generateImage");
    const request = { businessId: "business-a", preset: "product-photo", subjectType: "PRODUCT" as const, subjectId: "product-1", count: 2 };

    const first = await generateStudioImages(request);
    expect(first.status).toBe("ok");
    expect(spy).toHaveBeenCalledTimes(1);

    const second = await generateStudioImages(request);
    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;
    expect(second.cached).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second.notes.join(" ")).toContain("nothing was regenerated");
    expect(mocks.generations).toHaveLength(1);
  });

  it("serves the cache from the stored prompt hash, so a repeat is recognised even after a restart", async () => {
    await generateStudioImages({ businessId: "business-a", preset: "product-photo", subjectType: "PRODUCT", subjectId: "product-1", count: 2 });
    const row = mocks.generations[0];
    expect(row.promptHash).toBe(promptHash(row.prompt));
    expect(row.promptHash).toHaveLength(32);
  });

  it("waits out the cooldown between spends, then creates a genuinely new set on request", async () => {
    const spy = vi.spyOn(localProvider, "generateImage");
    const request = { businessId: "business-a", preset: "product-photo", subjectType: "PRODUCT" as const, subjectId: "product-1", count: 2 };
    await generateStudioImages(request);

    // Tapping again immediately must not spend a second generation: the owner is told to wait.
    const tooSoon = await generateStudioImages({ ...request, refresh: true });
    expect(tooSoon.status).toBe("error");
    if (tooSoon.status !== "error") return;
    expect(tooSoon.code).toBe("too_soon");
    expect(spy).toHaveBeenCalledTimes(1);

    // Once the cooldown has passed, "Create other options" deliberately bypasses the cache.
    for (const row of mocks.generations) row.createdAt = new Date(Date.now() - 60_000);
    const refreshed = await generateStudioImages({ ...request, refresh: true });
    expect(refreshed.status).toBe("ok");
    if (refreshed.status !== "ok") return;
    expect(refreshed.cached).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("blocks generation when the monthly allowance is spent, without calling a provider", async () => {
    mocks.entitlement = null; // Preview allowance: 3 images a month.
    const now = new Date();
    mocks.generations = Array.from({ length: PREVIEW_AI_QUOTA.imagesPerMonth }, (_, index) => ({
      id: `gen-old-${index}`,
      businessId: "business-a",
      kind: "IMAGE",
      status: "SUCCEEDED",
      createdAt: new Date(now.getTime() - (index + 1) * 3600_000),
    }));
    const spy = vi.spyOn(localProvider, "generateImage");
    const outcome = await generateStudioImages({ businessId: "business-a", preset: "product-photo", count: 1 });
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.httpStatus).toBe(402);
    expect(outcome.code).toBe("quota_exhausted");
    expect(outcome.error).toContain("1st");
    expect(spy).not.toHaveBeenCalled();
  });

  it("stops a double tap from spending two generations", async () => {
    mocks.generations = [
      { id: "gen-recent", businessId: "business-a", kind: "IMAGE", status: "SUCCEEDED", createdAt: new Date(Date.now() - 500) },
    ];
    const outcome = await generateStudioImages({ businessId: "business-a", preset: "product-photo", count: 1 });
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.httpStatus).toBe(429);
    expect(outcome.code).toBe("too_soon");
    expect(outcome.error).toContain("few seconds");
  });

  it("reports a vendor outage as a sentence, marks the generation failed, and leaks nothing", async () => {
    process.env.OPENAI_API_KEY = "sk-live-do-not-leak";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "upstream exploded at ip 10.0.0.1" } }), { status: 500 })),
    );
    const outcome = await generateStudioImages({ businessId: "business-a", preset: "product-photo", count: 1 });
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.error).not.toContain("sk-live-do-not-leak");
    expect(outcome.error).not.toContain("10.0.0.1");
    expect(outcome.error).toContain("safe");
    expect(outcome.retryable).toBe(true);
    expect(mocks.generationUpdates.at(-1)?.data.status).toBe("FAILED");
    expect(mocks.assets).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("describes the studio state for the owner without exposing secrets", async () => {
    process.env.OPENAI_API_KEY = "sk-live-do-not-leak";
    const info = await imageLabInfo("business-a");
    expect(info.presets.length).toBeGreaterThan(3);
    expect(info.styles.length).toBeGreaterThan(3);
    expect(info.quota.summary).toContain("AI images");
    expect(JSON.stringify(info)).not.toContain("sk-live-do-not-leak");
    vi.unstubAllGlobals();
  });
});

describe("improving a real photo", () => {
  it("stores a photo improved on the owner's phone as their own photo, not as an AI photograph", async () => {
    const outcome = await enhanceStudioImage({
      businessId: "business-a",
      userId: "user-a",
      imageDataUrl: tinyPngDataUrl(),
      mode: "device",
      applied: ["brightness", "contrast"],
      assetId: "asset-original",
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.assets).toHaveLength(1);
    // The pixels are the owner's own picture, lightly improved: recorded honestly.
    expect(outcome.assets[0].label).toBe("ACTUAL");
    expect(outcome.notes.join(" ")).toMatch(/original|untouched/i);
    const row = mocks.generations.find((generation) => generation.kind === "ENHANCE");
    expect(row?.providerKey).toBe("device-canvas");
    expect(row?.capability).toBe("device");
  });

  it("offers the on-device route when no editing provider is connected, instead of a dead button", async () => {
    const outcome = await enhanceStudioImage({
      businessId: "business-a",
      imageDataUrl: tinyPngDataUrl(),
      mode: "provider",
    });
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.code).toBe("not_configured");
    expect(outcome.error).toContain("my phone");
    expect(outcome.retryable).toBe(false);
  });

  it("asks for a photo when the request contains none", async () => {
    const outcome = await enhanceStudioImage({ businessId: "business-a", imageDataUrl: "not-an-image", mode: "device" });
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.httpStatus).toBe(400);
    expect(outcome.error).toContain("Choose a photo");
  });

  it("loads the business's own design context so every image matches the website", async () => {
    const context = await loadBusinessContext("business-a");
    expect(context?.design.businessName).toBe("Mama Njeri's Kitchen");
    expect(context?.design.palette.primary).toBe("#8B1E1E");
    expect(context?.design.photography.key).toBe("warm");
    expect(context?.design.categoryKey).toBe("food");
    expect(context?.entitled).toBe(true);
  });
});

describe("a created image can actually be used on the website", () => {
  it("produces an asset the document will accept as a product, hero or section image", async () => {
    const { safeUrl } = await import("@/lib/experience/document");
    const outcome = await generateStudioImages({ businessId: "business-a", userId: "user-a", preset: "hero", placement: "hero", count: 1 });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    const asset = outcome.assets[0];

    // The exact URL the Studio hands to a product, hero or section field must survive the
    // document's own sanitiser — otherwise the owner would pick an image that then disappears.
    expect(safeUrl(asset.url)).toBe(asset.url);
    expect(asset.id).toBeTruthy();

    // And it is a real image the storefront can measure and label, not a placeholder.
    expect(asset.width).toBeGreaterThan(0);
    expect(asset.height).toBeGreaterThan(0);
    expect(asset.label).toBe("REPRESENTATIVE");
  });

  it("keeps everything it creates inside the one storage ceiling the document enforces", async () => {
    const { MAX_STORED_CHARS } = await import("@/lib/media/imageFormat");
    const outcome = await generateStudioImages({ businessId: "business-a", userId: "user-a", preset: "product-photo", placement: "product", count: 2, refresh: true });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    for (const asset of outcome.assets) expect(asset.url.length).toBeLessThanOrEqual(MAX_STORED_CHARS);
  });
});
