import test from 'node:test';
import assert from 'node:assert/strict';
import {observedSceneWeather} from '../app/observedSceneWeather.ts';
import {resolveOperationalWeather} from '../app/aviationWeatherPriority.ts';
import {buildWeatherEffects} from '../app/weatherController.ts';
import {NO_LIGHTNING} from '../app/lightning.ts';
import {sceneFor,sceneForEffects} from '../app/wallpaper.ts';
import {getFlightCategory,visualCloudCoverage} from '../app/currentSky.ts';
const now=Date.parse('2026-11-04T11:43:54Z');
const alert=(code,source='ATIS',label=code)=>({code,sources:[source],text:`${label} ${source}`,displayTone:'blue'});
const base=(changes={})=>({condition:'overcast',description:'BROKEN CEILING',phenomena:[],visibilitySm:7,cloudCoverage:'BKN',cloudBaseFt:1500,operationalWeather:resolveOperationalWeather({text:'7SM FEW010 BKN015 OVC036',sourceKind:'METAR'}),metarObsIso:'2026-11-04T11:33:00Z',feedStatus:'OK',requestStatus:'IDLE',wxPrimaryAlert:alert('BR','ATIS','MIST'),wxAlertSourceContext:{atisObservedAt:'2026-11-04T10:54:00Z',atisStatus:'OK',metarObservedAt:'2026-11-04T11:33:00Z',metarStatus:'OK'},...changes});
const fx=w=>buildWeatherEffects({phenomena:w.phenomena,visibility:w.visibilitySm,coverage:w.cloudCoverage,ceiling:w.cloudBaseFt,windDirection:270,windSpeed:7,gust:null,lightning:NO_LIGHTNING,night:true,quality:'full',reduced:false});
test('real 04 Nov ATIS BR drives mist even though newer METAR has no BR',()=>{
 const w=base(),s=observedSceneWeather(w,now);assert.deepEqual(s.phenomena,['BR']);assert.equal(s.description,'MIST');assert.equal(s.operationalWeather.sourceKind,'ATIS');assert.equal(fx(w).obscuration.type,'none');assert.equal(fx(s).obscuration.type,'mist');assert.deepEqual(w.phenomena,[]);
});
test('BR and MIST labels are interchangeable without changing effects',()=>{
 for(const label of ['BR','MIST','mist']) assert.equal(fx(observedSceneWeather(base({wxPrimaryAlert:alert('BR','ATIS',label)}),now)).obscuration.type,'mist');
});
test('more restrictive ATIS and METAR hazards both survive, including intensity and mixtures',()=>{
 for(const [primary,metar,expected] of [['+RA',['-RA'],'heavy'],['-RA',['+RA'],'heavy'],['BR',['RA'],'moderate']]) {
  const s=observedSceneWeather(base({phenomena:metar,wxPrimaryAlert:alert(primary)}),now);assert.equal(fx(s).fx.intensity,expected);assert.ok(s.phenomena.includes(primary));assert.ok(s.phenomena.includes(metar[0]));
 }
});
test('forecast BR and TSRA never drive current effects',()=>{
 const w=base({wxPrimaryAlert:{...alert('BR','TAF'),text:'BR PSBL 12-13Z',tafWindow:'12-13Z'},wxSecondaryAlert:{...alert('TSRA','TAF'),text:'TSRA PSBL 14-16Z'}});assert.equal(observedSceneWeather(w,now),w);
});
test('stale, retained, future or unverified source remains display-only',()=>{
 for(const context of [{atisObservedAt:'2026-11-04T09:00:00Z'},{atisObservedAt:'2026-11-04T12:00:00Z'},{},{atisObservedAt:'bad'},{atisObservedAt:'2026-11-04T10:54:00Z',atisStatus:'USED_LAST_GOOD'},{atisObservedAt:'2026-11-04T10:54:00Z',retained:true}]){const w=base({wxAlertSourceContext:context});assert.equal(observedSceneWeather(w,now),w);}
});
test('offline, failed refresh, malformed code and equipment text never create effects',()=>{
 for(const change of [{feedStatus:'OFFLINE'},{requestStatus:'ERROR'},{wxPrimaryAlert:alert('RWY GS OTS')},{wxPrimaryAlert:alert('MIST')},{wxPrimaryAlert:alert('BR','MANUAL')}]){const w=base(change);assert.equal(observedSceneWeather(w,now),w);}
});
test('fresh ATIS still works without reviving expired METAR precipitation',()=>{
 const w=base({phenomena:['+RA'],metarObsIso:'2026-11-04T08:00:00Z'}),s=observedSceneWeather(w,now);assert.deepEqual(s.phenomena,['BR']);assert.equal(fx(s).fx.precip,'none');
});

test('expired METAR fog visibility and cloud layers never become fresh ATIS mist evidence',()=>{
 const w=base({metarObsIso:'2026-11-04T08:00:00Z',visibilitySm:.25,cloudCoverage:'VV',cloudBaseFt:100,operationalWeather:resolveOperationalWeather({text:'1/4SM FG VV001',sourceKind:'METAR'})});
 const s=observedSceneWeather(w,now);assert.equal(s.visibilitySm,null);assert.equal(s.cloudBaseFt,null);assert.equal(s.cloudCoverage,'CLR');assert.equal(s.operationalWeather.skyCondition,'unavailable');assert.deepEqual(s.operationalWeather.cloudLayers,[]);assert.equal(fx(s).atmosphere.coverage,0);assert.equal(fx(s).obscuration.type,'mist');
});

test('validated combined codes retain each renderer token',()=>{
 const s=observedSceneWeather(base({wxPrimaryAlert:alert('RA BR')}),now);assert.deepEqual(s.phenomena,['RA','BR']);assert.equal(fx(s).fx.precip,'rain');assert.equal(fx(s).obscuration.type,'mist');
});

test('13 Nov ATIS smoke retains FEW sky, unlimited ceiling and independent smoke effects',()=>{
 const raw='METAR KMEM 132054Z 01012G18KT 10SM FEW002 FEW045 11/M03 A3005 RMK AO2 SLP174 FU FEW002 T01061028 56008 $';
 const metar=resolveOperationalWeather({text:raw,sourceKind:'METAR'});
 const w=base({condition:metar.condition,description:metar.label,phenomena:metar.codes,visibilitySm:metar.visibilitySm,cloudCoverage:metar.cloudCoverage,cloudBaseFt:metar.cloudBaseFt,operationalWeather:metar,metarObsIso:'2026-11-13T20:54:00Z',wxPrimaryAlert:{...alert('FU'),sources:['ATIS','METAR']},wxAlertSourceContext:{atisObservedAt:'2026-11-13T20:54:00Z',atisStatus:'OK',metarObservedAt:'2026-11-13T20:54:00Z',metarStatus:'OK'}});
 const s=observedSceneWeather(w,Date.parse('2026-11-13T21:45:00Z'));
 assert.deepEqual(s.phenomena,['FU']);assert.equal(s.description,'SMOKE');
 assert.equal(s.cloudCoverage,'FEW');assert.equal(s.operationalWeather.ceilingUnlimited,true);assert.equal(s.operationalWeather.ceilingFt,null);
 assert.deepEqual(s.operationalWeather.cloudLayers,metar.cloudLayers);assert.equal(visualCloudCoverage(s.cloudCoverage,s.operationalWeather.cloudLayers),'FEW');
 assert.equal(getFlightCategory(s.visibilitySm,s.cloudBaseFt,s.cloudCoverage).cat,'VFR');
 const effects=fx(s);assert.equal(effects.obscuration.type,'smoke');assert.ok(effects.obscuration.density>0);assert.equal(effects.atmosphere.coverage,.2);assert.equal(effects.fx.precip,'none');
 assert.equal(sceneForEffects(sceneFor(s.condition,'day',s.cloudCoverage),effects.obscuration.type,s.visibilitySm,'day',s.cloudCoverage),'partly-cloudy-day');
 assert.deepEqual(w.phenomena,[],'Scene selection never writes synthetic smoke into the METAR');
});
