import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatForecastProbability,
  formatPrecipitationDisplay,
  normalizeTafProbability,
  HOURLY_PRECIPITATION_COVERAGE_MS,
  matchPeriodPrecipitation,
  normalizeFutureSkyDisplay,
  normalizePrecipitationProbability,
} from "../app/futureWeather.ts";

test("future sky maps single forecast layers to exact aviation display text",()=>{
  const cases=[
    [{cloudCoverage:"FEW",cloudBaseFt:4500},"FEW CLOUDS","FEW CLDS 4,500 FT","FEW",4500,null,true],
    [{cloudCoverage:"FEW",cloudBaseFt:6000},"FEW CLOUDS","FEW CLDS 6,000 FT","FEW",6000,null,true],
    [{cloudCoverage:"SCT",cloudBaseFt:5000},"SCATTERED CLOUDS","SCT CLDS 5,000 FT","SCT",5000,null,true],
    [{cloudCoverage:"BKN",cloudBaseFt:10000},"BROKEN CEILING","CIG 10,000 FT","BKN",10000,10000,false],
    [{cloudCoverage:"OVC",cloudBaseFt:800},"OVERCAST CEILING","CIG 800 FT","OVC",800,800,false],
  ];
  for(const [input,headline,detail,coverage,cloudBaseFt,ceilingFt,ceilingUnlimited] of cases) {
    assert.deepEqual(normalizeFutureSkyDisplay(input),{headline,detail,coverage,cloudBaseFt,ceilingFt,ceilingUnlimited});
  }
});

test("SKC, CLR, NSC, and NCD are explicit unlimited ceilings with no fabricated cloud base",()=>{
  for(const coverage of ["SKC","CLR","NCD"]) {
    const sky=normalizeFutureSkyDisplay({cloudCoverage:coverage,cloudBaseFt:25000});
    assert.deepEqual(sky,{headline:"CLEAR",detail:"CEILING UNLIMITED",coverage,cloudBaseFt:null,ceilingFt:null,ceilingUnlimited:true});
    assert.doesNotMatch(`${sky.headline} ${sky.detail}`,/25,000|CLDS/);
  }
  const nsc=normalizeFutureSkyDisplay({skyCondition:"NSC",cloudBaseFt:25000});
  assert.deepEqual(nsc,{headline:"NO SIGNIFICANT CLOUDS",detail:"CEILING UNLIMITED",coverage:"NSC",cloudBaseFt:null,ceilingFt:null,ceilingUnlimited:true});
});

test("FEW and SCT remain cloud layers, not ceilings, while a genuine FEW250 remains 25,000 ft",()=>{
  const few=normalizeFutureSkyDisplay({cloudCoverage:"FEW",cloudBaseFt:25000});
  assert.equal(few.detail,"FEW CLDS 25,000 FT");
  assert.equal(few.ceilingFt,null);
  assert.equal(few.ceilingUnlimited,true);
  assert.doesNotMatch(few.headline,/CEILING/);
  const sct=normalizeFutureSkyDisplay({cloudCoverage:"SCT",cloudBaseFt:5000});
  assert.doesNotMatch(`${sct.headline} ${sct.detail}`,/CIG/);
});

test("the lowest BKN, OVC, or VV layer controls the ceiling",()=>{
  const sky=normalizeFutureSkyDisplay({
    skyCoverage:"SCT",
    cloudCoverage:"SCT",
    cloudBaseFt:3000,
    cloudLayers:[
      {coverage:"FEW",baseFt:1500},
      {coverage:"BKN",baseFt:10000},
      {coverage:"OVC",baseFt:8000},
      {coverage:"VV",baseFt:500},
    ],
  });
  assert.deepEqual(sky,{headline:"INDEFINITE CEILING",detail:"CIG 500 FT",coverage:"VV",cloudBaseFt:500,ceilingFt:500,ceilingUnlimited:false});
});

test("supplied regression TAF-shaped periods preserve FEW bases and clear periods",()=>{
  const periods=[
    ["FEW045",{cloudCoverage:"FEW",cloudBaseFt:4500},"FEW CLDS 4,500 FT"],
    ["FEW060",{cloudCoverage:"FEW",cloudBaseFt:6000},"FEW CLDS 6,000 FT"],
    ["SKC",{cloudCoverage:"SKC",cloudBaseFt:null},"CEILING UNLIMITED"],
    ["SKC",{cloudCoverage:"SKC",cloudBaseFt:null},"CEILING UNLIMITED"],
    ["FEW045",{cloudCoverage:"FEW",cloudBaseFt:4500},"FEW CLDS 4,500 FT"],
  ];
  assert.deepEqual(periods.map(([raw,input])=>[raw,normalizeFutureSkyDisplay(input).detail]),periods.map(([raw,,detail])=>[raw,detail]));
});

test("PoP normalization preserves explicit zero and valid percentages but keeps missing invalid data nullable",()=>{
  assert.equal(normalizePrecipitationProbability(0),0);
  assert.equal(normalizePrecipitationProbability(35),35);
  assert.equal(normalizePrecipitationProbability(null),null);
  assert.equal(normalizePrecipitationProbability(undefined),null);
  assert.equal(normalizePrecipitationProbability(NaN),null);
  assert.equal(normalizePrecipitationProbability(-1),null);
  assert.equal(normalizePrecipitationProbability(101),null);
  assert.equal(formatPrecipitationDisplay(0),"0% PRECIP");
  assert.equal(formatPrecipitationDisplay(35),"35% PRECIP");
  assert.equal(formatPrecipitationDisplay(null),"—% PRECIP");
});

test("hourly PoP carries normalized source, valid time, fetch time, and age",()=>{
  const matched=matchPeriodPrecipitation("2026-08-05T20:00:00Z","2026-08-05T21:00:00Z",[{
    precipitationProbability:0,
    precipitationSource:"Open-Meteo",
    precipitationValidTime:"2026-08-05T20:00:00-00:00",
    precipitationFetchedAt:"2026-08-05T19:42:30Z",
  }],{now:"2026-08-05T20:02:30Z"});
  assert.deepEqual(matched,{
    precipitationProbability:0,
    precipitationSource:"Open-Meteo",
    precipitationValidTime:"2026-08-05T20:00:00.000Z",
    precipitationFetchedAt:"2026-08-05T19:42:30.000Z",
    precipitationAgeMinutes:20,
  });
});

test("UTC-hour matching handles date rollover without borrowing from the wrong date",()=>{
  const samples=[
    {precipitationProbability:35,precipitationSource:"NWS",precipitationValidTime:"2026-08-05T00:00:00Z",precipitationFetchedAt:"2026-08-04T23:45:00Z"},
    {precipitationProbability:0,precipitationSource:"NWS",precipitationValidTime:"2026-08-06T00:00:00Z",precipitationFetchedAt:"2026-08-05T23:45:00Z"},
  ];
  const matched=matchPeriodPrecipitation("2026-08-06T00:10:00Z","2026-08-06T01:00:00Z",samples,{now:"2026-08-06T00:11:00Z"});
  assert.equal(matched.precipitationProbability,0);
  assert.equal(matched.precipitationValidTime,"2026-08-06T00:00:00.000Z");
});

test("a multi-hour block reports its worst hour instead of only the hour it starts on",()=>{
  assert.equal(HOURLY_PRECIPITATION_COVERAGE_MS,3600000);
  const samples=[
    {precipitationProbability:5,precipitationSource:"NWS",precipitationValidTime:"2026-08-05T20:00:00Z"},
    {precipitationProbability:80,precipitationSource:"NWS",precipitationValidTime:"2026-08-05T21:00:00Z"},
    {precipitationProbability:40,precipitationSource:"NWS",precipitationValidTime:"2026-08-05T22:00:00Z"},
    {precipitationProbability:95,precipitationSource:"NWS",precipitationValidTime:"2026-08-05T23:00:00Z"},
  ];
  const matched=matchPeriodPrecipitation("2026-08-05T20:00:00Z","2026-08-05T23:00:00Z",samples);
  assert.equal(matched.precipitationProbability,80);
  assert.equal(matched.precipitationValidTime,"2026-08-05T21:00:00.000Z");

  // 23:00Z begins the hour after the block ends and is never borrowed.
  assert.equal(matchPeriodPrecipitation("2026-08-05T20:00:00Z","2026-08-05T21:00:00Z",samples).precipitationProbability,5);
});

test("a period with no usable end falls back to the single hour it begins",()=>{
  const samples=[
    {precipitationProbability:5,precipitationSource:"NWS",precipitationValidTime:"2026-08-05T20:00:00Z"},
    {precipitationProbability:80,precipitationSource:"NWS",precipitationValidTime:"2026-08-05T21:00:00Z"},
  ];
  for(const end of [null,undefined,"","2026-08-05T20:00:00Z","2026-08-05T19:00:00Z"]) {
    assert.equal(matchPeriodPrecipitation("2026-08-05T20:00:00Z",end,samples).precipitationProbability,5);
  }
});

test("missing and prior-hour PoP remain unavailable instead of becoming or carrying zero",()=>{
  const missing=matchPeriodPrecipitation("2026-08-05T20:00:00Z","2026-08-05T21:00:00Z",[{
    precipitationProbability:null,
    precipitationSource:"NWS",
    precipitationValidTime:"2026-08-05T20:00:00Z",
  }]);
  assert.equal(missing.precipitationProbability,null);
  assert.equal(missing.precipitationSource,"NWS");

  // A real number always outranks a sample with no usable probability.
  const partial=matchPeriodPrecipitation("2026-08-05T20:00:00Z","2026-08-05T22:00:00Z",[
    {precipitationProbability:null,precipitationSource:"NWS",precipitationValidTime:"2026-08-05T20:00:00Z"},
    {precipitationProbability:20,precipitationSource:"NWS",precipitationValidTime:"2026-08-05T21:00:00Z"},
  ]);
  assert.equal(partial.precipitationProbability,20);

  const stale=matchPeriodPrecipitation("2026-08-05T21:00:00Z","2026-08-05T22:00:00Z",[{
    precipitationProbability:35,
    precipitationSource:"NWS",
    precipitationValidTime:"2026-08-05T20:00:00Z",
  }]);
  assert.deepEqual(stale,{
    precipitationProbability:null,
    precipitationSource:null,
    precipitationValidTime:null,
    precipitationFetchedAt:null,
    precipitationAgeMinutes:null,
  });
});

test("TAF weather content cannot manufacture a precipitation percentage",()=>{
  const tafShapedRow={validTime:"2026-08-06T04:00:00Z",raw:"FM060400 12004KT P6SM SKC"};
  const result=matchPeriodPrecipitation(tafShapedRow.validTime,"2026-08-06T08:00:00Z",[]);
  assert.equal(result.precipitationProbability,null);
  assert.equal(result.precipitationValidTime,null);
});

test("model timestamps are absolute, never a whole series shifted by one fixed offset",()=>{
  const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
  // A single utc_offset_seconds is correct only until a DST transition lands inside the
  // forecast window; unixtime values are already absolute UTC.
  assert.match(page,/timeformat=unixtime/);
  assert.doesNotMatch(page,/j\.utc_offset_seconds/);
  assert.doesNotMatch(page,/utcOffset/);
  assert.match(page,/utcIso=\(seconds:number\)=>new Date\(Number\(seconds\)\*1000\)\.toISOString\(\)/);
  // Local wall-clock strings are formatted per-instant in the configured zone.
  assert.match(page,/Intl\.DateTimeFormat\("en-US",\{timeZone:CONFIG\.timeZone,hourCycle:"h23"/);
  assert.match(page,/solarDays:SolarDay\[\]=j\.daily\.time\.map\(\(seconds:number,i:number\)=>\(\{date:dateKey\(/);
});

test("a row states the probability that belongs to the words beside it",()=>{
  // A PROB group wins the row, so the forecaster's own figure is shown, not a model PoP
  // that answers a different question and disagrees with the label.
  assert.equal(formatForecastProbability(30,17),"PROB30");
  assert.equal(formatForecastProbability(40,8),"PROB40");
  assert.equal(formatForecastProbability(30,null),"PROB30");

  // Every other row keeps the hourly model PoP, including an explicit zero.
  assert.equal(formatForecastProbability(null,17),"17% PRECIP");
  assert.equal(formatForecastProbability(undefined,0),"0% PRECIP");
  assert.equal(formatForecastProbability(null,null),"—% PRECIP");

  // Only the two probabilities a TAF can carry are honored; anything else is not a
  // forecaster figure and must not be printed as one.
  for(const bogus of [0,15,100,"30",NaN,true]) {
    assert.equal(normalizeTafProbability(bogus),null);
    assert.equal(formatForecastProbability(bogus,17),"17% PRECIP");
  }
  assert.equal(normalizeTafProbability(30),30);
  assert.equal(normalizeTafProbability(40),40);
});

test("the forecast row reads its probability from the winning group",()=>{
  const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.match(page,/const precipText=formatForecastProbability\(f\.operationalWeather\?\.probability,f\.precipitationProbability\);/);
});
