import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import fs from "node:fs";
const VP = [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]];
const SERVERS = { before: "http://localhost:3001", after: "http://localhost:3000" };
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
const rows = [];
for (const [label, base] of Object.entries(SERVERS)) {
  const dir = `out/auth/${label}`; fs.mkdirSync(dir, { recursive: true });
  for (const [w, h] of VP) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", e => errs.push(e.message));
    const tag = `${w}x${h}`;
    // Login: settled + focus state
    await p.goto(base + "/login", { waitUntil: "networkidle", timeout: 180000 });
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${dir}/login-${tag}.png` });
    await p.locator("input[type=email]").first().focus();
    await p.waitForTimeout(250);
    await p.screenshot({ path: `${dir}/login-focus-${tag}.png` });
    // Register: complete valid-looking form -> server failure (no DB) -> error state
    await p.goto(base + "/register", { waitUntil: "networkidle", timeout: 180000 });
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${dir}/register-${tag}.png` });
    const fills = [["#register-name", "Test Merchant"], ["#register-email", "merchant.test@example.invalid"]];
    for (const [sel, v] of fills) await p.locator(sel).fill(v);
    const inputs = p.locator("form input");
    const n = await inputs.count();
    for (let i = 0; i < n; i++) {
      const el = inputs.nth(i); const type = await el.getAttribute("type"); const id = await el.getAttribute("id"); const ac = await el.getAttribute("autocomplete");
      if (ac === "tel") { await el.fill("+254712345678"); continue; }
      if (id === "register-name" || id === "register-email") continue;
      if (type === "password") await el.fill("FictionPass123");
      else if (type === "tel") await el.fill("+254712345678");
      else if (type === "checkbox") { if (!(await el.isChecked())) await el.check().catch(() => {}); }
      else if (await el.isEditable()) { const cur = await el.inputValue(); if (!cur) await el.fill("Fixture Business"); }
    }
    await p.locator("form button[type=submit]").first().click();
    await p.waitForTimeout(1500);
    const alertText = await p.locator(".jata-error, [role=alert]").first().textContent().catch(() => null);
    await p.screenshot({ path: `${dir}/register-submit-${tag}.png` });
    // Pricing settled
    await p.goto(base + "/pricing", { waitUntil: "networkidle", timeout: 180000 });
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${dir}/pricing-${tag}.png`, fullPage: false });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    rows.push({ label, viewport: tag, pageErrors: errs.length, alertText: alertText && alertText.trim().slice(0, 140), overflowX: overflow });
    await ctx.close();
  }
}
// Reduced motion on after build: error element must have no animation
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.goto(SERVERS.after + "/register", { waitUntil: "networkidle", timeout: 180000 });
  for (const [sel, v] of [["#register-name", "Test Merchant"], ["#register-email", "merchant.test@example.invalid"]]) await p.locator(sel).fill(v);
  const inputs = p.locator("form input"); const n = await inputs.count();
  for (let i = 0; i < n; i++) { const el = inputs.nth(i); const type = await el.getAttribute("type"); const id = await el.getAttribute("id"); const ac = await el.getAttribute("autocomplete");
    if (ac === "tel") { await el.fill("+254712345678"); continue; }
    if (id === "register-name" || id === "register-email") continue;
    if (type === "password") await el.fill("FictionPass123"); else if (type === "tel") await el.fill("+254712345678"); else if (await el.isEditable()) { if (!(await el.inputValue())) await el.fill("Fixture Business"); } }
  await p.locator("form button[type=submit]").first().click();
  await p.waitForTimeout(1500);
  rows.push({ label: "after-reduced", viewport: "390x844", errorAnimation: await p.evaluate(() => { const e = document.querySelector(".jata-error"); return e ? getComputedStyle(e).animationName : "no error element"; }) });
  await ctx.close();
}
await b.close();
fs.writeFileSync("out/auth/report.json", JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows, null, 1));
