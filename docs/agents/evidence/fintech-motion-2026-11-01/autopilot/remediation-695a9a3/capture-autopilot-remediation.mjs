// Autopilot FIXTURE capture (fictional data). Runs against the branch dev server.
// Measures: kill-switch control state, blocked-click behaviour, approve-success sequencing,
// visible keyboard focus (pixel comparison), contrast, reduced motion, focus order, layout.
import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || "/tmp/capfinal/out";
const WIDTHS = [[320, 568], [360, 800], [390, 844], [430, 932], [768, 1024], [1366, 768]];
mkdirSync(OUT, { recursive: true });

const report = { base: BASE, generatedAt: new Date().toISOString(), layout: [], interactions: {} };
const decideLog = []; // real HTTP responses from the fixture decide route

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
  // Wait for React hydration (event handlers attached), not just server HTML.
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some((b) => Object.keys(b).some((k) => k.startsWith("__reactProps"))),
    null,
    { timeout: 180000 },
  );
  await page.waitForTimeout(700);
}

const approveBtns = (page) => page.getByRole("button", { name: /Approve & Execute/ });
const logLen = (page) => page.evaluate(() => (window.__jataAutopilotRequests || []).length);
const patchCount = (page) =>
  page.evaluate(() => (window.__jataAutopilotRequests || []).filter((r) => r.method === "PATCH").length);

async function layoutCheck(page, [w, h], name) {
  const m = await page.evaluate(() => {
    const interactive = [...document.querySelectorAll("button, a, input, select, textarea")].filter(
      (el) => el.offsetParent !== null,
    );
    const small = interactive.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.height < 24;
    }).length;
    const alertEl = [...document.querySelectorAll("[role=alert]")].find((el) => /Kill Switch/.test(el.textContent || ""));
    return {
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
      smallTargets24: small,
      fixtureNotice: /FICTIONAL FIXTURE/.test(document.body.textContent || ""),
      killAlertVisible: Boolean(alertEl),
    };
  });
  report.layout.push({ name, width: w, height: h, ...m, pageErrors: page.errors.length, errors: page.errors });
  return m;
}

// ---------- 1. Six-width sweep: kill switch active, approval pending, paused, STAFF ----------
for (const [w, h] of WIDTHS) {
  const { ctx, page } = await newPage({ viewport: { width: w, height: h } });
  await open(page, "scenario=kill-switch&role=OWNER&tenant=a");
  await layoutCheck(page, [w, h], "kill-switch");
  await page.screenshot({ path: `${OUT}/kill-switch-${w}x${h}.png`, fullPage: true, caret: "initial" });
  await ctx.close();

  const c2 = await newPage({ viewport: { width: w, height: h } });
  await open(c2.page, "scenario=approval-pending&role=OWNER&tenant=a");
  await layoutCheck(c2.page, [w, h], "approval-pending");
  await c2.page.screenshot({ path: `${OUT}/approval-pending-${w}x${h}.png`, fullPage: true, caret: "initial" });
  await c2.ctx.close();
}

// ---------- 2. Kill switch active at 390: disabled controls, blocked clicks, no requests ----------
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
  await open(page, "scenario=kill-switch&role=OWNER&tenant=a");
  const n = await approveBtns(page).count();
  const disabled = [];
  for (let i = 0; i < n; i++) disabled.push(await approveBtns(page).nth(i).isDisabled());
  const before = await logLen(page);
  const clickResults = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) => /Approve & Execute/.test(b.textContent || ""));
    // Synchronous click on each disabled control (what a rapid or scripted tap would do).
    btns.forEach((b) => b.click());
    return btns.length;
  });
  await page.waitForTimeout(700);
  const after = await logLen(page);
  const banner = await page.evaluate(() => {
    const el = document.querySelector("[role=status],[role=alert][aria-live]");
    return el ? el.textContent.trim().slice(0, 200) : null;
  });
  const alertText = await page.evaluate(() => {
    const el = [...document.querySelectorAll("[role=alert]")].find((x) => /Kill Switch/.test(x.textContent || ""));
    return el ? el.textContent.trim().replace(/\s+/g, " ") : null;
  });
  const alertAnim = await page.evaluate(() => {
    const el = [...document.querySelectorAll("[role=alert]")].find((x) => /Kill Switch/.test(x.textContent || ""));
    return el ? getComputedStyle(el).animationName : null;
  });
  report.interactions.killSwitchActive = {
    approveButtons: n,
    approveDisabled: disabled,
    syncClickAttempts: clickResults,
    requestsBeforeClicks: before,
    requestsAfterClicks: after,
    newRequestsFromBlockedClicks: after - before,
    bannerText: banner,
    alertText,
    alertAnimationName: alertAnim,
  };
  await page.locator("[role=alert]", { hasText: "Kill Switch" }).first().screenshot({ path: `${OUT}/kill-switch-alert-390x844.png`, caret: "initial" });
  await ctx.close();
}

// ---------- 3. Approve success at every width; triple click; server response ----------
const approveSuccess = {};
for (const [w, h] of WIDTHS) {
  const { ctx, page } = await newPage({ viewport: { width: w, height: h } });
  await open(page, "scenario=approval-pending&role=OWNER&tenant=a");
  const first = approveBtns(page).first();
  const pBefore = await patchCount(page);
  const statusBefore = await page.evaluate(() => null);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Approve & Execute/.test(x.textContent || ""));
    b.click(); b.click(); b.click(); // three synchronous clicks
  });
  let okBanner = true;
  await page.waitForFunction(() => /Action verified and executed/.test(document.body.textContent || ""), null, { timeout: 20000 }).catch(async () => {
    okBanner = false;
    const txt = await page.evaluate(() => [...document.querySelectorAll("[role=status],[role=alert]")].map((e) => e.textContent.trim().slice(0, 160)));
    console.log(`approve ${w}x${h} no success banner; banners:`, JSON.stringify(txt));
  });
  await page.waitForTimeout(500);
  const pAfter = await patchCount(page);
  const banner = await page.evaluate(() => {
    const el = [...document.querySelectorAll("[role=status]")].find((x) => /Action verified|rejected|rolled/i.test(x.textContent || ""));
    return el ? { text: el.textContent.trim().slice(0, 160), ariaLive: el.getAttribute("aria-live"), role: el.getAttribute("role") } : null;
  });
  if (w === 390) {
    await page.screenshot({ path: `${OUT}/approve-success-390x844.png`, fullPage: true, caret: "initial" });
    approveSuccess.patchRequestsFromTripleClick = pAfter - pBefore;
    approveSuccess.banner = banner;
    approveSuccess.patchCountBefore = pBefore;
  }
  if (w !== 390) await page.screenshot({ path: `${OUT}/approve-success-${w}x${h}.png`, fullPage: false, caret: "initial" });
  approveSuccess[`${w}x${h}`] = { banner: banner && banner.text, patches: pAfter - pBefore, okBanner };
  await ctx.close();
}
report.interactions.approveSuccess = approveSuccess;

// ---------- 4. Keyboard: focus order to first Approve, visible focus indicator (pixel diff) ----------
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
  await open(page, "scenario=approval-pending&role=OWNER&tenant=a");
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const order = [];
  let reached = null;
  for (let i = 0; i < 160; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const label = (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 60);
      return { label, isApprove: /Approve & Execute/.test(el.textContent || ""), tag: el.tagName };
    });
    if (!info) continue;
    order.push(info.label);
    if (info.isApprove) {
      reached = info;
      break;
    }
  }
  if (reached) {
    // Clip WITH margin so the outline (drawn outside the box) is included.
    await approveBtns(page).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(200);
    const bx = await approveBtns(page).first().boundingBox();
    const m = 14;
    const sc = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    const clip = { x: Math.max(0, bx.x + sc.x - m), y: Math.max(0, bx.y + sc.y - m), width: bx.width + 2 * m, height: bx.height + 2 * m };
    const focused = await page.screenshot({ clip, fullPage: true, caret: "initial" });
    const focusStyle = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return { outline: s.outline, outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow, focusVisible: document.activeElement.matches(":focus-visible") };
    });
    report.interactions.keyboardOutlineContrast = await page.evaluate(() => {
      const el = document.activeElement;
      const cv = document.createElement("canvas");
      cv.width = cv.height = 1;
      const cx = cv.getContext("2d", { willReadFrequently: true });
      const rgba = (c) => { cx.clearRect(0,0,1,1); cx.fillStyle = c; cx.fillRect(0,0,1,1); const d = cx.getImageData(0,0,1,1).data; return [d[0],d[1],d[2]]; };
      const lum = ([r,g,b]) => { const f = (c) => { c/=255; return c<=0.03928? c/12.92 : Math.pow((c+0.055)/1.055,2.4); }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
      const ratio = (a,b) => { const L1=lum(a), L2=lum(b); return Number(((Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05)).toFixed(2)); };
      const outline = rgba(getComputedStyle(el).outlineColor);
      let cur = el.parentElement, bg = [255,255,255];
      while (cur) { const c = rgba(getComputedStyle(cur).backgroundColor); const a = getComputedStyle(cur).backgroundColor; if (!/rgba\(.*,\s*0\)|transparent/.test(a)) { bg = c; break; } cur = cur.parentElement; }
      return { outlineRGB: outline, adjacentBgRGB: bg, outlineVsAdjacentBg: ratio(outline, bg), outlineVsButtonFill: ratio(outline, rgba(getComputedStyle(el).backgroundColor)) };
    });
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForTimeout(150);
    const unfocused = await page.screenshot({ clip, fullPage: true, caret: "initial" });
    writeFileSync(`${OUT}/focus-approve-focused-390x844.png`, focused);
    writeFileSync(`${OUT}/focus-approve-unfocused-390x844.png`, unfocused);
    report.interactions.keyboard = {
      stepsToApprove: order.length,
      focusOrderSample: order.slice(0, 25),
      approveReached: reached,
      focusStyle,
      focusedCropDiffersFromUnfocused: !focused.equals(unfocused),
      focusedPngBytes: focused.length,
      unfocusedPngBytes: unfocused.length,
    };
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    // Keyboard activation on a focused, enabled Approve: exactly one request.
    const pBefore = await patchCount(page);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Approve & Execute/.test(x.textContent || ""));
      b.focus();
    });
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /Action verified and executed/.test(document.body.textContent || ""), null, { timeout: 60000 });
    report.interactions.keyboard.enterPresses = 2;
    report.interactions.keyboard.patchRequestsFromTwoEnterPresses = (await patchCount(page)) - pBefore;
  } else {
    report.interactions.keyboard = { stepsToApprove: order.length, approveReached: false, focusOrderSample: order.slice(0, 40) };
  }
  await ctx.close();
}

// ---------- 5. Contrast (WCAG 2.x), measured from computed styles ----------
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
  await open(page, "scenario=kill-switch&role=OWNER&tenant=a");
  const contrast = await page.evaluate(() => {
    const lum = ([r, g, b]) => {
      const f = (c) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    // Normalise any CSS colour (oklch, color-mix, rgb) to RGBA via a canvas.
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const parse = (s) => {
      if (!s) return null;
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = "#000";
      cx.fillStyle = s;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      return { rgb: [d[0], d[1], d[2]], a: d[3] / 255 };
    };
    const bgOf = (el) => {
      let cur = el;
      while (cur) {
        const c = parse(getComputedStyle(cur).backgroundColor);
        if (c && c.a > 0.99) return c.rgb;
        cur = cur.parentElement;
      }
      return [255, 255, 255];
    };
    const measure = (el) => {
      const fg = parse(getComputedStyle(el).color);
      const bg = bgOf(el);
      const L1 = lum(fg.rgb), L2 = lum(bg);
      return { fg: fg.rgb, bg, ratio: Number(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2)) };
    };
    const alert = [...document.querySelectorAll("[role=alert]")].find((x) => /Kill Switch/.test(x.textContent || ""));
    const approve = [...document.querySelectorAll("button")].find((x) => /Approve & Execute/.test(x.textContent || ""));
    const out = {};
    if (alert) out.killAlertText = measure(alert.querySelector("strong") || alert);
    if (approve) out.approveDisabledButton = measure(approve);
    return out;
  });
  report.interactions.contrast = contrast;
  await ctx.close();
}

// ---------- 6. Reduced motion (measured animation name on the kill-switch alert) ----------
for (const mode of ["no-preference", "reduce"]) {
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, reducedMotion: mode });
  await open(page, "scenario=kill-switch&role=OWNER&tenant=a");
  const anim = await page.evaluate(() => {
    const el = [...document.querySelectorAll("[role=alert]")].find((x) => /Kill Switch/.test(x.textContent || ""));
    return el ? getComputedStyle(el).animationName : null;
  });
  report.interactions[`reducedMotion_${mode}`] = { alertAnimationName: anim };
  await ctx.close();
}

// ---------- 7. Tenant B, STAFF and paused: UI state and server response ----------
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
  await open(page, "scenario=approval-pending&role=STAFF&tenant=a");
  const staffApproves = await approveBtns(page).count();
  const staffDisabled = [];
  for (let i = 0; i < staffApproves; i++) staffDisabled.push(await approveBtns(page).nth(i).isDisabled());
  report.interactions.staff = { approveButtons: staffApproves, approveDisabled: staffDisabled };
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
