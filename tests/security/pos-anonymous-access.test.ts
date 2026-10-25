/**
 * The Business POS card is public; the POS itself is not.
 *
 * 2026-10-25: the homepage now advertises the owner-only Business POS inside the same pricing grid
 * as the four page plans. A card is not a credential — an anonymous request for `/dashboard/pos`
 * must still be refused before any business or entitlement data is read, and the POS route must
 * still resolve businesses from the signed-in session only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: null as null | { userId: string; email: string; role: string } }));
const queried = vi.hoisted(() => ({ calls: [] as string[] }));

class Redirected extends Error {
  constructor(public to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Redirected(to); } }));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => mocks.session),
  SESSION_COOKIE_NAME: "jata_session",
}));

vi.mock("@/lib/db", () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: () => async () => {
          queried.calls.push(name);
          return [];
        },
      },
    );
  return {
    default: new Proxy(
      {},
      {
        get: (_target, prop: string) => model(prop),
      },
    ),
  };
});

vi.mock("@/lib/pos/entitlement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pos/entitlement")>();
  return {
    ...actual,
    getPosEntitlement: vi.fn(async () => {
      queried.calls.push("getPosEntitlement");
      return null;
    }),
  };
});

describe("anonymous access to the Business POS is still refused", () => {
  beforeEach(() => {
    mocks.session = null;
    queried.calls = [];
  });

  it("redirects /dashboard/pos to the login page without reading any business data", async () => {
    const { default: PosIndexPage } = await import("@/app/dashboard/pos/page");

    await expect(PosIndexPage()).rejects.toMatchObject({ to: "/login" });
    expect(queried.calls).toEqual([]);
  });

  it("keeps the server-side sign-in guard in the route source", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const source = readFileSync(path.resolve(__dirname, "../../app/dashboard/pos/page.tsx"), "utf8");
    expect(source).toContain('if (!session) redirect("/login")');
    // Businesses come from the session membership, never from a URL parameter.
    expect(source).toContain("getOwnedBusinessIds(session)");
    expect(source).not.toContain("searchParams");
  });
});
