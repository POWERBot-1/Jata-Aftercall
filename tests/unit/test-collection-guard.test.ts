import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A test file whose name does not match vitest's include glob silently never runs — locally or in
 * CI. That happened to the canonical §49 pricing suite (`pricing-ai-test.ts`), whose KES 499 /
 * 30-day assertions were dead for an entire release. This guard fails the suite the moment another
 * file is added that vitest will not collect.
 *
 * The include glob lives in vitest.config.ts: `tests/**\/*.test.ts` and `tests/**\/*.spec.ts`.
 */

const REPO_ROOT = path.resolve(__dirname, "../..");
const TESTS_DIR = path.join(REPO_ROOT, "tests");
const COLLECTED = /\.(test|spec)\.tsx?$/;

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  });
}

describe("test collection guard", () => {
  const files = walk(TESTS_DIR).map((file) => path.relative(REPO_ROOT, file));

  it("finds the test directory", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("every non-helper file under tests/ is collected by vitest", () => {
    const uncollected = files.filter(
      (file) => !COLLECTED.test(file) && !file.startsWith(`tests${path.sep}helpers${path.sep}`),
    );

    expect(uncollected).toEqual([]);
  });

  it("no file looks like a test without being named like one", () => {
    // `foo-test.ts`, `foo_test.ts`, `foo.spec.ts` sitting outside tests/, or `foo-test.ts` inside
    // it, are all invisible to vitest. Catch the suffix mistake specifically so the error message
    // names the fix.
    const misnamed = files.filter(
      (file) => !COLLECTED.test(file) && /[-_](test|spec)\.tsx?$/.test(file),
    );

    expect(misnamed, "rename to *.test.ts (vitest only collects *.test.ts / *.spec.ts)").toEqual([]);
  });

  it("no test file exists outside the tests/ directory", () => {
    const directoriesToScan = ["app", "components", "lib"];
    const strays = directoriesToScan
      .map((dir) => path.join(REPO_ROOT, dir))
      .filter((dir) => fs.existsSync(dir))
      .flatMap(walk)
      .map((file) => path.relative(REPO_ROOT, file))
      .filter((file) => COLLECTED.test(file));

    expect(strays).toEqual([]);
  });
});
