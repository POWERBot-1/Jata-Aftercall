#!/usr/bin/env node
/**
 * Real-browser checks for the JATA Autopilot interactive-controls repair (2026-10-26).
 *
 * Verifies the controls the owner reported as inactive, against a running server with an
 * authenticated owner session:
 *   1. Appearance picker opens ABOVE the sticky workspace chrome — every theme option is
 *      the top hit-tested element (previously the header covered the first option and taps
 *      hit the nav rail), selecting a theme applies + persists it, and the picker closes.
 *   2. The Autopilot hero primary action does what its label says (opens the single
 *      business's Command Center, starts onboarding with none, or is labelled as choosing
 *      when it only scrolls).
 *   3. Per-business Command Center links are distinct and business-specific.
 *   4. Section-rail links meet the 44px touch-target contract.
 *   5. Log out ends the session and lands on /login.
 *
 * Run against a running server (`next dev` or `next start`):
 *   CHROME_PATH=/path/to/chrome BASE_URL=http://localhost:3100 JATA_SESSION_TOKEN=<jata_session cookie value> \
 *     node scripts/browser/autopilot-controls.check.mjs
 *
 * Exits 1 if any check fails. Missing CHROME_PATH or session token exits 2 (not run) —
 * skipped is not passed. The logout check runs last because it consumes the session.
 */
import puppeteer from "puppeteer-core";

const CHROME_PATH = process.env.CHROME_PATH;
const BASE_URL = (process.env.BASE_URL || "http://localhost:3100").replace(/\/$/, "");
const TOKEN = process.env.JATA_SESSION_TOKEN;
if (!CHROME_PATH) {
  console.error("CHROME_PATH is required (path to a Chrome/Chromium binary). Not run.");
  process.exit(2);
}
if (!TOKEN) {
  console.error("JATA_SESSION_TOKEN is required (value of the jata_session cookie for a test owner). Not run.");
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function freshPage(viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err).slice(0, 240)));
  await page.setCookie({ name: "jata_session", value: TOKEN, url: BASE_URL, httpOnly: true });
  await page.goto(`${BASE_URL}/dashboard/autopilot`, { waitUntil: "networkidle2", timeout: 90_000 });
  await sleep(1000);
  return { page, errors };
}

/** Scroll an element into view instantly, settle, then real-click its centre. */
async function clickElement(page, selector, index = 0) {
  const point = await page.evaluate(
    (sel, idx) => {
      const el = document.querySelectorAll(sel)[idx];
      if (!el) return null;
      el.scrollIntoView({ block: "center", behavior: "instant" });
      return true;
    },
    selector,
    index,
  );
  if (!point) return false;
  await sleep(400);
  const coords = await page.evaluate(
    (sel, idx) => {
      const el = document.querySelectorAll(sel)[idx];
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    selector,
    index,
  );
  await page.mouse.click(coords.x, coords.y);
  return true;
}

for (const [label, viewport] of [
  ["desktop", { width: 1280, height: 800 }],
  ["mobile", { width: 390, height: 844, isMobile: true, hasTouch: true }],
]) {
  // 1 — Appearance picker is reachable and functional.
  {
    const { page, errors } = await freshPage(viewport);
    const before = await page.evaluate(() => document.documentElement.getAttribute("data-jata-theme"));
    await clickElement(page, "details.product-theme-picker > summary");
    await sleep(400);
    const probe = await page.evaluate(() => {
      const labels = [...document.querySelectorAll("label.product-theme-option")];
      return labels.map((labelEl) => {
        const r = labelEl.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          value: labelEl.querySelector("input")?.value ?? "",
          coveredByOther: !(top && (labelEl === top || labelEl.contains(top))),
          hitDesc: top ? `<${top.tagName.toLowerCase()} class="${(top.className.baseVal ?? top.className ?? "").toString().slice(0, 50)}">` : "none",
        };
      });
    });
    check(
      `[${label}] Appearance options are not covered by the header`,
      probe.length > 0 && probe.every((p) => !p.coveredByOther),
      JSON.stringify(probe),
    );
    const target = await page.evaluate(
      (current) => [...document.querySelectorAll("input[name='jata-product-theme']")].find((r) => r.value !== current)?.value ?? null,
      before,
    );
    if (target) {
      await clickElement(page, `label.product-theme-option:has(input[value="${target}"])`);
      await sleep(600);
      const after = await page.evaluate(() => ({
        theme: document.documentElement.getAttribute("data-jata-theme"),
        stored: localStorage.getItem("jata-product-theme"),
        pickerOpen: document.querySelector("details.product-theme-picker")?.open ?? null,
      }));
      check(`[${label}] Selecting a theme applies and persists it`, after.theme === target && after.stored === target, JSON.stringify(after));
      check(`[${label}] Picker closes after selection`, after.pickerOpen === false, JSON.stringify(after));
    } else {
      check(`[${label}] A second theme exists to select`, false, "only one theme option rendered");
    }
    check(`[${label}] No page errors during Appearance flow`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // 2 — Hero primary action does what its label says.
  {
    const { page } = await freshPage(viewport);
    const hero = await page.evaluate(() => {
      const a = document.querySelector(".ws-hero__actions a.ws-btn-amber");
      return a ? { text: a.textContent.trim().replace(/\s+/g, " "), href: a.getAttribute("href") } : null;
    });
    check(`[${label}] Hero primary action exists`, Boolean(hero), JSON.stringify(hero));
    if (hero) {
      const startUrl = page.url();
      await clickElement(page, ".ws-hero__actions a.ws-btn-amber");
      await sleep(1500);
      const after = page.url();
      if (hero.href.startsWith("#")) {
        check(
          `[${label}] Scroll-only hero action is not labelled as opening the Command Center`,
          !/open command center/i.test(hero.text) && after.startsWith(startUrl.split("#")[0]),
          `label="${hero.text}" href=${hero.href} url=${after}`,
        );
      } else {
        check(
          `[${label}] Hero action navigates to its labelled destination`,
          after === `${BASE_URL}${hero.href}`,
          `label="${hero.text}" href=${hero.href} url=${after}`,
        );
      }
    }
    await page.close();
  }

  // 3 — Per-business links are distinct and business-specific; 4 — rail targets.
  {
    const { page } = await freshPage(viewport);
    const links = await page.evaluate(() =>
      [...document.querySelectorAll("a[href^='/dashboard/autopilot/']")].map((a) => a.getAttribute("href")),
    );
    const distinct = new Set(links);
    check(
      `[${label}] Command Center links are business-specific and distinct`,
      links.length > 0 && distinct.size === links.length && links.every((h) => /^\/dashboard\/autopilot\/[^/]+$/.test(h)),
      links.join(", ") || "none rendered",
    );
    const railHeights = await page.evaluate(() =>
      [...document.querySelectorAll(".ws-rail a")].map((a) => Math.round(a.getBoundingClientRect().height)),
    );
    check(
      `[${label}] Rail links meet the 44px touch target`,
      railHeights.length > 0 && railHeights.every((h) => h >= 44),
      `heights=${railHeights.join(",")}`,
    );
    await page.close();
  }
}

// 5 — Log out (last: it consumes the session).
{
  const { page } = await freshPage({ width: 1280, height: 800 });
  await clickElement(page, ".ws-chrome form[action='/api/auth/logout'] button");
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => null);
  await sleep(1000);
  const cookies = await page.cookies(BASE_URL);
  const session = cookies.find((c) => c.name === "jata_session");
  check("Log out lands on /login", page.url().endsWith("/login"), page.url());
  check("Log out clears the session cookie", !session?.value, session ? "cookie present" : "cookie absent");
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
