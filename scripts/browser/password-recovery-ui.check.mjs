#!/usr/bin/env node
/** Actual Next/browser UI smoke for recovery pages. Password POST is intercepted; no email or DB writes. */
const CHROME_PATH = process.env.CHROME_PATH;
const BASE_URL = (process.env.BASE_URL || "http://localhost:3200").replace(/\/$/, "");
if (!CHROME_PATH) { console.error("CHROME_PATH required. Password-recovery browser checks NOT RUN."); process.exit(2); }
// Load browser tooling only after the executable preflight so an unavailable browser is reported
// cleanly even in a workspace where development dependencies have not been installed.
const { default: puppeteer } = await import("puppeteer-core");
const origin = new URL(BASE_URL).origin;
const results = [];
let apiPaths = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });

async function waitForHydration(page, controlSelector) {
  await page.waitForFunction((selector) => {
    const form = document.querySelector(selector)?.closest("form");
    if (!form) return false;
    const propsKey = Object.keys(form).find((key) => key.startsWith("__reactProps$"));
    return Boolean(propsKey && typeof form[propsKey]?.onSubmit === "function");
  }, { timeout: 15_000 }, controlSelector);
}

async function pageFor({ mobile = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: mobile ? 360 : 1280, height: mobile ? 740 : 800, isMobile: mobile, hasTouch: mobile });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin) return void request.abort();
    if (url.pathname.startsWith("/api/")) {
      apiPaths.push(`${request.method()} ${url.pathname}`); // Never record query, body, cookies, or tokens.
      if (request.method() === "POST" && url.pathname === "/api/auth/password-reset/complete") {
        return void request.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, message: "Your password has been updated. Please sign in again." }),
        });
      }
      if (request.method() === "POST" && url.pathname === "/api/auth/password-reset") {
        return void request.respond({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Password recovery is not available in this deployment." }),
        });
      }
    }
    return void request.continue();
  });
  return page;
}

try {
  console.log(`Actual browser ${await browser.version()}; Next pages/UI are real; both recovery POSTs are intercepted, so no reset email or database write can occur.`);
  for (const viewport of [{ label: "phone 360x740", mobile: true }, { label: "desktop 1280x800", mobile: false }]) {
    const page = await pageFor(viewport);
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle0", timeout: 120000 });
    const forgot = await page.$('a[href="/forgot-password"]');
    check(`${viewport.label}: login exposes a keyboard-focusable recovery link`, Boolean(forgot));
    if (forgot) await forgot.click();
    await page.waitForSelector("#recovery-email", { visible: true, timeout: 15000 });
    await waitForHydration(page, "#recovery-email");
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      heading: document.querySelector("h1")?.textContent?.trim(),
      labelFor: document.querySelector('label[for="recovery-email"]')?.getAttribute("for"),
      inputId: document.querySelector('input[type="email"]')?.id,
      hint: document.querySelector("#recovery-email-hint")?.textContent?.trim(),
    }));
    check(`${viewport.label}: labeled form and no horizontal overflow`, layout.overflow === 0 && layout.heading === "Reset your password" && layout.labelFor === layout.inputId && Boolean(layout.hint), JSON.stringify(layout));
    if (viewport.mobile) {
      await page.type('input[type="email"]', "synthetic@example.test");
      await page.click('button[type="submit"]');
      await page.waitForSelector('[role="alert"]', { visible: true });
      const message = await page.$eval('[role="alert"]', (node) => node.textContent?.trim() || "");
      check("mocked 503 recovery response is announced without account-dependent copy", /not available in this deployment/i.test(message) && !message.includes("SMTP"));
      const alertCount = await page.$$eval('[role="alert"]', (nodes) => nodes.length);
      check("recovery failure is announced exactly once", alertCount === 1, `alerts=${alertCount}`);
    }
    await page.close();
  }

  const missing = await pageFor();
  await missing.goto(`${BASE_URL}/reset-password`, { waitUntil: "networkidle0", timeout: 120000 });
  check("reset route without a fragment offers a fresh-link path", Boolean(await missing.$('a[href="/forgot-password"]')));
  await missing.close();

  const reset = await pageFor({ mobile: true });
  const token = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  await reset.goto(`${BASE_URL}/reset-password#token=${token}`, { waitUntil: "networkidle0", timeout: 120000 });
  await reset.waitForSelector("#new-password", { visible: true, timeout: 15000 });
  await waitForHydration(reset, "#new-password");
  await reset.waitForFunction(() => window.location.hash === "");
  const referrer = await reset.$eval("meta[name=referrer]", (node) => node.getAttribute("content"));
  check("reset token is read from the URL fragment then removed; page sets no-referrer", referrer === "no-referrer" && await reset.evaluate(() => location.hash === ""));
  await reset.type("#new-password", "new-correct-horse");
  await reset.type("#confirm-password", "different-correct-horse");
  await reset.click('button[type="submit"]');
  await reset.waitForSelector('[role="alert"]', { visible: true });
  const mismatch = await reset.$eval('[role="alert"]', (node) => node.textContent?.trim() || "");
  const resetAlerts = await reset.$$eval('[role="alert"]', (nodes) => nodes.length);
  check("password mismatch is announced once before an API request", mismatch === "Those passwords don't match." && resetAlerts === 1, `alerts=${resetAlerts}`);
  await reset.click("#confirm-password");
  await reset.keyboard.down("Control");
  await reset.keyboard.press("A");
  await reset.keyboard.up("Control");
  await reset.keyboard.press("Backspace");
  await reset.type("#confirm-password", "new-correct-horse");
  await reset.click('button[type="submit"]');
  await reset.waitForFunction(() => document.body.textContent?.includes("Your other sessions have been signed out"));
  check("mocked successful completion UI explains sign-out and offers sign-in", Boolean(await reset.$('a[href="/login"]')));
  await reset.close();

  check("only the intended intercepted reset API requests occurred", apiPaths.join("|") === "POST /api/auth/password-reset|POST /api/auth/password-reset/complete", apiPaths.join(", "));
} catch (error) {
  console.error(`FAIL password-recovery browser check: ${String(error)}`);
  if (results.every((result) => result.ok)) results.push({ name: "execution", ok: false });
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok).length;
console.log(`${results.length - failed} passed, ${failed} failed, 0 skipped. Real browser/UI only; password completion and email provider intentionally intercepted/not activated.`);
process.exit(failed ? 1 : 0);
