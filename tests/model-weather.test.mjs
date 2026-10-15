import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { modelWeatherFromCode } from "../app/modelWeather.ts";
import { buildWeatherEffects } from "../app/weatherController.ts";
import { NO_LIGHTNING } from "../app/lightning.ts";
import { currentWeatherPresentation } from "../app/currentWeatherPresentation.ts";
const allCodes=[0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,97,99];
const expectedTokens=["","","","","FG","FZFG","-DZ","DZ","+DZ","-FZDZ","+FZDZ","-RA","RA","+RA","-FZRA","+FZRA","-SN","SN","+SN","SG","-SHRA","SHRA","+SHRA","-SHSN","+SHSN","TS","-TSGR","+TS","+TSGR"];
const effects=phenomena=>buildWeatherEffects({phenomena,coverage:"BKN",ceiling:null,visibility:null,windDirection:270,windSpeed:12,gust:null,lightning:NO_LIGHTNING,night:false,quality:"full",reduced:false});

test("every documented model code keeps exact phenomenon metadata and independent intensity",()=>{
  for(let i=0;i<allCodes.length;i++) {
    const value=modelWeatherFromCode(allCodes[i]);
    assert.deepEqual(value.phenomena,expectedTokens[i]?[expectedTokens[i]]:[],String(allCodes[i]));
    assert.notEqual(value.condition,"neutral");
    const fx=effects(value.phenomena);
    assert.equal(fx.atmosphere.lightningLevel,"none",`${allCodes[i]} is model, never an observed lightning report`);
  }
});

test("freezing drizzle/rain, rime fog, grains and showers no longer collapse into coarse themes",()=>{
  for(const [code,precip,obscuration] of [[48,"none","freezing-fog"],[56,"freezing-drizzle","none"],[57,"freezing-drizzle","none"],[66,"freezing-rain","none"],[67,"freezing-rain","none"],[77,"snow-grains","none"],[80,"rain","none"],[85,"snow-shower","none"]]) {
    const result=effects(modelWeatherFromCode(code).phenomena);
    assert.equal(result.fx.precip,precip,String(code));
    assert.equal(result.obscuration.type,obscuration,String(code));
  }
  assert.equal(effects(modelWeatherFromCode(71).phenomena).fx.intensity,"light");
  assert.equal(effects(modelWeatherFromCode(75).phenomena).fx.intensity,"heavy");
  assert.equal(effects(modelWeatherFromCode(86).phenomena).fx.intensity,"heavy");
});

test("model thunder does not invent rain, hail or current warning information",()=>{
  const ordinary=modelWeatherFromCode(95),heavy=modelWeatherFromCode(97);
  assert.equal(effects(ordinary.phenomena).fx.precip,"none");
  assert.equal(effects(heavy.phenomena).fx.precip,"none");
  assert.doesNotMatch(heavy.description,/hail/i);
  for(const code of [96,99]) assert.equal(effects(modelWeatherFromCode(code).phenomena).fx.precip,"hail");
});

test("unknown or missing model codes do not manufacture a clear/cloudy condition",()=>{
  for(const code of [null,undefined,NaN,Infinity,-1,98,999,"61",{},1.5]) assert.deepEqual(modelWeatherFromCode(code),{condition:"neutral",description:"Weather unavailable",phenomena:[]});
  const a=modelWeatherFromCode(61);a.phenomena.push("TS");assert.deepEqual(modelWeatherFromCode(61).phenomena,["-RA"]);
});

test("current and forecast use model phenomenon metadata without changing source hierarchy",()=>{
  for(const code of allCodes) {
    const model=modelWeatherFromCode(code);
    const label=currentWeatherPresentation({...model,operationalWeather:null,simulated:false,coverage:"BKN",ceiling:null,visibility:null});
    assert.deepEqual(label.codes,model.phenomena);
    assert.equal(label.label,model.description);
  }
  const source=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.match(source,/phenomena:mapped\.phenomena/);
  assert.match(source,/forecast:tafProduct\?\.forecast\?\?model\.forecast/);
  assert.match(source,/isStale:displayLightning\.isStale/);
  assert.match(source,/currentLightning:\{\.\.\.NO_LIGHTNING\}/);
});
