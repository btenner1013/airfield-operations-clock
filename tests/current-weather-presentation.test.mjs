import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { currentWeatherPresentation, currentLightningPresentation, lightningReportForDisplay } from "../app/currentWeatherPresentation.ts";
import { resolveOperationalWeather } from "../app/aviationWeatherPriority.ts";
import { WEATHER_DEMOS } from "../app/weatherController.ts";
const live = resolveOperationalWeather({text:"-RA BR BKN020", sourceKind:"METAR"});
const base={condition:"rain",description:"LIGHT RAIN",operationalWeather:live,simulated:true,phenomena:[],coverage:"SCT",ceiling:6000,visibility:10};

test("every visibility phenomenon keeps its decoded name rather than the fog scene theme",()=>{
  for(const [code,label] of [["BR","MIST"],["FG","FOG"],["FZFG","FREEZING FOG"],["MIFG","SHALLOW FOG"],["BCFG","PATCHES OF FOG"],["PRFG","PARTIAL FOG"],["HZ","HAZE"],["FU","SMOKE"],["DU","DUST"],["SA","SAND"],["BLDU","BLOWING DUST"],["DRDU","DRIFTING DUST"],["BLSA","BLOWING SAND"],["DRSA","DRIFTING SAND"],["DS","DUST STORM"],["SS","SANDSTORM"],["VA","VOLCANIC ASH"]]) {
    const result=currentWeatherPresentation({...base,phenomena:[code]});
    assert.equal(result.label,label,code);
    assert.equal(result.secondaryLabel,null,`${code}: live MIST must not leak into demo`);
    assert.deepEqual(result.codes,[code]);
  }
});

test("rain, frozen precipitation, thunderstorms and mixed demo labels come from shared decoder",()=>{
  for(const codes of [["-RA"],["+RA"],["-DZ"],["SHRA"],["VCSH"],["FZRA"],["FZDZ"],["SN"],["+SN"],["SHSN"],["BLSN"],["SN","BLSN"],["DRSN"],["SG"],["IC"],["PL"],["GS"],["GR"],["TS"],["VCTS"],["TSRA"],["+TSRA"],["TSGR"],["RASN"],["FZRA","PL"],["SQ"],["FC"],["+FC"]]) {
    const expected=resolveOperationalWeather({codes,sourceKind:"METAR"});
    const result=currentWeatherPresentation({...base,phenomena:codes});
    assert.equal(result.label,expected.label,codes.join(" "));
    assert.equal(result.secondaryLabel,expected.secondaryLabel);
    assert.equal(result.condition,expected.condition);
  }
});

test("demo buttons never inherit live modifiers or mutate live source data",()=>{
  const original=JSON.stringify(live);
  for(const demo of WEATHER_DEMOS) {
    const result=currentWeatherPresentation({...base,condition:demo.condition,coverage:demo.coverage,phenomena:demo.phenomena.split(/\s+/).filter(Boolean)});
    assert.equal(result.simulated,true);
    assert.equal(result.secondaryLabel,null,demo.label);
  }
  assert.equal(JSON.stringify(live),original);
});

test("live labels and modifiers remain exactly supplied, including unavailable data",()=>{
  const result=currentWeatherPresentation({...base,simulated:false,description:"Source text unchanged"});
  assert.equal(result.label,"Source text unchanged");
  assert.equal(result.secondaryLabel,"MIST");
  assert.equal(result.condition,"rain");
  assert.deepEqual(result.codes,["-RA","BR"]);
  const missing=currentWeatherPresentation({...base,simulated:false,condition:"neutral",description:"Weather unavailable",operationalWeather:null});
  assert.equal(missing.label,"Weather unavailable");
  assert.equal(missing.condition,"neutral");
  assert.deepEqual(missing.codes,[]);
});

test("current page and both icon sites use source-specific presentation",()=>{
  const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(page,/displayTheme\.replace/);
  assert.match(page,/currentPresentation\.label/);
  assert.match(page,/currentPresentation\.secondaryLabel/);
  assert.match(page,/f\.operationalWeather\.secondaryLabel/);
  assert.match(page,/codes=\{currentPresentation\.codes\}/);
  assert.match(page,/codes=\{f\.operationalWeather\?\.codes \?\? f\.phenomena\}/);
  assert.match(page,/showLunarInformation\(effSolar\) \? "SOLAR \/ LUNAR" : "SOLAR"/);
});


test("lightning preview follows actual thunder tokens, vicinity and intensity rather than a generic TSRA shortcut",()=>{
  const live={level:"station",source:"ops-feed",code:"TS",awareness:"SOURCE TEXT",types:[],directions:[],frequency:null,tone:"red",pulse:true,flash:false};
  for(const [code,level] of [["FU","none"],["GR","none"],["GS","none"],["VCTS","vicinity"],["TS","station"],["TSGR","station"],["+TSRA","severe"]]) {
    const result=currentLightningPresentation({preview:null,simulated:true,phenomena:[code],live});
    assert.equal(result.level,level,code);
    assert.equal(result.source,"debug");
    if(level!=="none") assert.equal(result.code,code);
  }
  assert.equal(currentLightningPresentation({preview:null,simulated:false,phenomena:["FU"],live}),live);
  assert.equal(currentLightningPresentation({preview:"none",simulated:true,phenomena:["TS"],live}).level,"none");
  assert.equal(currentLightningPresentation({preview:"distant-ocnl-ic",simulated:true,phenomena:["TS"],live}).level,"distant");
});


test("warning freshness distinguishes old reports from unverified timing without borrowing another source",()=>{
  const now=Date.parse("2026-10-15T19:00:00Z"), observed="2026-10-15T17:00:00Z";
  const report={level:"station",source:"metar-body",code:"TS",awareness:"TS OVER FIELD",types:[],directions:[],frequency:null,tone:"red",pulse:true,flash:false};
  assert.equal(lightningReportForDisplay(report,observed,now).isStale,true);
  assert.equal(lightningReportForDisplay(report,observed,now).sourceTime,observed);
  assert.equal(lightningReportForDisplay({...report,sourceTime:"2026-10-15T17:45:00Z"},null,now).isStale,false);
  assert.equal(lightningReportForDisplay({...report,sourceTime:"2026-10-15T19:06:00Z"},null,now).isStale,true);
  for(const source of ["metar-body","metar-remarks","ops-feed"]) {
    const unknown=lightningReportForDisplay({...report,source,sourceTime:"invalid"},null,now);
    assert.equal(unknown.sourceTime,null);
    assert.equal(unknown.isStale,false);
  }
  assert.equal(lightningReportForDisplay({...report,source:"ops-feed"},observed,now).sourceTime,null);
  assert.equal(lightningReportForDisplay({...report,source:"ops-feed",isStale:true},null,now).isStale,true);
  assert.equal(lightningReportForDisplay({...report,source:"debug",sourceTime:observed},null,now).isStale,false);
});
