import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  result: { ok: false as const, status: 403 as const, code: "POLICY_PENDING" } as any,
}));
vi.mock("@/lib/control/access", () => ({ getControlIdentity: vi.fn(async () => state.result) }));
import { POST } from "@/app/api/admin/team-access/route";

describe("legacy team-access endpoint fails closed", () => {
  beforeEach(() => { state.result = { ok: false, status: 403, code: "POLICY_PENDING" }; });

  it("denies authenticated sessions while owner policy remains pending", async () => {
    const response = await POST(new Request("https://jata.test/api/admin/team-access", { method: "POST" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "POLICY_PENDING" });
  });

  it("denies anonymous sessions", async () => {
    state.result = { ok: false, status: 401, code: "UNAUTHENTICATED" };
    const response = await POST(new Request("https://jata.test/api/admin/team-access", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("does not expose any legacy lookup, verification, or revoke action", async () => {
    const response = await POST(new Request("https://jata.test/api/admin/team-access", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "revoke", userId: "fixture-user" }),
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "POLICY_PENDING" });
  });
});
