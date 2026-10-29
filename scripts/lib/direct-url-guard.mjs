#!/usr/bin/env node
/**
 * JATA AFTERCALL — migration connection guard (`directUrl` preflight, blocker E8)
 *
 * WHY THIS EXISTS
 * ---------------
 * Neon's pooled endpoint is PgBouncer in **transaction mode**, which does not reliably hold the
 * session-level advisory lock Prisma Migrate takes before applying a migration. Running
 * `prisma migrate deploy` against it fails with **P1002** (timeout acquiring pg_advisory_lock) or
 * leaves a migration half-applied and every later deploy failing with **P3009**.
 *
 * `scripts/build.sh` runs `scripts/migrate.sh` whenever `DATABASE_URL` is set, and `DEPLOYMENT.md`
 * tells the operator to paste Neon's *pooled* connection string there — so the documented deployment
 * path used to walk straight into that trap, and CI could never catch it because every CI job points
 * at a plain PostgreSQL service container with no pooler in front of it.
 *
 * The fix has two halves:
 *   1. `prisma/schema.prisma` declares `directUrl = env("DIRECT_URL")`, so Migrate uses the direct
 *      connection while the runtime client keeps using the pooled `url`.
 *   2. This guard decides, before Prisma is invoked, whether the pair of URLs can migrate safely.
 *
 * WHY IT FALLS BACK TO `DATABASE_URL`
 * -----------------------------------
 * A `directUrl = env("DIRECT_URL")` reference that is unset makes Prisma fail schema validation with
 * **P1012** in *every* environment that runs `generate` or `migrate` — including this repository's
 * CI and every developer machine, which have no pooler and no second URL. `scripts/lib/prisma-env.sh`
 * therefore exports `DIRECT_URL` as `DATABASE_URL` when it is not set, which keeps those environments
 * working unchanged. That fallback is safe precisely because this guard refuses the one case where it
 * would be wrong: a pooled `DATABASE_URL` with no genuinely direct `DIRECT_URL`.
 *
 * A URL that is *set* is not the same as a URL that is *right*, so both failure shapes are refused:
 *   - DIRECT_URL missing and DATABASE_URL pooled
 *   - DIRECT_URL present but still pointing at a pooled host (the "it's configured, so it must be
 *     fine" trap)
 *
 * NOTHING HERE PRINTS A URL. Only hosts that are already public (the API hostname) and error codes are
 * ever written to stdout, so a credential cannot leak through a build log.
 */
import { URL } from "node:url";

export const CODES = {
  OK: "OK_DIRECT_URL_READY",
  OK_NO_DATABASE_URL: "OK_NO_DATABASE_URL",
  REFUSED_MISSING_DIRECT_URL: "REFUSED_POOLED_WITHOUT_DIRECT_URL",
  REFUSED_DIRECT_IS_POOLED: "REFUSED_DIRECT_URL_IS_POOLED",
  REFUSED_UNPARSEABLE: "REFUSED_UNPARSEABLE_URL",
  REFUSED_NO_DATABASE_NAME: "REFUSED_MISSING_DATABASE_NAME",
};

/** Neon pooled endpoints carry `-pooler` in the hostname; that is the only marker relied on here. */
export function isPooledHost(rawUrl) {
  const parsed = safeParse(rawUrl);
  if (!parsed) return false;
  return /(^|[.-])pooler([.-]|$)/i.test(parsed.hostname);
}

function safeParse(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function databaseName(parsed) {
  const path = (parsed.pathname || "").replace(/^\//, "");
  return path.length > 0 ? path : "";
}

/**
 * Decide whether this pair of URLs may run `prisma migrate deploy`.
 *
 * @param {{DATABASE_URL?: string, DIRECT_URL?: string, JATA_DIRECT_URL_DEFAULTED?: string}} env
 * @returns {{allow: boolean, code: string, detail: string}}
 */
export function checkDirectUrl(env) {
  const databaseUrl = env.DATABASE_URL ?? "";
  const directUrl = env.DIRECT_URL ?? "";
  // `scripts/lib/prisma-env.sh` sets this when it filled DIRECT_URL in from DATABASE_URL. Without the
  // marker, "unset" and "deliberately set to the pooled host" would produce the same REFUSED code,
  // and the two have different fixes: add the variable, or correct it.
  const directWasDefaulted = env.JATA_DIRECT_URL_DEFAULTED === "1";

  if (!databaseUrl) {
    // Preview/offline builds skip migrations entirely; there is nothing to protect.
    return { allow: true, code: CODES.OK_NO_DATABASE_URL, detail: "no DATABASE_URL, migrations are skipped" };
  }

  const parsedDatabase = safeParse(databaseUrl);
  if (!parsedDatabase) {
    return { allow: false, code: CODES.REFUSED_UNPARSEABLE, detail: "DATABASE_URL could not be parsed as a PostgreSQL URL" };
  }
  if (!databaseName(parsedDatabase)) {
    return { allow: false, code: CODES.REFUSED_NO_DATABASE_NAME, detail: "DATABASE_URL has no database name" };
  }

  const databasePooled = isPooledHost(databaseUrl);

  if (!directUrl) {
    if (databasePooled) {
      return {
        allow: false,
        code: CODES.REFUSED_MISSING_DIRECT_URL,
        detail:
          "DATABASE_URL points at a pooled endpoint but DIRECT_URL is not set. Prisma Migrate needs the " +
          "unpooled connection string (Neon: the same host without `-pooler`), otherwise the build fails " +
          "with P1002 or leaves the database needing `prisma migrate resolve` (P3009).",
      };
    }
    return { allow: true, code: CODES.OK_NO_DATABASE_URL, detail: "single non-pooled URL, migrations use it directly" };
  }

  const parsedDirect = safeParse(directUrl);
  if (!parsedDirect) {
    return { allow: false, code: CODES.REFUSED_UNPARSEABLE, detail: "DIRECT_URL could not be parsed as a PostgreSQL URL" };
  }
  if (!databaseName(parsedDirect)) {
    return { allow: false, code: CODES.REFUSED_NO_DATABASE_NAME, detail: "DIRECT_URL has no database name" };
  }
  if (isPooledHost(directUrl)) {
    if (directWasDefaulted) {
      return {
        allow: false,
        code: CODES.REFUSED_MISSING_DIRECT_URL,
        detail:
          "DATABASE_URL points at a pooled endpoint and DIRECT_URL was not set, so it defaulted to the same " +
          "pooled URL. Set DIRECT_URL to the unpooled connection string (Neon: the same host without " +
          "`-pooler`), otherwise the build fails with P1002 or leaves the database needing `prisma migrate resolve`.",
      };
    }
    return {
      allow: false,
      code: CODES.REFUSED_DIRECT_IS_POOLED,
      detail:
        "DIRECT_URL points at a pooled endpoint. It must be the unpooled connection string (Neon: the same " +
        "host with `-pooler` removed), or Migrate takes its advisory lock through PgBouncer and fails with P1002.",
    };
  }

  return {
    allow: true,
    code: CODES.OK,
    detail: databasePooled
      ? "runtime uses the pooled URL; migrations use the direct URL"
      : "single non-pooled URL, migrations use it directly",
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────
// `node scripts/lib/direct-url-guard.mjs check`  → exit 0 allow, exit 1 refuse.
// Run this from the repository root; it reads process.env only.
function main() {
  const command = process.argv[2] ?? "check";
  if (command !== "check") {
    console.error(`[direct-url] unknown command: ${command} (expected "check")`);
    process.exit(2);
  }

  const verdict = checkDirectUrl(process.env);
  if (verdict.allow) {
    console.log(`[direct-url] OK (${verdict.code}) — ${verdict.detail}`);
    process.exit(0);
  }

  console.error(`[direct-url] REFUSED (${verdict.code})`);
  console.error(`[direct-url] ${verdict.detail}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
