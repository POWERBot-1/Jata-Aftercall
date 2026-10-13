import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assertIsolatedStudioTarget, isAllowedStudioRequest } from "../../scripts/browser/studio-journey-safety.mjs";

const DATABASE_URL = "postgresql://jata:jata@localhost:5432/jata_e2e?schema=public";
const environment = { DATABASE_URL, PRISMA_TEST_DATABASE_URL: DATABASE_URL, AUTH_SECRET: "interactive-business-e2e-test-secret", STUDIO_BROWSER_TEST_WRITE: "1" };
const origin = "http://localhost:43123";

describe("authenticated Studio browser fixture boundaries (test-only, not application authorization)", () => {
  it("permits only explicit matching disposable workflow configuration", () => {
    expect(assertIsolatedStudioTarget(environment, [".env.example"])).toEqual({ databaseUrl: DATABASE_URL });
    const loopback = DATABASE_URL.replace("localhost", "127.0.0.1");
    expect(assertIsolatedStudioTarget({ ...environment, DATABASE_URL: loopback, PRISMA_TEST_DATABASE_URL: loopback })).toEqual({ databaseUrl: loopback });
  });
  it.each([
    { STUDIO_BROWSER_TEST_WRITE: undefined }, { STUDIO_BROWSER_TEST_WRITE: "true" },
    { DATABASE_URL: undefined }, { PRISMA_TEST_DATABASE_URL: undefined },
    { PRISMA_TEST_DATABASE_URL: DATABASE_URL + "&schema=other" },
    { AUTH_SECRET: undefined }, { AUTH_SECRET: "real-deployment-secret" },
  ])("refuses missing, implicit or mismatched opt-in: %j", (override) => {
    expect(() => assertIsolatedStudioTarget({ ...environment, ...override })).toThrow();
  });
  it.each([
    DATABASE_URL.replace("localhost", "production.example"), DATABASE_URL.replace("localhost", "localhost.example"),
    DATABASE_URL.replace("localhost", "0.0.0.0"), DATABASE_URL.replace("/jata_e2e", "/production"),
    DATABASE_URL.replace("/jata_e2e", "/jata_e2e_extra"), DATABASE_URL.replace("jata:jata@", "admin:secret@"),
    DATABASE_URL.replace(":5432", ":6543"), DATABASE_URL + "&host=production.example",
    DATABASE_URL.replace("schema=public", "schema=production"), DATABASE_URL.replace("postgresql:", "https:"),
    DATABASE_URL + "#production", "not a URL",
  ])("refuses unsafe database targets without leaking their contents", (url) => {
    expect(() => assertIsolatedStudioTarget({ ...environment, DATABASE_URL: url, PRISMA_TEST_DATABASE_URL: url })).toThrow();
    try { assertIsolatedStudioTarget({ ...environment, DATABASE_URL: url, PRISMA_TEST_DATABASE_URL: url }); }
    catch (error) { expect(String(error)).not.toContain("admin:secret"); }
  });
  it.each([".env", ".env.local", ".env.production", ".env.test.local"])('refuses Next-loaded configuration file "%s"', (file) => {
    expect(() => assertIsolatedStudioTarget(environment, [file])).toThrow(/environment files/);
  });
  it.each(["PAYSTACK_SECRET_KEY", "PAYSTACK_PUBLIC_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "BLOB_READ_WRITE_TOKEN", "STORAGE_PROVIDER", "AWS_ACCESS_KEY_ID", "R2_TOKEN", "MPESA_TOKEN"])('refuses provider/paid storage configuration "%s"', (key) => {
    expect(() => assertIsolatedStudioTarget({ ...environment, [key]: "must-not-be-printed" })).toThrow(/configuration present/);
    try { assertIsolatedStudioTarget({ ...environment, [key]: "must-not-be-printed" }); }
    catch (error) { expect(String(error)).not.toContain("must-not-be-printed"); }
  });
  it.each(["PRISMA_QUERY_ENGINE_LIBRARY", "PRISMA_QUERY_ENGINE_BINARY", "PRISMA_SCHEMA_ENGINE_BINARY", "PRISMA_GENERATE_NO_ENGINE"])('refuses engine-less/native substitute "%s"', (key) => {
    expect(() => assertIsolatedStudioTarget({ ...environment, [key]: "1" })).toThrow(/engine-less overrides/);
  });
  it("allows actual local safe HTTP/cookie/editor/booking/analytics paths", () => {
    expect(isAllowedStudioRequest(`${origin}/login`, origin)).toBe(true);
    expect(isAllowedStudioRequest(`${origin}/b/qa?preview=draft`, origin)).toBe(true);
    for (const path of ["/api/auth/login", "/api/auth/register", "/api/experience/publish", "/api/storefront/quote", "/api/storefront/booking", "/api/analytics/event"]) {
      expect(isAllowedStudioRequest(`${origin}${path}`, origin, "POST")).toBe(true);
    }
    expect(isAllowedStudioRequest(`${origin}/api/experience`, origin, "PATCH")).toBe(true);
    expect(isAllowedStudioRequest(`${origin}/api/experience/versions?businessId=qa`, origin)).toBe(true);
  });
  it("permits only the professional public intake POST/private ledger GET, not arbitrary enquiry mutations", () => {
    expect(isAllowedStudioRequest(`${origin}/api/storefront/enquiry`, origin, "GET")).toBe(true);
    expect(isAllowedStudioRequest(`${origin}/api/storefront/enquiry`, origin, "POST")).toBe(true);
    for (const method of ["DELETE", "PATCH", "PUT"]) expect(isAllowedStudioRequest(`${origin}/api/storefront/enquiry`, origin, method)).toBe(false);
    expect(isAllowedStudioRequest("https://external.example/api/storefront/enquiry", origin, "POST")).toBe(false);
  });
  it.each(["/api/experience/history", "/api/studio/health"])("allows only the reviewed read-only dashboard GET %s, never its mutations", (path) => {
    expect(isAllowedStudioRequest(`${origin}${path}?businessId=qa`, origin, "GET")).toBe(true);
    for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
      expect(isAllowedStudioRequest(`${origin}${path}`, origin, method)).toBe(false);
    }
    expect(isAllowedStudioRequest(`https://external.example${path}`, origin, "GET")).toBe(false);
  });
  it.each([
    ["https://api.paystack.co/transaction/initialize", "POST"], ["https://example.com/image.jpg", "GET"],
    [`${origin}/api/media`, "POST"], [`${origin}/api/studio/ai/image`, "POST"], [`${origin}/api/checkout`, "POST"],
    [`${origin}/api/paystack/verify?mock=success`, "GET"], [`${origin}/api/storefront/checkout`, "POST"],
    [`${origin}/api/admin/businesses`, "PATCH"], [`${origin}/api/experience`, "DELETE"],
    ["http://localhost:3000/api/experience", "PATCH"], [`${origin}/api/experience-malicious`, "PATCH"],
    [`${origin}/page`, "POST"], ["http://user:password@localhost:43123/login", "GET"],
  ])("blocks external/provider/unknown mutations: %s %s", (url, method) => {
    expect(isAllowedStudioRequest(url, origin, method)).toBe(false);
  });
  it("cannot be aimed at a production or preview origin, even if the request matches it", () => {
    expect(isAllowedStudioRequest("https://preview.example/login", "https://preview.example")).toBe(false);
    expect(isAllowedStudioRequest("http://production.example/login", "http://production.example")).toBe(false);
    expect(isAllowedStudioRequest("data:image/png;base64,AAA", "https://preview.example")).toBe(false);
  });
  it("allows only read-only local data/blob resources, not writes", () => {
    expect(isAllowedStudioRequest("data:image/png;base64,AAA", origin)).toBe(true);
    expect(isAllowedStudioRequest(`blob:${origin}/fixture`, origin)).toBe(true);
    expect(isAllowedStudioRequest(`blob:${origin}/fixture`, origin, "POST")).toBe(false);
  });
  it("is not an app fixture route, payment mock or session-signing shortcut", () => {
    const script = readFileSync("scripts/browser/studio-authenticated.check.mjs", "utf8");
    expect(script).not.toMatch(/vi\.mock|setCookie\(|createSession\(|SignJWT|mock=success/);
    expect(script).toContain('NODE_ENV: "production"');
    expect(script).toContain('providerVerified: false');
    expect(script).toContain('prisma.$queryRaw`SELECT 1`');
    expect(script).toContain('prisma.business.deleteMany({ where: { id: fixture.id, ownerId: fixture.ownerId } })');
    expect(script).not.toMatch(/deleteMany\(\s*\{\s*\}\s*\)/);
    expect(script).toContain('journeyComplete = true');
    expect(script).toContain('"NOT RUN: fail-fast remainder"');
    expect(script).toContain('process.exitCode = failed || !journeyComplete ? 1 : 0');
  });
  it("reaches the enquiry form only through the trusted unobstructed link click, with failure evidence (PR #41 791a435)", () => {
    const script = readFileSync("scripts/browser/studio-authenticated.check.mjs", "utf8");
    // Raw element clicks can be intercepted by overlays; the journey must use the
    // centered, hit-tested clickText path and must retain the obstruction probe.
    expect(script).not.toMatch(/visitor\.click\('\[data-recipe-action="enquire"\]/);
    expect(script).toContain(`clickText(visitor, '[data-recipe-action="enquire"] a', 'Request a quote')`);
    expect(script).toContain("Actual enquiry link before centered trusted click");
    expect(script).toContain("enquiry form not reached after trusted link");
  });
});
