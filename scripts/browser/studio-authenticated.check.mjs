#!/usr/bin/env node
/** Real HTTP/Next/JWT/browser/Prisma gate. Synthetic entitlement only; never a provider/payment/device certification. */
import puppeteer from "puppeteer-core";
import { PrismaClient } from "@prisma/client";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { assertIsolatedStudioTarget, isAllowedStudioRequest } from "./studio-journey-safety.mjs";
import { PROBE_PROPERTY, probeInstallSource, formatProbeDump, serverHtmlDigest, serverHtmlOrder, patchHydrationThrowDiagnostics } from "./hydration-mutation-probe.mjs";

// Diagnostic on by default; `HYDRATION_PROBE=off` or scripts/browser/hydration-probe.mode
// containing "off" disables installation for A/B control runs (is the probe perturbing the race?).
function probeEnabled() {
  const flag = (process.env.HYDRATION_PROBE ?? "").trim().toLowerCase();
  if (flag) return flag !== "off" && flag !== "0" && flag !== "false";
  try {
    return readFileSync(new URL("./hydration-probe.mode", import.meta.url), "utf8").trim().toLowerCase() !== "off";
  } catch {
    return true;
  }
}

let target;
try {
  target = assertIsolatedStudioTarget(process.env, readdirSync(process.cwd()));
  if (!process.env.CHROME_PATH || !existsSync(process.env.CHROME_PATH)) throw new Error("Chrome executable unavailable");
  if (!existsSync(".next/BUILD_ID")) throw new Error("Production build unavailable");
} catch (error) {
  console.error(`BLOCKED / NOT RUN: ${error.message}. No server/fixtures started; no passing journey claimed.`);
  process.exit(2);
}
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const require = createRequire(import.meta.url);
const runId = randomUUID().slice(0, 8);
const password = "IsolatedStudio#2026";
const created = [], results = [], denied = [], errors = [], signatures = [], hydrationVisits = [];
let browser, server, stopped, origin, serverLog = "", journeyComplete = false;
// The failing check's name, printed with the end-of-run summary so a CI comment that elides the
// middle of the log still names the check that failed (see the workflow's failure reporter).
let failureName = null;
// M12: buffered M418 evidence lines are reprinted at end-of-run so they land in the
// CI summary comment's tail window (the generator elides long-log middles).
const m418Lines = [];
const serverDigests = new Map(); // full URL -> bounded list of raw-server-order records (M12 Stage B)
let serverResponseSeq = 0;
function emitM418(line) { const bounded = String(line).slice(0, 900); m418Lines.push(bounded); console.error(bounded); }
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(name);
}
async function pageFor(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  // Pre-hydration MutationObserver ring buffer (issue #418 diagnostic): installed before any
  // document script in every frame of this page (dashboard chrome and same-origin preview iframe).
  if (probeEnabled()) await page.evaluateOnNewDocument(probeInstallSource());
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (!isAllowedStudioRequest(request.url(), origin, request.method())) {
      // Store no query strings, payloads, JWTs or cookies in evidence.
      denied.push({ method: request.method(), path: new URL(request.url()).pathname, type: request.resourceType(), from: new URL(page.url()).pathname });
      return void request.abort();
    }
    return void request.continue();
  });
  // Keep a bounded digest of every document's SERVER HTML (issue #418 evidence): at error
  // time the server structure is diffed against the client outline to name the diverging node.
  // M12 Stage B: also record the RAW response ordering (byte offsets of the bootstrap/shell/
  // catalogue markers) before any browser-side parse or hydration recovery can alter it.
  page.on("response", (response) => {
    if (response.request().resourceType() !== "document") return;
    const url = response.url();
    const status = response.status();
    const contentType = (response.headers()["content-type"] || "").slice(0, 60);
    const seq = ++serverResponseSeq;
    response.text().then((html) => {
      const bodyAt = html.search(/<body[\s>]/i);
      const bodyHead = bodyAt >= 0 ? html.slice(bodyAt, bodyAt + 160).replace(/[\r\n]+/g, " ") : "";
      const list = serverDigests.get(url) || [];
      list.push({ at: Date.now(), seq, status, contentType, len: html.length, bodyHead,
        digest: serverHtmlDigest(html), ...serverHtmlOrder(html) });
      while (list.length > 4) list.shift();
      serverDigests.set(url, list);
      if (serverDigests.size > 12) serverDigests.delete(serverDigests.keys().next().value);
    }).catch(() => {});
  });
  page.on("pageerror", (error) => {
    const frames = page.frames().map((frame) => new URL(frame.url()).pathname).slice(0, 6);
    const record = { path: new URL(page.url()).pathname, frames, message: String(error.message).slice(0, 250), stack: String(error.stack ?? "").slice(0, 700) };
    errors.push(record);
    console.error(`BROWSER RUNTIME ERROR ${JSON.stringify(record)}`);
    // Evidence-only hydration forensics (issue #418): read the pre-hydration MutationObserver
    // ring buffer and its error-time frozen snapshot from every accessible frame. Each frame's
    // probe freezes synchronously in its own window.onerror before React recovery can overwrite
    // the mutation history. Cross-origin frames are reported, never bypassed.
    void Promise.all(page.frames().map(async (frame) => {
      const frameUrl = (() => { try { return frame.url(); } catch { return "unknown"; } })();
      const path = (() => { try { return new URL(frameUrl).pathname; } catch { return "unknown"; } })();
      try {
        const probe = await frame.evaluate((key) => {
          const instance = window[key];
          return instance ? { state: instance.state(), snapshot: instance.snapshot(), calls: instance.calls ? instance.calls() : null, tail: instance.tail(15), m418last: window.__m418last || null } : null;
        }, PROBE_PROPERTY);
        return { path, url: frameUrl, probe };
      } catch (error) {
        return { path, url: frameUrl, inaccessible: String(error).slice(0, 80) };
      }
    })).then((frameProbes) => {
      // Emit short, separately survivable evidence lines (the PR comment keeps only the head
      // and tail of long logs): one line per frame, one for the expected fiber, one per
      // server document. The bulky raw dump goes to the record for results.json only.
      record.probe = formatProbeDump(frameProbes);
      record.server = JSON.stringify([...serverDigests.entries()].slice(0, 4)).slice(0, 1500);
      for (const entry of frameProbes) {
        const probe = entry && entry.probe;
        const expected = probe && probe.m418last;
        if (expected) emitM418(`M418 EXPECTED ${JSON.stringify(expected)}`);
        const snap = probe && probe.snapshot;
        if (snap) {
          emitM418(`M418 FRAME ${String(snap.frame || entry.path).slice(0, 48)} ready=${snap.ready} parseDropped=${snap.parseDropped} counts=${JSON.stringify(snap.counts)}`);
          emitM418(`M418 TAIL ${JSON.stringify((snap.tail || []).slice(-10))}`.slice(0, 700));
          emitM418(`M418 OUTLINE ${String(snap.outline || "").slice(0, 420)}`);
          if (snap.parseSamples) emitM418(`M418 PARSE ${JSON.stringify(snap.parseSamples)}`.slice(0, 700));
          if (snap.head) {
            const head = snap.head;
            for (let hi = 0; hi < head.length; hi += 5) emitM418(`M418 HEAD${Math.floor(hi / 5)} ${JSON.stringify(head.slice(hi, hi + 5))}`.slice(0, 240));
          }
          if (snap.calls) {
            const c = snap.calls;
            emitM418(`M418E STKI ${String(c.firstScriptInsert || "-").slice(0, 240)}`);
            emitM418(`M418E STKM ${String(c.firstScriptMove || "-").slice(0, 240)}`);
            emitM418(`M418E STKR ${String(c.firstBodyReorder || "-").slice(0, 240)}`);
            emitM418(`M418E STKW ${String(c.firstWrite || "-").slice(0, 240)}`);
            emitM418(`M418E STKA ${JSON.stringify(c.api || {}).slice(0, 200)}`);
          }
          if (snap.nav || snap.bodyFirst !== undefined) {
            emitM418(`M418E NAV ready=${snap.ready} size=${snap.nav && snap.nav.size} decoded=${snap.nav && snap.nav.decoded} 1st=${String(snap.bodyFirst || "").slice(0, 80)} last=${String(snap.bodyLast || "").slice(0, 80)}`);
          }
        } else if (probe) {
          emitM418(`M418 LIVE ${String(probe.state && probe.state.frame || entry.path).slice(0, 48)} seq=${probe.state && probe.state.seq} parseDropped=${probe.state && probe.state.parseDropped}`);
          emitM418(`M418 TAIL ${JSON.stringify((probe.tail || []).slice(-8))}`.slice(0, 700));
        } else if (entry && entry.inaccessible) {
          emitM418(`M418 FRAME-INACCESSIBLE ${String(entry.path).slice(0, 48)} ${entry.inaccessible}`);
        }
      }
      // Raw server-byte body order FIRST for the erroring frame's document: if the response
      // text already leads with scripts, the inversion is server emission; if it leads with
      // the content divs, the DOM order came from client-side insertion instead.
      const errorUrls = frameProbes.filter((entry) => entry && entry.probe && entry.probe.m418last).map((entry) => String(entry.url || entry.path));
      const ranked = [...serverDigests.entries()].sort((a, b) =>
        (errorUrls.some((u) => a[0] === u) ? -1 : 0) - (errorUrls.some((u) => b[0] === u) ? -1 : 0));
      for (const [url, list] of ranked.slice(0, 3)) {
        for (const info of list.slice(-2)) {
          emitM418(`M418 SRV seq=${info.seq} len=${info.len} ${url.slice(-58)} :: ${String(info.order).slice(0, 88)}`);
          emitM418(`M418 SRVHEAD seq=${info.seq} ${String(info.bodyHead).slice(0, 100)}`);
        }
      }
    });
  });
  return page;
}
async function api(page, path, method = "GET", body) {
  return page.evaluate(async (path, method, body) => {
    const response = await fetch(path, {
      method, headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", redirect: "manual",
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, path, method, body);
}
async function clickText(page, selector, text, exact = true) {
  const element = await page.waitForFunction((selector, text, exact) => [...document.querySelectorAll(selector)]
    .find((item) => exact ? item.textContent.trim() === text : item.textContent.includes(text)), {}, selector, text, exact)
    .catch(() => { throw new Error(`Control unavailable within timeout: ${text} (${selector})`); });
  const handle = element.asElement();
  if (!handle) throw new Error(`Control unavailable: ${text}`);
  const before = text === "11:00" ? await handle.evaluate((element) => {
    const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { top: box.top, bottom: box.bottom, viewportHeight: innerHeight, hit: hit?.tagName, hitClass: hit?.className, unobstructed: hit === element || element.contains(hit) };
  }) : null;
  // Real users scroll controls out from under fixed navigation/action bars. No DOM click/force action.
  await handle.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }));
  await page.waitForFunction((element) => {
    const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight && (hit === element || element.contains(hit));
  }, {}, handle).catch(() => { throw new Error(`Control is obscured/non-interactable: ${text} (${selector})`); });
  if (before) console.log(`Actual mobile slot target before centered scroll: ${JSON.stringify(before)}; trusted click target now unobstructed.`);
  await handle.click();
  await handle.dispose();
}
async function snapshot(businessId) {
  return prisma.businessExperience.findUniqueOrThrow({ where: { businessId } });
}
async function patch(page, fixture, change) {
  const prior = await snapshot(fixture.id);
  const response = await api(page, "/api/experience", "PATCH", { businessId: fixture.id, expectedDraftVersion: prior.draftVersion, ...change });
  check(`${fixture.category}: authenticated guarded edit`, response.status === 200);
  const next = await snapshot(fixture.id);
  check(`${fixture.category}: monotonic draft revision`, next.draftVersion > prior.draftVersion);
  return next;
}
async function publishUI(page, fixture, expectedStatus) {
  await page.goto(`${origin}/dashboard/businesses/${fixture.id}`, { waitUntil: "networkidle0" });
  const received = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/experience/publish" && response.request().method() === "POST");
  await clickText(page, "#publish button", "Publish", false);
  const response = await received;
  check(`${fixture.category}: publish UI returns ${expectedStatus}`, response.status() === expectedStatus);
  return response.json();
}
async function preview(page, fixture, marker) {
  await page.goto(`${origin}/dashboard/businesses/${fixture.id}/preview`, { waitUntil: "networkidle0" });
  for (const [device, width] of [["Mobile", 390], ["Desktop", 1280]]) {
    await clickText(page, '[aria-label="Device"] button', device);
    await page.waitForFunction((marker) => document.querySelector('iframe[title="Draft preview"]')?.contentDocument?.body?.textContent.includes(marker), {}, marker);
    const state = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[title="Draft preview"]');
      const doc = iframe.contentDocument;
      return { noindex: doc.querySelector('meta[name="robots"]')?.content.includes("noindex"),
        notice: doc.body.textContent.includes("Draft preview"), width: iframe.contentWindow.innerWidth,
        widthCap: Number.parseFloat(getComputedStyle(iframe.parentElement).maxWidth),
        frameWidth: iframe.getBoundingClientRect().width,
        overflow: doc.documentElement.scrollWidth > doc.documentElement.clientWidth + 2 };
    });
    check(`${fixture.category}: ${device} authenticated draft iframe/readable/noindex`, state.notice && state.noindex && state.widthCap === width && state.width <= width &&
      state.width >= (device === "Mobile" ? 380 : 1000) && Math.abs(state.width - state.frameWidth) <= 1 && !state.overflow, JSON.stringify(state));
  }
}
async function recipeUI(page, fixture, label, detail, enabled) {
  await page.goto(`${origin}/dashboard/businesses/${fixture.id}/sections`, { waitUntil: "networkidle0" });
  await page.click(`button[aria-label="Edit ${label}"]`);
  const checkbox = await page.waitForSelector(`input[aria-label="Show ${detail}"]`);
  const received = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/experience" && response.request().method() === "PATCH");
  await checkbox.click();
  check(`${fixture.category}: actual recipe detail UI save ${enabled ? "on" : "off"}`, (await received).status() === 200);
  const saved = await snapshot(fixture.id);
  const section = JSON.parse(saved.draftJson).sections.find((section) => section.id === fixture.recipeSectionId);
  check(`${fixture.category}: recipe v1 detail persists without publication`, section.config.businessRecipe.version === 1 && section.config.businessRecipe.details.includes(fixture.recipeField) === enabled && saved.publishedJson === null);
}
async function recipeLayoutUI(page, fixture, label, layoutValue) {
  await page.goto(`${origin}/dashboard/businesses/${fixture.id}/sections`, { waitUntil: "networkidle0" });
  await page.click(`button[aria-label="Edit ${label}"]`);
  await page.waitForSelector('select[aria-label="Recipe layout"]');
  const received = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/experience" && response.request().method() === "PATCH");
  await page.select('select[aria-label="Recipe layout"]', layoutValue);
  check(`${fixture.category}: actual recipe layout UI save`, (await received).status() === 200);
  const saved = await snapshot(fixture.id);
  const section = JSON.parse(saved.draftJson).sections.find((section) => section.id === fixture.recipeSectionId);
  check(`${fixture.category}: recipe v1 registered layout persists without publication`, section.config.businessRecipe.version === 1 &&
    section.config.businessRecipe.layout === layoutValue && saved.publishedJson === null);
}
async function publicState(page, fixture, marker, visible, suffix = "") {
  await page.goto(`${origin}/b/${fixture.slug}${suffix}`, { waitUntil: "networkidle0" });
  const state = await page.evaluate((marker) => ({ found: document.body.textContent.includes(marker),
    preview: Boolean(document.querySelector(".eb-preview-banner")), root: Boolean(document.querySelector(".eb-scope")) }), marker);
  check(`${fixture.category}: customer ${visible ? "sees" : "cannot see"} ${suffix ? "draft-query " : ""}content`, state.found === visible && !state.preview && (!visible || state.root));
}
async function cleanup() {
  for (const fixture of created) {
    // Exact IDs from this run only, no broad prefix/global table cleanup.
    await prisma.payment.deleteMany({ where: { businessId: fixture.id } });
    await prisma.business.deleteMany({ where: { id: fixture.id, ownerId: fixture.ownerId } });
    await prisma.auditEvent.deleteMany({ where: { actorId: fixture.ownerId } });
    await prisma.user.deleteMany({ where: { id: fixture.ownerId, email: fixture.email } });
    check(`${fixture.category}: exact-id fixture cleanup`, await prisma.business.count({ where: { id: fixture.id } }) === 0 &&
      await prisma.user.count({ where: { id: fixture.ownerId } }) === 0);
  }
}

try {
  // Fail before spawning the server or writing anything if native DB is unavailable; never use the app's offline stub.
  await prisma.$queryRaw`SELECT 1`;
  const plan = await prisma.planConfig.findUniqueOrThrow({ where: { key: "INTERACTIVE_BUSINESS" } });
  check("isolated seeded canonical Website Studio plan", plan.priceKES === 999 && plan.durationDays === 30 && plan.isActive);
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "0.0.0.0", resolve); });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  origin = `http://localhost:${port}`;
  // M11 Stage D: record the fiber React expected at the #418 throw into window.__m418last
  // (test-build chunk on disk only; diagnostics, no behavior change, never shipped).
  {
    const chunksDir = ".next/static/chunks";
    let patchedCount = 0;
    for (const name of readdirSync(chunksDir)) {
      if (!name.endsWith(".js")) continue;
      const file = `${chunksDir}/${name}`;
      const source = readFileSync(file, "utf8");
      if (!source.includes("Error(i(418")) continue;
      const { patched, source: next } = patchHydrationThrowDiagnostics(source);
      if (patched) { writeFileSync(file, next); patchedCount += 1; }
    }
    console.log(`M418 THROW DIAGNOSTIC PATCH applied to ${patchedCount} chunk(s)`);
  }
  server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", "0.0.0.0", "-p", String(port)], {
    env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", PUBLIC_BASE_URL: origin, NEXTAUTH_URL: origin,
      VERCEL_ENV: "development", VERCEL_URL: "", VERCEL_PROJECT_PRODUCTION_URL: "" }, stdio: ["ignore", "pipe", "pipe"],
  });
  stopped = new Promise((resolve) => server.once("exit", resolve));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Production test server startup timeout")), 60000);
    const log = (data) => { serverLog = (serverLog + String(data)).slice(-6000); if (/Ready in/.test(serverLog)) { clearTimeout(timeout); resolve(); } };
    server.stdout.on("data", log); server.stderr.on("data", log);
    server.once("error", (error) => { clearTimeout(timeout); reject(error); });
    server.once("exit", () => { clearTimeout(timeout); reject(new Error("Production test server exited")); });
  });
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  console.log(`Actual browser: ${await browser.version()}; real production Next HTTP/cookies, disposable native Prisma. No provider interception presented as payment proof.`);
  const visitorContext = await browser.createBrowserContext();
  const visitor = await pageFor(visitorContext);
  await visitor.emulateTimezone("Africa/Nairobi");
  await visitor.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
  await visitor.goto(`${origin}/login`, { waitUntil: "networkidle0" });
  const anonymous = await api(visitor, "/api/experience?businessId=unknown");
  check("anonymous private API refused", anonymous.status === 401);

  for (const [category, itemName, price] of [["retail", "QA cotton tote", 650], ["food", "QA coastal lunch", 850], ["salon", "QA hair appointment", 1200], ["professional", "QA advisory request", null], ["technical", "QA technical visit", null]]) {
    const ownerContext = await browser.createBrowserContext();
    const ownerPage = await pageFor(ownerContext);
    await ownerPage.setViewport({ width: 1440, height: 1000 });
    await ownerPage.goto(`${origin}/login`, { waitUntil: "networkidle0" });
    const email = `studio-browser-${category}-${runId}@test.invalid`;
    const registered = await api(ownerPage, "/api/auth/register", "POST", {
      name: "QA synthetic owner", email, phone: "0712345678", password, businessName: `QA ${category} ${runId}`,
    });
    // Find run-owned rows even if cookie issuance failed, so a failed test does not leave fixtures behind.
    const business = await prisma.business.findFirst({ where: { owner: { email } } });
    if (business) created.push({ id: business.id, ownerId: business.ownerId, slug: business.slug, email, category });
    check(`${category}: actual HTTP registration`, registered.status === 200 && Boolean(business));
    const recipeSpec = { retail: { key: "retail-stock", section: "featured", label: "Featured", field: "brand", detail: "Brand", fact: "QA owner brand", layout: "product-list" },
      food: { key: "food-menu", section: "menu", label: "Menu", field: "ingredients", detail: "Ingredients", fact: "QA owner ingredients", layout: "menu-board" },
      salon: { key: "salon-booking", section: "services", label: "Services", field: "staff", detail: "Specialist", fact: "QA owner specialist", layout: "service-grid" },
      professional: { key: "professional-enquiry", section: "services", label: "Services", field: "staff", detail: "Professional", fact: "QA owner adviser", layout: "service-grid" },
      technical: { key: "technical-enquiry", section: "services", label: "Services", field: "staff", detail: "Technician", fact: "QA owner technician", layout: "service-grid" } }[category];
    const fixture = { ...created.at(-1), ownerPage, ownerContext, itemName, price, recipeKey: recipeSpec.key, recipeField: recipeSpec.field, recipeFact: recipeSpec.fact };
    const cookie = (await ownerPage.cookies()).find((entry) => entry.name === "jata_session");
    check(`${category}: server-issued HttpOnly/Secure/SameSite session`, cookie?.httpOnly && cookie?.secure && cookie?.sameSite === "Lax" && cookie?.path === "/");
    check(`${category}: JWT not accessible to browser JS`, !(await ownerPage.evaluate(() => document.cookie)).includes("jata_session="));
    const profile = await api(ownerPage, "/api/business", "PATCH", {
      businessId: fixture.id, category, phone: "0712345678", whatsapp: "0712345678", location: "QA Nairobi fixture",
      description: `Synthetic ${category} acceptance fixture — not a real business.`,
    });
    check(`${category}: owner saves own business profile`, profile.status === 200);
    const serviceCategory = category === "salon" || category === "professional" || category === "technical";
    const enquiryCategory = category === "professional" || category === "technical";
    const requestTypeLabel = category === "technical" ? "Service request type" : "Professional request type";
    const bookFacetLabel = category === "technical" ? "Book a visit" : "Book a consultation";
    const item = serviceCategory
      ? await api(ownerPage, "/api/services", "POST", { businessId: fixture.id, title: itemName, pricingType: enquiryCategory ? "QUOTE" : "FIXED", priceFrom: price,
        durationMinutes: enquiryCategory ? null : 60, depositKES: 0, bookingEnabled: !enquiryCategory, isActive: true, staffName: recipeSpec.fact,
        availability: JSON.stringify({ days: [0, 1, 2, 3, 4, 5, 6], slots: ["11:00", "14:00"], slotMinutes: 60, capacity: 1 }) })
      : await api(ownerPage, "/api/products", "POST", { businessId: fixture.id, name: itemName, basePriceKES: price, quantity: 50, isActive: true,
        ...(category === "food" ? { ingredients: recipeSpec.fact, portionSize: "QA owner plate", prepMinutes: 15 } : { brand: recipeSpec.fact }) });
    fixture.itemId = serviceCategory ? item.body?.service?.id : item.body?.product?.id;
    check(`${category}: actual tenant catalogue write`, item.status === 201 && Boolean(fixture.itemId));
    if (enquiryCategory) {
      const consultation = await api(ownerPage, "/api/services", "POST", { businessId: fixture.id, title: "QA fixed consultation", pricingType: "FIXED", priceFrom: 900,
        durationMinutes: 30, depositKES: 0, bookingEnabled: true, isActive: true, staffName: recipeSpec.fact,
        availability: JSON.stringify({ days: [0, 1, 2, 3, 4, 5, 6], slots: ["11:00", "14:00"], slotMinutes: 30, capacity: 1 }) });
      fixture.consultationId = consultation.body?.service?.id;
      check(`${category}: actual fixed consultation write, not a dummy Product`, consultation.status === 201 && Boolean(fixture.consultationId));
    }
    const seeded = await api(ownerPage, "/api/experience", "POST", { businessId: fixture.id, categoryKey: category });
    check(`${category}: safe structured creation through HTTP (201)`, seeded.status === 201 && seeded.body?.document?.version === 2 && Boolean(seeded.body.document.artDirection), `status=${seeded.status}, format=${seeded.body?.document?.version ?? "missing"}`);
    const recipeSection = seeded.body.document?.sections.find((section) => section.type === recipeSpec.section);
    fixture.recipeSectionId = recipeSection?.id;
    check(`${category}: registered category recipe is seeded with real catalogue source`, recipeSection?.config?.businessRecipe?.key === recipeSpec.key && recipeSection.config.businessRecipe.version === 1);
    await patch(ownerPage, fixture, { brand: { heroImageUrl: `${origin}/dev/motion-asset.svg`, tagline: `QA first ${category} ${runId}` },
      document: { ...seeded.body.document, renderPreference: "lite", brand: { ...seeded.body.document.brand, heroImageUrl: `${origin}/dev/motion-asset.svg`, tagline: `QA first ${category} ${runId}` } } });
    const before = await snapshot(fixture.id);
    check(`${category}: draft not automatically published`, before.publishedJson === null && before.status === "DRAFT");
    if (enquiryCategory) {
      const draftRequest = await api(visitor, "/api/storefront/enquiry", "POST", { slug: fixture.slug, serviceId: fixture.itemId, customerName: "QA Draft requester", customerPhone: "0700111222", idempotencyKey: `draft-${runId}-request-123` });
      const draftLeads = await prisma.aIQualityEvent.count({ where: { businessId: fixture.id, eventType: "LEAD_GENERAL_INQUIRY" } });
      check(`${category}: anonymous unpublished enquiry refused without a ledger write`,
        draftRequest.status === 404 && draftLeads === 0,
        `status=${draftRequest.status}, leads=${draftLeads}, error=${JSON.stringify(draftRequest.body?.error ?? draftRequest.body ?? null)}`);
      await ownerPage.goto(`${origin}/b/${fixture.slug}/enquire?service=${fixture.itemId}`, { waitUntil: "networkidle0" });
      check(`${category}: owned draft enquiry form is readable/noindex but submission disabled`, await ownerPage.$eval('form[data-enquiry-form] button[type="submit"]', (button) => button.disabled) && await ownerPage.$eval('meta[name="robots"]', (element) => element.content.includes("noindex")));
    }
    await publicState(visitor, fixture, `QA first ${category} ${runId}`, false, "?preview=draft");
    const refused = await publishUI(ownerPage, fixture, 403);
    check(`${category}: unpaid refusal is financial, not an incomplete fixture`, refused.requires === "PAYMENT" && (await snapshot(fixture.id)).publishedJson === null);

    // Real UI edit/onBlur/response, not just API calls or a fake component fixture.
    await ownerPage.goto(`${origin}/dashboard/businesses/${fixture.id}/design`, { waitUntil: "networkidle0" });
    const description = `QA edited ${category} ${runId}`;
    const field = await ownerPage.waitForFunction(() => [...document.querySelectorAll("label")].find((label) => label.textContent.includes("One line about your business"))?.querySelector("input"));
    const input = field.asElement();
    await input.click({ clickCount: 3 });
    await ownerPage.keyboard.down("Control"); await ownerPage.keyboard.press("A"); await ownerPage.keyboard.up("Control");
    await input.type(description);
    const editResponse = ownerPage.waitForResponse((response) => new URL(response.url()).pathname === "/api/experience" && response.request().method() === "PATCH");
    await input.press("Tab");
    check(`${category}: actual design UI save`, (await editResponse).status() === 200);
    let edited = await snapshot(fixture.id);
    check(`${category}: saved UI content and draft revision persist`, JSON.parse(edited.draftJson).brand.description === description && edited.draftVersion > before.draftVersion);
    const stale = await api(ownerPage, "/api/experience", "PATCH", { businessId: fixture.id, expectedDraftVersion: before.draftVersion, brand: { tagline: "STALE MUST NEVER WIN" } });
    check(`${category}: stale edit refused without overwrite`, stale.status === 409 && stale.body.code === "draft_version_conflict" && (await snapshot(fixture.id)).draftJson === edited.draftJson);
    const invalidRecipeBefore = await snapshot(fixture.id);
    const invalidRecipe = await api(ownerPage, "/api/experience", "PATCH", { businessId: fixture.id, expectedDraftVersion: invalidRecipeBefore.draftVersion,
      op: "update", sectionId: fixture.recipeSectionId, patch: { config: { businessRecipe: { version: 99, key: recipeSpec.key, details: ["price"] } } } });
    check(`${category}: raw unsupported recipe/authority config refused without overwrite`, invalidRecipe.status === 400 && (await snapshot(fixture.id)).draftJson === invalidRecipeBefore.draftJson);
    await recipeUI(ownerPage, fixture, recipeSpec.label, recipeSpec.detail, false);
    await preview(ownerPage, fixture, `QA first ${category} ${runId}`);
    check(`${category}: private preview faithfully hides owner-disabled recipe fact`, !(await ownerPage.$eval('iframe[title="Draft preview"]', (iframe) => iframe.contentDocument.body.textContent)).includes(recipeSpec.fact));
    await recipeUI(ownerPage, fixture, recipeSpec.label, recipeSpec.detail, true);
    await preview(ownerPage, fixture, `QA first ${category} ${runId}`);
    check(`${category}: private preview faithfully shows owner-enabled recipe fact`, (await ownerPage.$eval('iframe[title="Draft preview"]', (iframe) => iframe.contentDocument.body.textContent)).includes(recipeSpec.fact));
    await recipeLayoutUI(ownerPage, fixture, recipeSpec.label, recipeSpec.layout);
    await preview(ownerPage, fixture, `QA first ${category} ${runId}`);
    check(`${category}: private preview faithfully applies owner-selected registered recipe layout`,
      await ownerPage.$eval('iframe[title="Draft preview"]', (iframe, layout) => Boolean(iframe.contentDocument.querySelector(`[data-recipe-presentation="${layout}"]`)), recipeSpec.layout));
    edited = await snapshot(fixture.id); // the actually reviewed post-recipe UI revision, not the earlier design-only snapshot
    const persistedItem = serviceCategory ? await prisma.service.findUniqueOrThrow({ where: { id: fixture.itemId } }) : await prisma.product.findUniqueOrThrow({ where: { id: fixture.itemId } });
    check(`${category}: recipe editing does not alter authoritative prices or require dummy rows`, (serviceCategory ? persistedItem.priceFrom : persistedItem.basePriceKES) === price &&
      (!serviceCategory || await prisma.product.count({ where: { businessId: fixture.id } }) === 0));
    check(`${category}: preview does not publish`, (await snapshot(fixture.id)).publishedJson === null);

    // Test-only database entitlement, explicitly NOT a Paystack verification/settlement claim.
    await prisma.payment.create({ data: { businessId: fixture.id, userId: fixture.ownerId, planId: plan.id, reference: `QA-ENT-${category}-${runId}`,
      amount: 99900, currency: "KES", status: "PAID", purpose: "SUBSCRIPTION", raw: JSON.stringify({ isolatedFixture: true, providerVerified: false }) } });
    await prisma.subscription.create({ data: { businessId: fixture.id, userId: fixture.ownerId, planId: plan.id, status: "ACTIVE",
      startAt: new Date(), expiresAt: new Date(Date.now() + 86400000 * 30), graceUntil: new Date(Date.now() + 86400000 * 33) } });
    await prisma.business.update({ where: { id: fixture.id }, data: { status: "ACTIVE" } });
    const entitled = await api(ownerPage, `/api/experience?businessId=${fixture.id}`);
    check(`${category}: synthetic stored entitlement recognized`, entitled.body?.entitlement?.entitled === true && entitled.body?.validation?.ready === true,
      `status=${entitled.status}, entitled=${Boolean(entitled.body?.entitlement?.entitled)}, failed=${(entitled.body?.validation?.checks ?? []).filter((item) => item.status === "fail").map((item) => item.id).join(",")}`);
    const published = await publishUI(ownerPage, fixture, 200);
    // The existing publication validator omits only the draft editing timestamp. Every content field must match.
    const reviewedDocument = JSON.parse(edited.draftJson);
    delete reviewedDocument.updatedAt;
    const savedPublication = await snapshot(fixture.id);
    const savedVersion = await prisma.experienceVersion.findUnique({ where: { businessId_version: { businessId: fixture.id, version: edited.draftVersion } } });
    check(`${category}: exact reviewed content/version published and snapshotted`, published.published === true &&
      savedPublication.publishedJson === JSON.stringify(reviewedDocument) && savedPublication.draftJson === edited.draftJson &&
      savedPublication.publishedVersion === edited.draftVersion && savedPublication.draftVersion === edited.draftVersion &&
      savedVersion?.snapshotJson === savedPublication.publishedJson && await prisma.experienceVersion.count({ where: { businessId: fixture.id } }) === 1,
      `review=${edited.draftVersion}, published=${savedPublication.publishedVersion}, history=${savedVersion?.version ?? "missing"}`);
    await publicState(visitor, fixture, `QA first ${category} ${runId}`, true);
    const lite = await visitor.evaluate(() => ({ mode: document.querySelector(".eb-scope")?.getAttribute("data-render-mode"),
      lazy: performance.getEntriesByType("resource").some((entry) => /motion.*mini|three-product-viewer/.test(entry.name)) }));
    check(`${category}: explicit Lite customer page has no Motion/Three download`, lite.mode === "lite" && !lite.lazy);
    signatures.push({ category, signature: await visitor.evaluate(() => ({
      hero: (document.querySelector(".eb-hero")?.className ?? "").split(" ").filter(Boolean).sort().join(" "),
      body: document.querySelector(".eb-family-body")?.getAttribute("data-composition"),
      catalogue: document.querySelector("[data-catalogue-layout]")?.getAttribute("data-catalogue-layout"),
      recipe: document.querySelector("[data-business-recipe]")?.getAttribute("data-business-recipe"),
    })) });
    const noJS = await pageFor(visitorContext);
    await noJS.setViewport({ width: 360, height: 740 }); await noJS.setJavaScriptEnabled(false);
    await noJS.goto(`${origin}/b/${fixture.slug}/item/${fixture.itemId}`, { waitUntil: "networkidle0" });
    const staticPage = await noJS.evaluate(() => ({ text: document.querySelector("main")?.textContent,
      contact: Boolean(document.querySelector('a[href^="tel:"]')),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 }));
    check(`${category}: no-JS mobile real catalogue/contact HTML`, staticPage.text?.includes(itemName) && staticPage.contact && !staticPage.overflow);
    await noJS.goto(`${origin}/b/${fixture.slug}/shop`, { waitUntil: "networkidle0" });
    const recipeStatic = await noJS.evaluate(() => ({ text: document.querySelector("main")?.textContent,
      key: document.querySelector('[data-business-recipe]')?.getAttribute('data-business-recipe'),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 }));
    check(`${category}: no-JS mobile recipe/correct facts readable without overflow`, recipeStatic.key === recipeSpec.key && recipeStatic.text?.includes(itemName) && recipeStatic.text?.includes(recipeSpec.fact) && !recipeStatic.overflow);
    check(`${category}: no-JS mobile owner-selected recipe presentation`, await noJS.$eval('[data-recipe-presentation]', (element) => element.getAttribute('data-recipe-presentation')) === recipeSpec.layout);
    await noJS.close();
    const links = await visitor.evaluate(() => [...document.querySelectorAll("a")].map((link) => link.getAttribute("href")));
    check(`${category}: real tenant call/WhatsApp/directions paths`, links.some((link) => link?.startsWith("tel:")) && links.some((link) => link?.startsWith("https://wa.me/")) && links.some((link) => /maps|google.com/.test(link || "")));

    await visitor.goto(`${origin}/b/${fixture.slug}/shop`, { waitUntil: "networkidle0" });
    check(`${category}: customer catalogue has functional category recipe and real fact`, await visitor.$eval('[data-business-recipe]', (element) => element.getAttribute('data-business-recipe')) === recipeSpec.key &&
      (await visitor.evaluate(() => document.querySelector("main").textContent)).includes(recipeSpec.fact));
    check(`${category}: published owner-selected recipe presentation`, await visitor.$eval('[data-recipe-presentation]', (element) => element.getAttribute('data-recipe-presentation')) === recipeSpec.layout);
    if (serviceCategory) {
      check(`${category}: no irrelevant stock/cart assumptions in service recipe`, !(await visitor.evaluate(() => document.querySelector("main").textContent)).includes("In stock only") && await visitor.$(enquiryCategory ? '[data-recipe-action="enquire"] a' : '[data-recipe-action="book"] a'));
      await clickText(visitor, 'button', '30 min or less');
      if (category === "salon") await visitor.waitForFunction(() => document.querySelector("main").textContent.includes("Nothing matches"));
      else {
        await visitor.waitForFunction(() => document.querySelector("main").textContent.includes("QA fixed consultation") && !document.querySelector("main").textContent.includes("QA advisory request"));
        check(`${category}: short-duration filter selects actual consultation, not unpriced quote work`, (await visitor.$$('[data-recipe-item]')).length === 1);
      }
      await clickText(visitor, 'button', 'Any duration');
      check(`${category}: actual duration filter restores owned service`, Boolean(await visitor.waitForSelector('[data-recipe-item]')));
    } else {
      await clickText(visitor, 'button', category === "food" ? 'Available dishes only' : 'In stock only');
      check(`${category}: actual category-appropriate availability filter`, Boolean(await visitor.$('[data-recipe-item]')));
    }
    await visitor.type('input[type="search"]', 'does-not-exist');
    await visitor.waitForFunction(() => document.querySelector("main").textContent.includes("Nothing matches"));
    await visitor.click('input[type="search"]'); await visitor.keyboard.down("Control"); await visitor.keyboard.press("A"); await visitor.keyboard.up("Control"); await visitor.keyboard.press("Backspace");
    await visitor.waitForSelector('[data-recipe-item]');
    check(`${category}: actual search/no-match/recovery preserves owned item and price`, (await visitor.evaluate(() => document.querySelector("main").textContent)).includes(itemName));

    // Editing and even owner preview cannot replace an already-live snapshot.
    const liveJson = (await snapshot(fixture.id)).publishedJson;
    await patch(ownerPage, fixture, { brand: { tagline: `QA unpublished ${category} ${runId}` } });
    await preview(ownerPage, fixture, `QA unpublished ${category} ${runId}`);
    await publicState(visitor, fixture, `QA unpublished ${category} ${runId}`, false, "?preview=draft");
    check(`${category}: preview/live snapshot isolation`, (await snapshot(fixture.id)).publishedJson === liveJson);
    const versions = await api(ownerPage, `/api/experience/versions?businessId=${fixture.id}`);
    const current = await snapshot(fixture.id);
    const restored = await api(ownerPage, "/api/experience/versions", "POST", { businessId: fixture.id, version: versions.body.versions[0].version, expectedDraftVersion: current.draftVersion });
    check(`${category}: published restore is draft-only/monotonic`, restored.status === 200 && (await snapshot(fixture.id)).draftVersion > current.draftVersion && (await snapshot(fixture.id)).publishedJson === liveJson);

    await visitor.goto(`${origin}/b/${fixture.slug}/item/${fixture.itemId}`, { waitUntil: "networkidle0" });
    check(`${category}: live item reads real scoped catalogue`, (await visitor.$eval("main", (element) => element.textContent)).includes(itemName));
    if (!serviceCategory) {
      await clickText(visitor, "main button.eb-btn--block", "·", false);
      await visitor.waitForSelector(".eb-drawer");
      const drawer = await visitor.$eval(".eb-drawer", (element) => ({ visible: element.getBoundingClientRect().top < innerHeight && element.getBoundingClientRect().bottom <= innerHeight + 2, text: element.textContent }));
      check(`${category}: touch-size customer cart is visible with correct price`, drawer.visible && drawer.text.includes(String(price)));
      await clickText(visitor, ".eb-drawer button", "Checkout");
      await visitor.waitForFunction(() => location.pathname.endsWith("/checkout"));
      await visitor.waitForSelector("#co-name");
      await visitor.waitForFunction(() => !document.body.textContent.includes("Checking prices"));
      const quote = await api(visitor, "/api/storefront/quote", "POST", { slug: fixture.slug, items: [{ productId: fixture.itemId, quantity: 2, unitPriceKES: 1 }], fulfilment: "PICKUP", totalKES: 1 });
      check(`${category}: browser HTTP quote ignores forged prices`, quote.status === 200 && quote.body.totalKES === price * 2 && quote.body.lines[0].unitPriceKES === price);
      check(`${category}: provider-free gate creates no customer payment/order`, await prisma.order.count({ where: { businessId: fixture.id } }) === 0 && await prisma.payment.count({ where: { businessId: fixture.id } }) === 1);
    } else if (category === "salon") {
      await visitor.goto(`${origin}/b/${fixture.slug}/book?service=${fixture.itemId}`, { waitUntil: "networkidle0" });
      const dateButtons = await visitor.$$("fieldset:first-of-type button");
      const availableResponse = visitor.waitForResponse((response) => new URL(response.url()).pathname === "/api/storefront/booking" && response.request().method() === "GET");
      await dateButtons[1].click(); // tomorrow, not a hard-coded date or past-time workaround
      const availability = await availableResponse.catch(() => { throw new Error("salon: no actual availability GET after date selection"); });
      const offeredSlots = await availability.json();
      check("salon: actual server offers configured future slot", availability.status() === 200 && offeredSlots.slots?.includes("11:00"), `status=${availability.status()}, slots=${JSON.stringify(offeredSlots.slots ?? [])}`);
      await clickText(visitor, "fieldset button", "11:00");
      await visitor.type("#bk-name", "QA synthetic customer"); await visitor.type("#bk-phone", "0700111222");
      const ready = await visitor.evaluate(() => ({ selectedTime: [...document.querySelectorAll('fieldset button[aria-pressed="true"]')].some((button) => button.textContent.trim() === "11:00"), namePresent: document.querySelector("#bk-name")?.value?.length >= 2, phonePresent: document.querySelector("#bk-phone")?.value?.replace(/\D/g, "").length >= 9 }));
      check("salon: booking UI has actual selected slot/customer fields", ready.selectedTime && ready.namePresent && ready.phonePresent, JSON.stringify(ready));
      const bookedResponse = visitor.waitForResponse((response) => new URL(response.url()).pathname === "/api/storefront/booking" && response.request().method() === "POST");
      await clickText(visitor, "main button", "Book now");
      const bookingResponse = await bookedResponse.catch(async () => {
        const alert = await visitor.$eval('[role="alert"]', (element) => element.textContent).catch(() => "no form alert");
        throw new Error(`salon: no booking POST after submit; ${alert}`);
      });
      check("salon: actual browser booking (zero deposit, no provider)", bookingResponse.status() === 201);
      const booking = (await bookingResponse.json()).booking;
      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      check("salon: customer booking persists with real tenant/service and unpaid state", stored.businessId === fixture.id && stored.serviceId === fixture.itemId && stored.paymentStatus === "UNPAID" && stored.depositKES === 0);
      const board = await api(ownerPage, `/api/bookings?businessId=${fixture.id}`);
      check("salon: authenticated owner receives the browser booking", board.status === 200 && board.body.bookings.some((item) => item.id === booking.id));
    }
    if (enquiryCategory) {
      await visitor.goto(`${origin}/b/${fixture.slug}/shop`, { waitUntil: "networkidle0" });
      await clickText(visitor, `[aria-label="${requestTypeLabel}"] button`, 'Request a quote');
      await visitor.waitForFunction(() => !document.querySelector('main').textContent.includes('QA fixed consultation'));
      check(`${category}: quote facet selects owned request-only service`, (await visitor.$eval('main', (element) => element.textContent)).includes(itemName));
      await clickText(visitor, `[aria-label="${requestTypeLabel}"] button`, bookFacetLabel);
      await visitor.waitForFunction(() => !document.querySelector('main').textContent.includes('QA advisory request'));
      check(`${category}: booking facet selects actual fixed-price consultation`, (await visitor.$eval('main', (element) => element.textContent)).includes('QA fixed consultation'));
      await clickText(visitor, `[aria-label="${requestTypeLabel}"] button`, 'All services');
      const enquiryTarget = await visitor.$eval('[data-recipe-action="enquire"] a', (element) => {
        const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { path: new URL(element.href).pathname, top: box.top, bottom: box.bottom, viewport: innerHeight, hit: hit?.tagName, hitClass: typeof hit?.className === 'string' ? hit.className : null, unobstructed: hit === element || element.contains(hit) };
      });
      console.log(`Actual enquiry link before centered trusted click: ${JSON.stringify(enquiryTarget)}`);
      await clickText(visitor, '[data-recipe-action="enquire"] a', 'Request a quote');
      await visitor.waitForSelector('#eq-name').catch(() => { throw new Error(`${category}: enquiry form not reached after trusted link; path=${new URL(visitor.url()).pathname}`); });
      check(`${category}: actual request-only form has no fake date/slots/price and correct owned service`, await visitor.$eval('#eq-service', (select) => select.value) === fixture.itemId &&
        !await visitor.$('#bk-name') && (await visitor.$eval('main', (element) => element.textContent)).includes('not a confirmed booking'));
      const bookingBefore = await prisma.booking.count({ where: { businessId: fixture.id } });
      const enquiryCustomer = `QA ${category} customer`;
      await visitor.type('#eq-name', enquiryCustomer); await visitor.type('#eq-phone', '0700111222'); await visitor.type('#eq-notes', 'QA actual scope enquiry');
      const submitted = visitor.waitForResponse((response) => new URL(response.url()).pathname === '/api/storefront/enquiry' && response.request().method() === 'POST');
      await clickText(visitor, 'main button[type="submit"]', 'Send enquiry');
      const receipt = await submitted; const result = await receipt.json();
      check(`${category}: actual browser enquiry acknowledged only after persistence`, receipt.status() === 201 && result.received === true && Boolean(result.enquiry?.id));
      const ledger = await prisma.aIQualityEvent.findUniqueOrThrow({ where: { id: result.enquiry.id } }); const storedRequest = JSON.parse(ledger.metadata);
      check(`${category}: request persists with exact tenant/service/contact, no appointment or marketing`, ledger.businessId === fixture.id && storedRequest.referenceId === fixture.itemId && storedRequest.serviceName === itemName && storedRequest.customerPhone === '0700111222' && storedRequest.status === 'RECEIVED' && storedRequest.transactionalOnly === true && !storedRequest.startAt);
      const originalBody = JSON.parse(receipt.request().postData());
      const replay = await api(visitor, '/api/storefront/enquiry', 'POST', originalBody);
      check(`${category}: unchanged browser request replay returns same durable ID once`, replay.status === 200 && replay.body.idempotent === true && replay.body.enquiry.id === result.enquiry.id &&
        await prisma.aIQualityEvent.count({ where: { businessId: fixture.id, eventType: 'LEAD_GENERAL_INQUIRY' } }) === 1);
      const conflict = await api(visitor, '/api/storefront/enquiry', 'POST', { ...originalBody, notes: 'Changed requirements' });
      check(`${category}: changed retry refused without overwrite`, conflict.status === 409 && (await prisma.aIQualityEvent.findUniqueOrThrow({ where: { id: result.enquiry.id } })).metadata === ledger.metadata);
      const publicRead = await api(visitor, `/api/storefront/enquiry?businessId=${fixture.id}`);
      check(`${category}: anonymous ledger read cannot leak customer contacts`, publicRead.status === 401 && !publicRead.body.enquiries);
      const authority = await api(visitor, '/api/storefront/enquiry', 'POST', { ...originalBody, idempotencyKey: `spoof-${runId}-authority`, businessId: created[0].id, amount: 1, status: 'CONFIRMED' });
      check(`${category}: forged tenant/amount/confirmation fields refused`, authority.status === 400);
      const foreign = await api(visitor, '/api/storefront/enquiry', 'POST', { ...originalBody, idempotencyKey: `foreign-${runId}-service`, serviceId: created[2].itemId });
      check(`${category}: foreign service cannot be attached to request`, foreign.status === 404 && await prisma.aIQualityEvent.count({ where: { businessId: fixture.id, eventType: 'LEAD_GENERAL_INQUIRY' } }) === 1);
      const board = await api(ownerPage, `/api/storefront/enquiry?businessId=${fixture.id}`);
      check(`${category}: authenticated owner receives durable request, no raw replay metadata`, board.status === 200 && board.body.enquiries.some((enquiry) => enquiry.id === result.enquiry.id && enquiry.customerName === enquiryCustomer) && !JSON.stringify(board.body).includes('requestHash'));
      await ownerPage.goto(`${origin}/dashboard/businesses/${fixture.id}`, { waitUntil: 'networkidle0' });
      await ownerPage.waitForFunction((name) => document.querySelector('[data-enquiry-board]')?.textContent.includes(name), {}, enquiryCustomer);
      check(`${category}: actual owner enquiry board receives browser request`, (await ownerPage.$eval('[data-enquiry-board]', (element) => element.textContent)).includes('QA actual scope enquiry'));
      check(`${category}: enquiry creates no booking/order/payment or dummy Product`, await prisma.booking.count({ where: { businessId: fixture.id } }) === bookingBefore && await prisma.order.count({ where: { businessId: fixture.id } }) === 0 && await prisma.payment.count({ where: { businessId: fixture.id } }) === 1 && await prisma.product.count({ where: { businessId: fixture.id } }) === 0);
      await visitor.goto(`${origin}/b/${fixture.slug}/book?service=${fixture.itemId}`, { waitUntil: 'networkidle0' });
      check(`${category}: old quote booking entry routes to enquiry instead of unreachable slots`, new URL(visitor.url()).pathname.endsWith('/enquire') && Boolean(await visitor.$('#eq-name')) && !await visitor.$('#bk-name'));
      const noJS = await pageFor(visitorContext); await noJS.setViewport({ width: 360, height: 740 }); await noJS.setJavaScriptEnabled(false);
      await noJS.goto(`${origin}/b/${fixture.slug}/enquire?service=${fixture.itemId}`, { waitUntil: 'networkidle0' });
      const staticEnquiry = await noJS.evaluate(() => ({ text: document.querySelector('main').textContent, contact: Boolean(document.querySelector('a[href^="tel:"]')), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 }));
      check(`${category}: no-JS mobile request facts/contact fallback readable`, staticEnquiry.text.includes(itemName) && staticEnquiry.text.includes('Call or WhatsApp') && staticEnquiry.contact && !staticEnquiry.overflow); await noJS.close();
      await visitor.goto(`${origin}/b/${fixture.slug}/book?service=${fixture.consultationId}`, { waitUntil: 'networkidle0' });
      const dates = await visitor.$$('fieldset:first-of-type button');
      const available = visitor.waitForResponse((response) => new URL(response.url()).pathname === '/api/storefront/booking' && response.request().method() === 'GET');
      await dates[1].click(); const offered = await available;
      check(`${category}: fixed consultation still uses server availability`, offered.status() === 200 && (await offered.json()).slots.includes('11:00'));
      await clickText(visitor, 'fieldset button', '11:00'); await visitor.type('#bk-name', 'QA consultation customer'); await visitor.type('#bk-phone', '0700999888');
      const fixedPost = visitor.waitForResponse((response) => new URL(response.url()).pathname === '/api/storefront/booking' && response.request().method() === 'POST');
      await clickText(visitor, 'main button', 'Book now'); const fixedResponse = await fixedPost;
      check(`${category}: actual fixed zero-deposit appointment retains existing booking flow`, fixedResponse.status() === 201);
      const fixed = (await fixedResponse.json()).booking; const booked = await prisma.booking.findUniqueOrThrow({ where: { id: fixed.id } });
      check(`${category}: fixed booking belongs to real consultation and stays unpaid/provider-free`, booked.businessId === fixture.id && booked.serviceId === fixture.consultationId && booked.depositKES === 0 && booked.paymentStatus === 'UNPAID' && await prisma.payment.count({ where: { businessId: fixture.id } }) === 1);
    }
    fixture.ownerPage = ownerPage;
    Object.assign(created.at(-1), fixture);
  }

  // Probe actual Next SSR/navigation across timezones using the same owned published fixtures.
  // No intercepted data, auth override, calendar capacity change or ignored recoverable error.
  for (const fixture of created) {
    for (const timezone of ["UTC", "Africa/Nairobi", "America/New_York"]) {
      await visitor.emulateTimezone(timezone);
      for (const suffix of ["", `/item/${fixture.itemId}`, fixture.category === "salon" ? `/book?service=${fixture.itemId}` : "/shop", ...(["professional", "technical"].includes(fixture.category) ? [`/enquire?service=${fixture.itemId}`, `/book?service=${fixture.consultationId}`] : [])]) {
        const path = `/b/${fixture.slug}${suffix}`;
        const response = await visitor.goto(`${origin}${path}`, { waitUntil: "networkidle0" });
        const record = { category: fixture.category, timezone, path: path.split("?")[0], status: response?.status() };
        hydrationVisits.push(record);
        check(`${fixture.category}: actual SSR ${timezone} ${suffix.split("?")[0] || "home"}`, record.status === 200);
        if (suffix.startsWith("/book")) {
          const html = await response.text();
          const serverDates = [...html.matchAll(/<button[^>]*class="eb-chip[^\"]*"[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]).slice(0, 10);
          const clientDates = await visitor.$$eval("fieldset:first-of-type button", (buttons) => buttons.map((button) => button.textContent));
          check(`${fixture.category}: actual SSR/client calendar identical in ${timezone}`, serverDates.length === 10 && JSON.stringify(serverDates) === JSON.stringify(clientDates));
        }
      }
    }
  }
  await visitor.emulateTimezone("Africa/Nairobi");

  const [first, second, salon, professional, technical] = created;
  const foreignBefore = await snapshot(second.id);
  for (const [path, method, body] of [
    [`/api/experience?businessId=${second.id}`, "GET"],
    ["/api/experience", "PATCH", { businessId: second.id, expectedDraftVersion: foreignBefore.draftVersion, brand: { tagline: "FOREIGN MUST NEVER WIN" } }],
    ["/api/experience", "PATCH", { businessId: second.id, expectedDraftVersion: foreignBefore.draftVersion, op: "update", sectionId: second.recipeSectionId,
      patch: { config: { businessRecipe: { version: 1, key: second.recipeKey, details: [] } } } }],
    ["/api/experience/publish", "POST", { businessId: second.id, expectedDraftVersion: foreignBefore.draftVersion }],
    [`/api/experience/versions?businessId=${second.id}`, "GET"],
    [`/api/experience/history?businessId=${second.id}`, "GET"],
    [`/api/studio/health?businessId=${second.id}`, "GET"],
    [`/api/bookings?businessId=${salon.id}`, "GET"],
    [`/api/storefront/enquiry?businessId=${professional.id}`, "GET"],
    [`/api/storefront/enquiry?businessId=${technical.id}`, "GET"],
  ]) {
    const response = await api(first.ownerPage, path, method, body);
    check(`cross-tenant ${method} ${path.split("?")[0]} refused`, response.status === 403 && !response.body?.document && !response.body?.versions && !response.body?.bookings && !response.body?.revisions && !response.body?.report && !response.body?.enquiries);
  }
  check("cross-tenant attempts do not mutate foreign draft/live", JSON.stringify(await snapshot(second.id)) === JSON.stringify(foreignBefore));
  await first.ownerPage.goto(`${origin}/dashboard/businesses/${second.id}/design`, { waitUntil: "networkidle0" });
  const foreignPage = await first.ownerPage.evaluate(() => ({ text: document.body.textContent,
    design: Boolean(document.querySelector('input[type="color"]')), noindex: document.querySelector('meta[name="robots"]')?.content.includes("noindex") }));
  check("foreign owner workspace is not-found/noindex and does not leak its design", foreignPage.noindex && foreignPage.text.includes("could not be found") && !foreignPage.text.includes(second.itemName) && !foreignPage.design);
  await publicState(first.ownerPage, second, `QA unpublished ${second.category} ${runId}`, false, "?preview=draft");
  const archGroups = new Map();
  for (const entry of signatures) {
    const key = JSON.stringify(entry.signature);
    archGroups.set(key, [...(archGroups.get(key) ?? []), entry.category]);
  }
  check("representative business types have distinct rendered information architectures (not palette/family labels)",
    archGroups.size === signatures.length,
    `distinct=${archGroups.size}/${signatures.length}; groups=${JSON.stringify([...archGroups.values()])}`);

  // Expiry must refuse publication without destroying drafts/history. No production lifecycle job is invoked.
  await prisma.subscription.update({ where: { businessId: first.id }, data: { status: "EXPIRED", expiresAt: new Date(Date.now() - 86400000 * 5), graceUntil: new Date(Date.now() - 86400000) } });
  const expiredBefore = await snapshot(first.id);
  const expired = await api(first.ownerPage, "/api/experience/publish", "POST", { businessId: first.id, expectedDraftVersion: expiredBefore.draftVersion });
  check("expired entitlement refuses publish and preserves content", expired.status === 403 && (await snapshot(first.id)).draftJson === expiredBefore.draftJson && (await snapshot(first.id)).publishedJson === expiredBefore.publishedJson);

  // Logout + actual UI login, no setCookie shortcut/signing secret/session mocks.
  await api(first.ownerPage, "/api/auth/logout", "POST");
  check("logout removes server cookie and private API access", !(await first.ownerPage.cookies()).some((cookie) => cookie.name === "jata_session") && (await api(first.ownerPage, `/api/experience?businessId=${first.id}`)).status === 401);
  await first.ownerPage.goto(`${origin}/login`, { waitUntil: "networkidle0" });
  await first.ownerPage.type('input[type="email"]', first.email); await first.ownerPage.type('input[type="password"]', password);
  const loginResponse = first.ownerPage.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/login");
  await first.ownerPage.click('button[type="submit"]');
  check("real UI password login succeeds", (await loginResponse).status() === 200);
  await first.ownerPage.waitForFunction(() => location.pathname.startsWith("/dashboard"));
  check("real cookie login restores only own workspace", (await api(first.ownerPage, `/api/experience?businessId=${first.id}`)).status === 200 &&
    (await api(first.ownerPage, `/api/experience?businessId=${second.id}`)).status === 403);
  // M11: amplify the #418 reproduction window on the exact failing route. The defect fires
  // during a fresh load of the owner draft preview (storefront iframe hydration) at an
  // intermittent per-load rate, so each journey samples the historically failing fixtures
  // several times under CPU throttle (low-end-device emulation widens the load-time race
  // window). The existing pageerror gate below is the throw detector; the emission-order
  // gate after the loop is the M11 regression check (scripts must never lead the body).
  // Load timeouts under throttle skip the sample and never fail the journey.
  // Every attempt is recorded in results.json.
  {
    const sampleFixtures = created; // all five representative business types
    const cdp = await first.ownerPage.createCDPSession().catch(() => null);
    for (const fixture of sampleFixtures) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const entry = { category: fixture.category, route: `/dashboard/businesses/${fixture.id}/preview`, attempt, throttle: 4 };
        try {
          if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
          await first.ownerPage.goto(`${origin}/dashboard/businesses/${fixture.id}/preview`, { waitUntil: "networkidle0" });
          await first.ownerPage.waitForFunction((marker) => document.querySelector('iframe[title="Draft preview"]')?.contentDocument?.body?.textContent.includes(marker), {}, `QA first ${fixture.category} ${runId}`);
          entry.ok = true;
          entry.order = await first.ownerPage.evaluate(() => [...(document.querySelector('iframe[title="Draft preview"]')?.contentDocument?.body?.children ?? [])].slice(0, 12).map((n) => `${n.nodeName.toLowerCase()}${n.id ? `#${n.id}` : ""}`).join(",")).catch(() => "n/a");
          // M12 Stage B: pair the pre-hydration DOM order with the RAW server response order
          // of the same document (byte-order markers captured before any browser-side parse).
          const frameSrc = await first.ownerPage.evaluate(() => document.querySelector('iframe[title="Draft preview"]')?.getAttribute("src") || "").catch(() => "");
          const absolute = frameSrc ? new URL(frameSrc, origin).href : "";
          const rawList = absolute ? serverDigests.get(absolute) : null;
          if (rawList && rawList.length) {
            const info = rawList[rawList.length - 1];
            entry.rawSeq = info.seq;
            entry.rawStatus = info.status;
            entry.rawOrder = info.order;
            entry.rawOffsets = info.offsets;
            entry.rawBodyHead = String(info.bodyHead).slice(0, 120);
          } else {
            entry.rawOrder = "no-response-captured";
          }
        } catch (error) {
          entry.ok = false;
          entry.error = String(error).slice(0, 120);
        } finally {
          if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => {});
        }
        hydrationVisits.push(entry);
        const sampleLine = `HYDRATION SAMPLE ${JSON.stringify(entry)}`.slice(0, 880);
        m418Lines.push(sampleLine);
        console.log(sampleLine);
      }
    }
    if (cdp) await cdp.detach().catch(() => {});
    // M11 #418 regression gate: the root cause was Fizz emitting the `_R_`/Flight bootstrap
    // scripts BEFORE the content divs when the root segment was still pending at first
    // flush. React's body-level hydration walk cannot skip leading scripts (non-root
    // context) and throws #418. The request-cache fix makes the emission order
    // deterministic (content first); an inverted sample here means the defect class is back.
    const invertedOrders = hydrationVisits.filter((entry) => String(entry.order ?? "").startsWith("script"));
    check("SSR body order: hydration bootstrap scripts never lead the content (M11 #418 regression)",
      invertedOrders.length === 0,
      JSON.stringify(invertedOrders.slice(0, 3).map((entry) => ({ route: entry.route, attempt: entry.attempt, order: entry.order }))));
  }
  check("no original uploads/media writes introduced", await prisma.mediaAsset.count({ where: { businessId: { in: created.map((item) => item.id) } } }) === 0);
  check("no external/provider/disallowed browser requests", denied.length === 0, JSON.stringify(denied));
  check("no uncaught browser runtime errors", errors.length === 0, JSON.stringify(errors));
  journeyComplete = true;
} catch (error) {
  if (!results.at(-1) || results.at(-1).ok) results.push({ name: "journey execution", ok: false, detail: String(error.message).slice(0, 250) });
  failureName = String(error.message).slice(0, 250);
  console.error(`FAIL authenticated journey: ${error.message}`);
  // Fail-fast must still surface pageerror evidence: an earlier hydration recovery can
  // explain a later DOM-state assertion (e.g., Float-managed head metas mid-regeneration).
  if (errors.length) {
    for (const record of errors.slice(0, 3)) emitM418(`M418-RECORDED ${JSON.stringify(record).slice(0, 900)}`);
  }
  // No cookies/payloads/credentials in diagnostics. Keep the actual server error context locally/CI only.
  console.error(serverLog.slice(-3500));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) {
    server.kill("SIGTERM");
    const kill = setTimeout(() => server.kill("SIGKILL"), 5000); kill.unref();
    await stopped; clearTimeout(kill);
  }
  try { await cleanup(); } catch (error) { results.push({ name: "fixture cleanup", ok: false, detail: "Exact-id cleanup failed" }); console.error("FAIL fixture cleanup"); }
  await prisma.$disconnect();
  mkdirSync(".cache/verification/studio-authenticated", { recursive: true });
  // M12 Stage B: bounded raw-order evidence artifact (redacted — tags/offsets only).
  const serverSnapshots = [...serverDigests.entries()].slice(0, 8).map(([path, info]) => ({ path, ...info }));
  writeFileSync(".cache/verification/studio-authenticated/m418-evidence.json", JSON.stringify({
    m418Lines: m418Lines.slice(0, 40), serverSnapshots, hydrationVisits: hydrationVisits.slice(0, 40),
    errors: errors.slice(0, 6), journeyComplete,
  }, null, 2));
  writeFileSync(".cache/verification/studio-authenticated/results.json", JSON.stringify({ results, denied, errors, signatures, hydrationVisits,
    journeyComplete, remainingScenarios: journeyComplete ? "All defined provider-free scenarios executed" : "NOT RUN: fail-fast remainder", journeyStatus: journeyComplete && results.every((item) => item.ok) ? "PASS" : "FAIL",
    providerPayment: "NOT RUN", persistentOriginals: "BLOCKED: owner DEFERRED", physicalAndroid: "NOT RUN", serverStopped: true, serverSnapshots }, null, 2));
}
const failed = results.filter((item) => !item.ok).length;
// Reprint the buffered M418 evidence at end-of-run so it survives the CI summary
// comment's middle-elision (its tail window keeps these lines).
if (m418Lines.length || hydrationVisits.length) {
  console.log(`M418E BEGIN ${m418Lines.length} buffered evidence lines`);
  const priority = m418Lines.filter((line) => !line.startsWith("HYDRATION SAMPLE"));
  const rank = (line) => (line.includes("EXPECTED") || line.includes("M418 HEAD") || line.includes("M418 PARSE") || line.includes("M418E STK") || line.includes("M418E NAV") ? 0 : 1);
  const ordered = [...priority].sort((a, b) => rank(a) - rank(b));
  for (const line of ordered.slice(0, 18)) console.log(String(line).slice(0, 175));
  for (const entry of hydrationVisits.slice(-4)) {
    if (entry && (entry.rawOrder || entry.order)) {
      console.log(`M418E PAIR dom=${String(entry.order || "").slice(0, 46)} raw=${String(entry.rawOrder || "").slice(0, 46)} :: ${entry.category || ""} a${entry.attempt || ""}`);
    }
  }
  // The failing load's own response often resolves AFTER the throw (mid-parse captures),
  // so every captured storefront response record is dumped here at end-of-run.
  for (const [url, list] of [...serverDigests.entries()].filter(([u]) => u.includes("/b/")).slice(0, 6)) {
    for (const info of list) {
      console.log(`M418E RESP seq=${info.seq} len=${info.len} ${String(url).slice(-46)} :: ${String(info.order).slice(0, 84)}`);
    }
  }
  console.log("M418E END");
}
if (failureName) console.log(`FAILED CHECK: ${failureName}`);
console.log(`${results.length - failed} passed, ${failed} failed, 0 skipped. Authenticated production-HTTP/browser/native-DB checks; synthetic entitlement, NOT provider payment/physical Android/full engine proof. Temporary server stopped.`);
if (!journeyComplete) console.log("NOT RUN: remaining required provider-free scenarios after first failure; passing attempted checks are not complete journey acceptance.");
process.exitCode = failed || !journeyComplete ? 1 : 0;
