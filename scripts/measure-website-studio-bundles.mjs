#!/usr/bin/env node
/**
 * Comparable gzip app-entry sums + separately loaded real mini chunk. Not total journey payload
 * or device performance.
 *
 * METHOD v2 (Next.js 16). Next 16 no longer emits `.next/app-build-manifest.json` — verified absent
 * under both the Turbopack default and `--webpack` — which was method v1's only data source, so the
 * measurement would have gone BLOCKED ("No production entry files"). v2 rebuilds the same quantity
 * from artifacts Next 16 does emit:
 *
 *   entry files = build-manifest.json rootMainFiles + polyfillFiles
 *                 + every distinct static/chunks/**.js referenced by that route's
 *                   .next/server/app/<route>/page_client-reference-manifest.js
 *
 * The numbers are therefore measured with a different file-set definition than the archived v1
 * baseline (Next 15 / app-build-manifest, routes 115794 / 144384 / 106682 gzip). Those three values
 * are kept below as history and are NOT comparable — comparing across a method change would invent
 * a regression or a win. The v2 baseline is recorded from the commit that introduced this method
 * (`git log -1 --format=%H -- scripts/measure-website-studio-bundles.mjs`), and the per-run report
 * always carries its own `sourceHead`.
 *
 * The check that actually guards the product is unchanged and method-independent: the lazily loaded
 * `website-studio-motion-mini` chunk must not appear in any measured route's initial entry.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const build = join(root, ".next");
const manifest = JSON.parse(readFileSync(join(build, "build-manifest.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const installedMotion = JSON.parse(readFileSync(join(root, "node_modules/motion/package.json"), "utf8")).version;

// Archived read-only v1 baseline (Next 15 / app-build-manifest method) for the record only.
const legacyBaselineV1 = { "/b/[slug]/page": 115794, "/dashboard/businesses/[id]/design/page": 144384, "/page": 106682 };
// v2 baseline, same Node gzip method, method as documented above.
const baselineV2 = { "/b/[slug]/page": 189291, "/dashboard/businesses/[id]/design/page": 312331, "/page": 178633 };

/** Route key -> the file holding its client-reference manifest. */
const routeManifestPath = (route) =>
  join(build, "server", "app", route === "/page" ? "" : route.replace(/^\/|\/page$/g, ""), "page_client-reference-manifest.js");

function entryFilesForRoute(route) {
  const manifestPath = routeManifestPath(route);
  if (!existsSync(manifestPath)) {
    throw new Error(`No client-reference manifest for ${route} (${manifestPath}). Measurement BLOCKED, not zero.`);
  }
  const source = readFileSync(manifestPath, "utf8");
  // Manifest paths are URL-encoded (%5Bslug%5D) while the files on disk are literal ([slug]).
  const referenced = new Set((source.match(/static\/chunks\/[A-Za-z0-9_[\]@./%-]+\.js/g) || []).map((file) => decodeURIComponent(file)));
  const shared = [...(manifest.rootMainFiles || []), ...(manifest.polyfillFiles || [])];
  const files = [...new Set([...shared, ...referenced])].sort();
  if (!files.length) throw new Error(`No production entry files for ${route}. Run npm run build first.`);
  for (const file of files) {
    if (!existsSync(join(build, file))) throw new Error(`Entry file ${file} for ${route} is listed but missing from the build.`);
  }
  return files;
}

const routes = {};
for (const [route, baselineGzipBytes] of Object.entries(baselineV2)) {
  const files = entryFilesForRoute(route);
  const gzipBytes = files.reduce((sum, file) => sum + gzipSync(readFileSync(join(build, file))).length, 0);
  routes[route] = { files, gzipBytes, baselineGzipBytes, deltaGzipBytes: gzipBytes - baselineGzipBytes };
}

let miniFiles = readdirSync(join(build, "static/chunks")).filter((file) => file.startsWith("website-studio-motion-mini") && file.endsWith(".js")).map((file) => `static/chunks/${file}`);
if (!miniFiles.length) {
  const loadable = JSON.parse(readFileSync(join(build, "react-loadable-manifest.json"), "utf8"));
  miniFiles = [...new Set(Object.entries(loadable).filter(([key]) => key.includes("motionRuntime") && key.includes("motion/mini")).flatMap(([, entry]) => entry.files).filter((file) => file.endsWith(".js")))];
}
if (!miniFiles.length) throw new Error("Cannot identify the actual lazy mini chunk. Measurement BLOCKED, not zero.");
for (const [route, data] of Object.entries(routes)) {
  if (data.files.some((file) => miniFiles.includes(file))) throw new Error(`mini was included in ${route}'s initial entry!`);
}
const miniChunks = miniFiles.map((file) => ({ file, bytes: readFileSync(join(build, file)).length, gzipBytes: gzipSync(readFileSync(join(build, file))).length }));
const report = {
  measuredAt: new Date().toISOString(), sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceDirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
  node: process.version, motion: installedMotion, lockedMotion: lock.packages["node_modules/motion"].version,
  method: "v2: build-manifest rootMainFiles+polyfillFiles plus the route's page_client-reference-manifest chunk references; app-build-manifest.json was removed in Next 16",
  legacyBaselineV1NotComparable: legacyBaselineV1,
  routes, miniChunks, miniTotalGzipBytes: miniChunks.reduce((sum, file) => sum + file.gzipBytes, 0),
};
const output = process.env.BUNDLE_REPORT_PATH || join(root, ".cache", "verification", "motion-bundles.json");
mkdirSync(join(output, ".."), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2));
for (const [route, data] of Object.entries(routes)) console.log(`${route}: ${data.gzipBytes} B gzip entry (${data.deltaGzipBytes >= 0 ? "+" : ""}${data.deltaGzipBytes} B vs v2 baseline, ${data.files.length} files)`);
console.log(`Lazy motion/mini: ${report.miniTotalGzipBytes} B gzip, ${miniChunks.length} chunk(s), absent from initial business/design/home entries. Installed=${installedMotion}, lock=${report.lockedMotion}.`);
console.log("Method v2 (Next 16): file sets differ from the archived v1 baseline by construction; only v2-to-v2 deltas are meaningful.");
console.log("Not total runtime payload, Core Web Vitals or physical device measurements.");
