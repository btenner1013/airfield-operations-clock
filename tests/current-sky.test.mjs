import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {parseAviationSky} from '../app/aviationWeatherPriority.ts';
import {visualCloudCoverage,getFlightCategory} from '../app/currentSky.ts';
import {withOptionalWeatherDeadline} from '../app/weatherRefresh.ts';

test('16 Oct live BKN023 OVC032 is an MVFR ceiling with full visual cover',()=>{
  const sky=parseAviationSky('METAR KMEM 161254Z 35013G27KT 10SM BKN023 OVC032 18/12 A3014 RMK AO2');
  assert.equal(sky.ceilingFt,2300);assert.equal(sky.cloudCoverage,'BKN');
  assert.equal(getFlightCategory(sky.visibilitySm,sky.cloudBaseFt,sky.cloudCoverage).cat,'MVFR');
  assert.equal(visualCloudCoverage(sky.cloudCoverage,sky.cloudLayers),'OVC');
});
test('cloud cover and flight category preserve aviation thresholds independently',()=>{
  for(const [raw,category,cover] of [['10SM OVC032','VFR','OVC'],['10SM BKN030 OVC050','MVFR','OVC'],['10SM SCT005','VFR','SCT'],['10SM SKC','VFR','CLR'],['2SM BKN023','IFR','BKN'],['1/2SM VV002','LIFR','VV']]) {
    const s=parseAviationSky(raw);assert.equal(getFlightCategory(s.visibilitySm,s.cloudBaseFt,s.cloudCoverage).cat,category);assert.equal(visualCloudCoverage(s.cloudCoverage,s.cloudLayers),cover);
  }
});
test('missing and stale observation never defaults to VFR',()=>{
  assert.equal(getFlightCategory(null,null,'CLR').cat,'UNAVAILABLE');
  assert.equal(getFlightCategory(10,null,'VV').cat,'UNAVAILABLE');
  assert.equal(getFlightCategory(10,2300,'BKN',false).cat,'UNAVAILABLE');
});
test('optional source timeout preserves a successful primary response',async()=>{
  let aborted=false;
  const optional=withOptionalWeatherDeadline(signal=>{signal.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});},undefined,10);
  const result=await Promise.allSettled([Promise.resolve('fresh METAR'),optional]);
  assert.equal(result[0].value,'fresh METAR');assert.equal(result[1].status,'rejected');assert.equal(aborted,true);
});
test('optional source success and failure remain independent',async()=>{
  assert.equal(await withOptionalWeatherDeadline(async()=>42,undefined,50),42);
  await assert.rejects(withOptionalWeatherDeadline(async()=>{throw Error('HTTP 503');},undefined,50),/HTTP 503/);
  const parent=new AbortController();parent.abort();
  let started=false;
  await assert.rejects(withOptionalWeatherDeadline(()=>{started=true;return new Promise(()=>{});},parent.signal,50),{name:'AbortError'});
  assert.equal(started,false);
});


test('isolated previews remain visible without a current live observation',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/available:currentPresentation.simulated\|\|condition!=="neutral"/);
 assert.match(page,/currentPresentation.simulated \? sceneFor\(currentPresentation.condition,phase,visualCoverage\)/);
});
