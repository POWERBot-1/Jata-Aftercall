/**
 * MJENGO OS workspace routes — every advertised link must resolve to a real, gated page.
 *
 * This is a static assertion on the repository, not a browser run: a nav entry that 404s is a
 * defect a user sees, and a route file that forgets the gate is a security defect. Both are
 * checked here, cheaply, on every `npm test`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MJENGO_MODULES, MJENGO_SUB_ROUTES, mjengoPath } from "../../lib/mjengo/navigation";

const root = process.cwd();
const base = path.join(root, "app/dashboard/mjengo/[businessId]");

describe("mjengo: workspace routes", () => {
  it("every navigation entry has a page on disk", () => {
    const missing: string[] = [];
    for (const module of MJENGO_MODULES) {
      const file = path.join(base, `${module.path}/page.tsx`.replace(/^\//, ""));
      if (!existsSync(file)) missing.push(`${module.key} -> ${module.path || "/"} (${file})`);
    }
    expect(missing, `navigation entries without a page:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("the published sub-route list matches the navigation list exactly", () => {
    const fromNavigation = MJENGO_MODULES.map((module) => module.path).sort();
    expect([...MJENGO_SUB_ROUTES].sort()).toEqual(fromNavigation);
  });

  it("mjengoPath builds the URL each page is mounted at", () => {
    expect(mjengoPath("biz1")).toBe("/dashboard/mjengo/biz1");
    expect(mjengoPath("biz1", "/sales")).toBe("/dashboard/mjengo/biz1/sales");
    // A business id is encoded, so an id can never escape its own path segment.
    expect(mjengoPath("a/../b", "/sales")).toBe("/dashboard/mjengo/a%2F..%2Fb/sales");
  });

  it("the workspace gate is applied once, in the layout, before any child renders", () => {
    const layout = readFileSync(path.join(base, "layout.tsx"), "utf8");
    expect(layout).toContain("requireMjengoAccess");
    // The refusal path must return before children are rendered.
    expect(layout).toMatch(/if \(!gate\.ok\)/);
    expect(layout).toMatch(/children/);
    // Params are awaited (Next 16) — a sync read fails the build's PageProps check.
    expect(layout).toContain("await params");
  });

  it("no page inside the workspace renders raw branding with dangerouslySetInnerHTML", () => {
    const offenders: string[] = [];
    for (const module of MJENGO_MODULES) {
      const file = path.join(base, `${module.path}/page.tsx`.replace(/^\//, ""));
      const source = readFileSync(file, "utf8");
      if (source.includes("dangerouslySetInnerHTML")) offenders.push(file);
      if (/\binnerHTML\b/.test(source)) offenders.push(`${file} (innerHTML)`);
    }
    expect(offenders).toEqual([]);
  });

  it("the entry page redirects into a business workspace and never renders data itself", () => {
    const entry = readFileSync(path.join(root, "app/dashboard/mjengo/page.tsx"), "utf8");
    expect(entry).toContain("getOwnedBusinessIds");
    expect(entry).toContain("redirect(");
    expect(entry).toContain("/login");
  });
});
