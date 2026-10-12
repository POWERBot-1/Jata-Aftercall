#!/usr/bin/env node
/** Real HTTP/Next/JWT/browser/Prisma gate. Synthetic entitlement only; never a provider/payment/device certification. */
import puppeteer from "puppeteer-core";
import { PrismaClient } from "@prisma/client";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { assertIsolatedStudioTarget, isAllowedStudioRequest } from "./studio-journey-safety.mjs";

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
const created = [], results = [], denied = [], errors = [], signatures = [];
let browser, server, stopped, origin, serverLog = "", journeyComplete = false;
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(name);
}
async function pageFor(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (!isAllowedStudioRequest(request.url(), origin, request.method())) {
      // Store no query strings, payloads, JWTs or cookies in evidence.
      denied.push({ method: request.method(), path: new URL(request.url()).pathname });
      return void request.abort();
    }
    return void request.continue();
  });
  page.on("pageerror", (error) => errors.push(String(error.message).slice(0, 200)));
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
      state.width >= (device === "Mobile" ? 380 : 1000) && Math.abs(state.width - state.frameWidth) <= 1 && !state.overflow);
  }
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
  await visitor.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
  await visitor.goto(`${origin}/login`, { waitUntil: "networkidle0" });
  const anonymous = await api(visitor, "/api/experience?businessId=unknown");
  check("anonymous private API refused", anonymous.status === 401);

  for (const [category, itemName, price] of [["retail", "QA cotton tote", 650], ["food", "QA coastal lunch", 850], ["salon", "QA hair appointment", 1200]]) {
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
    const fixture = { ...created.at(-1), ownerPage, ownerContext, itemName, price };
    const cookie = (await ownerPage.cookies()).find((entry) => entry.name === "jata_session");
    check(`${category}: server-issued HttpOnly/Secure/SameSite session`, cookie?.httpOnly && cookie?.secure && cookie?.sameSite === "Lax" && cookie?.path === "/");
    check(`${category}: JWT not accessible to browser JS`, !(await ownerPage.evaluate(() => document.cookie)).includes("jata_session="));
    const profile = await api(ownerPage, "/api/business", "PATCH", {
      businessId: fixture.id, category, phone: "0712345678", whatsapp: "0712345678", location: "QA Nairobi fixture",
      description: `Synthetic ${category} acceptance fixture — not a real business.`,
    });
    check(`${category}: owner saves own business profile`, profile.status === 200);
    const item = category === "salon"
      ? await api(ownerPage, "/api/services", "POST", { businessId: fixture.id, title: itemName, pricingType: "FIXED", priceFrom: price,
        durationMinutes: 60, depositKES: 0, bookingEnabled: true, isActive: true,
        availability: JSON.stringify({ days: [0, 1, 2, 3, 4, 5, 6], slots: ["11:00", "14:00"], slotMinutes: 60, capacity: 1 }) })
      : await api(ownerPage, "/api/products", "POST", { businessId: fixture.id, name: itemName, basePriceKES: price, quantity: 50, isActive: true });
    fixture.itemId = category === "salon" ? item.body?.service?.id : item.body?.product?.id;
    check(`${category}: actual tenant catalogue write`, item.status === 201 && Boolean(fixture.itemId));
    const seeded = await api(ownerPage, "/api/experience", "POST", { businessId: fixture.id, categoryKey: category });
    check(`${category}: safe structured creation through HTTP (201)`, seeded.status === 201 && seeded.body?.document?.version === 2 && Boolean(seeded.body.document.artDirection), `status=${seeded.status}, format=${seeded.body?.document?.version ?? "missing"}`);
    await patch(ownerPage, fixture, { brand: { heroImageUrl: `${origin}/dev/motion-asset.svg`, tagline: `QA first ${category} ${runId}` },
      document: { ...seeded.body.document, renderPreference: "lite", brand: { ...seeded.body.document.brand, heroImageUrl: `${origin}/dev/motion-asset.svg`, tagline: `QA first ${category} ${runId}` } } });
    const before = await snapshot(fixture.id);
    check(`${category}: draft not automatically published`, before.publishedJson === null && before.status === "DRAFT");
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
    const edited = await snapshot(fixture.id);
    check(`${category}: saved UI content and draft revision persist`, JSON.parse(edited.draftJson).brand.description === description && edited.draftVersion > before.draftVersion);
    const stale = await api(ownerPage, "/api/experience", "PATCH", { businessId: fixture.id, expectedDraftVersion: before.draftVersion, brand: { tagline: "STALE MUST NEVER WIN" } });
    check(`${category}: stale edit refused without overwrite`, stale.status === 409 && stale.body.code === "draft_version_conflict" && (await snapshot(fixture.id)).draftJson === edited.draftJson);
    await preview(ownerPage, fixture, `QA first ${category} ${runId}`);
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
    signatures.push(await visitor.evaluate(() => ({
      hero: document.querySelector(".eb-hero")?.className, body: document.querySelector(".eb-family-body")?.getAttribute("data-composition"),
      catalogue: document.querySelector("[data-catalogue-layout]")?.getAttribute("data-catalogue-layout"),
      headings: [...document.querySelectorAll("main h2")].map((heading) => heading.textContent),
    })));
    const noJS = await pageFor(visitorContext);
    await noJS.setViewport({ width: 360, height: 740 }); await noJS.setJavaScriptEnabled(false);
    await noJS.goto(`${origin}/b/${fixture.slug}/item/${fixture.itemId}`, { waitUntil: "networkidle0" });
    const staticPage = await noJS.evaluate(() => ({ text: document.querySelector("main")?.textContent,
      contact: Boolean(document.querySelector('a[href^="tel:"]')),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 }));
    check(`${category}: no-JS mobile real catalogue/contact HTML`, staticPage.text?.includes(itemName) && staticPage.contact && !staticPage.overflow);
    await noJS.close();
    const links = await visitor.evaluate(() => [...document.querySelectorAll("a")].map((link) => link.getAttribute("href")));
    check(`${category}: real tenant call/WhatsApp/directions paths`, links.some((link) => link?.startsWith("tel:")) && links.some((link) => link?.startsWith("https://wa.me/")) && links.some((link) => /maps|google.com/.test(link || "")));

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
    if (category !== "salon") {
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
    } else {
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
    fixture.ownerPage = ownerPage;
    Object.assign(created.at(-1), fixture);
  }

  const [first, second, salon] = created;
  const foreignBefore = await snapshot(second.id);
  for (const [path, method, body] of [
    [`/api/experience?businessId=${second.id}`, "GET"],
    ["/api/experience", "PATCH", { businessId: second.id, expectedDraftVersion: foreignBefore.draftVersion, brand: { tagline: "FOREIGN MUST NEVER WIN" } }],
    ["/api/experience/publish", "POST", { businessId: second.id, expectedDraftVersion: foreignBefore.draftVersion }],
    [`/api/experience/versions?businessId=${second.id}`, "GET"],
    [`/api/bookings?businessId=${salon.id}`, "GET"],
  ]) {
    const response = await api(first.ownerPage, path, method, body);
    check(`cross-tenant ${method} ${path.split("?")[0]} refused`, response.status === 403 && !response.body?.document && !response.body?.versions && !response.body?.bookings);
  }
  check("cross-tenant attempts do not mutate foreign draft/live", JSON.stringify(await snapshot(second.id)) === JSON.stringify(foreignBefore));
  await first.ownerPage.goto(`${origin}/dashboard/businesses/${second.id}/design`, { waitUntil: "networkidle0" });
  const foreignPage = await first.ownerPage.evaluate(() => ({ text: document.body.textContent,
    design: Boolean(document.querySelector('input[type="color"]')), noindex: document.querySelector('meta[name="robots"]')?.content.includes("noindex") }));
  check("foreign owner workspace is not-found/noindex and does not leak its design", foreignPage.noindex && foreignPage.text.includes("could not be found") && !foreignPage.text.includes(second.itemName) && !foreignPage.design);
  await publicState(first.ownerPage, second, `QA unpublished ${second.category} ${runId}`, false, "?preview=draft");
  check("representative business types have distinct rendered information architectures (not palette/family labels)", new Set(signatures.map((entry) => JSON.stringify(entry))).size === 3);

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
  check("no original uploads/media writes introduced", await prisma.mediaAsset.count({ where: { businessId: { in: created.map((item) => item.id) } } }) === 0);
  check("no external/provider/disallowed browser requests", denied.length === 0);
  check("no uncaught browser runtime errors", errors.length === 0);
  journeyComplete = true;
} catch (error) {
  if (!results.at(-1) || results.at(-1).ok) results.push({ name: "journey execution", ok: false, detail: String(error.message).slice(0, 250) });
  console.error(`FAIL authenticated journey: ${error.message}`);
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
  writeFileSync(".cache/verification/studio-authenticated/results.json", JSON.stringify({ results, denied, errors, signatures,
    journeyComplete, remainingScenarios: journeyComplete ? "All defined provider-free scenarios executed" : "NOT RUN: fail-fast remainder", journeyStatus: journeyComplete && results.every((item) => item.ok) ? "PASS" : "FAIL",
    providerPayment: "NOT RUN", persistentOriginals: "BLOCKED: owner DEFERRED", physicalAndroid: "NOT RUN", serverStopped: true }, null, 2));
}
const failed = results.filter((item) => !item.ok).length;
console.log(`${results.length - failed} passed, ${failed} failed, 0 skipped. Authenticated production-HTTP/browser/native-DB checks; synthetic entitlement, NOT provider payment/physical Android/full engine proof. Temporary server stopped.`);
if (!journeyComplete) console.log("NOT RUN: remaining required provider-free scenarios after first failure; passing attempted checks are not complete journey acceptance.");
process.exitCode = failed || !journeyComplete ? 1 : 0;
