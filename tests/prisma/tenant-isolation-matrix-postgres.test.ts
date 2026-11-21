/**
 * Platform-wide two-tenant authorization sweep against real Prisma + PostgreSQL (R-TI-01).
 *
 * Every API route handler under app/api is discovered at runtime and every exported HTTP method is
 * invoked directly (no UI) with tenant A's REAL identifiers in the path, the query string and the JSON
 * body, as three principals:
 *   • anonymous            — no session at all;
 *   • owner of tenant B    — a different, fully signed-in business owner (cross-tenant read/write);
 *   • staff of tenant B    — a BusinessMember of B only.
 * Owner A is probed first with GET only (no writes) so a denial can be told apart from a route that
 * simply refuses everyone (e.g. a disabled feature); at least 20 routes must succeed for A and be
 * denied (401/403/404) for owner B.
 *
 * Assertions:
 *   1. No response to any of the three principals contains tenant A's private identifiers (business
 *      id, owner id, owner email, product id). Routes on the explicit PUBLIC_BY_DESIGN list (public
 *      storefront/enquiry/webhook surfaces whose authorization model is not a session; each justified)
 *      may name the published business, never its owner. A 2xx that carries none of A's data is a
 *      self-scoped route acting on the caller's own resources; those are listed in the output.
 *   2. Database-level isolation: a fingerprint (row count + md5 of every row) of every table that has a
 *      `businessId` column, restricted to tenant A, plus A's Business and owner User rows, is identical
 *      before and after all cross-tenant and anonymous calls. Only append-only audit/security-log
 *      tables may change (refusals are logged), and every such change is reported.
 *
 * External network is disabled (global fetch rejects anything but localhost), so no provider is
 * contacted and no payment can be made. Only `@/lib/db` (pointed at the test database), the session
 * accessors and `next/headers` (no request scope in a unit runner) are replaced.
 * Runs only when PRISMA_TEST_DATABASE_URL is set (Release Validation PostgreSQL 18 job).
 */
import { readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prismaEngineLabel, realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { seedBusiness, seedProduct, uid } from "../helpers/prisma-fixtures";

const mock = vi.hoisted(() => ({ session: null as null | { userId: string; role: string; email: string; sessionVersion?: number } }));
vi.mock("@/lib/db", async () => ({ default: (await import("../helpers/prisma-client")).sharedPrisma() }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: async () => mock.session,
    getCurrentUser: async () => (mock.session ? { ...mock.session, id: mock.session.userId } : null),
    requireSession: async () => { if (!mock.session) throw new Error("Unauthorized"); return mock.session; },
    getSessionFromToken: async () => mock.session,
  };
});
vi.mock("next/headers", () => {
  const store = { get: () => undefined, getAll: () => [], has: () => false, set: () => undefined, delete: () => undefined };
  return { cookies: async () => store, headers: async () => new Headers(), draftMode: async () => ({ isEnabled: false }) };
});

const ROOT = path.resolve(__dirname, "../..");
const API = path.join(ROOT, "app/api");
const BASE = "http://localhost:3000";
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * Routes whose authorization model is deliberately not a session (each justified). A 2xx from these
 * is expected and is not a cross-tenant leak by itself; database isolation (assertion 2) still applies.
 */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  "analytics/event": "public page-view/tap counter for published pages; write-only, no tenant data returned",
  "auth/login": "credential endpoint", "auth/logout": "clears the caller's own cookie", "auth/register": "account creation",
  "auth/password-reset": "always answers the same generic response (no account enumeration)",
  "auth/password-reset/complete": "token-authorized",
  "public/enquiry": "public enquiry form for a published business", "public/order-request": "public order request for a published business",
  "public/loyalty/[code]": "bearer loyalty code", "public/loyalty-points/[code]": "bearer loyalty code", "public/loyalty-points/[code]/redeem": "bearer loyalty code",
  "store/[slug]/orders": "public storefront ordering", "storefront/booking": "public booking for a published business",
  "storefront/checkout": "public storefront checkout", "storefront/quote": "public price quote", "storefront/orders/resume-payment": "order-token authorized",
  "health": "liveness", "voice/readiness": "configuration readiness booleans, no tenant data",
  "products": "public catalogue", "services": "public catalogue", "offer": "public offer lookup",
  "cart": "anonymous cart", "preorders": "public preorder", "orders": "order-token authorized",
  "payments/webhooks/mpesa": "provider callback (token/IP authenticated in handler)",
  "payments/webhooks/mpesa/stk": "provider callback", "payments/webhooks/mpesa/result": "provider callback",
  "payments/webhooks/mpesa/timeout": "provider callback", "payments/webhooks/mpesa/validation": "provider callback",
  "payments/webhooks/mpesa/confirmation": "provider callback",
};

type Row = { route: string; module: string; method: string; principal: string; status: number | string; exposesTenantA?: boolean };

function moduleOf(route: string): string {
  const top = route.split("/")[0];
  const map: Record<string, string> = {
    business: "Business Page", storefront: "Business Page", public: "Business Page", store: "Business Page", products: "Business Page", services: "Business Page",
    bookings: "Business Page", orders: "Business Page", cart: "Business Page", preorders: "Business Page", offer: "Business Page", "merchant-payment": "Business Page",
    studio: "Website Studio", experience: "Website Studio", media: "Files & media", ai: "AI Front Desk & Voice", voice: "AI Front Desk & Voice",
    pos: "POS", erp: "ERP-Pro", mjengo: "MJENGO OS", autopilot: "Autopilot", intelligence: "Autopilot",
    admin: "Admin & reporting", control: "Admin & reporting", analytics: "Admin & reporting", agents: "Agents",
    payments: "Payments, webhooks & checkout", paystack: "Payments, webhooks & checkout", webhooks: "Payments, webhooks & checkout", checkout: "Payments, webhooks & checkout",
    cron: "Background jobs", notifications: "Notifications", "notification-recipients": "Notifications", account: "Account", auth: "Account", health: "Platform",
  };
  return map[top] ?? top;
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

const p = realPrismaConfigured ? sharedPrisma() : (null as any);

/**
 * Records only an OWNER or ADMIN member (billing, publication, team) or a MANAGER (configuration)
 * may change. A STAFF member changing any of these is a privilege escalation inside the tenant.
 */
const OWNER_LEVEL_TABLES = new Set([
  "Business(A)", "User(ownerA)", "BusinessMember",
  "Subscription", "Payment", "PaymentDestination", "PaymentProviderConnection", "MerchantPaymentConfig",
  "AIPackageEntitlement", "AutopilotEntitlement", "AutopilotSubscription", "ErpEntitlement", "ErpProEntitlement",
  "ErpProSubscription", "ErpSubscription", "InteractiveBusinessEntitlement", "MjengoEntitlement", "MjengoSubscription",
  "PosEntitlement", "PosSubscription", "MsgWallet",
  "BusinessExperience", "ExperienceVersion", "StudioWebsite", "StudioWorkspaceBusiness", "PosPublicationResolution",
  "AIConfiguration", "AutopilotConfiguration", "ErpConfiguration", "PosConfiguration", "VoiceBusinessPolicy", "VoiceInboundNumber",
  "PosStaff", "ErpTaxRule", "ErpComplianceProfile",
]);

describe.skipIf(!realPrismaConfigured)(`real PostgreSQL (${prismaEngineLabel}): two-tenant authorization sweep over every API route`, () => {
  const savedFetch = globalThis.fetch;
  const savedEnv = { ...process.env };
  let a: { owner: any; business: any };
  let b: { owner: any; business: any };
  let staffB: any;
  let staffA: any;
  let viewerA: any;
  let productA: any;
  const rows: Row[] = [];
  const importErrors: Array<{ route: string; error: string }> = [];
  let businessTables: string[] = [];

  async function fingerprint() {
    const out: Record<string, string> = {};
    for (const table of businessTables) {
      const [r] = await p.$queryRawUnsafe(
        `SELECT count(*)::int AS c, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM "${table}" t WHERE "businessId" = $1`,
        a.business.id,
      );
      out[table] = `${r.c}:${r.h}`;
    }
    const [biz] = await p.$queryRawUnsafe(`SELECT md5(t::text) AS h FROM "Business" t WHERE id = $1`, a.business.id);
    const [usr] = await p.$queryRawUnsafe(`SELECT md5(t::text) AS h FROM "User" t WHERE id = $1`, a.owner.id);
    out["Business(A)"] = biz.h;
    out["User(ownerA)"] = usr.h;
    return out;
  }

  function fill(route: string): Record<string, string> {
    const params: Record<string, string> = {};
    for (const seg of route.split("/")) {
      const m = /^\[(\.\.\.)?(.+)\]$/.exec(seg);
      if (!m) continue;
      const key = m[2];
      params[key] = key === "slug" ? a.business.slug : key === "productId" ? productA.id : a.business.id;
    }
    return params;
  }

  let lastBody = "";
  async function call(route: string, handler: any, method: string, principal: string): Promise<number | string> {
    lastBody = "";
    const params = fill(route);
    const urlPath = route.replace(/\[(?:\.\.\.)?([^\]]+)\]/g, (_, k) => encodeURIComponent(params[k]));
    const url = `${BASE}/api/${urlPath}?businessId=${encodeURIComponent(a.business.id)}&id=${encodeURIComponent(a.business.id)}`;
    const headers = { "content-type": "application/json", origin: BASE, host: "localhost:3000", "sec-fetch-site": "same-origin", "x-forwarded-for": `10.9.${rows.length % 250}.1` };
    const init: RequestInit = { method, headers };
    if (method !== "GET") init.body = JSON.stringify({ businessId: a.business.id, id: a.business.id, productId: productA.id, name: `probe ${uid()}`, slug: a.business.slug });
    try {
      const response = await Promise.race([
        handler(new Request(url, init), { params: Promise.resolve(params) }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20_000)),
      ]);
      if (!(response instanceof Response)) return "non-response";
      if (response.status >= 200 && response.status < 400) {
        // Bounded read: streamed bodies (exports, event streams) must not stall the sweep.
        const reader = response.clone().body?.getReader();
        const decoder = new TextDecoder();
        const deadline = Date.now() + 3_000;
        while (reader && lastBody.length < 200_000 && Date.now() < deadline) {
          const chunk = await Promise.race([reader.read(), new Promise<{ done: true }>((done) => setTimeout(() => done({ done: true }), 1_000))]);
          if (chunk.done) break;
          lastBody += decoder.decode((chunk as any).value, { stream: true });
        }
        void reader?.cancel().catch(() => undefined); // never awaited: cancelling a pending stream can block
      }
      return response.status;
    } catch (error: any) {
      // next/navigation redirect() / notFound() throw; a thrown redirect is still a refusal, not data.
      const digest = String(error?.digest ?? "");
      if (digest.startsWith("NEXT_REDIRECT")) return 307;
      if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404") || digest === "NEXT_NOT_FOUND") return 404;
      return `threw:${String(error?.message ?? error).slice(0, 80)}`;
    }
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || process.env.PRISMA_TEST_DATABASE_URL;
    process.env.PAYSTACK_SECRET_KEY = `sk_test_matrix_${uid()}`; // never a provider key; fetch is disabled anyway
    globalThis.fetch = (async (input: any, init?: any) => {
      const target = new URL(typeof input === "string" ? input : input.url);
      if (["localhost", "127.0.0.1"].includes(target.hostname)) return savedFetch(input, init);
      throw new Error(`network disabled in tenant matrix: ${target.hostname}`);
    }) as typeof fetch;

    a = await seedBusiness(p);
    b = await seedBusiness(p);
    productA = await seedProduct(p, a.business.id);
    staffB = await p.user.create({ data: { email: `staff-b-${uid()}@test.invalid`, name: "Staff B", passwordHash: "test-only", role: "CUSTOMER" } });
    await p.businessMember.create({ data: { userId: staffB.id, businessId: b.business.id, role: "STAFF" } });
    // Inside tenant A: an authorized STAFF member and a read-only VIEWER member (lib/tenant.ts roles).
    staffA = await p.user.create({ data: { email: `staff-a-${uid()}@test.invalid`, name: "Staff A", passwordHash: "test-only", role: "CUSTOMER" } });
    await p.businessMember.create({ data: { userId: staffA.id, businessId: a.business.id, role: "STAFF" } });
    viewerA = await p.user.create({ data: { email: `viewer-a-${uid()}@test.invalid`, name: "Viewer A", passwordHash: "test-only", role: "CUSTOMER" } });
    await p.businessMember.create({ data: { userId: viewerA.id, businessId: a.business.id, role: "VIEWER" } });

    const cols: Array<{ table_name: string }> = await p.$queryRawUnsafe(
      `SELECT DISTINCT table_name::text AS table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'businessId' ORDER BY table_name`,
    );
    businessTables = cols.map((c) => c.table_name);
  }, 120_000);

  afterAll(async () => {
    globalThis.fetch = savedFetch;
    process.env = savedEnv;
    const dir = path.join(ROOT, "test-results");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "tenant-isolation-matrix.json"), JSON.stringify({ engine: prismaEngineLabel, rows, importErrors }, null, 2));
  });

  it("no route serves or changes tenant A's data for anonymous, other-tenant owner or other-tenant staff; inside A, viewers cannot write and staff cannot escalate", async () => {
    const files = routeFiles(API).sort();
    expect(files.length).toBeGreaterThan(150);

    // Phase 1 — owner A's own GETs (read-only), so a denial for B can be told apart from a route that
    // refuses everyone. Taken before the fingerprint, so any lazy row creation for A is excluded.
    mock.session = { userId: a.owner.id, role: "CUSTOMER", email: a.owner.email, sessionVersion: 0 };
    for (const file of files) {
      const route = path.relative(API, path.dirname(file)).split(path.sep).join("/");
      let mod: any;
      try { mod = await import(/* @vite-ignore */ file); } catch { continue; }
      if (typeof mod.GET !== "function") continue;
      rows.push({ route, module: moduleOf(route), method: "GET", principal: "owner-A", status: await call(route, mod.GET, "GET", "owner-A") });
    }
    mock.session = null;

    // Phase 2 — anonymous, owner B and staff B against tenant A's identifiers.
    const before = await fingerprint();

    const principals: Array<[string, any]> = [
      ["anonymous", null],
      ["owner-B", { userId: b.owner.id, role: "CUSTOMER", email: b.owner.email, sessionVersion: 0 }],
      ["staff-B", { userId: staffB.id, role: "CUSTOMER", email: staffB.email, sessionVersion: 0 }],
    ];
    const leaks: Row[] = [];
    const selfScoped = new Set<string>();
    for (const file of files) {
      const route = path.relative(API, path.dirname(file)).split(path.sep).join("/");
      let mod: any;
      try { mod = await import(/* @vite-ignore */ file); } catch (error: any) { importErrors.push({ route, error: String(error?.message ?? error).slice(0, 160) }); continue; }
      for (const method of METHODS) {
        if (typeof mod[method] !== "function") continue;
        for (const [principal, session] of principals) {
          mock.session = session;
          const status = await call(route, mod[method], method, principal);
          const ok = typeof status === "number" && status >= 200 && status < 400;
          // A leak is tenant A's private data in the response. Public-by-design routes may name the
          // published business itself, but never its owner account.
          const secrets = PUBLIC_BY_DESIGN[route] ? [a.owner.id, a.owner.email] : [a.business.id, a.owner.id, a.owner.email, productA.id];
          const exposesTenantA = ok && secrets.some((secret) => lastBody.includes(secret));
          const row: Row = { route, module: moduleOf(route), method, principal, status, exposesTenantA };
          rows.push(row);
          if (exposesTenantA) leaks.push(row);
          else if (ok && !PUBLIC_BY_DESIGN[route]) selfScoped.add(`${method} ${route}`);
        }
      }
    }
    mock.session = null;

    const after = await fingerprint();
    const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
    const logTables = changed.filter((t) => /audit|log|event|attempt|ratelimit|security/i.test(t));
    const dataTables = changed.filter((t) => !logTables.includes(t));
    const summary: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      const bucket = typeof r.status !== "number" ? "error" : r.status === 503 ? "refused-not-configured" : r.status >= 500 ? "error" : [401, 403, 404, 307].includes(r.status) ? "denied" : r.status < 400 ? "2xx" : "refused-other";
      const key = `${r.module} | ${r.principal}`;
      summary[key] ??= { denied: 0, "refused-other": 0, "refused-not-configured": 0, "2xx": 0, error: 0 };
      summary[key][bucket]++;
    }
    for (const [key, counts] of Object.entries(summary).sort()) console.log(`[tenant-matrix] ${key} ${JSON.stringify(counts)}`);
    console.log(`[tenant-matrix] self-scoped 2xx without tenant A data (caller's own resources): ${JSON.stringify([...selfScoped].sort())}`);
    for (const table of logTables) {
      const recent: any[] = await p.$queryRawUnsafe(`SELECT to_jsonb(t) AS j FROM "${table}" t WHERE "businessId" = $1`, a.business.id);
      const actions = recent.map((r) => r.j.action ?? r.j.event ?? r.j.type ?? r.j.outcome ?? "?");
      console.log(`[tenant-matrix] ${table}: ${recent.length} rows for tenant A, actions=${JSON.stringify([...new Set(actions)])}`);
    }
    console.log(`[tenant-matrix] engine=${prismaEngineLabel} routes=${files.length} calls=${rows.length} importErrors=${importErrors.length} businessTables=${businessTables.length} changedLogTables=${JSON.stringify(logTables)}`);
    expect(importErrors, JSON.stringify(importErrors)).toEqual([]);
    expect(leaks, `tenant A data returned to anonymous / another tenant: ${JSON.stringify(leaks)}`).toEqual([]);
    const okA = rows.filter((r) => r.principal === "owner-A" && typeof r.status === "number" && r.status >= 200 && r.status < 300);
    const contrast = okA.filter((ra) => rows.some((rb) => rb.route === ra.route && rb.method === "GET" && rb.principal === "owner-B" && typeof rb.status === "number" && [401, 403, 404].includes(rb.status)));
    console.log(`[tenant-matrix] owner-A GET 2xx=${okA.length}; of those, owner-B denied (401/403/404)=${contrast.length}`);
    // Contrast must exist; otherwise every denial could be a route that refuses everyone.
    expect(contrast.length).toBeGreaterThan(20);
    // Every refusal must be an HTTP answer, never an uncaught exception or a 500 (R-TI-02).
    const crashes = rows.filter((r) => r.principal !== "owner-A" && (typeof r.status !== "number" || (r.status >= 500 && r.status !== 503)));
    expect(crashes, `refusals that crashed instead of answering: ${JSON.stringify(crashes)}`).toEqual([]);
    expect(dataTables, `tenant A data changed by another tenant or an anonymous caller: ${JSON.stringify(dataTables)}`).toEqual([]);

    // Phase 3 — inside tenant A (R-TI-03). A VIEWER may only read (lib/tenant.ts: read = weight 10),
    // so no write method may change any of A's data. A STAFF member may operate (orders, leads), but
    // never touch owner-, billing-, team- or publication-level records (manage_billing / publish /
    // configure / manage_settings all need MANAGER or above).
    const insideRows: Row[] = [];
    const sweepAs = async (principal: string, session: any, methods: readonly string[]) => {
      for (const file of files) {
        const route = path.relative(API, path.dirname(file)).split(path.sep).join("/");
        const mod: any = await import(/* @vite-ignore */ file);
        for (const method of methods) {
          if (typeof mod[method] !== "function") continue;
          mock.session = session;
          const pre = process.env.TENANT_MATRIX_ATTRIBUTE === "1" && method !== "GET" ? await fingerprint() : null;
          const status = await call(route, mod[method], method, principal);
          const row: Row = { route, module: moduleOf(route), method, principal, status };
          rows.push(row);
          insideRows.push(row);
          if (pre) {
            // Diagnostic only: name the call that changed which table.
            const post = await fingerprint();
            const diff = Object.keys(pre).filter((k) => pre[k] !== post[k]);
            if (diff.length) console.log(`[tenant-matrix] attribute ${principal} ${method} ${route} -> ${status} changed ${JSON.stringify(diff)}`);
          }
        }
      }
      mock.session = null;
    };
    const WRITES = METHODS.filter((m) => m !== "GET");

    const beforeViewer = await fingerprint();
    await sweepAs("viewer-A", { userId: viewerA.id, role: "CUSTOMER", email: viewerA.email, sessionVersion: 0 }, WRITES);
    const afterViewer = await fingerprint();
    const viewerChanged = Object.keys(beforeViewer).filter((k) => beforeViewer[k] !== afterViewer[k] && !/audit|log|event|attempt|ratelimit|security/i.test(k));

    await sweepAs("staff-A", { userId: staffA.id, role: "CUSTOMER", email: staffA.email, sessionVersion: 0 }, ["GET"]);
    const beforeStaff = await fingerprint();
    await sweepAs("staff-A", { userId: staffA.id, role: "CUSTOMER", email: staffA.email, sessionVersion: 0 }, WRITES);
    const afterStaff = await fingerprint();
    const staffChanged = Object.keys(beforeStaff).filter((k) => beforeStaff[k] !== afterStaff[k]);
    const staffPrivilegedChanged = staffChanged.filter((k) => OWNER_LEVEL_TABLES.has(k));

    const staffGetOk = insideRows.filter((r) => r.principal === "staff-A" && r.method === "GET" && typeof r.status === "number" && r.status >= 200 && r.status < 300);
    const staffReadsWhereOwnerReads = okA.filter((ra) => staffGetOk.some((rs) => rs.route === ra.route));
    const insideCrashes = insideRows.filter((r) => typeof r.status !== "number" || (r.status >= 500 && r.status !== 503));
    console.log(`[tenant-matrix] inside A: viewer-A writes=${insideRows.filter((r) => r.principal === "viewer-A").length} changedDataTables=${JSON.stringify(viewerChanged)}; staff-A GET 2xx=${staffGetOk.length} (of owner-A's ${okA.length}: ${staffReadsWhereOwnerReads.length}); staff-A writes changed=${JSON.stringify(staffChanged)} ownerLevelChanged=${JSON.stringify(staffPrivilegedChanged)}`);
    expect(insideCrashes, `inside-tenant refusals that crashed: ${JSON.stringify(insideCrashes)}`).toEqual([]);
    expect(viewerChanged, `a read-only VIEWER of tenant A changed A's data: ${JSON.stringify(viewerChanged)}`).toEqual([]);
    expect(staffPrivilegedChanged, `a STAFF member of tenant A changed owner/billing/team/publication records: ${JSON.stringify(staffPrivilegedChanged)}`).toEqual([]);
    // Authorized staff must actually be served (otherwise every inside denial could be a blanket refusal).
    expect(staffReadsWhereOwnerReads.length).toBeGreaterThan(10);
  }, 1_500_000);

});
