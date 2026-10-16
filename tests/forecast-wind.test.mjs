import test from "node:test";
import assert from "node:assert/strict";
import { applyStructuredTaf, parseStructuredTaf } from "../app/aviationWeatherPriority.ts";
import { isForecastWindRecord, parseForecastWindToken, resolveForecastWind } from "../app/forecastWind.ts";

const reference = new Date("2026-10-20T18:00:00Z");
const parse = body => parseStructuredTaf(`TAF KMEM 201700Z 2018/2118 ${body}`, reference);
const at = (timeline, iso) => resolveForecastWind(timeline.windPeriods, iso);
const slot = (iso, extra={}) => ({time:"MODEL",iso,temperatureF:72,condition:"clear",description:"Model clear",precipitationProbability:20,precipitationSource:"NWS",precipitationValidTime:iso,precipitationFetchedAt:reference.toISOString(),precipitationAgeMinutes:0,source:"MODEL",operationalWeather:null,...extra});

test("forecast wind parses calm, variable, directional, and gusty winds in declared units", () => {
  assert.deepEqual(parseForecastWindToken("00000KT P6SM SKC"), {directionType:"calm",directionDegrees:null,speedKt:0,gustKt:null,raw:"00000KT"});
  assert.deepEqual(parseForecastWindToken("VRB03KT P6SM"), {directionType:"variable",directionDegrees:null,speedKt:3,gustKt:null,raw:"VRB03KT"});
  assert.deepEqual(parseForecastWindToken("35015G25KT P6SM"), {directionType:"directional",directionDegrees:350,speedKt:15,gustKt:25,raw:"35015G25KT"});
  assert.equal(parseForecastWindToken("36010KT").directionDegrees,360);
  for (const [raw,speed,gust] of [["18010G20MPS",10*3600/1852,20*3600/1852],["27020G30KMH",20*1000/1852,30*1000/1852]]) {
    const parsed=parseForecastWindToken(raw);
    assert.ok(Math.abs(parsed.speedKt-speed)<1e-10);
    assert.ok(Math.abs(parsed.gustKt-gust)<1e-10);
    assert.equal(parsed.raw,raw);
  }
});

test("missing, malformed, unsupported, remark, and wind-shear values are never surface winds", () => {
  for (const raw of ["", "P6SM SCT050", "WS020/18040KT", "P6SM RMK 18020KT", "18010MPH", "99910KT", "00010KT", "18010G05KT", "180//KT", "///10KT", "00000G20KT", "2XX10KT 18010KT", "18010KT 27020KT"]) {
    assert.equal(parseForecastWindToken(raw),null,raw);
  }
  assert.equal(parseForecastWindToken("VRB03KT WS020/18040KT").raw,"VRB03KT");
});

test("FM replaces all wind fields, stops gusts, and leaves missing wind unknown", () => {
  const timeline=parse("35015G25KT P6SM SCT050 FM202000 20008KT P6SM SKC FM202200 P6SM BKN030 FM210000 VRB03KT P6SM SKC");
  assert.equal(at(timeline,"2026-10-20T19:59:59Z").gustKt,25);
  const steady=at(timeline,"2026-10-20T20:00:00Z");
  assert.equal(steady.raw,"20008KT");
  assert.equal(steady.gustKt,null);
  assert.equal(steady.sourceKind,"TAF_FM");
  assert.equal(steady.issueIso,"2026-10-20T17:00:00.000Z");
  assert.equal(steady.validFromIso,"2026-10-20T20:00:00.000Z");
  assert.equal(steady.validToIso,"2026-10-20T22:00:00.000Z");
  assert.equal(at(timeline,"2026-10-20T22:00:00Z"),null);
  assert.equal(at(timeline,"2026-10-21T00:00:00Z").directionType,"variable");
});

test("conditional TEMPO and PROB winds never silently become prevailing", () => {
  const timeline=parse("18010KT P6SM SCT050 TEMPO 2019/2021 27025G40KT 2SM TSRA BKN010CB PROB30 2021/2023 31030G45KT 1SM +TSRA BKN008CB PROB40 TEMPO 2023/2101 VRB35G50KT 1SM +TSRA BKN008CB");
  for (const hour of [19,21,23]) assert.equal(at(timeline,`2026-10-20T${hour}:00:00Z`).raw,"18010KT");
  const rows=applyStructuredTaf([slot("2026-10-20T18:00:00Z"),slot("2026-10-20T20:00:00Z"),slot("2026-10-20T22:00:00Z")],timeline,reference).forecast;
  assert.ok(rows.some(row=>row.operationalWeather?.sourceKind==="TAF_TEMPO"));
  assert.ok(rows.some(row=>row.operationalWeather?.sourceKind==="TAF_PROB30"));
  assert.ok(rows.every(row=>row.forecastWind.raw==="18010KT"));
  assert.ok(rows.every(row=>row.temperatureF===72));
  assert.equal(rows.find(row=>row.iso==="2026-10-20T19:00:00.000Z").operationalWeather.cloudCoverage,"BKN");
});

test("BECMG wind transition is unknown until completion, then later FM resets it", () => {
  const timeline=parse("18012G25KT P6SM SCT030 BECMG 2020/2022 24008KT FM210000 30005KT P6SM SKC");
  assert.equal(at(timeline,"2026-10-20T19:59:59Z").raw,"18012G25KT");
  for (const time of ["20:00:00", "21:59:59"]) assert.equal(at(timeline,`2026-10-20T${time}Z`),null);
  assert.equal(at(timeline,"2026-10-20T22:00:00Z").raw,"24008KT");
  assert.equal(at(timeline,"2026-10-20T22:00:00Z").sourceKind,"TAF_BECMG");
  assert.equal(at(timeline,"2026-10-21T00:00:00Z").raw,"30005KT");
  const rows=applyStructuredTaf([slot("2026-10-20T18:00:00Z")],timeline,reference).forecast;
  assert.deepEqual(rows.map(row=>row.forecastWind?.raw??null),["18012G25KT",null,"24008KT","30005KT"]);
});

test("BECMG omission inherits wind but malformed changed wind is unknown", () => {
  const unchanged=parse("18012G25KT P6SM SCT030 BECMG 2020/2022 BKN015");
  assert.equal(unchanged.windPeriods.length,1);
  assert.equal(at(unchanged,"2026-10-20T21:00:00Z").raw,"18012G25KT");
  assert.equal(at(unchanged,"2026-10-20T23:00:00Z").raw,"18012G25KT");
  for (const raw of ["240//KT", "2XX10KT"]) {
    const malformed=parse(`18012G25KT P6SM SCT030 BECMG 2020/2022 ${raw}`);
    assert.equal(at(malformed,"2026-10-20T21:00:00Z"),null);
    assert.equal(at(malformed,"2026-10-20T23:00:00Z"),null);
  }
});

test("an FM during BECMG supersedes its pending completion", () => {
  const timeline=parse("18012KT P6SM SCT030 BECMG 2020/2023 24008KT FM202100 31005KT P6SM SKC");
  assert.equal(at(timeline,"2026-10-20T20:30:00Z"),null);
  assert.equal(at(timeline,"2026-10-20T21:00:00Z").raw,"31005KT");
  assert.equal(at(timeline,"2026-10-20T23:00:00Z").raw,"31005KT");
});

test("nominal validity guards wind across year rollover and 2400 end", () => {
  const timeline=parseStructuredTaf("TAF KMEM 312300Z 0100/0124 18008KT P6SM SKC FM010130 22012G20KT P6SM BKN030",new Date("2026-12-31T23:15:00Z"));
  assert.equal(at(timeline,"2026-12-31T23:30:00Z"),null);
  assert.equal(at(timeline,"2027-01-01T00:00:00Z").raw,"18008KT");
  assert.equal(at(timeline,"2027-01-01T01:29:59Z").raw,"18008KT");
  assert.equal(at(timeline,"2027-01-01T01:30:00Z").raw,"22012G20KT");
  assert.equal(at(timeline,"2027-01-01T23:59:59Z").raw,"22012G20KT");
  assert.equal(at(timeline,"2027-01-02T00:00:00Z"),null);
});

test("missing/expired TAF wind overwrites any carried current/model-shaped value", () => {
  const timeline=parse("P6SM SCT030 TEMPO 2019/2021 18015KT 3SM TSRA BKN010CB");
  const bad={source:"METAR",directionDegrees:280,speedKt:32,raw:"28032KT"};
  const model=[slot("2026-10-20T18:00:00Z",{forecastWind:bad,currentWind:bad}),slot("2026-10-20T19:00:00Z",{forecastWind:bad}),slot("2026-10-20T20:00:00Z",{forecastWind:bad})];
  const rows=applyStructuredTaf(model,timeline,reference).forecast;
  assert.ok(rows.length>=3);
  assert.ok(rows.every(row=>row.forecastWind===null));
  const expired=applyStructuredTaf([slot("2026-10-21T18:00:00Z",{forecastWind:bad})],parse("18010KT P6SM SKC"),new Date("2026-10-21T18:00:00Z")).forecast;
  assert.ok(expired.every(row=>row.forecastWind===null));
  assert.equal(resolveForecastWind(undefined,"2026-10-20T18:00:00Z"),null);
});

test("NIL, cancellation, and concatenated bulletins cannot manufacture wind", () => {
  for (const body of ["NIL", "CNL", "18012KT P6SM SKC FM203100 20010KT P6SM SKC", "P6SM SCT030 TAF KMEM 202300Z 2100/2200 18020KT P6SM SKC"]) {
    assert.equal(at(parse(body),"2026-10-20T18:00:00Z"),null,body);
  }
});

test("record validation rejects foreign, incoherent, and malformed cached extensions", () => {
  const record=at(parse("18012G20KT P6SM SCT030"),"2026-10-20T18:00:00Z");
  assert.equal(isForecastWindRecord(record),true);
  for (const patch of [{source:"METAR"},{sourceKind:"TAF_TEMPO"},{speedKt:NaN},{gustKt:Infinity},{directionDegrees:400},{raw:"WS020/18012G20KT"},{raw:"18012KT"},{issueIso:"not-a-date"},{validFromIso:record.validToIso},{issueIso:record.validToIso},{directionType:"calm"}]) {
    assert.equal(isForecastWindRecord({...record,...patch}),false,JSON.stringify(patch));
  }
  for (const value of [null,undefined,{},false,"18012KT"]) assert.equal(isForecastWindRecord(value),false);
});
