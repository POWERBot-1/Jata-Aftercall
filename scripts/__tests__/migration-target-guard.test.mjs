/**
 * JATA AFTERCALL — migration target guard regression suite.
 *
 * Run with:  node --test scripts/__tests__/migration-target-guard.test.mjs
 * (CI runs this file together with migration-gate-refusal.test.mjs.)
 *
 * Deliberately plain `node:test` with no dependencies. The guard executes in a
 * build container *before* application dependencies are guaranteed to exist,
 * so its tests must not depend on the application toolchain and must pass with
 * `node_modules` absent.
 *
 * The most important tests here are the refusals: for every rejected target the
 * assertions check `allow === false`, and `scripts/__tests__/migration-gate-refusal.test.mjs`
 * proves separately that a refusal stops before `npx` is invoked at all.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import {
  ENVIRONMENTS,
  MODES,
  CODES,
  normalizeHost,
  parseTarget,
  fingerprintOf,
  resolveEnvironment,
  resolveMode,
  loadAllowlist,
  decide,
  evaluate,
  describe as describeResult,
  toJSON,
  run,
} from "../lib/migration-target-guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIPPED_ALLOWLIST = join(HERE, "..", "lib", "migration-target-allowlist.json");
const GUARD_SOURCE = join(HERE, "..", "lib", "migration-target-guard.mjs");

const PROD_FP = "3439ca4ed940f77fde4d30f94a8873dc02ccf3daa1baec900804857450f3e8d5";
const OTHER_FP = "0000000000000000000000000000000000000000000000000000000000000000";

/** Build a throwaway allowlist file; caller removes the directory afterwards. */
function allowlistFixture(production, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mtg-"));
  const path = join(dir, "allowlist.json");
  writeFileSync(path, JSON.stringify({ version: 2, production, ...extra }), "utf8");
  return { dir, path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function enrolled(fingerprints = [PROD_FP], evidence = "reviewed 2026-01-01") {
  return { mode: "enrolled", fingerprints, enrollmentEvidence: evidence };
}

function okAllowlist(fingerprints = [PROD_FP]) {
  return { ok: true, production: { mode: "enrolled", fingerprints }, expectedHosts: [] };
}

// ---------------------------------------------------------------------------
describe("normalizeHost", () => {
  test("lowercases", () => {
    assert.equal(normalizeHost("DB.Example.COM"), "db.example.com");
  });

  test("trims surrounding whitespace", () => {
    assert.equal(normalizeHost("  db.example.com  "), "db.example.com");
  });

  test("strips a single trailing dot", () => {
    assert.equal(normalizeHost("db.example.com."), "db.example.com");
  });

  test("strips repeated trailing dots", () => {
    assert.equal(normalizeHost("db.example.com..."), "db.example.com");
  });

  test("preserves internal dots and hyphens", () => {
    assert.equal(normalizeHost("ep-a-b.c-4.us-east-2.aws.neon.tech"), "ep-a-b.c-4.us-east-2.aws.neon.tech");
  });

  test("does not alter an already-normal host", () => {
    assert.equal(normalizeHost("localhost"), "localhost");
  });
});

// ---------------------------------------------------------------------------
describe("parseTarget", () => {
  test("parses a postgresql URL", () => {
    const r = parseTarget("postgresql://user:pass@db.example.com:5432/app?sslmode=require");
    assert.deepEqual(r, { ok: true, host: "db.example.com", database: "app" });
  });

  test("accepts the postgres:// scheme", () => {
    const r = parseTarget("postgres://user:pass@db.example.com/app");
    assert.equal(r.ok, true);
    assert.equal(r.host, "db.example.com");
  });

  test("normalises an uppercase host", () => {
    assert.equal(parseTarget("postgresql://u:p@DB.Example.COM/app").host, "db.example.com");
  });

  test("normalises a trailing-dot host", () => {
    assert.equal(parseTarget("postgresql://u:p@db.example.com./app").host, "db.example.com");
  });

  test("preserves database-name case", () => {
    assert.equal(parseTarget("postgresql://u:p@h/MyDb").database, "MyDb");
  });

  test("percent-decodes the database name", () => {
    assert.equal(parseTarget("postgresql://u:p@h/my%20db").database, "my db");
  });

  test("ignores credentials for identity", () => {
    const a = parseTarget("postgresql://alice:secret@h/app");
    const b = parseTarget("postgresql://bob:other@h/app");
    assert.equal(a.host, b.host);
    assert.equal(a.database, b.database);
  });

  test("ignores the port for identity", () => {
    assert.equal(parseTarget("postgresql://u:p@h:5432/app").host, "h");
    assert.equal(parseTarget("postgresql://u:p@h:9999/app").host, "h");
  });

  test("ignores the query string for identity", () => {
    assert.equal(parseTarget("postgresql://u:p@h/app?schema=other").database, "app");
  });

  test("treats undefined as missing", () => {
    assert.deepEqual(parseTarget(undefined), { ok: false, reason: "missing" });
  });

  test("treats an empty string as missing", () => {
    assert.deepEqual(parseTarget(""), { ok: false, reason: "missing" });
  });

  test("treats whitespace as missing", () => {
    assert.deepEqual(parseTarget("   "), { ok: false, reason: "missing" });
  });

  test("rejects a non-URL string", () => {
    assert.deepEqual(parseTarget("not a url"), { ok: false, reason: "unparseable" });
  });

  test("rejects a non-PostgreSQL scheme", () => {
    assert.deepEqual(parseTarget("mysql://u:p@h/app"), { ok: false, reason: "unparseable" });
  });

  test("rejects an http URL", () => {
    assert.deepEqual(parseTarget("https://h/app"), { ok: false, reason: "unparseable" });
  });

  test("rejects a URL with no database name", () => {
    assert.deepEqual(parseTarget("postgresql://u:p@h:5432/"), { ok: false, reason: "missing_database" });
  });

  test("rejects a URL with no path at all", () => {
    assert.deepEqual(parseTarget("postgresql://u:p@h"), { ok: false, reason: "missing_database" });
  });

  test("rejects only-slash paths", () => {
    assert.deepEqual(parseTarget("postgresql://u:p@h////"), { ok: false, reason: "missing_database" });
  });

  test("rejects a malformed percent escape rather than throwing", () => {
    assert.deepEqual(parseTarget("postgresql://u:p@h/%ZZ"), { ok: false, reason: "unparseable" });
  });

  test("never returns credential material", () => {
    const r = parseTarget("postgresql://alice:sup3rs3cret@db.example.com/app");
    assert.equal(JSON.stringify(r).includes("sup3rs3cret"), false);
    assert.equal(JSON.stringify(r).includes("alice"), false);
  });
});

// ---------------------------------------------------------------------------
describe("fingerprintOf", () => {
  test("is 64 lowercase hex characters", () => {
    assert.match(fingerprintOf("db.example.com", "app"), /^[0-9a-f]{64}$/);
  });

  test("matches an independently computed vector", () => {
    assert.equal(
      fingerprintOf("db.example.com", "app"),
      "c759b448f1106e79ea7f1ca196d5c612f242be296cd172ca70fab05db84d7832",
    );
  });

  test("is deterministic", () => {
    assert.equal(fingerprintOf("h", "app"), fingerprintOf("h", "app"));
  });

  test("ignores host case", () => {
    assert.equal(fingerprintOf("DB.EXAMPLE.COM", "app"), fingerprintOf("db.example.com", "app"));
  });

  test("ignores a trailing dot in the host", () => {
    assert.equal(fingerprintOf("db.example.com.", "app"), fingerprintOf("db.example.com", "app"));
  });

  test("is sensitive to database-name case", () => {
    assert.notEqual(fingerprintOf("db.example.com", "app"), fingerprintOf("db.example.com", "APP"));
  });

  test("changes when the database changes", () => {
    assert.notEqual(fingerprintOf("h", "app"), fingerprintOf("h", "other"));
  });

  test("changes when the host changes", () => {
    assert.notEqual(fingerprintOf("h1", "app"), fingerprintOf("h2", "app"));
  });

  test("reproduces the vector observed in the Vercel build log", () => {
    // The production build of 0131445 printed this host and database. This is a
    // reproducibility vector only — it is NOT an enrolment, and a match proves
    // only that the same host+database was hashed.
    assert.equal(
      fingerprintOf("ep-autumn-sea-axqkyeaf-pooler.c-4.us-east-2.aws.neon.tech", "neondb"),
      PROD_FP,
    );
  });
});

// ---------------------------------------------------------------------------
describe("resolveEnvironment", () => {
  test("production when VERCEL_ENV=production", () => {
    assert.equal(resolveEnvironment({ VERCEL: "1", VERCEL_ENV: "production" }), "production");
  });

  test("preview when VERCEL_ENV=preview", () => {
    assert.equal(resolveEnvironment({ VERCEL: "1", VERCEL_ENV: "preview" }), "preview");
  });

  test("development when VERCEL_ENV=development", () => {
    assert.equal(resolveEnvironment({ VERCEL: "1", VERCEL_ENV: "development" }), "development");
  });

  test("case-insensitive VERCEL_ENV", () => {
    assert.equal(resolveEnvironment({ VERCEL: "1", VERCEL_ENV: "Production" }), "production");
  });

  test("trims VERCEL_ENV", () => {
    assert.equal(resolveEnvironment({ VERCEL: "1", VERCEL_ENV: " preview " }), "preview");
  });

  test("unknown when on Vercel without VERCEL_ENV", () => {
    assert.equal(resolveEnvironment({ VERCEL: "1" }), "unknown");
  });

  test("unknown when VERCEL_ENV is empty", () => {
    assert.equal(resolveEnvironment({ VERCEL: "1", VERCEL_ENV: "" }), "unknown");
  });

  test("unknown when VERCEL_ENV is unrecognised", () => {
    assert.equal(resolveEnvironment({ VERCEL: "1", VERCEL_ENV: "staging" }), "unknown");
  });

  test("ci when CI is set and not on Vercel", () => {
    assert.equal(resolveEnvironment({ CI: "true" }), "ci");
  });

  test("local when nothing is set", () => {
    assert.equal(resolveEnvironment({}), "local");
  });

  test("CI=false is not ci", () => {
    assert.equal(resolveEnvironment({ CI: "false" }), "local");
  });

  test("CI=0 is not ci", () => {
    assert.equal(resolveEnvironment({ CI: "0" }), "local");
  });

  test("VERCEL=0 does not count as Vercel", () => {
    assert.equal(resolveEnvironment({ VERCEL: "0", CI: "true" }), "ci");
  });

  test("VERCEL=false does not count as Vercel", () => {
    assert.equal(resolveEnvironment({ VERCEL: "false" }), "local");
  });

  test("a declared VERCEL_ENV wins even without VERCEL", () => {
    // More restrictive than treating it as local: production stays production.
    assert.equal(resolveEnvironment({ VERCEL_ENV: "production" }), "production");
  });

  test("every returned value is a documented environment", () => {
    for (const env of [{}, { CI: "1" }, { VERCEL: "1" }, { VERCEL: "1", VERCEL_ENV: "preview" }]) {
      assert.ok(ENVIRONMENTS.includes(resolveEnvironment(env)));
    }
  });
});

// ---------------------------------------------------------------------------
describe("resolveMode", () => {
  test("absent means enforce", () => {
    assert.equal(resolveMode({}), "enforce");
  });

  test("explicit enforce", () => {
    assert.equal(resolveMode({ MIGRATION_GUARD_MODE: "enforce" }), "enforce");
  });

  test("explicit off", () => {
    assert.equal(resolveMode({ MIGRATION_GUARD_MODE: "off" }), "off");
  });

  test("trims whitespace", () => {
    assert.equal(resolveMode({ MIGRATION_GUARD_MODE: " off " }), "off");
  });

  test("blank is invalid", () => {
    assert.equal(resolveMode({ MIGRATION_GUARD_MODE: "" }), null);
  });

  test("uppercase is invalid", () => {
    assert.equal(resolveMode({ MIGRATION_GUARD_MODE: "OFF" }), null);
  });

  test("a typo is invalid", () => {
    assert.equal(resolveMode({ MIGRATION_GUARD_MODE: "disabled" }), null);
  });

  test("a numeric zero is invalid, not off", () => {
    assert.equal(resolveMode({ MIGRATION_GUARD_MODE: "0" }), null);
  });

  test("only the two documented modes exist", () => {
    assert.deepEqual([...MODES], ["enforce", "off"]);
  });
});

// ---------------------------------------------------------------------------
describe("loadAllowlist", () => {
  test("loads the shipped allowlist", () => {
    const r = loadAllowlist(SHIPPED_ALLOWLIST);
    assert.equal(r.ok, true);
  });

  test("the shipped allowlist is unenrolled and empty", () => {
    // Guards against an accidental enrolment slipping into the repository.
    const r = loadAllowlist(SHIPPED_ALLOWLIST);
    assert.equal(r.production.mode, "unenrolled");
    assert.deepEqual(r.production.fingerprints, []);
    assert.equal(r.production.enrollmentEvidence, null);
  });

  test("loads a valid enrolled allowlist", () => {
    const f = allowlistFixture(enrolled());
    try {
      const r = loadAllowlist(f.path);
      assert.equal(r.ok, true);
      assert.equal(r.production.mode, "enrolled");
      assert.deepEqual(r.production.fingerprints, [PROD_FP]);
    } finally {
      f.cleanup();
    }
  });

  test("missing file is unreadable", () => {
    assert.deepEqual(loadAllowlist("/nonexistent/allowlist.json"), {
      ok: false,
      reason: "allowlist_unreadable_or_malformed",
    });
  });

  test("malformed JSON is rejected", () => {
    const dir = mkdtempSync(join(tmpdir(), "mtg-"));
    const path = join(dir, "bad.json");
    writeFileSync(path, "{ not json", "utf8");
    try {
      assert.equal(loadAllowlist(path).reason, "allowlist_unreadable_or_malformed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a non-object root is rejected", () => {
    const dir = mkdtempSync(join(tmpdir(), "mtg-"));
    const path = join(dir, "arr.json");
    writeFileSync(path, "[1,2,3]", "utf8");
    try {
      assert.equal(loadAllowlist(path).reason, "allowlist_not_an_object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a missing production section is rejected", () => {
    const dir = mkdtempSync(join(tmpdir(), "mtg-"));
    const path = join(dir, "x.json");
    writeFileSync(path, JSON.stringify({ version: 2 }), "utf8");
    try {
      assert.equal(loadAllowlist(path).reason, "allowlist_missing_production_section");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a non-object production section is rejected", () => {
    const dir = mkdtempSync(join(tmpdir(), "mtg-"));
    const path = join(dir, "x.json");
    writeFileSync(path, JSON.stringify({ production: [] }), "utf8");
    try {
      assert.equal(loadAllowlist(path).reason, "allowlist_missing_production_section");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an unknown mode is rejected", () => {
    const f = allowlistFixture({ mode: "on", fingerprints: [], enrollmentEvidence: null });
    try {
      assert.equal(loadAllowlist(f.path).reason, "allowlist_invalid_production_mode");
    } finally {
      f.cleanup();
    }
  });

  test("a non-array fingerprint list is rejected", () => {
    const f = allowlistFixture({ mode: "enrolled", fingerprints: PROD_FP, enrollmentEvidence: "x" });
    try {
      assert.equal(loadAllowlist(f.path).reason, "allowlist_fingerprints_not_an_array");
    } finally {
      f.cleanup();
    }
  });

  test("a malformed fingerprint is rejected", () => {
    const f = allowlistFixture(enrolled(["not-a-hash"]));
    try {
      assert.equal(loadAllowlist(f.path).reason, "allowlist_invalid_fingerprint_entry");
    } finally {
      f.cleanup();
    }
  });

  test("a non-string fingerprint entry is rejected", () => {
    const f = allowlistFixture(enrolled([12345]));
    try {
      assert.equal(loadAllowlist(f.path).reason, "allowlist_invalid_fingerprint_entry");
    } finally {
      f.cleanup();
    }
  });

  test("an uppercase fingerprint is rejected", () => {
    const f = allowlistFixture(enrolled([PROD_FP.toUpperCase()]));
    try {
      assert.equal(loadAllowlist(f.path).reason, "allowlist_invalid_fingerprint_entry");
    } finally {
      f.cleanup();
    }
  });

  test("duplicate fingerprints are rejected", () => {
    const f = allowlistFixture(enrolled([PROD_FP, PROD_FP]));
    try {
      assert.equal(loadAllowlist(f.path).reason, "allowlist_duplicate_fingerprint");
    } finally {
      f.cleanup();
    }
  });

  test("unenrolled with fingerprints is rejected", () => {
    const f = allowlistFixture({ mode: "unenrolled", fingerprints: [PROD_FP], enrollmentEvidence: null });
    try {
      assert.equal(loadAllowlist(f.path).reason, "allowlist_unenrolled_but_fingerprints_present");
    } finally {
      f.cleanup();
    }
  });

  test("enrolled with no fingerprints is rejected", () => {
    const f = allowlistFixture(enrolled([]));
    try {
      assert.equal(loadAllowlist(f.path).reason, "allowlist_enrolled_but_no_fingerprints");
    } finally {
      f.cleanup();
    }
  });

  test("enrolled without evidence is rejected", () => {
    const f = allowlistFixture(enrolled([PROD_FP], null));
    try {
      assert.equal(loadAllowlist(f.path).reason, "allowlist_enrolled_without_enrollment_evidence");
    } finally {
      f.cleanup();
    }
  });

  test("enrolled with blank evidence is rejected", () => {
    const f = allowlistFixture(enrolled([PROD_FP], "   "));
    try {
      assert.equal(loadAllowlist(f.path).reason, "allowlist_enrolled_without_enrollment_evidence");
    } finally {
      f.cleanup();
    }
  });

  test("non-string evidence is rejected", () => {
    // Evidence must be null/undefined or a string, regardless of mode. An
    // enrolled allowlist with numeric evidence also fails the earlier
    // "enrolled needs evidence" check, so this uses the unenrolled mode where
    // the type check is the only rule that applies.
    const f = allowlistFixture({ mode: "unenrolled", fingerprints: [], enrollmentEvidence: 42 });
    try {
      assert.equal(loadAllowlist(f.path).reason, "allowlist_invalid_enrollment_evidence");
    } finally {
      f.cleanup();
    }
  });

  test("enrolled with non-string evidence is rejected", () => {
    const f = allowlistFixture(enrolled([PROD_FP], 42));
    try {
      const r = loadAllowlist(f.path);
      assert.equal(r.ok, false);
      assert.match(r.reason, /enrollment_evidence/);
    } finally {
      f.cleanup();
    }
  });

  test("expectedHosts is normalised and filtered", () => {
    const f = allowlistFixture(
      { mode: "unenrolled", fingerprints: [], enrollmentEvidence: null },
      { expectedHosts: ["DB.Example.COM", 42, null, "other.host."] },
    );
    try {
      const r = loadAllowlist(f.path);
      assert.deepEqual(r.expectedHosts, ["db.example.com", "other.host"]);
    } finally {
      f.cleanup();
    }
  });

  test("a missing expectedHosts is an empty list", () => {
    const f = allowlistFixture({ mode: "unenrolled", fingerprints: [], enrollmentEvidence: null });
    try {
      assert.deepEqual(loadAllowlist(f.path).expectedHosts, []);
    } finally {
      f.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
describe("decide", () => {
  const target = { fingerprint: PROD_FP };
  const base = { environment: "production", mode: "enforce", target, targetProblem: undefined };

  test("mode off allows and warns", () => {
    const r = decide({ ...base, mode: "off", allowlist: okAllowlist() });
    assert.equal(r.allow, true);
    assert.equal(r.code, CODES.OK_OFF);
  });

  test("mode off wins even over an invalid allowlist", () => {
    const r = decide({ ...base, mode: "off", allowlist: { ok: false } });
    assert.equal(r.allow, true);
  });

  test("unknown environment is refused", () => {
    const r = decide({ ...base, environment: "unknown", allowlist: okAllowlist() });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_UNKNOWN_ENVIRONMENT);
  });

  test("unknown environment is refused even with a matching target", () => {
    const r = decide({ ...base, environment: "unknown", allowlist: okAllowlist([PROD_FP]) });
    assert.equal(r.allow, false);
  });

  test("an invalid allowlist is refused", () => {
    const r = decide({ ...base, allowlist: { ok: false, reason: "allowlist_unreadable_or_malformed" } });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_ALLOWLIST_INVALID);
    assert.match(r.detail, /allowlist_unreadable_or_malformed/);
  });

  test("a missing allowlist object is refused", () => {
    assert.equal(decide({ ...base, allowlist: undefined }).code, CODES.REFUSED_ALLOWLIST_INVALID);
  });

  test("no DATABASE_URL is a skip, not a refusal", () => {
    const r = decide({ ...base, target: null, targetProblem: "missing", allowlist: okAllowlist() });
    assert.equal(r.allow, true);
    assert.equal(r.code, CODES.SKIP_NO_DATABASE_URL);
  });

  test("a URL without a database name is refused", () => {
    const r = decide({ ...base, target: null, targetProblem: "missing_database", allowlist: okAllowlist() });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_MISSING_DATABASE_NAME);
  });

  test("an unparseable URL is refused everywhere", () => {
    for (const environment of ["production", "preview", "ci", "local", "development"]) {
      const r = decide({ ...base, environment, target: null, targetProblem: "unparseable", allowlist: okAllowlist() });
      assert.equal(r.allow, false, environment);
      assert.equal(r.code, CODES.REFUSED_UNPARSEABLE_URL, environment);
    }
  });

  test("production with an empty allowlist is refused", () => {
    const r = decide({ ...base, allowlist: okAllowlist([]) });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_PRODUCTION_UNENROLLED);
  });

  test("production with a matching fingerprint is allowed", () => {
    const r = decide({ ...base, allowlist: okAllowlist([PROD_FP]) });
    assert.equal(r.allow, true);
    assert.equal(r.code, CODES.OK_ENROLLED_PRODUCTION);
  });

  test("production with a non-matching fingerprint is refused", () => {
    const r = decide({ ...base, allowlist: okAllowlist([OTHER_FP]) });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_PRODUCTION_UNKNOWN_TARGET);
  });

  test("production is refused when the allowlist has several entries and none match", () => {
    const r = decide({ ...base, allowlist: okAllowlist([OTHER_FP, "1".repeat(64)]) });
    assert.equal(r.allow, false);
  });

  test("preview may migrate a preview database", () => {
    const r = decide({ ...base, environment: "preview", allowlist: okAllowlist([OTHER_FP]) });
    assert.equal(r.allow, true);
    assert.equal(r.code, CODES.OK_PREVIEW);
  });

  test("preview may migrate when nothing is enrolled", () => {
    const r = decide({ ...base, environment: "preview", allowlist: okAllowlist([]) });
    assert.equal(r.allow, true);
  });

  test("preview may not migrate an enrolled production target", () => {
    const r = decide({ ...base, environment: "preview", allowlist: okAllowlist([PROD_FP]) });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_NON_PRODUCTION_TARGETS_PRODUCTION);
  });

  test("every non-production environment refuses an enrolled production target", () => {
    for (const environment of ["preview", "ci", "development", "local"]) {
      const r = decide({ ...base, environment, allowlist: okAllowlist([PROD_FP]) });
      assert.equal(r.allow, false, environment);
      assert.equal(r.code, CODES.REFUSED_NON_PRODUCTION_TARGETS_PRODUCTION, environment);
    }
  });

  test("ci may migrate its own database", () => {
    const r = decide({ ...base, environment: "ci", allowlist: okAllowlist([OTHER_FP]) });
    assert.equal(r.allow, true);
    assert.equal(r.code, CODES.OK_CI);
  });

  test("development may migrate its own database", () => {
    const r = decide({ ...base, environment: "development", allowlist: okAllowlist([]) });
    assert.equal(r.allow, true);
    assert.equal(r.code, CODES.OK_DEVELOPMENT);
  });

  test("local may migrate its own database", () => {
    const r = decide({ ...base, environment: "local", allowlist: okAllowlist([]) });
    assert.equal(r.allow, true);
    assert.equal(r.code, CODES.OK_LOCAL);
  });

  test("production matching is unaffected by informational expectedHosts", () => {
    const r = decide({ ...base, allowlist: { ...okAllowlist([PROD_FP]), expectedHosts: ["elsewhere"] } });
    assert.equal(r.allow, true, "expectedHosts must never widen or narrow the decision");
  });
});

// ---------------------------------------------------------------------------
describe("evaluate", () => {
  const PROD_URL = "postgresql://u:p@ep-autumn-sea-axqkyeaf-pooler.c-4.us-east-2.aws.neon.tech/neondb";

  test("production with the shipped allowlist is refused", () => {
    const r = evaluate({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: PROD_URL });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_PRODUCTION_UNENROLLED);
    assert.equal(r.environment, "production");
    assert.equal(r.mode, "enforce");
  });

  test("the refusal reports the target fingerprint but no URL material", () => {
    const r = evaluate({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: PROD_URL });
    assert.equal(r.fingerprint, PROD_FP);
    const line = describeResult(r);
    assert.equal(line.includes("postgresql://"), false);
    assert.equal(line.includes("neondb"), false);
    assert.equal(line.includes("u:p"), false);
  });

  test("production with an enrolled match is allowed", () => {
    const f = allowlistFixture(enrolled());
    try {
      const r = evaluate(
        { VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: PROD_URL, MIGRATION_GUARD_ALLOWLIST: f.path },
      );
      assert.equal(r.allow, true);
      assert.equal(r.code, CODES.OK_ENROLLED_PRODUCTION);
    } finally {
      f.cleanup();
    }
  });

  test("production with an enrolled non-match is refused", () => {
    const f = allowlistFixture(enrolled([OTHER_FP]));
    try {
      const r = evaluate(
        { VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: PROD_URL, MIGRATION_GUARD_ALLOWLIST: f.path },
      );
      assert.equal(r.allow, false);
      assert.equal(r.code, CODES.REFUSED_PRODUCTION_UNKNOWN_TARGET);
    } finally {
      f.cleanup();
    }
  });

  test("preview with its own database is allowed", () => {
    const r = evaluate({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      DATABASE_URL: "postgresql://u:p@ep-preview-branch.example.neon.tech/jata_preview",
    });
    assert.equal(r.allow, true);
    assert.equal(r.code, CODES.OK_PREVIEW);
  });

  test("unknown Vercel environment is refused", () => {
    const r = evaluate({ VERCEL: "1", DATABASE_URL: PROD_URL });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_UNKNOWN_ENVIRONMENT);
  });

  test("no DATABASE_URL is a skip", () => {
    const r = evaluate({ VERCEL: "1", VERCEL_ENV: "production" });
    assert.equal(r.allow, true);
    assert.equal(r.code, CODES.SKIP_NO_DATABASE_URL);
  });

  test("an invalid mode is refused before the allowlist is read", () => {
    const r = evaluate({
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: PROD_URL,
      MIGRATION_GUARD_MODE: "nonsense",
      MIGRATION_GUARD_ALLOWLIST: "/nonexistent/should-not-be-read.json",
    });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_INVALID_MODE);
  });

  test("an unreadable allowlist is refused", () => {
    const r = evaluate({
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: PROD_URL,
      MIGRATION_GUARD_ALLOWLIST: "/nonexistent/allowlist.json",
    });
    assert.equal(r.allow, false);
    assert.equal(r.code, CODES.REFUSED_ALLOWLIST_INVALID);
  });

  test("a host outside expectedHosts is surfaced in the refusal detail", () => {
    const f = allowlistFixture(
      { mode: "unenrolled", fingerprints: [], enrollmentEvidence: null },
      { expectedHosts: ["expected.host"] },
    );
    try {
      const r = evaluate({
        VERCEL: "1",
        VERCEL_ENV: "production",
        DATABASE_URL: PROD_URL,
        MIGRATION_GUARD_ALLOWLIST: f.path,
      });
      assert.equal(r.allow, false);
      assert.match(r.detail, /expectedHosts/);
    } finally {
      f.cleanup();
    }
  });

  test("the fingerprint is null when the URL cannot be parsed", () => {
    const r = evaluate({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: "nonsense" });
    assert.equal(r.fingerprint, null);
    assert.equal(r.code, CODES.REFUSED_UNPARSEABLE_URL);
  });
});

// ---------------------------------------------------------------------------
describe("describe / toJSON", () => {
  const secret = "sup3rs3cret";
  const url = `postgresql://alice:${secret}@db.example.com/app`;

  test("describe never contains the password, user, host, or scheme", () => {
    const r = evaluate({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: url });
    const line = describeResult(r);
    for (const needle of [secret, "alice", "db.example.com", "postgresql://"]) {
      assert.equal(line.includes(needle), false, needle);
    }
  });

  test("describe includes code, environment, mode and target", () => {
    const r = evaluate({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: url });
    const line = describeResult(r);
    assert.match(line, /\[migration-guard\] REFUSED_PRODUCTION_UNENROLLED/);
    assert.match(line, /env=production/);
    assert.match(line, /mode=enforce/);
    assert.match(line, /target=[0-9a-f]{64}/);
  });

  test("describe shows target=none when there is no target", () => {
    const r = evaluate({ VERCEL: "1", VERCEL_ENV: "production" });
    assert.match(describeResult(r), /target=none/);
  });

  test("toJSON is free of URL material and is serialisable", () => {
    const r = evaluate({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: url });
    const json = toJSON(r);
    assert.equal(JSON.stringify(json).includes(secret), false);
    assert.equal(JSON.stringify(json).includes("db.example.com"), false);
    assert.deepEqual(Object.keys(json).sort(), [
      "allow",
      "code",
      "detail",
      "environment",
      "fingerprint",
      "mode",
    ]);
  });
});

// ---------------------------------------------------------------------------
describe("run (CLI behaviour)", () => {
  function capture(fn) {
    const out = [];
    const err = [];
    const code = fn({ out: (l) => out.push(l), err: (l) => err.push(l) });
    return { code, out: out.join("\n"), err: err.join("\n") };
  }

  const PROD_URL = "postgresql://u:p@ep-autumn-sea-axqkyeaf-pooler.c-4.us-east-2.aws.neon.tech/neondb";

  test("check exits 1 and writes to stderr when refused", () => {
    const r = capture((w) =>
      run(["node", "guard.mjs", "check"], { VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: PROD_URL }, w),
    );
    assert.equal(r.code, 1);
    assert.match(r.err, /REFUSED_PRODUCTION_UNENROLLED/);
    assert.equal(r.out, "");
  });

  test("check exits 0 and writes to stdout when allowed", () => {
    const r = capture((w) =>
      run(
        ["node", "guard.mjs", "check"],
        { VERCEL: "1", VERCEL_ENV: "preview", DATABASE_URL: "postgresql://u:p@h/jata_preview" },
        w,
      ),
    );
    assert.equal(r.code, 0);
    assert.match(r.out, /OK_PREVIEW/);
    assert.equal(r.err, "");
  });

  test("check defaults to the check command", () => {
    const r = capture((w) => run(["node", "guard.mjs"], { VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: PROD_URL }, w));
    assert.equal(r.code, 1);
  });

  test("print-fingerprint prints exactly the digest", () => {
    const r = capture((w) => run(["node", "guard.mjs", "print-fingerprint"], { DATABASE_URL: PROD_URL }, w));
    assert.equal(r.code, 0);
    assert.equal(r.out, PROD_FP);
  });

  test("print-fingerprint exits 2 when it cannot compute", () => {
    const r = capture((w) => run(["node", "guard.mjs", "print-fingerprint"], {}, w));
    assert.equal(r.code, 2);
    assert.match(r.err, /cannot compute fingerprint/);
  });

  test("an unknown command exits 2", () => {
    const r = capture((w) => run(["node", "guard.mjs", "drop-tables"], {}, w));
    assert.equal(r.code, 2);
    assert.match(r.err, /unknown command/);
  });

  test("MIGRATION_GUARD_MODE=off warns loudly but allows", () => {
    const r = capture((w) =>
      run(
        ["node", "guard.mjs", "check"],
        { VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: PROD_URL, MIGRATION_GUARD_MODE: "off" },
        w,
      ),
    );
    assert.equal(r.code, 0);
    assert.match(r.out, /WARNING/);
  });

  test("the CLI never prints the password", () => {
    const r = capture((w) =>
      run(["node", "guard.mjs", "check"], { VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: PROD_URL }, w),
    );
    assert.equal(`${r.out}${r.err}`.includes("u:p"), false);
  });
});

// ---------------------------------------------------------------------------
describe("module safety properties", () => {
  const source = readFileSync(GUARD_SOURCE, "utf8");

  test("the guard imports no network or process-execution modules", () => {
    for (const forbidden of ["node:http", "node:https", "node:net", "node:dgram", "child_process"]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });

  test("the guard does not call fetch", () => {
    assert.equal(/\bfetch\s*\(/.test(source), false);
  });

  test("the guard does not spawn or exec", () => {
    assert.equal(/\b(spawn|execFile|execSync)Sync?\s*\(/.test(source), false);
  });

  test("the guard does not use eval", () => {
    assert.equal(/\beval\s*\(/.test(source), false);
  });

  test("importing the module does not execute the CLI", () => {
    // If it did, this file would have exited during import.
    assert.equal(typeof run, "function");
  });
});
