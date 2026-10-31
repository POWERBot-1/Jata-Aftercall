import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const baseline = readFileSync("docs/ADMIN_BUILDING_INSTRUCTIONS.md", "utf8");
const source = path.resolve("scripts/admin/check-building-instructions.mjs");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "instruction-guard-"));
  mkdirSync(path.join(dir, "docs"), { recursive: true }); mkdirSync(path.join(dir, "scripts/admin"), { recursive: true });
  writeFileSync(path.join(dir, "docs/ADMIN_BUILDING_INSTRUCTIONS.md"), baseline); copyFileSync(source, path.join(dir, "scripts/admin/check-building-instructions.mjs"));
  git(dir, "init", "-q"); git(dir, "config", "user.name", "Fixture"); git(dir, "config", "user.email", "fixture@example.invalid");
  git(dir, "add", "."); git(dir, "commit", "-qm", "introduce");
  return { dir, doc: path.join(dir, "docs/ADMIN_BUILDING_INSTRUCTIONS.md"), check: () => spawnSync(process.execPath, ["scripts/admin/check-building-instructions.mjs", "--ci"], { cwd: dir, encoding: "utf8" }), commit: () => { git(dir, "add", "."); git(dir, "commit", "-qm", "update"); }, clean: () => rmSync(dir, { recursive: true, force: true }) };
}
const nextNumber = String([...baseline.matchAll(/^#{2,3} (\d{3}) — /gm)].length + 1).padStart(3, "0");
const nextAdmin = String(Math.max(...[...baseline.matchAll(/^#{2,3} \d{3} — ADMIN-(\d{3}):/gm)].map((m) => Number(m[1]))) + 1).padStart(3, "0");
const section = (id = `ADMIN-${nextAdmin}`, number = nextNumber, correction = "") => `\n## ${number} — ${id}: Fixture\n- **Date / approval / status:** 2026-10-31; approved; PENDING.\n- **Owner instruction:** Fixture.\n- **Purpose / function:** Fixture.\n- **Security/privacy / UX:** Fixture.\n- **Affected:** Fixture.\n- **Acceptance:** Fixture. **Dependencies:** Fixture. **Evidence/commit:** Fixture.\n${correction}`;

test("first introduction is verified and a committed append is accepted", () => {
  const f = fixture(); try { let r = f.check(); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /first introduction [a-f0-9]{40}/); appendFileSync(f.doc, section()); f.commit(); r = f.check(); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, new RegExp(`${Number(nextNumber)} sequential requirements`)); } finally { f.clean(); }
});
test("rejects uncommitted additions, original edits, duplicate IDs and skipped sequences", () => {
  const f = fixture(); try {
    appendFileSync(f.doc, section()); assert.notEqual(f.check().status, 0); writeFileSync(f.doc, baseline.replace("authoritative owner specification", "rewritten specification")); assert.notEqual(f.check().status, 0);
    writeFileSync(f.doc, baseline + section("ADMIN-001")); f.commit(); assert.notEqual(f.check().status, 0);
  } finally { f.clean(); }
  const g = fixture(); try { appendFileSync(g.doc, section(`ADMIN-${String(Number(nextAdmin) + 1).padStart(3, "0")}`)); g.commit(); assert.notEqual(g.check().status, 0); } finally { g.clean(); }
});
test("rejects rewritten historical commits even if later text is restored", () => {
  const f = fixture(); try { writeFileSync(f.doc, baseline.replace("authoritative owner specification", "rewritten specification")); f.commit(); writeFileSync(f.doc, baseline + section()); f.commit(); const r = f.check(); assert.notEqual(r.status, 0); assert.match(r.stderr, /Previously committed owner instruction changed/); } finally { f.clean(); }
});
test("requires an earlier correction target and explicit correction metadata", () => {
  const f = fixture(); try { appendFileSync(f.doc, section(`ADMIN-${nextAdmin}`, nextNumber, "**Correction of:** ADMIN-099\n**Change:** x\n**Approval:** owner\n**Original retained:** yes\n")); f.commit(); const r = f.check(); assert.notEqual(r.status, 0); assert.match(r.stderr, /unknown or future/); } finally { f.clean(); }
  const g = fixture(); try { appendFileSync(g.doc, section(`ADMIN-${nextAdmin}`, nextNumber, "**Correction of:** ADMIN-001\n**Change:** clarify\n**Approval:** owner\n**Original retained:** yes\n")); g.commit(); assert.equal(g.check().status, 0); } finally { g.clean(); }
  const h = fixture(); try { appendFileSync(h.doc, section(`ADMIN-${nextAdmin}`, nextNumber, "**Correction of:** ADMIN-001\n")); h.commit(); assert.match(h.check().stderr, /correction missing/); } finally { h.clean(); }
});
test("fails closed in a shallow clone", () => {
  const f = fixture(); const copy = `${f.dir}-shallow`; try { appendFileSync(f.doc, section()); f.commit(); git(tmpdir(), "clone", "-q", "--depth=1", `file://${f.dir}`, copy); const r = spawnSync(process.execPath, ["scripts/admin/check-building-instructions.mjs", "--ci"], { cwd: copy, encoding: "utf8" }); assert.notEqual(r.status, 0); assert.match(r.stderr, /shallow/); } finally { f.clean(); rmSync(copy, { recursive: true, force: true }); }
});
test("rejects missing fields, malformed numbered headings and corrections that rewrite earlier text", () => {
  const f = fixture(); try { appendFileSync(f.doc, section().replace("**Security/privacy / UX:**", "**Other:**")); f.commit(); assert.match(f.check().stderr, /missing required field Security/); } finally { f.clean(); }
  const g = fixture(); try { appendFileSync(g.doc, `\n## ${nextNumber} - ADMIN-${nextAdmin}: malformed\n`); g.commit(); assert.match(g.check().stderr, /Malformed numbered requirement heading/); } finally { g.clean(); }
  const h = fixture(); try {
    writeFileSync(h.doc, baseline.replace("authoritative owner specification", "rewritten specification") + section(`ADMIN-${nextAdmin}`, nextNumber, "**Correction of:** ADMIN-001\n**Change:** x\n**Approval:** owner\n**Original retained:** yes\n"));
    h.commit(); assert.match(h.check().stderr, /Previously committed owner instruction changed/);
  } finally { h.clean(); }
});
