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
  parseAviationSky
} from "../app/aviationWeatherPriority.ts";

const metar=value=>resolveOperationalWeather({text:value,sourceKind:"METAR"});

test("one operational priority puts phenomena ahead of cloud coverage",()=>{
  const rain=metar("METAR KMEM 201653Z 18008KT 4SM -RA BKN020");
  assert.equal(rain.category,"liquid-precipitation");
  assert.equal(rain.condition,"rain");
  assert.equal(rain.label,"LIGHT RAIN");
  assert.equal(rain.cloudCoverage,"BKN");

  const cloud=metar("METAR KMEM 201653Z 18008KT P6SM BKN020");
  assert.equal(cloud.category,"cloud");
  assert.equal(cloud.label,"BROKEN CEILING");
  assert.equal(cloud.cloudBaseFt,2000);
});

test("shared resolver covers ordered operational phenomenon families",()=>{
  const cases=[
    ["+FC TSRA BKN010","severe-convection","TORNADO"],
    ["TSRAGR BKN010","thunderstorm","THUNDERSTORMS WITH RAIN AND HAIL"],
    ["+FZRA OVC008","freezing-precipitation","HEAVY FREEZING RAIN"],
    ["-RASN BKN012","winter-precipitation","RAIN AND SNOW"],
    ["+RA OVC015","liquid-precipitation","HEAVY RAIN"],
    ["2SM BR BKN005","obscuration","MIST"],
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
  assert.equal(timeline.overlays[0].weather.label,"THUNDERSTORMS WITH RAIN");
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
  assert.deepEqual(result.forecast.map(f=>f.time),["NOW","04:00Z","07:00Z","08:00Z","11:00Z"]);
  assert.deepEqual(result.forecast.map(f=>f.operationalWeather?.sourceKind),["TAF_FM","TAF_TEMPO","TAF_PROB30","TAF_PROB40_TEMPO","TAF_FM"]);
  assert.deepEqual(result.forecast.map(f=>f.description),["BROKEN CEILING","THUNDERSTORMS WITH RAIN","HEAVY SNOW","HEAVY FREEZING RAIN","CLEAR"]);
  assert.equal(result.forecast[2].operationalWeather?.sourceKind,"TAF_PROB30");
  assert.equal(result.forecast[3].operationalWeather?.category,"freezing-precipitation");
  assert.deepEqual(result.hazards.map(h=>h.weather.sourceKind),["TAF_TEMPO","TAF_PROB40_TEMPO","TAF_PROB30"]);
});

test("prevailing TAF phenomena also outrank prevailing cloud layers",()=>{
  const taf="TAF KMEM 200500Z 2006/2112 18008KT 5SM -RA BKN025 FM201200 22010KT P6SM SCT040";
  const timeline=parseStructuredTaf(taf,new Date("2026-07-20T07:00:00Z"));
  assert.ok(timeline);
  assert.equal(timeline.prevailing[0].weather.category,"liquid-precipitation");
  assert.equal(timeline.prevailing[0].weather.label,"LIGHT RAIN");
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
  assert.equal(vcsh.label,"SHOWERS IN THE VICINITY");
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
  assert.equal(resolvedMetar.condition, "partly-cloudy");
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
  assert.equal(basePeriod.weather.label, "SHOWERS IN THE VICINITY");

  // * PROB30 TSRA remains available
  const prob30Period = timeline.overlays.find(p => p.weather.sourceKind === "TAF_PROB30" && p.raw.includes("TSRA"));
  assert.ok(prob30Period);
  assert.equal(prob30Period.weather.label, "THUNDERSTORMS WITH RAIN");

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

test("Consistent current and future naming shared resolver and authority test", () => {
  // Required examples:
  // * -TSRA -> LIGHT THUNDERSTORMS WITH RAIN
  assert.equal(metar("METAR KMEM 201653Z -TSRA BKN020").label, "LIGHT THUNDERSTORMS WITH RAIN");
  // * TSRA -> THUNDERSTORMS WITH RAIN
  assert.equal(metar("METAR KMEM 201653Z TSRA BKN020").label, "THUNDERSTORMS WITH RAIN");
  // * +TSRA -> HEAVY THUNDERSTORMS WITH RAIN
  assert.equal(metar("METAR KMEM 201653Z +TSRA BKN020").label, "HEAVY THUNDERSTORMS WITH RAIN");
  // * FZRA -> FREEZING RAIN
  assert.equal(metar("METAR KMEM 201653Z FZRA BKN020").label, "FREEZING RAIN");
  // * VA -> VOLCANIC ASH
  assert.equal(metar("METAR KMEM 201653Z VA BKN020").label, "VOLCANIC ASH");
  // * BLSN -> BLOWING SNOW
  assert.equal(metar("METAR KMEM 201653Z BLSN BKN020").label, "BLOWING SNOW");
  // * MIFG -> SHALLOW FOG
  assert.equal(metar("METAR KMEM 201653Z MIFG BKN020").label, "SHALLOW FOG");
  // * BCFG -> PATCHES OF FOG
  assert.equal(metar("METAR KMEM 201653Z BCFG BKN020").label, "PATCHES OF FOG");
  // * VCSH -> SHOWERS IN THE VICINITY
  assert.equal(metar("METAR KMEM 201653Z VCSH BKN020").label, "SHOWERS IN THE VICINITY");
  // * RASN -> RAIN AND SNOW
  assert.equal(metar("METAR KMEM 201653Z RASN BKN020").label, "RAIN AND SNOW");

  // Cloud fallback:
  // * FEW070 -> FEW CLOUDS
  assert.equal(metar("METAR KMEM 201653Z FEW070").label, "FEW CLOUDS");
  // * SCT050 -> SCATTERED CLOUDS
  assert.equal(metar("METAR KMEM 201653Z SCT050").label, "SCATTERED CLOUDS");
  // * BKN050 -> BROKEN CEILING
  assert.equal(metar("METAR KMEM 201653Z BKN050").label, "BROKEN CEILING");
  // * OVC008 -> OVERCAST CEILING
  assert.equal(metar("METAR KMEM 201653Z OVC008").label, "OVERCAST CEILING");
  // * VV003 -> INDEFINITE CEILING
  assert.equal(metar("METAR KMEM 201653Z VV003").label, "INDEFINITE CEILING");
  // * FEW070 BKN250 -> PARTLY CLOUDY (high cirrus >= 12,000 FT)
  assert.equal(metar("METAR KMEM 201653Z FEW070 BKN250").label, "PARTLY CLOUDY");

  // Authority test:
  // Current METAR: FEW070 BKN250
  // TAF: VCSH ... PROB30 TSRA
  const metarText = "METAR KMEM 210154Z 10SM FEW070 BKN250";
  const tafText = `TAF KMEM 202327Z 2100/2206 VCSH SCT050 BKN250
  PROB30 2200/2206 4SM TSRA BKN050CB`;

  const resolvedMetar = resolveOperationalWeather({ text: metarText, sourceKind: "METAR" });
  assert.equal(resolvedMetar.label, "PARTLY CLOUDY");

  const timeline = parseStructuredTaf(tafText, new Date("2026-07-21T02:00:00Z"));
  assert.ok(timeline);

  const prevailingPeriod = timeline.prevailing.find(p => p.raw.includes("VCSH"));
  assert.ok(prevailingPeriod);
  assert.equal(prevailingPeriod.weather.label, "SHOWERS IN THE VICINITY");

  const probPeriod = timeline.overlays.find(p => p.weather.sourceKind === "TAF_PROB30" && p.raw.includes("TSRA"));
  assert.ok(probPeriod);
  assert.equal(probPeriod.weather.label, "THUNDERSTORMS WITH RAIN");
});



test("BKN160 selected below OVC250",()=>{
  const sky=parseAviationSky("METAR KMEM 212353Z 00000KT 10SM FEW080 BKN160 OVC250 30/23 A2992");
  assert.equal(sky.cloudCoverage,"BKN");
  assert.equal(sky.cloudBaseFt,16000);
});

test("PROB30 -TSRA outranks base VCTS",()=>{
  const base=metar("VCTS");
  const prob=resolveOperationalWeather({text:"-TSRA",sourceKind:"TAF_PROB30"});
  const chosen=choosePrimaryOperationalWeather([base,prob]);
  assert.ok(chosen);
  assert.equal(chosen.sourceKind,"TAF_PROB30");
  assert.equal(chosen.category,"thunderstorm");
});

test("NOW-05Z rollover formatting",()=>{
  const now = new Date("2026-07-31T23:30:00Z");
  const formatted = formatTafWindow("2026-07-31T23:30:00Z","2026-08-01T05:00:00Z",now);
  assert.equal(formatted.compact,"NOW–05Z");
});

test("transition rows include exact times and conditions instead of fixed slots",()=>{
  const taf="TAF KMEM 212330Z 2200/2306 18010KT P6SM VCTS SCT050CB PROB30 2201/2205 3SM -TSRA BKN020CB FM220500 20008KT P6SM VCSH SCT050 BKN200 FM220600 22005KT P6SM FEW250 FM221300 18010KT P6SM SCT035";
  // The TAF was issued at 212330Z. Valid from 2200 to 2306.
  const timeline=parseStructuredTaf(taf,new Date("2026-07-21T23:30:00Z"));
  
  // Dummy model slots
  const slots=[
    ["05:00","2026-07-22T05:00:00Z"],
    ["08:00","2026-07-22T08:00:00Z"],
    ["11:00","2026-07-22T11:00:00Z"],
  ].map(([time,iso])=>({time,iso,temperatureF:80,condition:"clear",description:"Model clear",precipitation:10,source:"MODEL",operationalWeather:null}));
  
  // Current time is 04:37Z
  const result=applyStructuredTaf(slots,timeline,new Date("2026-07-22T04:37:00Z"));
  
  const times = result.forecast.map(f=>f.time);
  assert.deepEqual(times, ["NOW", "05:00Z", "06:00Z", "13:00Z"]);
  
  // 04Z (base window): PROB30 -TSRA BKN020CB
  assert.equal(result.forecast[0].operationalWeather.shortLabel, "LT TSTMS WITH RAIN");
  assert.equal(result.forecast[0].operationalWeather.cloudCoverage, "BKN");
  assert.equal(result.forecast[0].operationalWeather.cloudBaseFt, 2000);
  
  // 05Z: VCSH / SCT050 BKN200 (BKN200 is the ceiling)
  assert.equal(result.forecast[1].operationalWeather.shortLabel, "VICINITY SHOWERS");
  assert.equal(result.forecast[1].operationalWeather.cloudCoverage, "BKN");
  assert.equal(result.forecast[1].operationalWeather.cloudBaseFt, 20000);
  
  // 06Z: FEW250
  assert.equal(result.forecast[2].operationalWeather.cloudCoverage, "FEW");
  assert.equal(result.forecast[2].operationalWeather.cloudBaseFt, 25000);
  
  // 13Z: SCT035
  assert.equal(result.forecast[3].operationalWeather.cloudCoverage, "SCT");
  assert.equal(result.forecast[3].operationalWeather.cloudBaseFt, 3500);
});
