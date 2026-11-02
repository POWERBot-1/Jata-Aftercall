import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import { writeFileSync, mkdirSync } from "node:fs";
import { measureFocusRing, contrast } from "./focus-measure.mjs";

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || "/tmp/probe/out";
const W = Number(process.env.W || 390), H = Number(process.env.H || 844);
mkdirSync(OUT, { recursive: true });

const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter((a) => a !== "--single-process" && a !== "--no-zygote"),
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
if (process.env.THEME) {
  await ctx.addInitScript((t) => window.localStorage.setItem("jata-product-theme", t), process.env.THEME);
}
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
await page.goto(`${BASE}/dev/autopilot-fixture?scenario=approval-pending&role=OWNER&tenant=a`, { waitUntil: "load", timeout: 180000 });
await page.waitForSelector("[data-autopilot-fixture]", { timeout: 180000 });
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => Object.keys(b).some((k) => k.startsWith("__reactProps"))), null, { timeout: 180000 });
await page.waitForTimeout(700);
if (process.env.OPEN_PICKER) {
  await page.locator("details.product-theme-picker > summary").first().click();
  await page.waitForTimeout(400);
}
const themeNow = await page.evaluate(() => document.querySelector("[data-product-theme]")?.getAttribute("data-product-theme") || null);

// Small-target audit: every visible interactive element under 24px in either dimension.
const small = await page.evaluate(() => {
  const sel = "button, a[href], input, select, textarea, [role=button], [role=tab], [role=switch], [role=checkbox]";
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    // Only elements the user can actually see or use (excludes content of a closed <details>).
    const visible = el.checkVisibility ? el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }) : el.offsetParent !== null;
    if (!visible) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.width < 24 || r.height < 24) {
      const path = [];
      let cur = el;
      for (let i = 0; i < 3 && cur && cur !== document.body; i++) {
        let s = cur.tagName.toLowerCase();
        if (cur.id) s += "#" + cur.id;
        const cls = (cur.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
        if (cls) s += "." + cls;
        path.unshift(s);
        cur = cur.parentElement;
      }
      out.push({
        tag: el.tagName.toLowerCase(),
        text: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
        ariaLabel: el.getAttribute("aria-label"),
        width: Math.round(r.width * 10) / 10,
        height: Math.round(r.height * 10) / 10,
        x: Math.round(r.x), y: Math.round(r.y + window.scrollY),
        path: path.join(" > "),
      });
    }
  }
  return out;
});

// Focus rings: reach Approve and Reject by keyboard, then measure rendered pixels.
async function tabTo(kind) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  for (let i = 0; i < 200; i++) {
    await page.keyboard.press("Tab");
    const ok = await page.evaluate((k) => {
      const el = document.activeElement;
      if (!el) return false;
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      return k === "approve" ? /Approve & Execute/.test(t) : el.tagName === "BUTTON" && /Reject/.test(t);
    }, kind);
    if (ok) {
      await page.evaluate((k) => document.activeElement.setAttribute("data-probe", k), kind);
      return true;
    }
  }
  return false;
}

const result = { viewport: { W, H }, theme: themeNow, small, errors: [] };
if (await tabTo("approve")) {
  const m = await measureFocusRing(page, page.locator(`[data-probe="${"approve"}"]`));
  result.approveFocus = { ...m, focusedPng: undefined, barePng: undefined };
  writeFileSync(`${OUT}/approve-focused-${themeNow}-${W}x${H}.png`, m.focusedPng);
  writeFileSync(`${OUT}/approve-bare-${themeNow}-${W}x${H}.png`, m.barePng);
}
if (await tabTo("reject")) {
  const m = await measureFocusRing(page, page.locator('[data-probe="reject"]'));
  result.rejectFocus = { ...m, focusedPng: undefined, barePng: undefined };
}
result.errors = errors;
writeFileSync(`${OUT}/probe-${themeNow}${process.env.OPEN_PICKER ? "-picker-open" : ""}-${W}x${H}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ small: small.length, smallSample: small.slice(0, 4), approve: result.approveFocus && { ringVsSurface: result.approveFocus.ringVsSurface, ringVsFill: result.approveFocus.ringVsFill, differs: result.approveFocus.ringDiffersFromSurface, surface: result.approveFocus.surfaceRGB, ring: result.approveFocus.ringRGB, fill: result.approveFocus.fillRGB, box: result.approveFocus.box }, reject: result.rejectFocus && { ringVsSurface: result.rejectFocus.ringVsSurface, differs: result.rejectFocus.ringDiffersFromSurface, box: result.rejectFocus.box } }, null, 1));
await browser.close();
