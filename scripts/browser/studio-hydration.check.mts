#!/usr/bin/env node
/** Isolated real-component SSR/hydration regression; no app fixture route, database, auth or provider proof. */
import React from "react";
import { renderToString } from "react-dom/server";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { BookingClient } from "../../components/storefront/BookingClient";
import { bookingCalendar } from "../../lib/experience/bookingCalendar";

const chrome = process.env.CHROME_PATH;
if (!chrome || !existsSync(chrome)) {
  console.error("BLOCKED / NOT RUN: Chrome missing; no hydration acceptance claimed.");
  process.exit(2);
}
// Use the compiler shipped with the declared/pinned tsx tool, not a new runtime dependency.
const require = createRequire(import.meta.url);
const { build } = require(createRequire(require.resolve("tsx")).resolve("esbuild"));
// tsx's standalone JSX transform and Next's automatic JSX both render the same component.
(globalThis as unknown as { React: typeof React }).React = React;
const realDate = Date;
const originalTZ = process.env.TZ;
const stamp = "2026-10-12T06:24:00Z";
const results: { name: string; ok: boolean }[] = [];
function check(name: string, ok: boolean) {
  results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) throw new Error(name);
}
function serverHtml(time: string) {
  const props = {
    slug: "qa-salon", businessId: "qa-owned", calendar: bookingCalendar(new realDate(time)),
    bookables: [{ id: "qa-service", name: "Owned service", kind: "service" as const, durationMinutes: 60,
      depositKES: 0, price: 1200, pricingType: "FIXED", imageUrl: null, description: null }],
    preselectedId: "qa-service", ctaLabel: "Book now", confirmationLabel: "Booking requested", requireDate: true,
  };
  const instant = realDate.parse(time);
  globalThis.Date = new Proxy(realDate, {
    construct(target, args) { return Reflect.construct(target, args.length ? args : [instant]); },
    get(target, key) { return key === "now" ? () => instant : Reflect.get(target, key); },
  });
  process.env.TZ = "UTC";
  try { return { props, html: renderToString(React.createElement(BookingClient, props)) }; }
  finally { globalThis.Date = realDate; }
}
async function clientBundle(props: ReturnType<typeof serverHtml>["props"], time: string) {
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react'; import {hydrateRoot} from 'react-dom/client';
      import {BookingClient} from './components/storefront/BookingClient';
      const D=Date, instant=D.parse(${JSON.stringify(time)});
      globalThis.Date=new Proxy(D,{construct(t,a){return Reflect.construct(t,a.length?a:[instant])},get(t,k){return k==='now'?()=>instant:Reflect.get(t,k)}});
      window.hydrationErrors=[];
      hydrateRoot(document.querySelector('#root'),React.createElement(BookingClient,${JSON.stringify(props)}),
        {onRecoverableError(error){window.hydrationErrors.push(error.message)}});
      requestAnimationFrame(()=>requestAnimationFrame(()=>{window.fixtureHydrated=true}));
    ` },
    plugins: [{ name: "isolated-link-adapter", setup(builder: { onResolve: Function; onLoad: Function }) {
      // Only Next navigation is adapted to <a> in this isolated component fixture; native CI tests real Next.
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ resolveDir: process.cwd(), loader: "js",
        contents: 'import React from "react";export default function Link({href,children,...props}){return React.createElement("a",{...props,href},children)}' }));
    } }],
    bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  });
  return compiled.outputFiles[0].text;
}

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
let complete = false;
try {
  console.log(`Actual browser: ${await browser.version()}; isolated actual BookingClient SSR/hydration, Link adapter only. NOT native DB/device/provider proof.`);
  const scenarios = [
    { name: "UTC", zone: "UTC", server: stamp, client: stamp },
    { name: "Nairobi", zone: "Africa/Nairobi", server: stamp, client: stamp },
    { name: "Kathmandu", zone: "Asia/Kathmandu", server: stamp, client: stamp },
    { name: "New York", zone: "America/New_York", server: stamp, client: stamp },
    { name: "Auckland", zone: "Pacific/Auckland", server: stamp, client: stamp },
    { name: "midnight rollover", zone: "UTC", server: "2026-10-12T23:59:59Z", client: "2026-10-13T00:00:01Z" },
  ];
  for (const scenario of scenarios) {
    const { props, html } = serverHtml(scenario.server);
    const page = await browser.newPage();
    const runtime: string[] = [];
    page.on("pageerror", (error) => runtime.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", (request) => void request.abort()); // no app/provider calls; unselected SSR has no API fetch
    await page.emulateTimezone(scenario.zone);
    await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
    await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root">${html}</div>`);
    const before = await page.$$eval("fieldset:first-of-type button", (buttons) => buttons.map((button) => button.textContent));
    check(`${scenario.name}: crawlable SSR date choices`, before.length === 10 && before[0] === props.calendar[0].label);
    await page.addScriptTag({ content: await clientBundle(props, scenario.client) });
    await page.waitForFunction(() => (window as unknown as { fixtureHydrated: boolean }).fixtureHydrated);
    const errors = await page.evaluate(() => (window as unknown as { hydrationErrors: string[] }).hydrationErrors);
    check(`${scenario.name}: zero recoverable/uncaught hydration errors`, errors.length === 0 && runtime.length === 0);
    const after = await page.$$eval("fieldset:first-of-type button", (buttons) => buttons.map((button) => button.textContent));
    check(`${scenario.name}: identical server/client calendar`, JSON.stringify(after) === JSON.stringify(before));
    await page.click("fieldset:first-of-type button:nth-child(2)");
    await page.waitForFunction(() => document.querySelector('fieldset button[aria-pressed="true"]'));
    check(`${scenario.name}: real accessible selection/form retained`, await page.$eval('fieldset button[aria-pressed="true"]', (button) => button.textContent) === props.calendar[1].label && Boolean(await page.$("#bk-name")) && Boolean(await page.$("#bk-phone")));
    await page.close();
  }
  // A genuine mismatching fixture must still be detected; this never filters application errors.
  const { props, html } = serverHtml(stamp);
  const negative = await browser.newPage();
  await negative.emulateTimezone("UTC");
  await negative.setContent(`<div id="root">${html.replace(props.calendar[0].label, "WRONG SERVER DATE")}</div>`);
  await negative.addScriptTag({ content: await clientBundle(props, stamp) });
  await negative.waitForFunction(() => (window as unknown as { fixtureHydrated: boolean }).fixtureHydrated);
  check("negative control: real mismatch detector fails closed", (await negative.evaluate(() => (window as unknown as { hydrationErrors: string[] }).hydrationErrors)).length > 0);
  await negative.close(); complete = true;
} catch (error) {
  console.error(`FAIL hydration regression: ${String(error)}`);
  if (results.every((result) => result.ok)) results.push({ name: "execution", ok: false });
} finally {
  await browser.close(); globalThis.Date = realDate;
  if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ;
  mkdirSync(".cache/verification/studio-hydration", { recursive: true });
  writeFileSync(".cache/verification/studio-hydration/results.json", JSON.stringify({ complete, results, qualification: "Isolated component, not native/auth/device/provider proof" }, null, 2));
}
const failed = results.filter((result) => !result.ok).length;
console.log(`${results.length - failed} passed, ${failed} failed, 0 skipped. Actual isolated SSR/hydration; native/device/provider acceptance separate.`);
process.exitCode = failed || !complete ? 1 : 0;
