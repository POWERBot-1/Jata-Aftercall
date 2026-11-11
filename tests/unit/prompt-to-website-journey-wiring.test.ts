import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The prompt-to-website browser journey existed as a script but was wired into NO workflow, so the
// acceptance it describes had never run in CI. These tests pin that it is wired in, that it cannot
// pass without a real browser, and that its fixture-API limitation is stated rather than implied.
const workflow = readFileSync(".github/workflows/website-studio-2-0.yml", "utf8");
// The journey lives inside the proven build+PostgreSQL job, so scope assertions to its steps.
const job = workflow.slice(workflow.indexOf("Prompt-to-website browser journey"));

describe("prompt-to-website journey is wired into CI", () => {
  it("runs the real browser script", () => {
    expect(job).toContain("node scripts/browser/website-studio-openpage.check.mjs");
  });

  it("fails closed when Chrome is absent instead of reporting a pass", () => {
    expect(job).toContain('CHROME_PATH="$(command -v google-chrome || command -v chromium || true)"');
    expect(job).toContain("NOT RUN, not passed");
  });

  it("refuses to continue when the server never becomes ready", () => {
    expect(job).toContain("BLOCKED, not passed");
  });

  it("always uploads evidence, including every log, even on failure", () => {
    const upload = job.slice(job.indexOf("Upload prompt-to-website journey evidence"));
    expect(upload).toContain("if: always()");
    expect(upload).toContain(".cache/verification/studio-openpage/");
    expect(upload).toContain("/tmp/step-journey-*.log");
  });

  it("states its limitation in the step name rather than implying server truth", () => {
    const name = /- name: (Prompt-to-website browser journey[^\n]*)/.exec(workflow)?.[1] ?? "";
    expect(name.toLowerCase()).toContain("ui journey");
    expect(name.toLowerCase()).toContain("server truth proven above");
  });

  it("does not stub the server-side truth it cannot prove", () => {
    // The journey stubs authenticated API calls; that is only acceptable because tenant isolation,
    // authz and publication are proven by the PostgreSQL suites in the same job.
    const script = readFileSync("scripts/browser/website-studio-openpage.check.mjs", "utf8");
    expect(script).toContain("Only the authenticated");
    expect(script).toContain("stubbed");
  });
});

// The journey was first added as a standalone job that rebuilt the app. That job failed three times
// on a second schema/build path (P1012 on validate; a placeholder DATABASE_URL triggering
// build.sh's migration gate). Reusing the job that already has a verified build and a real
// disposable database removes the whole class of failure — and removes any chance of the journey
// validating a different artifact than the server-side suites did.
describe("prompt-to-website journey reuses the verified build", () => {
  it("starts the already-built app instead of building again", () => {
    // The CLI is invoked directly: `npx next start` re-resolves and can exit asynchronously,
    // which left no server and produced a bare, undiagnosable readiness failure.
    // A DEV server is required: the fixture page returns notFound() when NODE_ENV is production,
    // so `next start` can never reach it. The production build is exercised by the authenticated
    // acceptance step instead.
    expect(job).toContain("node_modules/next/dist/bin/next dev");
    expect(job).not.toContain("node_modules/next/dist/bin/next start");
    expect(job).not.toContain("npx next start");
    expect(job).not.toContain("npx next build");
    const fixture = readFileSync("app/dev/website-studio-preview/page.tsx", "utf8");
    expect(fixture).toContain('if (process.env.NODE_ENV === "production") notFound();');
    expect(job).not.toContain("npm run build");
  });

  it("introduces no second Prisma validate/generate path", () => {
    expect(job).not.toContain("npx prisma validate");
    expect(job).not.toContain("prisma generate");
    expect(job).not.toContain("retry-prisma-engine");
  });

  it("carries no datasource placeholders of its own", () => {
    // It runs in the job that has a real database; a placeholder URL here would be a lie about
    // what the journey is connected to.
    expect(job).not.toContain("journey_placeholder");
  });

  it("removes the standalone job entirely rather than leaving a dead job behind", () => {
    const { load } = require("js-yaml") as typeof import("js-yaml");
    const parsed = load(workflow) as { jobs: Record<string, unknown> };
    expect(Object.keys(parsed.jobs)).toEqual(["website-studio-2-0"]);
  });
});
