/**
 * JATA AFTERCALL — migration gate refusal tests.
 *
 * These tests execute the real `scripts/migrate.sh` (and `scripts/build.sh`)
 * with a recording `npx` stub first on PATH, and assert two things at once:
 *
 *   1. the process exit code, and
 *   2. exactly which commands were allowed to run.
 *
 * That second assertion is the point. A guard that "returns false" but still
 * lets Prisma start is worthless, so every refusal case here proves the stub
 * was never invoked. `npx` stands in for `prisma migrate deploy`,
 * `prisma generate` and `next build`: if it is not called, no Prisma binary and
 * no build ran.
 *
 * No database, no network, no application dependencies.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROD_FP = "3439ca4ed940f77fde4d30f94a8873dc02ccf3daa1baec900804857450f3e8d5";

const PROD_URL =
  "postgresql://user:sup3rs3cret@ep-autumn-sea-axqkyeaf-pooler.c-4.us-east-2.aws.neon.tech/neondb";
const PREVIEW_URL =
  "postgresql://user:previewpw@ep-orange-water-axziuiqn-pooler.c-4.us-east-2.aws.neon.tech/jata_preview";

let workDir;
let stubDir;
let logPath;
let allowEnrolledPath;
let allowOtherPath;
let allowUnenrolledPath;
let basePath;

before(() => {
  workDir = mkdtempSync(join(tmpdir(), "migrate-gate-"));
  stubDir = join(workDir, "bin");
  mkdirSync(stubDir, { recursive: true });
  logPath = join(workDir, "npx.log");

  // Recording stub. Every invocation appends its argv; it never fails.
  const stub = join(stubDir, "npx");
  writeFileSync(
    stub,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$NPX_LOG"\nexit 0\n`,
    "utf8",
  );
  chmodSync(stub, 0o755);

  allowEnrolledPath = join(workDir, "allow-enrolled.json");
  writeFileSync(
    allowEnrolledPath,
    JSON.stringify({
      version: 2,
      production: {
        mode: "enrolled",
        fingerprints: [PROD_FP],
        enrollmentEvidence: "test fixture only — not a real enrolment",
      },
      expectedHosts: [],
    }),
    "utf8",
  );

  allowOtherPath = join(workDir, "allow-other.json");
  writeFileSync(
    allowOtherPath,
    JSON.stringify({
      version: 2,
      production: {
        mode: "enrolled",
        fingerprints: ["0".repeat(64)],
        enrollmentEvidence: "test fixture only — deliberately non-matching",
      },
      expectedHosts: [],
    }),
    "utf8",
  );

  // Fail-closed must remain provable now that the shipped allowlist is enrolled.
  allowUnenrolledPath = join(workDir, "allow-unenrolled.json");
  writeFileSync(
    allowUnenrolledPath,
    JSON.stringify({
      version: 2,
      production: { mode: "unenrolled", fingerprints: [], enrollmentEvidence: null },
      expectedHosts: [],
    }),
    "utf8",
  );

  basePath = [stubDir, dirname(process.execPath), "/usr/local/bin", "/usr/bin", "/bin"].join(":");
});

after(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

/** Clear the npx log so each case observes only its own calls. */
function resetLog() {
  writeFileSync(logPath, "", "utf8");
}

function npxCalls() {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").split("\n").filter(Boolean);
}

/**
 * Run a shell script with a minimal, explicit environment.
 * `extra` is the only environment the process sees (plus PATH and NPX_LOG).
 */
function runScript(script, extra, cwd = ROOT) {
  resetLog();
  const result = spawnSync("bash", [script], {
    cwd,
    encoding: "utf8",
    env: { PATH: basePath, NPX_LOG: logPath, HOME: workDir, ...extra },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    calls: npxCalls(),
  };
}

const migrate = (extra) => runScript("scripts/migrate.sh", extra);

// ---------------------------------------------------------------------------
describe("migrate.sh — refusals never reach npx", () => {
  test("production with the shipped enrolled allowlist reaches prisma", () => {
    const r = migrate({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: PROD_URL });
    assert.equal(r.status, 0);
    assert.deepEqual(r.calls, ["prisma migrate deploy"]);
    assert.match(r.stdout, /OK_ENROLLED_PRODUCTION/);
  });

  test("an unenrolled allowlist still refuses before npx", () => {
    const r = migrate({
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: PROD_URL,
      MIGRATION_GUARD_ALLOWLIST: allowUnenrolledPath,
    });
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, [], "npx must not run");
    assert.match(r.stderr, /REFUSED_PRODUCTION_UNENROLLED/);
    assert.match(r.stdout, /aborting before prisma/);
  });

  test("production with an enrolled but non-matching fingerprint is refused", () => {
    const r = migrate({
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: PROD_URL,
      MIGRATION_GUARD_ALLOWLIST: allowOtherPath,
    });
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, []);
    assert.match(r.stderr, /REFUSED_PRODUCTION_UNKNOWN_TARGET/);
  });

  test("a Vercel build with no VERCEL_ENV is refused", () => {
    const r = migrate({ VERCEL: "1", DATABASE_URL: PROD_URL });
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, []);
    assert.match(r.stderr, /REFUSED_UNKNOWN_ENVIRONMENT/);
  });

  test("a Vercel build with an unrecognised VERCEL_ENV is refused", () => {
    const r = migrate({ VERCEL: "1", VERCEL_ENV: "staging", DATABASE_URL: PROD_URL });
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, []);
  });

  test("an unparseable DATABASE_URL is refused locally too", () => {
    const r = migrate({ DATABASE_URL: "this-is-not-a-url" });
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, []);
    assert.match(r.stderr, /REFUSED_UNPARSEABLE_URL/);
  });

  test("a DATABASE_URL without a database name is refused", () => {
    const r = migrate({ DATABASE_URL: "postgresql://user:pw@db.example.com:5432/" });
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, []);
  });

  test("a non-PostgreSQL URL is refused", () => {
    const r = migrate({ DATABASE_URL: "mysql://user:pw@db.example.com/app" });
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, []);
  });

  test("an invalid MIGRATION_GUARD_MODE is refused, not ignored", () => {
    const r = migrate({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      DATABASE_URL: PREVIEW_URL,
      MIGRATION_GUARD_MODE: "disable",
    });
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, []);
    assert.match(r.stderr, /REFUSED_INVALID_MODE/);
  });

  test("preview may not migrate an enrolled production target", () => {
    const r = migrate({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      DATABASE_URL: PROD_URL,
      MIGRATION_GUARD_ALLOWLIST: allowEnrolledPath,
    });
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, []);
    assert.match(r.stderr, /may not migrate an enrolled production target/);
  });

  test("a missing guard module fails closed", () => {
    // Copy the script somewhere the guard does not exist and run it there.
    const dir = join(workDir, "no-guard");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(
      join(dir, "scripts", "migrate.sh"),
      readFileSync(join(ROOT, "scripts", "migrate.sh"), "utf8"),
      "utf8",
    );
    const r = runScript("scripts/migrate.sh", { VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: PROD_URL }, dir);
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, [], "a missing guard must not let prisma run");
  });
});

// ---------------------------------------------------------------------------
describe("migrate.sh — allowed paths still run prisma", () => {
  test("preview with a preview database runs exactly one migration command", () => {
    const r = migrate({ VERCEL: "1", VERCEL_ENV: "preview", DATABASE_URL: PREVIEW_URL });
    assert.equal(r.status, 0);
    assert.deepEqual(r.calls, ["prisma migrate deploy"]);
    assert.match(r.stdout, /OK_PREVIEW/);
  });

  test("production with a matching enrolled fingerprint runs the migration", () => {
    const r = migrate({
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: PROD_URL,
      MIGRATION_GUARD_ALLOWLIST: allowEnrolledPath,
    });
    assert.equal(r.status, 0);
    assert.deepEqual(r.calls, ["prisma migrate deploy"]);
    assert.match(r.stdout, /OK_ENROLLED_PRODUCTION/);
  });

  test("a CI runner with its own database migrates", () => {
    const r = migrate({ CI: "true", DATABASE_URL: "postgresql://user:pw@127.0.0.1:5432/jata_test" });
    assert.equal(r.status, 0);
    assert.deepEqual(r.calls, ["prisma migrate deploy"]);
  });

  test("no DATABASE_URL skips the migration entirely", () => {
    const r = migrate({});
    assert.equal(r.status, 0);
    assert.deepEqual(r.calls, []);
    assert.match(r.stdout, /skipping migrations/);
  });
});

// ---------------------------------------------------------------------------
describe("build.sh — a refused migration stops the whole build", () => {
  test("production unenrolled never reaches generate or next build", () => {
    const r = runScript("scripts/build.sh", {
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: PROD_URL,
      MIGRATION_GUARD_ALLOWLIST: allowUnenrolledPath,
    });
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, [], "neither prisma generate nor next build may run");
    assert.equal(r.stdout.includes("Running prisma generate"), false);
    assert.equal(r.stdout.includes("Running next build"), false);
  });

  test("production non-matching never reaches generate or next build", () => {
    const r = runScript("scripts/build.sh", {
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: PROD_URL,
      MIGRATION_GUARD_ALLOWLIST: allowOtherPath,
    });
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, []);
  });

  test("an allowed target runs migrate, generate, then next build, in order", () => {
    const r = runScript("scripts/build.sh", {
      VERCEL: "1",
      VERCEL_ENV: "preview",
      DATABASE_URL: PREVIEW_URL,
    });
    assert.equal(r.status, 0);
    assert.deepEqual(r.calls, ["prisma migrate deploy", "prisma generate", "next build --webpack"]);
  });

  test("a build without DATABASE_URL skips migrate but still generates and builds", () => {
    const r = runScript("scripts/build.sh", {});
    assert.equal(r.status, 0);
    assert.deepEqual(r.calls, ["prisma generate", "next build --webpack"]);
  });
});

// ---------------------------------------------------------------------------
describe("no secret material in gate output", () => {
  test("refusal output never contains the password, host, or connection string", () => {
    const r = migrate({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: PROD_URL });
    const combined = `${r.stdout}${r.stderr}`;
    for (const needle of ["sup3rs3cret", "ep-autumn-sea-axqkyeaf", "postgresql://", "user:"]) {
      assert.equal(combined.includes(needle), false, needle);
    }
  });

  test("allowed output never contains the password or connection string", () => {
    const r = migrate({ VERCEL: "1", VERCEL_ENV: "preview", DATABASE_URL: PREVIEW_URL });
    const combined = `${r.stdout}${r.stderr}`;
    for (const needle of ["previewpw", "postgresql://", "ep-orange-water"]) {
      assert.equal(combined.includes(needle), false, needle);
    }
  });
});
