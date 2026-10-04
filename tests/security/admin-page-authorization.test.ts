/**
 * Production audit 2026-10-04 — admin pages must authorize themselves.
 *
 * `app/admin/layout.tsx` redirects non-admins, but layouts are skipped by Next's partial
 * rendering: a request carrying `RSC: 1` and a `Next-Router-State-Tree` that says "layout already
 * loaded" rendered the page segment alone. Reproduced against `next dev`: an anonymous request
 * for /admin/payments returned HTTP 200 and executed the page (customer emails, phone numbers and
 * payment references are read there). Each page now calls `requireAdminPage()` before it reads
 * anything, so "refused" also means "never queried".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: null as null | { userId: string; email: string; role: string } }));

class Redirected extends Error {
  constructor(public to: string) { super(`NEXT_REDIRECT:${to}`); }
}

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Redirected(to); } }));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => mocks.session),
  SESSION_COOKIE_NAME: "jata_session",
}));

const queried = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/db", () => {
  const model = new Proxy({}, {
    get: () => async () => { queried.calls += 1; return Object.assign([], { _sum: { amount: 0 }, _count: 0 }); },
  });
  return { default: new Proxy({}, { get: () => model }) };
});
vi.mock("@/components/AdminBusinessActions", () => ({ default: () => null }));
vi.mock("@/components/PlansClient", () => ({ default: () => null }));

const pages: Array<[string, () => Promise<{ default: (props: any) => Promise<unknown> }>]> = [
  ["/admin", () => import("@/app/admin/page")],
  ["/admin/businesses", () => import("@/app/admin/businesses/page")],
  ["/admin/customers", () => import("@/app/admin/customers/page")],
  ["/admin/payments", () => import("@/app/admin/payments/page")],
  ["/admin/plans", () => import("@/app/admin/plans/page")],
  ["/admin/subscriptions", () => import("@/app/admin/subscriptions/page")],
  // The JATA view of the payment wallet: cross-tenant by design, so it is admin-only for the same
  // reason as the rest of this list — and it must never read before it has authorized (§102).
  ["/admin/payments/wallet", () => import("@/app/admin/payments/wallet/page")],
];

describe("every admin page enforces ADMIN itself, before reading data", () => {
  beforeEach(() => { queried.calls = 0; mocks.session = null; });

  it.each(pages)("%s refuses an anonymous request without querying", async (_path, load) => {
    const { default: Page } = await load();
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ to: "/login" });
    expect(queried.calls).toBe(0);
  });

  it.each(pages)("%s refuses a signed-in non-admin without querying", async (_path, load) => {
    mocks.session = { userId: "u1", email: "owner@example.com", role: "CUSTOMER" };
    const { default: Page } = await load();
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ to: "/dashboard" });
    expect(queried.calls).toBe(0);
  });

  it.each(pages)("%s still renders for an ADMIN", async (_path, load) => {
    mocks.session = { userId: "a1", email: "admin@example.com", role: "ADMIN" };
    const { default: Page } = await load();
    await expect(Page({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
    expect(queried.calls).toBeGreaterThan(0);
  });

  it("no page under app/admin skips the guard (new pages cannot forget it)", async () => {
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
