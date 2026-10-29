/**
 * Motion-system visual evidence.
 *
 * Captures the pages that exist without a database or a session (the marketing homepage and the
 * sign-in screen) at the six mandated viewports, once with motion enabled and once with
 * `prefers-reduced-motion: reduce`, and records what the browser actually computed:
 *
 *   • the resolved palette (so a capture proves the espresso/cream/amber brand, not just HTTP 200);
 *   • the computed transition on the shared navigation primitive, with and without reduced motion;
 *   • whether the reduced-motion run reports any animation still running.
 *
 * Usage: CHROME_PATH=/tmp/chromium BASE_URL=http://127.0.0.1:3200 node scripts/motion/motion-capture.mjs
 * Exit: 0 all checks pass, 1 a check failed, 2 nothing captured.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const CHROME = process.env.CHROME_PATH;
const BASE = process.env.BASE_URL || "http://127.0.0.1:3200";
const OUT = path.join(process.cwd(), ".cache", "motion-evidence");

if (!CHROME) {
  console.error("BLOCKED CHROME_PATH is not set; nothing was captured, and that is not a pass.");
  process.exit(2);
}

const VIEWPORTS = [
  { label: "320x568", width: 320, height: 568 },
  { label: "360x800", width: 360, height: 800 },
  { label: "390x844", width: 390, height: 844 },
  { label: "430x932", width: 430, height: 932 },
  { label: "768x1024", width: 768, height: 1024 },
  { label: "1366x768", width: 1366, height: 768 },
];

const ROUTES = [
  { slug: "home", path: "/" },
  { slug: "login", path: "/login" },
];

mkdirSync(OUT, { recursive: true });

const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  headless: true,
});

try {
  for (const reduced of [false, true]) {
    const mode = reduced ? "reduced-motion" : "motion";
    const page = await browser.newPage();
    await page.emulateMediaFeatures([
      ...(reduced ? [{ name: "prefers-reduced-motion", value: "reduce" }] : []),
    ]);
    for (const viewport of VIEWPORTS) {
      await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
      for (const route of ROUTES) {
        const response = await page.goto(`${BASE}${route.path}`, { waitUntil: "networkidle2", timeout: 45000 }).catch(() => null);
        const status = response?.status() ?? 0;
        const name = `${mode} ${viewport.label} ${route.slug}`;
        if (status !== 200) {
          record(false, `${name} renders`, `HTTP ${status}`);
          continue;
        }
        const measured = await page.evaluate(() => {
          const root = getComputedStyle(document.documentElement);
          const nav = document.querySelector(".jata-nav-link");
          const navStyle = nav ? getComputedStyle(nav) : null;
          const running = document.getAnimations ? document.getAnimations().filter((a) => a.playState === "running").length : -1;
          return {
            paper: root.getPropertyValue("--jata-paper").trim(),
            accent: root.getPropertyValue("--jata-accent").trim(),
            ink: root.getPropertyValue("--jata-ink").trim(),
            navTransitionDuration: navStyle ? navStyle.transitionDuration : "no-nav-link",
            runningAnimations: running,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            heroVisible: Boolean(document.querySelector("h1")) && (document.querySelector("h1")?.getBoundingClientRect().height ?? 0) > 0,
          };
        });
        await page.screenshot({ path: path.join(OUT, `${mode}__${viewport.label}__${route.slug}.jpg`), fullPage: false, type: "jpeg", quality: 82 });
        writeFileSync(
          path.join(OUT, `${mode}__${viewport.label}__${route.slug}.json`),
          JSON.stringify({ mode, viewport: viewport.label, route: route.slug, status, ...measured }, null, 2),
        );
        record(status === 200, `${name} renders`, `HTTP ${status}`);
        record(measured.overflow <= 0, `${name} has no horizontal overflow`, `overflow=${measured.overflow}px`);
        record(measured.heroVisible, `${name} keeps its heading visible`);
      }
    }
    await page.close();
  }

  // Palette identity, measured in the browser rather than read from the stylesheet.
  const page = await browser.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 45000 });
  const palette = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      paper: root.getPropertyValue("--jata-paper").trim(),
      accent: root.getPropertyValue("--jata-accent").trim(),
      ink: root.getPropertyValue("--jata-ink").trim(),
    };
  });
  record(palette.accent === "#d97706", "accent is the existing amber", `--jata-accent=${palette.accent}`);
  record(palette.paper === "#fafaf8", "paper is the existing cream", `--jata-paper=${palette.paper}`);
  record(palette.ink === "#18181b", "ink is the existing espresso", `--jata-ink=${palette.ink}`);

  // Reduced motion must neutralise the transition the motion layer adds.
  const probe = await browser.newPage();
  await probe.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await probe.setViewport({ width: 1366, height: 768 });
  await probe.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 45000 });
  const reducedNav = await probe.evaluate(() => {
    const nav = document.querySelector(".jata-nav-link");
    return nav ? getComputedStyle(nav).transitionDuration : "no-nav-link";
  });
  record(reducedNav === "0s" || reducedNav === "0.01ms" || reducedNav === "0.00001s", "reduced motion neutralises the nav transition", `transition-duration=${reducedNav}`);
  await probe.close();
  await page.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(OUT, "summary.log"), results.map((r) => `${r.ok ? "PASS" : "FAIL"} ${r.name} — ${r.detail ?? ""}`).join("\n"));
console.log(`\nRESULT: ${failed.length === 0 ? "PASS" : "FAIL"} (${results.length - failed.length}/${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);
