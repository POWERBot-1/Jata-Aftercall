import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import fs from "node:fs";
const VP = [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]];
const SERVERS = { before: "http://localhost:3001", after: "http://localhost:3000" };
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
const rows = [];
for (const [label, base] of Object.entries(SERVERS)) {
  const dir = `out/dash/${label}`; fs.mkdirSync(dir, { recursive: true });
  for (const [w, h] of VP) {
    const tag = `${w}x${h}`;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
    await p.goto(base + "/dev/workspace-preview", { waitUntil: "networkidle", timeout: 180000 });
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${dir}/default-${tag}.png` });
    // Keyboard: Tab through the rail to the first link, record focus frame
    await p.keyboard.press("Tab"); await p.keyboard.press("Tab"); await p.keyboard.press("Tab");
    await p.waitForTimeout(200);
    await p.screenshot({ path: `${dir}/keyboard-focus-${tag}.png` });
    const focused = await p.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 40));
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await ctx.close();
    const ctx2 = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const p2 = await ctx2.newPage();
    await p2.goto(base + "/dev/workspace-preview?state=empty", { waitUntil: "networkidle", timeout: 180000 });
    await p2.waitForTimeout(700);
    await p2.screenshot({ path: `${dir}/empty-${tag}.png` });
    const emptyOverflow = await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await ctx2.close();
    rows.push({ label, viewport: tag, status: "ok", pageErrors: errs.length, focusedAfterTab3: focused, overflowX: overflow, emptyOverflowX: emptyOverflow });
  }
}
// Reduced motion on the after build
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.goto(SERVERS.after + "/dev/workspace-preview", { waitUntil: "networkidle", timeout: 180000 });
  rows.push({ label: "after-reduced", viewport: "390x844", animations: await p.evaluate(() => [...document.querySelectorAll(".ws-hero__stats > *, .ws-stack.jata-motion-entry > *")].map(e => getComputedStyle(e).animationName)) });
  await p.screenshot({ path: "out/dash/after/reduced-motion-390x844.png" });
  await ctx.close();
}
await b.close();
fs.writeFileSync("out/dash/report.json", JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows.map(r => ({ l: r.label, v: r.viewport, e: r.pageErrors, f: r.focusedAfterTab3, o: r.overflowX, eo: r.emptyOverflowX, a: r.animations })), null, 0));
