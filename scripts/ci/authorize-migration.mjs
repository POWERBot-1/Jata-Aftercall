#!/usr/bin/env node
/**
 * JATA AFTERCALL — production migration authorization (PROPOSAL ARTIFACT)
 *
 * STATUS: NOT WIRED INTO THE BUILD.
 *
 * `scripts/build.sh` does not call this file, and no Vercel setting references
 * it. It exists so the design in `docs/RELEASE-GATE-PROPOSAL.md` can ship with
 * tests rather than as prose. Adopting it requires a reviewed change to
 * `scripts/build.sh` plus a Vercel environment change — neither of which is
 * part of this branch.
 *
 * WHAT IT WOULD DO
 * ----------------
 * Today a production build migrates whenever `DATABASE_URL` is set. The
 * proposal makes that explicit and attributable: a migration runs only when an
 * authorization token names the exact commit being built, so an ordinary build
 * of an unrelated commit cannot migrate production.
 *
 * DECISION (pure, testable, no I/O)
 *   allow only when:
 *     - environment is "production", and
 *     - authorization is exactly `sha:<40 hex chars>`, and
 *     - the authorized SHA equals the commit actually being built.
 *   Everything else refuses. Missing, malformed, or mismatched input is a
 *   refusal, never an allowance — the same fail-closed posture as the existing
 *   migration target guard.
 *
 * USAGE (once adopted)
 *   node scripts/ci/authorize-migration.mjs --sha "$VERCEL_GIT_COMMIT_SHA"
 *   exit 0 = authorized, 1 = refused, 2 = blocked (no authorization supplied)
 */

/** Parse `sha:<40 hex>` into a lowercase SHA, or return null. */
export function parseAuthorization(token) {
  if (typeof token !== "string") return null;
  const match = token.trim().match(/^sha:([0-9a-fA-F]{40})$/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Decide whether a production migration is authorized.
 * Returns { allowed: boolean, code: string, reason: string }.
 */
export function evaluateMigrationAuthorization({ environment, authorization, buildSha }) {
  if (environment !== "production") {
    return { allowed: false, code: "REFUSED_NOT_PRODUCTION", reason: `environment is ${environment ?? "(unset)"}, this gate governs production only` };
  }
  if (authorization === undefined || authorization === null || authorization === "") {
    return { allowed: false, code: "REFUSED_NO_AUTHORIZATION", reason: "no authorization token supplied; an ordinary build must not migrate production" };
  }
  const authorizedSha = parseAuthorization(authorization);
  if (!authorizedSha) {
    return { allowed: false, code: "REFUSED_MALFORMED_AUTHORIZATION", reason: "authorization must be exactly sha:<40 hex characters>" };
  }
  if (typeof buildSha !== "string" || !/^[0-9a-fA-F]{40}$/.test(buildSha)) {
    return { allowed: false, code: "REFUSED_UNKNOWN_BUILD_SHA", reason: "the commit being built is unknown, so no authorization can match it" };
  }
  if (authorizedSha !== buildSha.toLowerCase()) {
    return { allowed: false, code: "REFUSED_SHA_MISMATCH", reason: `authorization names ${authorizedSha.slice(0, 12)}… but the build is ${buildSha.slice(0, 12)}…` };
  }
  return { allowed: true, code: "ALLOWED", reason: `authorized migration of ${buildSha.slice(0, 12)}…` };
}

function main(argv) {
  const args = argv.slice(2);
  const shaIndex = args.indexOf("--sha");
  const buildSha = shaIndex === -1 ? process.env.VERCEL_GIT_COMMIT_SHA : args[shaIndex + 1];
  const environment =
    process.env.VERCEL_ENV ?? (process.env.NODE_ENV === "production" ? "production" : undefined);
  const decision = evaluateMigrationAuthorization({
    environment,
    authorization: process.env.MIGRATION_AUTHORIZATION,
    buildSha,
  });
  console.log(`[authorize] ${decision.code}: ${decision.reason}`);
  if (decision.allowed) return 0;
  return decision.code === "REFUSED_NO_AUTHORIZATION" ? 2 : 1;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
