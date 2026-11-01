import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import fs from "node:fs";
const VP = [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]];
const BASE = "http://localhost:3000/dev/workspace-preview";
const OUT = "out/dash-states"; fs.mkdirSync(OUT, { recursive: true });
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
const rows = [];
for (const [w, h] of VP) {
  const tag = `${w}x${h}`;
  for (const [name, q] of [["populated",""],["empty","?state=empty"],["loading","?state=loading"],["error","?state=error"]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
    await p.goto(BASE + q, { waitUntil: "networkidle", timeout: 180000 });
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${OUT}/${name}-${tag}.png`, fullPage: true });
    const info = await p.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      busy: !!document.querySelector('[aria-busy="true"]'),
      statusText: [...document.querySelectorAll('[role="status"]')].map(e => e.textContent.trim()).filter(Boolean)[0] ?? null,
    }));
    rows.push({ viewport: tag, state: name, pageErrors: errs.length, ...info });
    await ctx.close();
  }
  // Keyboard Tab-order journey (populated state), recording the first 45 stops
  {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: "networkidle", timeout: 180000 });
    const order = []; const seen = new Set();
    for (let i = 0; i < 45; i++) {
      await p.keyboard.press("Tab");
      const f = await p.evaluate(() => { const el = document.activeElement; if (!el || el === document.body) return null; const cs = getComputedStyle(el); return { tag: el.tagName, label: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("href") || "").trim().replace(/\s+/g," ").slice(0, 50), outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0, rect: el.getBoundingClientRect().width > 0 }; });
      if (f) { const k = f.tag + "|" + f.label; if (!seen.has(k)) { seen.add(k); order.push(f); } }
    }
    const navLinks = order.filter(f => /dashboard|Businesses|Overview|POS|Sales|Studio|AI|Autopilot|ERP|Subscription|Team|Plans/i.test(f.label)).length;
    rows.push({ viewport: tag, keyboard: { uniqueStops: order.length, navLikeStops: navLinks, allStopsOutlined: order.every(f => f.outline), firstStops: order.slice(0, 12).map(f => f.label) } });
    await ctx.close();
  }
}
// Reduced motion on populated, 390x844
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "networkidle", timeout: 180000 });
  rows.push({ viewport: "390x844", reducedMotion: await p.evaluate(() => [...new Set([...document.querySelectorAll("*")].map(e => getComputedStyle(e).animationName).filter(n => n !== "none"))]) });
  await ctx.close();
}
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows.filter(r => r.state || r.reducedMotion !== undefined), null, 0));
console.log(JSON.stringify(rows.filter(r => r.keyboard).map(r => ({ v: r.viewport, ...r.keyboard, firstStops: undefined })), null, 0));
await b.close();
