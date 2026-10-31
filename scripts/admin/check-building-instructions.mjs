#!/usr/bin/env node
// Append-only integrity, not proof that an entry faithfully quotes its owner or is approved.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const path = "docs/ADMIN_BUILDING_INSTRUCTIONS.md";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const fail = (message) => { throw new Error(message); };

export function validateRegister(text) {
  if (!text.includes("## FINTECH MOTION UI BUILDING INSTRUCTIONS")) fail("Missing FINTECH MOTION UI subsection");
  const heading = /^#{2,3} (\d{3}) — ([A-Z]+-\d{3}):[^\n]*$/gm;
  const matches = [...text.matchAll(heading)];
  if (!matches.length) fail("No numbered requirements found");
  // Detect malformed numbered headings rather than silently skipping them.
  const numbered = [...text.matchAll(/^#{2,3} \d{3}\b[^\n]*$/gm)];
  if (numbered.length !== matches.length) fail("Malformed numbered requirement heading");
  const ids = new Set(); const sequences = new Map();
  for (let i = 0; i < matches.length; i++) {
    const [, number, id] = matches[i];
    if (Number(number) !== i + 1) fail(`Requirement section ${number} is not sequential; expected ${String(i + 1).padStart(3, "0")}`);
    if (ids.has(id)) fail(`Duplicate requirement ID: ${id}`);
    const [prefix, suffix] = id.split("-");
    const expected = (sequences.get(prefix) ?? 0) + 1;
    if (Number(suffix) !== expected) fail(`Requirement ID ${id} is not sequential for ${prefix}; expected ${String(expected).padStart(3, "0")}`);
    const body = text.slice(matches[i].index + matches[i][0].length, matches[i + 1]?.index ?? text.length);
    for (const field of ["Date / approval / status", "Purpose / function", "Security/privacy / UX", "Affected", "Acceptance", "Dependencies", "Evidence", "commit"]) {
      if (!body.includes(field)) fail(`${id}: missing required field ${field}`);
    }
    const dateStatus = body.match(/\*\*Date \/ approval \/ status:\*\* ([^\n]+)/);
    if (!dateStatus || !/\b\d{4}-\d{2}-\d{2}\b/.test(dateStatus[1]) || !/\b(PENDING|IN PROGRESS|BLOCKED|IMPLEMENTED|VERIFIED)\b/.test(dateStatus[1])) fail(`${id}: invalid date or status`);
    if (!body.includes("Owner instruction") && !body.includes("Original owner instruction")) fail(`${id}: missing owner instruction`);
    // Correction is an appended record: old wording remains intact. Require an earlier ID and
    // explicit change and approval; the script cannot verify the authenticity of that approval.
    const correction = body.match(/\*\*Correction of:\*\*\s*([A-Z]+-\d{3})/);
    if (body.includes("**Correction of:**") && !correction) fail(`${id}: malformed correction reference`);
    if (correction) {
      if (!ids.has(correction[1])) fail(`${id}: correction references unknown or future requirement ${correction[1]}`);
      for (const field of ["**Change:**", "**Approval:**", "**Original retained:**"]) if (!body.includes(field)) fail(`${id}: correction missing ${field}`);
    }
    ids.add(id); sequences.set(prefix, expected);
  }
  return matches.length;
}

export function verifyHistory({ ci = false } = {}) {
  if (git("rev-parse", "--is-shallow-repository").trim() !== "false") fail("Git history is shallow; cannot verify first introduction or append-only history");
  const current = readFileSync(path, "utf8");
  const count = validateRegister(current);
  const commits = git("log", "--format=%H", "--reverse", "HEAD", "--", path).trim().split("\n").filter(Boolean);
  if (!commits.length) fail("Register has no committed introduction; historical integrity cannot be established");
  let prior = null;
  for (const commit of commits) {
    const revision = git("show", `${commit}:${path}`);
    validateRegister(revision);
    if (prior !== null && !revision.startsWith(prior)) fail(`Previously committed owner instruction changed at ${commit}; append a correction instead`);
    prior = revision;
  }
  const introduction = commits[0];
  const parents = git("rev-list", "--parents", "-n", "1", introduction).trim().split(" ").slice(1);
  for (const parent of parents) {
    // An introduction is only credible when the file was absent in every parent.
    if (git("ls-tree", "--name-only", parent, "--", path).trim()) fail(`Cannot establish first introduction: ${path} existed before ${introduction}`);
  }
  if (!current.startsWith(prior)) fail("Working tree modifies previously committed owner instructions; append a correction instead");
  if (ci && (current !== prior || git("status", "--porcelain=v1", "--", path).trim())) fail("CI requires all appended instructions to be committed in the candidate HEAD");
  return { count, introduction, revisions: commits.length, committed: current === prior };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyHistory({ ci: process.argv.includes("--ci") });
    console.log(`PASS: ${result.count} sequential requirements; ${result.revisions} committed revision(s); first introduction ${result.introduction}; working tree ${result.committed ? "committed" : "contains valid uncommitted append"}.`);
    console.log("LIMITATION: Git history cannot establish the authenticity or completeness of the owner's original instruction or approval.");
  } catch (error) { console.error(`FAIL: ${error instanceof Error ? error.message : "instruction integrity check failed"}`); process.exitCode = 1; }
}
