import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import fs from "node:fs";
const VP = [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]];
const BASE = "http://localhost:3000/dev/pos-fixture";
const OUT = "out/pos/after"; fs.mkdirSync(OUT, { recursive: true });
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
const rows = [];
for (const [w, h] of VP) {
  const tag = `${w}x${h}`;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const p = await ctx.newPage(); const errs = []; const apiCalls = [];
  p.on("pageerror", e => errs.push(e.message));
  p.on("request", r => { if (r.url().includes("/api/")) apiCalls.push(r.url()); });
  await p.goto(BASE, { waitUntil: "networkidle", timeout: 180000 });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/01-empty-${tag}.png`, fullPage: true });
  await p.locator("button.pos-item").first().click();
  await p.getByRole("button", { name: "One more Fixture Tea 250g" }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Cash" }).click();
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/02-cart-ready-${tag}.png`, fullPage: true });
  await p.getByRole("button", { name: /^Complete sale/ }).click();
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/03-success-${tag}.png`, fullPage: true });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  rows.push({ viewport: tag, pageErrors: errs.length, apiCallsToRealEndpoint: apiCalls.filter(u => u.includes("/api/pos")).length, overflowX: overflow });
  await ctx.close();
}
// Failure outcome at 390x844
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(BASE + "?outcome=failure", { waitUntil: "networkidle", timeout: 180000 });
  await p.locator("button.pos-item").first().click();
  await p.getByRole("button", { name: "Cash" }).click();
  await p.getByRole("button", { name: /^Complete sale/ }).click();
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/04-failure-390x844.png`, fullPage: true });
  rows.push({ viewport: "390x844-failure", text: (await p.textContent("body")).includes("declined") });
  await ctx.close();
}
// Reduced motion
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "networkidle", timeout: 180000 });
  await p.locator("button.pos-item").first().click();
  await p.waitForTimeout(100);
  rows.push({ viewport: "390x844-reduced", valueBumpAnimation: await p.evaluate(() => [...document.querySelectorAll(".jata-value-bump")].map(e => getComputedStyle(e).animationName)) });
  await ctx.close();
}
fs.writeFileSync("out/pos/report.json", JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows, null, 2));
await b.close();
