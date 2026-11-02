import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import fs from "node:fs";
const VP = [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]];
const BASE = "http://localhost:3000/dev/studio-fixture";
const OUT = "out/studio"; fs.mkdirSync(OUT, { recursive: true });
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
const report = [];
async function session(vp, tag, url, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: 1, reducedMotion: opts.reduce ? "reduce" : "no-preference" });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(url, { waitUntil: "networkidle", timeout: 240000 });
  const shot = async (name, extra = {}) => {
    await p.waitForTimeout(extra.wait ?? 350);
    const file = `${OUT}/${name}-${tag}.png`;
    await p.screenshot({ path: file, fullPage: true });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    report.push({ viewport: tag, state: name, file, overflow, pageErrors: errs.length, ...extra.meta });
  };
  return { p, ctx, shot, errs };
}
for (const vp of VP) {
  const tag = `${vp[0]}x${vp[1]}`;
  // 1 dashboard
  let s = await session(vp, tag, `${BASE}?state=dashboard`);
  await s.shot("01-dashboard"); await s.ctx.close();
  // 2 category: choose, start (success + failure)
  for (const outcome of ["success", "failure"]) {
    s = await session(vp, tag, `${BASE}?state=category&outcome=${outcome}`);
    if (outcome === "success") await s.shot("02-category-initial");
    await s.p.locator('label:has(input[name="category"])').first().click();
    await s.p.getByRole("button", { name: "Start my website" }).click();
    await s.shot(`02-category-${outcome}-busy`, { wait: 120, meta: { note: "submit in flight" } });
    await s.shot(`02-category-${outcome}-result`, { wait: 1500 });
    await s.ctx.close();
  }
  // 3 editor: move section down (success + failure)
  for (const outcome of ["success", "failure"]) {
    s = await session(vp, tag, `${BASE}?state=editor&outcome=${outcome}`);
    if (outcome === "success") {
      await s.shot("03-editor-initial");
      const iframe = await s.p.locator("iframe").count();
      report.push({ viewport: tag, state: "03-editor-iframe-count", value: iframe });
    }
    const sectionsTab = s.p.getByRole("button", { name: "Sections", exact: true });
    if (await sectionsTab.count() && await sectionsTab.first().isVisible()) await sectionsTab.first().click();
    await s.p.locator('button[aria-label^="Move "][aria-label$=" down"]:not([disabled])').first().click();
    await s.shot(`03-editor-${outcome}-saving`, { wait: 60, meta: { note: "draft write in flight" } });
    await s.shot(`03-editor-${outcome}-result`, { wait: 1800 });
    await s.ctx.close();
  }
  // 4 image: use the suggested image (fixture never persists)
  s = await session(vp, tag, `${BASE}?state=image`);
  await s.shot("04-image-initial");
  const use = s.p.getByRole("button", { name: "Use image" });
  report.push({ viewport: tag, state: "04-image-use-button-count", value: await use.count() });
  if (await use.count()) { await use.click(); await s.shot("04-image-after-use", { wait: 800 }); }
  report.push({ viewport: tag, state: "04-image-upload-visible", value: (await s.p.getByRole("button", { name: /Upload my photo|Change image/ }).count()) });
  await s.ctx.close();
  // 5 publish (success + failure)
  for (const outcome of ["success", "failure"]) {
    s = await session(vp, tag, `${BASE}?state=publish&outcome=${outcome}`);
    if (outcome === "success") await s.shot("05-publish-initial");
    await s.p.getByRole("button", { name: /Publish my website|Publish changes/ }).first().click();
    await s.shot(`05-publish-${outcome}-progress`, { wait: 120, meta: { note: "publish in flight" } });
    await s.shot(`05-publish-${outcome}-result`, { wait: 2200 });
    await s.ctx.close();
  }
  // 6 storefront preview
  s = await session(vp, tag, `${BASE}/site`);
  await s.shot("06-storefront-preview", { wait: 500 });
  await s.ctx.close();
}
// reduced motion evidence at 390x844
{
  const s = await session([390,844], "390x844", `${BASE}?state=publish&outcome=success`, { reduce: true });
  await s.p.getByRole("button", { name: /Publish my website|Publish changes/ }).first().click();
  await s.p.waitForTimeout(150);
  const rm = await s.p.evaluate(() => {
    const bar = document.querySelector(".jata-publish-progress");
    const frame = document.querySelector(".jc-frame__iframe");
    return { progressAnimation: bar ? getComputedStyle(bar).animationName : "absent", frameAnimation: frame ? getComputedStyle(frame).animationName : "no-frame-on-this-state" };
  });
  report.push({ viewport: "390x844", state: "reduced-motion", value: rm });
  await s.ctx.close();
}
// keyboard focus trace at 390x844 on editor
{
  const s = await session([390,844], "390x844", `${BASE}?state=editor&outcome=success`);
  const stops = [];
  for (let i = 0; i < 30; i++) {
    await s.p.keyboard.press("Tab");
    const info = await s.p.evaluate(() => {
      const el = document.activeElement; if (!el) return null;
      const cs = getComputedStyle(el);
      return { tag: el.tagName, label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0,50), outline: cs.outlineStyle, outlineWidth: cs.outlineWidth, shadow: cs.boxShadow !== "none" };
    });
    stops.push(info);
  }
  report.push({ viewport: "390x844", state: "keyboard-trace-editor", stops });
  await s.ctx.close();
}
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await b.close();
console.log("DONE", report.length);
