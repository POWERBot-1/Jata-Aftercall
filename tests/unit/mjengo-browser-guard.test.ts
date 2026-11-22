import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertDisposableMjengoBrowserEnv } from "../../scripts/browser/mjengo-authenticated.guard.mjs";

const ok = {
  JATA_DISPOSABLE_BROWSER_DB: "1",
  DATABASE_URL: "postgresql://jata:jata@localhost:5432/jata_shots?schema=public",
  BASE_URL: "http://localhost:4100",
  DEMO_FIXTURE_PASSWORD: "a".repeat(64),
};

describe("MJENGO authenticated browser check: disposable-environment guard (R-MJ-10)", () => {
  it("accepts the CI disposable database and local server", () => {
    expect(assertDisposableMjengoBrowserEnv(ok).base.href).toBe("http://localhost:4100/");
    expect(() => assertDisposableMjengoBrowserEnv({ ...ok, DATABASE_URL: "postgres://u@127.0.0.1/db", BASE_URL: "http://127.0.0.1:4100" })).not.toThrow();
  });

  it.each([
    ["no disposable flag", { JATA_DISPOSABLE_BROWSER_DB: undefined }],
    ["flag not exactly 1", { JATA_DISPOSABLE_BROWSER_DB: "true" }],
    ["remote database (Neon)", { DATABASE_URL: "postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb" }],
    ["missing database", { DATABASE_URL: undefined }],
    ["non-postgres database", { DATABASE_URL: "mysql://localhost/db" }],
    ["remote app", { BASE_URL: "https://jata.link" }],
    ["https local app", { BASE_URL: "https://localhost:4100" }],
    ["missing app", { BASE_URL: undefined }],
    ["Vercel production runtime", { NODE_ENV: "production", VERCEL: "1" }],
    ["missing fixture password", { DEMO_FIXTURE_PASSWORD: undefined }],
    ["short fixture password", { DEMO_FIXTURE_PASSWORD: "short" }],
  ])("refuses: %s", (_label, override) => {
    expect(() => assertDisposableMjengoBrowserEnv({ ...ok, ...override })).toThrow(/Refusing/);
  });

  it("the browser script calls the guard before any database client is created and never presses pay", () => {
    const script = readFileSync("scripts/browser/mjengo-authenticated.check.mjs", "utf8");
    expect(script.indexOf("assertDisposableMjengoBrowserEnv(process.env)")).toBeGreaterThan(0);
    expect(script.indexOf("assertDisposableMjengoBrowserEnv(process.env)")).toBeLessThan(script.indexOf("new PrismaClient()"));
    expect(script).not.toMatch(/Continue to Paystack|api\/checkout|paystack\.co/i);
    expect(script).toContain("finally");
  });

  it("runs in the Premium Screenshots disposable-database job", () => {
    const workflow = readFileSync(".github/workflows/premium-screenshots.yml", "utf8");
    const step = workflow.slice(workflow.indexOf("MJENGO OS authenticated journey in real Chrome"));
    expect(step).toContain('JATA_DISPOSABLE_BROWSER_DB: "1"');
    expect(step).toContain("node scripts/browser/mjengo-authenticated.check.mjs");
  });
});
