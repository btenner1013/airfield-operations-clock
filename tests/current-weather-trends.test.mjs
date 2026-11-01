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
 const delayed=resolveCurrentWeatherReadings(w,Date.parse('2026-10-16T23:15:00Z'));
 assert.deepEqual(fields(delayed),fields(read()));assert.equal(delayed.feedDelayed,true);
 assert.deepEqual(directions(delayed),none); // delayed JSON cannot advertise a current trend
 assert.deepEqual(fields(resolveCurrentWeatherReadings(w,Date.parse('2026-10-17T00:24:00Z'))),none);
 for(const updated of [undefined,'bad','2026-10-16T22:55:00','2026-02-30T22:55:00Z','2026-10-16T23:01:00.001Z']) assert.deepEqual(fields(read(payload({allFeedsUpdatedZ:updated}))),none,String(updated));
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
 const delayed=resolveCurrentWeatherReadings(merged,Date.parse('2026-10-16T23:20:00Z'));
 assert.equal(delayed.temperature.display,'64');assert.equal(delayed.feedDelayed,true);
 assert.equal(delayed.trends.temperature,null);
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


test('temperature triangle scales with the reading without changing other metric arrows',()=>{
 const css=readFileSync(new URL('../app/information-bar.css',import.meta.url),'utf8');
 assert.match(css,/\.current-temperature \.current-wx-trend \{ font-size: \.5em; vertical-align: \.1em; margin-left: \.16em; \}/);
 assert.match(css,/\.current-wx-trend \{[^}]*font-size: \.8em;/);
 for(const temperature of [63,100,-5,-40,-100]) for(const direction of ['up','steady','down']) {
  const arrow=React.createElement(mod.exports.default,{metric:'temperature',comparison:{direction,referenceAt:'2026-10-16T19:55:42Z',updatedAt:'2026-10-16T22:55:00Z',lookbackHours:3}});
  const html=renderToStaticMarkup(React.createElement('strong',{className:'current-temperature'},String(temperature),'°',React.createElement('small',null,'F'),arrow));
  assert.match(html,/<small>F<\/small><i class="current-wx-trend"/);
  assert.ok(html.includes(`data-tone="${direction}"`));
 }
});


test('November 1 regression: delayed Pages JSON keeps independently current observed temperature, not feels-like',()=>{
 const data=payload({allFeedsUpdatedZ:'2026-11-01 08:05Z',metarObservedZ:'2026-11-01T07:54:00Z',atisObservedZ:'2026-11-01T07:54:00Z',metarAgeMinutes:12,atisAgeMinutes:12,tempC:17});
 const at=Date.parse('2026-11-01T08:29:00Z');
 const r=read(data,at,{feelsLikeF:99});
 assert.equal(r.temperature.display,'63');assert.equal(r.feedDelayed,true);
 assert.match(r.temperature.title,/actual temperature; ATIS 2026-11-01T07:54/);
 assert.deepEqual(directions(r),none);
 // Fetching the same JSON again never renews the ATIS observation.
 assert.equal(read(data,Date.parse('2026-11-01T09:24:00Z')).temperature,null);
 const fresh=read({...data,allFeedsUpdatedZ:'2026-11-01 08:25Z',trendReferenceTimestampZ:'2026-11-01T05:35:49Z'},at);
 assert.equal(fresh.feedDelayed,false);assert.equal(fresh.temperature.display,'63');assert.equal(fresh.trends.temperature.direction,'up');
});

test('delayed JSON preserves zero/negative temperatures, but rejects missing, malformed, stale or failed source data',()=>{
 const delayed=payload({allFeedsUpdatedZ:'2026-10-16 22:35Z',metarObservedZ:'2026-10-16T22:30:00Z',atisObservedZ:'2026-10-16T22:30:00Z'});
 for(const [tempC,display] of [[0,'32'],[-10,'14'],[-40,'-40'],[17,'63']]) {
  const r=read({...delayed,tempC});assert.equal(r.temperature.display,display);assert.equal(r.feedDelayed,true);assert.equal(r.trends.temperature,null);
 }
 for(const tempC of [undefined,null,'17',NaN,Infinity,80]) assert.equal(read({...delayed,tempC}).temperature,null);
 for(const overrides of [{atisFetchStatus:'ERROR'},{atisSourceIsCurrent:false},{lastKnownGoodUsed:{atis:true}},{atisAgeMinutes:90},{atisObservedZ:'2026-10-16T21:26:00Z'},{atisObservedZ:'2026-10-16T23:02:00Z'},{allFeedsUpdatedZ:'bad'},{allFeedsUpdatedZ:'2026-10-16T23:02:00Z'}]) assert.equal(read({...delayed,...overrides}).temperature,null);
 for(const state of [{requestStatus:'ERROR'},{feedStatus:'OFFLINE'}]) assert.equal(read(delayed,now,state).temperature,null);
});

test('weather card explicitly marks the delayed JSON while preserving feels-like display',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/currentReadings.feedDelayed \? "FEED DELAYED"/);
 assert.match(page,/currentReadings.feedDelayed \? "stale"/);
 assert.match(page,/FEELS LIKE<\/span><strong>\{!modelMetricsAvailable \? "—" : weather.feelsLikeF\}/);
});

test('ATIS temperature priority and restrictive METAR visibility remain exactly as selected by Ops Board',()=>{
 const data=payload({tempC:17,visibilitySm:2,visibilityDisplay:'2 SM',metarVisibilitySm:2,atisVisibilitySm:6,
  obsFieldSources:{ceiling:'METAR',visibility:'METAR',tempDp:'ATIS'}});
 const r=read(data,now,{temperatureF:80,feelsLikeF:99});
 assert.equal(r.temperature.display,'63');assert.match(r.temperature.title,/ATIS/);
 assert.equal(r.visibility.display,'2 SM');assert.match(r.visibility.title,/METAR/);
});

// Actual-temperature retention is intentionally separate from model metrics and TAF/cache expiry.
import {validateReportedTemperature,retainReportedTemperature,restoreReportedTemperature,lastTemperatureLabel} from '../app/reportedTemperature.ts';
const actualReport={celsius:17,source:'ATIS',observedAt:'2026-10-31T23:54:00.000Z',reportedAt:'2026-11-01T00:05:00.000Z'};
const retentionNow=Date.parse('2026-11-01T08:45:00Z');
function reportWeather(overrides={}) {
 return {currentOpsWeather:normalizeCurrentOpsWeather(payload({allFeedsUpdatedZ:'2026-11-01 00:05Z',atisObservedZ:'2026-10-31T23:54:00Z',atisAgeMinutes:11,tempC:17,...overrides}))};
}

test('last actual temperature retains Celsius and original source timestamps across day/month rollover',()=>{
 const report=retainReportedTemperature(null,reportWeather(),retentionNow);
 assert.deepEqual(report,actualReport);
 for(const at of [retentionNow,Date.parse('2026-11-02T02:00:00Z'),Date.parse('2027-01-01T02:00:00Z')]) {
  assert.deepEqual(validateReportedTemperature(report,at),actualReport);
  assert.deepEqual(retainReportedTemperature(report,{currentOpsWeather:null},at),actualReport);
 }
 assert.match(lastTemperatureLabel(report,retentionNow),/LAST ATIS 312354Z.*531M OLD.*STALE/);
 assert.equal(Math.round(report.celsius*9/5+32),63);
});

test('retention never borrows model, feels-like, or default zero and accepts actual zero/negative readings',()=>{
 const modelOnly={temperatureF:84,feelsLikeF:99,currentOpsWeather:undefined};
 assert.equal(retainReportedTemperature(null,modelOnly,retentionNow),null);
 assert.deepEqual(retainReportedTemperature(actualReport,modelOnly,retentionNow),actualReport);
 for(const [tempC,fahrenheit] of [[0,32],[-10,14],[-40,-40],[17,63]]) {
  const r=retainReportedTemperature(null,reportWeather({tempC}),retentionNow);
  assert.equal(r.celsius,tempC);assert.equal(Math.round(r.celsius*9/5+32),fahrenheit);
 }
 for(const tempC of [undefined,null,'17',NaN,Infinity,80,-101]) assert.equal(retainReportedTemperature(null,reportWeather({tempC}),retentionNow),null);
});

test('newer actual report replaces retained reading, older reports do not roll it back, same-time correction is allowed',()=>{
 const newer=reportWeather({allFeedsUpdatedZ:'2026-11-01 08:40Z',atisObservedZ:'2026-11-01T08:30:00Z',tempC:18});
 const r=retainReportedTemperature(actualReport,newer,retentionNow);
 assert.equal(r.celsius,18);assert.equal(r.observedAt,'2026-11-01T08:30:00.000Z');
 assert.deepEqual(retainReportedTemperature(r,reportWeather({tempC:0}),retentionNow),r);
 const corrected=retainReportedTemperature(r,reportWeather({allFeedsUpdatedZ:'2026-11-01 08:42Z',atisObservedZ:'2026-11-01T08:30:00Z',tempC:19}),retentionNow);
 assert.equal(corrected.celsius,19);assert.equal(corrected.observedAt,r.observedAt);
});

test('last actual report restores independently of expired TAF/full cache and calendar rollover',()=>{
 for(const version of [1,2,3,4]) {
  const raw=JSON.stringify({version,savedAtIso:'2026-11-01T00:06:00Z',weather:{lastReportedTemperature:actualReport,tafValidEndIso:'2026-11-01T01:00:00Z'}});
  assert.deepEqual(restoreReportedTemperature(raw,retentionNow),actualReport);
 }
 const legacy=JSON.stringify({version:4,savedAtIso:'2026-11-01T00:06:00Z',weather:reportWeather()});
 assert.deepEqual(restoreReportedTemperature(legacy,retentionNow),actualReport);
 const noActual=JSON.stringify({version:4,savedAtIso:'2026-11-01T00:06:00Z',weather:{temperatureF:84,feelsLikeF:99}});
 assert.equal(restoreReportedTemperature(noActual,retentionNow),null);
 for(const raw of [null,'{bad}',JSON.stringify({version:99,savedAtIso:'2026-11-01T00:06:00Z',weather:{lastReportedTemperature:actualReport}}),JSON.stringify({version:4,savedAtIso:'2026-11-02T00:06:00Z',weather:{lastReportedTemperature:actualReport}})]) assert.equal(restoreReportedTemperature(raw,retentionNow),null);
});

test('retained report rejects malformed dates, untrusted sources, future observations and nonfinite now',()=>{
 for(const change of [{source:'MODEL'},{source:'UNKNOWN'},{celsius:null},{celsius:'17'},{celsius:NaN},{celsius:Infinity},{observedAt:'2026-02-30T23:54:00Z'},{reportedAt:'2026-02-30T23:54:00Z'},{observedAt:'2026-11-01T00:54:00'},{observedAt:'bad'},{reportedAt:'bad'},{observedAt:'2026-11-02T00:00:00Z'},{reportedAt:'2026-11-02T00:00:00Z'},{observedAt:'2026-11-01T00:11:00Z'}]) assert.equal(validateReportedTemperature({...actualReport,...change},retentionNow),null,JSON.stringify(change));
 for(const at of [NaN,Infinity,-Infinity]) assert.equal(validateReportedTemperature(actualReport,at),null,String(at));
});

test('weather merge retains only the actual report on feed failure then updates it on recovery',()=>{
 const flags={metarValid:false,tafValid:false,modelValid:true,windValid:false,feedReached:false};
 const prior={...weather(),lastReportedTemperature:actualReport,forecast:[],birdRisk:'LOW'};
 const incoming={...weather(),temperatureF:84,feelsLikeF:99,forecast:[],birdRisk:'LOW',lastRefreshAttemptIso:'2026-11-01T08:45:00Z'};
 const failed=mergeWeather(prior,{weather:incoming,...flags});
 assert.deepEqual(failed.lastReportedTemperature,actualReport);assert.equal(failed.currentOpsWeather,null);
 const recovered=mergeWeather(failed,{weather:{...incoming,...reportWeather({allFeedsUpdatedZ:'2026-11-01 08:40Z',atisObservedZ:'2026-11-01T08:30:00Z',tempC:18})},...flags,feedReached:true});
 assert.equal(recovered.lastReportedTemperature.celsius,18);
});

test('display uses retained actual temperature even without a canonical snapshot and does not convert twice',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 const expression=page.match(/<strong className="current-temperature"[^>]*>\{([^\n]+?)\}°<small>/)?.[1];
 assert.ok(expression,'actual temperature rendering expression is present');
 const render=new Function('currentReadings','retainedTemperature','currentPresentation','metarState','weather',`return (${expression});`);
 for(const usesOps of [true,false]) for(const metarState of ['CURRENT','STALE','UNAVAILABLE']) {
  const display=render({usesOps,temperature:null},actualReport,{simulated:false},metarState,{temperatureF:84,feelsLikeF:99});
  assert.equal(String(display),'63',`${usesOps}/${metarState}`);
 }
 assert.equal(String(render({usesOps:true,temperature:{display:'66'}},actualReport,{simulated:false},'CURRENT',{temperatureF:84,feelsLikeF:99})),'66');
 assert.equal(String(render({usesOps:true,temperature:null},null,{simulated:false},'UNAVAILABLE',{temperatureF:84,feelsLikeF:99})),'--');
});

test('cold start can retain a structurally valid stale/last-good actual report without inventing a current reading',()=>{
 for(const status of ['OK','WARN_SOURCE','STALE_SOURCE','USED_LAST_GOOD','STALE']) {
  const w=reportWeather({atisFetchStatus:status,atisSourceIsCurrent:false,lastKnownGoodUsed:{atis:true},atisAgeMinutes:531});
  assert.deepEqual(retainReportedTemperature(null,w,retentionNow),actualReport,status);
  assert.equal(resolveCurrentWeatherReadings({...w,requestStatus:'IDLE',feedStatus:'DEGRADED'},retentionNow).temperature,null);
 }
 for(const atisFetchStatus of ['ERROR','UNKNOWN','',undefined]) assert.equal(retainReportedTemperature(null,reportWeather({atisFetchStatus}),retentionNow),null);
 for(const atisAgeMinutes of [-1,'11',NaN,Infinity]) assert.equal(retainReportedTemperature(null,reportWeather({atisAgeMinutes}),retentionNow),null,String(atisAgeMinutes));
});
