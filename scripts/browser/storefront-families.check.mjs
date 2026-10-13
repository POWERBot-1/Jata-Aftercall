#!/usr/bin/env node
/** Actual registered v2 compositions/Next renderer. Synthetic catalogue, local SVG only; no provider/original operations. */
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const CHROME_PATH = process.env.CHROME_PATH;
if (!CHROME_PATH) { console.error("Chrome missing. Family browser checks NOT RUN."); process.exit(2); }
const BASE = (process.env.BASE_URL || "http://localhost:4100").replace(/\/$/, "");
const origin = new URL(BASE).origin;
const out = process.env.FAMILY_EVIDENCE_DIR || join(process.cwd(), ".cache/verification/family-browser");
mkdirSync(out, { recursive: true });
const families = ["cinematic", "editorial", "luxury", "minimal", "magazine", "marketplace", "product-first", "storytelling", "spatial", "interactive-showroom", "gallery", "split-screen", "fullscreen-media", "scrollytelling", "cardless-immersive", "map-driven", "catalog", "portfolio", "service-journey", "experimental"];
const results = [], measurements = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
// One retry on a transient CDP transport failure at page creation (observed twice in CI,
// e.g. runs 38231732932/38240649221); every scenario check still runs normally afterwards.
async function newPage() {
  try { return await browser.newPage(); }
  catch {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return await browser.newPage();
  }
}
const version = await browser.version();
try {
  for (const mobile of [false, true]) for (const family of families) {
    const name = `${family}/${mobile ? "360px phone" : "1280px desktop"}/no-JS`;
    const page = await newPage();
    try {
      await page.setViewport({ width: mobile ? 360 : 1280, height: mobile ? 740 : 800, isMobile: mobile, hasTouch: mobile });
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      let externalRequests = 0, miniRequests = 0;
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (/motion.*mini/.test(url.pathname)) miniRequests += 1;
        if (url.origin !== origin) { externalRequests += 1; return void request.abort(); }
        return void request.continue();
      });
      await page.goto(`${BASE}/dev/motion-preview?family=${family}&preference=lite`, { waitUntil: "networkidle0", timeout: 120000 });
      const state = await page.evaluate(() => {
        const root = document.querySelector(".eb-scope"), hero = root.querySelector(".eb-hero"), body = root.querySelector(".eb-family-body"), gallery = root.querySelector(".eb-gallery"), catalog = root.querySelector("[data-catalogue-layout]") || root.querySelector(".eb-comparison") || root.querySelector(".eb-grid--list");
        const textVisible = (element) => element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility !== "hidden" && Number(getComputedStyle(element).opacity) >= 0.9;
        const grid = root.querySelector(".eb-composition-grid");
        const nav = [...root.querySelectorAll('.eb-chapters a[href^="#"]')];
        const geometry = { hero: hero.className, heroHeight: Math.round(hero.getBoundingClientRect().height), body: body.dataset.composition,
          gridColumns: getComputedStyle(grid).gridTemplateColumns, catalogue: catalog.className, gallery: gallery.dataset.galleryLayout,
          galleryColumns: getComputedStyle(gallery).gridTemplateColumns || getComputedStyle(gallery).columnCount,
          chapters: nav.length, productStage: Boolean(root.querySelector(".eb-product-stage")) };
        return { family: root.dataset.templateFamily, heading: root.querySelector("h1")?.textContent, headingVisible: textVisible(root.querySelector("h1")),
          priceVisible: textVisible(root.querySelector(".eb-price")), price: root.querySelector(".eb-price")?.textContent,
          phone: Boolean(root.querySelector('a[href^="tel:"]')), whatsapp: Boolean(root.querySelector('a[href^="https://wa.me/"]')), shop: Boolean(root.querySelector('a[href="/b/motion-fixture/shop"]')),
          readable: [...root.querySelectorAll(".eb-composition-block")].every(textVisible), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          noCanvas: !root.querySelector("canvas"), imagesLoaded: [...root.querySelectorAll(".eb-hero img")].some((image) => image.complete && image.naturalWidth > 0),
          rootBackdrop: getComputedStyle(root).backdropFilter, anchorsValid: nav.every((link) => Boolean(document.getElementById(decodeURIComponent(link.hash.slice(1))))), geometry };
      });
      check(`${name}: actual registered renderer and essential HTML`, state.family === family && state.heading === "Fresh coastal dishes" && state.headingVisible && state.priceVisible && state.price === "KES 149" && state.phone && state.whatsapp && state.shop && state.readable, JSON.stringify(state));
      check(`${name}: no horizontal page overflow or trapped fixed-container root`, state.overflow === 0 && state.rootBackdrop === "none", `overflow=${state.overflow}`);
      check(`${name}: local imagery, no GPU/mini/provider dependence`, state.imagesLoaded && state.noCanvas && miniRequests === 0 && externalRequests === 0, `mini=${miniRequests}, external=${externalRequests}`);
      check(`${name}: semantic chapter anchors resolve`, state.anchorsValid);
      measurements.push({ family, mobile, ...state.geometry });
      if (!mobile && ["cinematic", "magazine", "interactive-showroom", "service-journey", "map-driven"].includes(family)) await page.screenshot({ path: join(out, `${family}-desktop.png`) });
    } catch (error) { check(`${name}: scenario executed`, false, String(error.message || error)); }
    finally { await page.close(); }
  }
  // Actual DOM/layout signatures exclude colours and family labels, so a registry-name shuffle cannot pass.
  const desktop = measurements.filter((item) => !item.mobile).map(({ family, mobile, ...geometry }) => JSON.stringify(geometry));
  check("desktop geometry: all20 measured, substantially different structures", desktop.length === 20 && new Set(desktop).size === 20, `unique=${new Set(desktop).size}/20`);
  // Same cart context/actions under no motion and under a family carousel; no checkout/provider call.
  for (const family of ["marketplace", "interactive-showroom", "minimal"]) {
    const page = await newPage(); const errors = [];
    try {
      await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
      await page.evaluateOnNewDocument(() => { localStorage.clear(); });
      await page.setRequestInterception(true);
      page.on("request", (request) => new URL(request.url()).origin !== origin ? request.abort() : request.url().includes("/api/analytics") ? request.respond({ status: 200, body: "{}" }) : request.continue());
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${BASE}/dev/motion-preview?family=${family}&preference=lite`, { waitUntil: "networkidle0" });
      const add = await page.$(".eb-row button") || await page.$(".eb-card__foot button");
      await add.tap(); await page.waitForSelector(".eb-drawer");
      const state = await page.evaluate(() => { const drawer = document.querySelector(".eb-drawer"), rect = drawer.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, subtotal: drawer.querySelector(".eb-totals__row span:last-child").textContent, mode: document.querySelector(".eb-scope").dataset.renderMode }; });
      check(`${family}: touch cart visible with authoritative149-unit subtotal in Lite`, state.top >= 0 && state.bottom <= 740 && state.subtotal === "KES 149" && state.mode === "lite", JSON.stringify(state));
      await (await page.$('.eb-drawer__head button[aria-label="Close cart"]')).tap();
      await page.waitForFunction(() => !document.querySelector(".eb-drawer"));
      check(`${family}: touch close and no uncaught errors`, errors.length === 0, errors.join(" | "));
    } catch (error) { check(`${family}: touch scenario executed`, false, String(error.message || error)); }
    finally { await page.close(); }
  }
} finally { await browser.close(); }
const failed = results.filter((item) => !item.ok).length;
writeFileSync(join(out, "results.json"), JSON.stringify({ browser: version, results, measurements, passed: results.length - failed, failed, skipped: 0, limits: "synthetic data; mobile emulated; no real providers/originals/production metrics" }, null, 2));
console.log(`${results.length - failed} passed, ${failed} failed, 0 skipped. Original-media/provider acceptance BLOCKED by owner decision; not a physical device or 3D/provider proof.`);
process.exit(failed ? 1 : 0);
