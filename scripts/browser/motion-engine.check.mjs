#!/usr/bin/env node
/**
 * Real-browser checks for the JavaScript motion engine (Phase 2).
 *
 * Run against a running `next dev` server:
 *   CHROME_PATH=/path/to/chrome BASE_URL=http://localhost:3100 node scripts/browser/motion-engine.check.mjs
 *
 * Scenarios: static first paint with no JavaScript, the expressive engine actually loading and
 * revealing every section, the four refusals that must never download it (subtle theme, reduced
 * motion, Save-Data, Lite), a low-power device, deterministic choreography per seed, and a blocked
 * chunk. It also records how many bytes the engine chunk costs.
 *
 * Any request that is not the local server is aborted, so the run makes no outbound network calls.
 * Exits 2 when no Chrome binary is given — skipped is not passed. Exits 1 if any scenario fails.
 */

import puppeteer from "puppeteer-core";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const CHROME_PATH = process.env.CHROME_PATH;
const BASE_URL = (process.env.BASE_URL || "http://localhost:3100").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || join(process.cwd(), "tmp-browser-evidence");
if (!CHROME_PATH) {
  console.error("CHROME_PATH is required (path to a Chrome/Chromium binary). Not run.");
  process.exit(2);
}
mkdirSync(SHOTS, { recursive: true });

const HARNESS = "/dev/motion-preview";
const results = [];
const bytes = { engineChunk: 0, engineChunkRequests: 0, blockedRuns: 0 };

async function newPage(browser, { blockEngine = false, ...opts } = {}) {
  const page = await browser.newPage();
  const { viewport = { width: 1280, height: 800 }, mobile = false, reduceMotion = false } = opts;
  const deviceMemory = "deviceMemory" in opts ? opts.deviceMemory : 8;
  const cores = opts.cores ?? 8;
  await page.setViewport({ ...viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  if (reduceMotion) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.evaluateOnNewDocument(
    ({ deviceMemory, cores, connection }) => {
      const define = (key, value) => {
        try {
          Object.defineProperty(Navigator.prototype, key, { get: () => value, configurable: true });
        } catch {}
      };
      define("deviceMemory", deviceMemory);
      define("hardwareConcurrency", cores);
      if (connection) define("connection", connection);
    },
    { deviceMemory, cores, connection: opts.connection },
  );
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (!url.startsWith(BASE_URL)) return req.abort();
    // The engine chunk is the only lazily imported module the harness pulls.
    if (/MotionRuntime/.test(url)) {
      bytes.engineChunkRequests += 1;
      if (blockEngine) {
        bytes.blockedRuns += 1;
        return req.abort();
      }
    }
    return req.continue();
  });
  page.on("response", async (res) => {
    if (/MotionRuntime/.test(res.url())) {
      try {
        const buffer = await res.buffer();
        bytes.engineChunk += buffer.length;
      } catch {}
    }
  });
  return page;
}

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function readState(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const sections = Array.from(document.querySelectorAll("main section[id]")).map((el) => {
      const computed = getComputedStyle(el.closest("[data-eb-motion]") ?? el);
      const wrapper = el.closest("[data-eb-motion]") ?? el;
      return {
        id: el.id,
        text: (el.textContent || "").trim().length,
        recipe: wrapper.getAttribute("data-eb-motion"),
        opacity: Number.parseFloat(computed.opacity),
        visible: wrapper.getBoundingClientRect().height > 0,
      };
    });
    return {
      engine: root.getAttribute("data-motion-engine"),
      plan: root.getAttribute("data-motion-plan"),
      renderMode: root.getAttribute("data-render-mode"),
      sections,
    };
  });
}

/** Waits for the mount effect to have written its plan, then lets any chunk settle. */
async function settled(page, timeout = 20000) {
  await page.waitForFunction(() => document.documentElement.getAttribute("data-motion-plan") !== null, { timeout });
  await new Promise((r) => setTimeout(r, 1200));
}

async function scenario(browser, name, opts, query, body) {
  const page = await newPage(browser, opts);
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err.message || err).slice(0, 200)));
  try {
    await page.goto(`${BASE_URL}${HARNESS}${query}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await body(page, errors);
  } catch (err) {
    check(`${name} (scenario ran)`, false, String(err.message || err).slice(0, 300));
  } finally {
    await page.close();
  }
}

const allVisible = (state) => state.sections.length > 0 && state.sections.every((s) => s.text > 0 && s.opacity > 0.99);

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

try {
  // 1. No JavaScript at all: the server HTML must already carry every section.
  {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => (req.url().startsWith(BASE_URL) ? req.continue() : req.abort()));
    await page.goto(`${BASE_URL}${HARNESS}?level=expressive`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const html = await page.content();
    check(
      "no JavaScript: every section is in the server HTML with its CSS fallback",
      html.includes("Fresh tilapia, grilled to order") &&
        html.includes("Open 8am to 9pm") &&
        html.includes("Find us") &&
        html.includes("eb-reveal") &&
        !html.includes("data-motion-engine"),
    );
    await page.close();
  }

  // 2. Expressive on a capable device: the engine loads and every section is revealed.
  await scenario(browser, "expressive engine", {}, "?level=expressive", async (page, errors) => {
    await settled(page);
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 300) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
    });
    await new Promise((r) => setTimeout(r, 1500));
    const state = await readState(page);
    check("expressive: engine loaded", state.engine === "js", JSON.stringify({ engine: state.engine, plan: state.plan }));
    check("expressive: sections carry recipes", state.sections.some((s) => s.recipe), JSON.stringify(state.sections.map((s) => s.recipe)));
    check("expressive: every section visible after the scroll", allVisible(state), JSON.stringify(state.sections.map((s) => [s.id, s.opacity])));
    check("expressive: no uncaught page errors", errors.length === 0, errors.join(" | "));
    await page.screenshot({ path: join(SHOTS, "motion-expressive.png"), fullPage: true });
  });

  // 3. Subtle treatment: CSS only, no chunk.
  await scenario(browser, "subtle treatment", {}, "?level=subtle", async (page) => {
    await settled(page);
    const state = await readState(page);
    check("subtle: no engine, plan says subtle-uses-css", state.engine === null && state.plan === "subtle-uses-css", JSON.stringify({ engine: state.engine, plan: state.plan }));
    check("subtle: no engine chunk requested", bytes.engineChunkRequests === 0, `requests=${bytes.engineChunkRequests}`);
    check("subtle: content visible", allVisible(state));
  });

  // 4. Reduced motion: the visitor's own setting wins.
  await scenario(browser, "reduced motion", { reduceMotion: true }, "?level=expressive", async (page) => {
    await settled(page);
    const state = await readState(page);
    check("reduced motion: no engine, plan says reduced-motion", state.engine === null && state.plan === "reduced-motion", JSON.stringify({ engine: state.engine, plan: state.plan }));
    check("reduced motion: everything visible immediately", allVisible(state));
  });

  // 5. Save-Data.
  await scenario(browser, "Save-Data", { connection: { saveData: true, effectiveType: "4g" } }, "?level=expressive", async (page) => {
    await settled(page);
    const state = await readState(page);
    check("Save-Data: no engine, plan says save-data", state.engine === null && state.plan === "save-data", JSON.stringify({ engine: state.engine, plan: state.plan }));
    check("Save-Data: content visible", allVisible(state));
  });

  // 6. Lite preference.
  await scenario(browser, "lite preference", {}, "?level=expressive&preference=lite", async (page) => {
    await settled(page);
    const state = await readState(page);
    check("Lite: no engine, plan says render-mode-lite", state.engine === null && state.plan === "render-mode-lite", JSON.stringify({ engine: state.engine, plan: state.plan }));
    check("Lite: content visible", allVisible(state));
  });

  // 7. Low-power Android: the engine still runs, on the cheap recipe set.
  await scenario(browser, "low-power mobile", { viewport: { width: 390, height: 844 }, mobile: true, deviceMemory: 2, cores: 8 }, "?level=expressive", async (page) => {
    await settled(page);
    const state = await readState(page);
    check("low power: plan records the reduced recipe set", (state.plan || "").includes("low-power-recipe-set"), JSON.stringify({ plan: state.plan }));
    check("low power: content visible", allVisible(state));
    await page.screenshot({ path: join(SHOTS, "motion-low-power.png"), fullPage: true });
  });

  // 8. Deterministic per seed, different across seeds.
  const recipesFor = async (seed) => {
    const page = await newPage(browser);
    await page.goto(`${BASE_URL}${HARNESS}?level=expressive&seed=${seed}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const map = await page.evaluate(() =>
      Object.fromEntries(
        Array.from(document.querySelectorAll("[data-eb-motion]")).map((el) => [el.querySelector("section[id]")?.id ?? "?", el.getAttribute("data-eb-motion")]),
      ),
    );
    await page.close();
    return map;
  };
  {
    const a1 = await recipesFor("restaurant:jata-grill");
    const a2 = await recipesFor("restaurant:jata-grill");
    const b = await recipesFor("salon:glow-nairobi");
    check("deterministic: same seed, same choreography", JSON.stringify(a1) === JSON.stringify(a2), JSON.stringify(a1));
    check("deterministic: different seed, different choreography", JSON.stringify(a1) !== JSON.stringify(b), `${JSON.stringify(a1)} vs ${JSON.stringify(b)}`);
  }

  // 9. Blocked chunk: the CSS reveal stands and nothing is left hidden.
  await scenario(browser, "blocked engine chunk", { blockEngine: true }, "?level=expressive", async (page) => {
    await settled(page);
    await new Promise((r) => setTimeout(r, 1500));
    const state = await readState(page);
    check("blocked chunk: engine attribute never set", state.engine === null, JSON.stringify({ engine: state.engine }));
    check("blocked chunk: the request was actually attempted and blocked", bytes.blockedRuns > 0, `blocked=${bytes.blockedRuns}`);
    check("blocked chunk: every section still visible", allVisible(state), JSON.stringify(state.sections.map((s) => [s.id, s.opacity])));
  });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, 0 skipped`);
console.log(`engine chunk: ${bytes.engineChunkRequests} request(s), ${bytes.engineChunk} bytes uncompressed`);
writeFileSync(join(SHOTS, "motion-results.json"), JSON.stringify({ results, bytes }, null, 2));
process.exit(failed.length ? 1 : 0);
