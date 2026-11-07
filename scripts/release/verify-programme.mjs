#!/usr/bin/env node
/**
 * Independent canonical-programme inventory guard.
 *
 * The owner directive requires preservation of 45 canonical requirements. This check does not
 * create, rename, delete, or reclassify requirements. It compares the source register and its
 * evidence manifest exactly, then delegates PASS/evidence-path validation to the existing
 * fail-closed checker. Any inventory mismatch is a release blocker.
 */
import { readFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { checkProgramme } from "../admin/check-programme-readiness.mjs";

export const EXPECTED_CANONICAL_REQUIREMENTS = 45;
const REGISTER_PATH = "docs/ADMIN_BUILDING_INSTRUCTIONS.md";
const MANIFEST_PATH = "docs/agents/PROGRAMME_READINESS.json";
const ID_PATTERN = /^#{2,3} \\d{3} — ([A-Z]+-\\d{3}):/gm;
const ALLOWED_STATES = new Set(["PASS", "FAIL", "BLOCKED", "NOT_TESTED", "NOT_APPLICABLE"]);

export function inspectProgramme(register, records, root = process.cwd()) {
  const ids = [...register.matchAll(ID_PATTERN)].map((match) => match[1]);
  const errors = [];
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) errors.push(`Duplicate canonical IDs: ${[...new Set(duplicates)].join(", ")}`);
  if (ids.length !== EXPECTED_CANONICAL_REQUIREMENTS) {
    errors.push(`Canonical inventory mismatch: expected ${EXPECTED_CANONICAL_REQUIREMENTS}, found ${ids.length}. Restore the original canonical register; do not invent or silently omit requirements.`);
  }
  if (!records || typeof records !== "object" || Array.isArray(records)) {
    errors.push("Readiness manifest is not an object");
    return { ids, errors, counts: {} };
  }
  const registerSet = new Set(ids);
  const recordIds = Object.keys(records);
  for (const id of recordIds) if (!registerSet.has(id)) errors.push(`Manifest contains non-canonical requirement: ${id}`);
  for (const id of ids) if (!Object.hasOwn(records, id)) errors.push(`Missing readiness record: ${id}`);
  const counts = {};
  for (const [id, row] of Object.entries(records)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) { errors.push(`${id}: invalid readiness row`); continue; }
    if (!ALLOWED_STATES.has(row.status)) { errors.push(`${id}: invalid state ${String(row.status)}`); continue; }
    counts[row.status] = (counts[row.status] || 0) + 1;
    if (row.status !== "PASS") continue;
    if (!Array.isArray(row.evidence) || row.evidence.length === 0) { errors.push(`${id}: PASS has no evidence paths`); continue; }
    for (const file of row.evidence) {
      if (typeof file !== "string" || !file || file.startsWith("/")) { errors.push(`${id}: invalid evidence path`); continue; }
      const absolute = resolve(root, file);
      if (relative(root, absolute).startsWith("..") || !existsSync(absolute)) { errors.push(`${id}: evidence unavailable: ${file}`); continue; }
      const real = realpathSync(absolute);
      if (relative(realpathSync(root), real).startsWith("..") || !statSync(real).isFile() || statSync(real).size === 0) {
        errors.push(`${id}: evidence is not a non-empty repository file: ${file}`);
      }
    }
  }
  return { ids, errors, counts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const register = readFileSync(REGISTER_PATH, "utf8");
    const records = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    const inventory = inspectProgramme(register, records);
    const acceptanceErrors = checkProgramme(register, records);
    const errors = [...inventory.errors, ...acceptanceErrors];
    console.log(JSON.stringify({
      expectedCanonicalRequirements: EXPECTED_CANONICAL_REQUIREMENTS,
      actualCanonicalRequirements: inventory.ids.length,
      readinessCounts: inventory.counts,
      status: errors.length ? "NOT_READY" : "PASS",
      errors,
    }, null, 2));
    if (errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(`NOT READY: ${error instanceof Error ? error.message : "programme verification failed"}`);
    process.exitCode = 1;
  }
}
