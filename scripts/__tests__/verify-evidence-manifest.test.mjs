import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashFile, parseManifest, verifyManifest } from "../ci/verify-evidence-manifest.mjs";

// A manifest is only worth having if it fails when it is wrong. Each test here
// breaks one property and asserts that the break is reported.

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "jata-manifest-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "a.md"), "alpha\n");
  writeFileSync(join(root, "docs", "b.md"), "beta\n");
  return root;
}

const line = (path, content) => `${hashFile(path)}  ${content}`;

test("a correct manifest verifies", () => {
  const root = fixture();
  try {
    const entries = [
      { hash: hashFile(join(root, "docs/a.md")), path: "docs/a.md" },
      { hash: hashFile(join(root, "docs/b.md")), path: "docs/b.md" },
    ];
    const { failed } = verifyManifest(entries, { root, required: ["docs/a.md", "docs/b.md"] });
    assert.deepEqual(failed, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a changed file is a MISMATCH, not a pass", () => {
  const root = fixture();
  try {
    const stale = { hash: hashFile(join(root, "docs/a.md")), path: "docs/a.md" };
    writeFileSync(join(root, "docs/a.md"), "alpha but edited\n");
    const { failed } = verifyManifest([stale], { root, required: [] });
    assert.equal(failed.length, 1);
    assert.equal(failed[0].status, "MISMATCH");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing file is reported, not skipped", () => {
  const root = fixture();
  try {
    const { failed } = verifyManifest([{ hash: "0".repeat(64), path: "docs/gone.md" }], { root, required: [] });
    assert.equal(failed.length, 1);
    assert.equal(failed[0].status, "MISSING");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a required artifact absent from the manifest is reported", () => {
  const root = fixture();
  try {
    const entries = [{ hash: hashFile(join(root, "docs/a.md")), path: "docs/a.md" }];
    const { failed } = verifyManifest(entries, { root, required: ["docs/a.md", "docs/b.md"] });
    assert.equal(failed.length, 1);
    assert.equal(failed[0].status, "NOT_LISTED");
    assert.equal(failed[0].path, "docs/b.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a manifest that lists itself is rejected — the self-reference problem", () => {
  const root = fixture();
  try {
    const manifestPath = "docs/MANIFEST.sha256";
    writeFileSync(join(root, manifestPath), "placeholder\n");
    const entries = [
      { hash: hashFile(join(root, "docs/a.md")), path: "docs/a.md" },
      { hash: hashFile(join(root, manifestPath)), path: manifestPath },
    ];
    const { failed } = verifyManifest(entries, { root, manifestPath, required: [] });
    assert.ok(failed.some((result) => result.status === "SELF_REFERENCE"), JSON.stringify(failed));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a duplicate entry is reported rather than silently deduplicated", () => {
  const root = fixture();
  try {
    const entry = { hash: hashFile(join(root, "docs/a.md")), path: "docs/a.md" };
    const { failed } = verifyManifest([entry, entry], { root, required: [] });
    assert.equal(failed.filter((result) => result.status === "DUPLICATE").length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parsing follows sha256sum format and rejects malformed lines", () => {
  const good = `${"a".repeat(64)}  docs/a.md\n${"b".repeat(64)} *docs/b.md\n# a comment\n\n`;
  const parsed = parseManifest(good);
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.entries.length, 2, "comments and blank lines are skipped");
  assert.equal(parsed.entries[1].path, "*docs/b.md", "binary marker is preserved verbatim");

  const bad = parseManifest("not a hash  docs/a.md\n");
  assert.equal(bad.entries.length, 0);
  assert.equal(bad.problems.length, 1);
});

test("an unreadable file is null, not an empty hash", () => {
  assert.equal(hashFile("/definitely/not/here.txt"), null);
});

test("the repository's own manifest verifies", async () => {
  // The one test that matters in CI: if a report is edited without the manifest
  // being regenerated, this fails.
  const { readFileSync, existsSync } = await import("node:fs");
  const path = "docs/release/EVIDENCE-MANIFEST.sha256";
  if (!existsSync(path)) {
    // During the commit that introduces the manifest the file may not exist yet.
    return;
  }
  const { entries, problems } = parseManifest(readFileSync(path, "utf8"));
  assert.deepEqual(problems, []);
  const { failed } = verifyManifest(entries, { root: process.cwd(), manifestPath: path });
  assert.deepEqual(failed, [], JSON.stringify(failed, null, 2));
});
