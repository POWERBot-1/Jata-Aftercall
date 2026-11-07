import test from "node:test";
import assert from "node:assert/strict";
import { EXPECTED_CANONICAL_REQUIREMENTS, inspectProgramme } from "../verify-programme.mjs";

function fixture(count = EXPECTED_CANONICAL_REQUIREMENTS) {
  const ids = Array.from({ length: count }, (_, index) => `REQ-${String(index + 1).padStart(3, "0")}`);
  const register = ids.map((id, index) => `### ${String(index + 1).padStart(3, "0")} — ${id}: Requirement ${index + 1}`).join("\n");
  const records = Object.fromEntries(ids.map((id) => [id, { status: "NOT_TESTED" }]));
  return { register, records };
}

test("accepts an exact 45-entry inventory without promoting readiness states", () => {
  const { register, records } = fixture();
  const result = inspectProgramme(register, records);
  assert.equal(result.ids.length, 45);
  assert.deepEqual(result.errors, []);
  assert.equal(result.counts.NOT_TESTED, 45);
});

test("blocks a shortened canonical inventory instead of inventing missing requirements", () => {
  const { register, records } = fixture(43);
  const result = inspectProgramme(register, records);
  assert.ok(result.errors.some((error) => error.includes("expected 45, found 43")));
});

test("blocks duplicate canonical IDs", () => {
  const { register, records } = fixture();
  const duplicated = register.replace("REQ-045", "REQ-044");
  const result = inspectProgramme(duplicated, records);
  assert.ok(result.errors.some((error) => error.includes("Duplicate canonical IDs")));
});
