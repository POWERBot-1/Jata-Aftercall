/**
 * R-MJ-11 — the public /mjengo entry decides before the /dashboard layout can drop the destination.
 * Behavioural: the server component is invoked with the session mocked, and the Next redirect it
 * throws is captured.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as null | { userId: string; role: string; email: string } }));
vi.mock("@/lib/auth", () => ({ getSession: async () => state.session }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); },
}));

import MjengoEntry from "@/app/mjengo/page";
import { resolvePostAuthDestination } from "@/lib/post-auth-destination";

async function redirectTarget(): Promise<string> {
  try { await MjengoEntry(); } catch (error: any) { if (error?.to) return error.to; throw error; }
  throw new Error("expected a redirect");
}

describe("public MJENGO entry /mjengo (R-MJ-11)", () => {
  beforeEach(() => { state.session = null; });

  it("signed out → /login?next=mjengo, and that token resolves back to the MJENGO workspace after sign-in", async () => {
    const to = await redirectTarget();
    expect(to).toBe("/login?next=mjengo");
    expect(resolvePostAuthDestination(new URL(to, "http://x").searchParams.get("next") ?? undefined)).toBe("/dashboard/mjengo");
  });

  it("signed in → /dashboard/mjengo (workspace gate still decides entitlement)", async () => {
    state.session = { userId: "u1", role: "CUSTOMER", email: "owner@test.invalid" };
    expect(await redirectTarget()).toBe("/dashboard/mjengo");
  });

  it("the /dashboard layout still redirects to a bare /login, which is why public CTAs must not target /dashboard/mjengo", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("app/dashboard/layout.tsx", "utf8")).toContain('if (!session) redirect("/login");');
    for (const file of ["app/products/mjengo-os/page.tsx", "app/products/[slug]/page.tsx"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/href[=:]\s*["{]?\s*["`]\/dashboard\/mjengo["`]/);
    }
  });
});

describe("signed-out MJENGO deep links keep the destination (R-MJ-11 proxy)", () => {
  it("no session cookie → /login?next=mjengo for /dashboard/mjengo and its business routes", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("@/proxy");
    for (const path of ["/dashboard/mjengo", "/dashboard/mjengo/biz_1", "/dashboard/mjengo/biz_1/invoices"]) {
      const res = proxy(new NextRequest(`http://localhost:4100${path}`));
      expect(res.status).toBe(307);
      const to = new URL(res.headers.get("location")!);
      expect(`${to.pathname}${to.search}`).toBe("/login?next=mjengo");
      expect(to.origin).toBe("http://localhost:4100");
    }
  });

  it("any session cookie passes through untouched (the proxy grants nothing; server checks still decide)", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("@/proxy");
    const req = new NextRequest("http://localhost:4100/dashboard/mjengo/biz_1", { headers: { cookie: "jata_session=forged" } });
    const res = proxy(req);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("matches only MJENGO routes and uses the real session cookie name", async () => {
    const mod = await import("@/proxy");
    expect(mod.config.matcher).toEqual(["/dashboard/mjengo", "/dashboard/mjengo/:path*"]);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("lib/auth.ts", "utf8")).toContain(`const SESSION_COOKIE = "${mod.MJENGO_SESSION_COOKIE}";`);
    expect(readFileSync("proxy.ts", "utf8")).not.toMatch(/from "@\/lib\/(auth|db)"/);
  });
});
