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

// Synthetic mechanism arm (M11 Stage D): reproduces the observed failure shape directly —
// React 19's document-level hydration expects Next's bare <div hidden> state slot as the
// first body host child; the failing documents parsed leading <script> chunks before it.
// Arm S hydrates the same tree over body DOM with leading scripts; arm C omits them.
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
  // The runner that hosts this job has just finished a full database journey and eight browser
  // suites; a first-paint stall is infrastructure, not a hydration finding. Neither of these
  // timeouts is an assertion — the verdict below is still driven only by reproduced #418 counts.
  const NAV_TIMEOUT_MS = Number(process.env.HYDRATION_RACE_NAV_TIMEOUT_MS || 60000);
  const summary = { synthetic: { arms: [] }, forced: { iterations: 0, errors418: 0, otherErrors: 0, details: [] }, control: { iterations: 0, errors418: 0, otherErrors: 0, details: [] } };

  try {
    // Synthetic mechanism arms (M11 Stage D): the observed failure shape is React expecting
    // Next's bare <div hidden> state slot as a body host child while the parsed DOM carries
    // leading <script> chunks before it (stream flush order), or while the parse frontier has
    // not reached the node yet (hydration racing the stream). Each arm hydrates the same tree;
    // only the body DOM differs. Recovery errors are collected via onRecoverableError + pageerror.
    const { build } = require(createRequire(require.resolve("tsx")).resolve("esbuild"));
    const compiled = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `
          import React from "react";
          import { hydrateRoot } from "react-dom/client";
          window.hydrationErrors = [];
          window.fixtureHydrated = false;
          const tree = React.createElement(React.Fragment, null,
            React.createElement("div", { hidden: true }),
            React.createElement("div", { className: "business-route-root" },
              React.createElement("main", { id: "main" }, React.createElement("p", null, "hello"))));
          hydrateRoot(document.body, tree, { onRecoverableError(error) { window.hydrationErrors.push(String(error.message).slice(0, 160)); } });
          requestAnimationFrame(() => requestAnimationFrame(() => { window.fixtureHydrated = true; }));
        `,
      },
      bundle: true, write: false, platform: "browser", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const bundleSource = compiled.outputFiles[0].text;
    const arms = [
      ["synthetic-leading-scripts", `<script>void 0</script><script>void 0</script><div hidden></div><div class="business-route-root"><main id="main"><p>hello</p></main></div>`],
      ["synthetic-parse-frontier", `<div hidden></div>`],
      ["synthetic-control", `<div hidden></div><div class="business-route-root"><main id="main"><p>hello</p></main></div>`],
    ];
    for (const [label, bodyHtml] of arms) {
      const page = await browser.newPage();
      const errors = collectErrors(page);
      // A `setContent` document has no subresources, so waiting for "networkidle0" only adds a
      // failure mode (a loaded host makes the idle window expire) without adding evidence.
      await page.setContent(`<!DOCTYPE html><html><head><title>s</title></head><body>${bodyHtml}</body></html>`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      await page.addScriptTag({ content: bundleSource, timeout: NAV_TIMEOUT_MS });
      await page.waitForFunction(() => window.fixtureHydrated === true, { timeout: 10000 }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 400));
      const recovered = await page.evaluate(() => window.hydrationErrors || []);
      const count418 = [...recovered, ...errors].filter((message) => /error #418/.test(String(message))).length;
      summary.synthetic.arms.push({ arm: label, errors418: count418, recovered: recovered.slice(0, 2), uncaught: errors.slice(0, 2) });
      await page.close();
    }
    for (const arm of ["forced", "control"]) {
      const iterations = arm === "forced" ? FORCED_ITERATIONS : CONTROL_ITERATIONS;
      for (let i = 0; i < iterations; i += 1) {
        const page = await browser.newPage();
        const errors = collectErrors(page);
        if (arm === "forced") await page.evaluateOnNewDocument(delayHook);
        for (const path of PATHS) {
          try {
            await page.goto(`${origin}${path}`, { waitUntil: "networkidle0", timeout: NAV_TIMEOUT_MS });
            await new Promise((resolve) => setTimeout(resolve, 1200)); // cover the deferred swap window
          } catch (error) {
            summary[arm].navigationFailures = (summary[arm].navigationFailures || 0) + 1;
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

  if ((summary.forced.navigationFailures || 0) > 0 || (summary.control.navigationFailures || 0) > 0) {
    // A load that never completed produced no sample. That is missing evidence, and missing
    // evidence must never read as a clean run.
    console.error(`BLOCKED / NOT RUN: ${summary.forced.navigationFailures || 0} forced / ${summary.control.navigationFailures || 0} control page loads did not complete; no clean-run claim.`);
    process.exit(2);
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
