import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync,readdirSync } from "node:fs";
import { join } from "node:path";
import { createLightningScheduler,lightningQuietRange,parseCurrentLightning } from "../app/lightning.ts";

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
  assert.deepEqual(occasional,{level:"distant",source:"metar-remarks",code:"LTGIC",frequency:"occasional",types:["IC"],directions:["NE","NW"],awareness:"OCNL LTGIC DSNT NE–NW"});
  const frequent=metar("SCT040 RMK FRQ LTGCG DSNT W");
  assert.equal(frequent.level,"distant");assert.equal(frequent.frequency,"frequent");assert.deepEqual(frequent.types,["CG"]);assert.deepEqual(frequent.directions,["W"]);assert.equal(frequent.awareness,"FRQ LTGCG DSNT W");
  assert.equal(metar("SCT040 RMK CB DSNT NE").level,"none");
});

test("body evidence outranks remarks and remarks never weaken it",()=>{
  const report=metar("+TSRA BKN015CB RMK OCNL LTGIC DSNT NE");
  assert.equal(report.level,"severe");assert.equal(report.source,"metar-body");assert.equal(report.code,"+TSRA");
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
  assert.doesNotMatch(css,/@keyframes/);assert.match(css,/animation:none!important/);assert.ok(layout.lastIndexOf('".\/lightning.css"')>layout.lastIndexOf('".\/clock.css"'));
  const roots=[new URL("../app",import.meta.url),new URL("../public",import.meta.url)];const source=[];for(const root of roots)for(const file of readdirSync(root)){if(/\.(?:ts|tsx|css|json|js)$/.test(file))source.push(readFileSync(join(root.pathname.slice(1),file),"utf8"));}
  const forbidden=["manual","alert.json"].join("_");const closure=["FLT","LINE","CLOSED"].join(" ");assert.ok(source.every(text=>!text.includes(forbidden)&&!text.includes(closure)));
});
