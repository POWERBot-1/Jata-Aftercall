#!/usr/bin/env node
/**
 * Retry a Prisma CLI invocation that failed only because the engine download failed.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * `prisma validate`/`generate`/`format` on Prisma 5.22.0 load the schema through the WASM schema
 * engine, but the CLI *also* uses the native query-engine library to read the datamodel. On a cache
 * miss it fetches that library from `binaries.prisma.sh` before it can validate anything — so an
 * unreachable or flaky mirror makes a perfectly valid schema fail with a network error, not a P1012.
 *
 * That is a false failure: the schema is not in question. It happened on this repository's own
 * history — `db76269` passed "Validate Prisma schema and generate the client" and `6858f27` failed
 * the identical step while changing only a markdown file.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * - It does NOT bypass schema validation. The command is re-run *unchanged*.
 * - It does NOT treat a schema error as retryable. P1012, syntax errors and every other Prisma
 *   diagnostic fail immediately on the first attempt, because they are deterministic.
 * - It does NOT swallow the final failure. After the last attempt the original exit code and output
 *   are preserved, so a genuinely broken schema still blocks the build with the real message.
 *
 * Usage: node scripts/ci/retry-prisma-engine.mjs -- <command> [args...]
 *        PRISMA_RETRY_ATTEMPTS (default 5), PRISMA_RETRY_DELAY_MS (default 4000, doubled each retry)
 */
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const command = separator === -1 ? argv : argv.slice(separator + 1);
if (command.length === 0) {
  console.error("usage: retry-prisma-engine.mjs -- <command> [args...]");
  process.exit(64);
}

const attempts = Number(process.env.PRISMA_RETRY_ATTEMPTS || 5);
let delay = Number(process.env.PRISMA_RETRY_DELAY_MS || 4000);

/**
 * Engine-download failures are the only retryable class. Each pattern below is a transport problem
 * reaching the binary mirror — never a statement about the schema.
 */
const RETRYABLE = [
  /binaries\.prisma\.sh/i,
  /request to .* failed, reason:/i,
  /Client network socket disconnected/i,
  /socket hang up/i,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /EAI_AGAIN/,
  /ENOTFOUND/,
  /getaddrinfo/i,
  /timed out/i,
  /502 Bad Gateway|503 Service Unavailable|504 Gateway/i,
  /failed to fetch the engine file/i,
  /Error: request to https:\/\/[^\s]*\.gz(\.sha256)? failed/i,
];

/** A schema complaint must never be retried: retrying it only hides the real error behind delays. */
const FATAL = [/P1012/, /P1001/, /P1003/, /P3009/, /error: Error validating/i, /error: Error parsing/i, /The schema at .* could not be parsed/i];

function classify(stdout, stderr) {
  const blob = `${stdout}\n${stderr}`;
  if (FATAL.some((rx) => rx.test(blob))) return "fatal";
  if (RETRYABLE.some((rx) => rx.test(blob))) return "retryable";
  return "unknown";
}

/** Only print the diagnosis lines: the failing URL and reason, not hundreds of lines of stack. */
function enginesOnly(text) {
  return text
    .split("\n")
    .filter((line) => /binaries\.prisma\.sh|reason:|socket|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|failed to fetch/i.test(line))
    .slice(0, 3)
    .join(" ")
    .replace(/https:\/\/\S+/, "<engine-url>")
    .trim()
    .slice(0, 220);
}

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const result = spawnSync(command[0], command.slice(1), { encoding: "utf8", env: process.env });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  process.stdout.write(stdout);
  process.stderr.write(stderr);

  if (result.status === 0) {
    if (attempt > 1) console.log(`PASS: ${command.join(" ")} succeeded on attempt ${attempt}/${attempts} (engine download recovered).`);
    process.exit(0);
  }

  const verdict = classify(stdout, stderr);
  if (verdict === "fatal") {
    console.error(`FAIL: ${command.join(" ")} reported a schema error — not retrying, this is not a transport fault.`);
    process.exit(result.status ?? 1);
  }

  if (attempt === attempts) {
    // Exhausted. Say precisely what happened and keep the original exit code so the gate still fails.
    if (verdict === "retryable") {
      console.error(`::error::BLOCKED: the Prisma engine download failed on all ${attempts} attempts (${enginesOnly(stderr) || "transport error"}). This is an infrastructure limitation, not a schema defect.`);
    } else {
      console.error(`::error::${command.join(" ")} failed with an unrecognised error after ${attempts} attempts.`);
    }
    process.exit(result.status ?? 1);
  }

  if (verdict === "retryable") {
    console.error(`RETRY: engine download failed on attempt ${attempt}/${attempts} (${enginesOnly(stderr) || "transport error"}); waiting ${delay}ms.`);
  } else {
    console.error(`RETRY: ${command.join(" ")} failed on attempt ${attempt}/${attempts} with an unrecognised error; waiting ${delay}ms.`);
  }
  spawnSync("sleep", [(delay / 1000).toFixed(3)]);
  delay *= 2;
}
