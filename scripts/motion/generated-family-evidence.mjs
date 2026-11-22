#!/usr/bin/env node
// Uses real authenticated Studio HTTP creation, generation, apply, preview and publication.
// Only the seeded disposable CI database is modified; entitlement is a synthetic fixture.
import puppeteer from 'puppeteer-core';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const base = new URL(process.env.BASE_URL || 'http://localhost:4100');
if (base.protocol !== 'http:' || !['localhost','127.0.0.1'].includes(base.hostname) || base.port !== '4100' || base.pathname !== '/' || process.env.CI !== 'true' || process.env.MOTION_ISOLATED !== '1' || process.env.DATABASE_URL !== 'postgresql://jata:jata@localhost:5432/jata_e2e?schema=public' || process.env.AUTH_SECRET !== 'interactive-business-e2e-test-secret') throw Error('Refusing non-disposable CI');
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(); if(sha!==process.env.EXPECTED_SHA) throw Error('HEAD mismatch');
const demoFixturePassword=process.env.DEMO_FIXTURE_PASSWORD;if(!demoFixturePassword)throw Error('Missing ephemeral DEMO_FIXTURE_PASSWORD');
const families=['cinematic','editorial','luxury','minimal','magazine','marketplace','product-first','storytelling','spatial','interactive-showroom','gallery','split-screen','fullscreen-media','scrollytelling','cardless-immersive','map-driven','catalog','portfolio','service-journey','experimental'];
const sizes=[[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]];
const baselineMode=process.env.MOTION_BASELINE_CAPTURE==='1';
const out='motion-family-evidence'; mkdirSync(out,{recursive:true});
const prisma=new PrismaClient(); const rows=[], steps=[];
const save=()=>writeFileSync(path.join(out,'observations.json'),JSON.stringify({sha,browser:browserVersion,captureMode:baselineMode?'historical-pre-motion-baseline':'candidate-after',rows,steps,limitations:'Synthetic isolated entitlement; real app generation, draft and publishing. Manual visual inspection remains separate; queue-stress and previous-build Lite comparison are not covered by this capture.'},null,2));
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']}); const browserVersion=await browser.version();
let fixture;
try {
 fixture=await prisma.business.findUniqueOrThrow({where:{slug:'marys-beauty-studio'},select:{id:true,ownerId:true,slug:true}});
 const plan=await prisma.planConfig.findUniqueOrThrow({where:{key:'INTERACTIVE_BUSINESS'}});
 // Replace only this seeded fixture's subscription in the disposable job database. No provider.
 await prisma.subscription.update({where:{businessId:fixture.id},data:{planId:plan.id,status:'ACTIVE',expiresAt:new Date(Date.now()+86400000*30),graceUntil:new Date(Date.now()+86400000*33)}});
 await prisma.business.update({where:{id:fixture.id},data:{logoUrl:'/workspace/hero-workspace.jpg'}});
 const owner=await browser.newPage(); await owner.goto(new URL('/login',base).href,{waitUntil:'domcontentloaded'});
 // Authenticate through the real server endpoint from the browser. Avoid typing into a
 // controlled React form before hydration; do not log the response body or session cookie.
 const login=await owner.evaluate(async(password)=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'demo@jata.link',password})});return r.status;},demoFixturePassword);
 steps.push({stage:'login',status:login}); if(login!==200) throw Error(`fixture login failed HTTP ${login}`);
 const api=(url,method='GET',payload)=>owner.evaluate(async(url,method,payload)=>{const r=await fetch(url,{method,headers:payload?{'content-type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});return {status:r.status,body:await r.json().catch(()=>null)};},url,method,payload);
 // Beauty's real publication gate requires a product; seed through the application's API.
 const product=await api('/api/products','POST',{businessId:fixture.id,name:'Fictional sample balm',basePriceKES:450,isActive:true});
 steps.push({stage:'sample-product',status:product.status}); if(![200,201].includes(product.status)) throw Error(`sample product failed: ${product.status}`);
 const created=await api('/api/experience','POST',{businessId:fixture.id,categoryKey:'beauty'}); steps.push({stage:'create',status:created.status});
 if(created.status!==201) throw Error(`create failed ${created.status}: ${JSON.stringify(created.body).slice(0,400)}`);
 for(const family of families){
  try {
   const generated=await api('/api/experience/variant','POST',{businessId:fixture.id,family,seed:`motion014-${family}`,...(family==='service-journey'?{brief:{goal:'browse'}}:{})});
   steps.push({family,stage:'generate',status:generated.status,accepted:generated.body?.accepted,actualFamily:generated.body?.candidate?.artDirection?.family});
   if(generated.status!==200 || generated.body?.candidate?.artDirection?.family!==family) throw Error(`generate ${family}: ${generated.status} ${JSON.stringify(generated.body).slice(0,250)}`);
   const applied=await api('/api/experience','PATCH',{businessId:fixture.id,expectedDraftVersion:generated.body.baseDraftVersion,document:generated.body.candidate});
   steps.push({family,stage:'apply',status:applied.status}); if(applied.status!==200) throw Error(`apply ${family}: ${applied.status} ${JSON.stringify(applied.body).slice(0,250)}`);
   for(const preview of [true,false]) {
    if(!preview) {
     const current=await prisma.businessExperience.findUniqueOrThrow({where:{businessId:fixture.id},select:{draftVersion:true}});
     const published=await api('/api/experience/publish','POST',{businessId:fixture.id,expectedDraftVersion:current.draftVersion});
     steps.push({family,stage:'publish',status:published.status}); if(published.status!==200) throw Error(`publish ${family}: ${published.status}; failed checks ${JSON.stringify(published.body?.validation?.checks?.filter(c=>c.status==='fail').map(c=>({id:c.id,hint:c.hint})) || published.body?.error).slice(0,800)}`);
    }
    for(const [width,height] of sizes) for(const reduced of [false,true]){
    const p=preview?owner:await browser.newPage();
    const route=`/b/${fixture.slug}${preview?'?preview=draft':''}`;
    const row={sha,browser:browserVersion,family,route,mode:preview?'authorized draft':'published',viewport:`${width}x${height}`,reduced};
    try {
     await p.setViewport({width,height,deviceScaleFactor:1}); await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]);
     const response=await p.goto(new URL(route,base).href,{waitUntil:'domcontentloaded',timeout:45000}); row.status=response?.status()??null;
     await p.waitForFunction(()=>Boolean(document.querySelector('.eb-scope')?.dataset.renderMode),{timeout:10000}).catch(()=>{});
     await p.waitForFunction(()=>{const bar=document.querySelector('.eb-actionbar');if(!bar)return true;const height=Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--eb-actionbar-h'));return bar.getBoundingClientRect().height>0&&height>0;},{timeout:5000}).catch(()=>{});
     row.observation=await p.evaluate(()=>{const r=document.querySelector('.eb-scope'); const ts=[...(r?.querySelectorAll('[data-motion-recipe]')||[])];const bar=document.querySelector('.eb-actionbar');const barRect=bar?.getBoundingClientRect();const barVisible=Boolean(barRect&&barRect.height>0&&getComputedStyle(bar).display!=='none');const hero=document.querySelector('.eb-hero');const heroContent=hero?.querySelector('.eb-hero__content,.eb-hero__grid')||hero;const heroText=[...(heroContent?.querySelectorAll('.eb-eyebrow,.eb-h1,.eb-lede,.eb-hero__actions')||[])];const rect=el=>{if(!el)return null;const b=el.getBoundingClientRect();return {top:+b.top.toFixed(1),right:+b.right.toFixed(1),bottom:+b.bottom.toFixed(1),left:+b.left.toFixed(1),width:+b.width.toFixed(1),height:+b.height.toFixed(1)};};const heroTextGeometry=heroText.map(el=>{const b=el.getBoundingClientRect();return {selector:typeof el.className==='string'?el.className:el.tagName,text:(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,90),rect:rect(el),overlapsActionBar:Boolean(barVisible&&b.width>0&&b.height>0&&b.bottom>barRect.top+1&&b.top<barRect.bottom-1)};});const heroTextOverlapsActionBar=heroTextGeometry.some(item=>item.overlapsActionBar);return {family:r?.dataset.templateFamily,mode:r?.dataset.renderMode,reason:r?.dataset.motionReason,engine:r?.dataset.motionEngine,probes:r?.querySelectorAll('[data-motion-probe]').length,targets:ts.length,played:ts.filter(e=>e.dataset.motionPlayed).length,heroCtaLabel:document.querySelector('.eb-hero__actions .eb-btn')?.textContent?.replace(/\\s+/g,' ').trim() || '',overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,actionBarPresent:barVisible,heroTextOverlapsActionBar,heroRect:rect(hero),heroContentRect:rect(heroContent),actionBarRect:rect(bar),heroContentPaddingBottom:heroContent?getComputedStyle(heroContent).paddingBottom:null,heroMinHeight:hero?getComputedStyle(hero).minHeight:null,actionBarHeightVariable:getComputedStyle(document.documentElement).getPropertyValue('--eb-actionbar-h').trim(),heroTextGeometry};});
     const name=`${family}-${preview?'draft':'published'}-${width}x${height}-${reduced?'reduced':'normal'}.jpg`; await p.screenshot({path:path.join(out,name),type:'jpeg',quality:45,fullPage:true}); row.screenshot=name;
     row.result=baselineMode?(row.status===200?'CAPTURED':'FAIL'):(row.status===200 && row.observation.family===family && row.observation.probes===1 && row.observation.heroCtaLabel.length>0 && !row.observation.heroTextOverlapsActionBar && row.observation.overflow<=0 && (!reduced || row.observation.mode==='lite')?'OBSERVED':'FAIL');
    }catch(e){row.result='ERROR';row.error=String(e).slice(0,400);}
    rows.push(row); save(); if(!preview) await p.close();
    }
   }
  }catch(e){steps.push({family,stage:'ERROR',error:String(e).slice(0,400)});save();}
 }
} catch(e){steps.push({stage:'BLOCKED',error:String(e).slice(0,800)});}
finally{save();await browser.close();await prisma.$disconnect();}
const expected=families.length*2*6*2; const successful=rows.filter(r=>r.result===(baselineMode?'CAPTURED':'OBSERVED')).length;
const summary={sha,browser:browserVersion,captureMode:baselineMode?'historical-pre-motion-baseline':'candidate-after',expected,rows:rows.length,successful,failures:rows.length-successful,provisioningErrors:steps.filter(s=>s.stage==='ERROR'||s.stage==='BLOCKED').slice(0,10)};
console.log(`::notice title=Generated family evidence::${JSON.stringify(summary)}`);
if(summary.rows!==summary.expected || summary.failures || summary.provisioningErrors.length) process.exitCode=1;
