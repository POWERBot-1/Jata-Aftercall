#!/usr/bin/env node
/**
 * Pricing grid browser check — all five plans in one grid (2026-10-25).
 *
 *   CHROME_PATH=/path/to/chromium BASE_URL=http://localhost:3000 npm run test:browser:pricing
 *
 * Requires a running server (dev or `next start`). What it proves, in a real browser at the
 * widths the brief names (320, 360, 390, 414, 768, 1024, 1280, 1440):
 *   1. Exactly five `.lp-plan` cards, all inside the single `.lp-plans` grid — none rendered
 *      outside it in a separate section.
 *   2. No horizontal overflow (`documentElement.scrollWidth` within the viewport) and no card
 *      crossing the viewport edge at any width.
 *   3. The grid resolves to one column on a phone, two on a tablet, and a three-across desktop
 *      arrangement with the last two cards centred beneath it.
 *   4. Cards in the same row share a width, and their name/price/period/feature/CTA rows line up.
 *   5. The order, prices, billing periods and CTA destinations are the authoritative ones, with
 *      the Business POS card ending in `/dashboard/pos` and the page plans in `/register`.
 *
 * Set SHOT_DIR to write screenshots (JPEG) for review. Exits 2 when Chrome is missing, so a run
 * without a browser is reported as NOT RUN rather than as a pass.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const executablePath = process.env.CHROME_PATH;
if (!executablePath) {
  console.error("Browser missing: pricing grid check NOT RUN. Set CHROME_PATH.");
  process.exit(2);
}
const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const shotDir = process.env.SHOT_DIR || "";
if (shotDir) mkdirSync(shotDir, { recursive: true });

const rows = [];
const check = (name, ok, detail = "") => {
  rows.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const shot = async (page, name) => {
  if (!shotDir) return;
  await page.screenshot({ path: `${shotDir}/${name}.jpg`, type: "jpeg", quality: 74, fullPage: true });
};

const VIEWPORTS = [
  { label: "320", width: 320, height: 640, columns: 1 },
  { label: "360", width: 360, height: 740, columns: 1 },
  { label: "390", width: 390, height: 844, columns: 1 },
  { label: "414", width: 414, height: 896, columns: 1 },
  { label: "768", width: 768, height: 1024, columns: 2 },
  { label: "1024", width: 1024, height: 768, columns: 2 },
  { label: "1280", width: 1280, height: 800, columns: 3 },
  { label: "1440", width: 1440, height: 900, columns: 3 },
];

// The authoritative commercial data this change must not alter.
const EXPECTED = [
  { key: "MONTHLY", price: "KES 149", period: "per 30 days", cta: "/register" },
  { key: "ANNUAL", price: "KES 999", period: "per year", cta: "/register" },
  { key: "AI_BUSINESS_FRONT_DESK", price: "KES 499", period: "per 30 days", cta: "/register" },
  { key: "INTERACTIVE_BUSINESS", price: "KES 999", period: "per 30 days", cta: "/register" },
  { key: "BUSINESS_POS", price: "KES 499", period: "per 30 days", cta: "/dashboard/pos" },
];

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
});

const facts = (page) =>
  page.evaluate(() => {
    const round = (value) => Math.round(value * 10) / 10;
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: round(r.left), right: round(r.right), top: round(r.top), width: round(r.width), height: round(r.height) };
    };
    const grids = [...document.querySelectorAll(".lp-plans")];
    const grid = grids[0] || null;
    const cards = [...document.querySelectorAll(".lp-plan")];
    const cardFacts = cards.map((card) => {
      const text = (selector) => card.querySelector(selector)?.textContent?.trim() ?? "";
      const row = (selector) => {
        const el = card.querySelector(selector);
        return el ? round(el.getBoundingClientRect().top) : null;
      };
      return {
        key: card.getAttribute("data-plan"),
        insideGrid: Boolean(grid && grid.contains(card)),
        box: box(card),
        price: text(".lp-plan__price"),
        period: text(".lp-plan__period"),
        name: text(".lp-plan__name"),
        ctaText: text(".lp-plan__cta"),
        ctaHref: card.querySelector(".lp-plan__cta")?.getAttribute("href") ?? "",
        rows: {
          name: row(".lp-plan__name"),
          price: row(".lp-plan__price"),
          period: row(".lp-plan__period"),
          includes: row(".lp-plan__includes"),
          cta: row(".lp-plan__cta"),
        },
        overflowsCard: (() => {
          const cardBox = card.getBoundingClientRect();
          return [...card.querySelectorAll("*")].some((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.right > cardBox.right + 0.5 || r.left < cardBox.left - 0.5);
          });
        })(),
      };
    });
    return {
      viewport: window.innerWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      gridCount: grids.length,
      gridBox: grid ? box(grid) : null,
      cards: cardFacts,
      strayCards: cards.filter((card) => !grid || !grid.contains(card)).length,
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length : 0,
      separatePosSection: Boolean(document.querySelector("#business-pos-heading")),
    };
  });

for (const viewport of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
  await page.goto(`${base}/`, { waitUntil: "networkidle2", timeout: 120000 });
  await page.evaluate(() => document.querySelector("#pricing")?.scrollIntoView());
  const f = await facts(page);

  check(`${viewport.label}px: one pricing grid holds exactly five plan cards`, f.gridCount === 1 && f.cards.length === 5 && f.strayCards === 0 && f.cards.every((c) => c.insideGrid), `grids=${f.gridCount} cards=${f.cards.length}`);
  check(`${viewport.label}px: no separate POS section`, !f.separatePosSection);
  check(`${viewport.label}px: no horizontal overflow`, f.docScrollWidth <= f.viewport && f.cards.every((c) => c.box.right <= f.viewport + 0.5 && c.box.left >= -0.5), `scrollWidth=${f.docScrollWidth} viewport=${f.viewport}`);
  check(`${viewport.label}px: no card content spills outside its card`, f.cards.every((c) => !c.overflowsCard));
  check(`${viewport.label}px: grid resolves to ${viewport.columns} column(s)`, f.columns === viewport.columns, `gridTemplateColumns=${f.columns}`);

  // Cards group into rows by their top offset; every row must share one card width.
  const byRow = new Map();
  for (const card of f.cards) {
    const key = card.box.top;
    byRow.set(key, [...(byRow.get(key) ?? []), card]);
  }
  const rowWidths = [...byRow.values()].map((row) => new Set(row.map((card) => card.box.width)));
  check(`${viewport.label}px: cards in a row share one width`, rowWidths.every((widths) => widths.size === 1), [...byRow.values()].map((row) => row.map((card) => card.box.width).join("/")).join(" | "));
  const maxPerRow = Math.max(...[...byRow.values()].map((row) => row.length));
  check(`${viewport.label}px: at most ${viewport.columns} cards per row`, maxPerRow <= viewport.columns, `rows=${[...byRow.values()].map((row) => row.length).join("+")}`);

  // Shared rows: within a row, names, prices, periods, features and CTAs start on the same line.
  const aligned = [...byRow.values()].every((row) =>
    Object.keys(row[0].rows).every((key) => new Set(row.map((card) => card.rows[key])).size === 1),
  );
  check(`${viewport.label}px: price, period, feature and CTA rows line up across a row`, aligned);

  check(
    `${viewport.label}px: order, prices, periods and CTA destinations are authoritative`,
    f.cards.every((card, index) => {
      const expected = EXPECTED[index];
      return card.key === expected.key && card.price === expected.price && card.period.startsWith(expected.period) && card.ctaHref === expected.cta;
    }),
    f.cards.map((card) => `${card.key}:${card.price}:${card.ctaHref}`).join(" | "),
  );
  check(`${viewport.label}px: the POS card is the last card and keeps its own CTA`, f.cards[4]?.key === "BUSINESS_POS" && f.cards[4]?.ctaText === "Open Business POS", f.cards[4]?.ctaText ?? "missing");

  await shot(page, `pricing-${viewport.label}`);
  await page.close();
}

await browser.close();
const failed = rows.filter((row) => !row.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} checks passed`);
if (failed.length) {
  console.error(`FAIL: ${failed.length} check(s) failed`);
  process.exit(1);
}
process.exit(0);
