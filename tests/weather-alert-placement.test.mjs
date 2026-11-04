import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveWeatherAlertPlacement as resolve,weatherAlertScope as scope} from '../app/weatherAlertPlacement.ts';
const now=Date.parse('2026-11-03T23:55:00Z');
const rain={displayText:'🌧️ RA METAR',code:'RA',sources:['METAR'],displayTone:'blue',pulse:false,flash:false};
const future={displayText:'⛈️ -TSRA PSBL 04 NOV 00-04Z',code:'-TSRA',sources:['TAF'],severity:'forecast',tafStartIso:'2026-11-04T00:00:00Z',displayTone:'yellow',pulse:true,flash:false};
const legacy={text:'🌧️ RA METAR → ⛈️ -TSRA PSBL 04 NOV 00-04Z',tone:'blue',pulse:false,flash:false,visible:true};
const context={metarObservedAt:'2026-11-03T23:53:00Z',metarStatus:'OK',atisObservedAt:'2026-11-03T23:45:00Z',atisStatus:'OK'};
const routed=(a=rain,b=future,l=legacy,c=context,n=now)=>resolve(a,b,l,c,n);

test('current plus future separate without changing either source-selected presentation',()=>{
 const r=routed();assert.equal(r.current.length,1);assert.equal(r.future.length,1);
 assert.deepEqual(r.current.map(s=>[s.text,s.colorClass,s.shouldPulse,s.shouldFlash,s.sourceTime,s.stale]),[['RA METAR','alert-blue',false,false,context.metarObservedAt,false]]);
 assert.deepEqual(r.future.map(s=>[s.text,s.colorClass,s.shouldPulse,s.shouldFlash,s.sourceTime]),[['-TSRA PSBL 04 NOV 00-04Z','alert-yellow',true,false,null]]);
});
test('forecast-only primary is not treated as current and ordering does not establish scope',()=>{
 for (const pair of [[future,null],[null,future]]) {const r=routed(...pair,{text:future.displayText,visible:true});assert.equal(r.current.length,0);assert.equal(r.future.length,1);}
 const r=routed(future,rain);assert.equal(r.current[0].text,'RA METAR');assert.equal(r.future[0].text,'-TSRA PSBL 04 NOV 00-04Z');
});
test('source type remains forecast even when its TAF window spans now or is stale',()=>{
 const r=routed({...future,tafStartIso:'2026-11-03T20:00:00Z'},null,{text:future.displayText});assert.equal(r.current.length,0);assert.equal(r.future.length,1);
});
test('current-only does not create an alert in Future Weather',()=>{
 const r=routed(rain,null,{...legacy,text:rain.displayText});assert.equal(r.current.length,1);assert.equal(r.future.length,0);
});
test('most restrictive source selection is not recomputed and visible suffix chooses correct observation',()=>{
 const r=routed({...rain,displayText:'🌧️ +RA METAR',sources:['ATIS','METAR'],displayTone:'red',flash:true},future,{...legacy,text:'🌧️ +RA METAR → '+future.displayText});
 assert.equal(r.current[0].text,'+RA METAR');assert.equal(r.current[0].sourceTime,context.metarObservedAt);assert.equal(r.current[0].colorClass,'alert-red');assert.equal(r.current[0].shouldFlash,true);
 const atis=routed({...rain,displayText:'🌧️ RA ATIS',sources:['ATIS','METAR']},future);assert.equal(atis.current[0].sourceTime,context.atisObservedAt);
});
test('per-segment animation and reduced motion preserve colors across routing',()=>{
 const r=routed({...rain,displayTone:'red',flash:true},future,{...legacy,reducedMotion:true});assert.equal(r.current[0].colorClass,'alert-red');assert.equal(r.future[0].colorClass,'alert-yellow');
 for (const s of [...r.current,...r.future]) {assert.equal(s.shouldPulse,false);assert.equal(s.shouldFlash,false);}
});
test('legacy arrow/pipe records split into current and forecast while preserving legacy color/effects',()=>{
 for (const sep of [' → ',' | ']) {const r=routed(null,null,{...legacy,text:rain.displayText+sep+future.displayText});assert.equal(r.current[0].text,'RA METAR');assert.equal(r.future[0].text,'-TSRA PSBL 04 NOV 00-04Z');assert.equal(r.future[0].colorClass,'alert-blue');assert.equal(r.future[0].shouldPulse,false);}
});
test('compressed same-code legacy forecast stays forecast and structured pair never duplicates it',()=>{
 const same={...future,displayText:'🌧️ RA PSBL 04 NOV 00-04Z',code:'RA'};
 const l={...legacy,text:'🌧️ RA METAR → PSBL 04 NOV 00-04Z'};
 const structured=routed(rain,same,l);assert.equal(structured.current.length,1);assert.equal(structured.future.length,1);assert.equal(structured.future[0].text,'RA PSBL 04 NOV 00-04Z');
 const old=routed(null,null,l);assert.equal(old.current[0].text,'RA METAR');assert.equal(old.future[0].text,'RA PSBL 04 NOV 00-04Z');
});
test('missing malformed secondary recovers legacy forecast instead of silently dropping it',()=>{
 for (const broken of [null,{},[],7,{displayText:9}]) {const r=routed(rain,broken);assert.equal(r.current.length,1);assert.equal(r.future.length,1);assert.equal(r.future[0].text,'-TSRA PSBL 04 NOV 00-04Z');}
});
test('malformed primary recovers legacy current without duplicating valid forecast',()=>{
 const r=routed({text:5},future);assert.equal(r.current.length,1);assert.equal(r.future.length,1);
});
test('all malformed structured records retain the usable legacy message',()=>{
 const r=routed({text:5},{displayText:[]},{text:'UNCLASSIFIED SOURCE MESSAGE +RAW/123Z',tone:'red',flash:true});
 assert.equal(r.current.length,1);assert.equal(r.current[0].scope,'unverified');assert.equal(r.current[0].text,'UNCLASSIFIED SOURCE MESSAGE +RAW/123Z');assert.equal(r.future.length,0);
});
test('manual and contradictory scope stays neutral, never a false current or forecast',()=>{
 for (const [value,message] of [[{sources:['MANUAL']},'THUNDER'],[{sources:['METAR','TAF']},'TSRA'],[{sources:['TAF']},'RA ATIS'],[null,'RA METAR PSBL 00-04Z']]) assert.equal(scope(value,message),'unverified');
});
test('explicit legacy observations and forecast windows route without inventing NOW',()=>{
 for (const message of ['TS OVER FIELD','RAIN NOW','FOG ATIS','SN METAR']) assert.equal(scope(null,message),'current');
 for (const message of ['VCSH PSBL 00-04Z','TSRA WARNING 04 NOV 00–04Z','TAF VCTS']) assert.equal(scope(null,message),'forecast');
 assert.equal(routed().current[0].text.includes('NOW'),false);
});
test('stale or future-dated source keeps warning but never regains freshness from fetch time',()=>{
 for(const c of [{...context,metarObservedAt:'2026-11-03T21:00:00Z'},{...context,metarObservedAt:'2026-11-04T01:00:00Z'},{...context,metarStatus:'USED_LAST_GOOD'}]) {const r=routed(rain,null,{text:rain.displayText},c);assert.equal(r.current[0].stale,true);assert.equal(r.current[0].text,'RA METAR');}
});
test('source expiry applies its own METAR75/ATIS90 minute limit',()=>{
 const c={...context,metarObservedAt:'2026-11-03T22:35:00Z',atisObservedAt:'2026-11-03T22:35:00Z'};
 assert.equal(routed(rain,null,{text:rain.displayText},c).current[0].stale,true);
 const atis={...rain,displayText:'RA ATIS',sources:['ATIS']};assert.equal(routed(atis,null,{text:atis.displayText},c).current[0].stale,false);
});
test('unknown or malformed provenance stays time-unverified and never borrows METAR for ATIS',()=>{
 for(const c of [{},null,{metarObservedAt:'bad'},{metarObservedAt:'2026-11-03 23:53'},{metarObservedAt:12}]) {const r=routed(rain,null,{text:rain.displayText},c);assert.equal(r.current[0].sourceTime,null);assert.equal(r.current[0].stale,false);}
 const a={...rain,displayText:'RA ATIS',sources:['ATIS']};assert.equal(routed(a,null,{text:a.displayText},{metarObservedAt:context.metarObservedAt}).current[0].sourceTime,null);
});
test('debug forecast remains future-only and debug none suppresses live alerts',()=>{
 const r=routed(null,null,{text:'⛈️ TSRA WARNING 05 AUG 21–22Z',tone:'red',flash:true,visible:true});assert.equal(r.current.length,0);assert.equal(r.future[0].shouldFlash,true);
 assert.deepEqual(routed(rain,future,{...legacy,visible:false}),{current:[],future:[]});
 assert.deepEqual(routed(null,null,{text:'NONE'}),{current:[],future:[]});
});

test('legacy WX ALERT prefix never creates a synthetic hazard',()=>{
 assert.deepEqual(routed(null,null,{text:'WX ALERT | NONE',visible:true}),{current:[],future:[]});
 const r=routed(null,null,{...legacy,text:'WX ALERT | '+legacy.text});assert.equal(r.current.length,1);assert.equal(r.future.length,1);
});
test('invalid calendar dates are time-unverified rather than normalized into a fresh report',()=>{
 const r=routed(rain,null,{text:rain.displayText},{metarObservedAt:'2026-02-30T12:00:00Z'},Date.parse('2026-03-02T12:05:00Z'));assert.equal(r.current[0].sourceTime,null);
});
test('an explicit manual source is not interpreted as an observation from words alone',()=>{
 assert.equal(scope({sources:['MANUAL']},'TS ATIS'),'unverified');
});
test('unmatched manual summary wording is retained alongside structured reports',()=>{
 const r=routed(rain,future,{text:'MANUAL FIELD NOTICE',tone:'red',flash:true});assert.equal(r.current.length,2);assert.equal(r.current[1].text,'MANUAL FIELD NOTICE');assert.equal(r.current[1].scope,'unverified');
});


test('TAF NOW windows remain forecasts rather than becoming current weather',()=>{
 for(const [value,message] of [[{sources:['TAF'],severity:'forecast',tafWindow:'NOW-04Z'},'VCTS PSBL NOW-04Z'],[null,'VCTS PSBL NOW-04Z'],[null,'TSRA TAF NOW'],[{sources:['TAF']},'VCTS NOW'],[{sources:['TAF']},'TS OVER FIELD']]) assert.equal(scope(value,message),'forecast');
 const active={...future,displayText:'⛈️ VCTS PSBL NOW-04Z',code:'VCTS',tafWindow:'NOW-04Z'};
 const r=routed(rain,active,{...legacy,text:rain.displayText+' → '+active.displayText});assert.equal(r.current.length,1);assert.equal(r.current[0].text,'RA METAR');assert.equal(r.future.length,1);assert.equal(r.future[0].text,'VCTS PSBL NOW-04Z');
 assert.equal(scope(null,'RAIN NOW'),'current');
});
