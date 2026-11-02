import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import fs from "node:fs";
const VP = ["320x568","360x800","390x844","430x932","768x1024","1366x768"];
const dir = "out/dash-states"; fs.mkdirSync(`${dir}/sheets`, { recursive: true });
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
for (const vp of VP) {
  const states = ["populated","empty","loading","error"];
  const html = `<html><body style="margin:0;background:#222;color:#fff;font:14px sans-serif;display:flex;gap:10px;padding:8px;align-items:flex-start">${states.map(s => `<figure style="margin:0;flex:1"><figcaption>${s}</figcaption><img src="file://${process.cwd()}/${dir}/${s}-${vp}.png" style="width:100%;border:1px solid #555;display:block"></figure>`).join("")}</body></html>`;
  fs.writeFileSync(`${dir}/sheets/${vp}.html`, html);
  const p = await b.newPage({ viewport: { width: 1800, height: 900 } });
  await p.goto(`file://${process.cwd()}/${dir}/sheets/${vp}.html`, { waitUntil: "load" });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${dir}/sheets/${vp}.png`, fullPage: true });
  await p.close();
}
await b.close(); console.log("ok");
