import pkg from "@sparticuz/chromium";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const args = (await pkg.args).filter((a) => !["--single-process","--no-zygote"].includes(a));
const b = await chromium.launch({ executablePath: await pkg.executablePath(), args, headless: true });
const BUILDS = { main: "http://localhost:3001", pr: "http://localhost:3000" };
const ROUTES = ["/", "/login", "/register", "/pricing"];
const THEMES = ["lime-spark", "emerald-ink"];
const VPS = [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]];
const OUT = "/tmp/cap2/theme/out";
const FP = () => {
  const props = ["color","background-color","border-top-color","font-family","font-size","font-weight","border-radius","box-shadow","line-height"];
  return [...document.querySelectorAll("body *")].map((el) => {
    const cs = getComputedStyle(el);
    return el.tagName + "." + (el.className && el.className.baseVal === undefined ? String(el.className).slice(0,60) : "") + "|" + props.map((p) => cs.getPropertyValue(p)).join("|");
  });
};
const summary = [];
for (const [w,h] of VPS) for (const route of ROUTES) for (const theme of THEMES) {
  const row = { viewport: `${w}x${h}`, route, theme, builds: {} };
  const shots = {};
  for (const [name, base] of Object.entries(BUILDS)) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await ctx.addInitScript((t) => { try { localStorage.setItem("jata-product-theme", t); } catch {} }, theme);
    const p = await ctx.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push("PAGEERR " + e.message.slice(0, 120)));
    p.on("console", (m) => { if (m.type() === "error" && !/WebSocket|hmr|ERR_INVALID_HTTP/.test(m.text())) errors.push("CONSOLE " + m.text().slice(0, 120)); });
    const resp = await p.goto(base + route, { waitUntil: "load" });
    await p.waitForTimeout(1500);
    const fp = await p.evaluate(FP);
    const meta = await p.evaluate(() => ({ attr: document.documentElement.getAttribute("data-jata-theme"), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, title: document.title, bodyBg: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontFamily }));
    const file = `${OUT}/${name}-${w}x${h}-${route.replace(/\//g,"_") || "_"}-${theme}.png`;
    await p.screenshot({ path: file, fullPage: true, caret: "initial", animations: "disabled" });
    shots[name] = file;
    row.builds[name] = { status: resp?.status(), fpCount: fp.length, fp, meta, errors };
    await ctx.close();
  }
  // pixel diff
  const a = PNG.sync.read(readFileSync(shots.main)), c = PNG.sync.read(readFileSync(shots.pr));
  if (a.width === c.width && a.height === c.height) {
    const diff = new PNG({ width: a.width, height: a.height });
    const n = pixelmatch(a.data, c.data, diff.data, a.width, a.height, { threshold: 0.1 });
    row.pixelDiff = n; row.dims = `${a.width}x${a.height}`;
    if (n > 0) writeFileSync(shots.pr.replace(/\.png$/, "-DIFF.png"), PNG.sync.write(diff));
  } else { row.pixelDiff = "size-mismatch"; row.dims = `${a.width}x${a.height} vs ${c.width}x${c.height}`; }
  const fpMain = row.builds.main.fp, fpPr = row.builds.pr.fp;
  row.styleDiffElements = fpMain.length === fpPr.length ? fpMain.filter((x, i) => x !== fpPr[i]).length : `count ${fpMain.length} vs ${fpPr.length}`;
  row.firstStyleDiff = fpMain.map((x, i) => (x !== fpPr[i] ? { i, main: x.slice(0, 220), pr: (fpPr[i] || "").slice(0, 220) } : null)).find(Boolean) || null;
  delete row.builds.main.fp; delete row.builds.pr.fp;
  summary.push(row);
  console.log(row.viewport, route, theme, "pixelDiff=", row.pixelDiff, "styleDiffEls=", row.styleDiffElements, "themeAttr", row.builds.main.meta.attr, row.builds.pr.meta.attr);
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
await b.close();
console.log("DONE");
