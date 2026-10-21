#!/usr/bin/env node
/**
 * JATA AFTERCALL — workflow expression checker
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-10-20 a workflow was committed with:
 *
 *     CANDIDATE_LABEL: ${{ inputs.candidate_label || 'PR #49' }}
 *
 * GitHub rejected the file at load time: run 39516190207 has **zero jobs**, and
 * its workflow name is reported as the file path because the workflow never
 * parsed. The expression never closed, because YAML read ` #` as the start of a
 * comment and the `}}` vanished.
 *
 * Nothing in the repository noticed. The gate that would have caught it is
 * defined by the same kind of file, so a syntax error in a workflow is a silent
 * failure of the safety net itself. Every other check in this repository runs
 * *inside* a workflow; this one runs on the workflow text.
 *
 * WHAT IT CHECKS
 * --------------
 *  1. Every `${{` in a live (non-comment) position closes with `}}` on the same
 *     line. Multi-line expressions are not used here and are not accepted
 *     silently: an expression that spans lines is reported, not guessed at.
 *  2. A quoted scalar is respected: `"PR #49"` inside quotes is data, not a
 *     comment. Getting this wrong in the other direction would make the checker
 *     cry wolf on correct files, which is how checkers get disabled.
 *
 * WHAT IT DOES NOT CHECK
 * ----------------------
 * Full YAML or Actions schema validity. This is one rule, the one that has
 * actually broken this repository. A schema validator is a separate tool.
 *
 * EXIT CODES
 *   0  every file passed
 *   1  at least one violation
 *   2  no files given (a checker with nothing to check must not report success)
 *
 * USAGE
 *   node scripts/ci/check-workflow-expressions.mjs .github/workflows/*.yml
 */

import { readFileSync } from "node:fs";

/**
 * Return the part of a line that survives YAML comment stripping, using the
 * value's first character to decide whether the value is quoted.
 *
 * In a PLAIN scalar `X: ${{ a || 'PR #49' }}` the `'` is a literal character,
 * so ` #` begins a comment. In a QUOTED scalar `X: "${{ a || 'PR #49' }}"` the
 * `#` is data. This distinction is the whole bug.
 */
export function liveText(line) {
  const mapping = line.match(/^(\s*(?:-\s+)?[A-Za-z0-9_.-]+\s*:\s*)(.*)$/);
  const value = mapping ? mapping[2] : null;
  if (value !== null && (value.startsWith('"') || value.startsWith("'"))) {
    return line;
  }
  const hash = line.search(/\s#/);
  return hash === -1 ? line : line.slice(0, hash);
}

/**
 * Find expressions that never close on their own line.
 *
 * Returns `[{ line, text }]` — line numbers are 1-based.
 */
export function findUnclosedExpressions(text) {
  const violations = [];
  String(text)
    .split("\n")
    .forEach((raw, index) => {
      const live = liveText(raw);
      let cursor = 0;
      while (true) {
        const open = live.indexOf("${{", cursor);
        if (open === -1) break;
        const close = live.indexOf("}}", open + 3);
        if (close === -1) {
          violations.push({ line: index + 1, text: raw.trim() });
          break;
        }
        cursor = close + 2;
      }
    });
  return violations;
}

function main(argv) {
  const files = argv.slice(2);
  if (files.length === 0) {
    console.error("BLOCKED: no workflow files were given; a checker with nothing to check cannot pass.");
    return 2;
  }
  let failed = 0;
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      console.error(`BLOCKED: cannot read ${file} (${error.message})`);
      failed += 1;
      continue;
    }
    const violations = findUnclosedExpressions(text);
    if (violations.length === 0) {
      console.log(`PASS ${file} — every interpolation closes on its line`);
      continue;
    }
    failed += 1;
    for (const violation of violations) {
      console.error(`FAIL ${file}:${violation.line} — unclosed interpolation: ${violation.text.slice(0, 200)}`);
      console.error("     quote the scalar (\"…\") or remove the space before the # in the expression");
    }
  }
  if (failed > 0) {
    console.error(`\nFAIL: ${failed} file(s) contain an expression that GitHub would reject at load time.`);
    return 1;
  }
  console.log(`\nPASS: ${files.length} workflow file(s) parsed for expression integrity.`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("check-workflow-expressions.mjs")) {
  process.exit(main(process.argv));
}
