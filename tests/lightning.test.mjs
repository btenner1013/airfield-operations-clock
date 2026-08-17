import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync,readdirSync } from "node:fs";
import { join } from "node:path";
import { compactLightningDisplay,createLightningScheduler,lightningAnimationEligible,lightningQuietRange,parseCurrentLightning } from "../app/lightning.ts";
import { resolveLightningDisplay } from "../app/alertPresentation.ts";

const metar=body=>parseCurrentLightning(`METAR KMEM 201853Z 18008KT 10SM ${body} 30/20 A2992`);

test("METAR body thunderstorm levels follow operational precedence",()=>{
  assert.equal(metar("VCTS SCT040CB").level,"vicinity");
  assert.equal(metar("TS BKN030CB").level,"station");
  assert.equal(metar("TSRA BKN030CB").level,"station");
  assert.equal(metar("-TSRA BKN030CB").level,"station");
  assert.equal(metar("+TSRA BKN015CB").level,"severe");
  assert.equal(metar("TSSN BKN020CB").level,"station");
  assert.equal(metar("TSGR BKN020CB").level,"station");
  assert.equal(metar("+TSGS BKN015CB").level,"severe");
});

test("rain, showers, hail, pellets and convective clouds do not invent lightning",()=>{
  for(const body of ["RA BKN030","SHRA BKN030","VCSH SCT040","GR BKN030","GS BKN030","PL BKN030","SCT040CB","BKN030TCU"]) assert.equal(metar(body).level,"none",body);
});

test("explicit lightning remarks parse frequency, type, distance and direction",()=>{
  const occasional=metar("SCT040 RMK OCNL LTGIC DSNT NE AND NW");
  assert.equal(occasional.level,"distant");assert.equal(occasional.source,"metar-remarks");assert.equal(occasional.code,"LTGIC");assert.equal(occasional.frequency,"occasional");assert.deepEqual(occasional.types,["IC"]);assert.deepEqual(occasional.directions,["NE","NW"]);assert.equal(occasional.awareness,"OCNL LTGIC DSNT NE–NW");assert.equal(occasional.tone,"yellow");assert.equal(occasional.flash,false);assert.equal(occasional.pulse,true);
  const frequent=metar("SCT040 RMK FRQ LTGCG DSNT W");
  assert.equal(frequent.level,"distant");assert.equal(frequent.frequency,"frequent");assert.deepEqual(frequent.types,["CG"]);assert.deepEqual(frequent.directions,["W"]);assert.equal(frequent.awareness,"FRQ LTGCG DSNT W");
  assert.equal(metar("SCT040 RMK CB DSNT NE").level,"none");
});

test("body evidence outranks remarks and remarks never weaken it",()=>{
  const report=metar("+TSRA BKN015CB RMK OCNL LTGIC DSNT NE");
  assert.equal(report.level,"severe");assert.equal(report.source,"metar-body");assert.equal(report.code,"+TSRA");
});

test("lightning text presentation matches Ops Board tone and motion rules",()=>{
  const field=metar("TSRA BKN030CB"),vicinity=metar("VCTS SCT040CB"),distant=metar("SCT040 RMK FRQ LTGCG DSNT W");
  assert.deepEqual({tone:field.tone,flash:field.flash,pulse:field.pulse},{tone:"red",flash:true,pulse:false});
  assert.deepEqual({tone:vicinity.tone,flash:vicinity.flash,pulse:vicinity.pulse},{tone:"yellow",flash:false,pulse:true});
  assert.deepEqual({tone:distant.tone,flash:distant.flash,pulse:distant.pulse},{tone:"yellow",flash:false,pulse:true});
});

test("visible lightning wording matches the compact Ops Board display",()=>{
  assert.equal(compactLightningDisplay("⚡ DSNT S 10-30 NM"),"⚡ DSNT S");
  assert.equal(compactLightningDisplay("⚡ DSNT NE AND NW 10-30 NM"),"⚡ DSNT NE/NW");
  assert.equal(compactLightningDisplay("OCNL LTGIC DSNT NE–NW"),"⚡ DSNT NE-NW");
  assert.equal(compactLightningDisplay("LTG DSNT S"),"⚡ DSNT S");
  assert.equal(compactLightningDisplay("⚡ VCTS 5-10 NM"),"⚡ VCTS");
  assert.equal(compactLightningDisplay("⛈️ TS OVER FIELD"),"⛈️ TS OVR FIELD");
  assert.equal(compactLightningDisplay("⛈️ TSRA ACTIVE NOW"),"⛈️ TSRA ACTIVE");
});

test("only explicit body thunderstorms own animated lightning",()=>{
  assert.equal(lightningAnimationEligible(metar("TS BKN030CB")),true);
  assert.equal(lightningAnimationEligible(metar("TSRA BKN030CB")),true);
  assert.equal(lightningAnimationEligible(metar("+TSRA BKN015CB")),true);
  assert.equal(lightningAnimationEligible(metar("VCTS SCT040CB")),true);
  assert.equal(lightningAnimationEligible(metar("SCT040 RMK FRQ LTGCG DSNT W")),false);
  assert.equal(lightningAnimationEligible(metar("SCT040 RMK LTGCG OHD")),false);
  assert.equal(lightningAnimationEligible({...metar("TSRA BKN030CB"),source:"none"}),false);
});

test("the live ops feed animates an observed field thunderstorm the same as a direct METAR",()=>{
  // The board's normal path relays METAR/ATIS lightning through the ops feed, so a
  // TS over the field must animate rather than only render the awareness row.
  const feed=(over,level="station")=>({...metar(over),source:"ops-feed",level});
  assert.equal(lightningAnimationEligible(feed("TS BKN030CB")),true);
  assert.equal(lightningAnimationEligible(feed("TSRA BKN030CB")),true);
  assert.equal(lightningAnimationEligible(feed("VCTS SCT040CB","vicinity")),true);
  // Remarks-only and distant reports stay unanimated on the feed path too.
  assert.equal(lightningAnimationEligible(feed("SCT040 RMK FRQ LTGCG DSNT W","distant")),false);
  assert.equal(lightningAnimationEligible(feed("SCT040 RMK LTGCG OHD")),false);
  assert.equal(lightningAnimationEligible({...feed("TS BKN030CB"),level:"none"}),false);
});

test("quiet ranges remain irregular, level-specific, and operationally restrained",()=>{
  assert.deepEqual(lightningQuietRange("distant"),[20000,45000]);assert.deepEqual(lightningQuietRange("vicinity"),[10000,25000]);assert.deepEqual(lightningQuietRange("station"),[7000,18000]);assert.deepEqual(lightningQuietRange("severe"),[4000,12000]);
});

class FakeTimers {
  now=0;next=1;tasks=new Map();
  set=(fn,delay)=>{const id=this.next++;this.tasks.set(id,{at:this.now+delay,fn});return id;};
  clear=id=>this.tasks.delete(id);
  advance(ms){const target=this.now+ms;while(true){const ready=[...this.tasks.entries()].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!ready)break;this.now=ready[1].at;this.tasks.delete(ready[0]);ready[1].fn();}this.now=target;}
}
class FakeVisibility {
  visibilityState="visible";listeners=new Set();
  addEventListener=(name,fn)=>{if(name==="visibilitychange")this.listeners.add(fn);};
  removeEventListener=(name,fn)=>{if(name==="visibilitychange")this.listeners.delete(fn);};
  fire(){for(const fn of this.listeners)fn();}
}
const station=metar("TS BKN030CB");

test("distant remark lightning has no flash timers, pulses, bolts, or visibility listener",()=>{
  const timers=new FakeTimers(),visibility=new FakeVisibility(),states=[];
  const distant=metar("SCT040 RMK FRQ LTGCG DSNT W");
  const scheduler=createLightningScheduler(distant,{setTimer:timers.set,clearTimer:timers.clear,visibilityTarget:visibility,onState:s=>states.push(s)});
  scheduler.start();timers.advance(120000);
  assert.equal(scheduler.pendingCount(),0);assert.equal(visibility.listeners.size,0);
  assert.ok(states.every(s=>s.pulse===0&&!s.bolt&&!s.active));scheduler.stop();
});

test("one scheduler cancels hidden timers and restores only a future cluster",()=>{
  const timers=new FakeTimers(),visibility=new FakeVisibility(),states=[];
  const scheduler=createLightningScheduler(station,{random:()=>0,setTimer:timers.set,clearTimer:timers.clear,visibilityTarget:visibility,onState:s=>states.push(s)});
  scheduler.start();assert.equal(scheduler.pendingCount(),1);assert.equal(visibility.listeners.size,1);assert.equal(states.at(-1).pulse,0);
  visibility.visibilityState="hidden";visibility.fire();assert.equal(scheduler.pendingCount(),0);assert.equal(states.at(-1).active,false);
  visibility.visibilityState="visible";visibility.fire();assert.equal(scheduler.pendingCount(),1);assert.equal(states.at(-1).pulse,0);
  timers.advance(6999);assert.equal(states.at(-1).pulse,0);timers.advance(1);assert.equal(states.at(-1).pulse,1);
  scheduler.stop();assert.equal(scheduler.pendingCount(),0);assert.equal(visibility.listeners.size,0);assert.equal(scheduler.isStopped(),true);
});

test("flash test is deterministic, bounded to two pulses, and does not repeat",()=>{
  const timers=new FakeTimers(),visibility=new FakeVisibility(),states=[];
  const scheduler=createLightningScheduler(station,{flashTest:true,setTimer:timers.set,clearTimer:timers.clear,visibilityTarget:visibility,onState:s=>states.push(s)});
  scheduler.start();timers.advance(650);timers.advance(500);
  const pulses=states.filter(s=>s.pulse>0);assert.deepEqual(pulses.map(s=>s.pulse),[1,2]);assert.equal(pulses[0].bolt,true);assert.equal(scheduler.pendingCount(),0);scheduler.stop();
});

test("reduced motion suppresses timers, animated pulses, bolts, and listeners",()=>{
  const timers=new FakeTimers(),visibility=new FakeVisibility(),states=[];
  const scheduler=createLightningScheduler(station,{reduced:true,setTimer:timers.set,clearTimer:timers.clear,visibilityTarget:visibility,onState:s=>states.push(s)});
  scheduler.start();assert.equal(scheduler.pendingCount(),0);assert.equal(visibility.listeners.size,0);assert.ok(states.every(s=>s.pulse===0&&!s.bolt));scheduler.stop();
});

test("integration keeps current lightning on METAR authority and TAF forecast-only",()=>{
  const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8"),hook=readFileSync(new URL("../app/useLightning.ts",import.meta.url),"utf8"),css=readFileSync(new URL("../app/lightning.css",import.meta.url),"utf8"),layout=readFileSync(new URL("../app/layout.tsx",import.meta.url),"utf8");
  assert.match(page,/currentLightning=parseCurrentLightning\(raw\)/);assert.doesNotMatch(page,/parseCurrentLightning\(rawTaf\)/);assert.match(page,/currentLightning:metar\?\.currentLightning\?\?model\.currentLightning/);
  assert.equal((page.match(/useLightningScheduler\(mainRef/g)||[]).length,1);assert.doesNotMatch(hook,/requestAnimationFrame|setInterval/);assert.match(hook,/visibilityTarget:document/);
  assert.doesNotMatch(css,/@keyframes/);assert.match(css,/\.lightning-awareness\{[^}]*font-family:Arial,sans-serif!important/);assert.match(css,/\.lightning-awareness\{[^}]*animation:none!important/);assert.match(css,/\.lightning-awareness\.alert-pulse\{animation:opsAlertPulse \.95s/);assert.match(css,/\.lightning-awareness\.alert-flash\{animation:opsAlertFlash 1s/);assert.ok(layout.lastIndexOf('".\/lightning.css"')>layout.lastIndexOf('".\/clock.css"'));
  assert.doesNotMatch(page,/taf-hazard-band[^\n]+style=\{\{[^}]*#ffcc00/);assert.match(page,/data-tone=\{hazardTone\}/);
  const roots=[new URL("../app",import.meta.url),new URL("../public",import.meta.url)];const source=[];for(const root of roots)for(const file of readdirSync(root)){if(/\.(?:ts|tsx|css|json|js)$/.test(file))source.push(readFileSync(join(root.pathname.slice(1),file),"utf8"));}
  const forbidden=["manual","alert.json"].join("_");const closure=["FLT","LINE","CLOSED"].join(" ");assert.ok(source.every(text=>!text.includes(forbidden)&&!text.includes(closure)));
});

test("a quiet lightning report renders no awareness row at all",()=>{
  const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
  // The row is an exception line: "NONE" must never occupy space in Current Weather.
  assert.match(page,/\{lightningDisplay\.severity!=="none"&&\(\s*<small className=\{`lightning-awareness/);
  assert.equal(resolveLightningDisplay({text:null,level:"none",tone:"green"}).severity,"none");
  assert.equal(resolveLightningDisplay({text:"⚡ DSNT NE",level:"distant",tone:"yellow"}).severity,"caution");
  assert.equal(resolveLightningDisplay({text:"⛈️ TS OVR FIELD",level:"station",tone:"red"}).severity,"warning");
});
