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
const demoFixturePassword=process.env.DEMO_FIXTURE_PASSWORD;if(!demoFixturePassword)throw Error('Missing ephemeral DEMO_FIXTURE_PASSWORD');
const out='motion-route-evidence';mkdirSync(out,{recursive:true});const db=new PrismaClient();const events=[],rows=[];let browser;
const save=()=>writeFileSync(path.join(out,'evidence.json'),JSON.stringify({sha,browser:browserVersion,events,rows,limitations:['No published AI fixture','No ten-section queue stress','No independent image review','Lite and reduced are not a previous-build baseline']},null,2));
let browserVersion='unavailable';
try {
 const business=await db.business.findUniqueOrThrow({where:{slug:'marys-beauty-studio'},select:{id:true,slug:true}});
 const product=await db.product.findFirstOrThrow({where:{businessId:business.id,isActive:true},select:{id:true}});
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH,headless:true,protocolTimeout:120000,args:['--no-sandbox','--disable-dev-shm-usage']});browserVersion=await browser.version();
 const owner=await browser.newPage();await owner.goto(new URL('/login',base).href,{waitUntil:'domcontentloaded'});
 const login=await owner.evaluate(async(password)=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'demo@jata.link',password})});return r.status;},demoFixturePassword);if(login!==200) throw Error(`fixture login ${login}`);
 const api=(url,method='GET',data)=>owner.evaluate(async(url,method,data)=>{const r=await fetch(url,{method,headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined,cache:'no-store'});return {status:r.status,body:await r.json().catch(()=>null)};},url,method,data);
 async function setPreference(preference){const current=await api(`/api/experience?businessId=${business.id}`);if(current.status!==200)throw Error(`read draft ${current.status}`);const document={...current.body.document,themeKey:'beauty-editorial',renderPreference:preference};const patch=await api('/api/experience','PATCH',{businessId:business.id,expectedDraftVersion:current.body.experience.draftVersion,document});if(patch.status!==200)throw Error(`preference patch ${patch.status}`);}
 await setPreference('motion');
 const page=await browser.newPage();const installTrace=()=>{
  const trace=[];window.__routeMotionTrace=trace;
  const emit=(kind,data={})=>trace.push({kind,at:performance.now(),...data});
  const scopeState=()=>{const s=document.querySelector('.eb-scope');return s?{present:true,renderMode:s.dataset.renderMode||null,reason:s.dataset.motionReason||null,engine:s.dataset.motionEngine||null}:{present:false,renderMode:null,reason:null,engine:null};};
  const query='(prefers-reduced-motion: reduce)';let listenerId=0;
  const nativeMatchMedia=window.matchMedia.bind(window);window.__routeMediaCurrent=()=>nativeMatchMedia(query).matches;
  window.matchMedia=function(expression){
   const media=nativeMatchMedia(expression);if(expression!==query)return media;
   emit('media-query-initial',{query:expression,matches:media.matches,preference:media.matches?'reduce':'no-preference',scope:scopeState()});
   try{
    const nativeAdd=media.addEventListener.bind(media),nativeRemove=media.removeEventListener.bind(media),wrappers=new WeakMap();
    nativeAdd('change',event=>emit('media-query-change-emitted',{query:expression,eventMatches:event.matches,preference:event.matches?'reduce':'no-preference',currentMatches:media.matches,scope:scopeState()}));
    media.addEventListener=function(type,listener,options){
     if(type!=='change'||!listener||!['function','object'].includes(typeof listener))return nativeAdd(type,listener,options);
     let wrapped=wrappers.get(listener);
     if(!wrapped){const id=++listenerId;const registration=new Error().stack?.split(String.fromCharCode(10)).slice(1,5);wrapped=function(event){const before=scopeState();emit('media-query-listener-received',{id,eventMatches:event.matches,currentMatches:media.matches,before,registration});try{return typeof listener==='function'?listener.call(this,event):listener.handleEvent.call(listener,event);}finally{const after=scopeState();emit('media-query-listener-returned',{id,eventMatches:event.matches,after,observedEligibilityDecision:{allowed:after.renderMode==='motion',reason:after.reason}});}};wrappers.set(listener,wrapped);emit('media-query-listener-registered',{id,registration});}
     return nativeAdd(type,wrapped,options);
    };
    media.removeEventListener=function(type,listener,options){const valid=listener&&(typeof listener==='function'||typeof listener==='object');return nativeRemove(type,valid?(wrappers.get(listener)||listener):listener,options);};
   }catch(error){emit('media-query-instrumentation-error',{message:String(error)});}
   return media;
  };
  try{
    const observer=new MutationObserver(records=>{for(const record of records){if(record.target.matches?.('.eb-scope'))emit('scope-state-mutation',{attribute:record.attributeName,oldValue:record.oldValue,state:scopeState()});}});
    const attach=()=>{if(!document.documentElement)return false;observer.observe(document.documentElement,{subtree:true,attributes:true,attributeOldValue:true,attributeFilter:['data-render-mode','data-motion-reason','data-motion-engine']});emit('scope-observer-attached');return true;};
    if(!attach())document.addEventListener('DOMContentLoaded',()=>attach(),{once:true});
  }catch(error){emit('scope-observer-instrumentation-error',{message:String(error)});}
  const Native=window.IntersectionObserver;
  window.IntersectionObserver=class extends Native {constructor(cb,opts){const owned=opts?.threshold===0.08;super((entries,obs)=>{if(owned)for(const e of entries)emit('intersection',{in:e.isIntersecting,recipe:e.target.dataset.motionRecipe});cb(entries,obs)},opts);if(owned)emit('observer-create');this.__owned=owned;}observe(el){if(this.__owned)emit('observe',{recipe:el.dataset.motionRecipe});return super.observe(el)}unobserve(el){if(this.__owned)emit('unobserve',{recipe:el.dataset.motionRecipe});return super.unobserve(el)}disconnect(){if(this.__owned)emit('observer-disconnect',{scope:scopeState()});return super.disconnect()}};
  const original=Element.prototype.animate;Element.prototype.animate=function(...args){const anim=original.apply(this,args);if(this.matches('[data-motion-recipe]')){emit('animate-start',{recipe:this.dataset.motionRecipe});anim.addEventListener('finish',()=>emit('animate-finish'));anim.addEventListener('cancel',()=>emit('active-reveal-cancelled',{recipe:this.dataset.motionRecipe}));}return anim;};
 };await page.evaluateOnNewDocument(installTrace);await owner.evaluateOnNewDocument(installTrace);
 async function observeRenderMode(target,expected,stage){
  const started=Date.now();
  const snapshot=()=>target.evaluate(expected=>{const scope=document.querySelector('.eb-scope');return {expected,scope:scope?{present:true,renderMode:scope.dataset.renderMode||null,reason:scope.dataset.motionReason||null,engine:scope.dataset.motionEngine||null}:{present:false,renderMode:null,reason:null,engine:null},mediaMatches:window.__routeMediaCurrent?.()??null,mediaPreference:window.__routeMediaCurrent?.()===true?'reduce':window.__routeMediaCurrent?.()===false?'no-preference':null,trace:window.__routeMotionTrace||[]};},expected);
  try{
   await target.waitForFunction(expected=>document.querySelector('.eb-scope')?.dataset.renderMode===expected,{timeout:10000},expected);
   const observed=await snapshot();events.push({kind:'browser-test-observation',stage,expected,elapsedMs:Date.now()-started,...observed});save();return observed;
  }catch(error){
   const observed=await snapshot();const screenshot=`reduced-motion-${stage}-timeout.png`;await target.screenshot({path:path.join(out,screenshot),fullPage:true});
   events.push({kind:'browser-test-observation-timeout',stage,expected,elapsedMs:Date.now()-started,error:String(error?.stack||error).slice(0,1200),screenshot,...observed});save();
   throw new Error(`Browser test did not observe ${expected} during ${stage}; diagnostics saved to ${screenshot}`);
  }
 }
 const routeBase=`/b/${business.slug}`;
 for(const target of [{name:'storefront',route:routeBase},{name:'shop',route:`${routeBase}/shop`},{name:'item',route:`${routeBase}/item/${product.id}`},{name:'checkout',route:`${routeBase}/checkout`},{name:'ai-preview',route:`${routeBase}/ai?preview=true`,auth:true}]){
  for(const [width,height] of [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]]){
   const p=target.auth?owner:page;
   await p.bringToFront();await p.setViewport({width,height,deviceScaleFactor:1});await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
   const response=await p.goto(new URL(target.route,base).href,{waitUntil:'domcontentloaded',timeout:45000});
   const selector=target.auth?'.jata-ai-motion':'.eb-scope';await p.waitForFunction(s=>document.querySelector(s)?.dataset.renderMode,{timeout:10000},selector).catch(()=>{});
   await p.evaluate(async()=>{for(const e of document.querySelectorAll('[data-motion-recipe]')){e.scrollIntoView({block:'center',behavior:'instant'});await new Promise(r=>setTimeout(r,120));}await new Promise(r=>setTimeout(r,650));});
   const data=await p.evaluate(s=>{const scope=document.querySelector(s);return {mode:scope?.dataset.renderMode,reason:scope?.dataset.motionReason,engine:scope?.dataset.motionEngine,mediaMatches:window.__routeMediaCurrent?.()??null,mediaPreference:window.__routeMediaCurrent?.()===true?'reduce':window.__routeMediaCurrent?.()===false?'no-preference':null,targets:scope?.querySelectorAll('[data-motion-recipe]').length,probes:scope?.querySelectorAll('[data-motion-probe]').length,trace:window.__routeMotionTrace||[],visibleText:document.querySelector('h1')?.textContent};},selector);
   const name=`${target.name}-${width}x${height}.jpg`;await p.screenshot({path:path.join(out,name),type:'jpeg',quality:50});
   const row={sha,browser:browserVersion,route:target.route,viewport:`${width}x${height}`,status:response?.status()??null,...data,screenshot:name};rows.push(row);save();
  }
 }
 // Real published application document, real browser preference change. Do not inject
 // targets, observer notifications or animation implementations. This is a targeted race,
 // not evidence that the eight-slot queue was stressed.
 await owner.bringToFront();await owner.setViewport({width:390,height:844,deviceScaleFactor:1});
 await setPreference('motion');await owner.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
 await owner.goto(new URL(`${routeBase}?preview=draft`,base).href,{waitUntil:'domcontentloaded'});
 const normalObservation=await observeRenderMode(owner,'motion','initial-normal-motion');
 await owner.evaluate(()=>document.querySelector('.eb-scope [data-motion-recipe]')?.scrollIntoView({block:'center',behavior:'instant'}));
 await owner.waitForFunction(()=>window.__routeMotionTrace?.some(e=>e.kind==='animate-start'),{timeout:8000}).catch(()=>{});
 const before=await owner.evaluate(()=>({trace:window.__routeMotionTrace||[],mediaMatches:window.__routeMediaCurrent?.()??null,mediaPreference:window.__routeMediaCurrent?.()===true?'reduce':'no-preference',scope:(()=>{const s=document.querySelector('.eb-scope');return s?{present:true,renderMode:s.dataset.renderMode||null,reason:s.dataset.motionReason||null,engine:s.dataset.motionEngine||null}:{present:false};})(),running:[...document.querySelectorAll('.eb-scope [data-motion-recipe]')].flatMap(e=>e.getAnimations()).filter(a=>a.playState==='running'||a.playState==='pending').length}));
 const beforeScreenshot='reduced-motion-before.png';await owner.screenshot({path:path.join(out,beforeScreenshot),fullPage:true});
 await owner.evaluate(()=>window.__routeMotionTrace?.push({kind:'test-preference-change-requested',at:performance.now(),from:window.__routeMediaCurrent?.()??null,fromPreference:window.__routeMediaCurrent?.()===true?'reduce':'no-preference',to:true,toPreference:'reduce',scope:(()=>{const s=document.querySelector('.eb-scope');return s?{renderMode:s.dataset.renderMode||null,reason:s.dataset.motionReason||null,engine:s.dataset.motionEngine||null}:null;})()}));
 await owner.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 await owner.evaluate(()=>window.__routeMotionTrace?.push({kind:'test-preference-change-command-completed',at:performance.now(),mediaMatches:window.__routeMediaCurrent?.()??null}));
 const liteObservation=await observeRenderMode(owner,'lite','live-reduced-motion');
 const after=await owner.evaluate(()=>({trace:window.__routeMotionTrace||[],mediaMatches:window.__routeMediaCurrent?.()??null,mediaPreference:window.__routeMediaCurrent?.()===true?'reduce':'no-preference',running:[...document.querySelectorAll('.eb-scope [data-motion-recipe]')].flatMap(e=>e.getAnimations()).filter(a=>a.playState==='running'||a.playState==='pending').length,scope:(()=>{const s=document.querySelector('.eb-scope');return s?{present:true,renderMode:s.dataset.renderMode||null,reason:s.dataset.motionReason||null,engine:s.dataset.motionEngine||null}:{present:false};})()}));
 const afterScreenshot='reduced-motion-after.png';await owner.screenshot({path:path.join(out,afterScreenshot),fullPage:true});
 const race={kind:'real-reduced-motion-cancellation',normalObservation:normalObservation.scope,initialMediaMatches:before.mediaMatches,initialMediaPreference:before.mediaPreference,initialScope:before.scope,mediaMatchesAfter:after.mediaMatches,started:before.trace.filter(e=>e.kind==='animate-start').length,runningBefore:before.running,runningAfter:after.running,finalScope:after.scope,reason:after.scope.reason,observation:liteObservation.scope,disconnects:after.trace.filter(e=>e.kind==='observer-disconnect').length,cancelEvents:after.trace.filter(e=>e.kind==='active-reveal-cancelled').length,emitted:after.trace.filter(e=>e.kind==='media-query-change-emitted'&&e.eventMatches===true).length,listenerReceived:after.trace.filter(e=>e.kind==='media-query-listener-received'&&e.eventMatches===true).length,listenerReturnedReduced:after.trace.filter(e=>e.kind==='media-query-listener-returned'&&e.after?.reason==='reduced-motion').length,screenshots:[beforeScreenshot,afterScreenshot],trace:after.trace};
 race.result=race.started>0&&race.runningBefore>0&&race.mediaMatchesAfter===true&&race.emitted>0&&race.listenerReceived>0&&race.listenerReturnedReduced>0&&race.runningAfter===0&&race.reason==='reduced-motion'&&race.disconnects>0&&race.cancelEvents>0&&liteObservation.scope.renderMode==='lite'?'PASS':'INCONCLUSIVE_OR_FAIL';events.push(race);save();
 console.log(`::notice title=Targeted real cancellation::${JSON.stringify({kind:race.kind,result:race.result,started:race.started,runningBefore:race.runningBefore,runningAfter:race.runningAfter,reason:race.reason,disconnects:race.disconnects,cancelEvents:race.cancelEvents})}`);
 // Exercise repeated live preference transitions on the same real document. Do not
 // synthesize intersections or assume previously seen targets replay on re-entry.
 const transitions=[];
 for(let i=0;i<3;i++){
  for(const [preference,mode] of [['no-preference','motion'],['reduce','lite']]){
   await owner.evaluate(({preference,mode})=>window.__routeMotionTrace?.push({kind:'test-preference-change-requested',at:performance.now(),toReduced:preference==='reduce',expectedMode:mode}),{preference,mode});
   await owner.emulateMediaFeatures([{name:'prefers-reduced-motion',value:preference}]);
   await owner.evaluate(()=>window.__routeMotionTrace?.push({kind:'test-preference-change-command-completed',at:performance.now(),mediaMatches:window.__routeMediaCurrent?.()??null}));
   const observation=await observeRenderMode(owner,mode,`repeated-transition-${i+1}-${preference}`);
   const state=await owner.evaluate(()=>({mode:document.querySelector('.eb-scope')?.dataset.renderMode,reason:document.querySelector('.eb-scope')?.dataset.motionReason,mediaMatches:window.__routeMediaCurrent?.()??null,running:[...document.querySelectorAll('.eb-scope [data-motion-recipe]')].flatMap(e=>e.getAnimations()).filter(a=>a.playState==='running'||a.playState==='pending').length}));
   transitions.push({...state,observation:observation.scope});
  }
 }
 // Allow the import timeout and reveal fallback windows to elapse to detect late starts.
 await new Promise(resolve=>setTimeout(resolve,2300));
 const settled=await owner.evaluate(()=>({mode:document.querySelector('.eb-scope')?.dataset.renderMode,reason:document.querySelector('.eb-scope')?.dataset.motionReason,running:[...document.querySelectorAll('.eb-scope [data-motion-recipe]')].flatMap(e=>e.getAnimations()).filter(a=>a.playState==='running'||a.playState==='pending').length,trace:window.__routeMotionTrace||[]}));
 const emitted=settled.trace.filter(e=>e.kind==='media-query-change-emitted').length,listenerReceipts=settled.trace.filter(e=>e.kind==='media-query-listener-received').length;
 const repeat={kind:'repeated-preference-transitions',transitions,settled,emitted,listenerReceipts,result:transitions.length===6&&transitions.every((x,i)=>x.mode===(i%2?'lite':'motion')&&x.mediaMatches===Boolean(i%2)&&(i%2?(x.reason==='reduced-motion'&&x.running===0):x.reason==='eligible'))&&settled.mode==='lite'&&settled.reason==='reduced-motion'&&settled.running===0&&emitted>=6&&listenerReceipts>=6?'PASS':'INCONCLUSIVE_OR_FAIL'};
 events.push(repeat);save();console.log(`::notice title=Repeated preference transitions::${JSON.stringify({kind:repeat.kind,result:repeat.result,transitions,settled:{mode:settled.mode,reason:settled.reason,running:settled.running}})}`);
 // Actual owner preference and OS preference are applied independently through the real draft API.
 for(const widthHeight of [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]]){
  const [width,height]=widthHeight;await owner.bringToFront();await owner.setViewport({width,height,deviceScaleFactor:1});
  for(const setting of [{name:'owner-lite',preference:'lite',reduced:false},{name:'os-reduced',preference:'motion',reduced:true}]){
   await setPreference(setting.preference);await owner.emulateMediaFeatures([{name:'prefers-reduced-motion',value:setting.reduced?'reduce':'no-preference'}]);
   const route=`${routeBase}?preview=draft`;const response=await owner.goto(new URL(route,base).href,{waitUntil:'domcontentloaded'});
   await observeRenderMode(owner,'lite',`initial-${setting.name}-${width}x${height}`);
   const state=await owner.evaluate(()=>{const s=document.querySelector('.eb-scope');return {mode:s?.dataset.renderMode,reason:s?.dataset.motionReason,mediaMatches:window.__routeMediaCurrent?.()??null,targets:s?.querySelectorAll('[data-motion-recipe]').length,probes:s?.querySelectorAll('[data-motion-probe]').length};});
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
const errors=events.filter(x=>x.kind==='BLOCKED');const normalRows=rows.filter(x=>!x.setting),constrainedRows=rows.filter(x=>x.setting),normalMotionRowsPass=normalRows.length===30&&normalRows.every(x=>x.mode==='motion'&&x.reason==='eligible'&&x.mediaMatches===false),initialConstraintRowsPass=constrainedRows.length===12&&constrainedRows.every(x=>x.status===200&&x.probes===1&&x.mode==='lite'&&x.mediaMatches===(x.setting==='os-reduced')&&(x.setting==='owner-lite'?x.reason==='owner-lite':x.setting==='os-reduced'&&x.reason==='reduced-motion'));const summary={sha,browser:browserVersion,rows:rows.length,errors,routeRows:normalRows.length,normalMotionRowsPass,liteRows:constrainedRows.filter(x=>x.mode==='lite').length,initialConstraintRowsPass};console.log(`::notice title=Route behaviour observations::${JSON.stringify(summary)}`);
if(errors.length||['real-reduced-motion-cancellation','repeated-preference-transitions'].some(kind=>!events.some(x=>x.kind===kind&&x.result==='PASS'))||summary.routeRows!==30||!normalMotionRowsPass||summary.liteRows!==12||!initialConstraintRowsPass||rows.some(x=>x.status!==200||x.probes!==1))process.exitCode=1;
