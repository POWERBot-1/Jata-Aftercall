import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import fs from "node:fs";
const OUT = "out/pos-keys"; fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000/dev/pos-fixture";
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
const report = {};
const focusInfo = (p) => p.evaluate(() => {
  const el = document.activeElement; if (!el) return null;
  const cs = getComputedStyle(el);
  const outlineVisible = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
  return { tag: el.tagName, label: el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || el.getAttribute("placeholder") || "", outlineVisible, outline: `${cs.outlineStyle} ${cs.outlineWidth}` };
});
async function tabTo(p, pred, max = 60) {
  for (let i = 0; i < max; i++) {
    await p.keyboard.press("Tab");
    const f = await focusInfo(p);
    if (f && pred(f)) return f;
  }
  return null;
}
// 1) Keyboard journey at 390x844, default motion, with trace
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.tracing.start({ screenshots: true, snapshots: true });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto(BASE, { waitUntil: "networkidle", timeout: 180000 });
  const steps = [];
  const tea = await tabTo(p, f => f.label.startsWith("Fixture Tea"));
  steps.push({ step: "reach product tile", ...tea });
  await p.keyboard.press("Enter"); await p.waitForTimeout(200);
  steps.push({ step: "Enter adds Tea", lines: await p.locator(".pos-line").count(), total: await p.locator(".pos-total-line span:last-child").innerText() });
  const more = await tabTo(p, f => f.label === "One more Fixture Tea 250g");
  steps.push({ step: "reach quantity +", ...more });
  await p.keyboard.press("Enter"); await p.waitForTimeout(200);
  steps.push({ step: "Enter increases qty", qty: await p.locator('input[aria-label="Quantity of Fixture Tea 250g"]').inputValue(), total: await p.locator(".pos-total-line span:last-child").innerText() });
  await p.screenshot({ path: `${OUT}/k1-qty-focus-390x844.png`, fullPage: true });
  const cash = await tabTo(p, f => f.label === "Cash");
  steps.push({ step: "reach Cash", ...cash });
  await p.keyboard.press("Enter"); await p.waitForTimeout(150);
  const complete = await tabTo(p, f => f.label.startsWith("Complete sale") || f.label.startsWith("Saving"));
  steps.push({ step: "reach checkout", ...complete, disabled: await p.evaluate(() => document.activeElement?.disabled) });
  await p.screenshot({ path: `${OUT}/k2-checkout-ready-focus-390x844.png`, fullPage: true });
  // Keyboard removal: reach "One less" and press Enter (qty 2 -> 1 -> 0)
  const less = await tabTo(p, f => f.label === "One less Fixture Tea 250g", 80);
  steps.push({ step: "reach quantity −", ...less });
  await p.keyboard.press("Enter"); await p.waitForTimeout(40);
  steps.push({ step: "after − (qty 1)", ghosts: await p.locator(".pos-line-leaving").count(), total: await p.locator(".pos-total-line span:last-child").innerText() });
  await p.keyboard.press("Enter"); await p.waitForTimeout(40);
  steps.push({ step: "after − (zero) exit ghost", ghosts: await p.locator(".pos-line-leaving").count(), ghostAriaHidden: await p.locator(".pos-line-leaving").first().getAttribute("aria-hidden").catch(() => null), total: await p.locator(".pos-total-line span:last-child").innerText() });
  await p.waitForTimeout(400);
  steps.push({ step: "after exit", ghosts: await p.locator(".pos-line-leaving").count() });
  await ctx.tracing.stop({ path: `${OUT}/pos-keyboard-trace-390x844.zip` });
  report.keyboard = { steps, pageErrors: errs.length };
  await ctx.close();
}
// 2) Reduced motion: exit ghost never created
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "networkidle", timeout: 180000 });
  await p.locator("button.pos-item", { hasText: "Fixture Tea" }).first().click();
  const lineAnim = await p.evaluate(() => getComputedStyle(document.querySelector(".pos-line")).animationName);
  await p.getByRole("button", { name: "One less Fixture Tea 250g" }).click();
  report.reducedMotion = { lineAnim, ghostsAfterRemoval: await p.locator(".pos-line-leaving").count(), totalAfterRemoval: await p.locator(".pos-total-line span:last-child").innerText() };
  await ctx.close();
}
// 3) Owner-Lite: static till, no ghost, no animations, motion attribute present
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(BASE + "?motion=lite", { waitUntil: "networkidle", timeout: 180000 });
  await p.locator("button.pos-item", { hasText: "Fixture Tea" }).first().click();
  await p.getByRole("button", { name: "One more Fixture Tea 250g" }).click();
  const anims = await p.evaluate(() => [...document.querySelectorAll(".pos-till *")].map(e => getComputedStyle(e).animationName).filter(n => n !== "none"));
  await p.getByRole("button", { name: "One less Fixture Tea 250g" }).click();
  await p.getByRole("button", { name: "One less Fixture Tea 250g" }).click();
  report.ownerLite = { attr: await p.getAttribute(".pos-till", "data-pos-motion"), nonNoneAnimations: anims.length, ghostsAfterRemoval: await p.locator(".pos-line-leaving").count() };
  await ctx.close();
}
// 4) Focus visibility on each interactive class at 390x844 (computed outline)
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "networkidle", timeout: 180000 });
  await p.locator("button.pos-item", { hasText: "Fixture Tea" }).first().click();
  const seen = {};
  for (let i = 0; i < 40; i++) { await p.keyboard.press("Tab"); const f = await focusInfo(p); if (f) { const k = f.tag + ":" + f.label.split(" ")[0]; if (!(k in seen)) seen[k] = { label: f.label, outlineVisible: f.outlineVisible, outline: f.outline }; } }
  report.focusVisibility = seen;
  await ctx.close();
}
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await b.close();
