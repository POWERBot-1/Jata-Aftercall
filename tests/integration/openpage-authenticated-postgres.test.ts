/**
 * Authenticated Website Studio generation/refinement against a real PostgreSQL database.
 *
 * The offline suite (`openpage-integration.test.ts`) proves the route contracts with a mocked
 * Prisma client. This file closes the remaining acceptance gap: a real registered tenant with a
 * real business row, the real Studio guards, the real read model and the real schema validation,
 * all on disposable test data. Nothing is written by generate/understand/refine.
 *
 * Runs only when a test database is configured; the offline suite skips it.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DATABASE_URL = (process.env.DATABASE_URL || process.env.E2E_DATABASE_URL || "").trim();
const enabled = DATABASE_URL.length > 0;

const h = vi.hoisted(() => ({
  session: { current: null as null | { userId: string; role: string } },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getSession: async () => h.session.current };
});

import prisma from "@/lib/db";
import { POST as understandPost } from "@/app/api/studio/openpage/understand/route";
import { POST as generatePost } from "@/app/api/studio/openpage/generate/route";
import { POST as refinePost } from "@/app/api/studio/openpage/refine/route";

const runId = Date.now().toString(36).slice(-6);
const created: Array<{ userId: string; businessId: string }> = [];

function request(body: unknown) {
  return new Request("https://jata.test/api/studio/openpage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createTenant(label: string, category: string) {
  const user = await prisma.user.create({
    data: {
      email: `openpage.${label}.${runId}@jata.test`,
      name: `OpenPage ${label}`,
      passwordHash: "not-a-real-login",
      role: "CUSTOMER",
    },
  });
  const business = await prisma.business.create({
    data: {
      ownerId: user.id,
      slug: `openpage-${label}-${runId}`,
      name: `OpenPage ${label}`,
      category,
      status: "ACTIVE",
      description: "Disposable authenticated acceptance tenant.",
    },
  });
  created.push({ userId: user.id, businessId: business.id });
  return { userId: user.id, businessId: business.id };
}

async function cleanup() {
  for (const { userId, businessId } of created) {
    try {
      await prisma.studioWorkspace.deleteMany({ where: { ownerUserId: userId } });
      await prisma.businessExperience.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.business.deleteMany({ where: { id: businessId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch {
      // Best effort; never mask an assertion failure.
    }
  }
}

describe.skipIf(!enabled)("authenticated Website Studio generation on PostgreSQL", () => {
  beforeAll(async () => {
    const owner = await createTenant("owner", "Restaurant");
    h.session.current = { userId: owner.userId, role: "OWNER" };
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect().catch(() => undefined);
  }, 120_000);

  it("understands a brief for the owning tenant and resolves a legacy category", async () => {
    const owner = created[0];
    const response = await understandPost(request({
      businessId: owner.businessId,
      prompt: "A warm nyama choma restaurant in Kitengela with the menu first",
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.saved).toBe(false);
    expect(body.requirements.businessType.categoryKey).toBe("food");
    expect(body.baseDraftVersion).toBe(1);
  }, 120_000);

  it("generates three distinct food candidates without writing a draft", async () => {
    const owner = created[0];
    const response = await generatePost(request({
      businessId: owner.businessId,
      prompt: "A warm nyama choma restaurant in Kitengela. Show the menu first and let people order.",
    }));
    expect(response.status, JSON.stringify(await response.clone().json().catch(() => null))).toBe(200);
    const body = await response.json();
    expect(body.saved).toBe(false);
    expect(body.candidates.length).toBeGreaterThanOrEqual(3);
    expect(body.candidates.every((candidate: { document: { categoryKey: string } }) => candidate.document.categoryKey === "food")).toBe(true);
    expect(await prisma.businessExperience.count({ where: { businessId: owner.businessId } })).toBe(0);
    expect(await prisma.experienceVersion.count({ where: { businessId: owner.businessId } })).toBe(0);
  }, 120_000);

  it("refines a generated candidate without writing or changing the tenant category", async () => {
    const owner = created[0];
    const generated = await generatePost(request({
      businessId: owner.businessId,
      prompt: "A warm nyama choma restaurant in Kitengela with a menu",
    }));
    expect(generated.status).toBe(200);
    const generatedBody = await generated.json();
    const candidate = generatedBody.candidates[0].document;

    const response = await refinePost(request({
      businessId: owner.businessId,
      message: "Make it more premium and put the menu first",
      document: candidate,
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.saved).toBe(false);
    expect(body.document.categoryKey).toBe("food");
    expect(await prisma.businessExperience.count({ where: { businessId: owner.businessId } })).toBe(0);
  }, 120_000);

  it("cannot generate for another owner's business", async () => {
    const stranger = await createTenant("stranger", "retail");
    const owner = created[0];
    h.session.current = { userId: owner.userId, role: "OWNER" };

    const response = await generatePost(request({
      businessId: stranger.businessId,
      prompt: "A premium retail shop with the catalogue first",
    }));
    expect(response.status).toBe(403);
    expect(await prisma.businessExperience.count({ where: { businessId: stranger.businessId } })).toBe(0);
  }, 120_000);

  it("requires a session", async () => {
    const owner = created[0];
    h.session.current = null;
    const response = await generatePost(request({
      businessId: owner.businessId,
      prompt: "A premium retail shop with the catalogue first",
    }));
    expect(response.status).toBe(401);
  }, 120_000);

  it("refuses to switch the owner's business type through a refinement payload", async () => {
    const owner = created[0];
    h.session.current = { userId: owner.userId, role: "OWNER" };
    const response = await refinePost(request({
      businessId: owner.businessId,
      message: "Make it more premium",
      document: {
        version: 2,
        categoryKey: "salon",
        themeKey: "food-grill",
        brand: { businessName: "OpenPage owner" },
        settings: {},
        sections: [],
      },
    }));
    // The client document is either refused by the schema or pinned to the tenant's category;
    // either way it can never become a salon site.
    if (response.status === 200) {
      const body = await response.json();
      expect(body.document.categoryKey).toBe("food");
    } else {
      expect(response.status).toBe(400);
    }
  }, 120_000);
});
