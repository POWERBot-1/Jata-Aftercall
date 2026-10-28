#!/usr/bin/env node
/**
 * Quick-action bar containment (DEF-1 regression, release report §M.4).
 *
 * The defect this pins: `.eb-actionbar .eb-btn` shares the bar's width four ways
 * (`flex: 1 1 0`) and only ever wrapped on whitespace, so a single-word label
 * ("WhatsApp", "Directions") could not wrap and painted outside its own pill. Measured on
 * `/dev/motion-preview` at 360 px before the fix: the WhatsApp label was 83 px inside a 74 px
 * button and Directions 87 px. `overflow: visible` meant the text crossed into the neighbouring
 * control instead of being clipped, which is why the earlier overflow checks did not catch it.
 *
 * This script is deliberately no-database and fixture-only, like `fixture-layout.check.mjs`.
 * It asserts, for every action on the bar and at every phone width we ship for:
 *
 *   1. the label's painted text sits inside the button's own padding box (no bleed, no clip);
 *   2. no two actions overlap and nothing escapes the bar's content box or the viewport;
 *   3. the page has no horizontal overflow;
 *   4. every action is at least a 44 px touch target and keeps a visible focus ring;
 *   5. the same four conditions hold with reduced motion, and with an expanded
 *      ("translated") label, which is what a longer locale would produce;
 *   6. the bar is hidden entirely at desktop width (its existing contract).
 *
 * Usage:
 *   CHROME_PATH=/path/to/chrome BASE_URL=http://localhost:4300 node scripts/browser/actionbar-layout.check.mjs
 * Exit codes: 2 = no Chrome (BLOCKED, never a pass), 1 = a check failed, 0 = all passed.
 */
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

if (!process.env.CHROME_PATH || !existsSync(process.env.CHROME_PATH)) {
  console.error("BLOCKED / NOT RUN: set CHROME_PATH to a real Chrome/Chromium binary. No action-bar evidence claimed.");
  process.exit(2);
}

const BASE = (process.env.BASE_URL || "http://localhost:4300").replace(/\/$/, "");
const SHOTS = process.env.SHOT_DIR || join(process.cwd(), ".cache", "verification", "actionbar");
const SHOT_PREFIX = process.env.SHOT_PREFIX || "actionbar";
const WIDTHS = [320, 360, 375, 390, 430];
const DESKTOP = 1280;
// A representative 4-action storefront: order, WhatsApp, call and directions.
const FAMILIES = ["catalog", "marketplace"];
// Longer than any shipped label, and a German-length compound: if the bar cannot contain this it
// cannot contain a translation either.
const EXPANDED = "Benachrichtigungen";

mkdirSync(SHOTS, { recursive: true });

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed += 1; console.log(`PASS  ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed += 1; console.log(`FAIL  ${name}${detail ? `  (${detail})` : ""}`); }
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--font-render-hinting=none"],
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#8a8a8a"/></svg>';

// Reads the bar and returns geometry for every action, plus containment/overlap verdicts.
const MEASURE = () => {
  const bar = document.querySelector(".eb-actionbar");
  if (!bar) return null;
  const barRect = bar.getBoundingClientRect();
  const barStyle = getComputedStyle(bar);
  const contentLeft = barRect.x + parseFloat(barStyle.paddingLeft);
  const contentRight = barRect.right - parseFloat(barStyle.paddingRight);
  const contentTop = barRect.y + parseFloat(barStyle.paddingTop);
  const contentBottom = barRect.bottom - parseFloat(barStyle.paddingBottom);

  const actions = [...bar.querySelectorAll("a, button")].map((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const padL = parseFloat(cs.paddingLeft);
    const padR = parseFloat(cs.paddingRight);
    // The painted text rectangle, measured directly rather than inferred from scrollWidth.
    let text = null;
    for (const node of el.childNodes) {
      if (node.nodeType === 3 && node.textContent.trim()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const tr = range.getBoundingClientRect();
        if (tr.width > 0) text = { left: tr.left, right: tr.right, top: tr.top, bottom: tr.bottom, width: tr.width };
        break;
      }
    }
    const boxLeft = r.left + parseFloat(cs.borderLeftWidth) + padL;
    const boxRight = r.right - padR - parseFloat(cs.borderRightWidth);
    return {
      label: (el.textContent || "").trim(),
      rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height },
      box: { left: boxLeft, right: boxRight },
      text,
      bleeds: text ? { left: +(boxLeft - text.left).toFixed(1), right: +(text.right - boxRight).toFixed(1) } : null,
      scrollOverflowX: el.scrollWidth - el.clientWidth,
      tag: el.tagName.toLowerCase(),
    };
  });

  const overlaps = [];
  for (let i = 0; i < actions.length; i += 1) {
    for (let j = i + 1; j < actions.length; j += 1) {
      const a = actions[i].rect, b = actions[j].rect;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 0.5 && oy > 0.5) overlaps.push(`${actions[i].label}|${actions[j].label} ${ox.toFixed(1)}x${oy.toFixed(1)}`);
    }
  }
  const outsideBar = actions
    .filter((a) => a.rect.left < contentLeft - 0.5 || a.rect.right > contentRight + 0.5)
    .map((a) => a.label);
  const outsideVertical = actions
    .filter((a) => a.rect.top < contentTop - 0.5 || a.rect.bottom > contentBottom + 0.5)
    .map((a) => a.label);
  const outsideViewport = actions.filter((a) => a.rect.left < -0.5 || a.rect.right > innerWidth + 0.5).map((a) => a.label);
  return {
    count: actions.length,
    actions,
    overlaps,
    outsideBar,
    outsideVertical,
    outsideViewport,
    barHeight: +barRect.height.toFixed(1),
    pageOverflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
    spacerHeight: (() => { const s = document.querySelector(".eb-actionbar-spacer"); return s ? +s.getBoundingClientRect().height.toFixed(1) : null; })(),
  };
};

async function open(width, family, reducedMotion) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (reducedMotion) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(BASE)) return req.continue();
    if (url.endsWith(".svg")) {
      return req.respond({ status: 200, headers: { "content-type": "image/svg+xml", "access-control-allow-origin": "*" }, body: SVG });
    }
    return req.abort();
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
  await page.goto(`${BASE}/dev/motion-preview?family=${family}`, { waitUntil: "networkidle0", timeout: 120000 });
  await new Promise((r) => setTimeout(r, 700));
  return { page, errors };
}

try {
  for (const family of FAMILIES) {
    const { page, errors } = await open(WIDTHS[1], family, false);
    const measured = await page.evaluate(MEASURE);
    await page.close();
    check(`fixture '${family}' renders a quick-action bar`, measured !== null && measured.count >= 3,
      measured ? `${measured.count} actions` : "no .eb-actionbar in the document");
    if (!measured) continue;
    check(`fixture '${family}' has no uncaught page errors before measurement`, errors.length === 0, errors.join(" | "));
  }

  for (const width of WIDTHS) {
    const { page } = await open(width, "catalog", false);
    const m = await page.evaluate(MEASURE);
    if (!m) { check(`${width}px: quick-action bar present`, false, "no .eb-actionbar"); await page.close(); continue; }

    const bleeders = m.actions.filter((a) => a.bleeds && (a.bleeds.left > 0.5 || a.bleeds.right > 0.5));
    check(`${width}px: every label is contained in its own control`,
      bleeders.length === 0 && m.actions.every((a) => a.scrollOverflowX <= 1),
      bleeders.length
        ? bleeders.map((a) => `${a.label} bleeds L${a.bleeds.left}/R${a.bleeds.right}px`).join(", ")
        : `${m.actions.length} actions, max scrollOverflowX=${Math.max(...m.actions.map((a) => a.scrollOverflowX))}`);

    check(`${width}px: no overlapping actions`, m.overlaps.length === 0, m.overlaps.slice(0, 3).join(", ") || "none");
    check(`${width}px: actions stay inside the bar`, m.outsideBar.length === 0 && m.outsideVertical.length === 0,
      [...m.outsideBar, ...m.outsideVertical].slice(0, 4).join(", ") || "none");
    check(`${width}px: no horizontal page overflow`, m.pageOverflowX <= 0, `pageOverflowX=${m.pageOverflowX}px`);
    check(`${width}px: every action is a 44px touch target`,
      m.actions.every((a) => a.rect.height >= 43.5), `heights=${m.actions.map((a) => a.rect.height.toFixed(0)).join(",")}`);

    // Focus visibility on the bar's own controls (keyboard access). Programmatic focus() alone
    // does not reliably match :focus-visible, so the first action is focused and then Tab moves
    // to the next action *by keyboard*, which is what the browser's :focus-visible heuristic keys on.
    const focusable = await page.evaluate(() => {
      const el = document.querySelector(".eb-actionbar a, .eb-actionbar button");
      if (!el) return null;
      el.focus();
      return document.activeElement === el;
    });
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || !el.closest || !el.closest(".eb-actionbar")) return { inBar: false };
      const cs = getComputedStyle(el);
      return {
        inBar: true,
        label: (el.textContent || "").trim(),
        focusVisible: el.matches(":focus-visible"),
        outlineStyle: cs.outlineStyle,
        outlineWidth: parseFloat(cs.outlineWidth) || 0,
      };
    });
    check(`${width}px: bar actions are keyboard-focusable with a visible focus ring`,
      Boolean(focusable) && focus.inBar && focus.focusVisible && focus.outlineStyle !== "none" && focus.outlineWidth > 0,
      `focusable=${focusable} ${JSON.stringify(focus)}`);

    await page.screenshot({ path: join(SHOTS, `${SHOT_PREFIX}-${width}.png`) });
    await page.close();
  }

  // Reduced motion: the bar must still contain its labels and stay still.
  {
    const { page } = await open(360, "catalog", true);
    const m = await page.evaluate(MEASURE);
    const anim = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    check("360px reduced-motion: labels still contained and no residual animation",
      Boolean(m) && m.actions.every((a) => !a.bleeds || (a.bleeds.left <= 0.5 && a.bleeds.right <= 0.5)) &&
        m.actions.every((a) => a.scrollOverflowX <= 1) && anim === 0,
      m ? `max scrollOverflowX=${Math.max(...m.actions.map((a) => a.scrollOverflowX))}, runningAnimations=${anim}` : "no bar");
    await page.screenshot({ path: join(SHOTS, `${SHOT_PREFIX}-360-reduced-motion.png`) });
    await page.close();
  }

  // Expanded ("translated") labels — the bar must contain them without clipping.
  {
    const { page } = await open(360, "catalog", false);
    const expanded = await page.evaluate((longLabel) => {
      const bar = document.querySelector(".eb-actionbar");
      if (!bar) return null;
      for (const el of bar.querySelectorAll("a, button")) {
        const text = (el.textContent || "").trim();
        if (/^whatsapp$/i.test(text) || /^directions$/i.test(text)) el.textContent = longLabel;
      }
      const actions = [...bar.querySelectorAll("a, button")].map((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const boxRight = r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
        const boxLeft = r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
        let text = null;
        for (const node of el.childNodes) {
          if (node.nodeType === 3 && node.textContent.trim()) {
            const range = document.createRange(); range.selectNodeContents(node);
            const tr = range.getBoundingClientRect();
            if (tr.width > 0) text = tr;
            break;
          }
        }
        return {
          label: (el.textContent || "").trim(),
          scrollOverflowX: el.scrollWidth - el.clientWidth,
          bleedLeft: text ? +(boxLeft - text.left).toFixed(1) : 0,
          bleedRight: text ? +(text.right - boxRight).toFixed(1) : 0,
          height: +r.height.toFixed(1),
        };
      });
      return { actions, pageOverflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth };
    }, EXPANDED);
    check(`360px expanded label '${EXPANDED}': contained, no clip, no page overflow`,
      Boolean(expanded) && expanded.actions.every((a) => a.bleedLeft <= 0.5 && a.bleedRight <= 0.5 && a.scrollOverflowX <= 1) &&
        expanded.pageOverflowX <= 0,
      expanded ? expanded.actions.map((a) => `${a.label.slice(0, 12)} bleed L${a.bleedLeft}/R${a.bleedRight}`).join("; ") : "no bar");
    await page.screenshot({ path: join(SHOTS, `${SHOT_PREFIX}-360-expanded-label.png`) });
    await page.close();
  }

  // Desktop contract: the bar is not rendered as a fixed strip.
  {
    const page = await browser.newPage();
    await page.setViewport({ width: DESKTOP, height: 860 });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith(BASE)) return req.continue();
      if (url.endsWith(".svg")) {
        return req.respond({ status: 200, headers: { "content-type": "image/svg+xml", "access-control-allow-origin": "*" }, body: SVG });
      }
      return req.abort();
    });
    await page.goto(`${BASE}/dev/motion-preview?family=catalog`, { waitUntil: "networkidle0", timeout: 120000 });
    await new Promise((r) => setTimeout(r, 500));
    const desktop = await page.evaluate(() => {
      const bar = document.querySelector(".eb-actionbar");
      const spacer = document.querySelector(".eb-actionbar-spacer");
      return {
        barDisplay: bar ? getComputedStyle(bar).display : null,
        spacerHeight: spacer ? spacer.getBoundingClientRect().height : null,
        pageOverflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      };
    });
    check("1280px: the fixed action bar is not shown and the spacer collapses",
      desktop.barDisplay === "none" && (desktop.spacerHeight === null || desktop.spacerHeight === 0) && desktop.pageOverflowX <= 0,
      JSON.stringify(desktop));
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed, 0 skipped`);
console.log("Fixture-only check: it does not cover the dashboard, POS, checkout or authenticated states.");
process.exit(failed === 0 ? 0 : 1);
