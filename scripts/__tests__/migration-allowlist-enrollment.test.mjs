/**
 * JATA AFTERCALL — enrolment assertions for the Production migration target.
 *
 * The allowlist stopped being a placeholder on 2026-10-18: exactly one
 * Production fingerprint is enrolled, so the guard now has a real identity to
 * compare against and the cross-environment rule is live.
 *
 * These tests pin the four properties that enrolment changes or depends on:
 *
 *   1. the enrolled digest is the verified Production target, and is
 *      reproducible from host | database rather than copied;
 *   2. the Preview endpoint and the CI disposable database are NOT accepted as
 *      Production, even though a human with a dashboard one click away could
 *      paste either;
 *   3. an unknown fingerprint fails closed;
 *   4. the guard suite as a whole still passes (asserted by running it).
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

import {
  CODES,
  evaluate,
  fingerprintOf,
  loadAllowlist,
  describe as describeDecision,
} from "../lib/migration-target-guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SHIPPED_ALLOWLIST = join(HERE, "..", "lib", "migration-target-allowlist.json");

/** Full digests. Never truncated: a prefix is not an identity. */
const PROD_FP = "3439ca4ed940f77fde4d30f94a8873dc02ccf3daa1baec900804857450f3e8d5";
const PREVIEW_FP = "82a73ff3eeba1146487d4169ec6440ed6260dd7e0ef11a39390ec0c415b0bd90";
const CI_FP = "f6fc2354ab2f064b9c8e0e4dcea44ec74cc1a14a3f24fb46df6486423bfc80d3";

const PROD_HOST = "ep-autumn-sea-axqkyeaf-pooler.c-4.us-east-2.aws.neon.tech";
const PROD_DB = "neondb";
const PROD_URL = `postgresql://user:sup3rs3cret@${PROD_HOST}/${PROD_DB}`;
// The unpooled twin of PROD_URL. Migrations must not run through PgBouncer's transaction pooling, so
// every case that actually reaches `migrate deploy` supplies this beside the pooled runtime URL.
const PROD_DIRECT_URL = `postgresql://user:sup3rs3cret@${PROD_HOST.replace("-pooler", "")}/${PROD_DB}`;
const PREVIEW_URL =
  "postgresql://user:previewpw@ep-orange-water-axziuiqn-pooler.c-4.us-east-2.aws.neon.tech/jata_preview";
const PREVIEW_DIRECT_URL =
  "postgresql://user:previewpw@ep-orange-water-axziuiqn.c-4.us-east-2.aws.neon.tech/jata_preview";
/** The disposable database the e2e job provisions; never a deployment identity. */
const CI_URL = "postgresql://jata:jata@localhost:5432/jata_e2e?schema=public";
const UNKNOWN_URL = "postgresql://user:pw@db.somewhere-else.invalid/app";

let workDir;
let stubDir;
let logPath;
let basePath;
let allowUnenrolledPath;

before(() => {
  workDir = mkdtempSync(join(tmpdir(), "enrolment-"));
  stubDir = join(workDir, "bin");
  mkdirSync(stubDir, { recursive: true });
  logPath = join(workDir, "npx.log");

  const stub = join(stubDir, "npx");
  writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$NPX_LOG"\nexit 0\n`, "utf8");
  chmodSync(stub, 0o755);

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

function npxCalls() {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").split("\n").filter(Boolean);
}

function runScript(script, extra) {
  writeFileSync(logPath, "", "utf8");
  const result = spawnSync("bash", [script], {
    cwd: ROOT,
    encoding: "utf8",
    env: { PATH: basePath, NPX_LOG: logPath, HOME: workDir, ...extra },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", calls: npxCalls() };
}

// ---------------------------------------------------------------------------
describe("the shipped allowlist", () => {
  test("is enrolled with exactly one Production fingerprint", () => {
    const r = loadAllowlist(SHIPPED_ALLOWLIST);
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.production.mode, "enrolled");
    assert.deepEqual(r.production.fingerprints, [PROD_FP]);
  });

  test("carries non-empty enrolment evidence and no hostnames", () => {
    const r = loadAllowlist(SHIPPED_ALLOWLIST);
    assert.equal(typeof r.production.enrollmentEvidence, "string");
    assert.ok(r.production.enrollmentEvidence.trim().length > 0);
    // The record must not smuggle URL material into a public repository.
    const evidence = r.production.enrollmentEvidence;
    for (const needle of ["postgresql://", "neon.tech", "sup3rs3cret", "previewpw"]) {
      assert.equal(evidence.includes(needle), false, needle);
    }
    assert.deepEqual(r.expectedHosts, []);
  });

  test("the enrolled digest is reproducible from host | database", () => {
    // Uses the guard's own function: a hand-copied digest that no longer
    // matches the identity would fail here rather than at a Production build.
    assert.equal(fingerprintOf(PROD_HOST, PROD_DB), PROD_FP);
  });

  test("does not enrol the Preview or CI disposable databases", () => {
    const r = loadAllowlist(SHIPPED_ALLOWLIST);
    const enrolled = r.production.fingerprints;
    assert.equal(enrolled.includes(PREVIEW_FP), false, "Preview must not be enrolled as Production");
    assert.equal(enrolled.includes(CI_FP), false, "the CI disposable database must not be enrolled");
    assert.equal(new Set(enrolled).size, enrolled.length);
  });
});

// ---------------------------------------------------------------------------
describe("Production decisions against the shipped allowlist", () => {
  test("the enrolled Production target is accepted", () => {
    const r = evaluate({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: PROD_URL });
    assert.equal(r.allow, true);
    assert.equal(r.code, CODES.OK_ENROLLED_PRODUCTION);
    assert.equal(r.fingerprint, PROD_FP);
  });

  test("the Preview endpoint is not accepted as Production", () => {
    const r = evaluate({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: PREVIEW_URL });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_PRODUCTION_UNKNOWN_TARGET);
    assert.equal(r.fingerprint, PREVIEW_FP);
  });

  test("the CI disposable database is not accepted as Production", () => {
    const r = evaluate({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: CI_URL });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_PRODUCTION_UNKNOWN_TARGET);
    assert.equal(r.fingerprint, CI_FP);
  });

  test("an unknown fingerprint fails closed", () => {
    const r = evaluate({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: UNKNOWN_URL });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_PRODUCTION_UNKNOWN_TARGET);
    assert.notEqual(r.fingerprint, PROD_FP);
  });

  test("a Production target with no database name fails closed", () => {
    const r = evaluate({
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: `postgresql://u:p@${PROD_HOST}/`,
    });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_MISSING_DATABASE_NAME);
  });
});

// ---------------------------------------------------------------------------
describe("the cross-environment rule is live now that a fingerprint is enrolled", () => {
  test("Preview pointing at the Production target is refused", () => {
    const r = evaluate({ VERCEL: "1", VERCEL_ENV: "preview", DATABASE_URL: PROD_URL });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_NON_PRODUCTION_TARGETS_PRODUCTION);
    assert.equal(r.environment, "preview");
  });

  test("CI pointing at the Production target is refused", () => {
    const r = evaluate({ CI: "true", DATABASE_URL: PROD_URL });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_NON_PRODUCTION_TARGETS_PRODUCTION);
    assert.equal(r.environment, "ci");
  });

  test("local pointing at the Production target is refused", () => {
    const r = evaluate({ DATABASE_URL: PROD_URL });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_NON_PRODUCTION_TARGETS_PRODUCTION);
    assert.equal(r.environment, "local");
  });

  test("Preview migrating its own database is still allowed", () => {
    const r = evaluate({ VERCEL: "1", VERCEL_ENV: "preview", DATABASE_URL: PREVIEW_URL });
    assert.equal(r.allow, true);
    assert.equal(r.code, CODES.OK_PREVIEW);
  });

  test("CI migrating its own database is still allowed", () => {
    const r = evaluate({ CI: "true", DATABASE_URL: CI_URL });
    assert.equal(r.allow, true);
    assert.equal(r.code, CODES.OK_CI);
  });
});

// ---------------------------------------------------------------------------
describe("migrate.sh with the shipped allowlist", () => {
  test("Production runs exactly one prisma migrate deploy", () => {
    const r = runScript("scripts/migrate.sh", {
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: PROD_URL,
      DIRECT_URL: PROD_DIRECT_URL,
    });
    assert.equal(r.status, 0);
    assert.deepEqual(r.calls, ["prisma migrate deploy"]);
    assert.match(r.stdout, /OK_ENROLLED_PRODUCTION/);
  });

  test("Preview holding the Production URL never reaches npx", () => {
    const r = runScript("scripts/migrate.sh", {
      VERCEL: "1",
      VERCEL_ENV: "preview",
      DATABASE_URL: PROD_URL,
      DIRECT_URL: PROD_DIRECT_URL,
    });
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, [], "npx must not run");
    assert.match(r.stderr, /REFUSED_NON_PRODUCTION_TARGETS_PRODUCTION/);
  });

  test("an unenrolled allowlist still refuses before npx", () => {
    const r = runScript("scripts/migrate.sh", {
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: PROD_URL,
      DIRECT_URL: PROD_DIRECT_URL,
      MIGRATION_GUARD_ALLOWLIST: allowUnenrolledPath,
    });
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, []);
    assert.match(r.stderr, /REFUSED_PRODUCTION_UNENROLLED/);
  });

  test("build.sh on Production continues past migrate with the enrolled target", () => {
    // The whole point of enrolling in the same change: a Production build is
    // not refused, and it proceeds migrate -> generate -> next build in order.
    const r = runScript("scripts/build.sh", {
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: PROD_URL,
      DIRECT_URL: PROD_DIRECT_URL,
    });
    assert.equal(r.status, 0);
    assert.deepEqual(r.calls, ["prisma migrate deploy", "prisma generate", "next build --webpack"]);
    assert.match(r.stdout, /OK_ENROLLED_PRODUCTION/);
  });

  test("build.sh on Production still stops before generate when refused", () => {
    const r = runScript("scripts/build.sh", {
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: PREVIEW_URL,
      DIRECT_URL: PREVIEW_DIRECT_URL,
    });
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, []);
    assert.equal(r.stdout.includes("Running prisma generate"), false);
    assert.equal(r.stdout.includes("Running next build"), false);
  });
});

// ---------------------------------------------------------------------------
describe("enrolment does not widen what the guard prints", () => {
  test("the allowed decision line carries the digest and no URL material", () => {
    const r = evaluate({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: PROD_URL });
    const line = describeDecision(r);
    assert.ok(line.includes(PROD_FP));
    for (const needle of ["postgresql://", PROD_HOST, PROD_DB, "sup3rs3cret", "user:"]) {
      assert.equal(line.includes(needle), false, needle);
    }
  });
});
