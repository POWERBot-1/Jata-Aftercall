import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import fs from "node:fs";
const VP = [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]];
const SERVERS = { before: "http://localhost:3001", after: "http://localhost:3000" };
const PATH = "/dev/workspace-preview";
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
const report = { generatedAt: new Date().toISOString(), rows: [] };
for (const [label, base] of Object.entries(SERVERS)) {
  fs.mkdirSync(`out/${label}`, { recursive: true });
  for (const [w, h] of VP) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const errors = []; p.on("pageerror", e => errors.push(e.message));
    const res = await p.goto(base + PATH, { waitUntil: "networkidle", timeout: 180000 });
    await p.waitForTimeout(900);
    const anim = await p.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const cs = (el) => el ? getComputedStyle(el).animationName : null;
      return {
        routeEnter: cs(q(".jata-route-enter")),
        statsFirst: cs(q(".ws-hero__stats > *")),
        statsThird: cs(document.querySelectorAll(".ws-hero__stats > *")[2]),
        sectionFirst: cs(q(".ws-stack.jata-motion-entry > *")),
        stackOwnAnimation: cs(q(".ws-stack.jata-motion-entry")),
        railAria: cs(q('.ws-rail a[aria-current="page"]')),
      };
    });
    const file = `out/${label}/${w}x${h}.png`;
    await p.screenshot({ path: file, fullPage: false });
    report.rows.push({ label, viewport: `${w}x${h}`, status: res.status(), pageErrors: errors, anim, screenshot: file, overflowX: await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth) });
    await ctx.close();
  }
}
// Entrance frame sequence (after build) at 1366x768 to show stagger timing.
{
  fs.mkdirSync("out/motion-frames", { recursive: true });
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(SERVERS.after + PATH + "?t=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 180000 });
  const t0 = Date.now();
  for (const ms of [0, 120, 260, 500]) {
    const wait = ms - (Date.now() - t0); if (wait > 0) await p.waitForTimeout(wait);
    await p.screenshot({ path: `out/motion-frames/t${String(ms).padStart(4,"0")}ms.png` });
  }
  await ctx.close();
}
// Reduced motion: final state must be fully visible with no animation.
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.goto(SERVERS.after + PATH, { waitUntil: "networkidle", timeout: 180000 });
  const r = await p.evaluate(() => {
    const els = [...document.querySelectorAll(".ws-hero__stats > *, .ws-stack.jata-motion-entry > *")];
    return els.map(e => ({ anim: getComputedStyle(e).animationName, opacity: getComputedStyle(e).opacity }));
  });
  report.reducedMotion = r;
  await p.screenshot({ path: "out/after/reduced-motion-390x844.png" });
  await ctx.close();
}
await b.close();
fs.writeFileSync("out/report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.rows.map(r => ({ l: r.label, v: r.viewport, s: r.status, e: r.pageErrors.length, o: r.overflowX, a: r.anim })), null, 1));
console.log("REDUCED", JSON.stringify(report.reducedMotion));
