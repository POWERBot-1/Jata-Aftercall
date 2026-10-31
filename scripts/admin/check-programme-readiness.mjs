#!/usr/bin/env node
// Fail-closed release gate. This checks recorded evidence references, not their truth or owner approval.
import { readFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { validateRegister } from "./check-building-instructions.mjs";

export function checkProgramme(register, records, root = process.cwd()) {
  validateRegister(register);
  const ids = [...register.matchAll(/^#{2,3} \d{3} — ([A-Z]+-\d{3}):/gm)].map((m) => m[1]);
  const errors = [];
  if (!records || typeof records !== "object" || Array.isArray(records)) return ["Invalid readiness evidence manifest"];
  for (const id of Object.keys(records)) if (!ids.includes(id)) errors.push(`${id}: unknown requirement`);
  for (const id of ids) {
    const row = records[id];
    if (!row || typeof row !== "object") { errors.push(`${id}: missing readiness record`); continue; }
    if (row.status !== "PASS") { errors.push(`${id}: ${row.status || "missing status"}`); continue; }
    if (typeof row.acceptance !== "string" || row.acceptance.trim().length < 20) errors.push(`${id}: missing acceptance description`);
    if (!Array.isArray(row.evidence) || !row.evidence.length) { errors.push(`${id}: missing evidence`); continue; }
    for (const file of row.evidence) {
      if (typeof file !== "string" || !file || file.startsWith("/")) { errors.push(`${id}: invalid evidence path`); continue; }
      const absolute = resolve(root, file); const rel = relative(root, absolute);
      if (rel.startsWith("..") || !existsSync(absolute)) { errors.push(`${id}: evidence unavailable: ${file}`); continue; }
      const real = realpathSync(absolute);
      if (relative(realpathSync(root), real).startsWith("..") || !statSync(real).isFile() || statSync(real).size === 0) errors.push(`${id}: invalid evidence file: ${file}`);
    }
  }
  return errors;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const errors = checkProgramme(readFileSync("docs/ADMIN_BUILDING_INSTRUCTIONS.md", "utf8"), JSON.parse(readFileSync("docs/agents/PROGRAMME_READINESS.json", "utf8")));
    if (errors.length) { console.error(`NOT READY (${errors.length}):\n${errors.join("\n")}`); process.exitCode = 1; }
    else console.log("PASS: all requirements have recorded acceptance evidence; independent review remains mandatory.");
  } catch (error) { console.error(`NOT READY: ${error.message}`); process.exitCode = 1; }
}
