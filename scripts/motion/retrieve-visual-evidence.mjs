#!/usr/bin/env node
/**
 * Retrieve six-viewport motion screenshots without the artifact blob host.
 *
 * WHY: this review environment cannot reach
 * `productionresultssa*.blob.core.windows.net`, so `gh run download` fails. Check
 * annotations are reachable through the API, and `scripts/motion/disposable-browser-evidence.mjs`
 * publishes its viewport thumbnails there.
 *
 * This script does NOT say the screenshots look right — it only materialises them and
 * refuses anything that is not a whole JPEG, so a truncated publication is reported as
 * a failure instead of being saved as a corrupt file.
 *
 * USAGE
 *   node scripts/motion/retrieve-visual-evidence.mjs <check-run-id> [--out DIR]
 *
 * EXIT CODES
 *   0  every viewport present and a complete JPEG
 *   1  a viewport was missing, or a stream was truncated / not a JPEG
 *   2  blocked: no run id, or the annotations could not be fetched
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { VIEWPORT_ORDER, decodeVisualAnnotations, groupVisualAnnotations } from "./visual-annotation.mjs";

const runId = process.argv[2];
if (!runId || !/^\d+$/.test(runId)) {
  console.error("BLOCKED: pass a numeric check-run id. Usage: node scripts/motion/retrieve-visual-evidence.mjs <check-run-id> [--out DIR]");
  process.exit(2);
}
const outIndex = process.argv.indexOf("--out");
const out = outIndex > 0 ? process.argv[outIndex + 1] : "motion-visual-evidence";

const repo = process.env.GITHUB_REPOSITORY || "POWERBot-1/Jata-Aftercall";
let annotations;
try {
  annotations = JSON.parse(execFileSync("gh", [
    "api", `repos/${repo}/check-runs/${runId}/annotations`, "--paginate",
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
} catch (error) {
  console.error(`BLOCKED: annotations for check run ${runId} could not be fetched: ${String(error.message).slice(0, 400)}`);
  process.exit(2);
}

const groups = groupVisualAnnotations(annotations);
if (!groups.length) {
  console.error(`BLOCKED: check run ${runId} carries no MOTION_VISUAL_* annotations.`);
  console.error("        The workflow at that commit either predates the per-viewport publisher or did not reach capture.");
  process.exit(2);
}

mkdirSync(out, { recursive: true });
let failures = 0;
let retrieved = 0;
for (const group of groups) {
  if (group.missing.length) {
    console.error(`FAIL ${group.viewport}: parts ${group.missing.join(", ")} of ${group.total} were never published (annotation cap truncation)`);
    failures += 1;
    continue;
  }
  const decoded = decodeVisualAnnotations(group.parts);
  if (!decoded.ok) {
    console.error(`FAIL ${group.viewport}: ${decoded.reason}`);
    failures += 1;
    continue;
  }
  const file = path.join(out, `${group.viewport}.jpg`);
  writeFileSync(file, decoded.bytes);
  retrieved += 1;
  console.log(`PASS ${group.viewport}: ${group.parts.length} part(s), ${decoded.bytes.length} bytes, complete JPEG -> ${file}`);
}

const seen = groups.map((group) => group.viewport);
const absent = VIEWPORT_ORDER.filter((viewport) => !seen.includes(viewport));
if (absent.length) {
  console.error(`FAIL: no annotation was published for ${absent.join(", ")}`);
  failures += absent.length;
}
console.log(`\n${retrieved}/${VIEWPORT_ORDER.length} mandated viewports retrieved as whole images.`);
console.log("Retrieving pixels does not accept a requirement: an independent reviewer must still inspect them.");
process.exit(failures ? 1 : 0);
