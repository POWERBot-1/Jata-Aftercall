#!/usr/bin/env node
// Read-only visual baseline for the actual legacy storefront at the owner-named revision.
// The historical source predates generated-family and draft APIs; do not fabricate them.
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const expectedSha = "a28c1a46101ac90bbf28d374b4986b689196de8d";
const base = new URL(process.env.BASE_URL || "http://localhost:4100");
if (base.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(base.hostname) || base.port !== "4100" || base.pathname !== "/" ||
    process.env.CI !== "true" || process.env.MOTION_ISOLATED !== "1" ||
    process.env.DATABASE_URL !== "postgresql://jata:jata@localhost:5432/jata_e2e?schema=public" ||
    process.env.EXPECTED_SHA !== expectedSha) {
  throw new Error("Refusing to capture outside the exact disposable historical baseline");
}
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (sha !== expectedSha) throw new Error("Historical source HEAD mismatch");

const slug = "marys-beauty-studio";
const url = new URL(`/b/${slug}`, base).href;
const sizes = [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]];
const motions = ["no-preference","reduce"];
const out = "motion-family-evidence";
mkdirSync(path.join(out,"legacy-default","published"), { recursive: true });
const rows = [];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ["--no-sandbox","--disable-dev-shm-usage"]
});
const browserVersion = await browser.version();
let failed = false;
try {
  for (const [width,height] of sizes) {
    for (const reducedMotion of motions) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: reducedMotion }]);
      const pageErrors = [];
      page.on("pageerror", error => pageErrors.push(error.message));
      let status = 0;
      let metrics = null;
      try {
        const response = await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        status = response?.status() ?? 0;
        await page.screenshot({
          path: path.join(out,"legacy-default","published",`${width}x${height}-${reducedMotion}.png`),
          fullPage: true
        });
        metrics = await page.evaluate(() => ({
          title: document.title,
          bodyTextLength: document.body?.innerText?.trim().length ?? 0,
          containsBusinessName: document.body?.innerText?.includes("Mary's Beauty Studio") ?? false,
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
        }));
      } catch (error) {
        pageErrors.push(error instanceof Error ? error.message : "capture failed");
      }
      const accepted = status === 200 && metrics?.containsBusinessName === true && pageErrors.length === 0;
      if (!accepted) failed = true;
      rows.push({ family: "legacy-default", state: "published", width, height, reducedMotion, status, accepted, ...metrics, pageErrors });
      await page.close();
    }
  }
} finally {
  await browser.close();
}
const observations = {
  sha,
  browser: browserVersion,
  captureMode: "historical-legacy-default-published-only",
  route: url,
  rows,
  expectedCaptures: sizes.length * motions.length,
  actualCaptures: rows.length,
  limitations: "The owner-named historical revision predates generated template families and draft-preview APIs. This captures the real legacy published storefront only; it is not a one-to-one baseline for the later 20 generated families and does not claim draft-state coverage or independent visual acceptance."
};
writeFileSync(path.join(out,"observations.json"), JSON.stringify(observations,null,2));
if (failed || rows.length !== observations.expectedCaptures) {
  console.error("FAIL: one or more historical legacy storefront captures were not accepted");
  process.exit(1);
}
console.log(`PASS: captured ${rows.length} historical legacy storefront viewport/motion states`);
