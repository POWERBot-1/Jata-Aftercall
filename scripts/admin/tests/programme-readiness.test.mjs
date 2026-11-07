import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkProgramme } from "../check-programme-readiness.mjs";
const register = readFileSync("docs/ADMIN_BUILDING_INSTRUCTIONS.md", "utf8");
const ids = [...register.matchAll(/^#{2,3} \d{3} — ([A-Z]+-\d{3}):/gm)].map((m) => m[1]);
const valid = () => Object.fromEntries(ids.map((id) => [id, { status: "PASS", acceptance: "Independently reviewed acceptance evidence", evidence: ["docs/ADMIN_BUILDING_INSTRUCTIONS.md"] }]));
test("requires every ID, a PASS status, acceptance and existing evidence", () => {
  assert.deepEqual(checkProgramme(register, valid()), []);
  const missing = valid(); delete missing[ids[0]]; assert.match(checkProgramme(register, missing).join(" "), /missing readiness record/);
  const blocked = valid(); blocked[ids[0]].status = "BLOCKED"; assert.match(checkProgramme(register, blocked).join(" "), /BLOCKED/);
  const untested = valid(); untested[ids[0]].status = "NOT_TESTED"; assert.match(checkProgramme(register, untested).join(" "), /NOT_TESTED/);
  const missingAcceptance = valid(); missingAcceptance[ids[0]].acceptance = ""; assert.match(checkProgramme(register, missingAcceptance).join(" "), /missing acceptance description/);
  const shortAcceptance = valid(); shortAcceptance[ids[0]].acceptance = "too short"; assert.match(checkProgramme(register, shortAcceptance).join(" "), /missing acceptance description/);
  const evidence = valid(); evidence[ids[0]].evidence = ["../outside"]; assert.match(checkProgramme(register, evidence).join(" "), /evidence unavailable/);
  const absentFile = valid(); absentFile[ids[0]].evidence = ["docs/audits/evidence-that-does-not-exist.md"]; assert.match(checkProgramme(register, absentFile).join(" "), /evidence unavailable/);
  const empty = valid(); empty[ids[0]].evidence = []; assert.match(checkProgramme(register, empty).join(" "), /missing evidence/);
  const unknown = valid(); unknown["ADMIN-999"] = {}; assert.match(checkProgramme(register, unknown).join(" "), /unknown requirement/);
});

test("accepts the RELEASE-002 security-boundary field without weakening other entries", () => {
  assert.deepEqual(checkProgramme(register, valid()), []);
  const altered = register.replace("**Security / operational boundaries:**", "**Other:**");
  assert.throws(() => {
    // checkProgramme validates the register before considering evidence rows.
    checkProgramme(altered, valid());
  }, /RELEASE-002: missing required field Security\/privacy \/ UX/);
});
