import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";

// The wrapper exists because an unreachable Prisma engine mirror turns a valid schema into a network
// error. These tests pin the two properties that make it safe: it retries transport faults, and it
// NEVER retries a schema complaint — retrying those would bury a real defect behind delays.
const SCRIPT = "scripts/ci/retry-prisma-engine.mjs";
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [SCRIPT, "--", ...args], {
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, PRISMA_RETRY_DELAY_MS: "10", ...env } as NodeJS.ProcessEnv,
  });

const nodeEval = (code: string) => [process.execPath, "-e", code];

describe("prisma engine retry wrapper", () => {
  it("passes a successful command through untouched", () => {
    const r = run(nodeEval("console.log('schema ok')"));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("schema ok");
  });

  it("never retries a schema error (P1012) and fails on the first attempt", () => {
    // A counter file proves the child ran EXACTLY once. Counting text occurrences would be fooled by
    // the wrapper echoing the command line, which itself contains the error string.
    const counter = "/tmp/vitest-prisma-p1012-count";
    rmSync(counter, { force: true });
    writeFileSync("/tmp/vitest-prisma-p1012-child.js", `
      const fs = require("node:fs");
      const f = ${JSON.stringify(counter)};
      let n = 0; try { n = Number(fs.readFileSync(f, "utf8")); } catch {}
      fs.writeFileSync(f, String(n + 1));
      console.error("error: Error validating: P1012");
      process.exit(1);
    `);
    const r = run([process.execPath, "/tmp/vitest-prisma-p1012-child.js"], { PRISMA_RETRY_ATTEMPTS: "5" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("not retrying");
    expect(r.stderr).not.toContain("RETRY:");
    expect(readFileSync(counter, "utf8")).toBe("1");
    rmSync(counter, { force: true });
    rmSync("/tmp/vitest-prisma-p1012-child.js", { force: true });
  });

  it("never retries a schema parse error", () => {
    const r = run(nodeEval("console.error('error: Error parsing attribute'); process.exit(1)"));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("not retrying");
  });

  it("retries a transport fault and reports the attempt that succeeded", () => {
    const counter = "/tmp/vitest-prisma-retry-counter";
    rmSync(counter, { force: true });
    writeFileSync("/tmp/vitest-prisma-retry-code.js", `
      const fs = require("node:fs");
      const f = ${JSON.stringify(counter)};
      let n = 0; try { n = Number(fs.readFileSync(f, "utf8")); } catch {}
      n += 1; fs.writeFileSync(f, String(n));
      if (n < 3) {
        console.error("Error: request to https://binaries.prisma.sh/x.gz.sha256 failed, reason: Client network socket disconnected");
        process.exit(1);
      }
      console.log("SCHEMA VALID");
    `);
    const r = run([process.execPath, "/tmp/vitest-prisma-retry-code.js"], { PRISMA_RETRY_ATTEMPTS: "5" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("SCHEMA VALID");
    // The success notice is informational, so it goes to stdout alongside the command's own output.
    expect(r.stdout).toContain("succeeded on attempt 3/5");
    rmSync(counter, { force: true });
    rmSync("/tmp/vitest-prisma-retry-code.js", { force: true });
  });

  it("keeps the failing exit code and says BLOCKED when the mirror never recovers", () => {
    const r = run(nodeEval("console.error('Error: request to https://binaries.prisma.sh/y.gz failed, reason: ETIMEDOUT'); process.exit(7)"), {
      PRISMA_RETRY_ATTEMPTS: "2",
    });
    expect(r.status).toBe(7);
    expect(r.stderr).toContain("BLOCKED");
    expect(r.stderr).toContain("not a schema defect");
  });

  it("does not leak engine URLs verbatim into the summary line", () => {
    const r = run(nodeEval("console.error('Error: request to https://binaries.prisma.sh/secret-path.gz failed, reason: ECONNRESET'); process.exit(1)"), {
      PRISMA_RETRY_ATTEMPTS: "1",
    });
    expect(r.stderr).toContain("<engine-url>");
  });
});

// The workflow must route validation/generation through the wrapper, and must not have gained a
// bypass: `prisma validate` has to still run, and the generated-client blocker must stay.
describe("release validation keeps schema validation mandatory", () => {
  const workflow = readFileSync(".github/workflows/release-validation.yml", "utf8");

  it("runs prisma validate and generate through the retry wrapper", () => {
    expect(workflow).toContain("retry-prisma-engine.mjs -- bash scripts/lib/prisma-cli.sh validate");
    expect(workflow).toContain("retry-prisma-engine.mjs -- bash scripts/lib/prisma-generate.sh");
  });

  it("still blocks when the client was not generated", () => {
    expect(workflow).toContain("BLOCKED: Prisma Client was not generated");
  });

  it("does not add a continue-on-error or skip to the Prisma step", () => {
    const prismaStep = workflow.slice(
      workflow.indexOf("Validate Prisma schema and generate the client"),
      workflow.indexOf("      - name: Lint"),
    );
    expect(prismaStep).not.toContain("continue-on-error");
    expect(prismaStep).not.toContain("if: false");
    expect(prismaStep).not.toContain("|| true");
  });

  it("does not exclude files from the TypeScript check", () => {
    const tsconfig = readFileSync("tsconfig.json", "utf8");
    const excludeBlock = tsconfig.slice(tsconfig.indexOf('"exclude"'));
    // Only node_modules may be excluded — never tests or source, which would manufacture a pass.
    expect(excludeBlock).not.toMatch(/tests/);
    expect(excludeBlock).not.toMatch(/app/);
    expect(excludeBlock).not.toMatch(/lib/);
  });
});
