/**
 * /api/experience/assist — copy suggestions use the business's own draft (Phase 3 integration)
 *
 * Proves: authentication and tenant authorisation run before any draft is read; the draft is read
 * only for the authorised businessId; the draft's generation seed reaches the copy generation
 * context; a missing, malformed or unreadable draft degrades to the existing behaviour; and the
 * route still never writes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExperienceDocument, normalizeExperienceDocument } from "@/lib/experience/document";
import type { ExperienceDocument } from "@/lib/experience/types";

function draftWithSeed(seed: string | null, businessName = "Mama Njeri Kitchen"): string {
  const doc: ExperienceDocument = normalizeExperienceDocument(
    createExperienceDocument({ categoryKey: "food", businessName, phone: "0712345678", location: "Westlands" }),
  );
  if (seed) doc.generation = { seed, version: 1, attempt: 0 };
  return JSON.stringify(doc);
}

const mocks = vi.hoisted(() => ({
  session: { userId: "owner-a", role: "OWNER" } as any,
  guard: { ok: true } as { ok: boolean; status?: number; error?: string },
  experience: null as any,
  experienceError: false,
  experienceFindArgs: [] as any[],
  writes: [] as any[],
  copyCalls: [] as any[],
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({ guardTenantMutation: vi.fn(async () => mocks.guard) }));
vi.mock("@/lib/db", () => ({
  default: {
    businessExperience: {
      findUnique: vi.fn(async (args: any) => {
        mocks.experienceFindArgs.push(args);
        if (mocks.experienceError) throw new Error("db unavailable");
        return mocks.experience;
      }),
      update: vi.fn(async (args: any) => {
        mocks.writes.push(args);
        return {};
      }),
    },
  },
}));
vi.mock("@/lib/ai/copyLab", () => ({
  writeStudioCopy: vi.fn(async (request: any) => {
    mocks.copyCalls.push(request);
    return { kind: request.kind, label: "Headline", suggestions: [], requiresApproval: true, deterministic: true, provider: { key: "jata-local", label: "JATA" }, rejected: 0, note: "" };
  }),
}));

import { POST } from "@/app/api/experience/assist/route";

function request(body: unknown) {
  return new Request("http://localhost/api/experience/assist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ask = (businessId: string, extra: Record<string, unknown> = {}) => ({ businessId, kind: "HERO_HEADLINE", ...extra });

describe("POST /api/experience/assist uses the authorised business's draft", () => {
  beforeEach(() => {
    mocks.session = { userId: "owner-a", role: "OWNER" };
    mocks.guard = { ok: true };
    mocks.experience = null;
    mocks.experienceError = false;
    mocks.experienceFindArgs = [];
    mocks.writes = [];
    mocks.copyCalls = [];
  });

  it("rejects an unauthenticated request before reading any draft", async () => {
    mocks.session = null;
    const res = await POST(request(ask("biz-a")));
    expect(res.status).toBe(401);
    expect(mocks.experienceFindArgs).toHaveLength(0);
    expect(mocks.copyCalls).toHaveLength(0);
  });

  it("rejects a business the caller does not own before reading any draft", async () => {
    mocks.guard = { ok: false, status: 403, error: "No access" };
    const res = await POST(request(ask("biz-someone-else")));
    expect(res.status).toBe(403);
    expect(mocks.experienceFindArgs).toHaveLength(0);
    expect(mocks.copyCalls).toHaveLength(0);
  });

  it("reads the draft only for the authorised businessId", async () => {
    mocks.experience = { draftJson: draftWithSeed("biz-a:4"), categoryKey: "food" };
    await POST(request(ask("biz-a")));
    expect(mocks.experienceFindArgs).toEqual([expect.objectContaining({ where: { businessId: "biz-a" } })]);
  });

  it("propagates the draft's generation seed into the copy generation context", async () => {
    mocks.experience = { draftJson: draftWithSeed("biz-a:4"), categoryKey: "food" };
    const res = await POST(request(ask("biz-a")));
    expect(res.status).toBe(200);
    expect(mocks.copyCalls).toHaveLength(1);
    expect(mocks.copyCalls[0].designContext?.variation?.seed).toBe("biz-a:4");
    expect(mocks.copyCalls[0].designContext?.categoryKey).toBe("food");
  });

  it("uses no variation when the draft has no seeded generation, and still uses the draft's brand context", async () => {
    mocks.experience = { draftJson: draftWithSeed(null), categoryKey: "food" };
    await POST(request(ask("biz-a")));
    const design = mocks.copyCalls[0].designContext;
    expect(design).toBeTruthy();
    expect(design.variation ?? null).toBeNull();
    expect(design.businessName).toBe("Mama Njeri Kitchen");
  });

  it("falls back to the existing behaviour when the business has no draft", async () => {
    mocks.experience = null;
    const res = await POST(request(ask("biz-a")));
    expect(res.status).toBe(200);
    expect(mocks.copyCalls[0].designContext).toBeNull();
  });

  it("does not fail the request on a malformed draft", async () => {
    mocks.experience = { draftJson: "{not json", categoryKey: "food" };
    const res = await POST(request(ask("biz-a")));
    expect(res.status).toBe(200);
    expect(mocks.copyCalls[0].designContext).toBeNull();
  });

  it("does not fail the request when the draft lookup errors, and writes nothing", async () => {
    mocks.experienceError = true;
    const res = await POST(request(ask("biz-a")));
    expect(res.status).toBe(200);
    expect(mocks.copyCalls[0].designContext).toBeNull();
    expect(mocks.writes).toHaveLength(0);
  });

  it("never writes the draft, even when a seed is present", async () => {
    mocks.experience = { draftJson: draftWithSeed("biz-a:4"), categoryKey: "food" };
    await POST(request(ask("biz-a")));
    expect(mocks.writes).toHaveLength(0);
  });

  it("still refuses commercial data (prices, stock) before any draft is read", async () => {
    mocks.experience = { draftJson: draftWithSeed("biz-a:4"), categoryKey: "food" };
    const res = await POST(request(ask("biz-a", { price: 1200 })));
    expect(res.status).toBe(400);
    expect(mocks.experienceFindArgs).toHaveLength(0);
    expect(mocks.copyCalls).toHaveLength(0);
  });
});
