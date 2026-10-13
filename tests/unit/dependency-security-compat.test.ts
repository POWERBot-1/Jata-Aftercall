import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SourceMapConsumer, SourceMapGenerator } from "source-map-js";
import selectorParser from "postcss-selector-parser";
import { Client, parseList } from "basic-ftp";
const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const packages = JSON.parse(readFileSync("package-lock.json", "utf8")).packages;

describe("narrow security patches and compatibility", () => {
  it("pins matching Next runtime/lint patches without changing React/Prisma/Motion/toolchain majors", () => {
    expect(manifest.dependencies.next).toBe("15.5.27");
    expect(manifest.devDependencies["eslint-config-next"]).toBe("15.5.27");
    expect(packages["node_modules/next"].version).toBe("15.5.27");
    expect(packages["node_modules/eslint-config-next"].version).toBe("15.5.27");
    for (const [name, version] of [["react", "18.3.1"], ["react-dom", "18.3.1"], ["@prisma/client", "5.22.0"], ["prisma", "5.22.0"], ["motion", "14.1.0"], ["tailwindcss", "3.4.19"], ["puppeteer-core", "23.11.1"]]) {
      expect(packages[`node_modules/${name}`].version).toBe(version);
    }
    expect(manifest.engines.node).toBe("^20.19.0 || >=22.12.0");
  });
  it("locks every targeted transitive patch to the reviewed version", () => {
    for (const [name, version] of [["source-map-js", "1.2.2"], ["basic-ftp", "6.2.3"], ["postcss-selector-parser", "7.1.6"]]) expect(packages[`node_modules/${name}`].version).toBe(version);
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
  it("retains all basic-ftp APIs consumed by get-uri without making a network call", () => {
    for (const method of ["access", "list", "lastMod", "downloadTo", "close"]) expect(typeof Client.prototype[method]).toBe("function");
    const entries = parseList("-rw-r--r-- 1 owner group 1299 Oct 12 06:24 owned.txt\ndrwxr-xr-x 2 owner group 4096 Oct 12 06:24 photos");
    expect(entries.map((entry) => ({ name: entry.name, size: entry.size, type: entry.type }))).toEqual([
      { name: "owned.txt", size: 1299, type: 1 }, { name: "photos", size: 4096, type: 2 },
    ]);
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
