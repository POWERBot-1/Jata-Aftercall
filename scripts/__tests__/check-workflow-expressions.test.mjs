import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findUnclosedExpressions, liveText } from "../ci/check-workflow-expressions.mjs";

// The negative control is the actual line that broke run 39516190207. If this
// test ever stops failing on it, the checker has stopped protecting anything.

test("the line that broke run 39516190207 is detected", () => {
  const broken = `      CANDIDATE_LABEL: \${{ inputs.candidate_label || 'PR #49' }}\n`;
  const violations = findUnclosedExpressions(broken);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 1);
  assert.match(violations[0].text, /CANDIDATE_LABEL/);
});

test("quoting the scalar fixes it without changing the expression", () => {
  const fixed = `      CANDIDATE_LABEL: "\${{ inputs.candidate_label || 'PR #49' }}"\n`;
  assert.deepEqual(findUnclosedExpressions(fixed), []);
});

test("a # inside a double-quoted value is data, not a comment", () => {
  assert.equal(liveText('  name: "build #49"'), '  name: "build #49"');
  assert.deepEqual(findUnclosedExpressions('  name: "build #${{ github.run_number }}"\n'), []);
});

test("a # inside a plain scalar is a comment, and swallows what follows", () => {
  assert.equal(liveText("  name: build #49 ${{ x }}"), "  name: build");
});

test("ordinary expressions and comments are not flagged", () => {
  const fine = [
    "on: push",
    "env:",
    "  NODE_VERSION: \"22.22.3\"",
    "  SHA: ${{ github.sha }}",
    "  BOTH: ${{ inputs.a || inputs.b }}",
    "      - run: echo ${{ github.ref_name }}",
    "# a comment mentioning ${{ not really }} is fine only if it closes",
    "",
  ].join("\n");
  assert.deepEqual(findUnclosedExpressions(fine), []);
});

test("an expression opened inside a comment is not flagged", () => {
  assert.deepEqual(findUnclosedExpressions("# see ${{ docs }}\nname: ok\n"), []);
});

test("several expressions on one line are each required to close", () => {
  assert.deepEqual(findUnclosedExpressions("  X: ${{ a }} and ${{ b }}\n"), []);
  const violations = findUnclosedExpressions("  X: ${{ a }} and ${{ b\n");
  assert.equal(violations.length, 1);
});

test("every workflow in this repository passes", () => {
  const dir = join(process.cwd(), ".github", "workflows");
  const files = readdirSync(dir).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
  assert.ok(files.length >= 3, `expected the repository's workflows, found ${files.length}`);
  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    assert.deepEqual(findUnclosedExpressions(text), [], `${file} contains an unclosed expression`);
  }
});
