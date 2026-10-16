import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {normalizeCurrentOpsWeather,normalizeReportedTrend,resolveCurrentWeatherReadings} from '../app/currentWeatherTrends.ts';
import {getFlightCategory} from '../app/currentSky.ts';
import {mergeWeather} from '../app/weatherRefresh.ts';
const now=Date.parse('2026-10-16T22:56:00Z');
function payload(overrides={}) {
 return {
  allFeedsUpdatedZ:'2026-10-16 22:55Z',trendLookbackHours:3,trendReferenceSource:'3HR_HISTORY',trendReferenceTimestampZ:'2026-10-16T19:55:42Z',trendSampleCount:22,
  metar:'METAR KMEM 162154Z 35011G20KT 10SM BKN065 17/03 A3025',metarObservedZ:'2026-10-16T21:54:00Z',metarFetchStatus:'WARN_SOURCE',metarAgeMinutes:62,
  atisObservedZ:'2026-10-16T22:54:00Z',atisFetchStatus:'OK',atisAgeMinutes:2,atisSourceIsCurrent:true,lastKnownGoodUsed:{metar:false,atis:false},
  obsFieldSources:{ceiling:'METAR',visibility:'ATIS',tempDp:'ATIS'},ceilingFt:6500,ceilingDisplay:'6500 FT',metarCeilingFt:6500,atisCeilingFt:null,
  visibilitySm:10,visibilityDisplay:'10 SM',metarVisibilitySm:10,atisVisibilitySm:10,tempC:17,
  ceilingTrend:'↓',ceilingTrendText:'FALLING',visibilityTrend:'→',visibilityTrendText:'STEADY',tempTrend:'▲',tempTrendText:'RISING',...overrides,
 };
}
const weather=(data=payload(),overrides={})=>({currentOpsWeather:normalizeCurrentOpsWeather(data),requestStatus:'IDLE',feedStatus:'DEGRADED',...overrides});
const read=(data=payload(),at=now,overrides={})=>resolveCurrentWeatherReadings(weather(data,overrides),at);
const directions=t=>Object.fromEntries(Object.entries(t.trends).map(([k,v])=>[k,v?.direction??null]));
const none={ceiling:null,visibility:null,temperature:null};
const expected={ceiling:'down',visibility:'steady',temperature:'up'};
const fields=r=>({ceiling:r.ceiling?.display??null,visibility:r.visibility?.display??null,temperature:r.temperature?.display??null});

test('initial successful JSON snapshot shows canonical readings and reported trends without any session baseline',()=>{
 const current=read();
 assert.deepEqual(fields(current),{ceiling:'6,500 FT',visibility:'10 SM',temperature:'63'});
 assert.deepEqual(directions(current),expected);assert.equal(current.usesOps,true);
 assert.equal(current.trends.ceiling.referenceAt,'2026-10-16T19:55:42.000Z');
 assert.match(current.ceiling.title,/METAR.*WARN_SOURCE/);assert.match(current.temperature.title,/ATIS/);
 assert.deepEqual(directions(read()),expected); // unchanged fetches retain the JSON direction
});

test('canonical actual readings override divergent METAR and rounded/model values without changing the weather engine',()=>{
 const data=payload({visibilitySm:2,visibilityDisplay:'2 SM',atisVisibilitySm:2,tempC:19,ceilingFt:900,ceilingDisplay:'900 FT',atisCeilingFt:900,obsFieldSources:{ceiling:'ATIS',visibility:'ATIS',tempDp:'ATIS'}});
 const source=weather(data,{temperatureF:80,feelsLikeF:999,visibilitySm:10,cloudBaseFt:6500,cloudCoverage:'BKN',source:'METAR'}),copy=structuredClone(source);
 const r=resolveCurrentWeatherReadings(source,now);
 assert.equal(r.temperature.display,'66');assert.equal(r.visibility.value,2);assert.equal(r.ceiling.value.feet,900);
 assert.deepEqual(directions(r),expected);assert.deepEqual(source,copy);
 assert.equal(getFlightCategory(r.visibility.value,r.ceiling.value.feet,'BKN',true).cat,'IFR');
});

test('symbol/text validation accepts upstream arrow variants, never manufactures a steady default',()=>{
 for(const [symbols,text,direction] of [[['↑','▲'],'RISING','up'],[['↓','▼'],'FALLING','down'],[['→','►','▶'],'STEADY','steady']]) for(const symbol of symbols) assert.equal(normalizeReportedTrend(symbol,text),direction);
 for(const args of [[null,'STEADY'],['','STEADY'],['?','STEADY'],['→',null],['▲','FALLING'],['→','N/A'],[0,0],['up','RISING']]) assert.equal(normalizeReportedTrend(...args),null);
 const r=read(payload({ceilingTrend:'?',visibilityTrendText:undefined,tempTrendText:'FALLING'}));
 assert.deepEqual(directions(r),none);assert.deepEqual(fields(r),fields(read()));
});

test('bad or fallback trend reference suppresses arrows, while independently valid current values remain',()=>{
 for(const overrides of [{trendReferenceSource:'LAST_GOOD_FALLBACK'},{trendReferenceSource:undefined},{trendLookbackHours:undefined},{trendLookbackHours:'3'},{trendLookbackHours:6},{trendReferenceTimestampZ:'LAST_GOOD_FALLBACK'},{trendReferenceTimestampZ:undefined},{trendReferenceTimestampZ:'2026-10-16T22:56:00Z'},{trendReferenceTimestampZ:'2026-10-16T19:50:00Z'},{trendSampleCount:0},{trendSampleCount:2.5},{trendSampleCount:'22'}]) {
  const r=read(payload(overrides));assert.deepEqual(directions(r),none,JSON.stringify(overrides));assert.deepEqual(fields(r),fields(read()));
 }
 // The updater uses the oldest available sample inside the 3-hour window, not necessarily three hours ago.
 assert.deepEqual(directions(read(payload({trendReferenceTimestampZ:'2026-10-16T22:45:42Z',trendSampleCount:1}))),expected);
});

test('generation age is rechecked on ticks and frozen JSON cannot renew observations',()=>{
 const w=weather(payload({metarObservedZ:'2026-10-16T22:54:00Z',metarAgeMinutes:2}));
 assert.deepEqual(directions(resolveCurrentWeatherReadings(w,Date.parse('2026-10-16T23:14:59.999Z'))),expected);
 assert.deepEqual(fields(resolveCurrentWeatherReadings(w,Date.parse('2026-10-16T23:15:00Z'))),none);
 for(const updated of [undefined,'bad','2026-10-16T22:55:00','2026-02-30T22:55:00Z','2026-10-16T22:35:00Z','2026-10-16T23:01:00.001Z']) assert.deepEqual(fields(read(payload({allFeedsUpdatedZ:updated}))),none,String(updated));
 assert.deepEqual(directions(read(payload({allFeedsUpdatedZ:'2026-10-16T23:01:00Z',trendReferenceTimestampZ:'2026-10-16T20:05:00Z'}))),expected);
});

test('source-specific hard stale boundaries accept usable WARN_SOURCE and age independently',()=>{
 const data=payload({metarObservedZ:'2026-10-16T21:41:00.001Z',metarAgeMinutes:74,atisObservedZ:'2026-10-16T21:26:00.001Z',atisAgeMinutes:89,atisFetchStatus:'WARN_SOURCE'});
 assert.deepEqual(directions(read(data)),expected);
 assert.deepEqual(fields(read({...data,metarObservedZ:'2026-10-16T21:41:00Z'})),{ceiling:null,visibility:'10 SM',temperature:'63'});
 assert.deepEqual(fields(read({...data,atisObservedZ:'2026-10-16T21:26:00Z'})),{ceiling:'6,500 FT',visibility:null,temperature:null});
 for(const status of ['STALE_SOURCE','ERROR','USED_LAST_GOOD','UNKNOWN',undefined]) {
  assert.equal(read(payload({metarFetchStatus:status})).ceiling,null);
  assert.equal(read(payload({atisFetchStatus:status})).temperature,null);
 }
 for(const overrides of [{metarAgeMinutes:75},{metarAgeMinutes:-1},{metarAgeMinutes:'62'},{lastKnownGoodUsed:{metar:true}},{metarObservedZ:undefined},{metarObservedZ:'2026-10-16T23:02:00Z'}]) assert.equal(read(payload(overrides)).ceiling,null);
 for(const overrides of [{atisAgeMinutes:90},{atisSourceIsCurrent:false},{lastKnownGoodUsed:{atis:true}},{atisObservedZ:'invalid'}]) assert.equal(read(payload(overrides)).temperature,null);
 assert.equal(read(payload({metarObservedZ:'2026-10-16T20:54:00Z'})).temperature.display,'63');
});

test('missing, malformed, or source-incompatible values hide independently and never borrow a METAR number',()=>{
 for(const overrides of [{ceilingFt:undefined},{ceilingFt:'6500'},{ceilingFt:NaN},{ceilingFt:-1},{ceilingFt:6500.5},{ceilingDisplay:'UNL'},{metarCeilingFt:2500},{obsFieldSources:{ceiling:'UNKNOWN',visibility:'ATIS',tempDp:'ATIS'}}]) assert.equal(read(payload(overrides)).ceiling,null,JSON.stringify(overrides));
 for(const overrides of [{visibilitySm:undefined},{visibilitySm:'10'},{visibilitySm:Infinity},{visibilitySm:-1},{visibilityDisplay:'8 SM'},{visibilityDisplay:'1 10 SM'},{atisVisibilitySm:8},{obsFieldSources:{ceiling:'METAR',visibility:'NONE',tempDp:'ATIS'}}]) assert.equal(read(payload(overrides)).visibility,null,JSON.stringify(overrides));
 for(const overrides of [{tempC:undefined},{tempC:'17'},{tempC:NaN},{tempC:Infinity},{tempC:80},{obsFieldSources:{ceiling:'METAR',visibility:'ATIS',tempDp:'NONE'}}]) assert.equal(read(payload(overrides)).temperature,null,JSON.stringify(overrides));
 for(const [value,display] of [[1.5,'1 1/2 SM'],[.25,'M1/4 SM'],[6,'P6 SM']]) assert.equal(read(payload({visibilitySm:value,visibilityDisplay:display,atisVisibilitySm:value})).visibility.display,display);
 const mismatch=read(payload({ceilingFt:1000,ceilingDisplay:'1000 FT'}));assert.equal(mismatch.ceiling,null);assert.equal(mismatch.trends.ceiling,null);
});

test('JSON null ceiling needs explicit current METAR unlimited evidence; missing sky never becomes UNL or VFR',()=>{
 const data=payload({ceilingFt:null,ceilingDisplay:'UNL',metarCeilingFt:null,obsFieldSources:{ceiling:'NONE',visibility:'ATIS',tempDp:'ATIS'}});
 for(const sky of ['CLR','SKC','FEW005 SCT070']) {
  const r=read({...data,metar:`METAR KMEM 162154Z 35010KT 10SM ${sky} 17/03 A3025`});
  assert.deepEqual(r.ceiling.value,{kind:'unlimited'});assert.equal(r.ceiling.display,'UNLIMITED (UNL)');
  assert.equal(getFlightCategory(r.visibility.value,null,'CLR',true).cat,'VFR');
 }
 for(const sky of ['', 'BKN///','VV///','CLR BKNABC','SCT///','CLR SCT///','FEW005 SCTABC','BKN065']) {
  const r=read({...data,metar:`METAR KMEM 162154Z 35010KT 10SM ${sky} 17/03 A3025`});
  assert.equal(r.ceiling,null,sky);assert.equal(r.trends.ceiling,null);
  assert.equal(getFlightCategory(r.visibility.value,null,'CLR',!!r.ceiling).cat,'UNAVAILABLE');
 }
 for(const overrides of [{metarCeilingFt:6500},{atisCeilingFt:900}]) assert.equal(read({...data,metar:'METAR KMEM 162154Z 10SM CLR 17/03 A3025',...overrides}).ceiling,null);
 assert.equal(read({...data,metar:'METAR KJFK 162154Z 10SM CLR 17/03 A3025'}).ceiling,null);
 assert.equal(read({...data,metar:'METAR KMEM 162254Z 10SM CLR 17/03 A3025'}).ceiling,null);
 assert.equal(read({...data,metar:'METAR KMEM 162154Z 10SM CLR 17/03 A3025',metarFetchStatus:'STALE_SOURCE'}).ceiling,null);
});

test('legacy fallback is only for the entirely absent extension; partial payload/cache/error/demo do not invent arrows',()=>{
 assert.equal(normalizeCurrentOpsWeather({metar:'METAR KMEM'}),undefined);
 assert.equal(read({metar:'METAR KMEM'}).usesOps,false);
 assert.equal(read({ceilingFt:undefined}).usesOps,true);
 assert.equal(read({trendReferenceSource:'3HR_HISTORY'}).usesOps,true);
 assert.deepEqual(fields(read({ceilingFt:undefined})),none);
 const cache=resolveCurrentWeatherReadings({currentOpsWeather:null},now);assert.equal(cache.usesOps,true);assert.deepEqual(directions(cache),none);
 for(const overrides of [{requestStatus:'ERROR'},{feedStatus:'OFFLINE'}]) assert.deepEqual(fields(read(payload(),now,overrides)),none);
 assert.deepEqual(directions(read(payload(),now,{requestStatus:'REFRESHING'})),expected);
 const demo=resolveCurrentWeatherReadings(weather(),now,true);assert.equal(demo.usesOps,false);assert.deepEqual(directions(demo),none);
 assert.deepEqual(directions(read()),expected); // recovery establishes the first live result immediately
});

test('merge handles the complete canonical snapshot independently of retained METAR values',()=>{
 const prior={...weather(),forecast:[],metarObsIso:'2026-10-16T22:54:00Z',temperatureF:60,cloudBaseFt:3000,birdRisk:'LOW'};
 const next={...weather(payload({tempC:19})),forecast:[],metarObsIso:'2026-10-16T21:54:00Z',temperatureF:80,cloudBaseFt:6500,birdRisk:'LOW',lastRefreshAttemptIso:'2026-10-16T22:56:00Z'};
 const flags={metarValid:true,tafValid:true,modelValid:true,windValid:true,feedReached:true};
 const merged=mergeWeather(prior,{weather:next,...flags});assert.equal(merged.temperatureF,60);assert.equal(merged.currentOpsWeather,next.currentOpsWeather);assert.equal(resolveCurrentWeatherReadings(merged,now).temperature.display,'66');
 const failed=mergeWeather(prior,{weather:next,...flags,feedReached:false});assert.equal(failed.currentOpsWeather,null);
 const legacy={...next};delete legacy.currentOpsWeather;assert.equal(mergeWeather(prior,{weather:legacy,...flags}).currentOpsWeather,undefined);
});

test('lagging CDN JSON cannot roll a known canonical generation backwards, including its arrows',()=>{
 const prior={...weather(payload({allFeedsUpdatedZ:'2026-10-16T23:00:00Z',trendReferenceTimestampZ:'2026-10-16T20:05:00Z',tempC:18,tempTrend:'▼',tempTrendText:'FALLING'})),forecast:[],birdRisk:'LOW'};
 const incoming={...weather(),forecast:[],birdRisk:'LOW',lastRefreshAttemptIso:'2026-10-16T23:01:00Z'};
 const flags={metarValid:true,tafValid:true,modelValid:true,windValid:true,feedReached:true};
 const merged=mergeWeather(prior,{weather:incoming,...flags});
 assert.equal(merged.currentOpsWeather,prior.currentOpsWeather);
 const r=resolveCurrentWeatherReadings(merged,Date.parse('2026-10-16T23:01:00Z'));assert.equal(r.temperature.display,'64');assert.equal(r.trends.temperature.direction,'down');
 assert.equal(resolveCurrentWeatherReadings(merged,Date.parse('2026-10-16T23:20:00Z')).temperature,null);
 const fresh={...incoming,currentOpsWeather:normalizeCurrentOpsWeather(payload({allFeedsUpdatedZ:'2026-10-16T23:02:00Z',tempC:19,trendReferenceTimestampZ:'2026-10-16T20:05:00Z'}))};
 assert.equal(mergeWeather(merged,{weather:fresh,...flags}).currentOpsWeather,fresh.currentOpsWeather);
 const corrected={...incoming,currentOpsWeather:normalizeCurrentOpsWeather(payload({allFeedsUpdatedZ:'2026-10-16T23:00:00Z',tempC:19}))};
 assert.equal(mergeWeather(merged,{weather:corrected,...flags}).currentOpsWeather,corrected.currentOpsWeather);
 const badFuture={...prior,currentOpsWeather:{...prior.currentOpsWeather,updatedAt:'2026-10-17T23:00:00Z'}};
 assert.equal(mergeWeather(badFuture,{weather:incoming,...flags}).currentOpsWeather,incoming.currentOpsWeather);
});

const require=createRequire(import.meta.url),source=readFileSync(new URL('../app/CurrentWeatherTrend.tsx',import.meta.url),'utf8'),mod={exports:{}};
new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(require,mod,mod.exports);
test('small accessible triangles retain colors and describe JSON-window/reference provenance honestly',()=>{
 const css=readFileSync(new URL('../app/information-bar.css',import.meta.url),'utf8');
 for(const metric of ['ceiling','visibility','temperature'])for(const [direction,symbol] of [['up','▲'],['down','▼'],['steady','▶']]) {
  const html=renderToStaticMarkup(React.createElement(mod.exports.default,{metric,comparison:{direction,referenceAt:'2026-10-16T19:55:42Z',updatedAt:'2026-10-16T22:55:00Z',lookbackHours:3}}));
  assert.ok(html.includes(symbol));assert.ok(html.includes(`data-tone="${direction}"`));assert.match(html,/role="img" aria-label="/);assert.match(html,/Ops JSON reported 3-hour-window trend/);assert.match(html,/reference sample/);assert.doesNotMatch(html,/previous METAR|consecutive/);
 }
 for(const metric of ['ceiling','visibility','temperature']) assert.equal(renderToStaticMarkup(React.createElement(mod.exports.default,{metric,comparison:null})), '');
 for(const [tone,color]of [['up','#72dbbd'],['down','#ff7676'],['steady','#ffd07a'],['neutral','#c5d7e3']])assert.ok(css.includes(`.current-wx-trend[data-tone="${tone}"] { color: ${color}; }`));
});

test('page uses JSON readouts/category without changing enhanced METAR sky, feels-like, or forecast winds',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/currentOpsWeather:normalizeCurrentOpsWeather\(ops\)/);
 assert.doesNotMatch(page,/advanceCurrentTrendHistory|setCurrentTrendHistory|currentTrendClockRef/);
 assert.match(page,/resolveCurrentWeatherReadings\(weather,now.getTime\(\),currentPresentation.simulated\|\|clock.source==="PREVIEW"\)/);
 assert.match(page,/currentReadings\.usesOps \? "CURRENT WEATHER"/);
 assert.equal((page.match(/<CurrentWeatherTrend /g)||[]).length,3);
 assert.match(page,/current-temperature[^\n]*currentReadings.temperature\?\.display/);
 assert.match(page,/current-ceiling[^\n]*currentReadings.ceiling\?\.display/);
 assert.match(page,/wind-vis-tag[^\n]*currentReadings.visibility\?\.display/);
 assert.match(page,/getFlightCategory\(currentReadings.visibility\?\.value/);
 assert.match(page,/!currentReadings.usesOps && !currentPresentation.simulated && metarState === "STALE"/);
 for(const label of ['FEELS LIKE','HUMIDITY']) assert.doesNotMatch(page.match(new RegExp('<div><span>'+label+'[\\s\\S]*?<\\/div>'))?.[0]||'',/CurrentWeatherTrend/);
 assert.doesNotMatch(page.slice(page.indexOf('className="forecast-card')),/CurrentWeatherTrend/);
 assert.match(page,/condition:metar\?\.condition\?\?model\.condition/);
 assert.match(page,/forecastWind:null/);
 const cache=readFileSync(new URL('../app/weatherRefresh.ts',import.meta.url),'utf8');assert.match(cache,/return \{\.\.\.candidate,currentOpsWeather:null/);
});
