#!/usr/bin/env node
/**
 * Real-browser layout checks on the fixture page (no database, no login).
 *
 * Run against a running `next dev` server:
 *   CHROME_PATH=/path/to/chrome BASE_URL=http://localhost:3200 node scripts/browser/fixture-layout.check.mjs
 *
 * Scenarios: no horizontal overflow on a phone-sized and a desktop viewport, heading and product image
 * visible at both sizes, and the same content still visible with reduced motion requested.
 *
 * NOT covered here (they need an authenticated dashboard or a database): conflict handling, upload
 * behaviour, publish, and motion-mode reveal. Those must be verified separately and are reported as
 * not run. External hosts are intercepted; any other external request is aborted. Exits 1 on failure.
 */

import puppeteer from "puppeteer-core";

const CHROME_PATH = process.env.CHROME_PATH;
const BASE_URL = (process.env.BASE_URL || "http://localhost:3200").replace(/\/$/, "");
if (!CHROME_PATH) {
  console.error("CHROME_PATH is required (path to a Chrome/Chromium binary). Not run.");
  process.exit(2);
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#888"/></svg>';
let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (ok) passed += 1;
  else failed += 1;
}

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});

async function openPage({ width, height, reducedMotion = false, mobile = false }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  if (reducedMotion) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.url().startsWith(BASE_URL)) return req.continue();
    if (req.url().endsWith(".svg")) return req.respond({ status: 200, contentType: "image/svg+xml", body: SVG });
    return req.abort();
  });
  await page.goto(`${BASE_URL}/dev/immersive-preview`, { waitUntil: "networkidle0", timeout: 120000 });
  return page;
}

async function layoutFacts(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && Number(s.opacity) > 0;
    };
    const heading = document.querySelector("h1");
    const image = document.querySelector("#product-preview img");
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      headingVisible: visible(heading),
      imageVisible: visible(image),
      headingText: heading?.textContent?.trim() || "",
    };
  });
}

try {
  const scenarios = [
    { label: "phone 360x740", width: 360, height: 740, mobile: true },
    { label: "desktop 1280x800", width: 1280, height: 800 },
  ];
  for (const s of scenarios) {
    const page = await openPage(s);
    const facts = await layoutFacts(page);
    check(`${s.label}: no horizontal overflow`, facts.overflowX <= 0, `overflowX=${facts.overflowX}px`);
    check(`${s.label}: heading visible`, facts.headingVisible && facts.headingText.length > 0, facts.headingText);
    check(`${s.label}: product image visible`, facts.imageVisible);
    await page.close();
  }

  const reduced = await openPage({ width: 360, height: 740, mobile: true, reducedMotion: true });
  const facts = await layoutFacts(reduced);
  check("reduced motion (phone): content still visible, no overflow", facts.headingVisible && facts.imageVisible && facts.overflowX <= 0);
  await reduced.close();
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed, 0 skipped`);
console.log("Not run by this script: conflict handling, upload, publish, motion-mode reveal (need the dashboard or a database).");
process.exit(failed === 0 ? 0 : 1);
