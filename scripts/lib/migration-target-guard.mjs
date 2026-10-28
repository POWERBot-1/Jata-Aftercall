#!/usr/bin/env node
/**
 * JATA AFTERCALL — migration target guard
 *
 * A fail-closed gate that decides whether the current process may run
 * `prisma migrate deploy` against the database named by `DATABASE_URL`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `scripts/build.sh` runs `scripts/migrate.sh` whenever `DATABASE_URL` is set,
 * and `scripts/migrate.sh` runs `prisma migrate deploy`. On Vercel, Production
 * and Preview both define `DATABASE_URL`, so a build is a migration unless
 * something stops it. A misconfigured or leaked variable — a Preview branch
 * URL promoted into Production, or a Production URL copied into a Preview
 * environment — would migrate the wrong database with the committed schema.
 * Nothing in the previous pipeline noticed.
 *
 * This guard is that "something". It runs immediately before Prisma and, when
 * it refuses, `migrate.sh` exits non-zero so the build stops before `npx` is
 * ever reached.
 *
 * THE DECISION
 * ------------
 * - `production`  the target must match an *enrolled* fingerprint. An empty
 *                 allowlist refuses every Production migration.
 * - `preview`, `development`, `local`, `ci`
 *                 allowed to migrate their own database, but refused if the
 *                 target is an enrolled Production database. Preview
 *                 migrating Preview is how the Preview database is provisioned
 *                 today and must keep working.
 * - `unknown`     `VERCEL` is set but `VERCEL_ENV` is missing or unrecognised.
 *                 An undeterminable environment is a refusal, never a pass.
 *
 * A missing `DATABASE_URL` is not this guard's concern: `migrate.sh` skips
 * before calling it and no migration happens.
 *
 * WHAT A FINGERPRINT IS, AND IS NOT
 * ---------------------------------
 * `sha256(normalized_host + "|" + database_name)` of the parsed URL. It
 * identifies *what a URL names*. It does NOT prove who owns that database, and
 * it cannot establish that the URL is the one the Production runtime actually
 * uses. Enrolment is therefore a reviewed identity claim backed by evidence
 * gathered outside this repository — see docs/MIGRATION_TARGET_GUARD.md.
 *
 * SAFETY PROPERTIES
 * -----------------
 * - No network I/O and no child processes. The module reads one local JSON file
 *   and hashes a string.
 * - No secret is ever emitted. The URL is parsed and discarded; only a
 *   one-way digest of host and database is printed, never a password, user,
 *   port, query string, or the URL itself.
 * - Any unexpected exception becomes a refusal, never an allowance.
 *
 * USAGE
 *   node scripts/lib/migration-target-guard.mjs check              # exit 0 allow / 1 refuse
 *   node scripts/lib/migration-target-guard.mjs print-fingerprint  # exit 0 + digest / 2 cannot compute
 */

import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Environments the guard can distinguish. */
export const ENVIRONMENTS = Object.freeze([
  "production",
  "preview",
  "development",
  "ci",
  "local",
  "unknown",
]);

/** `MIGRATION_GUARD_MODE` accepts exactly these two strings. */
export const MODES = Object.freeze(["enforce", "off"]);

export const CODES = Object.freeze({
  OK_ENROLLED_PRODUCTION: "OK_ENROLLED_PRODUCTION",
  OK_PREVIEW: "OK_PREVIEW",
  OK_DEVELOPMENT: "OK_DEVELOPMENT",
  OK_CI: "OK_CI",
  OK_LOCAL: "OK_LOCAL",
  OK_OFF: "OK_OFF",
  SKIP_NO_DATABASE_URL: "SKIP_NO_DATABASE_URL",
  REFUSED_UNKNOWN_ENVIRONMENT: "REFUSED_UNKNOWN_ENVIRONMENT",
  REFUSED_PRODUCTION_UNENROLLED: "REFUSED_PRODUCTION_UNENROLLED",
  REFUSED_PRODUCTION_UNKNOWN_TARGET: "REFUSED_PRODUCTION_UNKNOWN_TARGET",
  REFUSED_UNPARSEABLE_URL: "REFUSED_UNPARSEABLE_URL",
  REFUSED_MISSING_DATABASE_NAME: "REFUSED_MISSING_DATABASE_NAME",
  REFUSED_NON_PRODUCTION_TARGETS_PRODUCTION: "REFUSED_NON_PRODUCTION_TARGETS_PRODUCTION",
  REFUSED_ALLOWLIST_INVALID: "REFUSED_ALLOWLIST_INVALID",
  REFUSED_INVALID_MODE: "REFUSED_INVALID_MODE",
  REFUSED_INTERNAL_ERROR: "REFUSED_INTERNAL_ERROR",
});

const ALLOWLIST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "migration-target-allowlist.json",
);

/** Lowercase and strip trailing dots. DNS is case-insensitive; nothing else changes. */
export function normalizeHost(host) {
  return String(host).trim().toLowerCase().replace(/\.+$/, "");
}

/**
 * Parse a PostgreSQL URL into the two identifiers that define the target.
 * Returns `{ ok: true, host, database }` or `{ ok: false, reason }` with reason
 * one of "missing" | "unparseable" | "missing_database".
 *
 * The database name is percent-decoded but otherwise preserved: PostgreSQL
 * database names are case-sensitive, so lower-casing could collapse two
 * genuinely different targets into one identity.
 */
export function parseTarget(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    return { ok: false, reason: "missing" };
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "unparseable" };
  }

  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    return { ok: false, reason: "unparseable" };
  }

  const host = normalizeHost(url.hostname);
  if (!host) return { ok: false, reason: "missing_database" };

  let database;
  try {
    // decodeURIComponent throws URIError on malformed escapes such as "%ZZ";
    // that must be a refusal, not an uncaught crash.
    database = decodeURIComponent(url.pathname.replace(/^\//, "").replace(/\/+$/, ""));
  } catch {
    return { ok: false, reason: "unparseable" };
  }

  if (!database) return { ok: false, reason: "missing_database" };

  return { ok: true, host, database };
}

/** Stable one-way identifier. Never reversible into a credential. */
export function fingerprintOf(host, database) {
  return createHash("sha256")
    .update(`${normalizeHost(host)}|${database}`, "utf8")
    .digest("hex");
}

function isTruthyEnv(value) {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false";
}

/**
 * Classify the environment.
 *
 * Vercel sets `VERCEL=1` on every build. If we are on Vercel but `VERCEL_ENV`
 * is not one of the three documented values, the environment is `unknown`:
 * an undeterminable environment must never be treated as permissive.
 */
export function resolveEnvironment(env = process.env) {
  const onVercel = isTruthyEnv(env.VERCEL);
  const declared = String(env.VERCEL_ENV ?? "").trim().toLowerCase();

  if (declared === "production") return "production";
  if (declared === "preview") return "preview";
  if (declared === "development") return "development";

  if (onVercel) return "unknown";

  // Not Vercel: a CI runner or a developer machine. Neither may touch an
  // enrolled Production target, but both may migrate their own database.
  if (isTruthyEnv(env.CI)) return "ci";
  return "local";
}

/**
 * Resolve `MIGRATION_GUARD_MODE`.
 * Absent means `enforce`. Anything other than the two documented strings —
 * including a blank value or a typo — returns null, which callers treat as a
 * refusal. A typo must never silently disable the guard.
 */
export function resolveMode(env = process.env) {
  const raw = env.MIGRATION_GUARD_MODE;
  if (raw === undefined) return "enforce";
  const value = String(raw).trim();
  return MODES.includes(value) ? value : null;
}

const HOSTNAME_RE = /^[a-z0-9._-]+$/i;
const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

/**
 * Load and validate the allowlist.
 *
 * Declared mode and fingerprint list must agree. `unenrolled` with entries, or
 * `enrolled` with none, is ambiguous; an ambiguous policy is rejected rather
 * than silently reinterpreted.
 */
export function loadAllowlist(path = ALLOWLIST_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { ok: false, reason: "allowlist_unreadable_or_malformed" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "allowlist_not_an_object" };
  }

  const production = parsed.production;
  if (!production || typeof production !== "object" || Array.isArray(production)) {
    return { ok: false, reason: "allowlist_missing_production_section" };
  }

  const mode = production.mode;
  if (mode !== "enrolled" && mode !== "unenrolled") {
    return { ok: false, reason: "allowlist_invalid_production_mode" };
  }

  if (!Array.isArray(production.fingerprints)) {
    return { ok: false, reason: "allowlist_fingerprints_not_an_array" };
  }

  const fingerprints = production.fingerprints;
  for (const fp of fingerprints) {
    if (typeof fp !== "string" || !FINGERPRINT_RE.test(fp)) {
      return { ok: false, reason: "allowlist_invalid_fingerprint_entry" };
    }
  }
  if (new Set(fingerprints).size !== fingerprints.length) {
    return { ok: false, reason: "allowlist_duplicate_fingerprint" };
  }

  if (mode === "unenrolled" && fingerprints.length !== 0) {
    return { ok: false, reason: "allowlist_unenrolled_but_fingerprints_present" };
  }
  if (mode === "enrolled" && fingerprints.length === 0) {
    return { ok: false, reason: "allowlist_enrolled_but_no_fingerprints" };
  }

  const evidence = production.enrollmentEvidence;
  if (mode === "enrolled" && (typeof evidence !== "string" || evidence.trim() === "")) {
    return { ok: false, reason: "allowlist_enrolled_without_enrollment_evidence" };
  }
  if (evidence !== null && evidence !== undefined && typeof evidence !== "string") {
    return { ok: false, reason: "allowlist_invalid_enrollment_evidence" };
  }

  // Optional. Informational only: it can never widen the decision, and a host
  // outside this list is surfaced in the refusal detail so a reviewer notices
  // a target that moved.
  const expectedHosts = Array.isArray(parsed.expectedHosts)
    ? parsed.expectedHosts
        .filter((h) => typeof h === "string" && HOSTNAME_RE.test(h))
        .map(normalizeHost)
    : [];

  return {
    ok: true,
    production: {
      mode,
      fingerprints: fingerprints.slice(),
      enrollmentEvidence: evidence ?? null,
    },
    expectedHosts,
  };
}

/**
 * Pure decision function. No I/O, no logging, no secrets.
 * Returns `{ allow, code, detail? }`.
 */
export function decide({ environment, mode, target, targetProblem, allowlist }) {
  if (mode === "off") {
    return { allow: true, code: CODES.OK_OFF, detail: "MIGRATION_GUARD_MODE=off" };
  }

  // An environment we cannot determine is never permission.
  if (environment === "unknown") {
    return {
      allow: false,
      code: CODES.REFUSED_UNKNOWN_ENVIRONMENT,
      detail: "VERCEL is set but VERCEL_ENV is missing or unrecognised",
    };
  }

  if (!allowlist || !allowlist.ok) {
    return {
      allow: false,
      code: CODES.REFUSED_ALLOWLIST_INVALID,
      detail: allowlist?.reason ?? "allowlist unavailable",
    };
  }

  // Present-but-unusable URLs are refused everywhere: the guard cannot show
  // that an unnamed target is not Production.
  if (!target) {
    if (targetProblem === "missing") {
      return { allow: true, code: CODES.SKIP_NO_DATABASE_URL, detail: "no DATABASE_URL" };
    }
    if (targetProblem === "missing_database") {
      return {
        allow: false,
        code: CODES.REFUSED_MISSING_DATABASE_NAME,
        detail: "DATABASE_URL has no database name",
      };
    }
    return {
      allow: false,
      code: CODES.REFUSED_UNPARSEABLE_URL,
      detail: "DATABASE_URL could not be parsed as a PostgreSQL URL",
    };
  }

  const enrolled = allowlist.production.fingerprints;
  const targetsProduction = enrolled.includes(target.fingerprint);

  if (environment === "production") {
    if (enrolled.length === 0) {
      return {
        allow: false,
        code: CODES.REFUSED_PRODUCTION_UNENROLLED,
        detail: "no production fingerprint is enrolled",
      };
    }
    if (targetsProduction) {
      return { allow: true, code: CODES.OK_ENROLLED_PRODUCTION };
    }
    return {
      allow: false,
      code: CODES.REFUSED_PRODUCTION_UNKNOWN_TARGET,
      detail: "target does not match an enrolled production fingerprint",
    };
  }

  // Every non-production environment: never reach an enrolled Production DB.
  if (targetsProduction) {
    return {
      allow: false,
      code: CODES.REFUSED_NON_PRODUCTION_TARGETS_PRODUCTION,
      detail: `${environment} may not migrate an enrolled production target`,
    };
  }

  if (environment === "preview") return { allow: true, code: CODES.OK_PREVIEW };
  if (environment === "ci") return { allow: true, code: CODES.OK_CI };
  if (environment === "development") return { allow: true, code: CODES.OK_DEVELOPMENT };
  return { allow: true, code: CODES.OK_LOCAL };
}

/** Resolve environment + policy + target from an environment bag. */
export function evaluate(env = process.env, options = {}) {
  const environment = resolveEnvironment(env);
  const mode = resolveMode(env);

  if (mode === null) {
    return {
      allow: false,
      code: CODES.REFUSED_INVALID_MODE,
      environment,
      mode: String(env.MIGRATION_GUARD_MODE),
      fingerprint: null,
      detail: "MIGRATION_GUARD_MODE must be enforce or off",
    };
  }

  // MIGRATION_GUARD_ALLOWLIST lets tests and operators point at an alternative
  // reviewed policy file. It cannot make the shipped default more permissive.
  const allowlistPath =
    options.allowlistPath ?? env.MIGRATION_GUARD_ALLOWLIST ?? ALLOWLIST_PATH;
  const allowlist = loadAllowlist(allowlistPath);

  const parsed = parseTarget(env.DATABASE_URL);
  const target = parsed.ok ? { fingerprint: fingerprintOf(parsed.host, parsed.database) } : null;

  const decision = decide({
    environment,
    mode,
    target,
    targetProblem: parsed.ok ? undefined : parsed.reason,
    allowlist,
  });

  // expectedHosts never widens or narrows the decision; it is a review aid. The
  // note is appended rather than replacing the decision's own detail so that a
  // refusal still reports why it refused while a reviewer also sees that the
  // target moved to a host nobody recorded.
  let detail = decision.detail;
  if (parsed.ok && allowlist.ok && allowlist.expectedHosts.length > 0) {
    const host = normalizeHost(parsed.host);
    if (!allowlist.expectedHosts.includes(host)) {
      const note = "target host is not among the allowlist expectedHosts";
      detail = detail ? `${detail}; ${note}` : note;
    }
  }

  return {
    ...decision,
    detail,
    environment,
    mode,
    fingerprint: target?.fingerprint ?? null,
  };
}

/**
 * One-line, greppable description. Contains no URL material.
 * The fingerprint is printed because it is the exact value an operator must
 * capture to enrol a target; it is a one-way hash of host and database.
 */
export function describe(result) {
  const parts = [
    `[migration-guard] ${result.code}`,
    `env=${result.environment}`,
    `mode=${result.mode}`,
    `target=${result.fingerprint ?? "none"}`,
  ];
  if (result.detail) parts.push(`(${result.detail})`);
  return parts.join(" ");
}

/** Machine-readable form, also free of URL material. */
export function toJSON(result) {
  return {
    code: result.code,
    allow: result.allow,
    environment: result.environment,
    mode: result.mode,
    fingerprint: result.fingerprint,
    detail: result.detail ?? null,
  };
}

export function run(argv = process.argv, env = process.env, write) {
  const io = write ?? defaultWrite();
  const command = argv[2] ?? "check";

  if (command === "print-fingerprint") {
    const parsed = parseTarget(env.DATABASE_URL);
    if (!parsed.ok) {
      io.err(`[migration-guard] cannot compute fingerprint (${parsed.reason})`);
      return 2;
    }
    io.out(fingerprintOf(parsed.host, parsed.database));
    return 0;
  }

  if (command !== "check") {
    io.err(`[migration-guard] unknown command: ${command}`);
    return 2;
  }

  let result;
  try {
    result = evaluate(env);
  } catch {
    // An unexpected failure must never become an accidental allowance.
    result = {
      allow: false,
      code: CODES.REFUSED_INTERNAL_ERROR,
      environment: "unknown",
      mode: "enforce",
      fingerprint: null,
      detail: "unexpected error while evaluating the migration target",
    };
  }

  const stream = result.allow ? io.out : io.err;
  stream(describe(result));

  if (result.code === CODES.OK_OFF) {
    stream("[migration-guard] WARNING: MIGRATION_GUARD_MODE=off — every target check is disabled.");
  }

  return result.allow ? 0 : 1;
}

function defaultWrite() {
  return {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  };
}

/** True only when this file is the entry point, not when imported by tests. */
function isEntryPoint() {
  if (typeof process.argv[1] !== "string") return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exit(run(process.argv, process.env, defaultWrite()));
}
