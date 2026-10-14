#!/usr/bin/env node
/**
 * Delayed-chunk replay probe (diagnostic; test-only).
 *
 * Goal: turn the intermittent production #418 into a *local, database-free* reproduction so a fix
 * can be accepted on evidence instead of on a lucky CI run.
 *
 * Mechanism under test (release report §M.2): React re-runs ("replays") a host element when a
 * client chunk that hydration is waiting on resolves after the walk has already entered that
 * element. React 19.2 (which Next 15.5 vendors, up to and including 15.5.27) does not rewind the
 * hydration cursor when it replays, so the element then matches its own first child and every later
 * node is off by one — the walk meets a node of the wrong kind and throws #418, naming whatever
 * element comes next. Upstream fixed it in React 19.3.0 (react#35494 + react#35518).
 *
 * The probe deliberately manipulates nothing but network *timing*: client chunks are held back by a
 * configurable delay, which is what a slow network does naturally. No DOM is touched, no error is
 * filtered, and the real production `/login` document is used, so the check needs no database and
 * no authentication.
 *
 * Modes:
 *   default (diagnostic): sweep delays, report which ones reproduce, print the DOM outline at throw.
 *   REPLAY_ASSERT=clean   (regression mode): exit 1 if any configured delay reproduces. This is the
 *                         mode a fixed runtime (Next 16 / React 19.3) must pass, and which the
 *                         current runtime is expected to fail.
 */
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);

if (!process.env.CHROME_PATH || !existsSync(process.env.CHROME_PATH)) {
  console.error("BLOCKED / NOT RUN: Chrome missing; no replay evidence claimed.");
  process.exit(2);
}
if (!existsSync(".next/BUILD_ID")) {
  console.error("BLOCKED / NOT RUN: production build missing (.next/BUILD_ID). This probe needs `next build`.");
  process.exit(2);
}

const PATHS = (process.env.REPLAY_PATHS || "/login").split(",").map((s) => s.trim()).filter(Boolean);
const DELAYS = (process.env.REPLAY_DELAYS || "0,50,100,150,250,400").split(",").map((n) => Number(n.trim()));
const ITERATIONS = Number(process.env.REPLAY_ITERATIONS || 2);
const ASSERT_CLEAN = process.env.REPLAY_ASSERT === "clean";

const port = 4500 + Math.floor(Math.random() * 200);
const origin = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
  env: {
    ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    PUBLIC_BASE_URL: origin, NEXTAUTH_URL: origin,
    VERCEL_ENV: "development", VERCEL_URL: "", VERCEL_PROJECT_PRODUCTION_URL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("server startup timeout")), 60000);
  const log = (data) => { serverLog = (serverLog + String(data)).slice(-3000); if (/Ready in/.test(serverLog)) { clearTimeout(timeout); resolve(); } };
  server.stdout.on("data", log);
  server.stderr.on("data", log);
  server.once("error", (error) => { clearTimeout(timeout); reject(error); });
  server.once("exit", () => { clearTimeout(timeout); reject(new Error("server exited")); });
});

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH, headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

const findings = [];
try {
  for (const path of PATHS) {
    for (const delay of DELAYS) {
      let reproduced = 0;
      const samples = [];
      for (let i = 0; i < ITERATIONS; i += 1) {
        const page = await browser.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 220)));
        // Hold back only Next's JS chunks: HTML, CSS and any API call are untouched, so the server
        // render and the document itself are exactly what production serves.
        if (delay > 0) {
          await page.setRequestInterception(true);
          page.on("request", async (req) => {
            const url = req.url();
            if (/\/_next\/static\/chunks\//.test(url) || /\/_next\/static\/.*\.js/.test(url)) {
              await new Promise((r) => setTimeout(r, delay));
            }
            req.continue().catch(() => {});
          });
        }
        try {
          await page.goto(`${origin}${path}`, { waitUntil: "networkidle0", timeout: 45000 });
          await new Promise((r) => setTimeout(r, 1500));
        } catch { /* navigation timing is part of the experiment */ }
        const hydration = errors.filter((m) => /error #418|Hydration failed|did not match|Minified React error #419|#423/.test(m));
        if (hydration.length) {
          reproduced += 1;
          if (samples.length < 2) {
            samples.push(await page.evaluate(() => ({
              outline: (() => {
                const walk = (el, depth) => {
                  if (depth > 3 || !el) return "";
                  const name = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + (el.className && typeof el.className === "string" ? `.${el.className.split(" ").slice(0, 2).join(".")}` : "");
                  return ` ${name}(${[...el.children].slice(0, 4).map((c) => walk(c, depth + 1)).join("")})`;
                };
                return "body" + walk(document.body, 0);
              })().slice(0, 400),
              ready: document.readyState,
              bodyFirst: [...document.body.childNodes].slice(0, 3).map((n) => n.nodeName.toLowerCase() + (n.nodeType === 3 ? "#text" : "")).join(","),
              hydrationMessages: errors.slice(0, 2),
            })));
          }
        }
        await page.close();
      }
      findings.push({ path, delayMs: delay, iterations: ITERATIONS, reproduced, samples });
      console.log(`delay=${String(delay).padStart(4)}ms  path=${path}  reproduced ${reproduced}/${ITERATIONS}`);
    }
  }
} finally {
  await browser.close();
  server.kill("SIGTERM");
}

const total = findings.reduce((sum, f) => sum + f.reproduced, 0);
const clean = findings.reduce((sum, f) => sum + f.iterations, 0) - total;
console.log(`\nREPLAY PROBE: ${total} reproducing load(s), ${clean} clean load(s).`);
const firstHit = findings.find((f) => f.reproduced > 0);
if (firstHit) console.log("first reproducing sample:", JSON.stringify(firstHit.samples[0], null, 2));
console.log(JSON.stringify({ findings }, null, 1));

if (ASSERT_CLEAN && total > 0) {
  console.error(`\nFAIL: ${total} load(s) still reproduce a hydration mismatch under delayed chunk delivery.`);
  process.exit(1);
}
if (ASSERT_CLEAN) console.log("\nPASS: no delay reproduced a hydration mismatch.");
