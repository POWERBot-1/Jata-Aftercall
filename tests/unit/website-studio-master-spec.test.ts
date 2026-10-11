import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { animate } from "motion/mini";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Website Studio master directive preservation", () => {
  it("retains the entire original specification, not a summary or a placeholder", () => {
    // Change this only for an explicit owner revision to the requirement source, not to hide lost content.
    expect(createHash("sha256").update(read("docs/WEBSITE_STUDIO_MASTER_SPECIFICATION.md")).digest("hex"))
      .toBe("3bae22f5e38e37b4b429cfc672818544a793457b6ac159de2cfd652429838e42");
  });

  it("preserves all 0–107 sections and tracks each independently in the release plan", () => {
    const headings = [...read("docs/WEBSITE_STUDIO_MASTER_SPECIFICATION.md").matchAll(/^(\d+)\. (.+)$/gm)]
      .filter((match) => match[2] === match[2].toUpperCase())
      .map((match) => Number(match[1]));
    const register = [...read("docs/WEBSITE_STUDIO_RELEASE_PLAN.md").matchAll(/^\| (\d+) \|/gm)]
      .map((match) => Number(match[1]));
    const all = Array.from({ length: 108 }, (_, index) => index);
    expect(headings).toEqual(all);
    expect(register).toEqual(all);
  });

  it("retains the complete execution directive and the original truncated caution without invention", () => {
    const source = read("docs/WEBSITE_STUDIO_MASTER_SPECIFICATION.md");
    const directive = source.slice(source.lastIndexOf("\nEXECUTION DIRECTIVE\n"));
    expect(directive).toContain("Phase 7 → Performance/Adaptive Intelligence");
    expect(directive).toContain("Do not allow tenant leakage.");
    expect(directive).toContain("RUN THE FULL TEST SUITE → BUILD → VERIFY → COMMIT → PUSH TO GITHUB.");
    expect(directive.trim()).toMatch(/CAUTION!!! GENER\n```$/);
  });

  it("has a resolvable motion/mini implementation and a matching npm lock entry on the existing stack", () => {
    const pkg = JSON.parse(read("package.json"));
    const lock = JSON.parse(read("package-lock.json"));
    expect(typeof animate).toBe("function");
    expect(pkg.dependencies.motion).toBeTruthy();
    expect(lock.packages[""].dependencies.motion).toBe(pkg.dependencies.motion);
    expect(lock.packages["node_modules/motion"].version).toBe("14.1.0");
    expect(pkg.dependencies.next).toBe("15.5.26");
    expect(pkg.dependencies.react).toBe("18.3.1");
  });
});
