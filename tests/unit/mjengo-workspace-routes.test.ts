/**
 * MJENGO OS workspace routes — every advertised link must resolve to a real, gated page.
 *
 * This is a static assertion on the repository, not a browser run: a nav entry that 404s is a
 * defect a user sees, and a route file that forgets the gate is a security defect. Both are
 * checked here, cheaply, on every `npm test`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

const readdirSafe = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);
const statSyncSafe = (full: string) => {
  try {
    return statSync(full);
  } catch {
    return null;
  }
};
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

  it("every literal href inside the workspace resolves to a page or route handler (no 404 links)", () => {
    // A hand-written <Link href="/dashboard/mjengo/…/foo"> is the other way a 404 reaches a user,
    // and it is invisible to the nav assertion above. Mirrors scripts/verify/mjengo-nav-audit.mjs.
    const walk = (dir: string): string[] =>
      readdirSafe(dir).flatMap((entry) => {
        const full = path.join(dir, entry);
        if (statSyncSafe(full)?.isDirectory()) return walk(full);
        return entry.endsWith(".tsx") ? [full] : [];
      });
    const files = walk(path.join(root, "app/dashboard/mjengo"));
    expect(files.length).toBeGreaterThan(0);
    const unresolved: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/href=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
        const href = match[1] ?? match[2];
        if (!href || !href.startsWith("/") || href.startsWith("/api")) continue;
        const cleaned = href.replace(/\$\{[^}]+\}/g, "[businessId]").split(/[?#]/)[0];
        const target = path.join(root, "app", cleaned);
        const resolves =
          existsSync(path.join(target, "page.tsx")) || existsSync(`${target}.tsx`) || existsSync(path.join(target, "route.ts"));
        if (!resolves) unresolved.push(`${path.relative(root, file)} -> ${href}`);
      }
    }
    expect(unresolved, `links with no route:\n  ${unresolved.join("\n  ")}`).toEqual([]);
  });

  it("the entry page redirects into a business workspace and never renders data itself", () => {
    const entry = readFileSync(path.join(root, "app/dashboard/mjengo/page.tsx"), "utf8");
    expect(entry).toContain("getOwnedBusinessIds");
    expect(entry).toContain("redirect(");
    expect(entry).toContain("/login");
  });
});
