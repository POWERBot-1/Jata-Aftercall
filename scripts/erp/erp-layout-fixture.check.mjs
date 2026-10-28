#!/usr/bin/env node
/**
 * Layout fixture check for the three owner decisions (Q1, Q2, Q3).
 *
 * WHY THIS EXISTS
 * ---------------
 * `scripts/erp/erp-visual.check.mjs` is the authoritative capture: it drives the real Next.js
 * production build against a real database in CI. That is the evidence of record.
 *
 * This script is the fast local loop for the *stylesheet* alone: it loads the real `app/erp.css`,
 * reproduces the real shell markup (topbar, sidebar, bottom bar, KPI row) exactly as the app renders
 * it, and measures the three decisions at the owner's viewports. No database, no Next.js, no Prisma,
 * so it can run anywhere — but by construction it proves the CSS, not the product. Its results are
 * labelled as fixture results everywhere they are quoted, and CI's real-app capture is what closes E4.
 *
 * What it asserts, at every viewport:
 *   Q1  above 700px the sidebar is shown and the bottom bar is not; at 700px and below, the reverse.
 *   Q2  KPI cards are 2-up from 360px, 1-up below that, and never overflow the viewport.
 *   Q3  below 431px the module label reads "ERP"; above it, "POS / ERP - PRO". Exactly one visible.
 *   --  no horizontal overflow anywhere (the same `scrollWidth - clientWidth <= 0` contract).
 *
 * Usage:
 *   CHROME_PATH=/path/to/chrome node scripts/erp/erp-layout-fixture.check.mjs
 * Exit codes: 0 = PASS, 1 = FAIL, 2 = BLOCKED (no browser).
 */
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const CHROME_PATH = process.env.CHROME_PATH ?? "";
const SHOT_DIR = process.env.SHOT_DIR || ".cache/verification/erp-layout-fixture";

if (!CHROME_PATH) {
  console.log("BLOCKED  CHROME_PATH is not set; nothing was measured, and that is not a pass.");
  process.exit(2);
}

let puppeteer;
try {
  puppeteer = require("puppeteer-core");
} catch {
  try {
    puppeteer = require("puppeteer");
  } catch {
    console.log("BLOCKED  no puppeteer/puppeteer-core is installed; nothing was measured.");
    process.exit(2);
  }
}

const VIEWPORTS = [
  { label: "320x568", width: 320, height: 568 },
  { label: "360x800", width: 360, height: 800 },
  { label: "390x844", width: 390, height: 844 },
  { label: "430x932", width: 430, height: 932 },
  { label: "700x900", width: 700, height: 900 },
  { label: "768x1024", width: 768, height: 1024 },
  { label: "1024x768", width: 1024, height: 768 },
  { label: "1366x768", width: 1366, height: 768 },
];

// The shell markup below is copied from app/dashboard/erp/[businessId]/layout.tsx and a KPI row from
// app/dashboard/erp/[businessId]/requisitions/page.tsx. If those files change shape, this fixture must
// change with them — CI's real-app capture is what catches drift, which is why both exist.
const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="globals.css">
<link rel="stylesheet" href="erp.css">
</head>
<body class="erp">
<div class="erp-layout">
  <aside class="erp-sidebar">
    <div class="erp-brand"><div class="erp-brand-mark">J</div><div><div class="erp-brand-name">POS / ERP - PRO</div><div class="erp-brand-sub">Workspace</div></div></div>
    <nav>
      <a class="erp-nav-link" data-active="true" href="#"><span class="erp-nav-glyph" aria-hidden="true">▦</span><span>Requisitions</span></a>
      <a class="erp-nav-link" href="#"><span class="erp-nav-glyph" aria-hidden="true">◲</span><span>Procurement</span></a>
      <a class="erp-nav-link" href="#"><span class="erp-nav-glyph" aria-hidden="true">✓</span><span>Tasks and work</span></a>
    </nav>
  </aside>
  <div class="erp-main">
    <header class="erp-topbar">
      <div>
        <div class="erp-crumbs">VISUAL CHECK 01DE</div>
        <div class="erp-topbar-title"><span class="erp-label-full">POS / ERP - PRO</span><span class="erp-label-short">ERP</span></div>
      </div>
      <div class="erp-topbar-actions">
        <span class="erp-badge">Plan active</span>
        <a class="erp-btn erp-btn-secondary erp-btn-sm" href="#">Inbox</a>
        <a class="erp-btn erp-btn-primary erp-btn-sm" href="#">New campaign</a>
        <a class="erp-btn erp-btn-secondary erp-btn-sm" href="#">Business POS</a>
      </div>
    </header>
    <div class="erp-content">
      <header class="erp-page-head"><div><h1>Requisitions</h1><p>Ask for what you need before it is bought. A requester never approves their own request.</p></div></header>
      <dl class="erp-grid erp-grid-3">
        <div class="erp-kpi"><dt>Drafts</dt><dd>3</dd><small>Not submitted yet</small></div>
        <div class="erp-kpi"><dt>Waiting decision</dt><dd>2</dd><small>With a manager</small></div>
        <div class="erp-kpi"><dt>Approved</dt><dd>14</dd><small>Ready to order</small></div>
      </dl>
      <section class="erp-card"><h2>Open requisitions</h2>
        <ul class="erp-list">
          <li><span>REQ-000014 · two-line request</span><span class="erp-badge">Approved</span></li>
          <li><span>REQ-000013 · waiting for a decision</span><span class="erp-badge">Submitted</span></li>
        </ul>
      </section>
    </div>
  </div>
</div>
<nav class="erp-mobile-bar">
  <a href="#" data-active="true"><span class="glyph">▤</span><span>Home</span></a>
  <a href="#"><span class="glyph">✓</span><span>Tasks</span></a>
  <a href="#"><span class="glyph">▦</span><span>Requests</span></a>
  <a href="#"><span class="glyph">◲</span><span>Buying</span></a>
  <a href="#"><span class="glyph">◎</span><span>More</span></a>
</nav>
<script>
  // The product's own shell sets the mobile-bar active state; the fixture only needs the markup.
</script>
</body></html>`;

function fail(message) {
  console.log(`FAIL  ${message}`);
}

let browser;
let failures = 0;
let checks = 0;
const results = [];

try {
  const workDir = mkdtempSync(path.join(tmpdir(), "erp-fixture-"));
  // globals.css first: every ERP colour is a `var(--jata-*)` alias, so without the token sheet the
  // page renders with no fills or borders and the screenshot misrepresents the product. Both files
  // are loaded exactly as app/layout.tsx loads them.
  writeFileSync(path.join(workDir, "globals.css"), readFileSync("app/globals.css", "utf8"), "utf8");
  writeFileSync(path.join(workDir, "erp.css"), readFileSync("app/erp.css", "utf8"), "utf8");
  writeFileSync(path.join(workDir, "index.html"), HTML, "utf8");
  if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });

  browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  console.log(`Browser ${await browser.version()}; fixture built from app/erp.css; ${VIEWPORTS.length} viewports.`);
  console.log("NOTE    This proves the two stylesheets and the shell markup. The real-app capture is CI's job.");

  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
    await page.goto(`file://${path.join(workDir, "index.html")}`, { waitUntil: "load" });
    await new Promise((resolve) => setTimeout(resolve, 120));

    const facts = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { width: Math.round(box.width), height: Math.round(box.height), visible: box.width > 0 && box.height > 0 };
      };
      const kpiCards = [...document.querySelectorAll(".erp-grid-3 > .erp-kpi")].map((card) => {
        const box = card.getBoundingClientRect();
        return { top: Math.round(box.top), left: Math.round(box.left), width: Math.round(box.width) };
      });
      // Cards on the same visual row share a top offset; counting distinct tops gives the column count.
      const rows = new Set(kpiCards.map((card) => card.top)).size;
      const columns = rows > 0 ? Math.round(kpiCards.length / rows) : 0;
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sidebar: rect(".erp-sidebar"),
        mobileBar: rect(".erp-mobile-bar"),
        labelFull: rect(".erp-label-full"),
        labelShort: rect(".erp-label-short"),
        kpiColumns: columns,
        kpiWidths: kpiCards.map((card) => card.width),
      };
    });

    // Viewport shot: a `position: fixed` bottom bar is painted at its real place, so this is the
    // image to judge navigation by. The full-page shot is kept for overall layout but always paints
    // fixed elements mid-document (the E4/V4 capture artifact).
    await page.screenshot({ path: path.join(SHOT_DIR, `${viewport.label}__fixture-viewport.jpg`), type: "jpeg", quality: 72, fullPage: false });
    await page.screenshot({ path: path.join(SHOT_DIR, `${viewport.label}__fixture.jpg`), type: "jpeg", quality: 72, fullPage: true });

    const expectSidebar = viewport.width > 700;
    const expectShort = viewport.width <= 430;
    const expectColumns = viewport.width < 360 ? 1 : 2;

    const checksForViewport = [
      {
        name: `${viewport.label} no horizontal overflow`,
        ok: facts.overflow <= 0,
        detail: `overflow=${facts.overflow}px`,
      },
      {
        name: `${viewport.label} Q1 nav mode is ${expectSidebar ? "sidebar" : "bottom bar"}`,
        ok: expectSidebar
          ? Boolean(facts.sidebar?.visible) && !facts.mobileBar?.visible
          : Boolean(facts.mobileBar?.visible) && !facts.sidebar?.visible,
        detail: `sidebar=${Boolean(facts.sidebar?.visible)}, mobileBar=${Boolean(facts.mobileBar?.visible)}`,
      },
      {
        name: `${viewport.label} Q2 KPI cards are ${expectColumns}-up`,
        ok: facts.kpiColumns === expectColumns,
        detail: `columns=${facts.kpiColumns}, widths=${facts.kpiWidths.join("/")}`,
      },
      {
        name: `${viewport.label} Q3 module label is ${expectShort ? "ERP" : "POS / ERP - PRO"}`,
        ok: expectShort
          ? Boolean(facts.labelShort?.visible) && !facts.labelFull?.visible
          : Boolean(facts.labelFull?.visible) && !facts.labelShort?.visible,
        detail: `full=${Boolean(facts.labelFull?.visible)}, short=${Boolean(facts.labelShort?.visible)}`,
      },
    ];

    for (const check of checksForViewport) {
      checks += 1;
      if (check.ok) {
        console.log(`PASS  ${check.name} — ${check.detail}`);
      } else {
        failures += 1;
        fail(`${check.name} — ${check.detail}`);
      }
      results.push({ ok: check.ok, name: check.name, detail: check.detail });
    }
    await page.close();
  }

  writeFileSync(
    path.join(SHOT_DIR, "fixture-evidence.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        chrome: browser ? await browser.version().catch(() => "unknown") : "not-launched",
        kind: "stylesheet-fixture (not the application)",
        viewports: VIEWPORTS.map((v) => v.label),
        results,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.log(`BLOCKED  the fixture could not run: ${String(error?.message ?? error).split("\n")[0].slice(0, 300)}`);
  process.exitCode = 2;
} finally {
  if (browser) await browser.close();
}

if (process.exitCode !== 2) {
  const verdict = failures === 0 ? "PASS" : "FAIL";
  console.log(`\nRESULT: ${verdict} (${checks - failures}/${checks} checks)`);
  process.exitCode = failures === 0 ? 0 : 1;
}
