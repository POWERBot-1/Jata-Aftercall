import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import fs from "node:fs";
const OUT = "out/studio-motion"; fs.mkdirSync(OUT, { recursive: true });
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
const out = [];
for (const reduce of [false, true]) {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: reduce ? "reduce" : "no-preference" })).newPage();
  await p.goto("http://localhost:3000/dev/studio-fixture?state=category&outcome=success", { waitUntil: "load", timeout: 240000 });
  await p.waitForSelector('input[name="category"]', { timeout: 120000 });
  const measure = () => p.evaluate(() => {
    const label = document.querySelector('label:has(input[name="category"])');
    const animating = [...document.querySelectorAll("*")].filter(el => { const n = getComputedStyle(el).animationName; return n && n !== "none"; }).map(el => (el.className && el.className.baseVal === undefined ? el.className : el.tagName) + ":" + getComputedStyle(el).animationName);
    return { labelTransition: label ? getComputedStyle(label).transitionDuration : "absent", labelBorder: label ? getComputedStyle(label).borderColor : null, animating: animating.slice(0, 12), animatingCount: animating.length };
  });
  const before = await measure();
  await p.locator('label:has(input[name="category"])').first().click();
  await p.waitForTimeout(40);
  const during = await measure();
  await p.getByRole("button", { name: "Start my website" }).click();
  await p.waitForTimeout(120);
  const busy = await measure();
  await p.waitForTimeout(1500);
  const done = await measure();
  const statusText = await p.locator('[role="status"]').allInnerTexts();
  out.push({ reducedMotion: reduce, before, during, busy, done, statusText: statusText.slice(0, 3) });
  if (!reduce) await p.screenshot({ path: `${OUT}/category-selected-390x844.png` });
  await p.context().close();
}
fs.writeFileSync(`${OUT}/reduced-motion-category.json`, JSON.stringify(out, null, 2));
await b.close();
console.log(JSON.stringify(out.map(o => ({ rm: o.reducedMotion, before: o.before.labelTransition, during: o.during.animatingCount, busy: o.busy.animating, done: o.done.animatingCount, status: o.statusText })), null, 1));
