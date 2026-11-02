// Hero legibility measurement (fictional FIXTURE data). Measures the ACTUAL pixels behind the hero
// text: for each text box we screenshot the hero twice (as rendered, and with the text made
// transparent to expose only the background), then compute the worst-case WCAG contrast over every
// background pixel inside the text box, blending any text alpha over that pixel first.
import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || "/tmp/hero/out";
const THEME = process.env.THEME || "emerald-ink";
const WIDTHS = [[320, 568], [360, 800], [390, 844], [430, 932], [768, 1024], [1366, 768]];
const TEXT_SEL = [".ws-kicker--light", ".ws-hero__title", ".ws-hero__sub", ".ws-hero__meta"];
mkdirSync(OUT, { recursive: true });

const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter((a) => a !== "--single-process" && a !== "--no-zygote"),
  headless: true,
});

const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const blend = (fg, a, bg) => [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));

const results = [];
for (const [w, h] of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await ctx.addInitScript((t) => window.localStorage.setItem("jata-product-theme", t), THEME);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && /hydrat/i.test(m.text())) errors.push("HYDRATION: " + m.text().slice(0, 160)); });

  await page.goto(`${BASE}/dev/autopilot-fixture?scenario=approval-pending&role=OWNER&tenant=a`, { waitUntil: "load", timeout: 180000 });
  await page.waitForSelector(".ws-hero", { timeout: 180000 });
  await page.waitForTimeout(900);

  const hero = page.locator(".ws-hero").first();
  const heroBox = await hero.boundingBox();
  const info = await page.evaluate((sels) => {
    const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const toRgba = (css) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = "#000"; cv.fillStyle = css; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const out = {};
    const hero = document.querySelector(".ws-hero");
    const hs = getComputedStyle(hero);
    out.heroBg = hs.backgroundColor;
    out.overflowX = document.documentElement.scrollWidth - window.innerWidth;
    out.texts = sels.map((s) => {
      const el = document.querySelector(s);
      if (!el) return { sel: s, missing: true };
      const cs = getComputedStyle(el);
      // Tight line-fragment rects around the glyphs (not the full block box).
      const rects = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim()) continue;
        const rg = document.createRange();
        rg.selectNodeContents(node);
        for (const q of rg.getClientRects()) {
          if (q.width < 1 || q.height < 1) continue;
          rects.push({ x: q.left + scrollX, y: q.top + scrollY, w: q.width, h: q.height });
        }
      }
      return { sel: s, css: cs.color, rgba: toRgba(cs.color), fontSize: cs.fontSize, fontWeight: cs.fontWeight, rects };
    });
    out.tokens = { ink: getComputedStyle(hero).getPropertyValue("--ws-ink").trim(), onInk: getComputedStyle(hero).getPropertyValue("--ws-on-ink").trim() };
    return out;
  }, TEXT_SEL);

  // Screenshot 1: as rendered. Screenshot 2: text transparent, to expose the background only.
  const asRendered = await hero.screenshot({ caret: "initial", path: `${OUT}/hero-${THEME}-${w}x${h}.png` });
  await page.addStyleTag({ content: `${TEXT_SEL.join(",")}, .ws-hero__title em, .ws-hero__stat dt, .ws-hero__stat dd { color: transparent !important; }` });
  await page.waitForTimeout(100);
  const bgOnly = await hero.screenshot({ caret: "initial", path: `${OUT}/hero-${THEME}-${w}x${h}-bgonly.png` });
  void asRendered; void bgOnly;

  const bg = PNG.sync.read(await (await import("node:fs")).promises.readFile(`${OUT}/hero-${THEME}-${w}x${h}-bgonly.png`));
  const px = (x, y) => { const i = (y * bg.width + x) * 4; return [bg.data[i], bg.data[i + 1], bg.data[i + 2]]; };
  const rows = [];
  for (const t of info.texts) {
    if (t.missing) { rows.push({ sel: t.sel, missing: true }); continue; }
    let worst = Infinity, best = 0, sum = 0, n = 0, worstAt = null, worstBg = null;
    const seen = new Set();
    for (const q of t.rects) {
     const x0 = Math.max(0, Math.floor(q.x - heroBox.x)), y0 = Math.max(0, Math.floor(q.y - heroBox.y));
     const x1 = Math.min(bg.width - 1, Math.ceil(q.x - heroBox.x + q.w)), y1 = Math.min(bg.height - 1, Math.ceil(q.y - heroBox.y + q.h));
     for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (seen.has(y * bg.width + x)) continue;
      seen.add(y * bg.width + x);
      // Ignore pixels outside the hero's rounded clip (page background shows through there).
      const rr = 18; const cx = Math.min(Math.max(x, rr), bg.width - 1 - rr), cy = Math.min(Math.max(y, rr), bg.height - 1 - rr);
      if (Math.hypot(x - cx, y - cy) > rr && (x < rr || x > bg.width - 1 - rr) && (y < rr || y > bg.height - 1 - rr)) continue;
      const b = px(x, y);
      const [r, g, bl, a] = t.rgba;
      const eff = blend([r, g, bl], a, b);
      const c = ratio(eff, b);
      if (c < worst) { worst = c; worstAt = [x, y]; worstBg = b; } if (c > best) best = c; sum += c; n++;
     }
    }
    rows.push({ sel: t.sel, css: t.css, fontSize: t.fontSize, fontWeight: t.fontWeight, pixels: n,
      worstContrast: +worst.toFixed(2), worstAt, worstBg, rectCount: t.rects.length, firstRect: t.rects[0] && { x: Math.round(t.rects[0].x - heroBox.x), y: Math.round(t.rects[0].y - heroBox.y), w: Math.round(t.rects[0].w), h: Math.round(t.rects[0].h) }, bestContrast: +best.toFixed(2), meanContrast: +(sum / n).toFixed(2) });
  }
  results.push({ theme: THEME, width: w, height: h, heroBg: info.heroBg, tokens: info.tokens, overflowX: info.overflowX,
    errors, rows, heroBox: { w: Math.round(heroBox.width), h: Math.round(heroBox.height) } });
  await ctx.close();
}
await browser.close();
const outFile = `${OUT}/hero-measure-${THEME}.json`;
writeFileSync(outFile, JSON.stringify({ base: BASE, theme: THEME, generatedAt: new Date().toISOString(), reducedMotion: true, results }, null, 2));
console.log(JSON.stringify(results.map((r) => ({ w: r.width, overflow: r.overflowX, errs: r.errors.length, bg: r.heroBg, tok: r.tokens, rows: r.rows.map((x) => [x.sel, x.worstContrast, x.meanContrast, x.css]) })), null, 1));
