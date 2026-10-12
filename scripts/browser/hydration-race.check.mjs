#!/usr/bin/env node
/**
 * Controlled reproduction for hydration #418 (M11 Stage C/D tooling; test-only).
 *
 * Mechanism under test: React 19 Fizz suspense boundaries are resolved by inline `$RC`/`$RV`
 * scripts — `$RC` flips the boundary comment `$?` → `$~` synchronously while the content swap
 * (`$RV`) is deferred to requestAnimationFrame/setTimeout. Hydration starting inside that gap
 * is supposed to wait on `_reactRetry`; this harness widens the gap on purpose so a real
 * hydration pass deterministically encounters the queued-but-unswapped boundary state.
 *
 * Only TIMING is manipulated (rAF/setTimeout deferred via evaluateOnNewDocument). No DOM is
 * mutated, no hydration check is disabled, no warning is suppressed. The page under test is
 * the real production `/login` document, which carries the same Next.js boundary pair
 * (`<!--$?--><template id="B:n"><!--/$-->` + `<div hidden id="S:n">`) as the storefront.
 *
 * Modes:
 * - default (diagnostic): report reproduction counts; exit 0 unless infrastructure fails.
 * - HYDRATION_RACE_ASSERT=clean (regression mode): exit 1 if the forced arm reproduces #418.
 */
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);

if (!process.env.CHROME_PATH || !existsSync(process.env.CHROME_PATH)) {
  console.error("BLOCKED / NOT RUN: Chrome missing; no hydration-race evidence claimed.");
  process.exit(2);
}
if (!existsSync(".next/BUILD_ID")) {
  console.error("BLOCKED / NOT RUN: production build missing.");
  process.exit(2);
}

const FORCED_ITERATIONS = Number(process.env.HYDRATION_RACE_ITERATIONS || 8);
const CONTROL_ITERATIONS = 3;
const GAP_EXTENSION_MS = 400;
const PATHS = ["/login"];

const delayHook = `(() => {
  try {
    var DELAY = ${GAP_EXTENSION_MS};
    var raf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : null;
    if (raf) window.requestAnimationFrame = function (cb) { return raf(function () { return setTimeout(cb, DELAY); }); };
    var st = window.setTimeout.bind(window);
    window.setTimeout = function (cb, ms) {
      var args = Array.prototype.slice.call(arguments, 2);
      var extra = (typeof ms !== "number" || ms < 1500) ? DELAY : 0;
      return st.apply(null, [cb, (ms || 0) + extra].concat(args));
    };
  } catch (e) { /* never break the page */ }
})();`;

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message).slice(0, 200)));
  return errors;
}

async function main() {
  const port = 4300 + Math.floor(Math.random() * 200);
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", "0.0.0.0", "-p", String(port)], {
    env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", PUBLIC_BASE_URL: origin, NEXTAUTH_URL: origin,
      VERCEL_ENV: "development", VERCEL_URL: "", VERCEL_PROJECT_PRODUCTION_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("server startup timeout")), 60000);
    const log = (data) => { serverLog = (serverLog + String(data)).slice(-4000); if (/Ready in/.test(serverLog)) { clearTimeout(timeout); resolve(); } };
    server.stdout.on("data", log);
    server.stderr.on("data", log);
    server.once("error", (error) => { clearTimeout(timeout); reject(error); });
    server.once("exit", () => { clearTimeout(timeout); reject(new Error("server exited")); });
  });

  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  const summary = { forced: { iterations: 0, errors418: 0, otherErrors: 0, details: [] }, control: { iterations: 0, errors418: 0, otherErrors: 0, details: [] } };

  try {
    for (const arm of ["forced", "control"]) {
      const iterations = arm === "forced" ? FORCED_ITERATIONS : CONTROL_ITERATIONS;
      for (let i = 0; i < iterations; i += 1) {
        const page = await browser.newPage();
        const errors = collectErrors(page);
        if (arm === "forced") await page.evaluateOnNewDocument(delayHook);
        for (const path of PATHS) {
          try {
            await page.goto(`${origin}${path}`, { waitUntil: "networkidle0", timeout: 30000 });
            await new Promise((resolve) => setTimeout(resolve, 1200)); // cover the deferred swap window
          } catch (error) {
            summary[arm].details.push({ i, path, navigation: String(error).slice(0, 100) });
          }
        }
        const count418 = errors.filter((message) => /error #418/.test(message)).length;
        summary[arm].iterations += 1;
        summary[arm].errors418 += count418;
        summary[arm].otherErrors += errors.length - count418;
        if (errors.length) summary[arm].details.push({ i, errors: errors.slice(0, 3) });
        await page.close();
      }
    }
    console.log(`HYDRATION RACE RESULT ${JSON.stringify(summary)}`);
  } finally {
    await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }

  const asserted = (process.env.HYDRATION_RACE_ASSERT || "").trim().toLowerCase();
  if (asserted === "clean" && summary.forced.errors418 > 0) {
    console.error("REGRESSION: hydration #418 reproduced under the widened $RC/$RV gap.");
    process.exit(1);
  }
  console.log("Hydration race harness complete. Diagnostic output only — no acceptance claimed.");
}

main().catch((error) => {
  console.error(`BLOCKED / NOT RUN: ${error.message}`);
  process.exit(2);
});
