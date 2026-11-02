import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import fs from "node:fs";
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
const out = {};
for (const reduced of [false, true]) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: reduced ? "reduce" : "no-preference" });
  const p = await ctx.newPage();
  await p.goto("http://localhost:3000/dev/pos-fixture", { waitUntil: "networkidle", timeout: 180000 });
  const anim = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map(e => getComputedStyle(e).animationName), sel);
  const r = {};
  await p.locator("button.pos-item", { hasText: "Fixture Tea" }).first().click();
  r.lineEnter = await anim(".pos-line");
  await p.getByRole("button", { name: "One more Fixture Tea 250g" }).click();
  r.qtyBump = await anim(".pos-qty .jata-value-bump");
  r.totalBump = await anim(".pos-total-line .jata-value-bump");
  r.tileTransition = await p.evaluate(() => getComputedStyle(document.querySelector("button.pos-item")).transitionProperty);
  await p.getByRole("button", { name: "Cash" }).click();
  await p.getByRole("button", { name: /^Complete sale/ }).click();
  await p.waitForTimeout(300);
  r.resultEnter = await anim(".jata-state-enter");
  r.resultText = await p.evaluate(() => document.querySelector(".jata-state-enter .jata-kicker")?.textContent ?? null);
  out[reduced ? "reduced" : "default"] = r;
  await ctx.close();
}
fs.writeFileSync("out/pos-matrix/motion.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await b.close();
