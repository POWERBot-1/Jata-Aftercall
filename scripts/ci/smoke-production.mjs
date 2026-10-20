#!/usr/bin/env node
/**
 * JATA AFTERCALL — post-deployment smoke test (read-only)
 *
 * WHY THIS EXISTS
 * ---------------
 * `production-smoke.yml` is listed as an active workflow in the Actions UI but
 * exists on no branch. It last ran on 2026-10-05 from `arena/01a10b8d-jata-aftercall`,
 * a branch that was never merged. The registration outlived the file, so the
 * repository has appeared to have a post-deployment check that does not exist.
 *
 * This script is that check, rewritten so its logic can be tested without
 * touching production.
 *
 * WHAT IT DOES — GET requests only
 *   /            the deployment serves HTML
 *   /health      the application reports db:up (a real, non-stub connection)
 *   /b/<slug>    an optional public storefront page
 *
 * WHAT IT NEVER DOES
 *   No POST/PUT/PATCH/DELETE. No authentication. No payment flow. No writes of
 *   any kind. Every request is a GET with a timeout.
 *
 * EXIT CODES
 *   0  all enabled checks passed
 *   1  a check failed
 *   2  blocked: no base URL, or the deployment could not be reached at all
 *
 * USAGE
 *   node scripts/ci/smoke-production.mjs --base-url https://example.com [--slug my-business] [--timeout 15000]
 */

/**
 * Evaluate the homepage response.
 * @returns {{ok: boolean, reason: string}}
 */
export function evaluateHomepage({ status, body }) {
  if (status !== 200) return { ok: false, reason: `expected 200, received ${status}` };
  if (!body || body.trim() === "") return { ok: false, reason: "empty body" };
  if (!/<html[\s>]/i.test(body)) return { ok: false, reason: "body is not HTML (no <html> element)" };
  return { ok: true, reason: "200 with HTML" };
}

/**
 * Evaluate the health response.
 *
 * `db: "unconfigured"` is a FAIL in production, not a pass: the route reports it
 * when DATABASE_URL is absent and it is refusing to trust the offline stub. A
 * deployment in that state is serving pages with no database.
 */
export function evaluateHealth({ status, body }) {
  if (status !== 200) return { ok: false, reason: `expected 200, received ${status}` };
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: "body is not JSON" };
  }
  if (parsed.db === "unconfigured") {
    return { ok: false, reason: "db:unconfigured — the deployment has no DATABASE_URL and is using the offline stub" };
  }
  if (parsed.db !== "up") return { ok: false, reason: `db:${parsed.db ?? "missing"} — expected "up"` };
  if (parsed.status !== "ok") return { ok: false, reason: `status:${parsed.status ?? "missing"} — expected "ok"` };
  return { ok: true, reason: `status:ok, db:up, version:${parsed.version ?? "?"}` };
}

/** Evaluate a public storefront page. */
export function evaluateStorefront({ status, body }) {
  if (status !== 200) return { ok: false, reason: `expected 200, received ${status}` };
  if (!body || !/<html[\s>]/i.test(body)) return { ok: false, reason: "body is not HTML" };
  return { ok: true, reason: "200 with HTML" };
}

async function get(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "jata-post-deployment-smoke/1.0 (+read-only)" },
    });
    const body = await response.text();
    return { status: response.status, body, error: null };
  } catch (error) {
    return { status: 0, body: "", error: error.name === "AbortError" ? `timed out after ${timeoutMs}ms` : error.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the checks. Returns { results, reachable, exitCode }.
 * Exported so the workflow logic and the fixture tests share one implementation.
 */
export async function runSmoke({ baseUrl, slug, timeoutMs = 15000, attempts = 2, getImpl = get, log = console.log }) {
  if (!baseUrl) return { results: [], reachable: false, exitCode: 2, error: "no base URL" };

  const base = baseUrl.replace(/\/+$/, "");
  const checks = [
    { name: "homepage", url: `${base}/`, evaluate: evaluateHomepage },
    { name: "health", url: `${base}/health`, evaluate: evaluateHealth },
  ];
  if (slug) checks.push({ name: `storefront /b/${slug}`, url: `${base}/b/${encodeURIComponent(slug)}`, evaluate: evaluateStorefront });

  const results = [];
  let reachable = false;

  for (const check of checks) {
    let outcome = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const response = await getImpl(check.url, timeoutMs);
      if (response.error === null) reachable = true;
      outcome = { ...check.evaluate(response), httpStatus: response.status, error: response.error, attempt };
      // Do not retry a definitive application answer; only retry transport errors.
      if (response.error === null) break;
      if (attempt < attempts) log(`[smoke] ${check.name}: attempt ${attempt} failed (${response.error}), retrying`);
    }
    if (outcome.error) outcome.ok = false;
    results.push({ name: check.name, url: check.url, ...outcome });
    log(`[smoke] ${outcome.ok ? "PASS" : "FAIL"} ${check.name} -> ${check.url} — ${outcome.error ?? outcome.reason}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (!reachable) {
    return { results, reachable, exitCode: 2, error: "the deployment could not be reached at all" };
  }
  return { results, reachable, exitCode: failed.length === 0 ? 0 : 1 };
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(argv) {
  const args = argv.slice(2);
  const baseUrl = argValue(args, "--base-url") || process.env.SMOKE_BASE_URL;
  const slug = argValue(args, "--slug") || process.env.SMOKE_BUSINESS_SLUG;
  const timeoutMs = Number(argValue(args, "--timeout") || process.env.SMOKE_TIMEOUT_MS || 15000);

  if (!baseUrl) {
    console.error("BLOCKED: no --base-url and no SMOKE_BASE_URL. A smoke test with no target cannot pass.");
    return 2;
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
    console.error(`BLOCKED: timeout must be an integer >= 1000ms, received ${timeoutMs}`);
    return 2;
  }

  console.log(`[smoke] target: ${baseUrl}`);
  console.log(`[smoke] storefront: ${slug ? `/b/${slug}` : "(not configured — skipped by configuration, not by failure)"}`);

  const { results, exitCode, error } = await runSmoke({ baseUrl, slug, timeoutMs });
  if (error) console.error(`BLOCKED: ${error}`);

  const failed = results.filter((r) => !r.ok);
  if (exitCode === 0) {
    console.log(`PASS: ${results.length}/${results.length} read-only checks succeeded`);
  } else if (exitCode === 1) {
    for (const f of failed) console.error(`::error::FAIL ${f.name}: ${f.error ?? f.reason}`);
    console.error(`FAIL: ${failed.length}/${results.length} checks failed`);
  }
  return exitCode;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main(process.argv));
}
