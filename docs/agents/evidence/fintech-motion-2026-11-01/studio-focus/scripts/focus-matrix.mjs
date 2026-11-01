import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import fs from "node:fs";
const VP = [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]];
const OUT = "out/studio-focus/matrix"; fs.mkdirSync(OUT, { recursive: true });
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
const summary = [];
for (const vp of VP) {
  const tag = `${vp[0]}x${vp[1]}`;
  const p = await (await b.newContext({ viewport: { width: vp[0], height: vp[1] } })).newPage();
  await p.goto("http://localhost:3000/dev/studio-fixture?state=editor&outcome=success", { waitUntil: "load", timeout: 240000 });
  await p.waitForSelector("main", { timeout: 120000 });
  const stops = []; let shot = false; let enteredAt = -1, leftAt = -1;
  for (let i = 0; i < 70; i++) {
    await p.keyboard.press("Tab");
    const r = await p.evaluate(() => { const el = document.activeElement; const cs = el ? getComputedStyle(el) : null; return { tag: el?.tagName, outline: cs?.outlineStyle, wrap: !!document.querySelector(".jc-frame.is-focused"), label: (el?.getAttribute("aria-label") || el?.textContent || "").trim().slice(0, 30) }; });
    stops.push(r);
    if (r.tag === "IFRAME") { if (enteredAt < 0) enteredAt = i; if (!shot) { await p.waitForTimeout(150); await p.screenshot({ path: `${OUT}/iframe-focus-${tag}.png` }); shot = true; } }
    else if (enteredAt >= 0 && leftAt < 0) leftAt = i;
    if (leftAt >= 0 && i > leftAt + 2) break;
  }
  const frameStops = stops.filter(s => s.tag === "IFRAME");
  const row = { viewport: tag, reachedIframe: enteredAt >= 0, enteredAt, leftAt, iframeStops: frameStops.length, iframeStopsOutlined: frameStops.filter(s => s.outline !== "none").length, iframeStopsWrapFocused: frameStops.filter(s => s.wrap).length, otherStopsWithoutOutline: stops.filter(s => s.tag !== "IFRAME" && s.tag !== "BODY" && s.outline === "none").length, totalStops: stops.length };
  summary.push(row); console.log(JSON.stringify(row));
  await p.context().close();
}
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
await b.close();
console.log("DONE");
