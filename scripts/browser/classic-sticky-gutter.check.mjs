#!/usr/bin/env node
/**
 * Classic business page — sticky contact-bar edge gutter, measured at NATIVE device scale.
 *
 * WHY THIS EXISTS
 * ---------------
 * The 320x568 motion capture (`disposable-browser-evidence.mjs`) showed the Share control apparently
 * sitting flush against the screen edge on `/b/nyumbani-kitchen`, which is the CLASSIC page
 * (`.jata-public` → `ContactActions variant="sticky"`), not the experience storefront's
 * `.eb-actionbar`. `actionbar-layout.check.mjs` measures the storefront bar only, so the flagged
 * element was never actually measured.
 *
 * A 100px thumbnail cannot settle whether that is a defect or a correct 12px inset rendered small,
 * so this measures the real geometry with deviceScaleFactor 2 (the same setting the failing capture
 * used) and reports CSS pixels. It is a MEASUREMENT: it changes no CSS. It fails when the inset is
 * genuinely absent, so a real defect cannot hide behind a passing screenshot.
 *
 * Usage:
 *   CHROME_PATH=/path/to/chrome BASE_URL=http://localhost:4100 \
 *   node scripts/browser/classic-sticky-gutter.check.mjs
 * Exit codes: 2 = BLOCKED (no Chrome), 1 = a check failed, 0 = all passed.
 */
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH;
if (!CHROME || !existsSync(CHROME)) {
  console.error("BLOCKED / NOT RUN: set CHROME_PATH to a real Chrome/Chromium binary. No classic-bar evidence claimed.");
  process.exit(2);
}

// A malformed BASE_URL must BLOCK (exit 2), never crash: an uncaught throw exits 1, which this
// harness reserves for "a real check failed" and would read as a false Share-edge defect.
// (Observed: an inherited BASE_URL of "/" from the test runner produced `new URL("")` -> exit 1.)
function resolveBase() {
  const raw = (process.env.BASE_URL || "http://localhost:4100").trim();
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" || !parsed.hostname) return null;
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}
const BASE = resolveBase();
if (BASE === null) {
  console.error("BLOCKED / NOT RUN: BASE_URL is not a usable http origin. No classic-bar evidence claimed.");
  process.exit(2);
}

// An isolation gate in the spirit of scripts/motion/disposable-browser-evidence.mjs, so this check can
// only ever measure the disposable harness — never a real deployment.
//
// It deliberately does NOT require MOTION_ISOLATED: that flag is scoped to the motion capture job and
// is never exported into this step, so requiring it would block the check permanently (observed: the
// first wiring exited 2 as BLOCKED for exactly that reason). The four remaining conditions — loopback
// port 4100, CI=1, the exact jata_e2e connection string and the test-only AUTH_SECRET — uniquely
// identify the disposable harness and cannot hold against a real deployment.
const guarded = new URL(BASE);
if (
  guarded.protocol !== "http:" ||
  !["localhost", "127.0.0.1"].includes(guarded.hostname) ||
  guarded.port !== "4100" ||
  !process.env.CI ||
  process.env.DATABASE_URL !== "postgresql://jata:jata@localhost:5432/jata_e2e?schema=public" ||
  process.env.AUTH_SECRET !== "interactive-business-e2e-test-secret"
) {
  console.error(
    "BLOCKED / NOT RUN: refusing a non-isolated target. Needs CI=1, loopback port 4100, the jata_e2e database and the test AUTH_SECRET.",
  );
  process.exit(2);
}
const SLUG = process.env.CLASSIC_SLUG || "nyumbani-kitchen";
const SHOTS = process.env.SHOT_DIR || join(process.cwd(), ".cache", "verification", "classic-sticky");
mkdirSync(SHOTS, { recursive: true });

// The six owner-mandated widths, but this check only needs the phone range where the bar is shown.
const WIDTHS = [320, 360, 390, 430];
// Floor shared with actionbar-layout.check.mjs so the two bars are judged by one standard.
const MIN_EDGE_GUTTER = 8;

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed += 1; console.log(`PASS  ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed += 1; console.log(`FAIL  ${name}${detail ? `  (${detail})` : ""}`); }
}

/**
 * Measure the sticky bar. Uses the same deviceScaleFactor as the capture that raised the question,
 * then converts every rectangle back to CSS pixels, so the numbers are comparable to the CSS.
 */
const MEASURE = () => {
  const root = document.querySelector(".jata-public");
  if (!root) return { error: "no .jata-public root" };
  const sticky = root.querySelector(".jata-contact-actions--sticky");
  if (!sticky) return { error: "no sticky contact actions", dpr: devicePixelRatio };
  const wrapper = sticky.closest("div.fixed") || sticky.parentElement;
  const wr = wrapper.getBoundingClientRect();
  const wrapStyle = getComputedStyle(wrapper);
  const actions = [...sticky.querySelectorAll("a, button")].map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      label: (el.textContent || "").trim(),
      left: +r.left.toFixed(2),
      right: +r.right.toFixed(2),
      width: +r.width.toFixed(2),
      height: +r.height.toFixed(2),
      padLeft: parseFloat(cs.paddingLeft),
      padRight: parseFloat(cs.paddingRight),
    };
  });
  const first = actions[0];
  const last = actions[actions.length - 1];
  const inner = sticky.parentElement;
  const innerStyle = inner ? getComputedStyle(inner) : null;
  return {
    dpr: devicePixelRatio,
    innerWidth,
    wrapper: { left: +wr.left.toFixed(2), right: +wr.right.toFixed(2), width: +wr.width.toFixed(2) },
    wrapperPadding: { left: parseFloat(wrapStyle.paddingLeft), right: parseFloat(wrapStyle.paddingRight) },
    containerPadding: innerStyle ? { left: parseFloat(innerStyle.paddingLeft), right: parseFloat(innerStyle.paddingRight) } : null,
    count: actions.length,
    actions,
    gutterLeft: first ? +first.left.toFixed(2) : null,
    gutterRight: last ? +(innerWidth - last.right).toFixed(2) : null,
    symmetry: first && last ? +Math.abs(first.left - (innerWidth - last.right)).toFixed(2) : null,
    minHeight: actions.length ? Math.min(...actions.map((a) => a.height)) : null,
    minWidth: actions.length ? Math.min(...actions.map((a) => a.width)) : null,
    pageOverflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
    stalePadding: /^0(px)?$/.test(wrapStyle.paddingLeft) && /^0(px)?$/.test(wrapStyle.paddingRight),
  };
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

try {
  for (const width of WIDTHS) {
    const page = await browser.newPage();
    // deviceScaleFactor 2 matches the capture that raised the question; all rects stay in CSS px.
    await page.setViewport({ width, height: 568, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
    const response = await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const status = response?.status() ?? null;
    check(`${width}px: classic page served`, status === 200, `status=${status}`);
    if (status !== 200) { await page.close(); continue; }

    await page.evaluate(async () => {
      await document.fonts?.ready?.catch?.(() => {});
      await new Promise((r) => setTimeout(r, 400));
    });

    const m = await page.evaluate(MEASURE);
    if (m.error) {
      check(`${width}px: sticky contact bar present`, false, m.error);
      await page.close();
      continue;
    }

    check(`${width}px: sticky bar carries four contact actions`, m.count === 4, `count=${m.count} dpr=${m.dpr}`);

    // The actual question: does the Share (last) control keep a real inset from the screen edge?
    check(`${width}px: last control keeps a gutter to the screen edge`,
      m.gutterRight !== null && m.gutterRight >= MIN_EDGE_GUTTER - 0.5,
      `Share ends ${m.gutterRight}px from the edge (floor ${MIN_EDGE_GUTTER}px)`);
    check(`${width}px: first control keeps a gutter to the screen edge`,
      m.gutterLeft !== null && m.gutterLeft >= MIN_EDGE_GUTTER - 0.5,
      `first starts ${m.gutterLeft}px from the edge`);
    check(`${width}px: the bar is horizontally symmetric`,
      m.symmetry !== null && m.symmetry <= 1,
      `left/right delta=${m.symmetry}px`);
    check(`${width}px: the gutter comes from padding, not from a shrunken bar`,
      !m.stalePadding && m.containerPadding !== null && m.containerPadding.left >= MIN_EDGE_GUTTER - 0.5,
      `container padding L=${m.containerPadding?.left}/R=${m.containerPadding?.right}, wrapper padding L=${m.wrapperPadding.left}`);
    check(`${width}px: no horizontal page overflow`, m.pageOverflowX <= 0, `pageOverflowX=${m.pageOverflowX}px`);
    check(`${width}px: every control is a 44px touch target`, m.minHeight >= 43.5, `minHeight=${m.minHeight}px`);
    check(`${width}px: no uncaught page errors`, errors.length === 0, errors.slice(0, 2).join(" | ") || "none");

    // One durable, machine-readable line per width for the PR evidence comment.
    console.log(`CLASSIC STICKY ${width}px gutterLeft=${m.gutterLeft}px gutterRight=${m.gutterRight}px symmetry=${m.symmetry}px minHeight=${m.minHeight}px pageOverflowX=${m.pageOverflowX}px dpr=${m.dpr}`);

    await page.screenshot({ path: join(SHOTS, `classic-sticky-${width}.png`), fullPage: false });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed, 0 skipped`);
console.log("Measurement only: the Share-edge question is answered by these numbers, not by a thumbnail. No CSS was changed.");
process.exit(failed === 0 ? 0 : 1);
