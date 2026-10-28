import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMigrationAuthorization,
  parseAuthorization,
} from "../ci/authorize-migration.mjs";

// The proposal in docs/RELEASE-GATE-PROPOSAL.md is only credible if its refusal
// paths are tested. This file is the test of the proposed authorizer; the
// authorizer is deliberately NOT wired into scripts/build.sh on this branch.

const SHA = "59962291ec82d5ddbc8f323e3d057d6a5b15cf02";
const OTHER = "2575cf461d33476a6bf8edb44fc56dc63498152a";

test("parses a well-formed authorization token", () => {
  assert.equal(parseAuthorization(`sha:${SHA}`), SHA);
  assert.equal(parseAuthorization(`  sha:${SHA.toUpperCase()}  `), SHA);
});

test("rejects malformed tokens", () => {
  assert.equal(parseAuthorization(SHA), null);
  assert.equal(parseAuthorization(`sha:${SHA.slice(0, 12)}`), null);
  assert.equal(parseAuthorization("sha:"), null);
  assert.equal(parseAuthorization(undefined), null);
});

test("ALLOWED only when a matching sha is authorized for production", () => {
  const decision = evaluateMigrationAuthorization({
    environment: "production",
    authorization: `sha:${SHA}`,
    buildSha: SHA,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, "ALLOWED");
});

test("an ordinary production build with no token is refused", () => {
  const decision = evaluateMigrationAuthorization({ environment: "production", authorization: undefined, buildSha: SHA });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "REFUSED_NO_AUTHORIZATION");
});

test("a token naming a different commit is refused", () => {
  const decision = evaluateMigrationAuthorization({ environment: "production", authorization: `sha:${OTHER}`, buildSha: SHA });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "REFUSED_SHA_MISMATCH");
});

test("a malformed token is refused, not ignored", () => {
  const decision = evaluateMigrationAuthorization({ environment: "production", authorization: "yes", buildSha: SHA });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "REFUSED_MALFORMED_AUTHORIZATION");
});

test("an unknown build SHA is refused even with a valid token", () => {
  const decision = evaluateMigrationAuthorization({ environment: "production", authorization: `sha:${SHA}`, buildSha: undefined });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "REFUSED_UNKNOWN_BUILD_SHA");
});

test("non-production environments are out of scope for this gate", () => {
  for (const environment of ["preview", "development", "test", undefined]) {
    const decision = evaluateMigrationAuthorization({ environment, authorization: `sha:${SHA}`, buildSha: SHA });
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "REFUSED_NOT_PRODUCTION");
  }
});
