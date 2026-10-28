/**
 * M418 gate integrity — pure aggregation for the authenticated-storefront journey.
 *
 * Why this module exists
 * ----------------------
 * `scripts/browser/studio-authenticated.check.mjs` samples each of five business categories
 * three times under CPU throttling (`HYDRATION SAMPLE` lines). Before this module, those
 * samples were recorded in a separate `hydrationVisits` array that **no assertion read**:
 * `const failed = results.filter(...)` counted only `check()` results, so a sample could fail
 * and the journey would still print `N passed, 0 failed` and exit 0. In the field that meant
 * 12 of 15 required samples failing in 36 consecutive green CI runs while `results.json`
 * reported `journeyStatus: "PASS"`.
 *
 * This module makes the required samples part of the verdict. It is deliberately pure — no
 * I/O, no globals, no process access — so the aggregation can be regression-tested, which is
 * what `tests/unit/m418-gate.test.ts` does.
 *
 * States
 * ------
 *   ok         the sample loaded and the marker became readable
 *   failed     the sample failed for a substantive reason (marker missing, page error, ...)
 *   unresolved the required evidence was not obtained (observed as a load timeout)
 *   missing    the required sample was never recorded
 *   malformed  a required-key record cannot be interpreted (no boolean ok)
 *
 * Verdicts (a required sample number is stated so a change here is a deliberate act)
 * ---------------------------------------------------------------
 *   PASS     every check passed, the journey completed, every required sample is `ok`,
 *            and the server-order evidence is complete
 *   FAIL     a check failed, or the journey did not complete, or a sample `failed`
 *            substantively  -> exit code 1
 *   BLOCKED  the journey ran but required evidence is unresolved/missing/malformed
 *            -> exit code 2
 *
 * Every non-PASS verdict is a non-zero exit code, so a CI step guarded by `set -o pipefail`
 * fails when required evidence fails or remains unresolved. No state exists in which missing
 * evidence can be reported as PASS.
 */

/** The five representative business categories the journey must sample. */
export const REQUIRED_CATEGORIES = ["retail", "food", "salon", "professional", "technical"];

/** Attempts per category. 5 x 3 = 15 required samples. */
export const REQUIRED_ATTEMPTS = 3;

/** A load timeout is *unresolved evidence*: the sample did not load, so it proves nothing. */
const UNRESOLVED_REASON = /timeout|timed out/i;

/** Required (category, attempt) pairs. */
export function requiredSampleKeys(categories = REQUIRED_CATEGORIES, attempts = REQUIRED_ATTEMPTS) {
  const keys = [];
  for (const category of categories) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) keys.push(`${category}#${attempt}`);
  }
  return keys;
}

/**
 * Classify one recorded sample.
 * @returns {{state: "ok"|"failed"|"unresolved"|"missing"|"malformed", reason: string, category: string, attempt: number|null}}
 */
export function classifySample(entry) {
  if (entry === null || entry === undefined) {
    return { state: "missing", reason: "required sample was never recorded", category: "", attempt: null };
  }
  if (typeof entry !== "object" || Array.isArray(entry)) {
    return { state: "malformed", reason: "sample is not an object", category: "", attempt: null };
  }
  const category = typeof entry.category === "string" ? entry.category.trim() : "";
  const attempt = Number.isInteger(entry.attempt) && entry.attempt > 0 ? entry.attempt : null;
  if (!category || attempt === null) {
    return { state: "malformed", reason: "sample lacks a usable category/attempt", category, attempt };
  }
  if (entry.ok === true) return { state: "ok", reason: "", category, attempt };
  if (entry.ok !== false) {
    return { state: "malformed", reason: "sample lacks a boolean `ok` field", category, attempt };
  }
  const reason = String(entry.error ?? entry.reason ?? "unspecified sample failure");
  if (UNRESOLVED_REASON.test(reason)) return { state: "unresolved", reason, category, attempt };
  return { state: "failed", reason, category, attempt };
}

/**
 * Evaluate the required sample set. Matches samples to required keys by (category, attempt);
 * extra samples (for example diagnostic-arm measurements) are ignored, never counted as
 * satisfying a required key.
 * @returns {{required: number, counts: {ok: number, failed: number, unresolved: number, missing: number, malformed: number, auxiliary: number, duplicates: number}, problems: Array<{category: string, attempt: number|null, state: string, reason: string}>, auxiliary: Array<{category: string, attempt: number|null, state: string, reason: string}>, samplesWithOrder: number}}
 */
export function evaluateSamples(samples = [], categories = REQUIRED_CATEGORIES, attempts = REQUIRED_ATTEMPTS) {
  const list = Array.isArray(samples) ? samples : [];
  const byKey = new Map(); // required key -> every record claiming it (first record wins)
  const auxiliary = [];    // records that claim no required key

  const counts = { ok: 0, failed: 0, unresolved: 0, missing: 0, malformed: 0, auxiliary: 0, duplicates: 0 };
  const problems = [];
  const keys = requiredSampleKeys(categories, attempts);
  const requiredKeys = new Set(keys);

  // A record counts as required-sample evidence only when its (category, attempt) is one of the
  // required keys. Every other record is auxiliary: SSR navigation probes
  // ({category, timezone, path, status}), diagnostic-arm measurements, records with no identity.
  // Auxiliary records are counted and reported so nothing is silently discarded, but they can
  // neither satisfy a required key nor block the gate. Treating them as malformed required
  // samples is a false-positive machine — 57 such records in run 38588457143 were reported as
  // "malformed" although none of them was ever a required sample.
  for (const entry of list) {
    const parsed = classifySample(entry);
    const key = parsed.category && parsed.attempt !== null ? `${parsed.category}#${parsed.attempt}` : "";
    if (key && requiredKeys.has(key)) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(parsed);
    } else {
      auxiliary.push(parsed);
    }
  }
  counts.auxiliary = auxiliary.length;

  for (const key of keys) {
    const records = byKey.get(key) ?? [];
    const [category, attempt] = key.split("#");
    if (records.length === 0) {
      counts.missing += 1;
      problems.push({ category, attempt: Number(attempt), state: "missing", reason: "required sample was never recorded" });
      continue;
    }
    const [first, ...rest] = records;
    counts.duplicates += rest.length; // reported, never allowed to inflate the pass count
    counts[first.state] += 1;
    if (first.state !== "ok") {
      problems.push({ category: first.category, attempt: first.attempt, state: first.state, reason: first.reason });
    }
  }

  const samplesWithOrder = list.filter((entry) => entry && typeof entry === "object" && typeof entry.order === "string" && entry.order.length > 0).length;
  return { required: categories.length * attempts, counts, problems, auxiliary: auxiliary.slice(0, 12), samplesWithOrder };
}

/**
 * Server-order (#418 emission-order) evidence completeness. A gate that asserts "no sample
 * has scripts leading the body" is vacuous when no sample produced an order at all, so a
 * completeness status is required alongside the inversion result.
 * @returns {{checked: number, required: number, inverted: Array<object>, status: "PASS"|"FAIL"|"INSUFFICIENT"}}
 */
export function evaluateM11(visits = [], required = REQUIRED_CATEGORIES.length * REQUIRED_ATTEMPTS) {
  const list = Array.isArray(visits) ? visits : [];
  const withOrder = list.filter((entry) => entry && typeof entry === "object" && typeof entry.order === "string" && entry.order.length > 0);
  const inverted = withOrder.filter((entry) => entry.order.trim().startsWith("script"));
  const status = inverted.length > 0 ? "FAIL" : withOrder.length >= required ? "PASS" : "INSUFFICIENT";
  return { checked: withOrder.length, required, inverted, status };
}

/**
 * The single source of truth for the journey verdict.
 * @param {{results?: Array<{name: string, ok: boolean, detail?: string}>, samples?: Array<object>, journeyComplete?: boolean, m11?: {status: string}, categories?: string[], attempts?: number}} input
 */
export function evaluateGate(input = {}) {
  const results = Array.isArray(input.results) ? input.results : [];
  const journeyComplete = input.journeyComplete === true;
  const samples = evaluateSamples(input.samples, input.categories ?? REQUIRED_CATEGORIES, input.attempts ?? REQUIRED_ATTEMPTS);
  const m11 = input.m11 ?? { status: "INSUFFICIENT", checked: 0, required: samples.required };

  const failedChecks = results.filter((item) => !item || item.ok !== true);
  const failingSampleProblems = samples.problems.filter((problem) => problem.state === "failed");
  const unresolvedProblems = samples.problems.filter((problem) => problem.state !== "failed");

  let status = "PASS";
  let stage = "all checks and required samples passed";
  if (failedChecks.length > 0) {
    status = "FAIL";
    stage = `${failedChecks.length} check(s) failed`;
  } else if (!journeyComplete) {
    status = "FAIL";
    stage = "journey did not complete (fail-fast remainder not run)";
  } else if (failingSampleProblems.length > 0) {
    status = "FAIL";
    stage = `${failingSampleProblems.length} required sample(s) failed`;
  } else if (unresolvedProblems.length > 0) {
    status = "BLOCKED";
    const bits = [];
    if (samples.counts.unresolved) bits.push(`${samples.counts.unresolved} unresolved`);
    if (samples.counts.missing) bits.push(`${samples.counts.missing} missing`);
    if (samples.counts.malformed) bits.push(`${samples.counts.malformed} malformed`);
    stage = `required sample evidence incomplete (${bits.join(", ")})`;
  } else if (m11.status !== "PASS") {
    status = "BLOCKED";
    stage = `server-order evidence incomplete (${m11.checked}/${m11.required} samples produced an order)`;
  }

  return {
    status,
    stage,
    exitCode: exitCodeFor(status),
    checks: { total: results.length, passed: results.length - failedChecks.length, failed: failedChecks.length, failedNames: failedChecks.map((item) => String(item?.name ?? "unknown check")) },
    samples,
    m11: { status: m11.status, checked: m11.checked, required: m11.required, inverted: m11.inverted?.length ?? 0 },
    problems: samples.problems,
  };
}

/** PASS -> 0, FAIL -> 1, BLOCKED -> 2. No non-PASS status maps to a zero exit code. */
export function exitCodeFor(status) {
  if (status === "PASS") return 0;
  if (status === "FAIL") return 1;
  return 2;
}

/** The artifact/`journeyStatus` value. `PASS` is reachable only from a PASS verdict. */
export function journeyStatusFor(status) {
  if (status === "PASS") return "PASS";
  return status === "BLOCKED" ? "BLOCKED: required evidence unresolved" : "FAIL";
}

/** Compact one-line verdict naming every affected category, attempt and reason. */
export function gateLine(summary) {
  if (!summary || summary.status === "PASS") return "M418 GATE PASS: all required samples and checks passed";
  const parts = (summary.problems ?? []).map((problem) => `${problem.category} a${problem.attempt ?? "?"} ${problem.reason}`.slice(0, 60));
  const head = `M418 GATE ${summary.status}: ${summary.stage}`;
  const detail = parts.length ? ` :: ${parts.slice(0, 8).join(" | ")}` : "";
  const more = parts.length > 8 ? ` (+${parts.length - 8} more)` : "";
  return `${head}${detail}${more}`.slice(0, 880);
}

/** Sample tally line, kept separate from the functional check counts. */
export function sampleTallyLine(summary) {
  const counts = summary?.samples?.counts ?? { ok: 0, failed: 0, unresolved: 0, missing: 0, malformed: 0, auxiliary: 0, duplicates: 0 };
  const required = summary?.samples?.required ?? 0;
  return `HYDRATION SAMPLES required=${required} ok=${counts.ok} failed=${counts.failed} unresolved=${counts.unresolved} missing=${counts.missing} malformed=${counts.malformed} auxiliary=${counts.auxiliary ?? 0} duplicates=${counts.duplicates ?? 0}`;
}
