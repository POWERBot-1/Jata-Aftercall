/**
 * MJENGO OS navigation audit — every link the workspace renders must resolve to a real route.
 *
 * This is a static audit, not a browser test: it parses the nav module and the App Router tree and
 * checks each `path` against an existing page.tsx. It also lists every `<Link href>` literal under
 * app/dashboard/mjengo/ so a hand-written link that points nowhere is caught too. It cannot prove
 * the page renders — that needs a browser, which is reported separately — but it does prove no
 * navigation entry is a 404.
 *
 * Run: node scripts/verify/mjengo-nav-audit.mjs   (also wired to `npm run verify:mjengo:nav`)
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const failures = [];
const rows = [];

// ── 1. The declared workspace sections ───────────────────────────────────────────────────────────
const navSource = readFileSync(join(ROOT, "lib/mjengo/navigation.ts"), "utf8");
const declared = [...navSource.matchAll(/path:\s*"([^"]*)"/g)].map((m) => m[1]);
if (declared.length === 0) failures.push("navigation.ts declares no paths — did the shape change?");

const pageDirs = (() => {
  const base = join(ROOT, "app/dashboard/mjengo/[businessId]");
  const out = new Set([""]);
  for (const entry of readdirSync(base)) {
    if (statSync(join(base, entry)).isDirectory() && existsSync(join(base, entry, "page.tsx"))) out.add(`/${entry}`);
  }
  return out;
})();

for (const path of declared) {
  const ok = pageDirs.has(path);
  rows.push({ kind: "nav", path, target: `app/dashboard/mjengo/[businessId]${path || ""}/page.tsx`, ok });
  if (!ok) failures.push(`nav entry "${path}" has no page.tsx`);
}

// Declared in navigation.ts but not reachable through the exported route list is also a defect.
const subRoutes = [...navSource.matchAll(/^\s*"(\/[a-z-]*)"|^\s*"()",/gm)].map((m) => m[1] ?? "");
for (const path of declared) {
  if (!subRoutes.includes(path)) failures.push(`nav entry "${path}" missing from MJENGO_SUB_ROUTES`);
}

// ── 2. Every literal <Link href> inside the MJENGO workspace ─────────────────────────────────────
const walk = (dir) => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
});
const tsx = walk(join(ROOT, "app/dashboard/mjengo")).concat(
  existsSync(join(ROOT, "components/mjengo")) ? walk(join(ROOT, "components/mjengo")) : [],
);
const literal = [];
for (const file of tsx) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/href=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
    const href = m[1] ?? m[2];
    if (href && href.startsWith("/") && !href.startsWith("/api")) literal.push({ file: relative(ROOT, file), href });
  }
}

const routeExists = (href) => {
  // Collapse a template segment (${businessId}) into the dynamic directory name.
  const cleaned = href.replace(/\$\{[^}]+\}/g, "[businessId]").split(/[?#]/)[0];
  const candidate = join(ROOT, "app", cleaned);
  return existsSync(join(candidate, "page.tsx")) || existsSync(`${candidate}.tsx`) || existsSync(join(candidate, "route.ts"));
};

for (const { file, href } of literal) {
  const ok = routeExists(href);
  rows.push({ kind: "link", path: `${file} → ${href}`, target: href, ok });
  if (!ok) failures.push(`${file} links to ${href}, which has no page or route handler`);
}

// ── 3. Report ────────────────────────────────────────────────────────────────────────────────────
const label = process.env.VERBOSE ? "" : "  ";
for (const row of rows) {
  console.log(`${label}${row.ok ? "OK  " : "404 "} ${row.kind === "nav" ? "nav " : "link"} ${row.path}`);
}
console.log(`\n${rows.filter((r) => r.ok).length}/${rows.length} navigation targets resolve to a real route`);
if (failures.length) {
  console.log(`\nFAIL — ${failures.length} unresolved target(s):`);
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
console.log("PASS — no navigation entry or link resolves to a 404");
