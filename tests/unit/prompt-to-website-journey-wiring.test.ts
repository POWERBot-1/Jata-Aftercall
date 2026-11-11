import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The prompt-to-website browser journey existed as a script but was wired into NO workflow, so the
// acceptance it describes had never run in CI. These tests pin that it is wired in, that it cannot
// pass without a real browser, and that its fixture-API limitation is stated in the job name.
const workflow = readFileSync(".github/workflows/website-studio-2-0.yml", "utf8");
const job = workflow.slice(workflow.indexOf("prompt-to-website-journey:"));

describe("prompt-to-website journey is wired into CI", () => {
  it("runs the real browser script", () => {
    expect(job).toContain("node scripts/browser/website-studio-openpage.check.mjs");
  });

  it("fails closed when Chrome is absent instead of reporting a pass", () => {
    expect(job).toContain("CHROME_PATH=\"$(command -v google-chrome || command -v chromium || true)\"");
    expect(job).toContain("NOT RUN, not passed");
  });

  it("refuses to continue when the server never becomes ready", () => {
    expect(job).toContain("BLOCKED, not passed");
  });

  it("always uploads evidence, even on failure", () => {
    const upload = job.slice(job.indexOf("Upload prompt-to-website journey evidence"));
    expect(upload).toContain("if: always()");
    expect(upload).toContain(".cache/verification/studio-openpage/");
  });

  it("states the fixture-API limitation in the job name rather than implying server truth", () => {
    const name = /prompt-to-website-journey:\s*\n\s*name: (.+)/.exec(workflow)?.[1] ?? "";
    expect(name.toLowerCase()).toContain("fixture api");
    expect(name.toLowerCase()).toContain("server truth proven separately");
  });

  it("validates and generates Prisma through the engine-retry wrapper", () => {
    expect(job).toContain("retry-prisma-engine.mjs -- npx prisma validate");
    expect(job).toContain("retry-prisma-engine.mjs -- npx prisma generate");
  });

  it("does not stub the server-side truth it cannot prove", () => {
    // The journey stubs authenticated API calls; that is only acceptable because tenant isolation,
    // authz and publication are proven by the PostgreSQL suites in the sibling job. If this job ever
    // points at a disposable database it must stop claiming the fixture limitation.
    const script = readFileSync("scripts/browser/website-studio-openpage.check.mjs", "utf8");
    expect(script).toContain("Only the authenticated");
    expect(script).toContain("stubbed");
    expect(job).not.toContain("JATA_ALLOW_FIXTURE_SEED");
  });
});

// Prisma resolves env("DATABASE_URL") and env("DIRECT_URL") when it loads the schema, and an
// unresolvable variable is a P1012 — even for `validate`. The first version of this job omitted both
// and failed before the browser ever started.
describe("prompt-to-website journey declares schema-resolution placeholders", () => {
  it("sets DATABASE_URL and DIRECT_URL so prisma validate can resolve the schema", () => {
    expect(job).toContain("DATABASE_URL: postgresql://journey_placeholder:");
    expect(job).toContain("DIRECT_URL: postgresql://journey_placeholder:");
  });

  it("uses a placeholder, not a database, so nothing can connect", () => {
    // Any real-looking URL here would quietly imply server-side proof this job does not claim.
    expect(job).not.toContain("localhost:5432/jata_e2e");
    expect(job).toContain("never connects");
  });
});
