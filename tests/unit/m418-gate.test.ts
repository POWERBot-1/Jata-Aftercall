/**
 * M418 gate-integrity regression tests.
 *
 * These pin the behaviour that was missing: required hydration samples must not be ignorable.
 * The defect these exist to prevent is concrete — 12 of 15 required samples failed in 36
 * consecutive green CI runs while the run reported `0 failed` and `journeyStatus: "PASS"` —
 * so each case below fails loudly if that shape can return.
 *
 * Pure unit tests: no database, no browser, no network.
 */
import { describe, it, expect } from "vitest";
import {
  REQUIRED_ATTEMPTS,
  REQUIRED_CATEGORIES,
  classifySample,
  evaluateGate,
  evaluateM11,
  evaluateSamples,
  exitCodeFor,
  gateLine,
  journeyStatusFor,
  requiredSampleKeys,
  sampleTallyLine,
} from "../../scripts/browser/m418-gate.mjs";

const ALL_CHECKS_OK = Array.from({ length: 428 }, (_, index) => ({ name: `check-${index}`, ok: true }));

/** Build the 15 required samples: one per (category, attempt) at 3 attempts. */
function requiredSamples(overrides = {}) {
  const samples = [];
  for (const category of REQUIRED_CATEGORIES) {
    for (let attempt = 1; attempt <= REQUIRED_ATTEMPTS; attempt += 1) {
      const key = `${category}#${attempt}`;
      const override = overrides[key];
      samples.push(
        override === undefined
          ? { category, attempt, ok: true, throttle: 4, order: "div,div,script", route: `/dashboard/businesses/qa-${category}/preview` }
          : { category, attempt, throttle: 4, ...override },
      );
    }
  }
  return samples;
}

const TIMEOUT = "TimeoutError: Waiting failed: 25000ms exceeded";

describe("required sample definition", () => {
  it("requires five categories at three attempts each", () => {
    expect(requiredSampleKeys()).toHaveLength(15);
    expect(REQUIRED_CATEGORIES).toEqual(["retail", "food", "salon", "professional", "technical"]);
    expect(REQUIRED_ATTEMPTS).toBe(3);
  });

  it("classifies a load timeout as unresolved evidence, not as a pass and not as a marker failure", () => {
    expect(classifySample({ category: "food", attempt: 1, ok: false, error: TIMEOUT }).state).toBe("unresolved");
    expect(classifySample({ category: "food", attempt: 1, ok: false, error: "marker missing on hydrated document" }).state).toBe("failed");
    expect(classifySample({ category: "food", attempt: 1, ok: true, order: "div" }).state).toBe("ok");
    expect(classifySample({ category: "food", attempt: 1 }).state).toBe("malformed");
    expect(classifySample({ ok: true }).state).toBe("malformed");
    expect(classifySample(null).state).toBe("missing");
  });
});

describe("case 1 — a complete set of passing required samples can pass", () => {
  it("returns PASS with exit code 0 and a PASS artifact status", () => {
    const gate = evaluateGate({ results: ALL_CHECKS_OK, samples: requiredSamples(), journeyComplete: true, m11: evaluateM11(requiredSamples()) });
    expect(gate.status).toBe("PASS");
    expect(gate.exitCode).toBe(0);
    expect(journeyStatusFor(gate.status)).toBe("PASS");
    expect(gate.samples.counts).toEqual({ ok: 15, failed: 0, unresolved: 0, missing: 0, malformed: 0, auxiliary: 0, duplicates: 0 });
    expect(gateLine(gate)).toContain("M418 GATE PASS");
  });
});

describe("case 2 — one required failed sample cannot produce PASS", () => {
  it("fails, names the category, attempt and reason, and exits non-zero", () => {
    const samples = requiredSamples({ "salon#2": { ok: false, error: "marker missing after hydration" } });
    const gate = evaluateGate({ results: ALL_CHECKS_OK, samples, journeyComplete: true, m11: evaluateM11(samples) });
    expect(gate.status).toBe("FAIL");
    expect(gate.exitCode).toBeGreaterThan(0);
    expect(gate.problems).toContainEqual({ category: "salon", attempt: 2, state: "failed", reason: "marker missing after hydration" });
    const line = gateLine(gate);
    expect(line).toContain("M418 GATE FAIL");
    expect(line).toContain("salon a2");
    expect(line).toContain("marker missing after hydration");
    expect(journeyStatusFor(gate.status)).not.toBe("PASS");
  });
});

describe("case 3 — multiple required failed samples cannot produce PASS", () => {
  it("fails and reports every affected category", () => {
    const samples = requiredSamples({
      "food#1": { ok: false, error: "marker missing" },
      "food#3": { ok: false, error: "marker missing" },
      "technical#2": { ok: false, error: "page error" },
    });
    const gate = evaluateGate({ results: ALL_CHECKS_OK, samples, journeyComplete: true, m11: evaluateM11(samples) });
    expect(gate.status).toBe("FAIL");
    expect(gate.exitCode).toBeGreaterThan(0);
    const categories = new Set(gate.problems.map((problem) => problem.category));
    expect(categories).toEqual(new Set(["food", "technical"]));
    expect(gate.problems).toHaveLength(3);
  });
});

describe("case 4 — missing required samples produce an explicit non-passing state", () => {
  it("blocks with a non-zero exit code and names each absent sample", () => {
    const samples = requiredSamples().filter((sample) => !(sample.category === "technical" && sample.attempt === 3));
    const gate = evaluateGate({ results: ALL_CHECKS_OK, samples, journeyComplete: true, m11: evaluateM11(samples) });
    expect(gate.status).toBe("BLOCKED");
    expect(gate.status).not.toBe("PASS");
    expect(gate.exitCode).toBeGreaterThan(0);
    expect(gate.samples.counts.missing).toBe(1);
    expect(gate.problems).toContainEqual({ category: "technical", attempt: 3, state: "missing", reason: "required sample was never recorded" });
    expect(sampleTallyLine(gate)).toContain("missing=1");
  });

  it("treats an absent sample list as 15 missing samples rather than a pass", () => {
    const gate = evaluateGate({ results: ALL_CHECKS_OK, samples: [], journeyComplete: true });
    expect(gate.status).toBe("BLOCKED");
    expect(gate.samples.counts.missing).toBe(15);
    expect(gate.exitCode).toBeGreaterThan(0);
  });
});

describe("case 5 — malformed required samples never produce PASS", () => {
  it("blocks when a required sample cannot be interpreted", () => {
    const samples = requiredSamples({ "retail#1": { ok: undefined } }); // required key, no boolean ok
    const gate = evaluateGate({ results: ALL_CHECKS_OK, samples, journeyComplete: true, m11: evaluateM11(samples) });
    expect(gate.status).toBe("BLOCKED");
    expect(gate.exitCode).toBeGreaterThan(0);
    expect(gate.samples.counts.malformed).toBe(1);
    expect(gate.problems).toContainEqual({ category: "retail", attempt: 1, state: "malformed", reason: "sample lacks a boolean `ok` field" });
    expect(journeyStatusFor(gate.status)).not.toBe("PASS");
  });

  it('blocks when a required sample carries a non-boolean verdict (ok: "true")', () => {
    const samples = requiredSamples({ "salon#3": { ok: "true" } });
    const gate = evaluateGate({ results: ALL_CHECKS_OK, samples, journeyComplete: true, m11: evaluateM11(samples) });
    expect(gate.status).toBe("BLOCKED");
    expect(gate.samples.counts.malformed).toBe(1);
    expect(gate.samples.counts.ok).toBe(14);
  });

  it("records a non-required record as auxiliary evidence instead of blocking on it", () => {
    // Auxiliary records claim no required key, so they can neither satisfy one nor block the
    // gate — but they are counted, reported and never silently discarded. Blocking on them
    // would make the gate unsatisfiable by a clean run.
    const gate = evaluateGate({ results: ALL_CHECKS_OK, samples: [...requiredSamples(), { ok: false, error: "no category" }], journeyComplete: true, m11: evaluateM11(requiredSamples()) });
    expect(gate.status).toBe("PASS");
    expect(gate.samples.counts.auxiliary).toBe(1);
    expect(gate.samples.counts.malformed).toBe(0);
  });
});

describe("the auxiliary shape a real run produces cannot block a clean gate", () => {
  // scripts/browser/studio-authenticated.check.mjs records its SSR navigation probes
  // ({category, timezone, path, status}) into the same array as the required samples. Run
  // 38588457143 produced exactly 57 of them and the gate reported malformed=57 — a false
  // classification of evidence that was never a required sample. These pin both numbers.
  function ssrProbes() {
    const probes = [];
    for (const category of REQUIRED_CATEGORIES) {
      const suffix = category === "salon"
        ? ["", "/item/x", "/book?service=x"]
        : ["professional", "technical"].includes(category)
          ? ["", "/item/x", "/shop", "/enquire?service=x", "/book?service=c"]
          : ["", "/item/x", "/shop"];
      for (const timezone of ["UTC", "Africa/Nairobi", "America/New_York"]) {
        for (const path of suffix) {
          probes.push({ category, timezone, path: `/b/slug${path}`.split("?")[0], status: 200 });
        }
      }
    }
    return probes;
  }

  it("records 57 SSR probes as auxiliary, keeping malformed=0 on a clean set", () => {
    const probes = ssrProbes();
    expect(probes).toHaveLength(57); // the number run 38588457143 misreported as malformed
    const gate = evaluateGate({ results: ALL_CHECKS_OK, samples: [...requiredSamples(), ...probes], journeyComplete: true, m11: evaluateM11(requiredSamples()) });
    expect(gate.status).toBe("PASS");
    expect(gate.exitCode).toBe(0);
    expect(gate.samples.counts).toMatchObject({ ok: 15, malformed: 0, auxiliary: 57 });
    expect(sampleTallyLine(gate)).toContain("auxiliary=57");
    expect(sampleTallyLine(gate)).toContain("malformed=0");
  });

  it("still blocks the real failing shape, naming 12 unresolved and no malformed", () => {
    const samples = requiredSamples();
    for (const category of ["food", "salon", "professional", "technical"]) {
      for (let attempt = 1; attempt <= REQUIRED_ATTEMPTS; attempt += 1) {
        const index = samples.findIndex((sample) => sample.category === category && sample.attempt === attempt);
        samples[index] = { category, attempt, throttle: 4, ok: false, error: TIMEOUT, diag: { iframePresent: true, readyState: "complete", body: true } };
      }
    }
    const gate = evaluateGate({ results: ALL_CHECKS_OK, samples: [...samples, ...ssrProbes()], journeyComplete: true, m11: evaluateM11(samples) });
    expect(gate.status).toBe("BLOCKED");
    expect(gate.exitCode).toBe(2);
    expect(gate.samples.counts).toEqual({ ok: 3, failed: 0, unresolved: 12, missing: 0, malformed: 0, auxiliary: 57, duplicates: 0 });
    expect(gate.stage).toBe("required sample evidence incomplete (12 unresolved)");
    expect(gate.problems).toHaveLength(12);
  });
});

describe("case 6 — an incomplete journey cannot produce PASS", () => {
  it("fails when the journey did not complete even with every sample ok", () => {
    const gate = evaluateGate({ results: ALL_CHECKS_OK, samples: requiredSamples(), journeyComplete: false, m11: evaluateM11(requiredSamples()) });
    expect(gate.status).toBe("FAIL");
    expect(gate.exitCode).toBeGreaterThan(0);
    expect(gate.stage).toContain("did not complete");
  });

  it("prefers FAIL over BLOCKED when a check genuinely failed", () => {
    const results = [...ALL_CHECKS_OK, { name: "salon: actual browser booking", ok: false, detail: "status=500" }];
    const samples = requiredSamples({ "food#1": { ok: false, error: TIMEOUT } });
    const gate = evaluateGate({ results, samples, journeyComplete: true, m11: evaluateM11(samples) });
    expect(gate.status).toBe("FAIL");
    expect(gate.checks.failedNames).toContain("salon: actual browser booking");
  });
});

describe("the real-world shape that this work exists to catch", () => {
  it("reports BLOCKED when retail passes and the other four categories time out three times each", () => {
    const samples = requiredSamples();
    for (const category of ["food", "salon", "professional", "technical"]) {
      for (let attempt = 1; attempt <= REQUIRED_ATTEMPTS; attempt += 1) {
        const index = samples.findIndex((sample) => sample.category === category && sample.attempt === attempt);
        samples[index] = { category, attempt, throttle: 4, ok: false, error: TIMEOUT, diag: { iframePresent: true } };
      }
    }
    const gate = evaluateGate({ results: ALL_CHECKS_OK, samples, journeyComplete: true, m11: evaluateM11(samples) });
    expect(gate.status).toBe("BLOCKED");
    expect(gate.exitCode).toBe(2);
    expect(gate.samples.counts).toEqual({ ok: 3, failed: 0, unresolved: 12, missing: 0, malformed: 0, auxiliary: 0, duplicates: 0 });
    const categories = new Set(gate.problems.map((problem) => problem.category));
    expect(categories).toEqual(new Set(["food", "salon", "professional", "technical"]));
    expect(journeyStatusFor(gate.status)).not.toBe("PASS");
    expect(sampleTallyLine(gate)).toBe("HYDRATION SAMPLES required=15 ok=3 failed=0 unresolved=12 missing=0 malformed=0 auxiliary=0 duplicates=0");
  });
});

describe("exit-code and CI-gate behaviour", () => {
  it("maps every verdict to a definite exit code and never maps a non-PASS to zero", () => {
    expect(exitCodeFor("PASS")).toBe(0);
    expect(exitCodeFor("FAIL")).toBe(1);
    expect(exitCodeFor("BLOCKED")).toBe(2);
    for (const status of ["FAIL", "BLOCKED", "anything-else"]) expect(exitCodeFor(status)).not.toBe(0);
  });

  it("never reports a PASS artifact status for a non-PASS verdict", () => {
    for (const status of ["FAIL", "BLOCKED"]) expect(journeyStatusFor(status)).not.toBe("PASS");
  });
});

describe("M11 server-order evidence cannot pass vacuously", () => {
  it("is INSUFFICIENT when failed samples produced no order at all", () => {
    const m11 = evaluateM11([{ category: "retail", attempt: 1, ok: true, order: "div,div,script" }]);
    expect(m11.status).toBe("INSUFFICIENT");
    expect(m11.checked).toBe(1);
    expect(m11.required).toBe(15);
  });

  it("is FAIL when scripts lead the body", () => {
    const samples = requiredSamples();
    samples[4] = { ...samples[4], order: "script,div,div" };
    expect(evaluateM11(samples).status).toBe("FAIL");
  });

  it("is PASS only with every required sample's order present", () => {
    expect(evaluateM11(requiredSamples()).status).toBe("PASS");
  });

  it("blocks the journey when the order evidence is incomplete even if all samples are ok", () => {
    const samples = requiredSamples().map((sample, index) => (index === 0 ? { ...sample, order: undefined } : sample));
    const gate = evaluateGate({ results: ALL_CHECKS_OK, samples, journeyComplete: true, m11: evaluateM11(samples) });
    expect(gate.status).toBe("BLOCKED");
    expect(gate.exitCode).toBeGreaterThan(0);
    expect(gate.stage).toContain("server-order evidence incomplete");
  });
});

describe("sample matching is strict", () => {
  it("does not let a diagnostic-arm sample satisfy a required key", () => {
    const samples = requiredSamples().filter((sample) => sample.category !== "food");
    samples.push({ category: "food", attempt: 1, ok: true, arm: "no-throttle", order: "div" }); // extra arm, same key
    const evaluation = evaluateSamples(samples);
    // The arm record legitimately occupies food#1 (same category/attempt), so only the
    // two absent food attempts (2 and 3) may be reported missing — never more, never fewer.
    expect(evaluation.counts.missing).toBe(2);
  });

  it("ignores duplicates so a repeated key cannot inflate the pass count", () => {
    const samples = requiredSamples();
    samples.push({ category: "retail", attempt: 1, ok: true, order: "div" });
    const evaluation = evaluateSamples(samples);
    expect(evaluation.counts.ok).toBe(15);
    expect(evaluation.counts.duplicates).toBe(1); // reported, never counted as a pass
  });
});
