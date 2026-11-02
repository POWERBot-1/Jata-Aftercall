// Autopilot FIXTURE remediation capture (fictional data only). Runs against the branch dev server.
// Measures from rendered output: overflow, page errors, target size (both picker states),
// kill-switch control state and blocked clicks, approval sequencing, focus ring vs surface
// (PNG pixels, all four sides), contrast, reduced motion, STAFF / paused / tenant B, decide responses.
import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { measureFocusRing, contrast } from "./focus-measure.mjs";

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || "/tmp/capremed/out";
const THEME = process.env.THEME || "lime-spark";
const WIDTHS = [[320, 568], [360, 800], [390, 844], [430, 932], [768, 1024], [1366, 768]];
mkdirSync(OUT, { recursive: true });

const report = { base: BASE, theme: THEME, generatedAt: new Date().toISOString(), layout: [], interactions: {} };
const decideLog = [];

const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter((a) => a !== "--single-process" && a !== "--no-zygote"),
  headless: true,
});

async function newPage(opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 390, height: 844 },
    deviceScaleFactor: 1,
    reducedMotion: opts.reducedMotion || "no-preference",
  });
  await ctx.addInitScript((t) => window.localStorage.setItem("jata-product-theme", t), THEME);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e.message).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error" && /hydrat/i.test(m.text())) page.errors.push("HYDRATION: " + m.text().slice(0, 200));
  });
  page.on("response", (r) => {
    if (r.url().includes("/dev/autopilot-fixture/decide")) {
      const entry = { method: r.request().method(), status: r.status() };
      decideLog.push(entry);
      r.text().then((t) => (entry.body = t.slice(0, 160))).catch(() => {});
    }
  });
  return { ctx, page };
}

async function open(page, qs) {
  await page.goto(`${BASE}/dev/autopilot-fixture?${qs}`, { waitUntil: "load", timeout: 180000 });
  await page.waitForSelector("[data-autopilot-fixture]", { timeout: 180000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some((b) => Object.keys(b).some((k) => k.startsWith("__reactProps"))),
    null,
    { timeout: 180000 },
  );
  await page.waitForTimeout(700);
}

const approveBtns = (page) => page.getByRole("button", { name: /Approve & Execute/ });
const logLen = (page) => page.evaluate(() => (window.__jataAutopilotRequests || []).length);
const patchCount = (page) => page.evaluate(() => (window.__jataAutopilotRequests || []).filter((r) => r.method === "PATCH").length);

// Target-size audit: visible (checkVisibility) interactive elements under 24px, with selectors.
const auditTargets = (page) =>
  page.evaluate(() => {
    const sel = "button, a[href], input, select, textarea, [role=button], [role=tab], [role=switch], [role=checkbox], summary";
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const visible = el.checkVisibility ? el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }) : el.offsetParent !== null;
      if (!visible) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width < 24 || r.height < 24) {
        const path = [];
        let cur = el;
        for (let i = 0; i < 3 && cur && cur !== document.body; i++) {
          let s = cur.tagName.toLowerCase();
          const cls = (cur.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
          if (cls) s += "." + cls;
          path.unshift(s);
          cur = cur.parentElement;
        }
        out.push({
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50),
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
          selector: path.join(" > "),
        });
      }
    }
    return out;
  });

async function layoutCheck(page, [w, h], name) {
  const base = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    scrollWidth: document.documentElement.scrollWidth,
    fixtureNotice: /FICTIONAL FIXTURE/.test(document.body.textContent || ""),
    killAlertVisible: [...document.querySelectorAll("[role=alert]")].some((x) => /Kill Switch/.test(x.textContent || "")),
  }));
  const targetsClosed = await auditTargets(page);
  // Open the Appearance picker so the theme radios are measured in the state where they are usable.
  await page.locator("details.product-theme-picker > summary").first().click().catch(() => {});
  await page.waitForTimeout(300);
  const targetsOpen = await auditTargets(page);
  await page.locator("details.product-theme-picker > summary").first().click().catch(() => {});
  report.layout.push({
    name, width: w, height: h, ...base,
    smallTargetsClosed: targetsClosed,
    smallTargetsPickerOpen: targetsOpen,
    pageErrors: page.errors.length, errors: page.errors,
  });
}

// ---------- 1. Six widths: layout, targets, kill-switch and approval-pending screenshots ----------
for (const [w, h] of WIDTHS) {
  const a = await newPage({ viewport: { width: w, height: h } });
  await open(a.page, "scenario=kill-switch&role=OWNER&tenant=a");
  await layoutCheck(a.page, [w, h], "kill-switch");
  await a.page.screenshot({ path: `${OUT}/kill-switch-${w}x${h}.png`, fullPage: true, caret: "initial" });
  await a.ctx.close();

  const b = await newPage({ viewport: { width: w, height: h } });
  await open(b.page, "scenario=approval-pending&role=OWNER&tenant=a");
  await layoutCheck(b.page, [w, h], "approval-pending");
  await b.page.screenshot({ path: `${OUT}/approval-pending-${w}x${h}.png`, fullPage: true, caret: "initial" });
  await b.ctx.close();
}

// ---------- 2. Focus ring vs rendered surface, six widths, Approve and Reject ----------
report.focus = {};
for (const [w, h] of WIDTHS) {
  const { ctx, page } = await newPage({ viewport: { width: w, height: h } });
  await open(page, "scenario=approval-pending&role=OWNER&tenant=a");
  const out = {};
  for (const kind of ["approve", "reject"]) {
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    let reached = false;
    for (let i = 0; i < 200 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate((k) => {
        const el = document.activeElement;
        if (!el) return false;
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        const ok = k === "approve" ? /Approve & Execute/.test(t) : el.tagName === "BUTTON" && /Reject/.test(t);
        if (ok) el.setAttribute("data-probe", k);
        return ok;
      }, kind);
    }
    if (!reached) {
      out[kind] = { reached: false };
      continue;
    }
    const m = await measureFocusRing(page, page.locator(`[data-probe="${kind}"]`));
    writeFileSync(`${OUT}/focus-${kind}-${w}x${h}.png`, m.focusedPng);
    writeFileSync(`${OUT}/focus-${kind}-bare-${w}x${h}.png`, m.barePng);
    out[kind] = {
      reached: true,
      box: m.box,
      ringRGB: m.worstSide.ringRGB,
      surfaceRGB: m.worstSide.surfaceRGB,
      fillRGB: m.fillRGB,
      ringVsSurfaceWorstSide: m.ringVsSurface,
      ringVsFill: m.ringVsFill,
      perSide: Object.fromEntries(Object.entries(m.perSide).map(([k, v]) => [k, { ring: v.ringRGB, surface: v.surfaceRGB, ratio: v.ratio }])),
      ringDrawnAllSides: m.ringDiffersFromSurface,
    };
  }
  report.focus[`${w}x${h}`] = out;
  await ctx.close();
}

// ---------- 3. Approval-success sequencing at six widths ----------
report.interactions.approveSuccess = {};
for (const [w, h] of WIDTHS) {
  const { ctx, page } = await newPage({ viewport: { width: w, height: h } });
  await open(page, "scenario=approval-pending&role=OWNER&tenant=a");
  const pBefore = await patchCount(page);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Approve & Execute/.test(x.textContent || ""));
    b.click(); b.click(); b.click();
  });
  let ok = true;
  await page.waitForFunction(() => /Action verified and executed/.test(document.body.textContent || ""), null, { timeout: 20000 }).catch(() => (ok = false));
  await page.waitForTimeout(500);
  const banner = await page.evaluate(() => {
    const el = [...document.querySelectorAll("[role=status]")].find((x) => /Action verified|rejected|rolled/i.test(x.textContent || ""));
    return el ? { text: el.textContent.trim().slice(0, 140), ariaLive: el.getAttribute("aria-live"), role: el.getAttribute("role") } : null;
  });
  report.interactions.approveSuccess[`${w}x${h}`] = { okBanner: ok, banner, patchRequestsFromTripleClick: (await patchCount(page)) - pBefore };
  await page.screenshot({ path: `${OUT}/approve-success-${w}x${h}.png`, fullPage: true, caret: "initial" });
  await ctx.close();
}

// ---------- 4. Kill switch ACTIVE at 390: disabled controls and blocked clicks ----------
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
  await open(page, "scenario=kill-switch&role=OWNER&tenant=a");
  const n = await approveBtns(page).count();
  const disabled = [];
  for (let i = 0; i < n; i++) disabled.push(await approveBtns(page).nth(i).isDisabled());
  const before = await logLen(page);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].filter((b) => /Approve & Execute/.test(b.textContent || "")).forEach((b) => b.click());
  });
  await page.waitForTimeout(700);
  const after = await logLen(page);
  const alertText = await page.evaluate(() => {
    const el = [...document.querySelectorAll("[role=alert]")].find((x) => /Kill Switch/.test(x.textContent || ""));
    return el ? el.textContent.trim().replace(/\s+/g, " ") : null;
  });
  const successBanner = await page.evaluate(() => /Action verified and executed/.test(document.body.textContent || ""));
  report.interactions.killSwitchActive = {
    approveButtons: n, approveDisabled: disabled,
    requestsBeforeBlockedClicks: before, requestsAfterBlockedClicks: after,
    newRequestsFromBlockedClicks: after - before,
    successBannerShown: successBanner, alertText,
  };
  await page.locator("[role=alert]", { hasText: "Kill Switch" }).first().screenshot({ path: `${OUT}/kill-switch-alert-390x844.png`, caret: "initial" });
  await ctx.close();
}

// ---------- 5. Contrast of key text on the rendered surface (computed colours, canvas-normalised) ----------
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
  await open(page, "scenario=approval-pending&role=OWNER&tenant=a");
  report.interactions.contrastText = await page.evaluate(() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const rgba = (s) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const L1 = lum(a), L2 = lum(b); return Number(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2)); };
    const bgOf = (el) => { let c = el; while (c) { const v = rgba(getComputedStyle(c).backgroundColor); if (v[3] > 0.99) return v.slice(0, 3); c = c.parentElement; } return [255, 255, 255]; };
    const measure = (el) => { const fg = rgba(getComputedStyle(el).color).slice(0, 3); const bg = bgOf(el); return { fg, bg, ratio: ratio(fg, bg) }; };
    const approve = [...document.querySelectorAll("button")].find((x) => /Approve & Execute/.test(x.textContent || ""));
    const card = approve && approve.closest("div");
    const out = {};
    if (approve) out.approveEnabledLabel = measure(approve);
    if (card) out.proposalCardTitle = measure(card.querySelector("p, strong, h3, h4") || card);
    return out;
  });
  await ctx.close();
}

// ---------- 6. Reduced motion: measured animation on the kill-switch alert ----------
for (const mode of ["no-preference", "reduce"]) {
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, reducedMotion: mode });
  await open(page, "scenario=kill-switch&role=OWNER&tenant=a");
  report.interactions[`reducedMotion_${mode}`] = await page.evaluate(() => {
    const el = [...document.querySelectorAll("[role=alert]")].find((x) => /Kill Switch/.test(x.textContent || ""));
    return { alertAnimationName: el ? getComputedStyle(el).animationName : null };
  });
  await ctx.close();
}

// ---------- 7. STAFF, paused, tenant B ----------
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
  await open(page, "scenario=approval-pending&role=STAFF&tenant=a");
  const n = await approveBtns(page).count();
  const d = [];
  for (let i = 0; i < n; i++) d.push(await approveBtns(page).nth(i).isDisabled());
  report.interactions.staff = { approveButtons: n, approveDisabled: d };
  await ctx.close();
}
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
  await open(page, "scenario=paused&role=OWNER&tenant=a");
  const n = await approveBtns(page).count();
  const d = [];
  for (let i = 0; i < n; i++) d.push(await approveBtns(page).nth(i).isDisabled());
  report.interactions.paused = { approveButtons: n, approveDisabled: d };
  await ctx.close();
}
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
  await open(page, "scenario=approval-pending&role=OWNER&tenant=b");
  const text = await page.evaluate(() => document.body.textContent || "");
  report.interactions.tenantB = { showsTenantB: /tenant B/.test(text), showsTenantA: /tenant A/.test(text) };
  await ctx.close();
}

report.decideResponses = decideLog.map((d) => ({ method: d.method, status: d.status, body: (d.body || "").slice(0, 160) }));
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log("ALL DONE", OUT);
