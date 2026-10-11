#!/usr/bin/env node
/** Actual local browser codecs/pixels. Zero upload/provider/save calls; originals/persistence acceptance BLOCKED. */
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
const executablePath = process.env.CHROME_PATH;
if (!executablePath) { console.error("Browser missing: local pixel tests NOT RUN."); process.exit(2); }
const base = process.env.BASE_URL || "http://localhost:4100";
const rows = [];
const check = (name, ok, detail = "") => { rows.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`); };
const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
let mutations = 0;
try {
  for (const fallback of [false, true]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
    await page.setRequestInterception(true);
    page.on("request", request => {
      if (["data:", "blob:"].includes(new URL(request.url()).protocol)) return void request.continue();
      if (request.method() !== "GET" || new URL(request.url()).origin !== new URL(base).origin) { mutations += 1; return void request.abort(); }
      return void request.continue();
    });
    if (fallback) await page.evaluateOnNewDocument(() => { window.createImageBitmap = undefined; });
    await page.goto(`${base}/dev/media-preview`, { waitUntil: "networkidle0", timeout: 90000 });
    await page.waitForFunction(() => typeof window.__jataLocalMedia === "function");
    const data = await page.evaluate(async (fallback) => {
      const canvas = document.createElement("canvas"); canvas.width = 80; canvas.height = 60;
      const ctx = canvas.getContext("2d");
      for (const [colour,x,y] of [["#ff0000",0,0],["#00ff00",40,0],["#0000ff",0,30],["#ffff00",40,30]]) { ctx.fillStyle = colour; ctx.fillRect(x,y,40,30); }
      const decode64 = url => Uint8Array.from(atob(url.split(",")[1]), char => char.charCodeAt(0));
      const raw = decode64(canvas.toDataURL("image/jpeg",1));
      const exif = orientation => new Uint8Array([255,225,0,34,69,120,105,102,0,0,77,77,0,42,0,0,0,8,0,1,1,18,0,3,0,0,0,1,0,orientation,0,0,0,0,0,0]);
      const concat = parts => { const out = new Uint8Array(parts.reduce((n,p)=>n+p.length,0)); let n=0; for(const p of parts){out.set(p,n);n+=p.length;} return out; };
      const sample = async url => {
        const img = new Image(); img.src=url; await img.decode();
        const target=document.createElement("canvas");target.width=img.width;target.height=img.height;
        const context=target.getContext("2d");context.drawImage(img,0,0);
        const colours=[[.2,.2],[.8,.2],[.2,.8],[.8,.8]].map(([x,y])=>[...context.getImageData(Math.floor(x*img.width),Math.floor(y*img.height),1,1).data]);
        return { width:img.width,height:img.height,colours,alpha:context.getImageData(0,0,1,1).data[3] };
      };
      const results=[];
      for (let orientation=1;orientation<=8;orientation++) {
        const bytes=concat([raw.slice(0,2),exif(orientation),raw.slice(2)]);
        const prepared=await window.__jataLocalMedia([...bytes],"image/jpeg","phone.jpg");
        results.push({ orientation,...prepared,pixels:prepared.result.status==="ok"?await sample(prepared.result.upload.dataUrl):null });
      }
      const formatResults=[];
      for (const mime of ["image/png","image/webp"]) {
        const bytes=decode64(canvas.toDataURL(mime));
        const prepared=await window.__jataLocalMedia([...bytes],mime,`phone.${mime.split('/')[1]}`);
        formatResults.push({mime,...prepared});
      }
      const transparent=document.createElement("canvas");transparent.width=transparent.height=20;
      transparent.getContext("2d").fillRect(4,4,12,12);
      const alpha=await window.__jataLocalMedia([...decode64(transparent.toDataURL("image/png"))],"image/png","logo.png");
      const alphaPixels=alpha.result.status==="ok"?await sample(alpha.result.upload.dataUrl):null;
      // Legal APP2 padding creates a >5MB JPEG without adding pixel/decode complexity. No provider/file write.
      const app2=new Uint8Array(60004);app2.set([255,226,234,98]);
      const largeBytes=concat([raw.slice(0,2),...Array.from({length:90},()=>app2),raw.slice(2)]);
      const large=await window.__jataLocalMedia([...largeBytes],"image/jpeg","large-camera.jpg");
      const malformed=await window.__jataLocalMedia([...raw.slice(0,-2)],"image/jpeg","cut.jpg");
      const lie=await window.__jataLocalMedia([...raw],"image/png","lie.png");
      const cancelled=await window.__jataLocalMedia([...raw],"image/jpeg","phone.jpg",{abort:true});
      return {results,formatResults,alpha,alphaPixels,large:{...large,sourceBytes:largeBytes.length},malformed,lie,cancelled};
    }, fallback);
    const expected = [[0,1,2,3],[1,0,3,2],[3,2,1,0],[2,3,0,1],[0,2,1,3],[2,0,3,1],[3,1,2,0],[1,3,0,2]];
    const palette=[[255,0,0],[0,255,0],[0,0,255],[255,255,0]];
    for (const result of data.results) {
      const n=result.orientation;
      const correct=result.pixels && result.pixels.colours.every((colour,i)=>palette[expected[n-1][i]].every((v,c)=>Math.abs(v-colour[c])<65));
      check(`${fallback?'WebView image fallback':'bitmap decode'} EXIF${n}: exact rotation/mirroring, derivative dimensions, source unchanged`, result.result.status==='ok' && correct && result.originalUnchanged && result.pixels.width===(n>=5?60:80) && result.pixels.height===(n>=5?80:60), JSON.stringify(result.pixels));
    }
    for(const result of data.formatResults) check(`${fallback?'fallback':'bitmap'} ${result.mime} actual derivative`, result.result.status==='ok' && result.originalUnchanged, JSON.stringify(result.result.status));
    check(`${fallback?'fallback':'bitmap'} PNG alpha preserved`, data.alpha.result.status==='ok' && data.alphaPixels?.alpha===0);
    check(`${fallback?'fallback':'bitmap'} source over5MB prepared, never returned as original`, data.large.result.status==='ok' && data.large.sourceBytes>5*1024*1024 && data.large.result.upload.bytes<data.large.sourceBytes && data.large.originalUnchanged);
    check(`${fallback?'fallback':'bitmap'} truncated/MIME lie/cancel fail usefully`, [data.malformed,data.lie,data.cancelled].every(r=>r.result.status==='error'));
    check(`${fallback?'fallback':'bitmap'} monotonic local progress`, data.results.every(r=>r.progress.every((p,i)=>i===0||p>=r.progress[i-1])));
    await page.close();
  }
  check("no provider/upload/save/network mutation enabled", mutations===0, `blocked mutations=${mutations}`);
} finally { await browser.close(); }
const failed=rows.filter(r=>!r.ok).length;
mkdirSync('.cache/verification',{recursive:true});writeFileSync('.cache/verification/local-media-browser.json',JSON.stringify({rows,failed,blocked:'Persistent originals, storage/provider and physical Android acceptance: OWNER DEFERRED; NOT PASSED'},null,2));
console.log(`${rows.length-failed} passed, ${failed} failed, 0 skipped. Local generated raster pixels only. Provider/persistent-original acceptance BLOCKED by owner; physical Android NOT RUN.`);
process.exit(failed?1:0);
