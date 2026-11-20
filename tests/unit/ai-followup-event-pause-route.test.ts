import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as any,
  access: true,
  role: "OWNER" as any,
  upsert: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => mocks.user) }));
vi.mock("@/lib/tenant", () => ({
  canAccessBusiness: vi.fn(async () => mocks.access),
  getBusinessRoleForUser: vi.fn(async () => mocks.role),
  canBusinessRolePerform: vi.fn((role: string, action: string) => action === "operate" && ["OWNER", "ADMIN", "MANAGER", "STAFF"].includes(role)),
}));
vi.mock("@/lib/db", () => ({ default: { aIConfiguration: { upsert: mocks.upsert } } }));

import { POST } from "@/app/api/ai/followup-events/route";

describe("AI Front Desk follow-up event pause authorization", () => {
  beforeEach(() => {
    mocks.user = { id: "staff-user", role: "USER" };
    mocks.access = true;
    mocks.role = "OWNER";
    mocks.upsert.mockReset();
    mocks.upsert.mockResolvedValue({ followupEventsEnabled: false });
  });

  const request = () => new Request("https://jata.test/api/ai/followup-events", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessId: "business_123" }),
  });

  it("requires authentication", async () => {
    mocks.user = null;
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("denies a user without access to the tenant", async () => {
    mocks.access = false;
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("denies a viewer role", async () => {
    mocks.role = "VIEWER";
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("lets an authorized staff operator pause processing without deleting tasks or events", async () => {
    mocks.role = "STAFF";
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ paused: true, preservedTasks: true, preservedEvents: true });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: "business_123" },
      update: { followupEventsEnabled: false },
    }));
  });
});
