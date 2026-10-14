#!/usr/bin/env node
/**
 * Replay-hydration cursor regression — deterministic, database-free (release report §M.12).
 *
 * WHAT THIS IS
 *
 * A focused regression test for the #418 mechanism M14 named from runtime stacks and §M.2 tied to
 * shipped code: when a host fiber that has already claimed a DOM node is *replayed* during
 * hydration, React 19.2 does not rewind the hydration cursor, so the replay claims the wrong node
 * and `throwOnHydrationMismatch` fires (React error #418, `args[]=HTML`). Upstream fixed it in
 * React 19.3.0 (react#35494 + react#35518); Next 15.5.x vendors 19.2.0-canary and will never
 * receive it, while Next 16.x vendors 19.3.
 *
 * It bundles `next/dist/compiled/react` + `next/dist/compiled/react-dom` — **the runtime this
 * application actually ships** — rather than the repository's `react@18.3.1`, which is what
 * `scripts/browser/hydration-race.check.mjs` necessarily uses (and why that harness can only show
 * the invariant, never this defect).
 *
 * THE FOUR CONDITIONS THIS TREE HAD TO GET RIGHT (all four are ordinary in a Flight/RSC app):
 *   1. The lazy is a **child node** (`{lazyChild}`), not `<Lazy />`. A lazy *node* is resolved by
 *      the parent's child reconciliation, so it suspends while the in-progress unit of work is the
 *      **parent host fiber** — which has already claimed its DOM node. As `<Lazy />` it gets its own
 *      fiber (tag 16) and the replay is harmless. This is why the first version of this file
 *      reproduced nothing (0/15).
 *   2. The thenable carries **`status`/`value`**. react-dom only takes the replay path when
 *      `isThenableResolved(thenable)` is true, and that reads `thenable.status`; a bare Promise never
 *      gets one, so it unwinds to the root instead and hydration stays clean.
 *   3. The thenable is fulfilled **inside the concurrent yield** — a microtask or `setTimeout(0)`,
 *      not 50 ms later (a late fulfilment unwinds cleanly).
 *   4. Hydration runs inside **`React.startTransition`**, as Next.js does, because
 *      `replaySuspendedUnitOfWork` only exists in the concurrent render path.
 *
 * MEASURED RESULT — READ THIS BEFORE TRUSTING THE SCRIPT (2026-10-14)
 *
 * As committed, this harness does NOT reproduce the defect, on either runtime, and therefore says
 * **nothing** about whether the runtime has the bug:
 *
 *   vendored React 19.2.0-canary-0bdb9206 (what the app shipped before the Next 16 upgrade)
 *                                                microtask/timeout-0: 0/5 mismatches
 *     …and it discards the server DOM in those arms, i.e. React takes the "unwind to the root" path
 *   released react 19.2.8 + react-dom 19.2.8                    microtask/timeout-0: 0/3 mismatches,
 *   (the version the upstream reference repro reports as 20/20) no discard at all
 *
 * That the released 19.2.8 pair — which the reference repro measures at 20/20 — reproduces nothing
 * here is the decisive control: the remaining difference is in **this file**, not in the runtime.
 * The reference tree was ported by hand from its README; the most likely missing ingredients are
 * (a) it serves the document through `renderToPipeableStream` rather than `renderToStaticMarkup`,
 * so the served HTML carries the streaming/Flight boundary machinery React's hydration expects, and
 * (b) its `src/App.jsx` `pendingChunk` helper, which this file approximates. The next attempt should
 * port `src/App.jsx`, `src/server.jsx` and `src/client.jsx` from
 * github.com/dreamerhyde/react-hydration-replay-repro verbatim instead of reconstructing them.
 *
 * Until that reproduces, treat this file as a diagnostic scaffold, NOT as evidence for or against
 * any runtime, and do not wire it into CI — it would pass trivially and imply coverage it lacks.
 * Note after the Next 16 upgrade: the vendored runtime now *has* the fix, so this harness could not
 * distinguish fixed from unfixed even if it did reproduce. It is kept only as the starting point for
 * the verbatim re-port described above (a faithful port would fail on 19.2 and pass on 19.3).
 *
 * WHAT IT IS NOT
 *
 * It is not proof that the authenticated journey is fixed: closing that gate still requires CI's
 * authenticated browser step. What it provides is the acceptance evidence the owner decision needs —
 * a deterministic test that reproduces the defect on the current runtime and must pass on a fixed
 * one, so Option A (Next 16) or Option B (backport) can be verified rather than hoped for.
 *
 * Usage:
 *   CHROME_PATH=... node scripts/browser/hydration-replay.check.mjs            # diagnostic, exit 0
 *   REPLAY_ASSERT=clean CHROME_PATH=... node scripts/browser/hydration-replay.check.mjs   # gate
 * Gate mode exits 1 when any arm that is expected to reproduce still reproduces.
 */
import puppeteer from "puppeteer-core";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);

if (!process.env.CHROME_PATH || !existsSync(process.env.CHROME_PATH)) {
  console.error("BLOCKED / NOT RUN: Chrome missing; no replay-hydration evidence claimed.");
  process.exit(2);
}

const ASSERT_CLEAN = process.env.REPLAY_ASSERT === "clean";

/**
 * Runtime under test. By default this is the build the application actually ships. Since the
 * Next.js 16 upgrade (report §N) that is Next 16.4.0, whose `next/dist/compiled/react` is
 * React 19.3.0-canary-278794d7-20261002 — the runtime that *contains* the replay-cursor fix — not
 * the repository's `react@18.3.1`. Before the upgrade it was 19.2.0-canary-0bdb9206-20250818, which
 * does not. Set REPLAY_REACT_DIR to a directory containing another react/react-dom pair (for
 * example the released 19.2.8 the upstream reference repro uses, or the released 19.3.0) to run the
 * identical tree against it — which is how the report separates "our tree is wrong" from "this
 * runtime build behaves differently".
 */
const EXTERNAL_REACT_DIR = process.env.REPLAY_REACT_DIR || null;
const VENDORED_REACT = EXTERNAL_REACT_DIR ? "react" : "next/dist/compiled/react/index.js";
const VENDORED_REACT_DOM_CLIENT = EXTERNAL_REACT_DIR ? "react-dom/client" : "next/dist/compiled/react-dom/client.js";
const VENDORED_REACT_DOM_SERVER = EXTERNAL_REACT_DIR ? "react-dom/server" : "next/dist/compiled/react-dom/server.node.js";

const externalRequire = EXTERNAL_REACT_DIR
  ? createRequire(`${EXTERNAL_REACT_DIR.replace(/\/$/, "")}/package.json`)
  : null;
const loadFrom = (id) => (externalRequire ? externalRequire(id) : require(id));

const vendored = () => ({
  react: loadFrom(VENDORED_REACT),
  server: loadFrom(VENDORED_REACT_DOM_SERVER),
  version: loadFrom(VENDORED_REACT).version,
});

function serverMarkup() {
  const { react: React, server, version } = vendored();
  const h = React.createElement;
  // The server renders the resolved content: the chunk is fulfilled before the response is
  // flushed, so the HTML carries the child and is identical on every request.
  const tree = h(
    "div",
    { id: "outer" },
    h("p", { id: "before" }, "before"),
    h("div", { id: "target" }, h("section", { id: "child" }, "lazy child")),
    h("p", { id: "after" }, "after"),
  );
  return { html: server.renderToStaticMarkup(tree), version };
}

const ENTRY = `
import * as React from "${VENDORED_REACT}";
import { hydrateRoot } from "${VENDORED_REACT_DOM_CLIENT}";

// A thenable in React's own status/value protocol (condition 2). Flight chunks look like this:
// pending first, fulfilled a moment later, and carrying .status so react-dom can tell a
// resolved-but-not-yet-replayed chunk from a bare promise.
//
// CRITICAL: the fulfilment is scheduled from the lazy initialiser — i.e. one microtask/task after
// React first *asks* for the module — not from the harness before hydration starts. Scheduling it
// outside can resolve the chunk before React's first render, in which case the lazy never suspends,
// no replay happens, and the arm stays clean for the wrong reason (that mistake produced 0/15 on
// the first attempt at this file).
function makeChunk(value, mode) {
  const callbacks = [];
  const thenable = {
    status: "pending",
    value: undefined,
    then(onFulfilled) { callbacks.push(onFulfilled); return thenable; },
  };
  const fulfil = function () {
    if (thenable.status === "fulfilled") return;
    thenable.status = "fulfilled";
    thenable.value = value;
    for (const cb of callbacks) cb(value);
  };
  if (mode === "resolved-before") fulfil();
  else if (mode === "microtask") queueMicrotask(fulfil);
  else if (mode === "timeout-0") setTimeout(fulfil, 0);
  else if (mode === "late-50ms") setTimeout(fulfil, 50);
  else fulfil();
  return thenable;
}

window.__replayArms = {};

window.__replayArms.run = function run(mode) {
  const errors = [];
  const lazyChild = React.lazy(function () {                       // condition 1: used as a child node
    return makeChunk({ default: React.createElement("section", { id: "child" }, "lazy child") }, mode);
  });

  const h = React.createElement;
  // Same tree the server rendered; #container is the hydration root and is not part of it.
  const tree = h("div", { id: "outer" },
    h("p", { id: "before" }, "before"),
    h("div", { id: "target" }, lazyChild),
    h("p", { id: "after" }, "after"));

  // Mark the server DOM so we can tell, independently of any error string, whether React kept it
  // or threw it away and re-created the tree on the client.
  let mark = 0;
  document.querySelectorAll("#outer, #before, #target, #child, #after").forEach(function (el) {
    el.__serverRendered = true; mark += 1;
  });

  const onRecoverableError = function (error) {
    errors.push(String((error && error.message) || error).slice(0, 240));
  };

  // condition 4: Next hydrates inside startTransition, which puts the initial render on a
  // time-sliced lane — the only lane that has replaySuspendedUnitOfWork.
  React.startTransition(function () {
    hydrateRoot(document.getElementById("container"), tree, { onRecoverableError });
  });

  return { mark: mark, errors: errors };
};

window.__replayArms.snapshot = function snapshot() {
  const kept = [];
  document.querySelectorAll("#outer, #before, #target, #child, #after").forEach(function (el) {
    if (el.__serverRendered) kept.push(el.id);
  });
  return {
    serverNodesKept: kept,
    // The bug discards the server DOM at the root (no Suspense boundary above the lazy).
    serverDomDiscarded: !kept.includes("child") || !kept.includes("target"),
    targetHtml: document.getElementById("target") ? document.getElementById("target").outerHTML.slice(0, 160) : null,
    childText: document.getElementById("child") ? document.getElementById("child").textContent : null,
  };
};
`;

async function buildBundle() {
  // esbuild ships inside tsx, which the repository already depends on — the same route
  // hydration-race.check.mjs uses. Nothing new is installed.
  const { build } = require(createRequire(require.resolve("tsx")).resolve("esbuild"));
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "js", contents: ENTRY },
    bundle: true, write: false, platform: "browser", format: "iife",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
    ...(EXTERNAL_REACT_DIR ? { nodePaths: [`${EXTERNAL_REACT_DIR.replace(/\/$/, "")}/node_modules`] } : {}),
  });
  return compiled.outputFiles[0].text;
}

const { html, version } = serverMarkup();
const serverHtml = `<!DOCTYPE html><html><head><title>replay</title></head><body><div id="container">${html}</div></body></html>`;
const bundleSource = await buildBundle();
console.log(`runtime under test: react ${version}${EXTERNAL_REACT_DIR ? ` (from ${EXTERNAL_REACT_DIR})` : " (bundled from next/dist/compiled)"}`);
console.log(`harness bundle: ${bundleSource.length} bytes`);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH, headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

// Arms that are expected to reproduce (the fulfilment lands inside the concurrent yield), and the
// controls that must stay clean for the harness to mean anything.
const REPRODUCING_ARMS = ["microtask", "timeout-0"];
const CONTROL_ARMS = ["resolved-before", "late-50ms"];
const ITERATIONS = Number(process.env.REPLAY_ITERATIONS || 5);
const results = [];

try {
  for (const mode of [...REPRODUCING_ARMS, ...CONTROL_ARMS]) {
    let mismatched = 0;
    let discarded = 0;
    let sample = null;
    for (let i = 0; i < ITERATIONS; i += 1) {
      const page = await browser.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(String(error.message).slice(0, 240)));
      await page.setContent(serverHtml, { waitUntil: "domcontentloaded" });
      await page.addScriptTag({ content: bundleSource });
      const outcome = await page.evaluate((m) => window.__replayArms.run(m), mode);
      await new Promise((resolve) => setTimeout(resolve, 350));
      const snapshot = await page.evaluate(() => window.__replayArms.snapshot());
      const all = [...outcome.errors, ...pageErrors];
      const mismatch = all.filter((message) =>
        /#418|#423|#419|Hydration failed|did not match|server rendered HTML|Minified React error/i.test(String(message)));
      if (mismatch.length) mismatched += 1;
      if (snapshot.serverDomDiscarded) discarded += 1;
      if (mismatch.length && !sample) sample = { error: mismatch[0], snapshot };
      await page.close();
    }
    results.push({ mode, iterations: ITERATIONS, mismatched, discarded, expected: REPRODUCING_ARMS.includes(mode) ? "reproduce" : "clean", sample });
    console.log(
      `${mode.padEnd(15)} hydration mismatches ${mismatched}/${ITERATIONS}   server DOM discarded ${discarded}/${ITERATIONS}` +
        (sample ? `\n                first: ${String(sample.error).slice(0, 140)}` : ""),
    );
  }
} finally {
  await browser.close();
}

const reproducing = results.filter((r) => r.expected === "reproduce");
const controls = results.filter((r) => r.expected === "clean");
const reproducedTotal = reproducing.reduce((sum, r) => sum + r.mismatched, 0);
const controlClean = controls.every((r) => r.mismatched === 0);

console.log(`\nREPLAY HYDRATION: ${reproducedTotal} mismatch(es) in the ${REPRODUCING_ARMS.join("/")} arms; controls (${CONTROL_ARMS.join("/")}) ${controlClean ? "clean" : "NOT clean"}.`);
console.log(JSON.stringify({ runtime: version, external: EXTERNAL_REACT_DIR, results }, null, 1));

if (ASSERT_CLEAN) {
  if (!controlClean) {
    console.error("\nBLOCKED: a control arm misbehaved, so this run cannot judge the runtime. Investigate the harness before reading the result.");
    process.exit(2);
  }
  if (reproducedTotal > 0) {
    console.error(`\nFAIL: the vendored React (${version}) still replays a host fiber without rewinding the hydration cursor — ${reproducedTotal} reproducing load(s). This is the #418 mechanism; it is fixed in React 19.3.0 (react#35494 + react#35518), which Next 16.x vendors.`);
    process.exit(1);
  }
  console.log(`\nPASS: no reproducing arm mismatched and both controls stayed clean on ${version}.`);
}
