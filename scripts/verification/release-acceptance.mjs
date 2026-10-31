#!/usr/bin/env node
/**
 * PR #76 release acceptance — deliberately fail closed until genuine acceptance exists.
 * This local runner never connects to a database, storage, SMTP or production: it executes
 * offline checks with a restricted child environment, then reports the unverified gates.
 * Real-service and browser evidence must not be supplied by environment flags or exit codes.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform, arch, version } from "node:process";

const safeEnv = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "WINDIR"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]),
);
safeEnv.CI = "1";
safeEnv.NEXT_TELEMETRY_DISABLED = "1";
safeEnv.NO_COLOR = "1";

// Next.js can load .env files itself even when the child environment is scrubbed.
// Refuse entirely rather than risk reading real credentials or touching production.
for (const file of [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local", ".env.test", ".env.test.local"]) {
  if (existsSync(file)) {
    console.error(`BLOCKED: ${file} exists; run this command in an isolated checkout without environment files.`);
    process.exit(1);
  }
}

const results = [];
function check(name, args, scope) {
  const started = Date.now();
  const command = `npm ${args.join(" ")}`;
  const proc = spawnSync("npm", args, {
    cwd: process.cwd(), env: safeEnv, encoding: "utf8", timeout: 480_000, maxBuffer: 48 * 1024 * 1024,
  });
  const output = `${proc.stdout ?? ""}\n${proc.stderr ?? ""}`;
  const skipped = /\b(?:[1-9]\d*\s+skipped|skipped\s*\([1-9]\d*)/i.test(output);
  const result = {
    criterion: name, status: proc.status === 0 ? "PASS — LIMITED" : "FAIL", environment: `offline ${platform}/${arch} Node ${version}`,
    command, exitCode: proc.status, signal: proc.signal, durationMs: Date.now() - started,
    evidence: scope + (skipped ? "; output reports skipped tests" : "") + (proc.error ? `; process error: ${proc.error.message}` : ""),
  };
  if (proc.status !== 0) {
    // Logs are not exported: this tail is for local diagnosis, never treated as proof of coverage.
    result.failureTail = output.slice(-4000);
  }
  results.push(result);
}

check("Lint", ["run", "lint"], "Local lint only; not a security audit");
check("Type checking", ["run", "typecheck"], "Local generated Prisma client is required");
check("Unit, integration and security regression", ["test", "--", "--exclude", "tests/e2e/**"], "Offline tests may use mocks or skip database-dependent cases; not PostgreSQL, payment or tenant-isolation acceptance");
check("Build", ["run", "build"], "Offline build with DATABASE_URL removed; does not test production migrations or deployment");

const missing = [
  ["Financial reconciliation", "INCOMPLETE", "No complete authoritative period ledger or independent reconciliation suite exists."],
  ["PostgreSQL integration", "NOT TESTED", "This command deliberately does not connect to a database. Run the disposable PostgreSQL CI journey; existing tests do not prove full reconciliation."],
  ["Actual UTC-midnight verification", "BLOCKED", "Requires an actual boundary and disposable PostgreSQL; existing opt-in scenario is partial."],
  ["Six-viewport operational workflows", "INCOMPLETE", "Complete workflows and persistent outcome evidence are not implemented at all six sizes."],
  ["Native PWA lifecycle", "NOT TESTED", "Native install, standalone launch and update/relaunch require a supported real browser; synthetic events are not evidence."],
  ["R2 persistence", "BLOCKED", "Owner-approved isolated storage, cost approval and a testable environment are required; see R2_SETUP.md."],
  ["SMTP delivery", "BLOCKED", "Owner-approved isolated relay and test mailbox are required; see OWNER_RELEASE_BLOCKERS.md."],
  ["Tenant isolation and security", "INCOMPLETE", "Offline regression alone cannot establish all permissions, real payment or browser isolation requirements."],
  ["Migration safety", "NOT TESTED", "Requires a disposable PostgreSQL migration rehearsal; no database is accessed by this command."],
];
for (const [criterion, status, evidence] of missing) results.push({ criterion, status, environment: "not executed", command: null, exitCode: null, evidence });
console.log(JSON.stringify({ release: "BLOCKED", environment: `offline ${platform}/${arch} Node ${version}`, results }, null, 2));
// Even successful offline commands cannot authorize release. This is not a CI green-washing gate.
process.exitCode = 1;
