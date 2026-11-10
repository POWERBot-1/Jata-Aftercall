#!/usr/bin/env node
/**
 * Website Studio (OpenPage foundation) browser acceptance.
 *
 * Runs the real Studio client against the development fixture route, which uses the real
 * generator, real Experience renderer and real Studio components. Only the authenticated
 * API calls are stubbed, because this sandbox has no database or login. Tenant/auth,
 * draft-version concurrency and publication are covered by vitest suites.
 *
 * Usage:
 *   CHROME_PATH=/path/to/chrome STUDIO_BASE_URL=http://localhost:3000 \
 *     node scripts/browser/website-studio-openpage.check.mjs
 *
 * Requires `puppeteer-core` (already a dev dependency) and a Chromium binary.
 */
import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const baseUrl = (process.env.STUDIO_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const chromePath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || "";
if (!chromePath) {
  console.error("Set CHROME_PATH (or PUPPETEER_EXECUTABLE_PATH) to a Chromium binary.");
  process.exit(2);
}
const evidenceDir = process.env.STUDIO_EVIDENCE_DIR || "docs/evidence/website-studio-openpage-2026-11-10";
await fs.mkdir(evidenceDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--single-process", "--no-zygote"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1100, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() !== "error") return;
  // Next dev's HMR websocket is blocked when the harness is opened over a non-canonical
  // host; it is not an application error and the production build has no HMR client.
  if (message.text().includes("/_next/hmr")) return;
  errors.push(`console: ${message.text()}`);
});

async function clickText(text) {
  const clicked = await page.evaluate((label) => {
    const button = [...document.querySelectorAll("button")].find((entry) => (entry.textContent || "").includes(label));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`Enabled button not found: ${text}`);
}
async function waitText(text, timeout = 15000) {
  await page.waitForFunction((label) => document.body.innerText.includes(label), { timeout }, text);
}
async function shot(name) {
  await page.screenshot({ path: path.join(evidenceDir, name), fullPage: true });
}

try {
  // Load the deterministic fixture once, then navigate to the prompt-first stage.
  await page.goto(`${baseUrl}/dev/website-studio-preview`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const fixture = await page.evaluate(() => JSON.parse(document.getElementById("studio-fixture").textContent));
  if (!fixture?.candidates?.length) throw new Error("Fixture candidates were not exposed by the harness.");

  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (!["POST", "PATCH"].includes(request.method())) return request.continue();
    const json = (body, status = 200) => request.respond({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.endsWith("/api/studio/openpage/understand")) {
      return json({
        requirements: fixture.requirements, directionNote: null,
        provider: { key: "jata-local", label: "JATA built-in", modelKey: null, usedModel: false },
        baseDraftVersion: 3, hasExperience: true, counts: { products: 3, services: 0, media: 2 }, saved: false,
      });
    }
    if (url.endsWith("/api/studio/openpage/generate")) {
      return json({
        candidates: fixture.candidates, notes: [], distinctCount: 3, materiallyDistinct: true,
        layoutPlan: fixture.candidates[0].layoutPlan, baseDraftVersion: 3, requirements: fixture.requirements,
        directionNote: null, provider: { key: "jata-local", label: "JATA built-in", modelKey: null, usedModel: false },
        comparedWith: 0, historyLimitation: null, reviewPolicy: "Protected facts are never generated.", saved: false,
      });
    }
    if (url.endsWith("/api/studio/openpage/refine")) {
      const body = JSON.parse(request.postData() || "{}");
      const document = { ...body.document };
      const hero = document.sections.find((section) => section.type === "hero");
      if (hero) hero.subtitle = "Refined in the browser acceptance run";
      return json({
        document, reply: "Done — tone → premium. The preview has updated. Nothing is live until you publish.",
        changes: ["tone → premium"], suggestions: [], reviewNotes: [], changed: true,
        intent: "art_direction", baseDraftVersion: 3,
      });
    }
    if (url.endsWith("/api/experience/publish")) {
      return json({ published: true, message: "You’re live", url: "/b/choma-place" });
    }
    if (url.endsWith("/api/experience")) {
      const body = JSON.parse(request.postData() || "{}");
      return json({
        experience: { draftVersion: 4, publishedVersion: 2, status: "PUBLISHED" },
        document: body.document, saved: true, canUndo: true,
      });
    }
    return request.continue();
  });

  await page.goto(`${baseUrl}/dev/website-studio-preview?view=describe`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await new Promise((resolve) => setTimeout(resolve, 6000));
  await page.type("textarea", "A warm nyama choma spot in Kitengela. Show the menu first and make it feel premium.");
  await clickText("Understand my business");
  await waitText("What JATA understood");
  await shot("01-requirements-understood.png");

  await clickText("Generate 3 layouts");
  await waitText("Three ways this business could look");
  const cardCount = await page.evaluate(() => document.querySelectorAll("[data-studio-preview]").length);
  if (cardCount !== 3) throw new Error(`Expected 3 previews, found ${cardCount}`);
  const assets = await page.evaluate(() => {
    const urls = [...document.querySelectorAll("[data-studio-preview] img")].map(
      (image) => image.currentSrc || image.src,
    );
    return {
      hero: urls.some((url) => url.includes("/category/grocery-1200.webp")),
      gallery: urls.some((url) => url.includes("/category/grocery-720.jpg")),
    };
  });
  if (!assets.hero || !assets.gallery) {
    throw new Error(`Generated previews lost customer assets: ${JSON.stringify(assets)}`);
  }
  await shot("02-three-distinct-layouts.png");

  await clickText("Use this layout");
  await waitText("Refine conversationally");
  await clickText("Theme");
  await page.waitForFunction(() => document.body.innerText.toLowerCase().includes("approved themes"), { timeout: 10000 });
  await clickText("Street Food");
  await shot("03-theme-and-visual-refinement.png");

  await page.type('input[placeholder*="Make it more premium"]', "Make it more premium");
  await clickText("Send");
  await waitText("Refined in the browser acceptance run");

  await clickText("Approve & save draft");
  await waitText("Draft saved (version 4)");

  await page.click('button[title="mobile"]');
  await shot("04-editor-mobile-preview.png");

  await clickText("Publish");
  await waitText("Publishing");
  await clickText("Publish my website");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await shot("05-publish-controls.png");

  if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);
  console.log(`PASS: 3 layouts previewed, request/photo assets retained, refinement, save v4, mobile preview and publish controls exercised.`);
  console.log(`Evidence: ${evidenceDir}`);
} finally {
  await browser.close();
}
