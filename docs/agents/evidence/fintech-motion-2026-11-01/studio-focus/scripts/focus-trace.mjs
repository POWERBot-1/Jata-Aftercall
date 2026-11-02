import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import fs from "node:fs";
const VP = (process.env.VP || "390x844").split("x").map(Number);
const tag = VP.join("x");
const OUT = "out/studio-focus"; fs.mkdirSync(OUT, { recursive: true });
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
const p = await (await b.newContext({ viewport: { width: VP[0], height: VP[1] } })).newPage();
await p.goto("http://localhost:3000/dev/studio-fixture?state=editor&outcome=success", { waitUntil: "load", timeout: 240000 }); await p.waitForSelector(".jc-frame__iframe", { timeout: 120000 });
const rows = [];
for (let i = 0; i < 34; i++) {
  await p.keyboard.press("Tab");
  const r = await p.evaluate(() => {
    const el = document.activeElement;
    const frame = document.querySelector(".jc-frame__iframe");
    let inner = null;
    try { inner = frame?.contentDocument?.activeElement?.tagName ?? null; } catch { inner = "xo"; }
    const cs = el ? getComputedStyle(el) : null;
    const vis = el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
    return { active: el?.tagName, label: (el?.getAttribute("aria-label") || el?.textContent || "").trim().slice(0, 40),
      outline: cs?.outlineStyle, visible: vis, innerActive: inner, iframeFocusWithin: !!document.querySelector(".jc-frame.is-focused"),
      iframeMatchesFocus: frame?.matches(":focus") ?? null };
  });
  rows.push({ i, ...r });
  if (r.active === "IFRAME") await p.screenshot({ path: `${OUT}/stop-${i}-iframe-${tag}.png` });
}
fs.writeFileSync(`${OUT}/trace-${tag}.json`, JSON.stringify(rows, null, 2));
for (const r of rows) console.log(r.i, r.active, JSON.stringify(r.label), r.outline, "visible", r.visible, "inner", r.innerActive, "wrapFW", r.iframeFocusWithin, "frame:focus", r.iframeMatchesFocus);
await b.close();
