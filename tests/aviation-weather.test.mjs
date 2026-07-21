import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStructuredTaf,
  choosePrimaryOperationalWeather,
  extractAviationPhenomena,
  formatTafWindow,
  isTafPeriodActive,
  parseStructuredTaf,
  qualifiesForTafHazardBand,
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
  assert.deepEqual(result.hazards.map(h=>h.weather.sourceKind),["TAF_TEMPO","TAF_PROB40_TEMPO","TAF_PROB30"]);
});

test("prevailing TAF phenomena also outrank prevailing cloud layers",()=>{
  const taf="TAF KMEM 200500Z 2006/2112 18008KT 5SM -RA BKN025 FM201200 22010KT P6SM SCT040";
  const timeline=parseStructuredTaf(taf,new Date("2026-07-20T07:00:00Z"));
  assert.ok(timeline);
  assert.equal(timeline.prevailing[0].weather.category,"liquid-precipitation");
  assert.equal(timeline.prevailing[0].weather.label,"Light rain");
  assert.equal(timeline.prevailing[1].weather.category,"cloud");
});

test("TAF windows are human-readable on the current day, a future day, and across midnight",()=>{
  assert.deepEqual(formatTafWindow("2026-07-20T20:00:00Z","2026-07-20T23:00:00Z",new Date("2026-07-20T18:00:00Z")),{full:"20–23Z",compact:"20–23Z"});
  assert.deepEqual(formatTafWindow("2026-07-21T02:00:00Z","2026-07-21T05:00:00Z",new Date("2026-07-20T18:00:00Z")),{full:"21 JUL · 02–05Z",compact:"21/02–05Z"});
  assert.deepEqual(formatTafWindow("2026-07-20T20:00:00Z","2026-07-21T01:00:00Z",new Date("2026-07-20T18:00:00Z")),{full:"20 JUL 20Z – 21 JUL 01Z",compact:"20/20Z–21/01Z"});
});

test("TAF periods retain exclusive end-time behavior",()=>{
  const period={fromIso:"2026-07-20T05:00:00Z",toIso:"2026-07-20T07:00:00Z"};
  assert.equal(isTafPeriodActive(period,Date.parse("2026-07-20T06:59:59Z")),true);
  assert.equal(isTafPeriodActive(period,Date.parse("2026-07-20T07:00:00Z")),false);
});

function resolveTaf(text,sourceKind="TAF_BASE",probability=null,temporary=false){return resolveOperationalWeather({text,sourceKind,probability,temporary});}

test("hazard-band policy keeps routine VCSH in the card but out of the band",()=>{
  const vcsh=resolveTaf("P6SM VCSH SCT050");
  assert.equal(vcsh.label,"Showers nearby");
  assert.equal(vcsh.category,"liquid-precipitation");
  assert.equal(qualifiesForTafHazardBand(vcsh),false);
  assert.equal(qualifiesForTafHazardBand(resolveTaf("P6SM VCTS SCT050")),true);
  assert.equal(qualifiesForTafHazardBand(resolveTaf("5SM -TSRA BKN030","TAF_PROB30",30)),true);
});

test("hazard band admits restrictive visibility and ceilings but rejects routine clouds",()=>{
  assert.equal(qualifiesForTafHazardBand(resolveTaf("P6SM SCT050")),false);
  assert.equal(qualifiesForTafHazardBand(resolveTaf("P6SM BKN025")),false);
  assert.equal(qualifiesForTafHazardBand(resolveTaf("2SM BR OVC006","TAF_TEMPO",null,true)),true);
  assert.equal(qualifiesForTafHazardBand(resolveTaf("6SM -RA BKN020")),false);
  assert.equal(qualifiesForTafHazardBand(resolveTaf("5SM RA BKN020")),true);
});

test("multiple TAF hazards rank by operational priority, then active state, then start",()=>{
  const taf=`TAF KMEM 200500Z 2006/2112 18008KT P6SM SCT050
TEMPO 2006/2009 5SM RA BKN020
PROB30 2008/2011 3SM TSRA BKN020CB
PROB40 2006/2008 3SM TSRA BKN020CB`;
  const timeline=parseStructuredTaf(taf,new Date("2026-07-20T07:00:00Z"));assert.ok(timeline);
  const result=applyStructuredTaf([],timeline,new Date("2026-07-20T07:00:00Z"));
  assert.deepEqual(result.hazards.map(h=>h.weather.sourceKind),["TAF_PROB40","TAF_PROB30","TAF_TEMPO"]);
});

import { parseCurrentLightning } from "../app/lightning.ts";
import { classifyEffect, buildFxSpec, buildObscurationSpec } from "../app/weatherFx.ts";

test("Current-versus-forecast separation regression test", () => {
  const metarText = "METAR KMEM 210154Z 00000KT 10SM FEW070 BKN250 31/24 A2987 RMK AO2 SLP108 T03110239 $";
  const tafText = `TAF KMEM 202327Z 2100/2206 VRB06KT P6SM VCSH SCT050 BKN250
  FM210200 19004KT P6SM SCT100 SCT250
  FM210600 19003KT P6SM FEW250
  FM211500 24004KT P6SM SCT050
  PROB30 2200/2206 4SM TSRA BKN050CB`;

  // Parse METAR
  const resolvedMetar = resolveOperationalWeather({ text: metarText, sourceKind: "METAR" });
  const phenomena = extractAviationPhenomena(metarText);
  const fx = classifyEffect(phenomena);
  const lightning = parseCurrentLightning(metarText);

  // Assert current:
  // * Cloud scene
  assert.equal(resolvedMetar.condition, "overcast");
  assert.equal(resolvedMetar.category, "cloud");
  // * No rain, no drizzle, no pane droplets
  assert.equal(fx.precip, "none");
  assert.equal(fx.secondaryPrecip, "none");
  assert.equal(fx.liquidPresent, false);
  // * No current lightning, no thunderstorm scene
  assert.equal(lightning.level, "none");
  assert.notEqual(resolvedMetar.condition, "thunderstorm");

  // Parse TAF
  const timeline = parseStructuredTaf(tafText, new Date("2026-07-21T02:00:00Z"));
  assert.ok(timeline);

  // Assert forecast:
  // * VCSH forecast remains available
  const basePeriod = timeline.prevailing.find(p => p.raw.includes("VCSH"));
  assert.ok(basePeriod);
  assert.equal(basePeriod.weather.label, "Showers nearby");

  // * PROB30 TSRA remains available
  const prob30Period = timeline.overlays.find(p => p.weather.sourceKind === "TAF_PROB30" && p.raw.includes("TSRA"));
  assert.ok(prob30Period);
  assert.equal(prob30Period.weather.label, "Thunderstorm, rain");

  // * Forecast window remains 22/00Z-06Z
  assert.equal(prob30Period.fromIso, "2026-07-22T00:00:00.000Z");
  assert.equal(prob30Period.toIso, "2026-07-22T06:00:00.000Z");
});

test("Current METAR rain regression test", () => {
  const metarText = "METAR KMEM 210154Z 00000KT 10SM -RA BKN020 31/24 A2987";
  const phenomena = extractAviationPhenomena(metarText);
  const fx = classifyEffect(phenomena);
  const spec = buildFxSpec(fx, 1, 12, "full", false, false, null, 10);

  // * Rain particles active
  assert.equal(fx.precip, "rain");
  assert.ok(spec && spec.count > 0);
  // * Pane drops active
  assert.ok(spec && spec.pane && spec.pane.count > 0);
});

test("Current METAR snow regression test", () => {
  const metarText = "METAR KMEM 210154Z 00000KT 10SM SN BKN020 31/24 A2987";
  const phenomena = extractAviationPhenomena(metarText);
  const fx = classifyEffect(phenomena);
  const spec = buildFxSpec(fx, 1, 12, "full", false, false, null, 10);

  // * Snow active
  assert.equal(fx.precip, "snow");
  assert.ok(spec && spec.count > 0);
  // * Pane drops inactive
  assert.equal(fx.liquidPresent, false);
  assert.ok(spec && spec.pane === null);
});

test("Mixed precipitation regression test", () => {
  const metarText = "METAR KMEM 210154Z 00000KT 10SM RASN BKN020 31/24 A2987";
  const phenomena = extractAviationPhenomena(metarText);
  const fx = classifyEffect(phenomena);
  const spec = buildFxSpec(fx, 1, 12, "full", false, false, null, 10);

  // * Rain and snow behavior active
  assert.equal(fx.precip, "snow");
  assert.equal(fx.secondaryPrecip, "rain");
  assert.ok(spec && spec.count > 0 && spec.secondary && spec.secondary.count > 0);
  // * Pane drops active
  assert.equal(fx.liquidPresent, true);
  assert.ok(spec && spec.pane && spec.pane.count > 0);
});

test("Fog regression test", () => {
  const metarText = "METAR KMEM 210154Z 00000KT 1/2SM FG BKN002 31/24 A2987";
  const phenomena = extractAviationPhenomena(metarText);
  const fx = classifyEffect(phenomena);

  // * Fog active
  assert.equal(fx.obscuration, "fog");

  // * Fog density follows current visibility
  const specRestricted = buildObscurationSpec(fx, 0.5, 1, 12, "full", false);
  const specClear = buildObscurationSpec(fx, 10, 1, 12, "full", false);
  assert.ok(specRestricted.density > specClear.density);
});

test("Lightning regression test", () => {
  // Current METAR fallback VCTS -> vicinity lightning
  const metarVcts = "METAR KMEM 210154Z 00000KT 10SM VCTS BKN020 31/24 A2987";
  assert.equal(parseCurrentLightning(metarVcts).level, "vicinity");

  // Current METAR fallback TSRA -> station lightning
  const metarTsra = "METAR KMEM 210154Z 00000KT 10SM TSRA BKN020 31/24 A2987";
  assert.equal(parseCurrentLightning(metarTsra).level, "station");

  // TAF TSRA alone does not activate current lightning
  const rawTaf = "TAF KMEM 202327Z 2100/2206 VRB06KT P6SM TSRA BKN020";
  assert.equal(parseCurrentLightning(rawTaf).level, "none");
});

