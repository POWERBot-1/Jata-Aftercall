#!/usr/bin/env node
/**
 * Real-browser checks for the Immersive preview harness (Phase 5).
 *
 * Run against a running `next dev` server:
 *   CHROME_PATH=/path/to/chrome BASE_URL=http://localhost:3100 node scripts/browser/immersive-preview.check.mjs
 *
 * Scenarios: successful 3D render, failed model load, unsupported WebGL, reduced motion,
 * Save-Data, low-memory and unknown-memory mobile devices, opt-in gating, and static first paint.
 * External hosts are intercepted and answered locally; any other external request is aborted, so
 * the run makes no outbound network calls. Exits 1 if any scenario fails. Skipped is not passed.
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

/** Minimal valid GLB: one triangle. Built in code, so no binary is committed. */
function triangleGlb() {
  const positions = Buffer.alloc(36);
  [0, 0.8, 0, -0.8, -0.8, 0, 0.8, -0.8, 0].forEach((v, i) => positions.writeFloatLE(v, i * 4));
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-0.8, -0.8, 0], max: [0.8, 0.8, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
  };
  let jsonBytes = Buffer.from(JSON.stringify(json));
  while (jsonBytes.length % 4 !== 0) jsonBytes = Buffer.concat([jsonBytes, Buffer.from(" ")]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  const jsonChunk = Buffer.alloc(8);
  jsonChunk.writeUInt32LE(jsonBytes.length, 0);
  jsonChunk.writeUInt32LE(0x4e4f534a, 4);
  const binChunk = Buffer.alloc(8);
  binChunk.writeUInt32LE(36, 0);
  binChunk.writeUInt32LE(0x004e4942, 4);
  const total = 12 + 8 + jsonBytes.length + 8 + 36;
  header.writeUInt32LE(total, 8);
  return Buffer.concat([header, jsonChunk, jsonBytes, binChunk, positions]);
}
const GLB = triangleGlb();
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#e7d9c4"/><text x="20" y="130" font-size="22" fill="#333">Static product image</text></svg>',
);

const CORS = { "access-control-allow-origin": "*" };
const results = [];
const counts = { glbRequests: 0, glbFailures: 0 };

async function newPage(browser, opts) {
  const page = await browser.newPage();
  const { viewport = { width: 1280, height: 800 }, connection, noWebgl = false, reduceMotion = false, mobile = false } = opts;
  // `deviceMemory: undefined` must mean "not reported", so presence is checked, not defaulted.
  const deviceMemory = "deviceMemory" in opts ? opts.deviceMemory : 8;
  const cores = opts.cores ?? 8;
  await page.setViewport({ ...viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  if (reduceMotion) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.evaluateOnNewDocument(
    ({ deviceMemory, cores, connection, noWebgl }) => {
      const define = (key, value) => {
        try {
          Object.defineProperty(Navigator.prototype, key, { get: () => value, configurable: true });
        } catch {}
      };
      define("deviceMemory", deviceMemory);
      define("hardwareConcurrency", cores);
      if (connection) define("connection", connection);
      if (noWebgl) {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
          return original.call(this, type, ...rest);
        };
      }
    },
    { deviceMemory, cores, connection, noWebgl },
  );
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(BASE_URL)) return req.continue();
    if (url === "https://models.preview.test/product-ok.glb") {
      counts.glbRequests += 1;
      return req.respond({ status: 200, headers: { ...CORS, "content-type": "model/gltf-binary" }, body: GLB });
    }
    if (url === "https://models.preview.test/product-missing.glb") {
      counts.glbRequests += 1;
      counts.glbFailures += 1;
      return req.respond({ status: 404, headers: CORS, body: "not found" });
    }
    if (url === "https://images.preview.test/product-fallback.svg") {
      return req.respond({ status: 200, headers: { ...CORS, "content-type": "image/svg+xml" }, body: SVG });
    }
    return req.abort();
  });
  return page;
}

async function state(page) {
  return page.evaluate(() => {
    const root = document.querySelector("#product-preview [data-immersive-reason]");
    const canvas = document.querySelector("#product-preview canvas");
    const img = document.querySelector("#product-preview img");
    const hiddenWrapper = document.querySelector("#product-preview div[hidden]");
    return {
      reason: root?.getAttribute("data-immersive-reason") ?? null,
      mode: root?.getAttribute("data-immersive-mode") ?? null,
      canvasCount: document.querySelectorAll("#product-preview canvas").length,
      canvasVisible: Boolean(canvas && !hiddenWrapper && canvas.offsetWidth > 0),
      imageVisible: Boolean(img && img.offsetWidth > 0 && img.complete && img.naturalWidth > 0),
    };
  });
}

/** Waits until the decision has been made (not "pending"). */
async function settled(page, timeout = 15000) {
  await page.waitForFunction(
    () => {
      const root = document.querySelector("#product-preview [data-immersive-reason]");
      return root && root.getAttribute("data-immersive-reason") !== "pending";
    },
    { timeout },
  );
}

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function scenario(browser, name, opts, path, body) {
  const page = await newPage(browser, opts);
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err.message || err).slice(0, 200)));
  try {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await body(page, pageErrors);
  } catch (err) {
    check(`${name} (scenario ran)`, false, String(err.message || err).slice(0, 300));
  } finally {
    await page.close();
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

try {
  // 1. Static first paint: JavaScript disabled, the image must already be in the HTML.
  {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => (req.url().startsWith(BASE_URL) ? req.continue() : req.respond({ status: 200, headers: CORS, body: req.url().endsWith(".svg") ? SVG : "" })));
    await page.goto(`${BASE_URL}/dev/immersive-preview`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const html = await page.content();
    check("static first paint: image in server HTML without JavaScript", html.includes("Preview product, front view") && html.includes("product-fallback.svg") && !html.includes("<canvas"));
    await page.close();
  }

  // 2. Successful 3D render on a capable desktop.
  await scenario(browser, "successful 3D render (desktop)", {}, "/dev/immersive-preview?model=ok", async (page, errors) => {
    await settled(page);
    await page.waitForFunction(() => document.querySelectorAll("#product-preview canvas").length === 1, { timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    const s = await state(page);
    check("3D: decision is eligible and renders", s.reason === "eligible" && s.mode === "3d", JSON.stringify(s));
    check("3D: canvas visible and static image removed", s.canvasVisible && !s.imageVisible, JSON.stringify(s));
    await page.screenshot({ path: join(SHOTS, "3d-desktop.png") });
    check("3D: model fetched over HTTPS", counts.glbRequests >= 1 && counts.glbFailures === 0, `requests=${counts.glbRequests}`);
    check("3D: no uncaught page errors", errors.length === 0, errors.join(" | "));
  });

  // 3. Failed model load keeps the static image.
  await scenario(browser, "failed model load", {}, "/dev/immersive-preview?model=missing", async (page) => {
    await settled(page);
    await page.waitForFunction(() => document.querySelector("#product-preview [data-immersive-reason]")?.getAttribute("data-immersive-reason") === "model-load-failed", { timeout: 30000 }).catch(() => {});
    const s = await state(page);
    check("failed load: reason model-load-failed, static image, no canvas", s.reason === "model-load-failed" && s.mode === "static" && s.canvasCount === 0 && s.imageVisible, JSON.stringify(s));
    await page.screenshot({ path: join(SHOTS, "3d-failed-load.png") });
  });

  // 4. Unsupported WebGL.
  await scenario(browser, "unsupported WebGL", { noWebgl: true }, "/dev/immersive-preview?model=ok", async (page) => {
    await settled(page);
    const s = await state(page);
    check("no WebGL: reason no-webgl, static image, no canvas", s.reason === "no-webgl" && s.mode === "static" && s.canvasCount === 0 && s.imageVisible, JSON.stringify(s));
    await page.screenshot({ path: join(SHOTS, "no-webgl.png") });
  });

  // 5. Reduced motion.
  await scenario(browser, "reduced motion", { reduceMotion: true }, "/dev/immersive-preview?model=ok", async (page) => {
    await settled(page);
    const s = await state(page);
    check("reduced motion: reason reduced-motion, static image, no canvas", s.reason === "reduced-motion" && s.canvasCount === 0 && s.imageVisible, JSON.stringify(s));
  });

  // 6. Save-Data.
  await scenario(browser, "Save-Data", { connection: { saveData: true, effectiveType: "4g" } }, "/dev/immersive-preview?model=ok", async (page) => {
    await settled(page);
    const s = await state(page);
    check("Save-Data: reason save-data, no canvas", s.reason === "save-data" && s.canvasCount === 0 && s.imageVisible, JSON.stringify(s));
  });

  // 7. Mobile, low memory (2 GB Android).
  await scenario(browser, "mobile low-memory", { viewport: { width: 390, height: 844 }, mobile: true, deviceMemory: 2, cores: 8 }, "/dev/immersive-preview?model=ok", async (page) => {
    await settled(page);
    const s = await state(page);
    check("mobile 2 GB: reason low-memory, static image, no canvas", s.reason === "low-memory" && s.canvasCount === 0 && s.imageVisible, JSON.stringify(s));
    await page.screenshot({ path: join(SHOTS, "mobile-low-memory.png"), fullPage: true });
  });

  // 8. Mobile where memory is not reported (iOS Safari): 3D stays off by design.
  await scenario(browser, "mobile memory unknown", { viewport: { width: 390, height: 844 }, mobile: true, deviceMemory: undefined, cores: 8 }, "/dev/immersive-preview?model=ok", async (page) => {
    await settled(page);
    const s = await state(page);
    check("mobile memory unknown: reason memory-unknown, no canvas", s.reason === "memory-unknown" && s.canvasCount === 0 && s.imageVisible, JSON.stringify(s));
  });

  // 9. Opt-in gating: only the explicit "immersive" preference may use 3D.
  for (const preference of ["lite", "motion", "auto"]) {
    await scenario(browser, `opt-in gate (${preference})`, {}, `/dev/immersive-preview?model=ok&preference=${preference}`, async (page) => {
      await settled(page);
      const s = await state(page);
      check(`opt-in: preference ${preference} never shows 3D`, s.reason === "not-opted-in" && s.canvasCount === 0 && s.imageVisible, JSON.stringify(s));
    });
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, 0 skipped`);
writeFileSync(join(SHOTS, "results.json"), JSON.stringify({ results, counts }, null, 2));
process.exit(failed.length ? 1 : 0);
