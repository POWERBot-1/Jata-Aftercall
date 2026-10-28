/**
 * `next-env.d.ts` must stay in the shape `next build` writes.
 *
 * Regression for a real release-gate failure (2026-10-28): the file is tracked, and Next rewrites
 * it on every compile with a path that depends on the mode —
 *
 *   next dev    →  import "./.next/dev/types/routes.d.ts";
 *   next build  →  import "./.next/types/routes.d.ts";
 *
 * A local dev-server run rewrote it, the rewrite was committed, and the candidate rehearsal then
 * failed its clean-tree assertion ("tracked files were modified by the run") because its own
 * `next build` put the build-mode path back. That failure was correct: the committed artefact was
 * dev-server output, not a build artefact.
 *
 * This guard reads the committed file, so a dev-generated version cannot be committed again.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const nextEnv = readFileSync(path.join(root, "next-env.d.ts"), "utf8");

describe("next-env.d.ts is build-mode output", () => {
  it("never references the dev-server type directory", () => {
    // `.next/dev/...` only exists while `next dev` runs; a build gate that runs `next build`
    // immediately rewrites these lines, which dirties a tracked file in a clean checkout.
    expect(nextEnv).not.toContain(".next/dev/");
  });

  it("references the build-mode type directories", () => {
    expect(nextEnv).toContain('import "./.next/types/routes.d.ts";');
    expect(nextEnv).toContain('import "./.next/types/root-params.d.ts";');
  });

  it("keeps Next's generated header and keeps the file otherwise untouched", () => {
    expect(nextEnv).toContain('/// <reference types="next" />');
    expect(nextEnv).toContain('/// <reference types="next/image-types/global" />');
    expect(nextEnv).toContain("// NOTE: This file should not be edited");
  });
});
