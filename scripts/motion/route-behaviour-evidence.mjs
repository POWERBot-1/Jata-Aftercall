#!/usr/bin/env node
// Event-level observations on real HTTP routes in the isolated family-workflow fixture.
// Does NOT certify full queue pressure, all routes, payment, AI publication or independent visuals.
import puppeteer from 'puppeteer-core';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { mkdirSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const base=new URL(process.env.BASE_URL||'http://localhost:4100');
if(base.protocol!=='http:'||!['localhost','127.0.0.1'].includes(base.hostname)||base.port!=='4100'||base.pathname!=='/'||process.env.CI!=='true'||process.env.MOTION_ISOLATED!=='1'||process.env.DATABASE_URL!=='postgresql://jata:jata@localhost:5432/jata_e2e?schema=public'||process.env.AUTH_SECRET!=='interactive-business-e2e-test-secret') throw Error('Not isolated');
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();if(sha!==process.env.EXPECTED_SHA) throw Error('HEAD mismatch');
const out='motion-route-evidence';mkdirSync(out,{recursive:true});const db=new PrismaClient();const events=[],rows=[];let browser;
const save=()=>writeFileSync(path.join(out,'evidence.json'),JSON.stringify({sha,browser:browserVersion,events,rows,limitations:['No published AI fixture','No ten-section queue stress','No independent image review','Lite and reduced are not a previous-build baseline']},null,2));
let browserVersion='unavailable';
try {
 const business=await db.business.findUniqueOrThrow({where:{slug:'marys-beauty-studio'},select:{id:true,slug:true}});
 const product=await db.product.findFirstOrThrow({where:{businessId:business.id,isActive:true},select:{id:true}});
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH,headless:true,protocolTimeout:120000,args:['--no-sandbox','--disable-dev-shm-usage']});browserVersion=await browser.version();
 const owner=await browser.newPage();await owner.goto(new URL('/login',base).href,{waitUntil:'domcontentloaded'});
 const login=await owner.evaluate(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'demo@jata.link',password:'Demo1234!'})});return r.status;});if(login!==200) throw Error(`fixture login ${login}`);
 const api=(url,method='GET',data)=>owner.evaluate(async(url,method,data)=>{const r=await fetch(url,{method,headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined,cache:'no-store'});return {status:r.status,body:await r.json().catch(()=>null)};},url,method,data);
 async function setPreference(preference){const current=await api(`/api/experience?businessId=${business.id}`);if(current.status!==200)throw Error(`read draft ${current.status}`);const document={...current.body.document,themeKey:'beauty-editorial',renderPreference:preference};const patch=await api('/api/experience','PATCH',{businessId:business.id,expectedDraftVersion:current.body.experience.draftVersion,document});if(patch.status!==200)throw Error(`preference patch ${patch.status}`);}
 await setPreference('motion');
 const page=await browser.newPage();const installTrace=()=>{
  const trace=[];window.__routeMotionTrace=trace;
  const emit=(kind,data={})=>trace.push({kind,at:performance.now(),...data});
  const Native=window.IntersectionObserver;
  window.IntersectionObserver=class extends Native {constructor(cb,opts){const owned=opts?.threshold===0.08;super((entries,obs)=>{if(owned)for(const e of entries)emit('intersection',{in:e.isIntersecting,recipe:e.target.dataset.motionRecipe});cb(entries,obs)},opts);if(owned)emit('observer-create');this.__owned=owned;}observe(el){if(this.__owned)emit('observe',{recipe:el.dataset.motionRecipe});return super.observe(el)}unobserve(el){if(this.__owned)emit('unobserve',{recipe:el.dataset.motionRecipe});return super.unobserve(el)}disconnect(){if(this.__owned)emit('disconnect');return super.disconnect()}};
  const original=Element.prototype.animate;Element.prototype.animate=function(...args){const anim=original.apply(this,args);if(this.matches('[data-motion-recipe]')){emit('animate-start',{recipe:this.dataset.motionRecipe});anim.addEventListener('finish',()=>emit('animate-finish'));anim.addEventListener('cancel',()=>emit('animate-cancel'));}return anim;};
 };await page.evaluateOnNewDocument(installTrace);await owner.evaluateOnNewDocument(installTrace);
 const routeBase=`/b/${business.slug}`;
 for(const target of [{name:'storefront',route:routeBase},{name:'shop',route:`${routeBase}/shop`},{name:'item',route:`${routeBase}/item/${product.id}`},{name:'checkout',route:`${routeBase}/checkout`},{name:'ai-preview',route:`${routeBase}/ai?preview=true`,auth:true}]){
  for(const [width,height] of [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]]){
   const p=target.auth?owner:page;
   await p.bringToFront();await p.setViewport({width,height,deviceScaleFactor:1});await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
   const response=await p.goto(new URL(target.route,base).href,{waitUntil:'domcontentloaded',timeout:45000});
   const selector=target.auth?'.jata-ai-motion':'.eb-scope';await p.waitForFunction(s=>document.querySelector(s)?.dataset.renderMode,{timeout:10000},selector).catch(()=>{});
   await p.evaluate(async()=>{for(const e of document.querySelectorAll('[data-motion-recipe]')){e.scrollIntoView({block:'center',behavior:'instant'});await new Promise(r=>setTimeout(r,120));}await new Promise(r=>setTimeout(r,650));});
   const data=await p.evaluate(s=>{const scope=document.querySelector(s);return {mode:scope?.dataset.renderMode,reason:scope?.dataset.motionReason,engine:scope?.dataset.motionEngine,targets:scope?.querySelectorAll('[data-motion-recipe]').length,probes:scope?.querySelectorAll('[data-motion-probe]').length,trace:window.__routeMotionTrace||[],visibleText:document.querySelector('h1')?.textContent};},selector);
   const name=`${target.name}-${width}x${height}.jpg`;await p.screenshot({path:path.join(out,name),type:'jpeg',quality:50});
   const row={sha,browser:browserVersion,route:target.route,viewport:`${width}x${height}`,status:response?.status()??null,...data,screenshot:name};rows.push(row);save();
  }
 }
 // Actual owner preference and OS preference are applied independently through the real draft API.
 for(const widthHeight of [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]]){
  const [width,height]=widthHeight;await owner.bringToFront();await owner.setViewport({width,height,deviceScaleFactor:1});
  for(const setting of [{name:'owner-lite',preference:'lite',reduced:false},{name:'os-reduced',preference:'motion',reduced:true}]){
   await setPreference(setting.preference);await owner.emulateMediaFeatures([{name:'prefers-reduced-motion',value:setting.reduced?'reduce':'no-preference'}]);
   const route=`${routeBase}?preview=draft`;const response=await owner.goto(new URL(route,base).href,{waitUntil:'domcontentloaded'});
   await owner.waitForFunction(()=>document.querySelector('.eb-scope')?.dataset.renderMode,{timeout:10000}).catch(()=>{});
   const state=await owner.evaluate(()=>{const s=document.querySelector('.eb-scope');return {mode:s?.dataset.renderMode,reason:s?.dataset.motionReason,targets:s?.querySelectorAll('[data-motion-recipe]').length,probes:s?.querySelectorAll('[data-motion-probe]').length};});
   const name=`${setting.name}-${width}x${height}.png`;await owner.screenshot({path:path.join(out,name),fullPage:true});rows.push({sha,browser:browserVersion,route,viewport:`${width}x${height}`,setting:setting.name,status:response?.status()??null,...state,screenshot:name});save();
  }
 }
 // Report raw pixel differences without claiming visual equivalence: dynamic content and media
 // can legitimately differ, and the comparison is not an older-build baseline.
 for(const [w,h] of [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]]){
  const a=await sharp(path.join(out,`owner-lite-${w}x${h}.png`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const b=await sharp(path.join(out,`os-reduced-${w}x${h}.png`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let differing=null;if(a.info.width===b.info.width&&a.info.height===b.info.height){differing=0;for(let i=0;i<a.data.length;i+=4)if(a.data[i]!==b.data[i]||a.data[i+1]!==b.data[i+1]||a.data[i+2]!==b.data[i+2]||a.data[i+3]!==b.data[i+3])differing++;}
  events.push({kind:'lite-reduced-pixel-comparison',viewport:`${w}x${h}`,a:{width:a.info.width,height:a.info.height},b:{width:b.info.width,height:b.info.height},differingPixels:differing});save();
 }

}catch(e){events.push({kind:'BLOCKED',error:String(e?.stack||e).slice(0,1000)});}finally{save();await browser?.close();await db.$disconnect();}
const errors=events.filter(x=>x.kind==='BLOCKED');const summary={sha,browser:browserVersion,rows:rows.length,errors,routeRows:rows.filter(x=>!x.setting).length,liteRows:rows.filter(x=>x.setting&&x.mode==='lite').length};console.log(`::notice title=Route behaviour observations::${JSON.stringify(summary)}`);
if(errors.length||summary.routeRows!==30||summary.liteRows!==12||rows.some(x=>x.status!==200||x.probes!==1))process.exitCode=1;
