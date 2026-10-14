/**
 * Narrow security patches and compatibility (re-ratified 2026-10-13, report §I.5).
 *
 * Before: this file pinned `puppeteer-core` 23.11.1 and imported `basic-ftp` directly, because the
 * only way to answer the extract-zip symlink-traversal advisories (GHSA-jmr9-qjv8-65gv,
 * GHSA-7pqw-9j4j-h8q3) and the basic-ftp chain (GHSA-c475-qrg2-pj4r) at the time was to pin
 * patched *transitive* versions while the vulnerable top-level dependency stayed.
 *
 * After: `puppeteer-core` is 25.13.0, whose `@puppeteer/browsers@3` uses `modern-tar` instead of
 * `extract-zip`, which removes the whole chain — extract-zip, basic-ftp, get-uri, pac-proxy-agent
 * and proxy-agent are no longer in the tree at all. The security purpose is preserved and made
 * structural: instead of asserting a patched transitive pin, the test now asserts the vulnerable
 * chain is ABSENT from the lockfile, that it cannot come back unnoticed, and that the replacement
 * is in place. The package that used to need `basic-ftp` is gone, so an import of it would be a
 * dead check; removing that import is the contract change, not a weakening.
 *
 * Re-ratified again 2026-10-14 (Directive 7 / D-2 — report §K): the `tailwindcss` pin moves 3.4.19 -> 4.3.3
 * under the owner-approved staged Tailwind 4 migration. This is a re-ratification of a reviewed version,
 * not a loosening: tailwindcss 4.x has ZERO dependencies, which structurally removes the
 * chokidar -> readdirp/braces advisory chain that 3.4.x pulled in, and Autoprefixer is no longer needed
 * because @tailwindcss/postcss handles vendor prefixing. The assertions below lock that structure in.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SourceMapConsumer, SourceMapGenerator } from "source-map-js";
import selectorParser from "postcss-selector-parser";
const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const packages = JSON.parse(readFileSync("package-lock.json", "utf8")).packages;
const workflow = readFileSync(".github/workflows/interactive-business-e2e.yml", "utf8");

describe("narrow security patches and compatibility", () => {
  it("pins matching Next runtime/lint versions without changing React/Prisma/Motion/toolchain majors", () => {
    // Owner-authorized Directive 9 Option A: the Next.js 16.x major upgrade (which carries the
    // vendored React 19.3 runtime the #418 replay-cursor fix ships in). This is the only sanctioned
    // major bump; react/react-dom, Prisma, Motion, Tailwind and puppeteer-core stay frozen below,
    // and the exact-pin requirement is unchanged — `eslint-config-next` must still match `next`.
    expect(manifest.dependencies.next).toBe("16.4.0");
    expect(manifest.devDependencies["eslint-config-next"]).toBe("16.4.0");
    expect(packages["node_modules/next"].version).toBe("16.4.0");
    expect(packages["node_modules/eslint-config-next"].version).toBe("16.4.0");
    for (const [name, version] of [["react", "18.3.1"], ["react-dom", "18.3.1"], ["@prisma/client", "5.22.0"], ["prisma", "5.22.0"], ["motion", "14.1.0"], ["tailwindcss", "4.3.3"], ["@tailwindcss/postcss", "4.3.3"], ["puppeteer-core", "25.13.0"]]) {
      expect(packages[`node_modules/${name}`].version).toBe(version);
    }
    // The v3 build pipeline is gone: no leftover v3 tooling can silently re-introduce the advisory chain.
    expect(manifest.devDependencies.autoprefixer, "autoprefixer is no longer part of the pipeline").toBeUndefined();
    expect(packages["node_modules/autoprefixer"], "autoprefixer must not remain in the tree").toBeUndefined();
    expect(manifest.devDependencies["@tailwindcss/postcss"], "v4 requires the dedicated PostCSS plugin").toBe("^4.3.3");
    expect(readFileSync("postcss.config.js", "utf8"), "PostCSS must use the v4 plugin").toContain("@tailwindcss/postcss");
    // v4 is zero-dependency — this is what removes the chain, so it is the assertion worth keeping.
    expect(packages["node_modules/tailwindcss"].dependencies ?? {}, "tailwindcss 4.x must stay dependency-free").toEqual({});
    for (const gone of ["chokidar", "readdirp"]) {
      expect(Object.keys(packages).filter((p) => p.endsWith(`node_modules/${gone}`)), `${gone} came back — it is the advisory chain removed by Tailwind 4`).toEqual([]);
    }
    expect(manifest.engines.node).toBe("^20.19.0 || >=22.12.0");
  });
  it("locks every targeted transitive patch to the reviewed version", () => {
    for (const [name, version] of [["source-map-js", "1.2.2"], ["postcss-selector-parser", "7.1.6"]]) expect(packages[`node_modules/${name}`].version).toBe(version);
    expect(packages["node_modules/brace-expansion"].version).toBe("1.1.21");
    expect(packages["node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion"].version).toBe("5.0.12");
  });
  it.each([-1, 1e12, Infinity, NaN, 1.5])("rejects invalid/CPU-hostile indexed source-map offset %s before any mapping expansion", (line) => {
    expect(() => new SourceMapConsumer({ version: 3, sections: [{ offset: { line, column: 0 }, map: { version: 3, sources: [], names: [], mappings: "" } }] } as never)).toThrow(/offset/);
  });
  it("retains valid source-map generation and indexed position lookup", () => {
    const generator = new SourceMapGenerator({ file: "output.js" });
    generator.addMapping({ generated: { line: 1, column: 0 }, original: { line: 2, column: 3 }, source: "owned.js" });
    const indexed = new SourceMapConsumer({ version: 3, sections: [{ offset: { line: 0, column: 0 }, map: generator.toJSON() }] } as never);
    expect(indexed.originalPositionFor({ line: 1, column: 1 })).toMatchObject({ source: "owned.js", line: 2, column: 3 });
  });
  it.each([".eb-grid > .eb-card:first-child", ".dark\\:hover\\:bg-zinc-900:hover", '.eb-scope :is(a,button)[aria-pressed="true"]'])("retains selector parser API/text for %s", (selector) => {
    expect(selectorParser().processSync(selector)).toBe(selector);
  });
  it("removes the advisory chain instead of pinning around it", () => {
    // The advisories that motivated the old transitive pins cannot ship if the packages are absent.
    for (const gone of ["extract-zip", "basic-ftp", "get-uri", "pac-proxy-agent", "proxy-agent"]) {
      expect(packages[`node_modules/${gone}`], `${gone} is back in the tree`).toBeUndefined();
      expect(manifest.overrides?.[gone], `${gone} override is stale — the chain is gone`).toBeUndefined();
    }
    // The replacement downloader is what puppeteer actually uses, and it is the reviewed version.
    expect(packages["node_modules/@puppeteer/browsers"].version).toBe("3.2.4");
    expect(Object.keys(packages["node_modules/@puppeteer/browsers"].dependencies)).toEqual(
      expect.arrayContaining(["modern-tar"]),
    );
    expect(Object.keys(packages["node_modules/@puppeteer/browsers"].dependencies)).not.toContain("extract-zip");
  });
  it("keeps the upgraded tooling inside a runtime the repository actually tests on", () => {
    // puppeteer-core@25 requires Node >= 22.12.0. The CI runner that installs and drives it must
    // therefore be Node 22+ (engines additionally allows 20.x for the app itself, which is why the
    // runner pins its own version), and the version here must satisfy the installed requirement.
    const required = String(packages["node_modules/puppeteer-core"].engines?.node ?? "");
    expect(required).toContain(">=22.12.0");
    const runner = /node-version:\s*"(\d+)"/.exec(workflow)?.[1];
    expect(runner, "the e2e workflow must pin a Node major").toBeDefined();
    expect(Number(runner), "Node 20 cannot install puppeteer-core@25 — the runner must be 22+").toBeGreaterThanOrEqual(22);
    const running = process.versions.node.split(".").map(Number);
    expect(running[0] > 22 || (running[0] === 22 && running[1] >= 12), `this runtime is Node ${process.versions.node}, below the requirement`).toBe(true);
  });
  it("retains compatible brace expansion APIs in both dependency-major branches", () => {
    const v1 = require("brace-expansion");
    const estree = createRequire(require.resolve("@typescript-eslint/typescript-estree"));
    const v5 = estree("brace-expansion");
    const expand5 = v5.expand ?? v5.default ?? v5;
    expect(v1("{retail,food,salon}/card")).toEqual(["retail/card", "food/card", "salon/card"]);
    expect(expand5("{retail,food,salon}/card")).toEqual(["retail/card", "food/card", "salon/card"]);
  });
});
