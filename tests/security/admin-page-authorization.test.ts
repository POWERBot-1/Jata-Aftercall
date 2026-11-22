import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: null as null | { userId: string; email: string; role: string } }));
class Redirected extends Error { constructor(public to: string) { super(`NEXT_REDIRECT:${to}`); } }

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Redirected(to); } }));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session), SESSION_COOKIE_NAME: "jata_session" }));
vi.mock("@/lib/control/access", () => ({
  getControlIdentity: vi.fn(async () => mocks.session
    ? { ok: false, status: 403, code: "POLICY_PENDING" }
    : { ok: false, status: 401, code: "UNAUTHENTICATED" }),
}));
const queried = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/db", () => ({ default: new Proxy({}, { get: () => new Proxy({}, { get: () => async () => { queried.calls += 1; return []; } }) }) }));
vi.mock("@/components/AdminBusinessActions", () => ({ default: () => null }));
vi.mock("@/components/PlansClient", () => ({ default: () => null }));

const pages: Array<[string, () => Promise<{ default: (props: any) => Promise<unknown> }>]> = [
  ["/admin", () => import("@/app/admin/page")],
  ["/admin/businesses", () => import("@/app/admin/businesses/page")],
  ["/admin/customers", () => import("@/app/admin/customers/page")],
  ["/admin/agents", () => import("@/app/admin/agents/page")],
  ["/admin/payments", () => import("@/app/admin/payments/page")],
  ["/admin/plans", () => import("@/app/admin/plans/page")],
  ["/admin/subscriptions", () => import("@/app/admin/subscriptions/page")],
  ["/admin/payments/wallet", () => import("@/app/admin/payments/wallet/page")],
  ["/admin/team-access", () => import("@/app/admin/team-access/page")],
];

describe("legacy admin pages remain closed until action-level owner authorization exists", () => {
  beforeEach(() => { queried.calls = 0; mocks.session = null; });

  it.each(pages)("%s rejects anonymous requests before reading data", async (_path, load) => {
    const { default: Page } = await load();
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ to: "/login" });
    expect(queried.calls).toBe(0);
  });

  it.each(pages)("%s rejects a signed-in ADMIN role without verified owner authority", async (_path, load) => {
    mocks.session = { userId: "admin-fixture", email: "admin@example.test", role: "ADMIN" };
    const { default: Page } = await load();
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ to: "/control/policy" });
    expect(queried.calls).toBe(0);
  });

  it.each(pages)("%s rejects a signed-in customer before reading data", async (_path, load) => {
    mocks.session = { userId: "customer-fixture", email: "customer@example.test", role: "CUSTOMER" };
    const { default: Page } = await load();
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ to: "/control/policy" });
    expect(queried.calls).toBe(0);
  });

  it("every admin page retains the mandatory guard call", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../../app/admin");
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === "page.tsx") found.push(full);
      }
    };
    walk(root);
    expect(found.length).toBe(pages.length);
    for (const file of found) expect(readFileSync(file, "utf8"), file).toContain("await requireAdminPage();");
  });
});
