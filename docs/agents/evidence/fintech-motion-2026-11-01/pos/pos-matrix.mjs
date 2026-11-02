import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import fs from "node:fs";
const VP = [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]];
const BASE = "http://localhost:3000/dev/pos-fixture";
const OUT = process.env.OUT || "out/pos-matrix/after"; fs.mkdirSync(OUT, { recursive: true });
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
const all = [];
const money = async (p) => p.evaluate(() => ({
  total: document.querySelector(".pos-total-line span:last-child")?.textContent?.trim() ?? null,
  lines: document.querySelectorAll(".pos-line").length,
  complete: [...document.querySelectorAll("button")].find(b => /^Complete sale|^Saving/.test(b.textContent?.trim() ?? ""))?.textContent?.trim() ?? null,
  completeDisabled: [...document.querySelectorAll("button")].find(b => /^Complete sale|^Saving/.test(b.textContent?.trim() ?? ""))?.disabled ?? null,
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
}));
for (const [w, h] of VP) {
  const tag = `${w}x${h}`;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const p = await ctx.newPage(); const errs = []; const api = [];
  p.on("pageerror", e => errs.push(e.message));
  p.on("request", r => { if (r.url().includes("/api/pos")) api.push(r.url()); });
  const shot = async (name, rec = {}) => { await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${name}-${tag}.png`, fullPage: true }); all.push({ viewport: tag, state: name, ...(await money(p)), ...rec }); };
  const tile = (n) => p.locator("button.pos-item", { hasText: n }).first();
  await p.goto(BASE, { waitUntil: "networkidle", timeout: 180000 });
  await shot("01-empty-cart");
  await tile("Fixture Tea").click(); await shot("02-single-product");
  await tile("Fixture Mandazi").click(); await shot("03-multiple-products");
  await p.getByRole("button", { name: "One more Fixture Tea 250g" }).click(); await shot("04-quantity-increase");
  await p.getByRole("button", { name: "One less Fixture Tea 250g" }).click(); await shot("05-quantity-decrease");
  await p.getByRole("button", { name: "One less Fixture Mandazi" }).click(); await shot("06-item-removed");
  const qty = p.locator('input[aria-label="Quantity of Fixture Tea 250g"]');
  await qty.fill(""); await shot("07-empty-quantity-input", { qtyValue: await qty.inputValue() });
  await qty.fill("2.7"); await shot("08-invalid-decimal-input", { qtyValue: await qty.inputValue() });
  await qty.fill("0"); await shot("09-zero-quantity-removes-line");
  await tile("Fixture Tea").click(); await tile("Fixture Mandazi").click();
  await p.getByRole("button", { name: "One more Fixture Mandazi" }).click();
  await p.getByRole("button", { name: "One more Fixture Mandazi" }).click();
  await shot("10-subtotal-total-multi", { expectedTotal: "KES 410" });
  await p.getByRole("button", { name: "Cash" }).click(); await shot("11-checkout-ready");
  await p.getByRole("button", { name: /^Complete sale/ }).click(); await shot("12-success");
  for (const outcome of ["pending", "failure"]) {
    const q = await b.newContext({ viewport: { width: w, height: h } }); const pp = await q.newPage();
    pp.on("request", r => { if (r.url().includes("/api/pos")) api.push(r.url()); });
    await pp.goto(`${BASE}?outcome=${outcome}`, { waitUntil: "networkidle", timeout: 180000 });
    await pp.locator("button.pos-item", { hasText: "Fixture Tea" }).first().click();
    await pp.getByRole("button", { name: "Cash" }).click();
    await pp.getByRole("button", { name: /^Complete sale/ }).click();
    await pp.waitForTimeout(350);
    await pp.screenshot({ path: `${OUT}/${outcome === "pending" ? "13-pending" : "14-failure"}-${tag}.png`, fullPage: true });
    all.push({ viewport: tag, state: outcome, text: (await pp.textContent("body")).replace(/\s+/g, " ").slice(0, 0) , outcomeText: await pp.evaluate(() => (document.querySelector(".pos-till")?.nextElementSibling?.textContent ?? "").slice(0,200)) });
    await q.close();
  }
  all.push({ viewport: tag, state: "meta", pageErrors: errs.length, realPosApiCalls: api.length });
  await ctx.close();
}
fs.writeFileSync(`${OUT}/../matrix.json`, JSON.stringify(all, null, 2));
console.log("DONE", all.length);
await b.close();
