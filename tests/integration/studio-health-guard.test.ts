/**
 * The Website health report: owners only, and it says which draft version it describes.
 *
 * Before this guard the route read any business's publishing state by business id with no session and no
 * tenant check. A fix sent from the report carries the version the report was computed from.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: null as any,
  loadWorkspace: vi.fn(),
  loadStudioIntelligence: vi.fn(),
}));

const OWNED = "business-a";
const FOREIGN = "business-b";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({
  TenantError: class TenantError extends Error {
    status = 403;
  },
  guardTenantMutation: vi.fn(async (_session: unknown, businessId: string) => {
    if (!_session) return { ok: false as const, error: "Sign in to continue.", status: 401 as const };
    if (!businessId) return { ok: false as const, error: "Choose a business first.", status: 400 as const };
    if (businessId !== OWNED) return { ok: false as const, error: "You do not have access to that business.", status: 403 as const };
    return { ok: true as const };
  }),
}));
vi.mock("@/lib/experience/workspace", () => ({ loadWorkspace: mocks.loadWorkspace }));
vi.mock("@/lib/studio/studioData", () => ({ loadStudioIntelligence: mocks.loadStudioIntelligence }));
vi.mock("@/lib/studio/health", () => ({ healthSummaryLine: vi.fn(() => "Ready") }));
vi.mock("@/lib/ai/registry", () => ({
  providerStatus: vi.fn(() => ({ image: { label: "None", photorealistic: false }, note: "" })),
}));

import { GET } from "@/app/api/studio/health/route";

function request(businessId: string) {
  return new Request(`https://jata.test/api/studio/health?businessId=${encodeURIComponent(businessId)}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "user-a", role: "OWNER" };
  mocks.loadWorkspace.mockResolvedValue({
    document: { sections: [] },
    business: { id: OWNED, name: "Mama Njeri Kitchen", isPublished: false },
    entitlement: { entitled: true },
    validation: { ready: true, checks: [] },
    hasUnpublishedChanges: true,
    experience: { draftVersion: 7 },
  });
  mocks.loadStudioIntelligence.mockResolvedValue({ health: { score: 80, items: [] }, counts: {}, topSellingIds: [] });
});

describe("GET /api/studio/health: owners only", () => {
  it("refuses an unauthenticated request before reading any workspace", async () => {
    mocks.session = null;
    const response = await GET(request(OWNED));
    expect(response.status).toBe(401);
    expect(mocks.loadWorkspace).not.toHaveBeenCalled();
    expect(mocks.loadStudioIntelligence).not.toHaveBeenCalled();
  });

  it("refuses another tenant's business before reading its workspace", async () => {
    const response = await GET(request(FOREIGN));
    expect(response.status).toBe(403);
    expect(mocks.loadWorkspace).not.toHaveBeenCalled();
    expect(mocks.loadStudioIntelligence).not.toHaveBeenCalled();
  });

  it("refuses a request without a business id", async () => {
    const response = await GET(request(""));
    expect(response.status).toBe(400);
    expect(mocks.loadWorkspace).not.toHaveBeenCalled();
  });

  it("returns the report for the owner, with the draft version it was computed from", async () => {
    const response = await GET(request(OWNED));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.draftVersion).toBe(7);
    expect(body.report).toEqual({ score: 80, items: [] });
    expect(mocks.loadWorkspace).toHaveBeenCalledWith(OWNED);
  });

  it("reports a null version for a business with no website yet, without failing", async () => {
    mocks.loadWorkspace.mockResolvedValue({
      document: { sections: [] },
      business: { id: OWNED, name: "X", isPublished: false },
      entitlement: { entitled: false },
      validation: { ready: false, checks: [] },
      hasUnpublishedChanges: false,
      experience: null,
    });
    const response = await GET(request(OWNED));
    expect(response.status).toBe(200);
    expect((await response.json()).draftVersion).toBeNull();
  });
});
