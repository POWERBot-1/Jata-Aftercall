#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

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

async function main() {
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
  const rows = matrix.phases?.[phase];
  const result = evaluateRows(rows);
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const currentSha = process.env.GITHUB_SHA;
  if (!token || !repository || !currentSha) {
    result.blockers.push("live GitHub evidence verification requires GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_SHA");
  } else {
    for (const row of rows || []) {
      if (row.status !== "PASS") continue;
      for (const item of row.evidence || []) {
        try {
          execFileSync("git", ["merge-base", "--is-ancestor", item.commitSha, currentSha], { stdio: "ignore" });
        } catch {
          result.blockers.push(`${row.id}: evidence commit is not an ancestor of this release candidate`);
          continue;
        }
        try {
          const response = await fetch(`https://api.github.com/repos/${repository}/actions/runs/${item.workflowRunId}`, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          });
          if (!response.ok) throw new Error(`GitHub Actions API returned HTTP ${response.status}`);
          const run = await response.json();
          if (run.head_sha !== item.commitSha || run.status !== "completed" || run.conclusion !== "success" ||
              (item.workflow && run.name !== item.workflow)) {
            result.blockers.push(`${row.id}: workflow run ${item.workflowRunId} is not a successful run for the recorded commit/workflow`);
          }
        } catch (error) {
          result.blockers.push(`${row.id}: could not independently verify workflow run ${item.workflowRunId}: ${error.message}`);
        }
      }
    }
  }
  if (result.blockers.length) {
    console.error(`NOT READY (${result.blockers.length}) — Website Studio ${phase.toUpperCase()}:`);
    for (const blocker of result.blockers) console.error(blocker);
    process.exit(1);
  }
  console.log(`PASS: Website Studio ${phase.toUpperCase()} acceptance matrix is independently evidenced.`);
}

if (process.argv[1]?.endsWith("check-website-studio-readiness.mjs")) main();
