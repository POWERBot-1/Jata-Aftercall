import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await p.goto("http://localhost:3000/dev/studio-fixture?state=editor&outcome=success", { waitUntil: "load", timeout: 240000 });
await p.waitForSelector(".jc-frame__iframe", { timeout: 120000 });
let enteredAt = -1, leftAt = -1, iframeStops = 0; const seq = [];
for (let i = 0; i < 150; i++) {
  await p.keyboard.press("Tab");
  const a = await p.evaluate(() => document.activeElement?.tagName);
  seq.push(a);
  if (a === "IFRAME") { iframeStops++; if (enteredAt < 0) enteredAt = i; }
  else if (enteredAt >= 0 && leftAt < 0) { leftAt = i; }
  if (leftAt >= 0 && i > leftAt + 3) break;
}
console.log(JSON.stringify({ enteredAt, leftAt, iframeStops, total: seq.length, tail: seq.slice(-6) }));
await b.close();
