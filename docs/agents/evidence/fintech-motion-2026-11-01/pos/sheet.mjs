import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import fs from "node:fs";
const VP = ["320x568","360x800","390x844","430x932","768x1024","1366x768"];
const dir = "out/pos-matrix/after";
const files = fs.readdirSync(dir);
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
fs.mkdirSync("out/pos-matrix/sheets", { recursive: true });
for (const vp of VP) {
  const list = files.filter(f => f.endsWith(`-${vp}.png`)).sort();
  const html = `<html><body style="margin:0;background:#222;color:#fff;font:14px sans-serif;display:flex;flex-wrap:wrap;gap:8px;padding:8px;width:1800px">${list.map(f => `<figure style="margin:0;width:${Math.floor(1800/7)-12}px"><figcaption>${f.replace("-"+vp+".png","")}</figcaption><img src="file://${process.cwd()}/${dir}/${f}" style="width:100%;border:1px solid #555;display:block"></figure>`).join("")}</body></html>`;
  fs.writeFileSync(`out/pos-matrix/sheets/${vp}.html`, html);
  const p = await b.newPage({ viewport: { width: 1800, height: 800 } });
  await p.goto(`file://${process.cwd()}/out/pos-matrix/sheets/${vp}.html`, { waitUntil: "load" });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `out/pos-matrix/sheets/${vp}.png`, fullPage: true });
  await p.close();
}
await b.close();
console.log(fs.readdirSync("out/pos-matrix/sheets").join(" "));
