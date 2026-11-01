import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import fs from "node:fs";
const VP = [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]];
const BASE = "http://localhost:3000/dev/ai-front-desk-fixture";
const OUT = "out/ai"; fs.mkdirSync(OUT, { recursive: true });
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !["--single-process","--no-zygote"].includes(a)), headless: true, env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al/lib" } });
const report = [];
async function open(vp, tag, outcome, reduce = false) {
  const ctx = await b.newContext({ viewport: { width: vp[0], height: vp[1] }, reducedMotion: reduce ? "reduce" : "no-preference" });
  const p = await ctx.newPage(); const errs = []; const net = [];
  p.on("pageerror", e => errs.push(e.message));
  p.on("request", r => { if (r.url().includes("/api/")) net.push(r.method() + " " + new URL(r.url()).pathname); });
  await p.goto(`${BASE}?outcome=${outcome}`, { waitUntil: "load", timeout: 240000 });
  await p.waitForSelector("text=AI Business Front Desk", { timeout: 180000 });
  await p.waitForTimeout(600);
  const shot = async (name, meta = {}, wait = 300) => {
    await p.waitForTimeout(wait);
    const file = `${OUT}/${name}-${tag}.png`;
    await p.screenshot({ path: file, fullPage: true });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    report.push({ viewport: tag, outcome, state: name, file, overflow, pageErrors: errs.length, networkApiCalls: net.length, ...meta });
  };
  return { p, ctx, shot, errs, net };
}
for (const vp of VP) {
  const tag = `${vp[0]}x${vp[1]}`;
  // success path
  let s = await open(vp, tag, "success");
  await s.shot("01-overview");
  await s.p.getByRole("button", { name: /Preview/ }).first().click();
  await s.p.waitForSelector("#fd-test-question");
  await s.shot("02-test-chat-empty");
  await s.p.fill("#fd-test-question", "Do you deliver to Kitengela?");
  await s.p.getByRole("button", { name: "Send test question" }).click();
  await s.shot("03-loading", { note: "reply in flight" }, 120);
  await s.shot("04-simulated-reply-missing-info", {}, 1500);
  await s.p.fill("#fd-test-question", "How much is a braid?");
  await s.p.getByRole("button", { name: "Send test question" }).click();
  await s.shot("05-simulated-reply-grounded", {}, 1500);
  await s.p.getByRole("button", { name: /Answers/ }).first().click();
  await s.p.getByRole("button", { name: "Save answer settings" }).click();
  await s.shot("06-save-progress", { note: "settings save in flight" }, 120);
  await s.shot("07-save-simulated-success", {}, 1500);
  await s.ctx.close();
  // failure path
  s = await open(vp, tag, "failure");
  await s.p.getByRole("button", { name: /Preview/ }).first().click();
  await s.p.waitForSelector("#fd-test-question");
  await s.p.fill("#fd-test-question", "How much is a braid?");
  await s.p.getByRole("button", { name: "Send test question" }).click();
  await s.shot("08-reply-failure", {}, 1500);
  await s.p.getByRole("button", { name: /Answers/ }).first().click();
  await s.p.getByRole("button", { name: "Save answer settings" }).click();
  await s.shot("09-save-failure", {}, 1500);
  await s.ctx.close();
  // empty outcome
  s = await open(vp, tag, "empty");
  await s.p.getByRole("button", { name: /Preview/ }).first().click();
  await s.p.waitForSelector("#fd-test-question");
  await s.p.fill("#fd-test-question", "Do you take bookings on Sunday?");
  await s.p.getByRole("button", { name: "Send test question" }).click();
  await s.shot("10-empty-outcome-reply", {}, 1500);
  await s.ctx.close();
}
// keyboard + reduced motion at 390x844
{
  const s = await open([390,844], "390x844", "success");
  await s.p.getByRole("button", { name: /Preview/ }).first().click();
  await s.p.waitForSelector("#fd-test-question");
  const stops = [];
  await s.p.focus("#fd-test-question");
  for (let i = 0; i < 12; i++) {
    await s.p.keyboard.press("Tab");
    stops.push(await s.p.evaluate(() => { const el = document.activeElement; const cs = getComputedStyle(el); return { tag: el.tagName, label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40), outline: cs.outlineStyle }; }));
  }
  report.push({ viewport: "390x844", state: "keyboard-after-test-input", stops });
  await s.ctx.close();
  for (const reduce of [false, true]) {
    const r = await open([390,844], `390x844-rm${reduce ? "on" : "off"}`, "success", reduce);
    await r.p.getByRole("button", { name: /Preview/ }).first().click();
    await r.p.waitForSelector("#fd-test-question");
    await r.p.fill("#fd-test-question", "How much is a braid?");
    await r.p.getByRole("button", { name: "Send test question" }).click();
    await r.p.waitForTimeout(150);
    const anim = await r.p.evaluate(() => [...document.querySelectorAll("*")].filter(el => { const n = getComputedStyle(el).animationName; return n && n !== "none"; }).map(el => el.tagName + ":" + getComputedStyle(el).animationName).slice(0, 10));
    const trans = await r.p.evaluate(() => { const b = document.querySelector('button[aria-label="Send test question"], button[type="submit"]'); return b ? getComputedStyle(b).transitionDuration : "absent"; });
    report.push({ viewport: "390x844", state: `reduced-motion-${reduce ? "on" : "off"}-loading`, animating: anim, submitTransition: trans });
    await r.ctx.close();
  }
}
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await b.close();
console.log("DONE", report.length);
