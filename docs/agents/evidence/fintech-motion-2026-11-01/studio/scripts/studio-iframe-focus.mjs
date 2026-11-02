import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/dev/studio-fixture?state=editor&outcome=success", { waitUntil: "networkidle", timeout: 240000 });
let hit = null;
for (let i = 0; i < 40; i++) {
  await p.keyboard.press("Tab");
  const r = await p.evaluate(() => { const el = document.activeElement; if (el?.tagName !== "IFRAME") return null; const cs = getComputedStyle(el); const wrapOK = !!document.querySelector(".jc-frame:focus-within"); return { outline: cs.outlineStyle, outlineColor: cs.outlineColor, focusVisible: el.matches(":focus-visible"), focus: el.matches(":focus"), wrapFocusWithin: wrapOK }; });
  if (r) { hit = { index: i, ...r }; break; }
}
console.log(JSON.stringify(hit));
if (hit) await p.screenshot({ path: "out/studio/focus-iframe-keyboard-1366x768.png", clip: { x: 0, y: 0, width: 390, height: 844 } });
await b.close();
