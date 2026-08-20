import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NWS_PRECIPITATION_SOURCE, applyNwsPrecipitation, describePrecipitationSource, parseNwsHourlyPrecipitation } from "../app/nwsPrecipitation.ts";
import { matchPeriodPrecipitation } from "../app/futureWeather.ts";

const FETCHED="2026-08-20T01:20:00.000Z";
const period=(startTime,value,unitCode="wmoUnit:percent")=>({startTime,probabilityOfPrecipitation:{unitCode,value}});
const payload=(...periods)=>({properties:{periods}});
const row=(iso,probability=5)=>({time:iso.slice(11,16),iso,temperatureF:80,precipitationProbability:probability,precipitationSource:"Open-Meteo",precipitationValidTime:iso,precipitationFetchedAt:FETCHED,precipitationAgeMinutes:0});

test("gridpoint hours parse into normalized PoP samples",()=>{
  const samples=parseNwsHourlyPrecipitation(payload(
    period("2026-08-19T20:00:00-05:00",3),
    period("2026-08-19T21:00:00-05:00",48),
  ),FETCHED);
  assert.deepEqual(samples,[
    {precipitationProbability:3,precipitationSource:"NWS",precipitationValidTime:"2026-08-20T01:00:00.000Z",precipitationFetchedAt:FETCHED},
    {precipitationProbability:48,precipitationSource:"NWS",precipitationValidTime:"2026-08-20T02:00:00.000Z",precipitationFetchedAt:FETCHED},
  ]);
  assert.equal(NWS_PRECIPITATION_SOURCE,"NWS");
});

test("a malformed or re-specified payload yields no samples rather than a wrong number",()=>{
  const cases=[
    null, undefined, {}, {properties:{}}, {properties:{periods:null}}, {properties:{periods:"nope"}},
    payload(period("not-a-time",50)),
    payload(period("2026-08-20T01:00:00Z",50,"wmoUnit:mm")),   // unit changed out from under us
    payload(period("2026-08-20T01:00:00Z",null)),
    payload(period("2026-08-20T01:00:00Z",-1)),
    payload(period("2026-08-20T01:00:00Z",101)),
    payload(period("2026-08-20T01:00:00Z","50")),
    payload({startTime:"2026-08-20T01:00:00Z"}),
  ];
  for(const value of cases) assert.deepEqual(parseNwsHourlyPrecipitation(value,FETCHED),[],`expected no samples for ${JSON.stringify(value)}`);
});

test("gridpoint values replace the model PoP hour for hour",()=>{
  const rows=[row("2026-08-20T01:00:00.000Z"),row("2026-08-20T02:00:00.000Z"),row("2026-08-20T03:00:00.000Z")];
  const samples=parseNwsHourlyPrecipitation(payload(
    period("2026-08-20T01:00:00Z",3),
    period("2026-08-20T02:00:00Z",48),
  ),FETCHED);
  const applied=applyNwsPrecipitation(rows,samples);

  assert.deepEqual(applied.map(r=>[r.precipitationProbability,r.precipitationSource]),[
    [3,"NWS"],
    [48,"NWS"],
    [5,"Open-Meteo"], // beyond gridpoint coverage: the model figure stands, and says so
  ]);
  // Untouched fields survive the swap.
  assert.equal(applied[0].temperatureF,80);
  assert.equal(applied[1].precipitationValidTime,"2026-08-20T02:00:00.000Z");
});

test("no samples leaves every row exactly as it arrived",()=>{
  const rows=[row("2026-08-20T01:00:00.000Z"),row("2026-08-20T02:00:00.000Z",40)];
  assert.deepEqual(applyNwsPrecipitation(rows,[]),rows);
  assert.deepEqual(applyNwsPrecipitation(rows,parseNwsHourlyPrecipitation(null,FETCHED)),rows);
});

test("gridpoint PoP feeds the same period aggregation the model PoP did",()=>{
  const rows=[row("2026-08-20T01:00:00.000Z"),row("2026-08-20T02:00:00.000Z"),row("2026-08-20T03:00:00.000Z")];
  const samples=parseNwsHourlyPrecipitation(payload(
    period("2026-08-20T01:00:00Z",10),
    period("2026-08-20T02:00:00Z",48),
    period("2026-08-20T03:00:00Z",22),
  ),FETCHED);
  const applied=applyNwsPrecipitation(rows,samples);
  // A row spanning 01-04Z reports the worst gridpoint hour inside it, not its first hour.
  const block=matchPeriodPrecipitation("2026-08-20T01:00:00Z","2026-08-20T04:00:00Z",applied,{now:FETCHED});
  assert.equal(block.precipitationProbability,48);
  assert.equal(block.precipitationSource,"NWS");
  assert.equal(block.precipitationValidTime,"2026-08-20T02:00:00.000Z");
});

test("the gridpoint is fetched alongside the other feeds and never blocks them",()=>{
  const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.match(page,/nwsHourlyUrl:"https:\/\/api\.weather\.gov\/gridpoints\/MEG\/45,62\/forecast\/hourly"/);
  // allSettled, so an NWS outage degrades to model PoP instead of failing the refresh.
  assert.match(page,/Promise\.allSettled\(\[getModelWeather\(signal\),feed,nws\]\)/);
  assert.match(page,/const nwsSamples=nwsResult\.status==="fulfilled"\?nwsResult\.value:\[\];/);
  // The swap happens before anything reads model.forecast, so the TAF builder aggregates it.
  assert.ok(page.indexOf("applyNwsPrecipitation(modelWeather.forecast,nwsSamples)")<page.indexOf("applyStructuredTaf(model.forecast"));
});

test("the footer states which source the PoP came from so a fallback is not silent",()=>{
  const r=(probability,source)=>({precipitationProbability:probability,precipitationSource:source});
  assert.equal(describePrecipitationSource([r(3,"NWS"),r(48,"NWS")]),"POP NWS");
  // A gridpoint that stopped answering downgrades every row and now says so.
  assert.equal(describePrecipitationSource([r(8,"Open-Meteo"),r(17,"Open-Meteo")]),"POP OPEN-METEO");
  // Partial gridpoint coverage is reported as the mix it is.
  assert.equal(describePrecipitationSource([r(3,"NWS"),r(17,"Open-Meteo")]),"POP NWS/OPEN-METEO");
  // Rows with no usable figure never imply a working source.
  assert.equal(describePrecipitationSource([]),"POP UNAVAILABLE");
  assert.equal(describePrecipitationSource([r(null,"NWS"),r(null,null)]),"POP UNAVAILABLE");
});

test("the PoP source is rendered in the footer diagnostics strip",()=>{
  const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.match(page,/const popDiagnostic=describePrecipitationSource\(weather\.forecast\);/);
  assert.match(page,/<span>\{feedDiagnostic\}<\/span><span>\{popDiagnostic\}<\/span>/);
});
