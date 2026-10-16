import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {parseAviationSky,resolveOperationalWeather} from '../app/aviationWeatherPriority.ts';
import {currentTrendObservation,advanceCurrentTrendHistory,resolveCurrentWeatherTrends,compareCeiling,compareVisibility} from '../app/currentWeatherTrends.ts';
const now=Date.parse('2026-10-16T20:05:00Z'),empty=()=>({previous:null,current:null});
function weather(time='1954',fields='10SM BKN030 17/07',overrides={}) {
 const raw=`METAR KMEM 16${time}Z 35010KT ${fields} A3022`,sky=parseAviationSky(raw),temp=fields.match(/(?:^|\s)(M?\d{2})\//)?.[1];
 return {source:'METAR',rawMetar:raw,metarObsIso:`2026-10-16T${time.slice(0,2)}:${time.slice(2)}:00.000Z`,metarFetchStatus:'OK',cloudCoverage:sky.cloudCoverage,cloudBaseFt:sky.cloudBaseFt,visibilitySm:sky.visibilitySm,temperatureF:temp?Math.round((temp.startsWith('M')?-Number(temp.slice(1)):Number(temp))*9/5+32):80,condition:'overcast',operationalWeather:resolveOperationalWeather({text:raw,...sky,sourceKind:'METAR'}),requestStatus:'IDLE',feedStatus:'OK',...overrides};
}
const result=w=>({weather:w,feedReached:true,metarValid:true});
const sample=(...args)=>currentTrendObservation(weather(...args),now);
const history=(a,b)=>advanceCurrentTrendHistory(advanceCurrentTrendHistory(empty(),result(a),now),result(b),now);
const directions=t=>Object.fromEntries(Object.entries(t).map(([k,v])=>[k,v?.direction??null]));
const none={ceiling:null,visibility:null,temperature:null};

test('first load, cache-only state and repeated same observations never invent steady arrows',()=>{
 const a=weather(),h=advanceCurrentTrendHistory(empty(),result(a),now);
 assert.deepEqual(directions(resolveCurrentWeatherTrends(empty(),a,now)),none);
 assert.deepEqual(directions(resolveCurrentWeatherTrends(h,a,now)),none);
 assert.equal(advanceCurrentTrendHistory(h,result(a),now),h);
 assert.deepEqual(directions(resolveCurrentWeatherTrends(h,a,now)),none);
});

test('new distinct METAR generates trends; repeat refresh retains comparison and observation times',()=>{
 const a=weather('1854','2SM BKN009 17/07'),b=weather('1954','4SM BKN015 18/07'),h=history(a,b);
 const trends=resolveCurrentWeatherTrends(h,b,now);
 assert.deepEqual(directions(trends),{ceiling:'up',visibility:'up',temperature:'up'});
 assert.equal(advanceCurrentTrendHistory(h,result(b),now),h);
 assert.equal(trends.ceiling.previousObservedAt,a.metarObsIso);
 assert.equal(trends.ceiling.observedAt,b.metarObsIso);
 assert.deepEqual(directions(resolveCurrentWeatherTrends(h,b,now+60000)),directions(trends));
});

test('equal-time correction resets comparison, older reports cannot reverse the baseline',()=>{
 const a=weather('1854'),b=weather(),h=history(a,b),cor=weather('1954','4SM OVC006 16/07');
 const corrected=advanceCurrentTrendHistory(h,result(cor),now);
 assert.equal(corrected.previous,null);assert.equal(corrected.current.raw,cor.rawMetar);
 const older=advanceCurrentTrendHistory(h,result(a),now);
 assert.equal(older.current,h.current);assert.equal(older.previous,null);
 const next=weather('2000','5SM BKN012 17/07');
 assert.equal(advanceCurrentTrendHistory(corrected,result(next),now).previous.raw,cor.rawMetar);
});

test('invalid, failed, stale, model and timestamp-inconsistent responses are never admitted',()=>{
 const a=weather('1854'),b=weather(),h=history(a,b);
 for(const overrides of [{source:'MODEL'},{metarFetchStatus:'STALE'},{metarFetchStatus:'USED_LAST_GOOD'},{metarObsIso:null},{metarObsIso:'invalid'},{metarObsIso:'2026-10-16T20:04:00Z'},{rawMetar:'METAR KJFK 161954Z 10SM CLR 17/07 A3022'},{rawMetar:'TAF KMEM 161954Z 10SM CLR 17/07 A3022'}]) {
  const w=weather('1954',undefined,overrides);assert.equal(currentTrendObservation(w,now),null);
  assert.deepEqual(advanceCurrentTrendHistory(h,result(w),now),empty());
 }
 for(const flags of [{feedReached:false},{metarValid:false}]) assert.deepEqual(advanceCurrentTrendHistory(h,{...result(b),...flags},now),empty());
 assert.deepEqual(directions(resolveCurrentWeatherTrends(h,{...b,requestStatus:'ERROR'},now)),none);
 assert.deepEqual(directions(resolveCurrentWeatherTrends(h,{...b,feedStatus:'OFFLINE'},now)),none);
 assert.deepEqual(directions(resolveCurrentWeatherTrends(h,b,now,true)),none);
 assert.deepEqual(directions(resolveCurrentWeatherTrends(h,{...b,tafFetchStatus:'ERROR',feedStatus:'DEGRADED'},now)),{ceiling:'steady',visibility:'steady',temperature:'steady'});
});

test('freshness uses each real observation with inclusive75min and5min future bounds; long gaps reseed',()=>{
 const a=weather('1854'),b=weather(),h=history(a,b),boundary=Date.parse(a.metarObsIso)+75*60000;
 assert.ok(resolveCurrentWeatherTrends(h,b,boundary).ceiling);
 assert.deepEqual(directions(resolveCurrentWeatherTrends(h,b,boundary+1)),none);
 const future=weather('2010');assert.ok(currentTrendObservation(future,now));assert.equal(currentTrendObservation(future,now-1),null);
 const old=weather('1754');assert.equal(currentTrendObservation(old,now),null);
 assert.equal(advanceCurrentTrendHistory({previous:null,current:{...sample(),observedAt:old.metarObsIso}},result(b),now).previous,null);
});

test('ceiling thresholds match ops-board categories,500ft and unlimited/highVFR rule',()=>{
 const c=n=>n==='UNL'?{kind:'unlimited'}:{kind:'height',feet:n};
 for(const [a,b,d] of [[400,500,'up'],[900,1000,'up'],[3000,3100,'up'],[1500,1900,'steady'],[1500,2000,'up'],[6000,'UNL','steady'],[3000,'UNL','up']]) {
  assert.equal(compareCeiling(c(b),c(a)),d);
  assert.equal(compareCeiling(c(a),c(b)),d==='up'?'down':d);
 }
 for(const fields of ['10SM 17/07','10SM VV/// 17/07','10SM BKN/// 17/07','10SM CLR BKN/// 17/07','10SM CLR BKNABC 17/07']) assert.equal(sample('1954',fields).ceiling,null);
 assert.deepEqual(sample('1954','10SM FEW005 SCT010 17/07').ceiling,{kind:'unlimited'});
 assert.equal(compareCeiling(null,{kind:'unlimited'}),null);
});

test('visibility categories and1SM threshold preserve P/M/capped bounds without unsupported changes',()=>{
 const v=(value,bound='exact')=>({value,bound});
 for(const [a,b,d] of [[.75,1,'up'],[2.5,3,'up'],[5,6,'up'],[1.5,2,'steady'],[1.5,2.5,'up']]) {assert.equal(compareVisibility(v(b),v(a)),d);assert.equal(compareVisibility(v(a),v(b)),d==='up'?'down':d);}
 const p6=v(6,'more-than'),ten=v(10,'at-least'),mQuarter=v(.25,'less-than');
 assert.equal(compareVisibility(ten,p6),null);assert.equal(compareVisibility(p6,ten),null);
 assert.equal(compareVisibility(p6,v(5)),'up');assert.equal(compareVisibility(v(5),p6),'down');
 assert.equal(compareVisibility(v(1),mQuarter),'up');assert.equal(compareVisibility(mQuarter,v(1)),'down');
 assert.equal(compareVisibility(v(9),ten),'down');assert.equal(compareVisibility(ten,v(9)),'up');
 assert.equal(compareVisibility(ten,v(9.5)),null);assert.equal(compareVisibility(v(9.5),ten),null);
 assert.equal(compareVisibility(ten,ten),'steady');assert.equal(compareVisibility(mQuarter,mQuarter),'steady');
 assert.deepEqual(sample('1954','1 1/2SM CLR 17/07').visibility,v(1.5));
 assert.deepEqual(sample('1954','10SM CLR 17/07').visibility,ten);
 for(const fields of ['CAVOK 17/07','CLR 17/07','1/0SM CLR 17/07','M0SM CLR 17/07','CLR 17/07 RMK 3SM']) assert.equal(sample('1954',fields).visibility,null);
});

test('temperature uses body Celsius, never rounded Fahrenheit/model fallback/remarks or feels-like',()=>{
 const a=weather('1854','10SM CLR 17/07'),b=weather('1954','10SM CLR 18/07'),h=history(a,b);
 assert.equal(a.temperatureF,63);assert.equal(b.temperatureF,64);
 assert.equal(resolveCurrentWeatherTrends(h,b,now).temperature.direction,'up');
 assert.equal(resolveCurrentWeatherTrends(history(b,weather('2000','10SM CLR 17/07')),weather('2000','10SM CLR 17/07'),now).temperature.direction,'down');
 assert.equal(sample('1954','10SM CLR M02/M05').temperatureC,-2);
 for(const fields of ['10SM CLR','10SM CLR RMK 18/07','10SM CLR //07']) assert.equal(sample('1954',fields).temperatureC,null);
 const missing=weather('1954','10SM CLR');
 assert.equal(resolveCurrentWeatherTrends(history(a,missing),missing,now).temperature,null);
 assert.equal(resolveCurrentWeatherTrends(h,{...b,temperatureF:80},now).temperature,null);
 assert.equal(resolveCurrentWeatherTrends(h,{...b,feelsLikeF:999},now).temperature.direction,'up');
});

test('trends hide individually when displayed fields no longer match that source report',()=>{
 const a=weather('1854'),b=weather(),h=history(a,b);
 assert.equal(resolveCurrentWeatherTrends(h,{...b,operationalWeather:null},now).ceiling,null);
 assert.equal(resolveCurrentWeatherTrends(h,{...b,cloudCoverage:'OVC'},now).ceiling,null);
 assert.equal(resolveCurrentWeatherTrends(h,{...b,cloudBaseFt:2500},now).ceiling,null);
 assert.equal(resolveCurrentWeatherTrends(h,{...b,visibilitySm:8},now).visibility,null);
 assert.deepEqual(directions(resolveCurrentWeatherTrends(h,{...b,rawMetar:weather('2000').rawMetar},now)),none);
});

const require=createRequire(import.meta.url),source=readFileSync(new URL('../app/CurrentWeatherTrend.tsx',import.meta.url),'utf8'),mod={exports:{}};
new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(require,mod,mod.exports);
test('small accessible triangles use green/up red/down yellow/steady; all temperature directions stay neutral',()=>{
 const css=readFileSync(new URL('../app/information-bar.css',import.meta.url),'utf8');
 for(const metric of ['ceiling','visibility','temperature'])for(const [direction,symbol] of [['up','▲'],['down','▼'],['steady','▶']]) {
  const html=renderToStaticMarkup(React.createElement(mod.exports.default,{metric,comparison:{direction,previousObservedAt:'2026-10-16T18:54:00Z',observedAt:'2026-10-16T19:54:00Z'}}));
  assert.ok(html.includes(symbol));assert.ok(html.includes(`data-tone="${metric==='temperature'?'neutral':direction}"`));assert.match(html,/role="img" aria-label="/);assert.match(html,/previous METAR/);
 }
 assert.equal(renderToStaticMarkup(React.createElement(mod.exports.default,{metric:'ceiling',comparison:null})), '');
 for(const [tone,color]of [['up','#72dbbd'],['down','#ff7676'],['steady','#ffd07a'],['neutral','#c5d7e3']])assert.ok(css.includes(`.current-wx-trend[data-tone="${tone}"] { color: ${color}; }`));
});

test('page collects only incoming METAR results in session memory and renders exactly three current metric arrows',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/advanceCurrentTrendHistory\(history,result,currentTrendClockRef.current.nowMs\)/);
 assert.match(page,/setCurrentTrendHistory\(\{previous:null,current:null\}\)/);
 assert.equal((page.match(/<CurrentWeatherTrend /g)||[]).length,3);
 assert.match(page,/current-temperature[^\n]*metric="temperature"/);
 assert.match(page,/current-ceiling[^\n]*metric="ceiling"/);
 assert.match(page,/wind-vis-tag[^\n]*metric="visibility"/);
 for(const label of ['FEELS LIKE','HUMIDITY']) assert.doesNotMatch(page.match(new RegExp('<div><span>'+label+'[\\s\\S]*?<\\/div>'))?.[0]||'',/CurrentWeatherTrend/);
 assert.doesNotMatch(page.slice(page.indexOf('className="forecast-card')),/CurrentWeatherTrend/);
 assert.match(page,/clock.source==="PREVIEW"/);
 const cache=readFileSync(new URL('../app/weatherRefresh.ts',import.meta.url),'utf8');assert.doesNotMatch(cache,/currentTrendHistory|currentWeatherTrends/);
});
