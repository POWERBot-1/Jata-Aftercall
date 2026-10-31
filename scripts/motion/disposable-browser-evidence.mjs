#!/usr/bin/env node
// Read-only, actual browser capture of seeded classic and AI preview pages. NOT universal acceptance.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const base = new URL(process.env.BASE_URL || 'http://localhost:4100');
if (base.protocol !== 'http:' || !['localhost','127.0.0.1'].includes(base.hostname) || base.port !== '4100' || base.pathname !== '/' || !process.env.CI || process.env.MOTION_ISOLATED !== '1' || process.env.DATABASE_URL !== 'postgresql://jata:jata@localhost:5432/jata_e2e?schema=public' || process.env.AUTH_SECRET !== 'interactive-business-e2e-test-secret') throw Error('Refusing non-isolated browser capture');
const chrome = process.env.CHROME_PATH;
if (!chrome || !existsSync(chrome)) throw Error('BLOCKED: Chrome missing');
const sha = execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim();
if (process.env.EXPECTED_SHA !== sha) throw Error(`Wrong tested commit: ${sha}`);
const out = process.env.EVIDENCE_DIR || 'motion-evidence'; mkdirSync(out,{recursive:true});
const dims = [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]];
const routes = [
  {name:'classic', route:'/b/nyumbani-kitchen', mode:'published classic', selector:'.jata-public'},
  {name:'ai-preview', route:'/b/nyumbani-kitchen/ai?preview=true', mode:'authorized preview', selector:'.jata-ai-motion', login:true},
  {name:'ai-denied', route:'/b/nyumbani-kitchen/ai', mode:'unentitled fallback', expected:404},
  {name:'missing', route:'/b/this-business-does-not-exist', mode:'not-found fallback', expected:404},
];
const results=[]; const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const browserVersion=await browser.version();
try {
 for (const target of routes) for (const [width,height] of dims) for (const reduced of [false,true]) {
  const context=await browser.createBrowserContext(); const page=await context.newPage();
  await page.setViewport({width,height,deviceScaleFactor:1});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]);
  await page.evaluateOnNewDocument(() => {
    window.__motionEvidence=[];
    const original=Element.prototype.animate;
    Element.prototype.animate=function(...args) {
      const animation=original.apply(this,args);
      if (this.hasAttribute('data-motion-recipe')) window.__motionEvidence.push({recipe:this.getAttribute('data-motion-recipe'),time:performance.now()});
      return animation;
    };
  });
  const row={commit:sha,browser:browserVersion,route:target.route,publishingMode:target.mode,family:'classic / not applicable',viewport:`${width}x${height}`,reduced,manualInspection:'NOT PERFORMED',video:null,screenshot:null};
  try {
    if (target.login) {
      await page.goto(new URL('/login',base).href,{waitUntil:'domcontentloaded'});
      await page.type('#login-email','demo@jata.link'); await page.type('#login-password','Demo1234!');
      await Promise.all([page.waitForFunction(() => location.pathname !== '/login',{timeout:20000}),page.click('button[type="submit"]')]);
    }
    const name=`${target.name}-${width}x${height}-${reduced?'reduced':'motion'}`;
    let recorder;
    try { recorder=await page.screencast({path:path.join(out,`${name}.webm`)}); row.video=`${name}.webm`; }
    catch(error) { row.recordingError=String(error).slice(0,300); }
    const response=await page.goto(new URL(target.route,base).href,{waitUntil:'domcontentloaded',timeout:45000});
    row.status=response?.status() ?? null;
    if(target.selector && row.status===200) await page.waitForFunction(sel => Boolean(document.querySelector(sel)?.dataset.renderMode),{timeout:10000},target.selector).catch(()=>{});
    await page.evaluate(async()=>{await document.fonts.ready; await new Promise(r=>setTimeout(r,700)); window.scrollTo(0,Math.min(500,document.documentElement.scrollHeight-innerHeight)); await new Promise(r=>setTimeout(r,800)); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,350));});
    row.observation=await page.evaluate((selector)=>{
      const scope=selector?document.querySelector(selector):null;
      const targets=scope?[...scope.querySelectorAll('[data-motion-recipe]')]:[];
      return {url:location.href, heading:document.querySelector('h1')?.textContent?.trim(), probes:scope?.querySelectorAll('[data-motion-probe]').length??0,
        renderMode:scope?.dataset.renderMode??null,engine:scope?.dataset.motionEngine??null,reason:scope?.dataset.motionReason??null,
        targets:targets.length,played:targets.filter(e=>e.dataset.motionPlayed).length,
        visibleTargets:targets.filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0 && r.height>0 && s.visibility!=='hidden' && Number(s.opacity)>0;}).length,
        active:targets.flatMap(e=>e.getAnimations()).filter(a=>['pending','running'].includes(a.playState)).length,
        animationCalls:window.__motionEvidence,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
    },target.selector);
    await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true}); row.screenshot=`${name}.png`;
    if(recorder) await recorder.stop();
    row.result=(row.status===(target.expected||200) && (!target.selector || row.observation.probes===1) && (!reduced || row.observation.renderMode==='lite' || !target.selector) && row.video && existsSync(path.join(out,row.video)) && statSync(path.join(out,row.video)).size > 0)?'OBSERVED':'FAIL';
  } catch(error) { row.result='ERROR'; row.error=String(error?.stack||error).slice(0,800); }
  results.push(row); writeFileSync(path.join(out,'observations.json'),JSON.stringify({commit:sha,browser:browserVersion,results},null,2));
  console.log(`${row.result} ${target.name} ${row.viewport} reduced=${reduced} status=${row.status}`);
  await context.close();
 }
} finally {await browser.close();}
const summary={commit:sha,browser:browserVersion,rows:results.length,observed:results.filter(x=>x.result==='OBSERVED').length,failed:results.filter(x=>x.result!=='OBSERVED').length,recordings:results.filter(x=>x.video && existsSync(path.join(out,x.video)) && statSync(path.join(out,x.video)).size>0).length,targets: [...new Set(results.map(x=>`${x.publishingMode}: ${x.observation?.renderMode || 'no-scope'} / ${x.observation?.reason || 'no-reason'}`))]};
console.log(`::notice title=Motion evidence summary::${JSON.stringify(summary)}`);
if (results.some(x=>x.result!=='OBSERVED')) process.exitCode=1;
