#!/usr/bin/env node
// Validate the register's structure and, when the parent contains it, append-only history.
// The check cannot validate that a written owner instruction accurately represents its source.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const path = "docs/ADMIN_BUILDING_INSTRUCTIONS.md";
const text = readFileSync(path, "utf8");
const sections = [...text.matchAll(/^#{2,3} (\d{3}) — ([A-Z]+-\d{3}):[^\n]*\n([\s\S]*?)(?=^#{2,3} \d{3} — |^## Append-only update template|$(?![\s\S]))/gm)];
if (!sections.length) throw new Error("No numbered requirements found");
const ids = new Set();
for (let i = 0; i < sections.length; i++) {
  const [, number, id, body] = sections[i];
  if (Number(number) !== i + 1 || ids.has(id)) throw new Error(`Invalid order or duplicate ID: ${id}`);
  ids.add(id);
  for (const field of ["Date / approval / status", "Purpose / function", "Security/privacy / UX", "Affected", "Acceptance", "Dependencies", "Evidence", "commit"]) {
    if (!body.includes(field)) throw new Error(`${id} is missing ${field}`);
  }
  if (!/\b(PENDING|IN PROGRESS|BLOCKED|IMPLEMENTED|VERIFIED)\b/.test(body)) throw new Error(`${id} has no valid status`);
}
if (!text.includes("## FINTECH MOTION UI BUILDING INSTRUCTIONS")) throw new Error("Motion subsection missing");
let compared = 0;
for (const ref of ["HEAD", "HEAD^"]) {
  let prior;
  try { prior = execFileSync("git", ["show", `${ref}:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { continue; /* First introduction or shallow checkout. */ }
  compared++;
  if (!text.startsWith(prior)) throw new Error(`Previously committed instruction content at ${ref} was changed; append an update instead`);
}
console.log(`Register structure: ${sections.length} sequential requirements; append-only ${compared ? `PASS (${compared} available revisions)` : "NOT TESTED (no prior revision available)"}`);
