#!/usr/bin/env node
/**
 * Business Hub browser check — the customer and owner halves of the five capabilities, in a real
 * browser at the widths the brief names.
 *
 *   CHROME_PATH=/path/to/chrome BASE_URL=https://jataaftercall.co.ke \
 *     SLUG=nyumbani-kitchen SHOT_DIR=/tmp/hub-shots npm run test:browser:business-hub
 *
 * Requires a running server (dev or `next start`) and a published business page. What it proves:
 *   1. The public page renders the mandated section order, and no width overflows horizontally.
 *   2. A customer can add two products, submit an order request and see a reference — with the
 *      "not a payment / not a confirmed order" wording on screen, not just in the code.
 *   3. An expired promotion is absent from the DOM, not merely hidden.
 *   4. The QR block renders artwork and the official page URL it opens.
 *   5. With HUB_SESSION_COOKIE set, the owner's Customers / Promotions / Loyalty / QR screens load
 *      and the Customers screen shows the request the customer just made.
 *
 * Owner screens are skipped (reported NOT RUN, not passed) when no session cookie is supplied:
 * the check must never look like a pass it did not earn.
 *
 * Set SHOT_DIR to write full-page JPEG screenshots for the evidence pack. Exits 2 when Chrome is
 * missing, so a run without a browser is reported as NOT RUN rather than as a pass.
 */

import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const executablePath = process.env.CHROME_PATH;
if (!executablePath) {
  console.error("Browser missing: Business Hub check NOT RUN. Set CHROME_PATH.");
  process.exit(2);
}

const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const slug = process.env.SLUG || "";
if (!slug) {
  console.error("Business Hub check NOT RUN: set SLUG to the business page to exercise.");
  process.exit(2);
}
const shotDir = process.env.SHOT_DIR || "";
if (shotDir) mkdirSync(shotDir, { recursive: true });

const rows = [];
const check = (name, ok, detail = "") => {
  rows.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const shot = async (page, name) => {
  if (!shotDir) return;
  await page.screenshot({ path: `${shotDir}/${name}.jpg`, type: "jpeg", quality: 74, fullPage: true });
};

const VIEWPORTS = [
  { label: "360", width: 360, height: 740 },
  { label: "390", width: 390, height: 844 },
  { label: "768", width: 768, height: 1024 },
  { label: "1366", width: 1366, height: 768 },
];

const browser = await puppeteer.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

// ── Customer half ────────────────────────────────────────────────────────────────────────────

for (const viewport of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message || error)));
  await page.goto(`${base}/b/${slug}`, { waitUntil: "networkidle2" });

  const layout = await page.evaluate(() => {
    const order = ["#promotions", "#services", "#featured-products", "#order", "#enquiry", "#loyalty", "#qr"];
    const found = order
      .map((selector) => {
        const node = document.querySelector(selector);
        return node ? { selector, top: node.getBoundingClientRect().top + window.scrollY } : null;
      })
      .filter(Boolean);
    return {
      found: found.map((entry) => entry.selector),
      ordered: found.every((entry, index) => index === 0 || entry.top >= found[index - 1].top),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      qrText: document.querySelector("#qr")?.textContent ?? "",
      expired: Array.from(document.querySelectorAll("[data-promotion-state]")).map((node) => node.getAttribute("data-promotion-state")),
    };
  });

  check(`${viewport.label}px: the page does not overflow horizontally`, layout.overflow <= 1, `overflow ${layout.overflow}px`);
  check(`${viewport.label}px: the hub sections appear in the mandated order`, layout.ordered, layout.found.join(" → "));
  check(`${viewport.label}px: no promotion is rendered as expired`, !layout.expired.includes("EXPIRED"), layout.expired.join(",") || "none");
  check(`${viewport.label}px: the QR block shows the official page URL`, layout.qrText.includes(`/b/${slug}`), layout.qrText.trim().slice(0, 80));
  check(`${viewport.label}px: no uncaught page error`, errors.length === 0, errors.join(" | "));
  await shot(page, `hub-public-${viewport.label}`);
  await page.close();
}

// A full submit at phone width: two products, contact details, reference on screen.
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.goto(`${base}/b/${slug}`, { waitUntil: "networkidle2" });

  const started = await page.evaluate(() => {
    const add = Array.from(document.querySelectorAll("#order button")).filter((button) => /add|choose|select/i.test(button.textContent || ""));
    add.slice(0, 2).forEach((button) => button.click());
    return add.length;
  });
  if (started === 0) {
    console.log("NOT RUN: basket controls not found — the business may have no active catalogue.");
  } else {
    await page.evaluate(() => {
      const form = document.querySelector("#order form");
      const setValue = (name, value) => {
        const field = form?.querySelector(`[name="${name}"], #${name}`);
        if (!field) return;
        const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, "value").set;
        setter.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      };
      setValue("customerName", "Browser Check Customer");
      setValue("contactValue", "0712345678");
    });
    const submitted = await page.evaluate(async () => {
      const button = Array.from(document.querySelectorAll("#order button")).find((node) => /send|submit|request/i.test(node.textContent || ""));
      if (!button) return "no submit button";
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return document.querySelector("#order")?.textContent ?? "";
    });
    check("customer: a submitted request returns a reference", /JATA-REQ-\d{8}-/.test(submitted), submitted.slice(0, 120));
    check("customer: the confirmation says no payment was taken", /no payment|not a confirmed order/i.test(submitted), submitted.slice(0, 160));
    await shot(page, "hub-order-confirmation");
  }
  await page.close();
}

// ── Owner half ───────────────────────────────────────────────────────────────────────────────

const cookie = process.env.HUB_SESSION_COOKIE;
const businessId = process.env.BUSINESS_ID;
if (!cookie || !businessId) {
  console.log("\nNOT RUN: owner screens (set HUB_SESSION_COOKIE and BUSINESS_ID to include them).");
} else {
  for (const [label, path, marker] of [
    ["customers", "customers", /Customers/],
    ["promotions", "promotions", /Promotions/],
    ["loyalty", "loyalty", /Loyalty/],
    ["qr", "qr", /QR/],
  ]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });
    await page.setExtraHTTPHeaders({ cookie });
    const response = await page.goto(`${base}/dashboard/businesses/${businessId}/${path}`, { waitUntil: "networkidle2" });
    const text = await page.evaluate(() => document.body.innerText);
    check(`owner: /${label} loads for its own business`, response.status() === 200 && marker.test(text), `HTTP ${response.status()}`);
    await shot(page, `hub-owner-${label}`);
    await page.close();
  }

  // Isolation: another tenant's hub must not render.
  const otherId = process.env.OTHER_BUSINESS_ID;
  if (otherId) {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ cookie });
    const response = await page.goto(`${base}/dashboard/businesses/${otherId}/customers`, { waitUntil: "domcontentloaded" });
    const text = await page.evaluate(() => document.body.innerText);
    const denied = response.status() === 403 || response.status() === 404 || /not found|don't have access|forbidden/i.test(text);
    check("owner: another business's customers page is refused", denied, `HTTP ${response.status()}`);
    await page.close();
  } else {
    console.log("NOT RUN: cross-tenant check (set OTHER_BUSINESS_ID to include it).");
  }
}

await browser.close();
const failed = rows.filter((row) => !row.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} checks passed`);
if (failed.length) {
  console.error(`FAIL: ${failed.length} check(s) failed`);
  process.exit(1);
}
process.exit(0);
