import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStructuredTaf,
  choosePrimaryOperationalWeather,
  extractAviationPhenomena,
  parseStructuredTaf,
  resolveOperationalWeather,
} from "../app/aviationWeatherPriority.ts";

const metar=value=>resolveOperationalWeather({text:value,sourceKind:"METAR"});

test("one operational priority puts phenomena ahead of cloud coverage",()=>{
  const rain=metar("METAR KMEM 201653Z 18008KT 4SM -RA BKN020");
  assert.equal(rain.category,"liquid-precipitation");
  assert.equal(rain.condition,"rain");
  assert.equal(rain.label,"Light rain");
  assert.equal(rain.cloudCoverage,"BKN");

  const cloud=metar("METAR KMEM 201653Z 18008KT P6SM BKN020");
  assert.equal(cloud.category,"cloud");
  assert.equal(cloud.label,"Broken clouds");
  assert.equal(cloud.cloudBaseFt,2000);
});

test("shared resolver covers ordered operational phenomenon families",()=>{
  const cases=[
    ["+FC TSRA BKN010","severe-convection","Tornado"],
    ["TSRAGR BKN010","thunderstorm","Thunderstorm, hail"],
    ["+FZRA OVC008","freezing-precipitation","Heavy freezing rain"],
    ["-RASN BKN012","winter-precipitation","Rain and snow"],
    ["+RA OVC015","liquid-precipitation","Heavy rain"],
    ["2SM BR BKN005","obscuration","Mist"],
  ];
  for(const [text,category,label] of cases){const resolved=metar(text);assert.equal(resolved.category,category);assert.equal(resolved.label,label);}
  assert.deepEqual(extractAviationPhenomena("P6SM VCTS SCT030CB"),["VCTS"]);
  const chosen=choosePrimaryOperationalWeather([metar("BR OVC003"),metar("-SN BKN010"),metar("TSRA BKN020CB")]);
  assert.equal(chosen?.category,"thunderstorm");
});

const rolloverTaf=`TAF KMEM 302320Z 0100/0212 18008KT P6SM SCT050
FM010300 20010KT P6SM BKN040
TEMPO 0104/0107 3SM TSRA BKN020CB
PROB30 0107/0110 1SM +SN OVC008
PROB40 TEMPO 0108/0111 1/2SM +FZRA VV002
FM011100 26012KT P6SM SKC`;

test("structured TAF parses base, FM, TEMPO, PROB, combined groups, and month rollover",()=>{
  const timeline=parseStructuredTaf(rolloverTaf,new Date("2026-07-31T23:30:00Z"));
  assert.ok(timeline);
  assert.equal(timeline.validStartIso,"2026-08-01T00:00:00.000Z");
  assert.equal(timeline.validEndIso,"2026-08-02T12:00:00.000Z");
  assert.deepEqual(timeline.prevailing.map(p=>p.weather.sourceKind),["TAF_BASE","TAF_FM","TAF_FM"]);
  assert.deepEqual(timeline.overlays.map(p=>p.weather.sourceKind),["TAF_TEMPO","TAF_PROB30","TAF_PROB40_TEMPO"]);
  assert.equal(timeline.overlays[0].weather.label,"Thunderstorm, rain");
  assert.equal(timeline.overlays[1].weather.probability,30);
  assert.equal(timeline.overlays[2].weather.temporary,true);
});

test("forecast slots use active overlays, severity, and exclusive TAF end times",()=>{
  const timeline=parseStructuredTaf(rolloverTaf,new Date("2026-07-31T23:30:00Z"));
  assert.ok(timeline);
  const slots=[
    ["03:00","2026-08-01T03:00:00.000Z"],
    ["04:00","2026-08-01T04:00:00.000Z"],
    ["07:00","2026-08-01T07:00:00.000Z"],
    ["08:00","2026-08-01T08:00:00.000Z"],
    ["11:00","2026-08-01T11:00:00.000Z"],
  ].map(([time,iso])=>({time,iso,temperatureF:80,condition:"clear",description:"Model clear",precipitation:10,source:"MODEL",operationalWeather:null}));
  const result=applyStructuredTaf(slots,timeline,new Date("2026-08-01T03:00:00Z"));
  assert.deepEqual(result.forecast.map(f=>f.operationalWeather?.sourceKind),["TAF_FM","TAF_TEMPO","TAF_PROB30","TAF_PROB40_TEMPO","TAF_FM"]);
  assert.deepEqual(result.forecast.map(f=>f.description),["Broken clouds","Thunderstorm, rain","Heavy snow","Heavy freezing rain","Clear"]);
  assert.equal(result.forecast[2].operationalWeather?.sourceKind,"TAF_PROB30");
  assert.equal(result.forecast[3].operationalWeather?.category,"freezing-precipitation");
  assert.deepEqual(result.hazards.map(h=>h.weather.sourceKind),["TAF_TEMPO","TAF_PROB30","TAF_PROB40_TEMPO"]);
});

test("prevailing TAF phenomena also outrank prevailing cloud layers",()=>{
  const taf="TAF KMEM 200500Z 2006/2112 18008KT 5SM -RA BKN025 FM201200 22010KT P6SM SCT040";
  const timeline=parseStructuredTaf(taf,new Date("2026-07-20T07:00:00Z"));
  assert.ok(timeline);
  assert.equal(timeline.prevailing[0].weather.category,"liquid-precipitation");
  assert.equal(timeline.prevailing[0].weather.label,"Light rain");
  assert.equal(timeline.prevailing[1].weather.category,"cloud");
});
