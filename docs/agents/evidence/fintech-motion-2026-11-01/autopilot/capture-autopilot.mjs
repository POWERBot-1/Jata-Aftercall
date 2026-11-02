import pkg from "@sparticuz/chromium";
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "/tmp/capap/out";
mkdirSync(OUT, { recursive: true });
const WIDTHS = [[320, 568], [360, 800], [390, 844], [430, 932], [768, 1024], [1366, 768]];
const args = (await pkg.args).filter((a) => !["--single-process", "--no-zygote"].includes(a));
const browser = await chromium.launch({ executablePath: await pkg.executablePath(), args, headless: true });
const report = { base: BASE, startedAt: new Date().toISOString(), layout: [], interactions: {}, errors: [] };

async function open(w, h, { reduce = false, path = "/dev/autopilot-fixture?scenario=ready" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: reduce ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  await page.goto(BASE + path, { waitUntil: "load", timeout: 180000 });
  await page.waitForSelector("[data-autopilot-fixture]", { timeout: 120000 });
  // Wait for React to hydrate (handlers attached), not just for server HTML.
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => Object.keys(b).some((k) => k.startsWith("__reactProps"))), null, { timeout: 180000 });
  await page.waitForTimeout(800);
  return { ctx, page, pageErrors, consoleErrors };
}
const requests = (page) => page.evaluate(() => window.__jataAutopilotRequests ?? []);
const bodyText = (page) => page.evaluate(() => document.body.innerText);
async function banner(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[role="alert"][aria-live], [role="status"][aria-live]');
    return el ? el.textContent.trim().slice(0, 220) : null;
  });
}
async function rowStatus(page, title) {
  return page.evaluate((t) => {
    const li = [...document.querySelectorAll("div, li, article")].filter((e) => e.textContent.includes(t) && e.querySelector("span")).sort((a,b)=>a.textContent.length-b.textContent.length)[0];
    if (!li) return null;
    const pill = [...li.querySelectorAll("span")].map((s) => s.textContent.trim()).find((s) => /^(PROPOSED|APPROVED|EXECUTED|REJECTED|EXPIRED|FAILED|ROLLED_BACK)$/.test(s));
    return pill ?? null;
  }, title);
}

// ---------- A. Layout matrix: real Command Center, fictional data ----------
for (const scenario of ["ready", "approval-pending", "paused", "kill-switch"]) {
  for (const [w, h] of WIDTHS) {
    const { ctx, page, pageErrors, consoleErrors } = await open(w, h, { path: `/dev/autopilot-fixture?scenario=${scenario}` });
    const m = await page.evaluate(() => {
      const el = document.documentElement;
      const small = [...document.querySelectorAll("button, a[href]")].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44);
      });
      return {
        overflowX: el.scrollWidth - el.clientWidth,
        smallTargets: small.length,
        smallTargetSample: small.slice(0, 3).map((b) => (b.textContent || b.getAttribute("aria-label") || "").trim().slice(0, 40)),
        fixtureNotice: !!document.querySelector('[aria-label="Development fixture notice"]'),
        headingCount: document.querySelectorAll("h1,h2").length,
      };
    });
    const hydrationWarnings = consoleErrors.filter((t) => /hydrat/i.test(t)).length;
    report.layout.push({ scenario, width: w, height: h, ...m, pageErrors: pageErrors.length, pageErrorSample: pageErrors.slice(0, 2), consoleErrors: consoleErrors.length, hydrationWarnings });
    const full = scenario === "ready" || scenario === "approval-pending";
    await page.screenshot({ path: `${OUT}/fixture-autopilot-${scenario}-${w}x${h}.png`, fullPage: full, caret: "initial" });
    await ctx.close();
  }
}

// ---------- B. Interactions at 390x844 (phone) ----------
const rowWith = (page, text, buttonName) =>
  page.locator("div").filter({ has: page.getByText(text, { exact: false }) }).filter({ has: page.getByRole("button", { name: buttonName }) }).last();
const patchCount = async (page) => (await requests(page)).filter((r) => r.method === "PATCH" && r.path === "/api/autopilot/proposals").length;

// B1: approve once, row-scoped.
{
  const { ctx, page, pageErrors } = await open(390, 844, { path: "/dev/autopilot-fixture?scenario=approval-pending" });
  const before = await rowStatus(page, "Weekend lunch offer");
  await rowWith(page, "Weekend lunch offer", /Approve/).getByRole("button", { name: /Approve/ }).click();
  await page.waitForTimeout(1200);
  report.interactions.approveSuccess = {
    statusBefore: before,
    statusAfter: await rowStatus(page, "Weekend lunch offer"),
    banner: await banner(page),
    patchRequests: (await requests(page)).filter((r) => r.method === "PATCH" && r.path === "/api/autopilot/proposals"),
    pageErrors: pageErrors.length,
  };
  await page.screenshot({ path: `${OUT}/fixture-autopilot-approve-success-390x844.png`, caret: "initial" });
  await ctx.close();
}

// B2: duplicate submit, synchronous triple activation of the same approve control.
{
  const { ctx, page } = await open(390, 844, { path: "/dev/autopilot-fixture?scenario=approval-pending" });
  const before = await patchCount(page);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Approve & Execute"));
    btn.click(); btn.click(); btn.click();
  });
  await page.waitForTimeout(1500);
  const statuses = (await requests(page)).filter((r) => r.method === "PATCH").map((r) => r.status);
  report.interactions.duplicateApproveSyncTriple = { patchRequestsFromTripleClick: (await patchCount(page)) - before, statuses, banner: await banner(page), statusAfter: await rowStatus(page, "Weekend lunch offer") };
  await ctx.close();
}

// B3: rejection is final. Reject the FAQ row (row-scoped), then a direct approve must be refused.
{
  const { ctx, page } = await open(390, 844, { path: "/dev/autopilot-fixture?scenario=approval-pending" });
  await rowWith(page, "Do you deliver", /Reject/).getByRole("button", { name: /Reject/ }).click();
  await page.waitForTimeout(1200);
  const statusAfterReject = await rowStatus(page, "Do you deliver");
  const direct = await page.evaluate(async () => {
    const r = await fetch("/api/autopilot/proposals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: "fx-tenant-a", proposalId: "fx-tenant-a-p-faq", operation: "APPROVE_AND_EXECUTE" }) });
    return { status: r.status, body: await r.json() };
  });
  report.interactions.rejectIsFinal = { statusAfterReject, direct, banner: await banner(page) };
  await ctx.close();
}

// Pause is enforced on the server, even when the UI would have allowed the call.
{
  const { ctx, page } = await open(390, 844, { path: "/dev/autopilot-fixture?scenario=ready" });
  await page.getByRole("button", { name: /Emergency Pause/ }).click();
  await page.waitForTimeout(1200);
  const pillText = await page.evaluate(() => document.body.innerText.includes("Resume Autopilot"));
  const direct = await page.evaluate(async () => {
    const r = await fetch("/api/autopilot/proposals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: "fx-tenant-a", proposalId: "fx-tenant-a-p-faq", operation: "APPROVE_AND_EXECUTE" }) });
    return { status: r.status, body: await r.json() };
  });
  report.interactions.pauseServerEnforced = { uiShowsResume: pillText, direct, banner: await banner(page) };
  await page.screenshot({ path: `${OUT}/fixture-autopilot-paused-390x844.png`, caret: "initial" });
  await ctx.close();
}

// Kill switch: UI does not hide the approve control, the server blocks it.
{
  const { ctx, page } = await open(390, 844, { path: "/dev/autopilot-fixture?scenario=kill-switch" });
  const alertText = await page.evaluate(() => document.querySelector('[role="alert"]')?.textContent?.trim().slice(0, 140) ?? null);
  const approveEnabled = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Approve & Execute"));
    return b ? !b.disabled : null;
  });
  await page.getByRole("button", { name: /Approve & Execute/ }).first().click();
  await page.waitForTimeout(1200);
  report.interactions.killSwitch = { alertText, approveEnabledInUi: approveEnabled, banner: await banner(page), statusAfter: await rowStatus(page, "Answer 'Do you deliver") };
  await page.screenshot({ path: `${OUT}/fixture-autopilot-kill-switch-390x844.png`, caret: "initial" });
  await ctx.close();
}

// Read-only role and tenant isolation in the UI.
{
  const { ctx, page } = await open(390, 844, { path: "/dev/autopilot-fixture?scenario=approval-pending&role=STAFF" });
  const readOnly = await page.evaluate(() => document.body.innerText.includes("Read-only role (STAFF)"));
  const approveDisabled = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => b.textContent.includes("Approve & Execute")).every((b) => b.disabled));
  const direct = await page.evaluate(async () => {
    const r = await fetch("/api/autopilot/proposals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: "fx-tenant-a", proposalId: "fx-tenant-a-p-offer", operation: "APPROVE_AND_EXECUTE" }) });
    return { status: r.status, body: await r.json() };
  });
  report.interactions.staffReadOnly = { readOnlyNoticeShown: readOnly, approveDisabledInUi: approveDisabled, direct };
  await ctx.close();
}
{
  const { ctx, page } = await open(390, 844, { path: "/dev/autopilot-fixture?scenario=approval-pending&tenant=b" });
  const text = await bodyText(page);
  const crossTenant = await page.evaluate(async () => {
    const r = await fetch("/api/autopilot/overview?businessId=fx-tenant-a");
    return { status: r.status, body: await r.json() };
  });
  report.interactions.tenantB = { showsTenantB: text.includes("Lakeside Salon"), showsTenantA: text.includes("Mama Pima"), readAOverviewFromB: crossTenant };
  await ctx.close();
}

// Consent visibility: record a fictional opt-in and confirm the audit feedback.
{
  const { ctx, page } = await open(390, 844, { path: "/dev/autopilot-fixture?scenario=empty" });
  await page.fill("#autopilot-consent-phone", "+254700000001");
  await page.fill("#autopilot-consent-name", "FIXTURE Customer");
  await page.getByRole("button", { name: /Record Opt-In Consent/ }).click();
  await page.waitForTimeout(1200);
  report.interactions.consentRecorded = { banner: await banner(page), auditShowsUpdate: (await bodyText(page)).includes("autopilot.consent.updated") };
  await ctx.close();
}

// Keyboard: reach the approve control by Tab, see a visible focus indicator, activate with Enter.
{
  const { ctx, page } = await open(390, 844, { path: "/dev/autopilot-fixture?scenario=approval-pending" });
  await page.evaluate(() => document.activeElement?.blur());
  let reached = null;
  for (let i = 0; i < 160 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a.tagName !== "BUTTON" || !a.textContent.includes("Approve & Execute")) return null;
      const cs = getComputedStyle(a);
      return { text: a.textContent.trim(), outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow, tabIndexOk: a.tabIndex >= 0, tabPress: null };
    });
  }
  if (reached) {
    reached.tabPress = "reached-by-keyboard";
    await page.screenshot({ path: `${OUT}/fixture-autopilot-keyboard-focus-390x844.png`, caret: "initial" });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    reached.banner = await banner(page);
    reached.patchCount = (await requests(page)).filter((r) => r.method === "PATCH").length;
  }
  report.interactions.keyboard = { reached };
  await ctx.close();
}

// Reduced motion: state entrance is removed when the user prefers reduced motion.
for (const reduce of [false, true]) {
  const { ctx, page } = await open(390, 844, { reduce, path: "/dev/autopilot-fixture?scenario=approval-pending" });
  await page.getByRole("button", { name: /Approve & Execute/ }).first().click();
  await page.waitForTimeout(60);
  const anim = await page.evaluate(() => {
    const el = document.querySelector('[role="status"][aria-live], [role="alert"][aria-live]');
    return el ? getComputedStyle(el).animationName : null;
  });
  report.interactions[reduce ? "reducedMotionOn" : "reducedMotionOff"] = { bannerAnimationName: anim };
  await ctx.close();
}

// Unsimulated endpoints fail closed.
{
  const { ctx, page } = await open(390, 844, { path: "/dev/autopilot-fixture?scenario=ready" });
  const out = await page.evaluate(async () => {
    const a = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const b = await fetch("/api/autopilot/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: "fx-tenant-a", message: "x" }) });
    return { checkout: a.status, command: b.status, commandBody: (await b.json()).error?.slice(0, 80) };
  });
  report.interactions.failClosed = out;
  await ctx.close();
}

report.finishedAt = new Date().toISOString();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log("ALL DONE", OUT);
