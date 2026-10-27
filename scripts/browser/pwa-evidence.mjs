/**
 * Real-Chrome PWA evidence against a LOCAL production build (Phase 8/16).
 *
 * Two phases are needed because Chrome DevTools "offline" emulation does NOT apply to fetches
 * made inside a service worker (a known Chrome behaviour). Phase `prime` registers the worker in
 * a persistent browser profile; phase `offline` is run with the local server STOPPED, producing
 * a genuine network failure rather than an emulation.
 *
 *   # 1. with `next start` running on :3001
 *   PWA_PHASE=prime CHROME_PATH=/tmp/chromium node scripts/browser/pwa-evidence.mjs
 *   # 2. stop `next start`, then
 *   PWA_PHASE=offline CHROME_PATH=/tmp/chromium node scripts/browser/pwa-evidence.mjs
 */
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3001";
const PHASE = process.env.PWA_PHASE || "prime";
const PROFILE = process.env.PWA_PROFILE || "/tmp/jata-pwa-profile";
const OUT = path.join(process.cwd(), "docs", "evidence", "screenshots");
const REPORT = path.join(process.cwd(), "docs", "evidence", "pwa-evidence.json");
mkdirSync(OUT, { recursive: true });

const evidence = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, "utf8")) : { generatedAt: new Date().toISOString(), baseUrl: BASE, checks: {}, details: {} };
evidence.generatedAt = new Date().toISOString();
evidence.phases = { ...(evidence.phases || {}), [PHASE]: "executed" };

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/tmp/chromium",
  headless: "shell",
  userDataDir: PROFILE,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const errors = [];
const notFound = [];
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.on("response", (res) => { if (res.status() === 404) notFound.push(new URL(res.url()).pathname); });
page.on("console", (m) => { if (m.type() === "error" && PHASE === "prime") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => { if (PHASE === "prime") errors.push(`pageerror: ${String(e).slice(0, 200)}`); });

try {
  if (PHASE === "prime") {
    const response = await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 45_000 });
    evidence.details.homeStatus = response?.status() ?? 0;

    evidence.details.manifest = await page.evaluate(async () => {
      const href = document.querySelector('link[rel="manifest"]')?.getAttribute("href") || null;
      if (!href) return { href, ok: false };
      const res = await fetch(href);
      const json = await res.json();
      return { href, ok: res.ok, name: json.name, display: json.display, icons: json.icons?.length ?? 0, themeColor: json.theme_color };
    });
    evidence.checks.manifestValid = evidence.details.manifest.ok && evidence.details.manifest.display === "standalone" && evidence.details.manifest.icons >= 2;

    evidence.details.serviceWorker = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return { supported: false, registered: false, controlled: false };
      try {
        const registration = await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 12_000))]);
        return { supported: true, registered: Boolean(registration.active), controlled: Boolean(navigator.serviceWorker.controller), scope: registration.scope, state: registration.active?.state || null };
      } catch (error) {
        return { supported: true, registered: false, controlled: false, error: String(error) };
      }
    });
    evidence.checks.serviceWorkerRegistered = evidence.details.serviceWorker.registered === true;

    for (const icon of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/sw.js", "/offline.html", "/favicon.ico"]) {
      evidence.details[`asset${icon}`] = await page.evaluate(async (url) => {
        const r = await fetch(url, { cache: "no-store" });
        return { status: r.status, type: r.headers.get("content-type") || "" };
      }, icon);
    }
    evidence.checks.assetsReachable = ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/sw.js", "/offline.html", "/favicon.ico"]
      .every((icon) => evidence.details[`asset${icon}`]?.status === 200);

    await page.evaluate(async () => { await fetch("/health").catch(() => {}); });
    await page.goto(`${BASE}/install`, { waitUntil: "networkidle2", timeout: 45_000 }).catch(() => {});
    evidence.details.cacheContents = await page.evaluate(async () => {
      const names = await caches.keys();
      const entries = [];
      for (const name of names) entries.push(...(await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname));
      return { names, entries: [...new Set(entries)] };
    });
    const cached = evidence.details.cacheContents.entries || [];
    evidence.checks.noApiOrHtmlCached = !cached.some((entry) => entry.startsWith("/api/") || entry === "/install" || entry === "/" || entry.includes("/dashboard"));
    evidence.checks.onlySafeAssetsCached = cached.every((entry) => /^\/(?:_next\/static\/|icons\/|landing\/|category\/|workspace\/)/.test(entry) || entry === "/offline.html" || entry === "/manifest.json");
    await page.screenshot({ path: path.join(OUT, "pwa__install-390x844.jpg"), type: "jpeg", quality: 65 });
    evidence.details.consoleErrors = errors;
    evidence.details.notFoundResponses = [...new Set(notFound)];
    evidence.checks.noConsoleErrors = errors.length === 0;
  } else {
    // Genuine offline: the local server is stopped. The service worker is still installed in the
    // persistent profile; its network-first navigation fetch fails and must serve the notice.
    const offline = await page.goto(`${BASE}/pricing`, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
    const offlineData = {
      status: offline?.status() ?? 0,
      heading: await page.evaluate(() => document.querySelector("h1")?.textContent?.trim() || ""),
      text: await page.evaluate(() => document.body.innerText.slice(0, 500)),
      controller: await page.evaluate(() => Boolean(navigator.serviceWorker?.controller)),
    };
    evidence.details.offline = offlineData;
    evidence.checks.offlineNoticeServed = /offline/i.test(offlineData.heading) && /AI|payment|connection/i.test(offlineData.text);
    await page.screenshot({ path: path.join(OUT, "pwa__offline-390x844.jpg"), type: "jpeg", quality: 65 });
  }
} catch (error) {
  evidence.details.fatal = String(error);
  evidence.checks.noFatalError = false;
} finally {
  await browser.close();
}

writeFileSync(REPORT, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ phase: PHASE, checks: evidence.checks, serviceWorker: evidence.details.serviceWorker, offline: evidence.details.offline, consoleErrors: evidence.details.consoleErrors, notFound: evidence.details.notFoundResponses }, null, 2));
if (Object.values(evidence.checks).some((value) => value === false)) process.exitCode = 1;
