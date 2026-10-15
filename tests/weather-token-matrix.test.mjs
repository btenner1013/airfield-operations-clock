import test from 'node:test';
import assert from 'node:assert/strict';
import {extractAviationPhenomena,parseAviationSky,resolveOperationalWeather,qualifiesForTafHazardBand,parseStructuredTaf,applyStructuredTaf} from '../app/aviationWeatherPriority.ts';
import {classifyEffect,buildFxSpec,buildObscurationSpec} from '../app/weatherFx.ts';
import {buildWeatherEffects} from '../app/weatherController.ts';
import {parseCurrentLightning,lightningAnimationEligible} from '../app/lightning.ts';
import {normalizeFutureSkyDisplay} from '../app/futureWeather.ts';

// Valid-code references: FMH-1 §12.6.8; ICAO AMOFSG/10 Appendix G;
// NWS KCLT observations (FZRAPL/SNPL); UCAR's present-weather symbol table (TSPL).
// https://www.icams-portal.gov/resources/ofcm/fmh/FMH1/fmh1_2019.pdf
// https://www.icao.int/safety/meteorology/amofsg/AMOFSG%20Meeting%20Material/Microsoft%20Word%20-AMOFSG.10.SoD.en.pdf
// https://www.weather.gov/gsp/KCLT_obs_30Jan
// https://weather.rap.ucar.edu/info/wxSymbols_anno2.pdf
const raw=tokens=>`METAR KMEM 151853Z 27012KT 10SM ${tokens} BKN020 20/10 A2992`;
const wx=tokens=>resolveOperationalWeather({text:raw(tokens),sourceKind:'METAR'});
const effect=tokens=>classifyEffect(extractAviationPhenomena(raw(tokens)));
const rendered=tokens=>{
  const text=raw(tokens),weather=wx(tokens);
  return buildWeatherEffects({phenomena:weather.codes,coverage:weather.cloudCoverage,ceiling:weather.cloudBaseFt,visibility:10,windDirection:270,windSpeed:12,gust:null,lightning:parseCurrentLightning(text),night:false,quality:'full',reduced:false});
};
const precipTypes=tokens=>{const f=effect(tokens);return [f.precip,f.secondaryPrecip].filter(t=>t!=='none').sort();};

test('supported present-weather families retain labels, categories and effect types in METAR and TAF',()=>{
  const cases=[
    ['RA','RAIN','liquid-precipitation','rain','none'],['DZ','DRIZZLE','liquid-precipitation','drizzle','none'],
    ['FZRA','FREEZING RAIN','freezing-precipitation','freezing-rain','none'],['FZDZ','FREEZING DRIZZLE','freezing-precipitation','freezing-drizzle','none'],
    ['FZUP','FREEZING UNKNOWN PRECIPITATION','freezing-precipitation','freezing-rain','none'],
    ['SN','SNOW','winter-precipitation','snow','none'],['SHSN','SNOW SHOWERS','winter-precipitation','snow-shower','none'],
    ['BLSN','BLOWING SNOW','winter-precipitation','blowing-snow','none'],['DRSN','DRIFTING SNOW','winter-precipitation','drifting-snow','none'],
    ['SG','SNOW GRAINS','winter-precipitation','snow-grains','none'],['IC','ICE CRYSTALS','winter-precipitation','ice-crystals','none'],
    ['PL','ICE PELLETS','winter-precipitation','ice-pellets','none'],['GR','HAIL','severe-convection','hail','none'],['GS','SMALL HAIL','severe-convection','small-hail','none'],
    ['FG','FOG','obscuration','none','fog'],['BR','MIST','obscuration','none','mist'],['HZ','HAZE','obscuration','none','haze'],['FU','SMOKE','obscuration','none','smoke'],
    ['DU','DUST','obscuration','none','dust'],['SA','SAND','obscuration','none','sand'],['VA','VOLCANIC ASH','obscuration','none','volcanic-ash'],
    ['PO','DUST/SAND WHIRLS','obscuration','none','dust-whirl'],['PY','SPRAY','obscuration','none','none'],
    ['UP','UNKNOWN PRECIPITATION','liquid-precipitation','rain','none'],['SHGR','HAIL SHOWERS','severe-convection','hail','none'],
    ['SHGS','SMALL HAIL SHOWERS','severe-convection','small-hail','none'],['SHPL','ICE PELLETS SHOWERS','winter-precipitation','ice-pellets','none'],
  ];
  for(const [token,label,category,precip,obscuration] of cases){
    const current=wx(token),future=resolveOperationalWeather({text:`P6SM ${token} BKN020`,sourceKind:'TAF_FM'}),f=effect(token);
    assert.deepEqual(current.codes,[token],token);assert.equal(current.label,label,token);assert.equal(current.category,category,token);
    assert.equal(future.label,label,token);assert.equal(future.category,category,token);assert.equal(f.precip,precip,token);assert.equal(f.obscuration,obscuration,token);
  }
});

test('compound precipitation retains both supported particle constituents',()=>{
  for(const [combined,separate] of [['FZRAPL','FZRA PL'],['SNPL','SN PL'],['SNGS','SN GS'],['SNGR','SN GR'],['FZDZSN','FZDZ SN'],['SHRASN','SHRA SHSN'],['RASN','RA SN']]){
    assert.deepEqual(precipTypes(combined),precipTypes(separate),combined);
  }
  const freezing=rendered('FZRAPL');
  assert.equal(freezing.spec.type,'ice-pellets');assert.equal(freezing.spec.secondary.type,'freezing-rain');assert.equal(freezing.spec.pane.freezing,true);
  const shower=rendered('SHRASN');assert.equal(shower.spec.type,'snow-shower');assert.equal(shower.spec.secondary.type,'rain');assert.equal(shower.spec.burst,true);
});

test('mixed-weather wording never hides a higher-priority hazard',()=>{
  for(const [tokens,expected] of [['+TSRA FZRA PL','HEAVY THUNDERSTORMS WITH RAIN'],['TS RA SN','THUNDERSTORMS'],['TSGR SN BLSN','THUNDERSTORMS WITH HAIL'],['+FC RASN','TORNADO'],['TSRA RASN','THUNDERSTORMS WITH RAIN'],['GR FZRA PL','HAIL'],['FZRA RASN','FREEZING RAIN']])assert.equal(wx(tokens).label,expected,tokens);
  assert.equal(wx('TSRAGS').label,'THUNDERSTORMS WITH RAIN AND SMALL HAIL');
  assert.equal(wx('TSSNGR').label,'THUNDERSTORMS WITH SNOW AND HAIL');
  assert.equal(wx('+TSRA FZRA PL').secondaryLabel,'FREEZING RAIN AND ICE PELLETS');
  assert.equal(wx('TS RA SN').secondaryLabel,'RAIN AND SNOW');
  assert.equal(wx('TSGR SN BLSN').secondaryLabel,'SNOW AND BLOWING SNOW');
  assert.equal(wx('FZRA PL FG').secondaryLabel,'FOG');
  assert.equal(wx('TSRA RASN BR').secondaryLabel,'RAIN AND SNOW · MIST');
  assert.equal(wx('FZRA SNPL').secondaryLabel,'SNOW AND ICE PELLETS');
  // Direct provider/debug code input may include +TS; extraction remains unchanged.
  assert.equal(resolveOperationalWeather({codes:['+TS'],sourceKind:'METAR'}).label,'HEAVY THUNDERSTORMS');
  assert.deepEqual(extractAviationPhenomena(raw('+TS')),[]);
});

test('explicit precipitation intensity survives decoded labels and increases particle counts',()=>{
  for(const token of ['RA','DZ','FZRA','FZDZ','SN','SG','PL','GR','GS','UP','RASN','SHGR','SHRASN']){
    assert.ok(wx(`-${token}`).label.startsWith('LIGHT '),token);assert.ok(wx(`+${token}`).label.startsWith('HEAVY '),token);
    assert.ok(rendered(`-${token}`).spec.totalCount<rendered(token).spec.totalCount,token);assert.ok(rendered(token).spec.totalCount<rendered(`+${token}`).spec.totalCount,token);
  }
  assert.equal(effect('SN -RA').intensity,'moderate');assert.equal(effect('-SN -RA').intensity,'light');assert.equal(effect('+SN -RA').intensity,'heavy');
  assert.equal(effect('+DS -RA').intensity,'light','Duststorm intensity cannot turn light rain into heavy rain');
});

test('TAF compound hazards qualify at unrestricted visibility and ceiling',()=>{
  for(const token of ['TSRAGR','+TSRAGR','TSRAGS','SHGR','SHGS','RASN','FZRAPL','SHRASN','TSPL','TSUP','FZUP'])assert.equal(qualifiesForTafHazardBand(wx(token)),true,token);
  for(const token of ['VCSH','-RA','RA','BR','HZ','FU'])assert.equal(qualifiesForTafHazardBand(wx(token)),false,token);
});

test('ice-pellet and unknown-precipitation thunderstorms retain current lightning awareness',()=>{
  for(const token of ['TS','TSRA','TSSN','TSGR','TSGS','TSPL','TSUP','TSRAGR']){
    const report=parseCurrentLightning(raw(token));assert.equal(report.level,'station',token);assert.equal(lightningAnimationEligible(report),true,token);
  }
  for(const token of ['+TSPL','+TSUP'])assert.equal(parseCurrentLightning(raw(token)).level,'severe',token);
  for(const token of ['GR','GS','SQ','FC','+FC','PY','UP','VCSH','RETSRA','UNKNOWN']){
    const r=rendered(token);assert.equal(r.atmosphere.lightningLevel,'none',token);assert.equal(lightningAnimationEligible(parseCurrentLightning(raw(token))),false,token);
  }
});

test('vicinity obscurations retain their identity and remain attenuated',()=>{
  for(const [nearby,local,type] of [['VCVA','VA','volcanic-ash'],['VCPO','PO','dust-whirl'],['VCFG','FG','fog'],['VCBLDU','BLDU','blowing-dust'],['VCBLSA','BLSA','blowing-sand']]){
    const f=effect(nearby);assert.equal(f.obscuration,type,nearby);assert.equal(f.vicinity,true,nearby);assert.ok(wx(nearby).label.includes('IN THE VICINITY'),nearby);
    assert.ok(rendered(nearby).obscuration.density<rendered(local).obscuration.density,nearby);
  }
});

test('nearby showers do not dilute on-field rain or turn it into local showers',()=>{
  const local=rendered('RA'),mixed=rendered('RA VCSH');
  assert.equal(mixed.spec.count,local.spec.count);assert.equal(mixed.spec.pane.profile,'rain');assert.equal(mixed.spec.pane.count,local.spec.pane.count);assert.equal(mixed.spec.burst,false);
  const nearby=rendered('VCSH'),withFog=rendered('VCSH FG');
  assert.equal(withFog.spec.count,nearby.spec.count);assert.equal(withFog.spec.pane.profile,'vicinity');
  assert.equal(withFog.obscuration.density,rendered('FG').obscuration.density);
  assert.equal(rendered('RA VCFG').obscuration.density,rendered('VCFG').obscuration.density);
});

test('unknown, recent and remarks-only tokens never become active weather effects',()=>{
  for(const token of ['RETSRA','RERA','RESN','REFZRA','REGR','UNKNOWN','RAZZ'])assert.deepEqual(extractAviationPhenomena(raw(token)),[],token);
  for(const token of ['TSRA','+TSRA','RA','FZRA','SN','FG','FU','VA','BLSN']){
    const text=raw('')+` RMK AO2 ${token} BKN001`,codes=extractAviationPhenomena(text);
    assert.deepEqual(codes,[],token);assert.equal(parseAviationSky(text).cloudBaseFt,2000,token);
    const r=buildWeatherEffects({phenomena:codes,coverage:'BKN',ceiling:2000,visibility:10,windDirection:270,windSpeed:12,gust:null,lightning:parseCurrentLightning(text),night:false,quality:'full',reduced:false});
    assert.equal(r.spec,null,token);assert.equal(r.obscuration.type,'none',token);assert.equal(r.atmosphere.storm,0,token);assert.equal(r.atmosphere.lightningLevel,'none',token);
  }
  const remarks=parseCurrentLightning(raw('')+' RMK FRQ LTGCG VC W');
  assert.equal(remarks.level,'vicinity');assert.equal(remarks.source,'metar-remarks');assert.equal(lightningAnimationEligible(remarks),false);
  assert.equal(parseCurrentLightning('TAF KMEM 151700Z 1518/1624 18012KT P6SM TSUP BKN020').level,'none');
});

test('weather report terminators preserve the final complete token',()=>{
  for(const suffix of ['.',',',';','='])for(const token of ['RA','SN','FG','TSRA'])assert.deepEqual(extractAviationPhenomena(`TAF KMEM 151700Z 1518/1624 P6SM BKN020 ${token}${suffix}`),[token]);
});

test('unknown vertical visibility remains an indefinite ceiling',()=>{
  for(const suffix of ['',' ','=']){
    const sky=parseAviationSky(`1/4SM FG VV///${suffix}`);assert.equal(sky.skyCoverage,'VV');assert.equal(sky.skyCondition,'ceiling');assert.equal(sky.ceilingFt,null);assert.equal(sky.ceilingUnlimited,false);
    assert.equal(normalizeFutureSkyDisplay(sky).detail,'CIG HEIGHT UNAVAILABLE');
  }
});

test('intentional no-particle and generic-particle approximations stay explicit',()=>{
  for(const token of ['SQ','FC','+FC','PY','UNKNOWN']){const r=rendered(token);assert.equal(r.spec,null,token);assert.equal(r.atmosphere.lightningLevel,'none',token);}
  for(const token of ['UP','SHUP','TSUP','VCSH'])assert.equal(rendered(token).spec.type,'rain',token);
  assert.equal(wx('SHUP').label,'UNKNOWN PRECIPITATION SHOWERS');assert.equal(wx('TSUP').label,'THUNDERSTORMS WITH UNKNOWN PRECIPITATION');
  assert.equal(rendered('VCSH').spec.pane.profile,'vicinity');
  const fx=effect('+SN');assert.ok(buildFxSpec(fx,1,12,'low',false,false,null,10).count<buildFxSpec(fx,1,12,'full',false,false,null,10).count);
  assert.equal(buildObscurationSpec(effect('FG'),1,1,12,'full',true).duration,0);
});

test('TAF overlay-end transitions restore prevailing weather without extending validity',()=>{
  const model=Array.from({length:10},(_,i)=>{const iso=new Date(Date.UTC(2026,9,15,18+i)).toISOString();return {time:iso.slice(11,16),iso,temperatureF:70,condition:'clear',description:'Clear',precipitationProbability:i*10,precipitationValidTime:iso,precipitationFetchedAt:'2026-10-15T17:50:00Z',precipitationSource:'test-hourly',source:'MODEL',operationalWeather:null};});
  const timeline=parseStructuredTaf('TAF KMEM 151700Z 1518/1603 18012KT P6SM SCT050 TEMPO 1519/1521 2SM TSRA BKN015CB',new Date('2026-10-15T18:00:00Z'));
  const result=applyStructuredTaf(model,timeline,new Date('2026-10-15T18:00:00Z'));
  assert.deepEqual(result.forecast.map(f=>[f.iso,f.operationalWeather?.code]),[['2026-10-15T18:00:00.000Z',null],['2026-10-15T19:00:00.000Z','TSRA'],['2026-10-15T21:00:00.000Z',null]]);
  assert.deepEqual(result.forecast.map(f=>f.precipitationProbability),[0,20,80]);
  assert.equal(result.hazards[0].toIso,'2026-10-15T21:00:00.000Z');
  assert.ok(result.forecast.every(f=>Date.parse(f.iso)<Date.parse(timeline.validEndIso)));
});
