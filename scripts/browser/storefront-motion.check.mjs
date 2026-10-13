#!/usr/bin/env node
/**
 * Actual Next renderer + actual lazy motion/mini browser checks. Synthetic catalogue, no DB/payment proof.
 * Requires a running `next dev` server and a Chrome binary; missing browser exits 2, never a pass.
 * CHROME_PATH=/path/to/chrome BASE_URL=http://localhost:4100 npm run test:browser:motion
 * External traffic and fixture analytics are intercepted; no provider/storage/production writes.
 * Mobile/CPU/network signals are simulations, NOT physical Android or field-performance measurements.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CHROME_PATH = process.env.CHROME_PATH;
const BASE_URL = (process.env.BASE_URL || "http://localhost:4100").replace(/\/$/, "");
const ORIGIN = new URL(BASE_URL).origin;
const EVIDENCE = process.env.EVIDENCE_DIR || join(process.cwd(), ".cache", "verification", "motion-browser");
if (!CHROME_PATH) { console.error("CHROME_PATH required. Browser checks NOT RUN."); process.exit(2); }
mkdirSync(EVIDENCE, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const runs = [];
const miniUrl = (url) => /(?:motion.*mini|mini.*motion)/i.test(new URL(url).pathname) && url.includes("/_next/static/chunks/");
function check(name, ok, details = "") {
  results.push({ name, ok, details });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${details ? ` — ${details}` : ""}`);
}

async function newPage(browser, options = {}) {
  const page = await browser.newPage();
  const mobile = options.mobile ?? true;
  await page.setViewport({ width: mobile ? 360 : 1280, height: mobile ? 740 : 800, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  await page.setCacheEnabled(false);
  if (mobile) await page.setUserAgent("Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36");
  if (options.reduced) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  if (options.noJS) await page.setJavaScriptEnabled(false);
  await page.evaluateOnNewDocument(({ saveData, effectiveType, memory, cores, noWAAPI, noObserver, neverObserve, failNative, noEnumerations }) => {
    try { localStorage.clear(); } catch {}
    const net = Object.assign(new EventTarget(), { saveData, effectiveType });
    window.__qaNetwork = net;
    window.__qaMotionCalls = [];
    window.__qaMotionCancels = 0;
    Object.defineProperty(navigator, "connection", { configurable: true, get: () => net });
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, get: () => memory });
    Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => cores });
    if (noObserver) Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: undefined });
    if (neverObserve) {
      const Original = window.IntersectionObserver;
      window.IntersectionObserver = class extends Original {
        constructor(callback, settings) {
          super(settings?.threshold === 0.08 ? () => {} : callback, settings);
        }
      };
    }
    if (noEnumerations) Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: undefined });
    if (noWAAPI) { Object.defineProperty(Element.prototype, "animate", { configurable: true, value: undefined }); return; }
    const animate = Element.prototype.animate;
    const attempts = new WeakMap();
    Element.prototype.animate = function (frames, settings) {
      if (failNative && this.matches("[data-motion-recipe]")) {
        const count = (attempts.get(this) || 0) + 1;
        attempts.set(this, count);
        if (count === 2) throw new Error("Injected partial Web Animations failure");
      }
      const animation = animate.call(this, frames, settings);
      if (this.matches("[data-motion-recipe]")) {
        window.__qaMotionCalls.push({ recipe: this.dataset.motionRecipe, scoped: Boolean(this.closest(".eb-scope")), startedAt: performance.now() });
        const cancel = animation.cancel.bind(animation);
        animation.cancel = () => { window.__qaMotionCancels += 1; return cancel(); };
      }
      return animation;
    };
  }, {
    saveData: options.saveData ?? false, effectiveType: options.effectiveType ?? "4g", memory: options.memory ?? 8, cores: options.cores ?? 8,
    noWAAPI: options.noWAAPI ?? false, noObserver: options.noObserver ?? false, neverObserve: options.neverObserve ?? false, failNative: options.failNative ?? false, noEnumerations: options.noEnumerations ?? false,
  });
  const trace = { miniRequests: [], pageErrors: [], held: [], responseBytes: 0 };
  page.on("pageerror", (error) => trace.pageErrors.push(String(error.message || error).slice(0, 300)));
  const session = await page.createCDPSession();
  await session.send("Network.enable");
  session.on("Network.loadingFinished", (event) => { trace.responseBytes += event.encodedDataLength || 0; });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (miniUrl(url)) {
      trace.miniRequests.push(url);
      if (options.blockMini) return void request.abort("failed");
      if (options.holdMini) { trace.held.push(request); return; }
    }
    if (new URL(url).origin !== ORIGIN) return void request.abort();
    const pathname = new URL(url).pathname;
    if (pathname.startsWith("/api/analytics")) return void request.respond({ status: 200, contentType: "application/json", body: "{}" });
    return void request.continue();
  });
  return { page, trace };
}

async function facts(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".eb-scope");
    const wrappers = [...document.querySelectorAll(".eb-scope [data-motion-recipe]")];
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) >= 0.9;
    };
    const outside = document.getElementById("outside-motion-scope");
    return {
      mode: root?.dataset.renderMode || "lite", engine: root?.dataset.motionEngine || "static", reason: root?.dataset.motionReason || "ssr",
      heading: document.querySelector("h1")?.textContent, headingVisible: visible(document.querySelector("h1")),
      price: document.querySelector(".eb-price")?.textContent, priceVisible: visible(document.querySelector(".eb-price")),
      wrappers: wrappers.length, wrappersReadable: wrappers.every(visible),
      activeAnimations: wrappers.flatMap((element) => element.getAnimations?.() || []).filter((animation) => ["running", "pending"].includes(animation.playState)).length,
      cleanStyles: wrappers.every((element) => !element.style.opacity && !element.style.transform),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      calls: window.__qaMotionCalls?.length || 0, cancels: window.__qaMotionCancels || 0,
      outsideUnchanged: outside?.dataset.motionPlayed === undefined && getComputedStyle(outside).transform === "none" && getComputedStyle(outside).opacity === "1",
      globalMotionFlag: document.documentElement.dataset.motionReady,
      hasShopLink: Boolean(document.querySelector('a[href="/b/motion-fixture/shop"]')),
      hasCallLink: Boolean(document.querySelector('a[href^="tel:"]')),
      hasWhatsAppLink: Boolean(document.querySelector('a[href^="https://wa.me/"]')),
      canvasCount: document.querySelectorAll("canvas").length,
    };
  });
}
async function waitMode(page, mode) {
  await page.waitForFunction((mode) => document.querySelector(".eb-scope")?.dataset.renderMode === mode, { timeout: 15000 }, mode);
}
async function scrollReveal(page, index = 0) {
  await page.evaluate((index) => document.querySelectorAll(".eb-scope [data-motion-recipe]")[index]?.scrollIntoView({ block: "center" }), index);
}
async function waitEngine(page, engine) {
  await page.waitForFunction((engine) => document.querySelector(".eb-scope")?.dataset.motionEngine === engine, { timeout: 20000 }, engine);
}
function contentChecks(name, state) {
  check(`${name}: heading, exact price, sections and core links remain readable`, state.headingVisible && state.priceVisible && state.price === "KES 149" && state.wrappersReadable && state.hasShopLink && state.hasCallLink && state.hasWhatsAppLink, JSON.stringify(state));
  check(`${name}: no horizontal overflow, canvas or global motion flag`, state.overflow <= 0 && state.canvasCount === 0 && state.globalMotionFlag === undefined, `overflow=${state.overflow}px`);
}

if (process.env.WAIT_FOR_SERVER === "1") {
  const deadline = Date.now() + 90000;
  let ready = false;
  while (Date.now() < deadline) {
    try { const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(10000) }); if (response.ok) { ready = true; break; } } catch {}
    await sleep(500);
  }
  if (!ready) { console.error("Local QA server did not become ready. Browser checks NOT RUN."); process.exit(2); }
}
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
const version = await browser.version();
console.log(`Browser ${version}. Mobile signals are simulated; fixture has no database.`);
async function scenario(name, options, test, query = "") {
  const { page, trace } = await newPage(browser, options);
  try {
    await page.goto(`${BASE_URL}/dev/motion-preview${query}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => document.querySelector(".eb-hero__media img")?.naturalWidth > 0, { timeout: 15000 });
    check(`${name}: actual local synthetic illustration loaded`, true);
    await test(page, trace);
    check(`${name}: no uncaught page errors`, trace.pageErrors.length === 0, trace.pageErrors.join(" | "));
    runs.push({ name, ...await facts(page).catch(() => ({})), miniRequests: trace.miniRequests.length, responseBytes: trace.responseBytes });
  } catch (error) { check(`${name}: scenario executed`, false, String(error.message || error)); }
  finally { await page.close(); }
}

try {
  for (const mobile of [false, true]) {
    const name = `no JavaScript ${mobile ? "360px phone" : "desktop"}`;
    await scenario(name, { mobile, noJS: true }, async (page, trace) => {
      const state = await facts(page); contentChecks(name, state);
      check(`${name}: no mini chunk or animation`, trace.miniRequests.length === 0 && state.calls === 0 && state.cleanStyles);
    });
  }
  for (const mobile of [false, true]) {
    const name = `actual mini ${mobile ? "touch phone" : "desktop"}`;
    await scenario(name, { mobile }, async (page, trace) => {
      await waitMode(page, "motion");
      check(`${name}: no mini fetch before an eligible intersection`, trace.miniRequests.length === 0);
      await scrollReveal(page); await waitEngine(page, "mini");
      const active = await facts(page);
      check(`${name}: real mini chunk and real native animate calls`, trace.miniRequests.length === 1 && active.calls > 0, `requests=${trace.miniRequests.length}, native calls=${active.calls}`);
      contentChecks(name, active);
      check(`${name}: scoped effects never touch the outside marker`, active.outsideUnchanged);
      await sleep(800);
      const settled = await facts(page);
      check(`${name}: finite completion clears inline styles and animations`, settled.cleanStyles && settled.activeAnimations === 0, JSON.stringify(settled));
      if (mobile) {
        const add = await page.$(".eb-row button");
        const target = await add.boundingBox();
        check("touch commerce: primary tap target is at least44px", target.width >= 44 && target.height >= 44, JSON.stringify(target));
        await add.tap();
        await page.waitForFunction(() => document.querySelector(".eb-actionbar")?.textContent?.includes("1"));
        check("touch commerce: real cart adds without a motion-dependent action", (await facts(page)).price === "KES 149");
        await page.waitForSelector(".eb-drawer");
        const drawer = await page.evaluate(() => {
          const element = document.querySelector(".eb-drawer"), root = document.querySelector(".eb-scope"), rect = element.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, height: rect.height, visible: rect.top >= 0 && rect.bottom <= innerHeight && rect.height > 0,
            rootBackdrop: getComputedStyle(root).backdropFilter, headerPosition: getComputedStyle(root.querySelector(".eb-nav")).position };
        });
        check("touch commerce: fixed cart is visible in viewport, not trapped by the theme root", drawer.visible && drawer.rootBackdrop === "none" && drawer.headerPosition === "sticky", JSON.stringify(drawer));
        await (await page.$('.eb-drawer button[aria-label^="Increase quantity"]')).tap();
        await page.waitForFunction(() => document.querySelector(".eb-drawer__foot .eb-totals__row span:last-child")?.textContent === "KES 298");
        check("touch commerce: quantity increases with exact149-unit subtotal298", true);
        await (await page.$('.eb-drawer button[aria-label^="Decrease quantity"]')).tap();
        await page.waitForFunction(() => document.querySelector(".eb-drawer__foot .eb-totals__row span:last-child")?.textContent === "KES 149");
        check("touch commerce: quantity decreases without changing catalogue price", (await facts(page)).price === "KES 149");
        await (await page.$('.eb-drawer__head button[aria-label="Close cart"]')).tap();
        await page.waitForFunction(() => !document.querySelector(".eb-drawer"));
        check("touch commerce: cart closes by touch, no hover/keyboard required", true);
      }
      await page.screenshot({ path: join(EVIDENCE, mobile ? "mini-phone.png" : "mini-desktop.png") });
    });
  }
  for (const [name, options, query] of [
    ["owner Lite", {}, "?preference=lite"], ["theme without motion", {}, "?theme=none"],
    ["initial reduced motion", { reduced: true }, ""], ["Save-Data", { saveData: true }, ""],
    ["3G signal", { effectiveType: "3g" }, ""], ["low memory", { memory: 1 }, ""],
    ["no IntersectionObserver", { noObserver: true }, ""],
  ]) {
    await scenario(name, options, async (page, trace) => {
      await waitMode(page, "lite"); await scrollReveal(page); await sleep(100);
      const state = await facts(page); contentChecks(name, state);
      check(`${name}: zero mini download and native animation`, trace.miniRequests.length === 0 && state.calls === 0 && state.activeAnimations === 0 && state.cleanStyles, state.reason);
    }, query);
  }
  await scenario("nested independent CSS scope", {}, async (page) => {
    await waitMode(page, "lite");
    const independent = await page.evaluate(() => {
      const nested = document.createElement("div"); nested.className = "eb-scope"; nested.dataset.renderMode = "motion";
      const target = document.createElement("div"); target.className = "eb-reveal"; target.dataset.motionRecipe = "slide"; target.dataset.motionCss = "slide"; target.textContent = "Independent synthetic CSS scope";
      nested.appendChild(target); document.querySelector(".eb-scope").appendChild(nested);
      return { animationName: getComputedStyle(target).animationName, staticMarker: target.dataset.motionStatic };
    });
    check("owner Lite cannot force an independently owned nested scope static", independent.animationName === "eb-motion-slide" && independent.staticMarker === undefined, JSON.stringify(independent));
  }, "?preference=lite");
  await scenario("observer never fires", { neverObserve: true }, async (page, trace) => {
    await waitMode(page, "motion"); await scrollReveal(page); await sleep(200);
    contentChecks("observer never fires", await facts(page));
    check("observer never fires: no hidden state or unnecessary mini fetch", trace.miniRequests.length === 0);
  });
  for (const [name, options] of [["blocked mini chunk", { blockMini: true }], ["hung mini chunk", { holdMini: true }], ["no Web Animations API", { noWAAPI: true }], ["no animation enumeration API", { noEnumerations: true }]]) {
    await scenario(name, options, async (page, trace) => {
      await waitMode(page, "motion"); await scrollReveal(page); await waitEngine(page, "css");
      const state = await facts(page); contentChecks(name, state);
      check(`${name}: actual finite CSS fallback, no mini animations`, state.calls === 0 && state.engine === "css" && ((options.noWAAPI || options.noEnumerations) ? trace.miniRequests.length === 0 : trace.miniRequests.length > 0));
      await sleep(800);
      const settled = await facts(page);
      check(`${name}: CSS animation finishes and content remains visible`, settled.wrappersReadable && settled.activeAnimations === 0 && settled.cleanStyles);
    });
  }
  await scenario("partial native animation failure", { failNative: true }, async (page) => {
    await waitMode(page, "motion"); await scrollReveal(page); await waitEngine(page, "css");
    const state = await facts(page); contentChecks("partial native failure", state);
    check("partial native failure: started effect cancelled and CSS fallback used", state.calls > 0 && state.cancels > 0 && state.cleanStyles && state.engine === "css");
    await sleep(800);
    check("partial native failure: no residual animations or hidden content", (await facts(page)).activeAnimations === 0 && (await facts(page)).wrappersReadable);
  });
  await scenario("live reduced-motion preference", {}, async (page) => {
    await waitMode(page, "motion"); await scrollReveal(page); await waitEngine(page, "mini");
    const before = await facts(page);
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]); await waitMode(page, "lite");
    await scrollReveal(page, 2); await sleep(100);
    const after = await facts(page);
    check("live reduced motion: active effects cancelled and later sections stay still", after.activeAnimations === 0 && after.cleanStyles && after.calls === before.calls, JSON.stringify(after));
    contentChecks("live reduced motion", after);
  });
  await scenario("preference changes during lazy import", { holdMini: true }, async (page, trace) => {
    await waitMode(page, "motion"); await scrollReveal(page);
    await page.waitForFunction(() => document.querySelector(".eb-scope")?.dataset.motionEngine === "loading");
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]); await waitMode(page, "lite");
    for (const request of trace.held.splice(0)) await request.continue();
    await sleep(600);
    const state = await facts(page);
    check("lazy import race: no animation after reduced-motion change", state.calls === 0 && state.engine === "static" && state.cleanStyles);
    contentChecks("lazy import race", state);
  });
  await scenario("live network constraints", {}, async (page) => {
    await waitMode(page, "motion"); await scrollReveal(page); await waitEngine(page, "mini");
    await page.evaluate(() => { window.__qaNetwork.saveData = true; window.__qaNetwork.dispatchEvent(new Event("change")); }); await waitMode(page, "lite");
    let state = await facts(page);
    check("live Save-Data: cancel active controls and retain content", state.reason === "save-data" && state.activeAnimations === 0 && state.cleanStyles);
    await page.evaluate(() => { window.__qaNetwork.saveData = false; window.__qaNetwork.effectiveType = "3g"; window.__qaNetwork.dispatchEvent(new Event("change")); });
    state = await facts(page);
    check("live 3G: remains Lite", state.reason === "slow-connection" && state.mode === "lite");
    contentChecks("live network constraints", state);
  });
  await scenario("React scope unmount", {}, async (page) => {
    await waitMode(page, "motion"); await scrollReveal(page); await waitEngine(page, "mini");
    const oldCalls = (await facts(page)).calls;
    await page.evaluate(() => document.getElementById("qa-unmount-fixture").click());
    await page.waitForSelector("#qa-fixture-unmounted");
    await page.evaluate(() => { window.__qaNetwork.dispatchEvent(new Event("change")); });
    const state = await page.evaluate(() => ({ scopeAbsent: !document.querySelector(".eb-scope"), calls: window.__qaMotionCalls.length, cancels: window.__qaMotionCancels }));
    check("unmount: removed scope cannot animate after preference/network events", state.scopeAbsent && state.calls === oldCalls && state.cancels > 0, JSON.stringify(state));
  });
} finally { await browser.close(); }
const failed = results.filter((result) => !result.ok).length;
const report = { browser: version, environment: "headless desktop Chrome; Android/touch/resource signals simulated", fixture: "actual Next renderer + actual motion/mini, synthetic data; not DB/provider proof", results, runs, passed: results.length - failed, failed, skipped: 0 };
writeFileSync(join(EVIDENCE, "results.json"), JSON.stringify(report, null, 2));
console.log(`\n${report.passed} passed, ${failed} failed, 0 skipped. Physical Android, production LCP/INP/CLS, real payments/providers NOT RUN by this script.`);
process.exit(failed ? 1 : 0);
