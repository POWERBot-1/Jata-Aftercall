/**
 * Real-Chrome evidence for the six mandated viewports (owner directive Phase 1/3/16).
 *
 * Runs against a LOCAL dev/build server (no production traffic, no database writes). It captures
 * genuine viewport screenshots, measures the four contact actions (icon, label, target, size,
 * visibility), checks horizontal overflow and console errors, and exercises the Share fallback.
 *
 *   CHROME_PATH=/tmp/chromium BASE_URL=http://localhost:3000 \
 *     node scripts/browser/contact-actions-evidence.mjs
 *
 * In a restricted sandbox Chromium's shared libraries may need LD_LIBRARY_PATH to include the
 * extracted @sparticuz/chromium `al2.tar.br` / `al2023.tar.br` lib directories.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = path.join(process.cwd(), "docs", "evidence", "screenshots");
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { width: 320, height: 568, label: "320x568" },
  { width: 360, height: 800, label: "360x800" },
  { width: 390, height: 844, label: "390x844" },
  { width: 430, height: 932, label: "430x932" },
  { width: 768, height: 1024, label: "768x1024" },
  { width: 1366, height: 768, label: "1366x768" },
];

const DEMOS = ["nyumbani-kitchen", "marys-beauty-studio", "kamau-auto-care", "john-kamau-properties"];
const MARKETING = [
  { slug: "home", path: "/" },
  { slug: "pricing", path: "/pricing" },
  { slug: "products", path: "/products" },
  { slug: "install", path: "/install" },
  { slug: "privacy", path: "/privacy" },
];
const TARGETS = [
  ...DEMOS.map((slug) => ({ slug, path: `/dev/contact-actions/${slug}`, kind: "demo" })),
  ...MARKETING,
];

const results = [];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/tmp/chromium",
  headless: "shell",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

try {
  const context = browser.defaultBrowserContext();
  try { await context.overridePermissions(BASE, ["clipboard-read", "clipboard-write"]); } catch { /* optional */ }

  for (const target of TARGETS) {
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage();
      await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
      const consoleErrors = [];
      page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300)); });
      page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`));
      let responseStatus = 0;
      try {
        const response = await page.goto(`${BASE}${target.path}`, { waitUntil: "networkidle2", timeout: 45_000 });
        responseStatus = response?.status() ?? 0;
      } catch (error) {
        consoleErrors.push(`navigation: ${String(error).slice(0, 200)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));

      const measured = await page.evaluate(() => {
        const group = document.querySelector('[data-contact-group="primary"]');
        const actions = group ? [...group.querySelectorAll("[data-contact-action]")].map((element) => {
          const rect = element.getBoundingClientRect();
          const icon = element.querySelector("svg");
          const label = element.querySelector(".jata-contact-action__label");
          const style = getComputedStyle(element);
          return {
            key: element.getAttribute("data-contact-action"),
            state: element.getAttribute("data-contact-state") || null,
            href: element.getAttribute("href") || null,
            label: label?.textContent?.trim() || "",
            icon: Boolean(icon),
            iconSize: icon ? Math.round(icon.getBoundingClientRect().width) : 0,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
            ariaLabel: element.getAttribute("aria-label") || null,
          };
        }) : [];
        return {
          title: document.title,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          actions,
          hasServiceWorker: "serviceWorker" in navigator,
          manifestHref: document.querySelector('link[rel="manifest"]')?.getAttribute("href") || null,
        };
      });

      let shareOutcome = null;
      if (target.kind === "demo" && viewport.label === "390x844") {
        try {
          await page.click('[data-contact-group="primary"] [data-contact-action="share"]');
          await new Promise((resolve) => setTimeout(resolve, 200));
          shareOutcome = await page.evaluate(async () => ({
            status: document.querySelector('[data-contact-status="primary"]')?.textContent?.trim() || "",
            clipboard: await navigator.clipboard?.readText?.().catch(() => "") || "",
          }));
        } catch (error) {
          shareOutcome = { error: String(error).slice(0, 200) };
        }
      }

      const screenshot = `${viewport.label}__${target.slug}.jpg`;
      await page.screenshot({ path: path.join(OUT, screenshot), type: "jpeg", quality: 62 });
      results.push({
        page: target.slug,
        url: target.path,
        kind: target.kind || "marketing",
        viewport: viewport.label,
        httpStatus: responseStatus,
        screenshot: `docs/evidence/screenshots/${screenshot}`,
        consoleErrors,
        measured,
        shareOutcome,
      });
      console.log(`${viewport.label.padEnd(9)} ${target.slug.padEnd(24)} http=${responseStatus} actions=${measured.actions.length} overflow=${measured.overflow} errors=${consoleErrors.length}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}

const demoResults = results.filter((result) => result.kind === "demo");
const checks = {
  totalCaptures: results.length,
  demoCaptures: demoResults.length,
  allFourActionsEveryDemoViewport: demoResults.every((r) => ["whatsapp", "call", "directions", "share"].every((key) => r.measured.actions.some((a) => a.key === key && a.visible && a.icon && a.label))),
  allTouchTargets: demoResults.every((r) => r.measured.actions.every((a) => a.height >= 44 && a.width >= 40)),
  allCorrectDestinations: demoResults.every((r) => {
    const wa = r.measured.actions.find((a) => a.key === "whatsapp");
    const call = r.measured.actions.find((a) => a.key === "call");
    const dir = r.measured.actions.find((a) => a.key === "directions");
    return wa?.href?.includes("wa.me/254724317010") && call?.href === "tel:+254724317010" && dir?.href?.includes("google.com/maps/dir/");
  }),
  noHorizontalOverflow: results.every((r) => !r.measured.overflow),
  noConsoleErrors: results.every((r) => r.consoleErrors.length === 0),
  shareFallbackWorks: demoResults.filter((r) => r.shareOutcome).every((r) => /Link copied|Copy this link|Shared/.test(r.shareOutcome?.status || "")),
  manifestLinked: results.every((r) => r.measured.manifestHref === "/manifest.json"),
};
const summary = { generatedAt: new Date().toISOString(), baseUrl: BASE, browser: "Chromium headless (puppeteer-core)", checks, results };
writeFileSync(path.join(process.cwd(), "docs", "evidence", "browser-evidence.json"), JSON.stringify(summary, null, 2));
console.log("\nCHECKS", JSON.stringify(checks, null, 2));
if (Object.values(checks).some((value) => value === false)) process.exitCode = 1;
