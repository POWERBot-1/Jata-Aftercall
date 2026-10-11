/**
 * /api/experience/variant — the Studio's "Try another layout" preview (Phase 3)
 *
 * Proves: authentication and tenant authorisation run first; the route reads only the requested
 * business's draft and history; it never writes the draft (the owner must apply a candidate through
 * the existing draft path); and the response is reproducible for the same seed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExperienceDocument, normalizeExperienceDocument } from "@/lib/experience/document";

const draft = normalizeExperienceDocument(createExperienceDocument({ categoryKey: "food", businessName: "Mama Njeri Kitchen" }));

const mocks = vi.hoisted(() => ({
  session: { userId: "owner-a", role: "OWNER" } as any,
  guard: { ok: true } as { ok: boolean; status?: number; error?: string },
  experience: null as any,
  versions: [] as any[],
  experienceUpdates: [] as any[],
  experienceFindArgs: [] as any[],
  versionFindArgs: [] as any[],
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({
  guardTenantMutation: vi.fn(async () => mocks.guard),
}));
vi.mock("@/lib/db", () => ({
  default: {
    businessExperience: {
      findUnique: vi.fn(async (args: any) => {
        mocks.experienceFindArgs.push(args);
        return mocks.experience;
      }),
      update: vi.fn(async (args: any) => {
        mocks.experienceUpdates.push(args);
        return {};
      }),
    },
    experienceVersion: {
      findMany: vi.fn(async (args: any) => {
        mocks.versionFindArgs.push(args);
        return mocks.versions;
      }),
    },
  },
}));

import { POST } from "@/app/api/experience/variant/route";

function request(body: unknown) {
  return new Request("http://localhost/api/experience/variant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/experience/variant", () => {
  beforeEach(() => {
    mocks.session = { userId: "owner-a", role: "OWNER" };
    mocks.guard = { ok: true };
    mocks.experience = { draftJson: JSON.stringify(draft), categoryKey: "food", draftVersion: 4 };
    mocks.versions = [{ snapshotJson: JSON.stringify(draft) }];
    mocks.experienceUpdates = [];
    mocks.experienceFindArgs = [];
    mocks.versionFindArgs = [];
  });

  it("refuses an unauthenticated request before touching the database", async () => {
    mocks.session = null;
    const response = await POST(request({ businessId: "biz-a" }));
    expect(response.status).toBe(401);
    expect(mocks.experienceFindArgs).toHaveLength(0);
  });

  it("refuses a business the caller does not own, and reads nothing from it", async () => {
    mocks.guard = { ok: false, status: 403, error: "No access" };
    const response = await POST(request({ businessId: "biz-b-someone-else" }));
    expect(response.status).toBe(403);
    expect(mocks.experienceFindArgs).toHaveLength(0);
    expect(mocks.versionFindArgs).toHaveLength(0);
  });

  it("returns a candidate as a preview and never writes the draft", async () => {
    const response = await POST(request({ businessId: "biz-a" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.saved).toBe(false);
    expect(body.candidate).toBeTruthy();
    expect(body.candidate.generation?.seed).toBeTruthy();
    expect(mocks.experienceUpdates).toHaveLength(0);
  });

  it("scopes every read to the requested business only", async () => {
    await POST(request({ businessId: "biz-a" }));
    expect(mocks.experienceFindArgs[0].where).toEqual({ businessId: "biz-a" });
    expect(mocks.versionFindArgs[0].where).toEqual({ businessId: "biz-a" });
  });

  it("is reproducible for the same seed, and a client seed is sanitised", async () => {
    const a = await (await POST(request({ businessId: "biz-a", seed: "biz-a:fixed-seed" }))).json();
    const b = await (await POST(request({ businessId: "biz-a", seed: "biz-a:fixed-seed" }))).json();
    expect(a.seed).toBe("biz-a:fixed-seed");
    expect(JSON.stringify(a.candidate)).toBe(JSON.stringify(b.candidate));

    const hostile = await (await POST(request({ businessId: "biz-a", seed: "<img onerror=x>" }))).json();
    expect(hostile.seed).not.toContain("<");
    expect(hostile.seed).not.toContain(" ");
  });

  it("uses a deterministic default seed derived from the draft version", async () => {
    const first = await (await POST(request({ businessId: "biz-a" }))).json();
    const second = await (await POST(request({ businessId: "biz-a" }))).json();
    expect(first.seed).toBe("biz-a:4");
    expect(second.seed).toBe(first.seed);
  });

  it("reports attempts and the similarity limit so the owner can see why a layout was refused", async () => {
    const body = await (await POST(request({ businessId: "biz-a" }))).json();
    expect(Array.isArray(body.attempts)).toBe(true);
    expect(body.attempts.length).toBeGreaterThanOrEqual(1);
    expect(typeof body.report.threshold).toBe("number");
  });
});
