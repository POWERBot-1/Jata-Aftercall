#!/usr/bin/env node
/**
 * Real-browser check for the three JATA Autopilot activation controls
 * ("Activate KES 2,499", "Activate KES 6,999", "Activate KES 19,999").
 *
 * It proves the click is not dead without ever starting a real payment: every
 * `POST /api/checkout` is intercepted and answered with a canned response, so no provider
 * session is created and no money can move.
 *
 * For each plan button it checks:
 *   1. hit-testing — the centre of the button resolves to the button itself (no overlay);
 *   2. the request carries the allowlisted plan key and nothing else that could set a price;
 *   3. a configuration error (503 PLAN_NOT_CONFIGURED) renders an inline, visible notice
 *      next to the buttons and does not navigate;
 *   4. an unusable provider link (200 + javascript:) is refused, with an honest message;
 *   5. a payment already in progress (409) offers a link to the existing payment;
 *   6. no page error was raised.
 *
 * Usage (against a running server with a seeded owner session):
 *   CHROME_PATH=/path/to/chrome BASE_URL=http://localhost:3100 \
 *   JATA_SESSION_TOKEN=<jata_session cookie> BUSINESS_ID=<business id> \
 *     node scripts/browser/autopilot-activation.check.mjs
 *
 * Exits 2 (not run) when CHROME_PATH, JATA_SESSION_TOKEN or BUSINESS_ID is missing,
 * 1 when any check fails, 0 when every check passes.
 */
import puppeteer from "puppeteer-core";

const CHROME_PATH = process.env.CHROME_PATH;
const BASE_URL = (process.env.BASE_URL || "http://localhost:3100").replace(/\/$/, "");
const TOKEN = process.env.JATA_SESSION_TOKEN;
const BUSINESS_ID = process.env.BUSINESS_ID;

if (!CHROME_PATH) {
  console.error("CHROME_PATH is required (path to a Chrome/Chromium binary). Not run.");
  process.exit(2);
}
if (!TOKEN || !BUSINESS_ID) {
  console.error("JATA_SESSION_TOKEN and BUSINESS_ID are required. Not run.");
  process.exit(2);
}

const PLANS = [
  { label: "Activate KES 2,499", key: "JATA_AUTOPILOT" },
  { label: "Activate KES 6,999", key: "JATA_AUTOPILOT_PRO" },
  { label: "Activate KES 19,999", key: "JATA_AUTOPILOT_ENTERPRISE" },
];

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

/**
 * Opens the Command Center with request interception installed BEFORE navigation.
 * Every checkout POST is answered from `planResponses`, keyed by the plan key in its body, so
 * the check never creates a payment (and a real provider session is never opened).
 */
async function openPage(planResponses) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err).slice(0, 240)));
  await page.setCookie({ name: "jata_session", value: TOKEN, url: BASE_URL, httpOnly: true });
  await page.setRequestInterception(true);

  const checkoutBodies = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/checkout")) {
      return request.continue();
    }
    let body = {};
    try {
      body = JSON.parse(request.postData() || "{}");
    } catch {
      body = { parseError: true };
    }
    checkoutBodies.push(body);
    const canned = planResponses[body.planKey] ?? { status: 503, body: { code: "PLAN_NOT_CONFIGURED", error: "JATA Autopilot plans are not configured in this deployment yet." } };
    return request.respond({
      status: canned.status,
      contentType: "application/json",
      body: JSON.stringify(canned.body),
    });
  });

  await page.goto(`${BASE_URL}/dashboard/autopilot/${encodeURIComponent(BUSINESS_ID)}`, {
    waitUntil: "networkidle2",
    timeout: 90_000,
  });
  return { page, errors, checkoutBodies };
}

/** Finds the button whose text starts with the label, scrolls it into view and hit-tests it. */
async function locate(page, label) {
  return page.evaluate((wanted) => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim().startsWith(wanted),
    );
    if (!button) return null;
    button.scrollIntoView({ block: "center", behavior: "instant" });
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      disabled: button.disabled,
      hitIsButton: hit === button || Boolean(hit && button.contains(hit)),
    };
  }, label);
}

async function clickLabel(page, label) {
  const point = await locate(page, label);
  if (!point) return null;
  if (point.disabled || !point.hitIsButton) return point;
  await page.mouse.click(point.x, point.y);
  await new Promise((resolve) => setTimeout(resolve, 400));
  return point;
}

async function noticeText(page) {
  return page.evaluate(() => {
    const node = document.querySelector('[data-testid="autopilot-checkout-notice"]');
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return {
      text: (node.textContent || "").trim(),
      visible: rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0,
      link: node.querySelector("a")?.getAttribute("href") ?? null,
    };
  });
}

const PLAN_RESPONSES = {
  JATA_AUTOPILOT: {
    status: 503,
    body: { code: "PLAN_NOT_CONFIGURED", error: "JATA Autopilot plans are not configured in this deployment yet." },
  },
  JATA_AUTOPILOT_PRO: {
    status: 409,
    body: {
      code: "CHECKOUT_IN_PROGRESS",
      error: "A payment for this plan is already in progress. Check its status before starting another.",
      reference: "jata-existing",
      statusUrl: "/checkout/callback?reference=jata-existing",
    },
  },
  JATA_AUTOPILOT_ENTERPRISE: {
    status: 200,
    body: { authorization_url: "javascript:alert(1)" },
  },
};

for (const plan of PLANS) {
  const { page, errors, checkoutBodies } = await openPage(PLAN_RESPONSES);

  const point = await clickLabel(page, plan.label);
  check(`${plan.label}: the button is rendered, enabled and hit-testable`, Boolean(point && !point.disabled && point.hitIsButton), JSON.stringify(point));
  check(`${plan.label}: the click sends the allowlisted plan key`, checkoutBodies.some((b) => b.planKey === plan.key), JSON.stringify(checkoutBodies));
  check(`${plan.label}: no price or duration is sent by the browser`, checkoutBodies.every((b) => !("amount" in b) && !("priceKES" in b) && !("durationDays" in b)));

  const notice = await noticeText(page);
  check(`${plan.label}: feedback is rendered inline and on screen`, Boolean(notice && notice.visible && notice.text.length > 0), JSON.stringify(notice));

  if (plan.key === "JATA_AUTOPILOT") {
    check(`${plan.label}: configuration failure is explained`, Boolean(notice?.text.includes("not configured")));
    check(`${plan.label}: still on the Command Center (no false redirect)`, page.url().includes("/dashboard/autopilot/"));
  }
  if (plan.key === "JATA_AUTOPILOT_PRO") {
    check(`${plan.label}: offers a link to the existing payment`, notice?.link === "/checkout/callback?reference=jata-existing", String(notice?.link));
  }
  if (plan.key === "JATA_AUTOPILOT_ENTERPRISE") {
    check(`${plan.label}: refuses an unusable provider link`, Boolean(notice?.text.includes("unusable payment link")));
    check(`${plan.label}: did not navigate to a hostile URL`, page.url().includes("/dashboard/autopilot/"));
  }
  check(`${plan.label}: no page errors`, errors.length === 0, errors.join(" | "));

  await page.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
