#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";

export function evaluateRows(rows, fileExists = existsSync) {
  const blockers = [];
  if (!Array.isArray(rows) || rows.length === 0) return { blockers: ["phase has no acceptance rows"] };
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || seen.has(row.id)) {
      blockers.push("missing or duplicate requirement id");
      continue;
    }
    seen.add(row.id);
    if (!["PASS", "FAIL", "BLOCKED", "NOT TESTED"].includes(row.status)) {
      blockers.push(`${row.id}: invalid status`);
      continue;
    }
    const deferred = row.status === "NOT TESTED" &&
      row.scopeDecision === "DEFERRED" &&
      ["low", "medium"].includes(row.severity) &&
      typeof row.deferredReason === "string" && row.deferredReason.trim().length > 0;
    if (deferred) continue;
    if (row.status !== "PASS") {
      blockers.push(`${row.id}: ${row.status}${row.reason ? ` — ${row.reason}` : ""}`);
      continue;
    }
    if (!Array.isArray(row.implementation) || row.implementation.length === 0 ||
        !row.implementation.every((path) => typeof path === "string" && fileExists(path))) {
      blockers.push(`${row.id}: PASS lacks existing implementation paths`);
    }
    if (typeof row.acceptanceTest !== "string" || !fileExists(row.acceptanceTest)) {
      blockers.push(`${row.id}: PASS lacks an existing acceptance test`);
    }
    const evidence = row.evidence;
    if (!Array.isArray(evidence) || evidence.length === 0 ||
        !evidence.every((item) => Number.isSafeInteger(item.workflowRunId) &&
          /^[a-f0-9]{40}$/i.test(item.commitSha || "") &&
          typeof item.workflow === "string" && item.workflow.trim().length > 0)) {
      blockers.push(`${row.id}: PASS lacks traceable workflow-run and commit evidence`);
    }
  }
  return { blockers };
}

function main() {
  const phaseArg = process.argv.find((arg) => arg.startsWith("--phase="));
  const phase = phaseArg?.slice("--phase=".length);
  if (!["p1", "p2"].includes(phase)) {
    console.error("BLOCKED: expected --phase=p1 or --phase=p2");
    process.exit(2);
  }
  let matrix;
  try {
    matrix = JSON.parse(readFileSync("docs/WEBSITE_STUDIO_2_0_RELEASE_ACCEPTANCE.json", "utf8"));
  } catch (error) {
    console.error(`BLOCKED: cannot read Website Studio acceptance matrix: ${error.message}`);
    process.exit(2);
  }
  const result = evaluateRows(matrix.phases?.[phase]);
  if (result.blockers.length) {
    console.error(`NOT READY (${result.blockers.length}) — Website Studio ${phase.toUpperCase()}:`);
    for (const blocker of result.blockers) console.error(blocker);
    process.exit(1);
  }
  console.log(`PASS: Website Studio ${phase.toUpperCase()} acceptance matrix is evidenced.`);
}

if (process.argv[1]?.endsWith("check-website-studio-readiness.mjs")) main();
