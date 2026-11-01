import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../app/layout-tuning.css",import.meta.url),"utf8");

test("WX alert band consumes one normalized Ops Board display result",()=>{
  assert.match(page,/const alertDisplay=resolveWxAlertDisplay\(/);
  assert.match(page,/alertDisplay\.shouldPulse/);
  assert.match(page,/alertDisplay\.shouldFlash/);
  assert.match(page,/alertDisplay\.colorClass\.replace\("alert-",""\)/);
  assert.match(page,/tone=\{hazardTone\}/);
  assert.doesNotMatch(page,/weather\.wxAlertVisible\?weather\.wxAlertTone:lightning\.tone/);
  assert.doesNotMatch(page,/taf-hazard-band[^\n]+style=\{\{/);
});

test("legacy Ops Board palette and keyframes remain available to the shared warning treatment",()=>{
  assert.match(css,/\.taf-hazard-band\[data-tone="blue"\][^{]*\{[^}]*#35b7ff/);
  assert.match(css,/\.taf-hazard-band\[data-tone="yellow"\][^{]*\{[^}]*#ffcc00/);
  assert.match(css,/\.taf-hazard-band\[data-tone="red"\][^{]*\{[^}]*#ff4444/);
  assert.match(css,/\.taf-hazard-band\.alert-pulse em\s*\{[^}]*opsAlertPulse 0\.82s/);
  assert.match(css,/\.taf-hazard-band\.alert-flash em\s*\{[^}]*opsAlertFlash 1s step-start/);
  assert.match(css,/@keyframes opsAlertFlash\s*\{[^}]*0% \{ opacity: 1; \}[^}]*50% \{ opacity: 0\.25; \}/s);
  assert.match(css,/\.taf-hazard-band em\s*\{[^}]*font-family: Arial, sans-serif/s);
  assert.match(css,/\.taf-hazard-band\s*\{[^}]*border: 1\.5px solid #333/s);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.taf-hazard-band\.alert-pulse em[\s\S]*animation: none !important/);
});

// Exercise the actual page normalization helper without mounting the full clock.
import ts from 'typescript';
import {NO_LIGHTNING,parseCurrentLightning,lightningForAnimation,lightningAnimationEligible} from '../app/lightning.ts';
import {resolveLightningDisplay} from '../app/alertPresentation.ts';
const helper=page.slice(page.indexOf('function resolveCurrentLightning('),page.indexOf('async function getWeather('));
const normalize=new Function('NO_LIGHTNING',ts.transpileModule(helper,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText+';return resolveCurrentLightning;')(NO_LIGHTNING);
const atisOps={lightningSource:'ATIS',atisObservedZ:'2026-11-01T07:54:00Z',atisFetchStatus:'OK',metarObservedZ:'2026-11-01T07:00:00Z',metarFetchStatus:'OK'};
const lightDisplay=r=>resolveLightningDisplay({text:r.awareness,level:r.level,tone:r.tone,flash:r.flash,pulse:r.pulse,isStale:r.isStale,sourceTime:r.sourceTime});

test('selected ATIS lightning overrides conflicting raw METAR and retains ATIS observation provenance',()=>{
 const raw=parseCurrentLightning('METAR KMEM 010700Z 18010KT 3SM TSRA BKN020 20/19 A3000');
 const r=normalize({...atisOps,lightningSeverity:'distant',lightning:'⚡ DSNT NW-E 10-30 NM',lightningTone:'yellow',lightningFlash:false,lightningPulse:true},raw);
 assert.equal(r.level,'distant');assert.equal(r.source,'ops-feed');assert.equal(r.sourceTime,atisOps.atisObservedZ);
 assert.equal(r.awareness,'⚡ DSNT NW-E 10-30 NM');assert.equal(lightDisplay(r).colorClass,'lightning-yellow');
});

test('active ATIS lightning warning survives a METAR with no thunder and distant visual changes',()=>{
 for(const lightningSeverity of ['active_field','station','severe','warning']) {
  const r=normalize({...atisOps,lightningSeverity,lightning:'TS OVER FIELD',lightningTone:'red',lightningFlash:true,lightningPulse:false},NO_LIGHTNING);
  const shown=lightDisplay(r);assert.equal(shown.colorClass,'lightning-red');assert.equal(shown.severity,'warning');assert.equal(shown.shouldFlash,true);
  const reduced=resolveLightningDisplay({...shown,level:r.level,tone:r.tone,flash:r.flash,pulse:r.pulse,reducedMotion:true});
  assert.equal(reduced.colorClass,'lightning-red');assert.equal(reduced.shouldFlash,false);
 }
});

test('stale ATIS threat remains visibly a threat while illustrative lightning animation stops',()=>{
 const r=normalize({...atisOps,atisFetchStatus:'STALE_SOURCE',lightningSeverity:'station',lightning:'TS OVER FIELD',lightningTone:'red',lightningFlash:true},NO_LIGHTNING);
 assert.equal(r.isStale,true);assert.equal(lightDisplay(r).colorClass,'lightning-red');assert.equal(lightDisplay(r).isStale,true);
 assert.equal(lightningAnimationEligible(lightningForAnimation(r,null,Date.parse('2026-11-01T08:30:00Z'))),false);
});

test('missing Ops lightning classification retains raw METAR warning rather than creating an all-clear',()=>{
 const raw=parseCurrentLightning('METAR KMEM 010754Z 18010KT 3SM TSRA BKN020 20/19 A3000');
 assert.deepEqual(normalize({metarObservedZ:atisOps.metarObservedZ},raw),{...raw,sourceTime:atisOps.metarObservedZ,isStale:false});assert.equal(lightDisplay(normalize({},raw)).colorClass,'lightning-red');
});
