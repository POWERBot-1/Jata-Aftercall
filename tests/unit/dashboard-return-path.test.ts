/**
 * R-RT-01 — every /dashboard destination survives sign-in, including expired, forged and revoked
 * sessions, without opening a redirect outside the workspace.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DASHBOARD_PATH_HEADER, aiPreviewLoginPath, aiPreviewNextToken, isSafeDashboardPath, loginPathFor, postAuthNextToken, resolvePostAuthDestination } from "@/lib/post-auth-destination";

const HOSTILE = [
  "/dashboard//evil.example", "//evil.example", "https://evil.example/dashboard/pos", "/dashboard/../admin", "/dashboard/pos/../../admin",
  "/dashboard/%2e%2e/admin", "/dashboard/pos%2F..", "/dashboard\\\\evil", "/dashboard/pos?x=1", "/dashboard/pos#x", "/dashboard/a:b",
  "/dashboardx", "/dashboard/", "/dashboard/a/b/c/d/e/f/g", `/dashboard/${"a".repeat(81)}`, "/admin", "/control/users", "/agents/x",
  "javascript:alert(1)", " /dashboard/pos", "/dashboard/pos ", "/dashboard/pos\n", "/Dashboard/pos",
];

describe("workspace-path destinations (R-RT-01)", () => {
  it("accepts strictly shaped workspace paths and round-trips them through the login ⇄ register token", () => {
    for (const p of ["/dashboard/pos", "/dashboard/pos/sales", "/dashboard/erp/biz_123/approvals", "/dashboard/studio/site-1_A"]) {
      expect(isSafeDashboardPath(p)).toBe(true);
      expect(resolvePostAuthDestination(p)).toBe(p);
      expect(resolvePostAuthDestination(postAuthNextToken(resolvePostAuthDestination(p)))).toBe(p);
    }
  });

  it("refuses every hostile or malformed value (falls back to /dashboard)", () => {
    for (const hostile of HOSTILE) expect(resolvePostAuthDestination(hostile), JSON.stringify(hostile)).toBe("/dashboard");
    expect(resolvePostAuthDestination(["/dashboard/pos", "/dashboard/erp"])).toBe("/dashboard");
  });

  it("keeps the existing exact tokens unchanged", () => {
    expect(resolvePostAuthDestination("mjengo")).toBe("/dashboard/mjengo");
    expect(resolvePostAuthDestination("agents")).toBe("/agents/dashboard");
    expect(resolvePostAuthDestination("control")).toBe("/control");
    expect(postAuthNextToken("/dashboard/mjengo")).toBe("mjengo");
  });

  it("loginPathFor builds the redirect: bare /login for /dashboard, null or hostile input", () => {
    expect(loginPathFor("/dashboard/pos/sales")).toBe("/login?next=/dashboard/pos/sales");
    expect(loginPathFor("/dashboard/mjengo")).toBe("/login?next=mjengo");
    expect(loginPathFor("/dashboard")).toBe("/login");
    expect(loginPathFor(null)).toBe("/login");
    expect(loginPathFor(undefined)).toBe("/login");
    for (const hostile of HOSTILE) expect(loginPathFor(hostile)).toBe("/login");
  });
});

describe("proxy.ts over the whole workspace (R-RT-01)", () => {
  it("cookie-less requests redirect to /login with the safe destination, same origin", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("@/proxy");
    const cases: Array<[string, string]> = [
      ["/dashboard/pos/sales", "/login?next=/dashboard/pos/sales"],
      ["/dashboard/mjengo/biz_1", "/login?next=/dashboard/mjengo/biz_1"],
      ["/dashboard/mjengo", "/login?next=mjengo"],
      ["/dashboard", "/login"],
    ];
    for (const [from, to] of cases) {
      const res = proxy(new NextRequest(`http://localhost:4100${from}`));
      expect(res.status).toBe(307);
      const loc = new URL(res.headers.get("location")!);
      expect(loc.origin).toBe("http://localhost:4100");
      expect(`${loc.pathname}${loc.search}`).toBe(to);
    }
  });

  it("with a cookie it passes through and overwrites any client-supplied path header", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("@/proxy");
    const req = new NextRequest("http://localhost:4100/dashboard/erp/biz_1", {
      headers: { cookie: "jata_session=stale", [DASHBOARD_PATH_HEADER]: "https://evil.example" },
    });
    const res = proxy(req);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get(`x-middleware-request-${DASHBOARD_PATH_HEADER}`)).toBe("/dashboard/erp/biz_1");
  });
});

const state = vi.hoisted(() => ({ session: null as null | { userId: string }, header: null as string | null }));
vi.mock("@/lib/auth", () => ({ getSession: async () => state.session }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(state.header ? { "x-jata-dashboard-path": state.header } : {}) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); },
  usePathname: () => "/dashboard",
  useRouter: () => ({ push() {}, refresh() {} }),
}));
vi.mock("@/lib/db", () => ({ default: new Proxy({}, { get() { throw new Error("DB must not be read for a signed-out request"); } }) }));

describe("dashboard layout with an expired / forged / revoked session (getSession() → null)", () => {
  beforeEach(() => { state.session = null; state.header = null; });

  async function layoutRedirect(): Promise<string> {
    const { default: DashboardLayout } = await import("@/app/dashboard/layout");
    try { await DashboardLayout({ children: null }); } catch (error: any) { if (error?.to) return error.to; throw error; }
    throw new Error("expected a redirect");
  }

  it("keeps the requested workspace path from the proxy header", async () => {
    state.header = "/dashboard/pos/sales";
    expect(await layoutRedirect()).toBe("/login?next=/dashboard/pos/sales");
    state.header = "/dashboard/mjengo";
    expect(await layoutRedirect()).toBe("/login?next=mjengo");
  });

  it("re-validates the header: hostile or missing values give a bare /login", async () => {
    for (const header of ["https://evil.example", "/dashboard/../admin", null]) {
      state.header = header;
      expect(await layoutRedirect()).toBe("/login");
    }
  });
});

describe("no dashboard route redirects to a bare /login or a parameter login ignores", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? files(full) : /\.(tsx?|mts)$/.test(name) ? [full] : [];
    });
  }
  it("every signed-out redirect under app/dashboard carries the destination", () => {
    const offenders = files("app/dashboard").filter((file) => {
      const src = readFileSync(file, "utf8");
      return /redirect\(\s*["'`]\/login["'`]\s*\)/.test(src) || /\/login\?callbackUrl=/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("no route anywhere in app/ sends people to the ignored callbackUrl parameter", () => {
    const offenders = files("app").filter((file) => /\/login\?callbackUrl=/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("owner AI-page preview survives sign-in (R-RT-02)", () => {
  it("round-trips the preview through the login ⇄ register token", () => {
    const token = aiPreviewNextToken("mama-mboga-23");
    expect(token).toBe("ai-preview:mama-mboga-23");
    expect(resolvePostAuthDestination(token)).toBe("/b/mama-mboga-23/ai?preview=true");
    expect(postAuthNextToken(resolvePostAuthDestination(token))).toBe(token);
    expect(aiPreviewLoginPath("mama-mboga-23")).toBe("/login?next=ai-preview%3Amama-mboga-23");
    expect(resolvePostAuthDestination(decodeURIComponent("ai-preview%3Amama-mboga-23"))).toBe("/b/mama-mboga-23/ai?preview=true");
  });

  it("refuses any slug that is not a valid business slug (falls back to /dashboard)", () => {
    for (const slug of ["", "ab", "-abc", "abc-", "a--b", "ABC", "a/b", "a.b", "..", "a?x=1", "evil.example", "//evil", "a b", "%2e%2e", "x".repeat(51)]) {
      expect(resolvePostAuthDestination(`ai-preview:${slug}`), slug).toBe("/dashboard");
      expect(aiPreviewNextToken(slug), slug).toBeNull();
    }
    expect(aiPreviewLoginPath("../admin")).toBe("/login");
    expect(resolvePostAuthDestination("/b/shop/ai?preview=true")).toBe("/dashboard"); // raw paths are never accepted
  });

  it("the AI page uses the preview token instead of callbackUrl", () => {
    const src = readFileSync("app/b/[slug]/ai/page.tsx", "utf8");
    expect(src).toContain("redirect(aiPreviewLoginPath(business.slug))");
    expect(src).not.toMatch(/login\?callbackUrl=/);
  });
});

describe("return-path real-Chrome check is wired and guarded", () => {
  const script = readFileSync("scripts/browser/dashboard-return-path.check.mjs", "utf8");
  it("refuses anything but the disposable local DB before constructing PrismaClient", () => {
    expect(script.indexOf("assertDisposableMjengoBrowserEnv(process.env)")).toBeGreaterThan(-1);
    expect(script.indexOf("assertDisposableMjengoBrowserEnv(process.env)")).toBeLessThan(script.indexOf("new PrismaClient()"));
    expect(script).not.toMatch(/api\/checkout|paystack|\/pay\b/i);
  });
  it("covers no-cookie, revoked, forged, hostile and cross-tenant cases, and runs in Premium Screenshots", () => {
    for (const marker of ["PASS A no cookie", "PASS B revoked session", "PASS C forged cookie", "PASS D hostile next", "PASS E another tenant"]) expect(script).toContain(marker);
    expect(script).toContain("sessionVersion: { increment: 1 }");
    const workflow = readFileSync(".github/workflows/premium-screenshots.yml", "utf8");
    expect(workflow).toContain("node scripts/browser/dashboard-return-path.check.mjs");
    expect(workflow.indexOf("dashboard-return-path.check.mjs")).toBeGreaterThan(workflow.indexOf("mjengo-authenticated.check.mjs"));
  });
});
