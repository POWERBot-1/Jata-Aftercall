#!/usr/bin/env node
/**
 * Build a browsable gallery from an ERP visual-capture run (blocker E4, owner review).
 *
 * The capture script writes 24 JPEGs plus `evidence.json`. A zip of those files is correct but
 * awkward to review: the owner has to download, unzip and match filenames by eye. This turns the
 * same files into one page — every viewport, every screen, with the measured numbers printed beside
 * the image so a reader never has to trust a separate table.
 *
 * It reads only what the capture wrote. It does not invent a result, and it fails loudly if the
 * evidence is missing rather than rendering an empty page that looks like a pass.
 *
 * Usage:
 *   SHOT_DIR=.cache/verification/erp-visual node scripts/erp/erp-visual-gallery.mjs
 * Exit codes: 0 = gallery written, 1 = evidence missing or unreadable.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SHOT_DIR = process.env.SHOT_DIR || ".cache/verification/erp-visual";
const evidencePath = path.join(SHOT_DIR, "evidence.json");

function fail(message) {
  console.error(`FAIL  ${message}`);
  process.exit(1);
}

if (!existsSync(evidencePath)) fail(`no evidence.json in ${SHOT_DIR} — run \`npm run test:erp:visual\` first`);

let evidence;
try {
  evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
} catch (error) {
  fail(`evidence.json is not readable JSON: ${String(error?.message ?? error)}`);
}

const results = Array.isArray(evidence.results) ? evidence.results : [];
if (results.length === 0) fail("evidence.json has no results");

// `name` is "<viewport> <route> renders without overflow"; parse rather than trust a second field.
const parsed = results.map((entry) => {
  const match = /^(\d+x\d+) (\S+) /.exec(String(entry.name ?? ""));
  const detail = String(entry.detail ?? "");
  const field = (label) => {
    const found = new RegExp(`${label}=([^,]+)`).exec(detail);
    return found ? found[1].trim() : "";
  };
  return {
    ok: entry.ok === true,
    viewport: match ? match[1] : "unknown",
    route: match ? match[2] : "unknown",
    detail,
    status: /HTTP (\d{3})/.exec(detail)?.[1] ?? "",
    overflow: field("overflow"),
    main: field("main"),
    heading: /heading="([^"]*)"/.exec(detail)?.[1] ?? "",
  };
});

const viewports = [...new Set(parsed.map((entry) => entry.viewport))].sort(
  (a, b) => Number(a.split("x")[0]) - Number(b.split("x")[0]),
);
const routes = [...new Set(parsed.map((entry) => entry.route))];
const failures = parsed.filter((entry) => !entry.ok);
const passCount = parsed.length - failures.length;

const escape = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const cards = viewports
  .map((viewport) => {
    const inViewport = routes
      .map((route) => parsed.find((entry) => entry.viewport === viewport && entry.route === route))
      .filter(Boolean);
    const rows = inViewport
      .map((entry) => {
        const file = `${entry.viewport}__${entry.route}.jpg`;
        const badge = entry.ok ? "PASS" : "FAIL";
        return `
        <figure class="shot ${entry.ok ? "ok" : "bad"}">
          <figcaption>
            <strong>${escape(entry.route)}</strong>
            <span class="badge">${badge}</span>
            <span class="meta">HTTP ${escape(entry.status)} · overflow ${escape(entry.overflow)} · main ${escape(entry.main)}</span>
            <span class="heading">${escape(entry.heading)}</span>
          </figcaption>
          <a href="${escape(file)}" target="_blank" rel="noreferrer">
            <img loading="lazy" src="${escape(file)}" alt="${escape(`${entry.route} at ${entry.viewport}`)}">
          </a>
        </figure>`;
      })
      .join("\n");
    return `
      <section>
        <h2>${escape(viewport)}</h2>
        <div class="grid" style="--cols:${Math.min(4, Math.max(1, inViewport.length))}">
          ${rows}
        </div>
      </section>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>POS / ERP - PRO — E4 screen review</title>
<style>
  :root { color-scheme: light dark; --ink:#2b1d12; --paper:#f6efe3; --line:#d9c9ae; --ok:#2f6b3a; --bad:#8f2f22; }
  body { margin:0; padding:32px; background:var(--paper); color:var(--ink); font:15px/1.5 ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:16px; margin:32px 0 8px; text-transform:uppercase; letter-spacing:.08em; }
  .summary { border:1px solid var(--line); border-radius:12px; padding:16px 20px; background:#fff8; max-width:900px; }
  .summary dl { display:grid; grid-template-columns:max-content 1fr; gap:4px 16px; margin:8px 0 0; }
  dt { opacity:.7; } dd { margin:0; font-variant-numeric:tabular-nums; }
  .grid { display:grid; gap:20px; grid-template-columns:repeat(var(--cols), minmax(0,1fr)); align-items:start; }
  @media (max-width:1200px) { .grid { grid-template-columns:repeat(2, minmax(0,1fr)); } }
  @media (max-width:700px) { .grid { grid-template-columns:1fr; } }
  figure { margin:0; border:1px solid var(--line); border-radius:12px; overflow:hidden; background:#fff; }
  figure.bad { border-color:var(--bad); }
  figcaption { display:flex; flex-wrap:wrap; gap:6px 10px; align-items:baseline; padding:10px 12px; font-size:13px; }
  .badge { font-weight:700; color:#fff; background:var(--ok); border-radius:999px; padding:1px 8px; font-size:11px; }
  .bad .badge { background:var(--bad); }
  .meta, .heading { opacity:.75; }
  img { display:block; width:100%; height:auto; border-top:1px solid var(--line); }
  .note { max-width:900px; margin-top:12px; font-size:13px; opacity:.8; }
  ol { max-width:900px; }
</style>
</head>
<body>
  <h1>POS / ERP - PRO — screen review (E4)</h1>
  <p class="note">Generated from <code>${escape(evidencePath)}</code>. Images are the captures this run
  wrote; the numbers beside each one are that capture's own measurements, not a summary table.</p>

  <div class="summary">
    <dl>
      <dt>Captured</dt><dd>${escape(evidence.generatedAt ?? "unknown")}</dd>
      <dt>Browser</dt><dd>${escape(evidence.chrome ?? "unknown")}</dd>
      <dt>Prisma engine</dt><dd>${escape(evidence.engine ?? "unknown")}</dd>
      <dt>Viewports</dt><dd>${escape(viewports.join(", "))}</dd>
      <dt>Screens</dt><dd>${escape(routes.join(", "))}</dd>
      <dt>Result</dt><dd><strong>${passCount}/${parsed.length} captures PASS</strong>${failures.length ? ` — ${failures.length} FAIL` : ""}</dd>
    </dl>
  </div>

  ${failures.length ? `<p class="note"><strong>${failures.length} capture(s) failed.</strong> They are marked FAIL below and are not a pass.</p>` : ""}

  ${cards}

  <h2>Open questions for the owner</h2>
  <p class="note">Recorded, not decided — see <code>docs/POS_ERP_PRO_E4_OWNER_REVIEW.md</code> for the options and recommendations.</p>
  <ol>
    <li>Tablet layout at 768–900px: the phone layout currently applies up to 900px.</li>
    <li>KPI cards below 900px: three KPI cards stack full width.</li>
    <li>Phone identity block at ≤430px: the header cluster wraps onto several rows.</li>
  </ol>
</body>
</html>`;

const outPath = path.join(SHOT_DIR, "gallery.html");
writeFileSync(outPath, html, "utf8");
console.log(`PASS  gallery written: ${outPath} (${passCount}/${parsed.length} captures PASS, ${viewports.length} viewports, ${routes.length} screens)`);
