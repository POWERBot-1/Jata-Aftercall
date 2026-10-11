#!/usr/bin/env node
/** Comparable gzip app-entry sums + separately loaded real mini chunk. Not total journey payload or device performance. */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const build = join(root, ".next");
const manifest = JSON.parse(readFileSync(join(build, "app-build-manifest.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const installedMotion = JSON.parse(readFileSync(join(root, "node_modules/motion/package.json"), "utf8")).version;
// Archived, measured read-only baseline 77e35cec..., same Node gzip method. This is not a performance score.
const baseline = { "/b/[slug]/page": 115794, "/dashboard/businesses/[id]/design/page": 144384, "/page": 106682 };
const routes = {};
for (const [route, baselineGzipBytes] of Object.entries(baseline)) {
  const files = [...new Set(manifest.pages[route] || [])];
  if (!files.length) throw new Error(`No production entry files for ${route}. Run npm run build first.`);
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
  baselineSha: "77e35cec6a5726f569ab3febd3e7766300b14890", method: "gzipSync(default) of unique app-build-manifest entry files; CSS/HTML/data/async traffic not included",
  routes, miniChunks, miniTotalGzipBytes: miniChunks.reduce((sum, file) => sum + file.gzipBytes, 0),
};
const output = process.env.BUNDLE_REPORT_PATH || join(root, ".cache", "verification", "motion-bundles.json");
mkdirSync(join(output, ".."), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2));
for (const [route, data] of Object.entries(routes)) console.log(`${route}: ${data.gzipBytes} B gzip entry (${data.deltaGzipBytes >= 0 ? "+" : ""}${data.deltaGzipBytes} B vs baseline)`);
console.log(`Lazy motion/mini: ${report.miniTotalGzipBytes} B gzip, ${miniChunks.length} chunk(s), absent from initial business/design/home entries. Installed=${installedMotion}, lock=${report.lockedMotion}.`);
console.log("Not total runtime payload, Core Web Vitals or physical device measurements.");
